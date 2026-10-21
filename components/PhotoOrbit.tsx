"use client"

import { useEffect, useRef, type ReactNode } from "react"

/**
 * รูปเคลื่อนไหวแบบ "Lens Orbit" (animos) — วนเป็นรอบ CYCLE วินาที:
 *   1. แถบเลนส์: การ์ดเรียงแถวเดียวเลื่อนผ่าน ใบที่อยู่กลางจอขยายใหญ่เหมือนผ่านเลนส์
 *   2. แตกออกเป็นตารางเอียงแบบเหลื่อม แล้วลอยช้าๆ
 *   3. การ์ดรวมเข้ากลางแล้วหายไป → ขึ้นชื่องาน (children) → ชื่องานจาง การ์ดพุ่งออกมาเป็นแถบเลนส์อีกครั้ง
 * คำนวณตำแหน่งทุกเฟรมแล้วเขียน style.transform ตรงๆ (ไม่ผ่าน React state — ไม่ re-render)
 * ผู้ใช้ที่ตั้งลดการเคลื่อนไหวจะเห็นตารางรูปจางๆ นิ่ง กับชื่องานทับด้านบน
 */

const CYCLE = 24
// ช่วงเวลาในหนึ่งรอบ (วินาที)
const TO_GRID_AT = 6.5 //   แถบเลนส์ → ตาราง
const GRID_AT = 8.2
const COLLAPSE_AT = 14 //   ตาราง → รวมเข้ากลางแล้วหาย
const GONE_AT = 15.5
const TITLE_IN = [15.2, 16.4] // ชื่องานค่อยๆ ขึ้น
const TITLE_OUT = [20, 21] //    ชื่องานจางหาย
const EMERGE_AT = 20.6 //  การ์ดพุ่งออกจากกลางเป็นแถบเลนส์
const STRIP_AT = 22.2
const STRIP_SPEED = 0.55 // การ์ดต่อวินาที

type Pose = { x: number; y: number; s: number; r: number; o: number }

const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

