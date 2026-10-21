import Link from "next/link"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/auth"
import { isVisionConfigured } from "@/lib/azure"
import { isFaceModelReady } from "@/lib/face"
import { isPhoneLookupConfigured } from "@/lib/search"
import CreateEventForm from "@/components/admin/CreateEventForm"
import EventActions from "@/components/admin/EventActions"

export const dynamic = "force-dynamic"
export const metadata = { title: "จัดการงาน" }

export default async function AdminPage() {
    // proxy.ts กันไว้แล้ว — ตรวจซ้ำเผื่อ matcher เปลี่ยน
    if (!(await isAdmin())) redirect("/login")

    const events = await prisma.event.findMany({ orderBy: { createdAt: "desc" } })
    const stats = await prisma.photo.groupBy({ by: ["eventId", "status"], _count: true })
    const faceCounts = await prisma.$queryRaw<{ eventId: string; n: bigint }[]>`
        SELECT p.eventId, COUNT(*) AS n FROM PhotoFace f JOIN Photo p ON p.id = f.photoId GROUP BY p.eventId`
    const bibCounts = await prisma.$queryRaw<{ eventId: string; n: bigint }[]>`
        SELECT p.eventId, COUNT(DISTINCT p.id) AS n FROM PhotoBib b JOIN Photo p ON p.id = b.photoId GROUP BY p.eventId`

    const count = (eventId: string, status: string) => stats.find((s) => s.eventId === eventId && s.status === status)?._count ?? 0
    const num = (rows: { eventId: string; n: bigint }[], eventId: string) => Number(rows.find((r) => r.eventId === eventId)?.n ?? 0)

    const services = [
        { label: "Google Drive", ok: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) },
        { label: "Azure Blob", ok: Boolean(process.env.AZURE_STORAGE_CONNECTION_STRING && process.env.BLOB_PUBLIC_BASE_URL) },
        { label: "โมเดลใบหน้า", ok: isFaceModelReady() },
        { label: "Azure Vision (BIB)", ok: isVisionConfigured() },
        { label: "ค้นด้วยเบอร์โทร", ok: isPhoneLookupConfigured() },
    ]

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
            <div>
                <p className="eyebrow">ผู้ดูแลระบบ</p>
                <h1 className="display text-3xl mt-1">จัดการงาน</h1>
                <ul className="flex flex-wrap gap-2 mt-3 text-xs">
                    {services.map((s) => (
                        <li key={s.label} className={`px-2.5 h-7 inline-flex items-center rounded-full border ${s.ok ? "border-lime text-lime" : "border-line text-ink-mute"}`}>
                            {s.ok ? "✓" : "–"} {s.label}
                        </li>
                    ))}
                </ul>
            </div>

            <section className="bg-paper rounded-2xl raise p-5">
                <h2 className="font-semibold mb-4">สร้างงานใหม่</h2>
                <CreateEventForm />
            </section>

            <section className="space-y-3">
                {events.length === 0 && <p className="text-ink-mute">ยังไม่มีงาน</p>}
                {events.map((e) => {
                    const processed = count(e.id, "PROCESSED")
                    const pending = count(e.id, "PENDING")
                    const failed = count(e.id, "FAILED")
                    return (
                        <article key={e.id} className="bg-paper rounded-2xl raise p-5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <p className="font-semibold">
                                        {e.name}{" "}
                                        <span className={`text-xs ml-1 px-2 py-0.5 rounded-full ${e.isPublished ? "bg-move" : "bg-paper-3 text-ink-mute"}`}>
                                            {e.isPublished ? "เผยแพร่" : "ซ่อน"}
                                        </span>
                                    </p>
                                    <p className="text-sm text-ink-mute mt-0.5">
                                        <Link href={`/e/${e.slug}`} className="underline">/e/{e.slug}</Link>
                                        {" · "}
                                        <a href={`https://drive.google.com/drive/folders/${e.driveFolderId}`} target="_blank" rel="noreferrer" className="underline">โฟลเดอร์ Drive</a>
                                        {e.lastSyncedAt && ` · ซิงก์ล่าสุด ${e.lastSyncedAt.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}`}
                                    </p>
                                </div>
                                <EventActions eventId={e.id} isPublished={e.isPublished} hasFaces={num(faceCounts, e.id) > 0} />
                            </div>
                            <dl className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-4 text-sm tnum">
                                <Stat label="พร้อมแสดง" value={processed} />
                                <Stat label="รอประมวลผล" value={pending} />
                                <Stat label="ผิดพลาด" value={failed} danger={failed > 0} />
                                <Stat label="ใบหน้า" value={num(faceCounts, e.id)} />
                                <Stat label="รูปที่อ่าน BIB ได้" value={num(bibCounts, e.id)} />
                                <Stat label="ค้นด้วยหน้า" value={e.faceSearchEnabled ? "เปิด" : "ปิด"} />
                            </dl>
                        </article>
                    )
                })}
            </section>
        </div>
    )
}

function Stat({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
    return (
        <div>
            <dt className="text-[11px] text-ink-mute">{label}</dt>
            <dd className={`font-semibold ${danger ? "text-danger" : ""}`}>{typeof value === "number" ? value.toLocaleString("th-TH") : value}</dd>
        </div>
    )
}
