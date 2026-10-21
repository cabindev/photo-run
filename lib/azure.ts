/**
 * เรียก Azure AI Vision (OCR อ่านเลข BIB) ผ่าน REST ตรงๆ — ไม่ใช้ SDK เพราะใช้แค่ endpoint เดียว
 * (ค้นด้วยใบหน้าไม่ใช้ Azure Face เพราะเป็น Limited Access — ใช้โมเดลในเครื่องที่ lib/face.ts)
 */

export class AzureError extends Error {
    constructor(public status: number, public code: string | undefined, message: string) {
        super(message)
    }
}

async function call(path: string, init: { method: string; body?: Buffer | object }): Promise<Response> {
    const endpoint = process.env.AZURE_VISION_ENDPOINT?.replace(/\/$/, "")
    const key = process.env.AZURE_VISION_KEY
    if (!endpoint || !key) throw new Error("ยังไม่ได้ตั้ง AZURE_VISION_ENDPOINT / _KEY")

    const isBinary = Buffer.isBuffer(init.body)
    const headers: Record<string, string> = { "Ocp-Apim-Subscription-Key": key }
    if (init.body) headers["Content-Type"] = isBinary ? "application/octet-stream" : "application/json"

    // F0 จำกัด 20 ครั้ง/นาที, S0 ~10 ครั้ง/วินาที — โดน 429 ให้รอตาม Retry-After แล้วลองใหม่
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${endpoint}${path}`, {
            method: init.method,
            headers,
            body: init.body ? (isBinary ? new Uint8Array(init.body as Buffer) : JSON.stringify(init.body)) : undefined,
        })
        if (res.status === 429 && attempt < 8) {
            const wait = Number(res.headers.get("retry-after")) || 2 ** attempt
            await new Promise((r) => setTimeout(r, Math.min(wait, 60) * 1000))
            continue
        }
        if (!res.ok) {
            const text = await res.text()
            let code: string | undefined
            let message = text
            try {
                const j = JSON.parse(text)
                code = j.error?.innererror?.code ?? j.error?.code
                message = j.error?.message ?? text
            } catch {}
            throw new AzureError(res.status, code, `Azure vision ${res.status}${code ? ` ${code}` : ""}: ${message}`)
        }
        return res
    }
}

// ---------- Vision (OCR) ----------

// คำที่ OCR ไม่มั่นใจมักเป็นตัวอักษรไทย/ลวดลายบนป้ายที่ถูกอ่านเป็นตัวเลข (เช่น "รัน" บนซุ้ม → "526")
// ส่วนเลข BIB จริงที่อ่านได้ชัดมักมั่นใจ ≥ 0.95
const MIN_WORD_CONFIDENCE = 0.8

/** อ่านข้อความทุกบรรทัดในรูป (เฉพาะคำที่มั่นใจพอ) — เอาไปกรองหาเลข BIB ต่อใน lib/bib.ts */
export async function readTextLines(image: Buffer): Promise<string[]> {
    const res = await call(`/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read`, {
        method: "POST",
        body: image,
    })
    const j = (await res.json()) as {
        readResult?: { blocks?: { lines?: { text: string; words?: { text: string; confidence: number }[] }[] }[] }
    }
    return (j.readResult?.blocks ?? [])
        .flatMap((b) => b.lines ?? [])
        .map((l) => (l.words ?? []).filter((w) => w.confidence >= MIN_WORD_CONFIDENCE).map((w) => w.text).join(" "))
        .filter(Boolean)
}

export function isVisionConfigured(): boolean {
    return Boolean(process.env.AZURE_VISION_ENDPOINT && process.env.AZURE_VISION_KEY)
}
