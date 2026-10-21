/**
 * IP ของผู้ใช้สำหรับจำกัดความถี่ — เว็บอยู่หลัง Cloudflare จึงใช้ CF-Connecting-IP ก่อน
 * (X-Forwarded-For ตัวแรกผู้ใช้ปลอมส่งมาเองได้ — Cloudflare ต่อท้ายให้ ไม่ได้แทนที่)
 */
export function clientIp(headers: Headers): string {
    return (
        headers.get("cf-connecting-ip")?.trim() ||
        headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
        "local"
    )
}
