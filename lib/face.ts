import fs from "node:fs"
import path from "node:path"
import sharp from "sharp"
import * as ort from "onnxruntime-node"

/**
 * จดจำใบหน้าด้วยโมเดล open-source ของ OpenCV รันในเครื่องเราเอง (ไม่ส่งหน้าไปบริการภายนอก)
 *  - YuNet (MIT)        หาหน้า + จุดสำคัญ 5 จุด (ตา จมูก มุมปาก)
 *  - SFace (Apache-2.0) แปลงหน้าที่จัดตรงแล้ว 112×112 เป็นเวกเตอร์ 128 มิติ
 * หน้าคนเดียวกัน = cosine similarity สูง (เกณฑ์ดู MATCH_THRESHOLD)
 *
 * ไฟล์โมเดลอยู่ใน models/ — โหลดด้วย `npm run models`
 */

const MODEL_DIR = path.join(process.cwd(), "models")
const DETECTOR_FILE = path.join(MODEL_DIR, "face_detection_yunet_2023mar.onnx")
const RECOGNIZER_FILE = path.join(MODEL_DIR, "face_recognition_sface_2021dec.onnx")

// YuNet รุ่นนี้รับภาพ 640×640 ตายตัว — รูปใหญ่จึงตัดเป็นช่องๆ เพื่อให้เจอหน้าคนที่อยู่ไกล
const DET_SIZE = 640
// ด้านยาวของภาพที่ใช้หาหน้า — 1280 = ช่องละ 640 ประมาณ 2×2 ช่อง (+ ภาพเต็มย่อหนึ่งรอบสำหรับหน้าใหญ่)
const DET_LONG_SIDE = 1280
const SCORE_THRESHOLD = 0.8
const NMS_IOU = 0.3
// หน้าเล็กกว่านี้ (พิกเซลในภาพ 1280) เวกเตอร์ไม่น่าเชื่อถือ — คนไกลๆ ในฝูง
const MIN_FACE_PX = 36

export const EMBEDDING_DIM = 128
// OpenCV แนะนำ 0.363 สำหรับเทียบทีละคู่ แต่ค้นในงานที่มีหลายหมื่นหน้า คนหน้าคล้ายหลุดมาเยอะ
// ทดสอบกับรันลัดโต้ง #8: คนเดียวกัน ≥ 0.46, คนอื่นที่หลุดมาอยู่ราว 0.36–0.43
export const MATCH_THRESHOLD = 0.45

// ตำแหน่งมาตรฐานของจุด 5 จุดในภาพ 112×112 ที่ SFace ถูกเทรนมา (เหมือน ArcFace)
const ALIGN_DST = [
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041],
]

export type Box = { left: number; top: number; width: number; height: number }
export type DetectedFace = { box: Box; score: number; landmarks: number[][] }
export type FaceEmbedding = { box: Box; score: number; embedding: Float32Array }

let sessions: Promise<{ det: ort.InferenceSession; rec: ort.InferenceSession }> | null = null

function getSessions() {
    sessions ??= Promise.all([
        ort.InferenceSession.create(DETECTOR_FILE, { logSeverityLevel: 3 }),
        ort.InferenceSession.create(RECOGNIZER_FILE, { logSeverityLevel: 3 }),
    ]).then(([det, rec]) => ({ det, rec }))
    return sessions
}

export function isFaceModelReady(): boolean {
    return fs.existsSync(DETECTOR_FILE) && fs.existsSync(RECOGNIZER_FILE)
}

type Raw = { data: Buffer; width: number; height: number }

async function decode(image: Buffer, longSide: number): Promise<Raw> {
    const { data, info } = await sharp(image, { failOn: "none" })
        .rotate()
        .resize(longSide, longSide, { fit: "inside", withoutEnlargement: true })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height }
}

/**
 * หาทุกหน้า + แปลงเป็นเวกเตอร์ — ใช้ทั้งตอนซิงก์ (หน้าทุกคนในรูป) และตอนค้น (เซลฟี่)
 * box คืนเป็นสัดส่วน 0–1 ของภาพ เพื่อไม่ผูกกับขนาดรูปที่ใช้วิเคราะห์
 */
