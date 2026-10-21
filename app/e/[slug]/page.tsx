import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { isFaceModelReady } from "@/lib/face"
import { isPhoneLookupConfigured, listPhotos } from "@/lib/search"
import PhotoBrowser from "@/components/PhotoBrowser"

export const dynamic = "force-dynamic"

const PER_PAGE = 60

async function getEvent(slug: string) {
    const event = await prisma.event.findUnique({ where: { slug } })
    return event?.isPublished ? event : null
}

export async function generateMetadata({ params }: PageProps<"/e/[slug]">): Promise<Metadata> {
    const event = await getEvent((await params).slug)
    return { title: event?.name ?? "ไม่พบงาน" }
}

export default async function EventPage({ params, searchParams }: PageProps<"/e/[slug]">) {
    const { slug } = await params
    const event = await getEvent(slug)
    if (!event) notFound()

    const page = Math.max(1, Number((await searchParams).page) || 1)
    const { photos, total } = await listPhotos(event.id, page, PER_PAGE)
    const pages = Math.max(1, Math.ceil(total / PER_PAGE))
    const hasFaces = event.faceSearchEnabled && isFaceModelReady() && (await prisma.photoFace.count({ where: { photo: { eventId: event.id } }, take: 1 })) > 0

    return (
        <div className="max-w-6xl mx-auto px-4 py-6">
            <p className="eyebrow">
                {event.eventDate?.toLocaleDateString("th-TH", { dateStyle: "long", timeZone: "Asia/Bangkok" })}
                {event.organizer && ` · ${event.organizer}`}
            </p>
            <h1 className="display text-2xl sm:text-3xl mt-1">{event.name}</h1>
            <p className="text-sm text-ink-mute mt-1 tnum">{total.toLocaleString("th-TH")} รูป</p>

            <PhotoBrowser
                slug={event.slug}
                photos={photos}
                faceEnabled={hasFaces}
                bibEnabled={event.bibOcrEnabled}
                phoneEnabled={isPhoneLookupConfigured()}
                pagination={
                    pages > 1 && (
                        <nav className="flex items-center justify-center gap-2 mt-8 text-sm tnum">
                            {page > 1 && <Link href={`?page=${page - 1}`} className="px-3 h-9 inline-flex items-center rounded-lg bg-paper border border-line">ก่อนหน้า</Link>}
                            <span className="text-ink-mute px-2">หน้า {page} / {pages}</span>
                            {page < pages && <Link href={`?page=${page + 1}`} className="px-3 h-9 inline-flex items-center rounded-lg bg-paper border border-line">ถัดไป</Link>}
                        </nav>
                    )
                }
            />
        </div>
    )
}