export default function PhotoOrbit({ urls, children }: { urls: string[]; children?: ReactNode }) {
    const stage = useRef<HTMLDivElement>(null)
    const title = useRef<HTMLDivElement>(null)
    const cards = useRef<(HTMLLIElement | null)[]>([])

    useEffect(() => {
        const el = stage.current
        if (!el) return
        const n = urls.length
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        let w = 0
        let h = 0
        const measure = () => {
            w = el.clientWidth
            h = el.clientHeight
        }
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)

        // การ์ดใหญ่เต็มตา — จำกัดด้วยทั้งกว้างและสูงของจอ ตอนเป็นตารางจะล้นขอบจอเล็กน้อย
        const cardSize = () => Math.max(120, Math.min(w * 0.46, h * 0.42))

        // 1) แถบเลนส์ — x เลื่อนต่อเนื่อง วนรอบเมื่อหลุดขอบ ใบกลางขยาย
        const stripPose = (i: number, t: number): Pose => {
            const size = cardSize()
            const spacing = size * 0.72
            let p = (((i - t * STRIP_SPEED) % n) + n) % n
            if (p > n / 2) p -= n
            const x = p * spacing
            const lens = Math.exp(-((x / (spacing * 1.3)) ** 2))
            const edge = clamp01((Math.abs(x) - w * 0.38) / (w * 0.14))
            return { x, y: 0, s: 0.7 + 0.55 * lens, r: 0, o: 1 - edge }
        }

        // 2) ตารางเอียงแบบเหลื่อม — คอลัมน์คี่เลื่อนลงครึ่งช่อง ทั้งตารางลอยช้าๆ
        const gridPose = (i: number, t: number): Pose => {
            const size = cardSize()
            const cols = w > h * 1.2 ? 6 : 4
            const rows = Math.ceil(n / cols)
            const cell = size * 1.02
            const c = i % cols
            const row = Math.floor(i / cols)
            let x = (c - (cols - 1) / 2) * cell
            let y = (row - (rows - 1) / 2) * cell + (c % 2 ? cell * 0.42 : 0)
            // หมุนทั้งตาราง -12° แล้วให้ลอยวนเล็กน้อย
            const a = (-12 * Math.PI) / 180
            ;[x, y] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
            x += Math.sin(t * 0.35) * cell * 0.25
            y += Math.cos(t * 0.28) * cell * 0.18
            return { x, y, s: 1, r: -12, o: 1 }
        }

        const ramp = (local: number, from: number, to: number) => ease(clamp01((local - from) / (to - from)))

        const apply = (t: number, dimmed = false) => {
            const local = t % CYCLE
            if (title.current) {
                const o = ramp(local, TITLE_IN[0], TITLE_IN[1]) * (1 - ramp(local, TITLE_OUT[0], TITLE_OUT[1]))
                title.current.style.opacity = String(dimmed ? 1 : o)
                title.current.style.transform = `scale(${dimmed ? 1 : 0.94 + 0.06 * o})`
            }
            for (let i = 0; i < n; i++) {
                const card = cards.current[i]
                if (!card) continue
                // การ์ดแต่ละใบออกตัวไม่พร้อมกันเล็กน้อย ให้ดูไหลเป็นคลื่น
                const lag = (i / n) * 0.6
                // k: น้ำหนักของตาราง (0 = แถบเลนส์, 1 = ตาราง) — สลับกลับเป็นแถบตอนการ์ดหายไปแล้ว
                const k = local < COLLAPSE_AT ? ramp(local, TO_GRID_AT + lag, GRID_AT + lag) : local < EMERGE_AT ? 1 : 0
                // c: การ์ดรวมเข้ากลางแล้วหาย (0 = ปกติ, 1 = หายที่กลางจอ)
                const c = local < EMERGE_AT ? ramp(local, COLLAPSE_AT + lag * 0.5, GONE_AT + lag * 0.5) : 1 - ramp(local, EMERGE_AT + lag, STRIP_AT + lag)
                const a = stripPose(i, t)
                const b = gridPose(i, t)
                const base: Pose = {
                    x: lerp(a.x, b.x, k),
                    y: lerp(a.y, b.y, k),
                    s: lerp(a.s, b.s, k),
                    r: lerp(a.r, b.r, k),
                    o: lerp(a.o, b.o, k),
                }
                const pose: Pose = {
                    x: lerp(base.x, 0, c),
                    y: lerp(base.y, 0, c),
                    s: lerp(base.s, 0.25, c),
                    r: lerp(base.r, 0, c),
                    o: dimmed ? 0.25 : lerp(base.o, 0, c),
                }
                const size = cardSize()
                card.style.width = `${size}px`
                card.style.height = `${size * 1.18}px`
                card.style.transform = `translate(-50%, -50%) translate3d(${pose.x}px, ${pose.y}px, 0) rotate(${pose.r}deg) scale(${pose.s})`
                card.style.opacity = String(pose.o)
                card.style.zIndex = String(Math.round(pose.s * 100))
            }
        }

        if (reduced) {
            // ตารางนิ่งจางๆ + ชื่องานทับด้านบน
            apply(GRID_AT + 1, true)
            return () => ro.disconnect()
        }

        let raf = 0
        const start = performance.now()
        const tick = (now: number) => {
            apply((now - start) / 1000)
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => {
            cancelAnimationFrame(raf)
            ro.disconnect()
        }
    }, [urls])

    return (
        <div ref={stage} className="photo-orbit">
            <ul aria-hidden="true">
                {urls.map((u, i) => (
                    <li
                        key={u}
                        ref={(node) => {
                            cards.current[i] = node
                        }}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element -- รูปย่อจาก Blob ย่อมาแล้ว */}
                        <img src={u} alt="" draggable={false} />
                    </li>
                ))}
            </ul>
            {children && (
                <div ref={title} className="photo-orbit-title" style={{ opacity: 0 }}>
                    {children}
                </div>
            )}
        </div>
    )
}
