import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { publicUrl } from "@/lib/blob"
import PhotoOrbit from "@/components/PhotoOrbit"

export const dynamic = "force-dynamic"

const RING_SIZE = 24

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

    // รูปเคลื่อนไหวหน้าแรก: ใช้ชุดที่ทำไว้ (npm run hero — ชัด ไม่มีลายน้ำ ชุดเดิมทุกครั้งจึง cache ได้)
    // ถ้ายังไม่ได้ทำ สุ่มรูปย่อที่เห็นหน้าชัดจากงานล่าสุดแทน
    const heroKeys = Array.isArray(latest?.heroKeys) ? (latest.heroKeys as string[]) : null
    const ring = heroKeys
        ? heroKeys.map((thumbKey) => ({ thumbKey }))
        : latest
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
            {/* section 1: รูปเคลื่อนไหวเต็มจอ — navbar ซ่อนอยู่จนกว่าจะเลื่อนลง (components/SiteHeader.tsx) */}
            <section className="hero-dots text-white overflow-hidden h-svh min-h-[420px] flex flex-col relative">
                <div className="flex-1 min-h-0 relative">
                    {ringUrls.length >= 8 && (
                        <PhotoOrbit urls={ringUrls}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- โลโก้สีขาวของเว็บสมัคร */}
                            <img src="/runludtong-logo-white.svg" alt="" width={490} height={440} className="h-14 sm:h-20 w-auto mx-auto" />
                            <h1 className="hero-wordmark hero-wordmark--light mt-4">RUNLUDTONG</h1>
                            <p className="mt-3 text-[11px] sm:text-sm font-semibold tracking-[0.22em] uppercase text-white/70">
                                Photo{latest && ` · ${latest.name}`}
                                {latest?.eventDate && ` · ${latest.eventDate.toLocaleDateString("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" })}`}
                            </p>
                        </PhotoOrbit>
                    )}
                </div>
                <a href="#search" aria-label="เลื่อนลงเพื่อค้นหารูป" className="mx-auto mb-4 p-2 text-white/50 hover:text-white">
                    <svg className="scroll-cue" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m6 9 6 6 6-6" />
                    </svg>
                </a>
            </section>

            {/* section 2: ค้นหารูป */}
            <section id="search" className="max-w-6xl mx-auto px-4 pt-14 pb-12 text-center scroll-mt-14">
                <h2 className="display text-3xl sm:text-5xl text-ink">
                    หารูปตัวเองจากงานวิ่ง
                    <br />
                    ด้วยเซลฟี่รูปเดียว
                </h2>
                {latest && (
                    <div className="mt-7 flex flex-col items-center gap-2">
                        <Link
                            href={`/e/${latest.slug}`}
                            className="h-14 px-8 inline-flex items-center gap-2.5 rounded-2xl bg-move text-ink text-lg font-bold hover:brightness-95 active:scale-[0.98] transition raise"
                        >
                            <CameraIcon />
                            ค้นหารูป
                        </Link>
                        <span className="text-xs text-ink-mute tnum">
                            {latest.name} · {latest._count.photos.toLocaleString("th-TH")} รูป
                        </span>
                    </div>
                )}
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
                            const cover = publicUrl(e.coverKey ?? e.photos[0]?.thumbKey ?? null)
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
