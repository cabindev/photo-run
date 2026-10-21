import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { publicUrl } from "@/lib/blob"

export const dynamic = "force-dynamic"

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

    return (
        <div className="max-w-6xl mx-auto px-4 py-8">
            <p className="eyebrow">ค้นหารูปงานวิ่ง</p>
            <h1 className="display text-3xl mt-1 mb-6">เลือกงานที่คุณไปวิ่ง</h1>

            {events.length === 0 ? (
                <p className="text-ink-mute">ยังไม่มีงานที่เปิดให้ค้นรูป</p>
            ) : (
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {events.map((e) => {
                        const cover = publicUrl(e.photos[0]?.thumbKey ?? null)
                        return (
                            <li key={e.id}>
                                <Link href={`/e/${e.slug}`} className="block bg-paper rounded-2xl overflow-hidden raise hover:raise-lg transition-shadow">
                                    <div className="aspect-[3/2] bg-paper-3">
                                        {/* eslint-disable-next-line @next/next/no-img-element -- รูปย่อจาก Blob ย่อมาแล้ว ไม่ต้องผ่าน next/image */}
                                        {cover && <img src={cover} alt="" className="w-full h-full object-cover" loading="lazy" />}
                                    </div>
                                    <div className="p-4">
                                        <p className="font-semibold">{e.name}</p>
                                        <p className="text-sm text-ink-mute mt-0.5 tnum">
                                            {e.eventDate && e.eventDate.toLocaleDateString("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" })}
                                            {e.eventDate && " · "}
                                            {e._count.photos.toLocaleString("th-TH")} รูป
                                        </p>
                                    </div>
                                </Link>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}
