import { PassThrough, Readable } from "node:stream"
import archiver from "archiver"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { streamFile } from "@/lib/drive"

/**
 * ดาวน์โหลดหลายรูปเป็นไฟล์ .zip ไฟล์เดียว — formData: id=<photoId> (ซ้ำได้หลายตัว)
 * ส่งผ่าน <form method="post"> ตรงๆ ให้เบราว์เซอร์โหลดเอง (ไม่ต้องเก็บทั้ง zip ในหน่วยความจำฝั่งผู้ใช้)
 *
 * ดึงต้นฉบับจาก Drive ทีละรูปแล้วต่อเข้า zip ระหว่างส่ง (stream) — ไม่โหลดทั้งหมดเข้าหน่วยความจำ
 * ใช้โหมด store (ไม่บีบอัด) เพราะ JPEG บีบอัดมาแล้ว บีบซ้ำได้ไม่กี่ % แต่เปลือง CPU
 */
const MAX_PHOTOS = 60

export async function POST(req: NextRequest) {
    const form = await req.formData()
    const ids = [...new Set(form.getAll("id").map(String).filter(Boolean))]
    if (!ids.length) return NextResponse.json({ error: "ยังไม่ได้เลือกรูป" }, { status: 400 })
    if (ids.length > MAX_PHOTOS) return NextResponse.json({ error: `เลือกได้ไม่เกิน ${MAX_PHOTOS} รูปต่อครั้ง` }, { status: 400 })

    const photos = await prisma.photo.findMany({
        where: { id: { in: ids }, status: "PROCESSED", event: { isPublished: true } },
        select: { id: true, driveFileId: true, filename: true, event: { select: { slug: true } } },
    })
    if (!photos.length) return NextResponse.json({ error: "ไม่พบรูป" }, { status: 404 })

    const archive = archiver("zip", { store: true })
    const out = new PassThrough()
    archive.pipe(out)
    archive.on("warning", (e) => console.warn("[zip]", e))
    archive.on("error", (e) => {
        console.error("[zip]", e)
        out.destroy(e)
    })

    // ทีละรูป — เปิดสตรีมจาก Drive พร้อมกันหลายสิบตัวจะโดนจำกัดความถี่
    void (async () => {
        const used = new Set<string>()
        for (const p of photos) {
            // ชื่อไฟล์ซ้ำได้ (ช่างภาพคนละคนใช้ชื่อเดียวกัน) — เติมเลขกันทับ
            let name = p.filename
            for (let n = 2; used.has(name.toLowerCase()); n++) name = p.filename.replace(/(\.[^.]*)?$/, `-${n}$1`)
            used.add(name.toLowerCase())
            try {
                const stream = (await streamFile(p.driveFileId)) as Readable
                await new Promise<void>((resolve, reject) => {
                    archive.once("entry", () => resolve())
                    stream.once("error", reject)
                    archive.append(stream, { name })
                })
            } catch (e) {
                // รูปเดียวพังไม่ทำให้ทั้ง zip พัง — ใส่ไฟล์บอกไว้แทน
                console.error("[zip]", p.id, e)
                archive.append(`ดาวน์โหลด ${p.filename} ไม่สำเร็จ ลองโหลดทีละรูปอีกครั้ง\n`, { name: `${name}.error.txt` })
            }
        }
        await archive.finalize()
    })()

    const filename = `${photos[0].event.slug}-${photos.length}-photos.zip`
    return new Response(Readable.toWeb(out) as ReadableStream, {
        headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
        },
    })
}
