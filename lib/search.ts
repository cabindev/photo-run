import { prisma } from "@/lib/prisma"
import { publicUrl } from "@/lib/blob"
import { normalizeBib } from "@/lib/bib"
import { bytesToEmbedding, EMBEDDING_DIM, embedFaces, MATCH_THRESHOLD } from "@/lib/face"

export type PhotoCard = {
    id: string
    thumb: string | null
    preview: string | null
    width: number | null
    height: number | null
}

const select = { id: true, thumbKey: true, previewKey: true, width: true, height: true } as const

function toCard(p: { id: string; thumbKey: string | null; previewKey: string | null; width: number | null; height: number | null }): PhotoCard {
    return { id: p.id, thumb: publicUrl(p.thumbKey), preview: publicUrl(p.previewKey), width: p.width, height: p.height }
}

export async function listPhotos(eventId: string, page: number, perPage = 60): Promise<{ photos: PhotoCard[]; total: number }> {
    const where = { eventId, status: "PROCESSED" as const }
    const [rows, total] = await Promise.all([
        prisma.photo.findMany({
            where,
            select,
            orderBy: [{ takenAt: "asc" }, { filename: "asc" }],
            skip: (page - 1) * perPage,
            take: perPage,
        }),
        prisma.photo.count({ where }),
    ])
    return { photos: rows.map(toCard), total }
}

export async function searchByBibs(eventId: string, bibs: string[]): Promise<PhotoCard[]> {
    const normalized = [...new Set(bibs.map(normalizeBib).filter(Boolean))]
    if (!normalized.length) return []
    const rows = await prisma.photo.findMany({
        where: { eventId, status: "PROCESSED", bibs: { some: { bib: { in: normalized } } } },
        select,
        orderBy: [{ takenAt: "asc" }, { filename: "asc" }],
        take: 500,
    })
    return rows.map(toCard)
}

/**
 * เวกเตอร์ใบหน้าทั้งงานในหน่วยความจำ (งาน 15,000 รูป ≈ 40,000 หน้า ≈ 20MB) — เทียบเซลฟี่ทีละหน้าเร็วพอ
 * โหลดใหม่เมื่อจำนวนหน้าเปลี่ยน (ซิงก์เพิ่ม/ลบใบหน้า) หรือครบ 10 นาที
 */
type FaceIndex = { photoIds: string[]; vectors: Float32Array; count: number; loadedAt: number }
const indexes = new Map<string, FaceIndex>()

async function getFaceIndex(eventId: string): Promise<FaceIndex> {
    const where = { photo: { eventId, status: "PROCESSED" as const } }
    const count = await prisma.photoFace.count({ where })
    const cached = indexes.get(eventId)
    if (cached && cached.count === count && Date.now() - cached.loadedAt < 10 * 60_000) return cached

    const rows = await prisma.photoFace.findMany({ where, select: { photoId: true, embedding: true } })
    const vectors = new Float32Array(rows.length * EMBEDDING_DIM)
    rows.forEach((r, i) => vectors.set(bytesToEmbedding(r.embedding), i * EMBEDDING_DIM))
    const index = { photoIds: rows.map((r) => r.photoId), vectors, count, loadedAt: Date.now() }
    indexes.set(eventId, index)
    return index
}

/** ค้นด้วยเซลฟี่ — ใช้หน้าที่ใหญ่ที่สุดในเซลฟี่, เรียงจากคล้ายมากไปน้อย, รูปเดียวมีหลายหน้าที่ตรงนับครั้งเดียว */
export async function searchByFace(eventId: string, selfie: Buffer): Promise<PhotoCard[] | null> {
    const faces = await embedFaces(selfie)
    if (!faces.length) return null
    const query = faces.reduce((a, b) => (b.box.width * b.box.height > a.box.width * a.box.height ? b : a)).embedding

    const index = await getFaceIndex(eventId)
    const best = new Map<string, number>()
    for (let i = 0; i < index.photoIds.length; i++) {
        let sim = 0
        const off = i * EMBEDDING_DIM
        for (let k = 0; k < EMBEDDING_DIM; k++) sim += query[k] * index.vectors[off + k]
        if (sim < MATCH_THRESHOLD) continue
        const id = index.photoIds[i]
        if (sim > (best.get(id) ?? -1)) best.set(id, sim)
    }
    const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 500)
    if (!ranked.length) return []

    const rows = await prisma.photo.findMany({ where: { id: { in: ranked.map(([id]) => id) } }, select })
    const byId = new Map(rows.map((r) => [r.id, r]))
    return ranked.flatMap(([id]) => (byId.has(id) ? [toCard(byId.get(id)!)] : []))
}

/**
 * แปลงเบอร์โทร → เลข BIB ผ่าน API ของเว็บสมัคร (ระบบนี้ไม่เข้าฐานข้อมูลผู้สมัครตรงๆ)
 *
 * สัญญา API (ต้องเพิ่มฝั่ง runludtong):
 *   POST RUNLUDTONG_LOOKUP_URL
 *   Authorization: Bearer RUNLUDTONG_LOOKUP_SECRET
 *   { "phone": "0812345678", "event": "<slug ของงานในระบบรูป>" }
 *   → { "bibs": ["M-060", "F-156"] }
 */
export function isPhoneLookupConfigured(): boolean {
    return Boolean(process.env.RUNLUDTONG_LOOKUP_URL && process.env.RUNLUDTONG_LOOKUP_SECRET)
}

export async function lookupBibsByPhone(phone: string, eventSlug: string): Promise<string[]> {
    if (!isPhoneLookupConfigured()) return []
    const digits = phone.replace(/\D/g, "")
    if (digits.length < 9) return []
    const res = await fetch(process.env.RUNLUDTONG_LOOKUP_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RUNLUDTONG_LOOKUP_SECRET}` },
        body: JSON.stringify({ phone: digits, event: eventSlug }),
        cache: "no-store",
    })
    if (!res.ok) throw new Error(`ค้นเบอร์โทรไม่สำเร็จ (${res.status})`)
    const j = (await res.json()) as { bibs?: string[] }
    return j.bibs ?? []
}
