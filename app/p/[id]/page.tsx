import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getSharedPhoto } from "@/lib/search"

/**
 * หน้ารูปเดียวสำหรับแชร์ลิงก์ — แปะใน LINE / Facebook แล้วขึ้นภาพตัวอย่างเป็นรูปนั้น (พรีวิวมีลายน้ำ)
 * คนที่กดเข้ามาโหลดรูปเต็มได้ หรือไปหารูปของตัวเองในงานเดียวกันต่อ
 */
export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: PageProps<"/p/[id]">): Promise<Metadata> {
    const photo = await getSharedPhoto((await params).id)
    if (!photo) return { title: "ไม่พบรูป" }
    const title = `รูปจากงาน ${photo.event.name}`
    const description = `ดูรูปนี้และหารูปของคุณจาก ${photo.event.name} ด้วยเซลฟี่ — โหลดรูปเต็มได้ฟรี`
    return {
        title,
        description,
        openGraph: {
            type: "website",
            siteName: "RunLudtong Photo",
            locale: "th_TH",
            title,
            description,
            ...(photo.preview ? { images: [{ url: photo.preview, width: photo.width ?? undefined, height: photo.height ?? undefined }] } : {}),
        },
    }
}

export default async function SharedPhotoPage({ params }: PageProps<"/p/[id]">) {
    const photo = await getSharedPhoto((await params).id)
    if (!photo) notFound()

    return (
        <div className="bg-navy-deep text-white min-h-[calc(100svh-3.5rem)] flex flex-col">
            <div className="max-w-4xl w-full mx-auto px-4 pt-6 text-center">
                <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-white/60">
                    {photo.event.eventDate?.toLocaleDateString("th-TH", { dateStyle: "long", timeZone: "Asia/Bangkok" })}
                </p>
                <h1 className="display text-2xl sm:text-3xl mt-1">{photo.event.name}</h1>
            </div>
            <div className="flex-1 min-h-0 flex items-center justify-center p-4">
                {/* eslint-disable-next-line @next/next/no-img-element -- รูปพรีวิวมีลายน้ำจาก Blob */}
                {photo.preview && <img src={photo.preview} alt={`รูปจากงาน ${photo.event.name}`} className="max-w-full max-h-[70svh] object-contain rounded-2xl raise-lg" />}
            </div>
            <div className="max-w-md w-full mx-auto px-4 pb-8 flex flex-col gap-2">
                <a
                    href={`/api/photos/${photo.id}/download`}
                    className="h-12 rounded-2xl bg-white text-ink font-semibold inline-flex items-center justify-center hover:bg-white/90"
                >
                    ดาวน์โหลดรูปเต็ม
                </a>
                <Link
                    href={`/e/${photo.event.slug}`}
                    className="h-12 rounded-2xl bg-move text-ink font-bold inline-flex items-center justify-center hover:brightness-95"
                >
                    หารูปของคุณในงานนี้
                </Link>
            </div>
        </div>
    )
}