export async function embedFaces(image: Buffer): Promise<FaceEmbedding[]> {
    const { det, rec } = await getSessions()
    const img = await decode(image, DET_LONG_SIDE)
    const faces = (await detect(det, img)).filter((f) => Math.min(f.box.width, f.box.height) >= MIN_FACE_PX)

    const out: FaceEmbedding[] = []
    for (const f of faces) {
        const input = alignCrop(img, f.landmarks)
        const res = await rec.run({ [rec.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, 112, 112]) })
        const embedding = l2normalize(res[rec.outputNames[0]].data as Float32Array)
        out.push({
            score: f.score,
            embedding,
            box: { left: f.box.left / img.width, top: f.box.top / img.height, width: f.box.width / img.width, height: f.box.height / img.height },
        })
    }
    return out
}

// ---------- YuNet ----------

async function detect(det: ort.InferenceSession, img: Raw): Promise<DetectedFace[]> {
    const found: DetectedFace[] = []

    // รอบที่ 1: ภาพเต็มย่อให้พอดี 640 — จับหน้าใหญ่ (เซลฟี่ / ถ่ายใกล้)
    const scale = Math.min(1, DET_SIZE / Math.max(img.width, img.height))
    found.push(...(await runTile(det, img, 0, 0, img.width, img.height, scale)))

    // รอบที่ 2: ช่องละ 640 ที่ความละเอียดเต็ม (ซ้อนกันบ้าง) — จับหน้าเล็ก
    if (scale < 1) {
        for (const y of tileStarts(img.height)) {
            for (const x of tileStarts(img.width)) {
                found.push(...(await runTile(det, img, x, y, Math.min(DET_SIZE, img.width - x), Math.min(DET_SIZE, img.height - y), 1)))
            }
        }
    }
    return nms(found)
}

function tileStarts(length: number): number[] {
    if (length <= DET_SIZE) return [0]
    const n = Math.ceil(length / DET_SIZE)
    const step = (length - DET_SIZE) / (n - 1)
    return Array.from({ length: n }, (_, i) => Math.round(i * step))
}

/** ตัดภาพส่วน (x,y,w,h) ย่อด้วย scale แล้ววางมุมซ้ายบนของภาพ 640×640 (ที่เหลือเป็นดำ) */
async function runTile(det: ort.InferenceSession, img: Raw, x0: number, y0: number, w: number, h: number, scale: number): Promise<DetectedFace[]> {
    const plane = DET_SIZE * DET_SIZE
    const input = new Float32Array(3 * plane)
    const tw = Math.min(DET_SIZE, Math.round(w * scale))
    const th = Math.min(DET_SIZE, Math.round(h * scale))
    for (let ty = 0; ty < th; ty++) {
        const sy = Math.min(img.height - 1, y0 + Math.floor(ty / scale))
        for (let tx = 0; tx < tw; tx++) {
            const sx = Math.min(img.width - 1, x0 + Math.floor(tx / scale))
            const si = (sy * img.width + sx) * 3
            const di = ty * DET_SIZE + tx
            // YuNet รับ BGR ค่า 0–255 ไม่ normalize
            input[di] = img.data[si + 2]
            input[plane + di] = img.data[si + 1]
            input[2 * plane + di] = img.data[si]
        }
    }

    const r = await det.run({ input: new ort.Tensor("float32", input, [1, 3, DET_SIZE, DET_SIZE]) })
    const faces: DetectedFace[] = []
    for (const stride of [8, 16, 32]) {
        const cls = r[`cls_${stride}`].data as Float32Array
        const obj = r[`obj_${stride}`].data as Float32Array
        const bbox = r[`bbox_${stride}`].data as Float32Array
        const kps = r[`kps_${stride}`].data as Float32Array
        const cols = DET_SIZE / stride
        for (let i = 0; i < cls.length; i++) {
            const score = Math.sqrt(clamp01(cls[i]) * clamp01(obj[i]))
            if (score < SCORE_THRESHOLD) continue
            const c = i % cols
            const row = Math.floor(i / cols)
            const cx = (c + bbox[i * 4]) * stride
            const cy = (row + bbox[i * 4 + 1]) * stride
            const bw = Math.exp(bbox[i * 4 + 2]) * stride
            const bh = Math.exp(bbox[i * 4 + 3]) * stride
            // แปลงกลับเป็นพิกัดในภาพเต็ม
            const toX = (v: number) => x0 + v / scale
            const toY = (v: number) => y0 + v / scale
            faces.push({
                score,
                box: { left: toX(cx - bw / 2), top: toY(cy - bh / 2), width: bw / scale, height: bh / scale },
                landmarks: Array.from({ length: 5 }, (_, n) => [toX((kps[i * 10 + 2 * n] + c) * stride), toY((kps[i * 10 + 2 * n + 1] + row) * stride)]),
            })
        }
    }
    return faces
}

