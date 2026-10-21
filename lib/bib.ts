/**
 * เลข BIB บนเสื้อ — OCR อ่านได้หลายแบบ ("M-060", "M 060", "m060") จึงเก็บและค้นแบบ normalize เสมอ
 * normalize = ตัวพิมพ์ใหญ่ ตัดทุกอย่างที่ไม่ใช่ A-Z / 0-9 → "M060"
 */
export function normalizeBib(raw: string): string {
    return raw.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

// ค่าเริ่มต้น: ตัวอักษรนำ 0–2 ตัว (M/F/VIP...) ตามด้วยตัวเลข 2–5 หลัก เช่น M-060, F156, 0412
// งานที่ BIB หน้าตาต่างออกไปตั้ง Event.bibPattern เอง
export const DEFAULT_BIB_PATTERN = "^[A-Z]{0,3}-?\\s?\\d{2,5}$"

/** เลือกเฉพาะข้อความจาก OCR ที่หน้าตาเหมือน BIB — ข้อความอื่นบนเสื้อ/ป้าย (ชื่อสปอนเซอร์ ฯลฯ) ทิ้งไป */
export function extractBibs(lines: string[], pattern: string | null | undefined, eventDate?: Date | null): string[] {
    const re = new RegExp(pattern || DEFAULT_BIB_PATTERN, "i")
    // ปีของงาน (ค.ศ./พ.ศ.) มักพิมพ์อยู่บนซุ้ม/ป้ายที่ติดอยู่แทบทุกรูป — ไม่ใช่ BIB
    const year = (eventDate ?? new Date()).getFullYear()
    const ignore = new Set([String(year), String(year + 543)])
    const found = new Set<string>()
    for (const line of lines) {
        // บรรทัดเดียวอาจมีหลายคำ เช่น "8.8 KM M-060" และ OCR มักแยกตัวอักษรนำออกจากตัวเลข ("F 156") — ลองคู่คำติดกันด้วย
        const words = line.split(/\s+/)
        const pairs = words.slice(1).map((w, i) => `${words[i]}${w}`)
        for (const word of [line, ...words, ...pairs]) {
            const w = word.trim()
            if (w.length >= 2 && re.test(w)) {
                const bib = normalizeBib(w)
                // ตัวเลขล้วนสั้นๆ มักเป็นปี/ระยะทาง/เวลา ไม่ใช่ BIB
                if (/^\d+$/.test(bib) && bib.length < 3) continue
                if (ignore.has(bib)) continue
                found.add(bib)
            }
        }
    }
    return [...found]
}
