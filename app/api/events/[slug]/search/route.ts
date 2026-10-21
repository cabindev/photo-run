import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"
import { prisma } from "@/lib/prisma"
import { isFaceModelReady } from "@/lib/face"
import { lookupBibsByPhone, searchByBibs, searchByFace } from "@/lib/search"

/**
 * ค้นรูปในงาน — formData:
 *   mode=bib   value=<เลข BIB>
 *   mode=phone value=<เบอร์โทร>   (แปลงเป็น BIB ผ่านเว็บสมัคร)
 *   mode=face  selfie=<ไฟล์รูป> consent=1
 *
 * เซลฟี่ไม่ถูกบันทึกที่ไหนเลย — แปลงเป็นเวกเตอร์ในหน่วยความจำของเซิร์ฟเวอร์แล้วทิ้ง ไม่ส่งออกไปภายนอก
 */

// ค้นด้วยหน้ากิน CPU ของเซิร์ฟเวอร์ — จำกัดต่อ IP แบบง่ายในหน่วยความจำ (พอสำหรับเซิร์ฟเวอร์เดียว)
const hits = new Map<string, number[]>()
function rateLimited(ip: string, limit = 12, windowMs = 60_000): boolean {
    const now = Date.now()
    const list = (hits.get(ip) ?? []).filter((t) => now - t < windowMs)
    list.push(now)
    hits.set(ip, list)
    if (hits.size > 5000) hits.clear()
    return list.length > limit
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/events/[slug]/search">) {
    const { slug } = await ctx.params
    const event = await prisma.event.findUnique({ where: { slug } })
    if (!event || !event.isPublished) return NextResponse.json({ error: "ไม่พบงานนี้" }, { status: 404 })

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
    if (rateLimited(ip)) return NextResponse.json({ error: "ค้นหาถี่เกินไป รอสักครู่แล้วลองใหม่" }, { status: 429 })

    const form = await req.formData()
    const mode = String(form.get("mode") ?? "")

    try {
        if (mode === "bib") {
            if (!event.bibOcrEnabled) return NextResponse.json({ error: "งานนี้ไม่ได้เปิดค้นด้วยเลข BIB" }, { status: 400 })
            const value = String(form.get("value") ?? "").trim()
            if (!value) return NextResponse.json({ error: "กรอกเลข BIB" }, { status: 400 })
            return NextResponse.json({ photos: await searchByBibs(event.id, [value]) })
        }

        if (mode === "phone") {
            const value = String(form.get("value") ?? "")
            const bibs = await lookupBibsByPhone(value, event.slug)
            if (!bibs.length) return NextResponse.json({ photos: [], message: "ไม่พบเบอร์นี้ในรายชื่อผู้สมัครของงาน" })
            return NextResponse.json({ photos: await searchByBibs(event.id, bibs), bibs })
        }

        if (mode === "face") {
            if (!event.faceSearchEnabled || !isFaceModelReady()) {
                return NextResponse.json({ error: "งานนี้ยังไม่เปิดค้นด้วยใบหน้า" }, { status: 400 })
            }
            if (form.get("consent") !== "1") {
                return NextResponse.json({ error: "ต้องยินยอมให้ใช้ภาพใบหน้าเพื่อค้นหาก่อน" }, { status: 400 })
            }
            const file = form.get("selfie")
            if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "เลือกรูปเซลฟี่" }, { status: 400 })
            if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "รูปใหญ่เกิน 15MB" }, { status: 400 })

            let selfie: Buffer
            try {
                selfie = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: "none" }).rotate().jpeg().toBuffer()
            } catch {
                return NextResponse.json({ error: "อ่านรูปไม่ได้ ลองรูปอื่น" }, { status: 400 })
            }
            const photos = await searchByFace(event.id, selfie)
            if (photos === null) return NextResponse.json({ photos: [], message: "ไม่เห็นใบหน้าในรูปนี้ ลองเซลฟี่หน้าตรง เห็นหน้าชัดๆ" })
            return NextResponse.json({ photos, ...(photos.length ? {} : { message: "ไม่พบรูปที่ตรงกับใบหน้านี้ ลองรูปที่เห็นหน้าชัดๆ ไม่ใส่แว่นดำ" }) })
        }

        return NextResponse.json({ error: "รูปแบบการค้นหาไม่ถูกต้อง" }, { status: 400 })
    } catch (e) {
        console.error("[search]", e)
        return NextResponse.json({ error: "ค้นหาไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 })
    }
}
