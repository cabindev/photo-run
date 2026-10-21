import sharp from "sharp"

/**
 * จากต้นฉบับใบเดียว ทำ 3 ขนาด:
 *  - thumb   400px  — ตารางรูปในแกลเลอรี
 *  - preview 1280px + ลายน้ำ — ดูรูปขยาย (กันเอาไปใช้แทนต้นฉบับ)
 *  - analysis 2048px ไม่มีลายน้ำ — ส่งให้ Azure Face/OCR เท่านั้น ไม่เก็บ
 *    (Face รับไม่เกิน 6MB และหาหน้าเล็กได้ดีที่ด้านยาว ≤ 1920–2048px, ลายน้ำจะรบกวน OCR)
 */
export type Variants = {
    thumb: Buffer
    preview: Buffer
    analysis: Buffer
    width: number
    height: number
}

export async function makeVariants(original: Buffer, watermarkText: string | null): Promise<Variants> {
    // rotate() = หมุนตาม EXIF orientation ก่อน — ไม่งั้นรูปแนวตั้งจากกล้องจะนอน
    const base = sharp(original, { failOn: "none" }).rotate()
    const meta = await base.clone().metadata()
    const rotated = (meta.orientation ?? 1) >= 5
    const width = (rotated ? meta.height : meta.width) ?? 0
    const height = (rotated ? meta.width : meta.height) ?? 0

    const resize = (size: number) => base.clone().resize(size, size, { fit: "inside", withoutEnlargement: true })

    const [thumb, analysis, previewPlain] = await Promise.all([
        resize(400).jpeg({ quality: 72, mozjpeg: true }).toBuffer(),
        resize(2048).jpeg({ quality: 88 }).toBuffer(),
        resize(1280).toBuffer({ resolveWithObject: true }),
    ])

    let previewImg = sharp(previewPlain.data)
    if (watermarkText) {
        previewImg = previewImg.composite([{ input: watermarkSvg(previewPlain.info.width, previewPlain.info.height, watermarkText) }])
    }
    const preview = await previewImg.jpeg({ quality: 80, mozjpeg: true }).toBuffer()

    return { thumb, preview, analysis, width, height }
}

// ลายน้ำตัวอักษรขาวโปร่งแสง ทแยงกลางรูป + มุมขวาล่าง
function watermarkSvg(w: number, h: number, text: string): Buffer {
    const safe = text.replace(/[<>&"']/g, "")
    const big = Math.round(Math.min(w, h) / 9)
    const small = Math.round(Math.min(w, h) / 28)
    return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <style>text{font-family:Helvetica,Arial,sans-serif;font-weight:700;fill:#fff}</style>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-size="${big}" fill-opacity="0.28"
        transform="rotate(-24 ${w / 2} ${h / 2})">${safe}</text>
  <text x="${w - small}" y="${h - small}" text-anchor="end" font-size="${small}" fill-opacity="0.7">${safe}</text>
</svg>`)
}
