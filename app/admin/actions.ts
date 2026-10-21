"use server"

import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { deleteEventData, purgeFaces, syncEvent } from "@/lib/pipeline"

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

// รับได้ทั้งลิงก์โฟลเดอร์เต็ม (https://drive.google.com/drive/folders/<id>?...) และ id เปล่าๆ
function parseFolderId(input: string): string {
    const m = input.match(/folders\/([A-Za-z0-9_-]{10,})/)
    return m ? m[1] : input.trim()
}

const eventSchema = z.object({
    name: z.string().trim().min(1, "กรอกชื่องาน").max(191),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,60}$/, "slug ใช้ได้เฉพาะ a-z 0-9 และ - (2–60 ตัว)"),
    eventDate: z.string().optional(),
    organizer: z.string().trim().max(191).optional(),
    driveFolder: z.string().trim().min(10, "วางลิงก์โฟลเดอร์ Google Drive"),
    bibPattern: z.string().trim().max(191).optional(),
    // checkbox ส่ง "on" เมื่อติ๊ก ไม่ติ๊กไม่ส่งเลย
    bibOcr: z.literal("on").optional(),
})

export async function createEvent(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
    await requireAdmin()
    const parsed = eventSchema.safeParse(Object.fromEntries(formData))
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
    const d = parsed.data

    if (d.bibPattern) {
        try {
            new RegExp(d.bibPattern)
        } catch {
            return { ok: false, error: "รูปแบบ BIB (regex) ไม่ถูกต้อง" }
        }
    }
    if (await prisma.event.findUnique({ where: { slug: d.slug } })) return { ok: false, error: "slug นี้มีแล้ว" }

    await prisma.event.create({
        data: {
            name: d.name,
            slug: d.slug,
            // วันที่งานเก็บเป็นเที่ยงคืนเวลาไทย
            eventDate: d.eventDate ? new Date(`${d.eventDate}T00:00:00+07:00`) : null,
            organizer: d.organizer || null,
            driveFolderId: parseFolderId(d.driveFolder),
            bibPattern: d.bibPattern || null,
            bibOcrEnabled: d.bibOcr === "on",
        },
    })
    revalidatePath("/admin")
    return { ok: true, message: "สร้างงานแล้ว กด “ซิงก์รูป” เพื่อดึงรูปจาก Drive" }
}

export async function togglePublish(eventId: string): Promise<void> {
    await requireAdmin()
    const e = await prisma.event.findUniqueOrThrow({ where: { id: eventId } })
    await prisma.event.update({ where: { id: eventId }, data: { isPublished: !e.isPublished } })
    revalidatePath("/admin")
    revalidatePath("/")
}

// กันกดซิงก์ซ้อนกันในโปรเซสเดียว — งานใหญ่ใช้เวลาหลายนาที
const running = new Set<string>()

/**
 * เริ่มซิงก์เบื้องหลังหลังตอบกลับ (after) — ใช้ได้เมื่อรันแบบ next start บนเซิร์ฟเวอร์ที่เปิดค้างไว้
 * ถ้า deploy แบบ serverless ให้ใช้ `npm run sync -- <slug>` หรือ worker แทน (ฟังก์ชันจะถูกตัดก่อนเสร็จ)
 */
export async function startSync(eventId: string): Promise<ActionResult> {
    await requireAdmin()
    if (running.has(eventId)) return { ok: false, error: "กำลังซิงก์งานนี้อยู่" }
    running.add(eventId)
    after(async () => {
        try {
            await syncEvent(eventId, (m) => console.log(`[sync ${eventId}] ${m}`))
        } catch (e) {
            console.error(`[sync ${eventId}]`, e)
        } finally {
            running.delete(eventId)
        }
    })
    return { ok: true, message: "เริ่มซิงก์แล้ว รีเฟรชหน้านี้เพื่อดูความคืบหน้า" }
}

export async function purgeEventFaces(eventId: string): Promise<ActionResult> {
    await requireAdmin()
    await purgeFaces(eventId)
    revalidatePath("/admin")
    return { ok: true, message: "ลบข้อมูลใบหน้าของงานแล้ว (รูปและ BIB ยังอยู่)" }
}

export async function deleteEvent(eventId: string): Promise<ActionResult> {
    await requireAdmin()
    await deleteEventData(eventId)
    revalidatePath("/admin")
    revalidatePath("/")
    return { ok: true }
}