function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v
}

function iou(a: Box, b: Box): number {
    const x1 = Math.max(a.left, b.left)
    const y1 = Math.max(a.top, b.top)
    const x2 = Math.min(a.left + a.width, b.left + b.width)
    const y2 = Math.min(a.top + a.height, b.top + b.height)
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
    return inter / (a.width * a.height + b.width * b.height - inter || 1)
}

function nms(faces: DetectedFace[]): DetectedFace[] {
    const kept: DetectedFace[] = []
    for (const f of faces.sort((a, b) => b.score - a.score)) {
        if (kept.every((k) => iou(k.box, f.box) < NMS_IOU)) kept.push(f)
    }
    return kept
}

// ---------- SFace ----------

/**
 * จัดหน้าให้ตรงด้วย similarity transform (หมุน/ย่อ/เลื่อน) ที่พาจุด 5 จุดไปตำแหน่งมาตรฐาน
 * แล้วสุ่มตัวอย่างแบบ bilinear เป็นภาพ 112×112 — คืนเป็น RGB 0–255 แบบ NCHW
 */
function alignCrop(img: Raw, landmarks: number[][]): Float32Array {
    // least squares: dst = [a -b; b a]·src + t
    const n = landmarks.length
    const ms = landmarks.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0])
    const md = ALIGN_DST.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0])
    let num1 = 0
    let num2 = 0
    let den = 0
    for (let i = 0; i < n; i++) {
        const xs = landmarks[i][0] - ms[0]
        const ys = landmarks[i][1] - ms[1]
        const xd = ALIGN_DST[i][0] - md[0]
        const yd = ALIGN_DST[i][1] - md[1]
        num1 += xs * xd + ys * yd
        num2 += xs * yd - ys * xd
        den += xs * xs + ys * ys
    }
    const a = num1 / den
    const b = num2 / den
    const tx = md[0] - (a * ms[0] - b * ms[1])
    const ty = md[1] - (b * ms[0] + a * ms[1])
    // ผกผัน: src = (1/(a²+b²))·[a b; -b a]·(dst - t)
    const k = 1 / (a * a + b * b)

    const plane = 112 * 112
    const out = new Float32Array(3 * plane)
    for (let v = 0; v < 112; v++) {
        for (let u = 0; u < 112; u++) {
            const du = u - tx
            const dv = v - ty
            const sx = k * (a * du + b * dv)
            const sy = k * (-b * du + a * dv)
            const x0 = Math.floor(sx)
            const y0 = Math.floor(sy)
            const fx = sx - x0
            const fy = sy - y0
            const di = v * 112 + u
            for (let ch = 0; ch < 3; ch++) {
                const p = (x: number, y: number) =>
                    x < 0 || y < 0 || x >= img.width || y >= img.height ? 0 : img.data[(y * img.width + x) * 3 + ch]
                const val =
                    p(x0, y0) * (1 - fx) * (1 - fy) + p(x0 + 1, y0) * fx * (1 - fy) + p(x0, y0 + 1) * (1 - fx) * fy + p(x0 + 1, y0 + 1) * fx * fy
                out[ch * plane + di] = val
            }
        }
    }
    return out
}

function l2normalize(v: Float32Array): Float32Array {
    let s = 0
    for (const x of v) s += x * x
    const n = Math.sqrt(s) || 1
    return Float32Array.from(v, (x) => x / n)
}

/** เวกเตอร์ ↔ Bytes สำหรับเก็บใน MySQL (128 × float32 = 512 ไบต์) */
export function embeddingToBytes(e: Float32Array): Uint8Array<ArrayBuffer> {
    return new Uint8Array(e.buffer.slice(e.byteOffset, e.byteOffset + e.byteLength) as ArrayBuffer)
}

export function bytesToEmbedding(b: Uint8Array): Float32Array {
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}
