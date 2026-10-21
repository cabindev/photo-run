import type { Event, Photo } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { listImagesRecursive, downloadFile } from "@/lib/drive"
import { ensureContainer, uploadJpeg, deletePrefix } from "@/lib/blob"
import { makeVariants } from "@/lib/images"
import { extractBibs } from "@/lib/bib"
import { isVisionConfigured, readTextLines } from "@/lib/azure"
import { embedFaces, embeddingToBytes, isFaceModelReady } from "@/lib/face"

/**
 * ซิงก์รูปของงานหนึ่งงาน: Drive → ย่อรูป/ลายน้ำ → Blob → OCR หา BIB → เก็บเวกเตอร์ใบหน้า
 *
 * ทำซ้ำได้ปลอดภัย (idempotent): รูปที่ PROCESSED แล้วข้าม, FAILED ลองใหม่ไม่เกิน MAX_ATTEMPTS
 * รันนาน (หลายพันรูป) — เรียกจาก scripts/sync-event.ts หรือ worker ไม่ใช่จาก request ของเว็บ
 */
const MAX_ATTEMPTS = 3
// คอขวดคือดาวน์โหลดจาก Drive — Vision S0 รับได้ ~10 ครั้ง/วินาที (F0 แค่ 20 ครั้ง/นาที ควรลดเหลือ 2–4)
const CONCURRENCY = Number(process.env.SYNC_CONCURRENCY) || 10

type Log = (msg: string) => void

export async function syncEvent(eventId: string, log: Log = console.log): Promise<void> {
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } })

    // 1) ไล่รายการรูปใน Drive → เพิ่มแถว PENDING สำหรับรูปใหม่
    log(`ไล่รูปใน Drive โฟลเดอร์ ${event.driveFolderId} ...`)
    const files = await listImagesRecursive(event.driveFolderId)
    const created = await prisma.photo.createMany({
        data: files.map((f) => ({
            eventId: event.id,
            driveFileId: f.id,
            filename: f.name,
            folderName: f.folderName,
            takenAt: f.takenAt,
            width: f.width,
            height: f.height,
        })),
        skipDuplicates: true,
    })
    log(`เจอ ${files.length} รูปใน Drive (ใหม่ ${created.count})`)

    // 2) เตรียมที่เก็บ
    await ensureContainer()
    const useFace = event.faceSearchEnabled && isFaceModelReady()
    const useOcr = event.bibOcrEnabled && isVisionConfigured()
    if (!useFace) log("ข้ามการเก็บใบหน้า (ปิดไว้ หรือยังไม่มีไฟล์โมเดล — รัน npm run models)")
    if (!useOcr) log("ข้ามการอ่าน BIB (ปิดไว้ หรือยังไม่ได้ตั้ง AZURE_VISION_*)")

    // 3) ประมวลผลรูปที่ค้างทีละชุด
    const pending = await prisma.photo.findMany({
        where: { eventId: event.id, OR: [{ status: "PENDING" }, { status: "FAILED", attempts: { lt: MAX_ATTEMPTS } }] },
        orderBy: { createdAt: "asc" },
    })
    log(`ต้องประมวลผล ${pending.length} รูป`)

    const r = await runPool(pending, log, (photo) => processPhoto(event, photo, { useFace, useOcr }), async (photo, e) => {
        await prisma.photo.update({
            where: { id: photo.id },
            data: { status: "FAILED", attempts: { increment: 1 }, error: String(e instanceof Error ? e.message : e).slice(0, 2000) },
        })
    })
    log(`ประมวลผลเสร็จ ${r.done} รูป, ผิดพลาด ${r.failed} รูป`)

    // 4) รูปที่ประมวลผลไปแล้วแต่ยังไม่ได้เก็บใบหน้า (ซิงก์ตอนยังปิดใบหน้า / เพิ่งเปิดใหม่) — ดึงต้นฉบับมาเก็บหน้าอย่างเดียว
    if (useFace) {
        const missing = await prisma.photo.findMany({ where: { eventId: event.id, status: "PROCESSED", facesIndexedAt: null } })
        if (missing.length) {
            log(`เก็บใบหน้าย้อนหลัง ${missing.length} รูป`)
            const f = await runPool(missing, log, async (photo) => {
                const original = await downloadFile(photo.driveFileId)
                await indexFaces(photo.id, original)
            })
            log(`เก็บใบหน้าเสร็จ ${f.done} รูป, ผิดพลาด ${f.failed} รูป`)
        }
    }

    await prisma.event.update({ where: { id: event.id }, data: { lastSyncedAt: new Date() } })
}

