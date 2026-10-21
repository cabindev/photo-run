/**
 * ทำรูปชุดเคลื่อนไหวหน้าแรก (components/PhotoOrbit.tsx) — คัดรูปที่เห็นหน้าชัด กระจายหลายโฟลเดอร์/ช่างภาพ
 * ดึงต้นฉบับจาก Drive ย่อเป็น ~1000px ไม่มีลายน้ำ แล้วเก็บไว้ที่ public/hero/<slug>/ ของเซิร์ฟเวอร์
 * (document root คือ public/ — เว็บเซิร์ฟเวอร์ส่งไฟล์ให้ตรงๆ) ใช้ชุดเดิมทุกครั้งจึง cache ได้
 * public/hero/ ไม่อยู่ใน git — repo เป็น public ไม่ควรมีรูปนักวิ่ง → ต้องรันคำสั่งนี้บนเซิร์ฟเวอร์เอง
 *
 *   npm run hero -- <slug>          สุ่มชุดใหม่ 24 รูป
 *   npm run hero -- <slug> --clear  กลับไปสุ่มจากรูปย่อทุกครั้งที่เปิดหน้า
 */
import "dotenv/config"
import fs from "node:fs"
import path from "node:path"
import sharp from "sharp"
import { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { downloadFile } from "../lib/drive"
import { deletePrefix } from "../lib/blob"

const COUNT = 24

async function main() {
    const [slug, flag] = process.argv.slice(2)
    if (!slug) throw new Error("ใช้: npm run hero -- <slug> [--clear]")
    const event = await prisma.event.findUnique({ where: { slug } })
    if (!event) throw new Error(`ไม่พบงาน ${slug}`)

    if (flag === "--clear") {
        await prisma.event.update({ where: { id: event.id }, data: { heroKeys: Prisma.DbNull } })
        console.log(`ล้างชุดรูปหน้าแรกของ ${slug} แล้ว`)
        return
    }

    // รูปที่มีหน้าชัด (คะแนนสูง + หน้าใหญ่พอ) — สุ่มมาเยอะแล้วคัดให้กระจายโฟลเดอร์
    const candidates = await prisma.$queryRaw<{ id: string; driveFileId: string; folderName: string | null }[]>`
        SELECT p.id, p.driveFileId, p.folderName FROM Photo p
        WHERE p.eventId = ${event.id} AND p.status = 'PROCESSED'
          AND EXISTS (SELECT 1 FROM PhotoFace f WHERE f.photoId = p.id AND f.score >= 0.93
                      AND JSON_EXTRACT(f.box, '$.width') >= 0.05)
        ORDER BY RAND() LIMIT 400`
    const byFolder = new Map<string, typeof candidates>()
    for (const c of candidates) {
        const k = c.folderName ?? ""
        byFolder.set(k, [...(byFolder.get(k) ?? []), c])
    }
    // วนหยิบทีละโฟลเดอร์ ให้ได้หลายจุดถ่าย/หลายช่างภาพ
    const picked: typeof candidates = []
    const queues = [...byFolder.values()]
    while (picked.length < COUNT && queues.some((q) => q.length)) {
        for (const q of queues) if (q.length && picked.length < COUNT) picked.push(q.shift()!)
    }
    if (picked.length < 8) throw new Error(`รูปที่เข้าเกณฑ์มีแค่ ${picked.length} รูป — ซิงก์ใบหน้าครบหรือยัง`)

    // ล้างชุดเก่าของงานนี้ก่อน
    const dir = path.join(process.cwd(), "public", "hero", slug)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const keys: string[] = []
    for (const [i, p] of picked.entries()) {
        const jpeg = await sharp(await downloadFile(p.driveFileId), { failOn: "none" })
            .rotate()
            .resize(1000, 1000, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 78, mozjpeg: true })
            .toBuffer()
        fs.writeFileSync(path.join(dir, `${p.id}.jpg`), jpeg)
        keys.push(`/hero/${slug}/${p.id}.jpg`)
        console.log(`  ${i + 1}/${picked.length} ${(jpeg.length / 1024).toFixed(0)}KB`)
    }
    await prisma.event.update({ where: { id: event.id }, data: { heroKeys: keys } })
    // ชุดเดิมที่เคยเก็บใน Blob (เวอร์ชันก่อน) ไม่ใช้แล้ว
    await deletePrefix(`${event.id}/hero/`)
    console.log(`ตั้งชุดรูปหน้าแรกของ ${slug} แล้ว ${keys.length} รูป`)
}

main()
    .catch((e) => {
        console.error(e instanceof Error ? e.message : e)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
