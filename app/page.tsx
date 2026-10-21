import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { publicUrl } from "@/lib/blob"
import PhotoRing from "@/components/PhotoRing"

export const dynamic = "force-dynamic"

const RING_SIZE = 16

export default async function Home() {
    const events = await prisma.event.findMany({
        where: { isPublished: true },
        orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
        include: {
            _count: { select: { photos: { where: { status: "PROCESSED" } } } },
            // รูปแรกของงานเป็นปก
            photos: { where: { status: "PROCESSED" }, orderBy: { takenAt: "asc" }, take: 1, select: { thumbKey: true } },
        },
    })
    const latest = events[0]

    // วงแหวนหน้าแรก: สุ่มรูปที่เห็นหน้าชัดจากงานล่าสุด — สุ่มใหม่ทุกครั้งที่เปิด
    const ring = latest
        ? await prisma.$queryRaw<{ thumbKey: string }[]>`
            SELECT p.thumbKey FROM Photo p
            WHERE p.eventId = ${latest.id} AND p.status = 'PROCESSED' AND p.thumbKey IS NOT NULL
              AND EXISTS (SELECT 1 FROM PhotoFace f WHERE f.photoId = p.id AND f.score >= 0.9)
            ORDER BY RAND() LIMIT ${RING_SIZE}`
        : []
    const ringUrls = ring.map((r) => publicUrl(r.thumbKey)).filter((u): u is string => Boolean(u))
    const totalPhotos = events.reduce((n, e) => n + e._count.photos, 0)

    return (
        <>
            {/* hero เต็มจอ (ลบความสูง header 3.5rem) — เลื่อนลงไปค้นหารูปที่ #search */}
            <section className="hero-dots bg-ink text-white overflow-hidden min-h-[calc(100svh-3.5rem)] flex flex-col">
                <div className="max-w-6xl w-full mx-auto px-4 pt-8 sm:pt-12 text-center">
                    <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-white/60">RunPhoto · รันลัดโต้ง</p>
                    <h1 className="display text-3xl sm:text-5xl mt-3">
                        หารูปตัวเองจากงานวิ่ง
                        <br />
                        <span className="text-move">ด้วยเซลฟี่รูปเดียว</span>
                    </h1>
                    <p className="text-white/70 mt-4 max-w-md mx-auto text-[15px]">
                        ไม่ต้องไล่ดูทีละรูปอีกต่อไป — ถ่ายเซลฟี่ ระบบหารูปที่มีคุณให้ แล้วดาวน์โหลดรูปเต็มได้ฟรี
                    </p>
                    {latest && (
                        <div className="mt-7 flex flex-col items-center gap-2">
                            <a
                                href="#search"
                                className="h-14 px-8 inline-flex items-center gap-2.5 rounded-2xl bg-move text-ink text-lg font-bold hover:brightness-95 active:scale-[0.98] transition"
                            >
                                <CameraIcon />
                                ค้นหารูป
                            </a>
                            <span className="text-xs text-white/50 tnum">
                                {totalPhotos.toLocaleString("th-TH")} รูปจาก {events.length.toLocaleString("th-TH")} งาน
                            </span>
                        </div>
                    )}
                </div>
                <div className="flex-1 flex items-center justify-center min-h-0">
                    {ringUrls.length >= 8 && <PhotoRing urls={ringUrls} />}
                </div>
                <a href="#search" className="mx-auto mb-5 flex flex-col items-center gap-1 text-xs text-white/60 hover:text-white">
                    เลื่อนลงเพื่อค้นหารูป
                    <svg className="scroll-cue" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m6 9 6 6 6-6" />
                    </svg>
                </a>
            </section>

            <section id="search" className="max-w-6xl mx-auto px-4 py-12 scroll-mt-4">
                <ol className="grid gap-3 sm:grid-cols-3">
                    {[
                        ["1", "ถ่ายเซลฟี่", "หน้าตรง เห็นหน้าชัด ไม่ใส่แว่นดำ"],
                        ["2", "ระบบหาให้", "เทียบใบหน้ากับทุกรูปของงานในไม่กี่วินาที"],
                        ["3", "โหลดฟรี", "ดูรูปทั้งหมดของคุณ แล้วโหลดไฟล์ต้นฉบับ"],
                    ].map(([n, title, desc]) => (
                        <li key={n} className="bg-paper rounded-2xl raise p-5 flex gap-4 items-start">
                            <span className="numeral text-2xl w-10 h-10 shrink-0 rounded-xl bg-move inline-flex items-center justify-center">{n}</span>
                            <div>
                                <p className="font-semibold">{title}</p>
                                <p className="text-sm text-ink-mute mt-0.5">{desc}</p>
                            </div>
                        </li>
                    ))}
                </ol>
            </section>

            <section className="max-w-6xl mx-auto px-4 pb-12">
                <div className="flex items-end justify-between gap-4 mb-4">
                    <div>
                        <p className="eyebrow">งานวิ่งทั้งหมด</p>
                        <h2 className="display text-2xl mt-1">เลือกงานที่คุณไปวิ่ง</h2>
                    </div>
                    {totalPhotos > 0 && <p className="text-sm text-ink-mute tnum">{totalPhotos.toLocaleString("th-TH")} รูป</p>}
                </div>

                {events.length === 0 ? (
                    <p className="text-ink-mute">ยังไม่มีงานที่เปิดให้ค้นรูป</p>
                ) : (
                    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {events.map((e) => {
                            const cover = publicUrl(e.photos[0]?.thumbKey ?? null)
                            return (
                                <li key={e.id} className="bg-paper rounded-2xl overflow-hidden raise flex flex-col">
                                    <div className="aspect-[3/2] bg-paper-3">
                                        {/* eslint-disable-next-line @next/next/no-img-element -- รูปย่อจาก Blob ย่อมาแล้ว ไม่ต้องผ่าน next/image */}
                                        {cover && <img src={cover} alt="" className="w-full h-full object-cover" loading="lazy" />}
                                    </div>
                                    <div className="p-4 flex items-center justify-between gap-3 flex-1">
                                        <div className="min-w-0">
                                            <p className="font-semibold truncate">{e.name}</p>
                                            <p className="text-sm text-ink-mute mt-0.5 tnum">
                                                {e.eventDate && e.eventDate.toLocaleDateString("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" })}
                                                {e.eventDate && " · "}
                                                {e._count.photos.toLocaleString("th-TH")} รูป
                                            </p>
                                        </div>
                                        <Link
                                            href={`/e/${e.slug}`}
                                            className="h-10 px-4 shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-move text-ink text-sm font-semibold hover:brightness-95"
                                        >
                                            <CameraIcon small />
                                            ค้นหารูป
                                        </Link>
                                    </div>
                                </li>
                            )
                        })}
                    </ul>
                )}
            </section>
        </>
    )
}

function CameraIcon({ small }: { small?: boolean }) {
    const s = small ? 16 : 22
    return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
            <circle cx="12" cy="13" r="3.5" />
        </svg>
    )
}
