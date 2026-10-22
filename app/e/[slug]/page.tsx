import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { publicUrl } from "@/lib/blob"
import { isFaceModelReady } from "@/lib/face"
import { isPhoneLookupConfigured, samplePhotos } from "@/lib/search"
import PhotoBrowser from "@/components/PhotoBrowser"

export const dynamic = "force-dynamic"

async function getEvent(slug: string) {
    const event = await prisma.event.findUnique({ where: { slug } })
    return event?.isPublished ? event : null
}

export async function generateMetadata({ params }: PageProps<"/e/[slug]">): Promise<Metadata> {
    const event = await getEvent((await params).slug)
    if (!event) return { title: "ไม่พบงาน" }
    const description = `หารูปตัวเองจาก ${event.name} ด้วยเซลฟี่ แล้วดาวน์โหลดรูปเต็มได้ฟรี`
    const cover = publicUrl(event.coverKey)
    return {
        title: `รูปงาน ${event.name}`,
        description,
        // openGraph ของหน้าลูกแทนที่ของ layout ทั้งก้อน — ใส่ค่าร่วมซ้ำ
        openGraph: {
            type: "website",
            siteName: "RunLudtong Photo",
            locale: "th_TH",
            title: `รูปงาน ${event.name}`,
            description,
            ...(cover ? { images: [{ url: cover, alt: event.name }] } : {}),
        },
    }
}

export default async function EventPage({ params }: PageProps<"/e/[slug]">) {
    const { slug } = await params
    const event = await getEvent(slug)
    if (!event) notFound()

    const { photos, total } = await samplePhotos(event.id)
    const hasFaces = event.faceSearchEnabled && isFaceModelReady() && (await prisma.photoFace.count({ where: { photo: { eventId: event.id } }, take: 1 })) > 0
    const cover = publicUrl(event.coverKey)

    return (
        <>
            {/* แถบหัวงาน — รูปปกจางๆ บนพื้นกรมท่า ช่องค้นหาลอยทับขอบล่าง */}
            <section className="relative bg-navy-deep text-white overflow-hidden">
                {cover && (
                    // eslint-disable-next-line @next/next/no-img-element -- รูปปกจาก Blob
                    <img src={cover} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25 blur-[2px] scale-105" />
                )}
                <div className="absolute inset-0 bg-gradient-to-b from-navy-deep/40 via-navy-deep/70 to-navy-deep" />
                <div className="relative max-w-3xl mx-auto px-4 pt-10 pb-24 sm:pt-14 sm:pb-28 text-center">
                    <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-white/60">
                        {event.eventDate?.toLocaleDateString("th-TH", { dateStyle: "long", timeZone: "Asia/Bangkok" })}
                        {event.organizer && ` · ${event.organizer}`}
                    </p>
                    <h1 className="display text-3xl sm:text-5xl mt-2">{event.name}</h1>
                    <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 h-7 text-xs tnum text-white/80">
                        <span className="w-1.5 h-1.5 rounded-full bg-move" />
                        {total.toLocaleString("th-TH")} รูป · โหลดฟรี
                    </p>
                </div>
            </section>

            <div className="max-w-6xl mx-auto px-4 pb-12">
                <PhotoBrowser
                    slug={event.slug}
                    eventName={event.name}
                    photos={photos}
                    faceEnabled={hasFaces}
                    facesPurgeAt={event.purgeFacesAt?.toLocaleDateString("th-TH", { dateStyle: "long", timeZone: "Asia/Bangkok" }) ?? null}
                    bibEnabled={event.bibOcrEnabled}
                    phoneEnabled={isPhoneLookupConfigured()}
                />
            </div>
        </>
    )
}