async function processPhoto(event: Event, photo: Photo, opts: { useFace: boolean; useOcr: boolean }): Promise<void> {
    const original = await downloadFile(photo.driveFileId)
    const v = await makeVariants(original, process.env.WATERMARK_TEXT || null)

    const thumbKey = `${event.id}/thumb/${photo.id}.jpg`
    const previewKey = `${event.id}/preview/${photo.id}.jpg`
    await Promise.all([uploadJpeg(thumbKey, v.thumb), uploadJpeg(previewKey, v.preview)])

    if (opts.useOcr) {
        const bibs = extractBibs(await readTextLines(v.analysis), event.bibPattern, event.eventDate)
        if (bibs.length) {
            await prisma.photoBib.createMany({ data: bibs.map((bib) => ({ photoId: photo.id, bib })), skipDuplicates: true })
        }
    }

    if (opts.useFace && !photo.facesIndexedAt) await indexFaces(photo.id, v.analysis)

    await prisma.photo.update({
        where: { id: photo.id },
        data: {
            status: "PROCESSED",
            thumbKey,
            previewKey,
            width: v.width || photo.width,
            height: v.height || photo.height,
            error: null,
            processedAt: new Date(),
        },
    })
}

/** หาหน้าทุกคนในรูปแล้วเก็บเวกเตอร์ — แทนที่ของเดิมทั้งหมดของรูปนี้ จึงรันซ้ำได้ไม่เกิดหน้าซ้ำ */
async function indexFaces(photoId: string, image: Buffer): Promise<void> {
    const faces = await embedFaces(image)
    await prisma.$transaction([
        prisma.photoFace.deleteMany({ where: { photoId } }),
        prisma.photoFace.createMany({
            data: faces.map((f) => ({ photoId, embedding: embeddingToBytes(f.embedding), score: f.score, box: f.box })),
        }),
        prisma.photo.update({ where: { id: photoId }, data: { facesIndexedAt: new Date() } }),
    ])
}

/** ทำงานกับรายการทีละ CONCURRENCY ชิ้นพร้อมกัน — ชิ้นที่ล้มไม่หยุดทั้งชุด */
async function runPool<T>(
    items: T[],
    log: Log,
    work: (item: T) => Promise<void>,
    onError?: (item: T, e: unknown) => Promise<void>,
): Promise<{ done: number; failed: number }> {
    let done = 0
    let failed = 0
    const queue = [...items]
    await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
            while (queue.length) {
                const item = queue.shift()!
                try {
                    await work(item)
                    done++
                } catch (e) {
                    failed++
                    if (onError) await onError(item, e)
                    else log(`  ผิดพลาด: ${e instanceof Error ? e.message : e}`)
                }
                if ((done + failed) % 25 === 0) log(`  ${done + failed}/${items.length} (ผิดพลาด ${failed})`)
            }
        }),
    )
    return { done, failed }
}

/**
 * ลบข้อมูลใบหน้าทั้งหมดของงาน (PDPA) และปิดค้นด้วยใบหน้า
 * รูปและ BIB ยังอยู่ ค้นด้วย BIB/เบอร์โทรได้ต่อ
 */
export async function purgeFaces(eventId: string): Promise<void> {
    await prisma.$transaction([
        prisma.photoFace.deleteMany({ where: { photo: { eventId } } }),
        prisma.photo.updateMany({ where: { eventId }, data: { facesIndexedAt: null } }),
        prisma.event.update({ where: { id: eventId }, data: { faceSearchEnabled: false } }),
    ])
}

/** ลบงานทั้งงาน: ใบหน้า + รูปใน Blob + แถวในฐานข้อมูล (ต้นฉบับใน Drive ไม่แตะ) */
export async function deleteEventData(eventId: string): Promise<void> {
    await purgeFaces(eventId)
    await deletePrefix(`${eventId}/`)
    await prisma.event.delete({ where: { id: eventId } })
}
