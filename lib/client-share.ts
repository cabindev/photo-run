/**
 * ตัวช่วยฝั่งเบราว์เซอร์สำหรับแชร์/บันทึกรูป — ใช้ใน PhotoBrowser และ PhotoViewer
 */

// มือถือที่แชร์ไฟล์ได้ — คอมบางเครื่อง (Chrome บน Mac) ก็แชร์ได้ แต่บนคอม .zip / คัดลอกลิงก์สะดวกกว่า จึงดูจอสัมผัสด้วย
// ค่าไม่เปลี่ยนระหว่างใช้งาน ใช้กับ useSyncExternalStore (ฝั่งเซิร์ฟเวอร์ถือว่าไม่ได้)
export function canShareFiles(): boolean {
    if (!window.matchMedia("(pointer: coarse)").matches) return false
    const probe = new File([new Blob()], "x.jpg", { type: "image/jpeg" })
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] })
}
export const noSubscribe = () => () => {}

export function filenameFrom(res: Response, fallback: string): string {
    const m = res.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/)
    return m ? decodeURIComponent(m[1]) : fallback
}

/** โหลดรูปต้นฉบับเป็นไฟล์ สำหรับหน้าต่างแชร์ */
export async function fetchOriginal(id: string, signal?: AbortSignal): Promise<File> {
    const res = await fetch(`/api/photos/${id}/download`, { signal })
    if (!res.ok) throw new Error(String(res.status))
    return new File([await res.blob()], filenameFrom(res, `${id}.jpg`), { type: "image/jpeg" })
}

/** ผู้ใช้กดยกเลิกหน้าต่างแชร์ — ไม่ใช่ข้อผิดพลาด */
export function isShareCancel(e: unknown): boolean {
    return e instanceof DOMException && e.name === "AbortError"
}
