/**
 * ตั้งรูปปกของงาน (แสดงในการ์ดงานหน้าแรก) — ย่อแล้วอัปโหลดขึ้น Azure Blob
 *
 *   npm run cover -- <slug> <ไฟล์รูป>
 *   npm run cover -- <slug> --clear      กลับไปใช้รูปแรกของงาน
 *
 * ชื่อไฟล์ใน Blob มี hash ของเนื้อหา — รูปถูก cache แบบ immutable ถ้าใช้ชื่อเดิมเปลี่ยนรูปแล้วจะไม่อัปเดต
 */
import "dotenv/config"
import crypto from "node:crypto"
import fs from "node:fs"
import sharp from "sharp"
import { prisma } from "../lib/prisma"
import { ensureContainer, uploadJpeg } from "../lib/blob"

async function main() {
    const [slug, file] = process.argv.slice(2)
    if (!slug || !file) throw new Error("ใช้: npm run cover -- <slug> <ไฟล์รูป | --clear>")
    const event = await prisma.event.findUnique({ where: { slug } })
    if (!event) throw new Error(`ไม่พบงาน ${slug}`)

    if (file === "--clear") {
        await prisma.event.update({ where: { id: event.id }, data: { coverKey: null } })
        console.log(`ล้างรูปปกของ ${slug} แล้ว`)
        return
    }

    const jpeg = await sharp(fs.readFileSync(file), { failOn: "none" })
        .rotate()
        .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer()
    const key = `${event.id}/cover-${crypto.createHash("sha256").update(jpeg).digest("hex").slice(0, 12)}.jpg`
    await ensureContainer()
    await uploadJpeg(key, jpeg)
    await prisma.event.update({ where: { id: event.id }, data: { coverKey: key } })
    console.log(`ตั้งรูปปกของ ${slug} แล้ว → ${key}`)
}

main()
    .catch((e) => {
        console.error(e instanceof Error ? e.message : e)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
