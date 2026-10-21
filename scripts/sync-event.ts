/**
 * ซิงก์รูปของงานจาก Google Drive แล้วประมวลผลทั้งหมด
 *
 *   npm run sync -- <slug>            ซิงก์งานเดียว
 *   npm run sync -- --all             ซิงก์ทุกงานที่เผยแพร่อยู่
 *   npm run sync -- <slug> --purge-faces   ลบข้อมูลใบหน้าของงาน (PDPA)
 *
 * รันซ้ำได้ — รูปที่ทำแล้วจะข้าม
 */
import "dotenv/config"
import { prisma } from "../lib/prisma"
import { syncEvent, purgeFaces } from "../lib/pipeline"

async function main() {
    const args = process.argv.slice(2)
    const slug = args.find((a) => !a.startsWith("--"))

    if (args.includes("--all")) {
        const events = await prisma.event.findMany({ where: { isPublished: true }, orderBy: { createdAt: "asc" } })
        for (const e of events) {
            console.log(`\n=== ${e.slug} ===`)
            await syncEvent(e.id)
        }
        return
    }

    if (!slug) {
        console.error("ระบุ slug ของงาน หรือ --all")
        process.exit(1)
    }
    const event = await prisma.event.findUnique({ where: { slug } })
    if (!event) {
        console.error(`ไม่พบงาน ${slug}`)
        process.exit(1)
    }

    if (args.includes("--purge-faces")) {
        await purgeFaces(event.id)
        console.log(`ลบข้อมูลใบหน้าของ ${slug} แล้ว`)
        return
    }

    await syncEvent(event.id)
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
