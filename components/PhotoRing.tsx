/**
 * วงแหวนรูป 3 มิติหมุนช้าๆ (แบบ "Showcase Stream" ของ animos) — CSS ล้วน ไม่ต้องมี JS
 * การ์ดแต่ละใบหมุนรอบแกน Y ห่างกันเท่าๆ กันแล้วดันออกไปที่รัศมี --r
 * ผู้ใช้ที่ตั้งลดการเคลื่อนไหว (prefers-reduced-motion) จะเห็นวงแหวนนิ่ง — ดู globals.css
 * size="full" = วงแหวนใหญ่เต็มพื้นที่ (ใช้เป็น hero ทั้งจอ)
 */
export default function PhotoRing({ urls, size }: { urls: string[]; size?: "full" }) {
    const step = 360 / urls.length
    return (
        <div className={`photo-ring-stage${size === "full" ? " photo-ring-stage--full" : ""}`} aria-hidden="true">
            <div className="photo-ring-tilt">
                <ul className="photo-ring">
                    {urls.map((u, i) => (
                        <li key={u} style={{ transform: `rotateY(${i * step}deg) translateZ(var(--r))` }}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- รูปย่อจาก Blob ย่อมาแล้ว */}
                            <img src={u} alt="" loading="lazy" draggable={false} />
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}
