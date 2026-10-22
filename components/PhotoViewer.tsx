"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { PhotoCard } from "@/lib/search"
import { canShareFiles, fetchOriginal, isShareCancel, noSubscribe } from "@/lib/client-share"

/**
 * ดูรูปเต็มจอ — เลื่อนรูปก่อน/ถัดไป (ปุ่ม, ลูกศรคีย์บอร์ด, ปัดนิ้ว) + แชร์ + ดาวน์โหลด
 *
 * แชร์:
 *   - มือถือ: แชร์ไฟล์รูปต้นฉบับผ่านหน้าต่างแชร์ (LINE / Facebook / บันทึกรูปภาพ)
 *     share() ต้องเรียกตรงจากการกดปุ่ม (iOS) จึงโหลดไฟล์ล่วงหน้าตั้งแต่เปิดรูป
 *   - คอม: แชร์ลิงก์ /p/<id> (หน้าต่างแชร์ของระบบ ถ้าไม่มีก็คัดลอกลิงก์)
 */
export default function PhotoViewer({
    photos,
    index,
    eventName,
    onIndex,
    onClose,
}: {
    photos: PhotoCard[]
    index: number
    eventName: string
    onIndex: (i: number) => void
    onClose: () => void
}) {
    const photo = photos[index]
    const shareFiles = useSyncExternalStore(noSubscribe, canShareFiles, () => false)
    const [file, setFile] = useState<{ id: string; file: File } | null>(null)
    const [toast, setToast] = useState<string | null>(null)
    const touchX = useRef<number | null>(null)

    const go = (step: number) => onIndex((index + step + photos.length) % photos.length)

    // คีย์บอร์ด: ← → เลื่อน, Esc ปิด
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose()
            else if (e.key === "ArrowRight") onIndex((index + 1) % photos.length)
            else if (e.key === "ArrowLeft") onIndex((index - 1 + photos.length) % photos.length)
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [index, photos.length, onIndex, onClose])

    // มือถือ: โหลดต้นฉบับรอไว้ ให้ปุ่มแชร์เปิดหน้าต่างแชร์ได้ทันทีที่กด
    useEffect(() => {
        if (!shareFiles) return
        const ctrl = new AbortController()
        fetchOriginal(photo.id, ctrl.signal)
            .then((f) => setFile({ id: photo.id, file: f }))
            .catch(() => {})
        return () => ctrl.abort()
    }, [photo.id, shareFiles])

    const ready = file?.id === photo.id ? file.file : null
    const link = typeof window === "undefined" ? "" : `${window.location.origin}/p/${photo.id}`

    function flash(msg: string) {
        setToast(msg)
        setTimeout(() => setToast(null), 2200)
    }

    async function share() {
        try {
            if (shareFiles && ready) {
                await navigator.share({ files: [ready], title: `รูปงาน ${eventName}` })
            } else if (!shareFiles && typeof navigator.share === "function") {
                await navigator.share({ title: `รูปงาน ${eventName}`, url: link })
            } else {
                await navigator.clipboard.writeText(link)
                flash("คัดลอกลิงก์รูปแล้ว")
            }
        } catch (e) {
            if (!isShareCancel(e)) flash("แชร์ไม่สำเร็จ ลองดาวน์โหลดแทน")
        }
    }

    async function copyLink() {
        try {
            await navigator.clipboard.writeText(link)
            flash("คัดลอกลิงก์รูปแล้ว")
        } catch {
            flash("คัดลอกไม่สำเร็จ")
        }
    }

    const btn = "h-11 px-4 inline-flex items-center justify-center gap-2 rounded-2xl text-sm font-semibold transition active:scale-[0.97]"

    return (
        <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex flex-col" onClick={onClose} role="dialog" aria-modal="true">
            <div className="flex items-center justify-between p-3 text-white/70 text-xs tnum" onClick={(e) => e.stopPropagation()}>
                <span>
                    {index + 1} / {photos.length}
                </span>
                <button onClick={onClose} aria-label="ปิด" className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl">
                    ×
                </button>
            </div>

            <div
                className="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-16"
                onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
                onTouchEnd={(e) => {
                    if (touchX.current === null) return
                    const dx = e.changedTouches[0].clientX - touchX.current
                    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
                    touchX.current = null
                }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element -- รูปพรีวิวมีลายน้ำจาก Blob */}
                {photo.preview && <img key={photo.id} src={photo.preview} alt="" className="max-w-full max-h-full object-contain rounded-lg animate-rise" onClick={(e) => e.stopPropagation()} />}
                {photos.length > 1 && (
                    <>
                        <button
                            aria-label="รูปก่อนหน้า"
                            onClick={(e) => {
                                e.stopPropagation()
                                go(-1)
                            }}
                            className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl items-center justify-center"
                        >
                            ‹
                        </button>
                        <button
                            aria-label="รูปถัดไป"
                            onClick={(e) => {
                                e.stopPropagation()
                                go(1)
                            }}
                            className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl items-center justify-center"
                        >
                            ›
                        </button>
                    </>
                )}
            </div>

            <div className="p-3 pb-safe flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <div className="flex gap-2 w-full max-w-md">
                    <button onClick={share} disabled={shareFiles && !ready} className={`${btn} flex-1 bg-move text-ink disabled:opacity-70`}>
                        <ShareIcon />
                        {shareFiles && !ready ? "กำลังเตรียม…" : "แชร์"}
                    </button>
                    <a href={`/api/photos/${photo.id}/download`} className={`${btn} flex-1 bg-white text-ink`}>
                        <DownloadIcon />
                        ดาวน์โหลด
                    </a>
                </div>
                {shareFiles && (
                    <button onClick={copyLink} className="text-xs text-white/60 underline">
                        คัดลอกลิงก์รูปนี้
                    </button>
                )}
            </div>

            {toast && (
                <div className="fixed bottom-24 inset-x-0 flex justify-center pointer-events-none">
                    <span className="bg-white text-ink text-sm font-medium px-4 h-10 inline-flex items-center rounded-full raise-lg animate-rise">{toast}</span>
                </div>
            )}
        </div>
    )
}

function ShareIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
        </svg>
    )
}

function DownloadIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
    )
}
