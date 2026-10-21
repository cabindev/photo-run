/**
 * โหลดโมเดลใบหน้าของ OpenCV (opencv_zoo) มาไว้ที่ models/ — ไฟล์ใหญ่ (~39MB) จึงไม่เก็บใน git
 *
 *   npm run models
 *
 * ตรวจ sha256 ทุกไฟล์ ถ้ามีอยู่แล้วและตรงจะข้าม
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const BASE = "https://github.com/opencv/opencv_zoo/raw/main/models"
const MODELS = [
    {
        file: "face_detection_yunet_2023mar.onnx",
        url: `${BASE}/face_detection_yunet/face_detection_yunet_2023mar.onnx`,
        sha256: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    },
    {
        file: "face_recognition_sface_2021dec.onnx",
        url: `${BASE}/face_recognition_sface/face_recognition_sface_2021dec.onnx`,
        sha256: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    },
]

const sha256 = (buf: Buffer) => crypto.createHash("sha256").update(buf).digest("hex")

async function main() {
    const dir = path.join(process.cwd(), "models")
    fs.mkdirSync(dir, { recursive: true })
    for (const m of MODELS) {
        const dest = path.join(dir, m.file)
        if (fs.existsSync(dest) && sha256(fs.readFileSync(dest)) === m.sha256) {
            console.log(`✓ ${m.file} มีอยู่แล้ว`)
            continue
        }
        console.log(`↓ ${m.file}`)
        const res = await fetch(m.url)
        if (!res.ok) throw new Error(`โหลด ${m.file} ไม่สำเร็จ: HTTP ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        if (sha256(buf) !== m.sha256) throw new Error(`${m.file} checksum ไม่ตรง — ไม่บันทึก`)
        fs.writeFileSync(dest, buf)
        console.log(`✓ ${m.file} (${(buf.length / 1e6).toFixed(1)}MB)`)
    }
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
})
