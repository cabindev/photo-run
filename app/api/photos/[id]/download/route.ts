import { Readable } from "node:stream"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { streamFile } from "@/lib/drive"

/**
 * ดาวน์โหลดรูปต้นฉบับ — เซิร์ฟเวอร์ดึงจาก Drive ด้วย service account แล้วส่งต่อ
 * ไฟล์ใน Drive ไม่ต้องเปิดแชร์สาธารณะ และไม่ติดโควตาดาวน์โหลดของลิงก์สาธารณะ
 *
 * ตอนนี้โหลดฟรีสำหรับงานที่เผยแพร่แล้ว — ถ้าจะขายรูป ตรวจสิทธิ์การซื้อที่นี่
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/photos/[id]/download">) {
    const { id } = await ctx.params
    const photo = await prisma.photo.findUnique({
        where: { id },
        select: { driveFileId: true, filename: true, event: { select: { isPublished: true } } },
    })
    if (!photo || !photo.event.isPublished) return NextResponse.json({ error: "ไม่พบรูป" }, { status: 404 })

    const stream = await streamFile(photo.driveFileId)
    return new Response(Readable.toWeb(stream as Readable) as ReadableStream, {
        headers: {
            "Content-Type": "image/jpeg",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(photo.filename)}`,
            "Cache-Control": "private, max-age=3600",
        },
    })
}
