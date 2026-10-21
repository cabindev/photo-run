"use client"

import { useRef, useState, useSyncExternalStore } from "react"
import type { PhotoCard } from "@/lib/search"

type Mode = "face" | "bib" | "phone"

// ต้องตรงกับ MAX_PHOTOS ใน app/api/photos/zip/route.ts
const MAX_ZIP = 60
// บันทึกลงเครื่องผ่านหน้าต่างแชร์ของมือถือ — โหลดรูปเต็มทั้งหมดเข้าหน่วยความจำก่อน จึงจำกัดจำนวน
const MAX_SHARE = 20
// ย่อเซลฟี่ก่อนส่ง — หาหน้าได้ดีที่ด้านยาวราว 1600px และส่งเร็วกว่าไฟล์ 12MP หลายเท่า
const SELFIE_MAX = 1600

/**
 * แปลงเซลฟี่เป็น JPEG ย่อขนาดในเบราว์เซอร์ — รูป HEIC ของ iPhone เซิร์ฟเวอร์อ่านไม่ได้ (sharp รองรับแค่ AVIF)
 * แต่ Safari เปิด HEIC ได้ จึงแปลงตรงนี้ เบราว์เซอร์ที่เปิดไม่ได้จะคืนไฟล์เดิม (null = เปิดไม่ได้เลย)
 */
async function toJpeg(file: File): Promise<File | null> {
    try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
        const scale = Math.min(1, SELFIE_MAX / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement("canvas")
        canvas.width = Math.round(bitmap.width * scale)
        canvas.height = Math.round(bitmap.height * scale)
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        bitmap.close()
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9))
        return blob ? new File([blob], "selfie.jpg", { type: "image/jpeg" }) : file
    } catch {
        return /\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type) ? null : file
    }
}

// มือถือที่แชร์ไฟล์ได้ — คอมบางเครื่อง (Chrome บน Mac) ก็แชร์ได้ แต่บนคอม .zip สะดวกกว่า จึงดูจอสัมผัสด้วย
// ค่าไม่เปลี่ยนระหว่างใช้งาน ฝั่งเซิร์ฟเวอร์ถือว่าไม่ได้
function canShareFiles(): boolean {
    if (!window.matchMedia("(pointer: coarse)").matches) return false
    const probe = new File([new Blob()], "x.jpg", { type: "image/jpeg" })
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] })
}
const noSubscribe = () => () => {}

function filenameFrom(res: Response, fallback: string): string {
    const m = res.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/)
    return m ? decodeURIComponent(m[1]) : fallback
}

/**
 * แกลเลอรีของงาน + ช่องค้นหา (ใบหน้า / BIB / เบอร์โทร)
 * มีผลค้นหา → แสดงผลค้นหาแทนแกลเลอรี, กด "ดูทั้งหมด" กลับมาแกลเลอรีหน้าปัจจุบัน
 * pagination เป็นของแกลเลอรี — ซ่อนตอนแสดงผลค้นหา (ผลค้นหาไม่แบ่งหน้า)
 * โหลดรูป: ทีละรูปจากหน้าดูรูป หรือกด "เลือกรูป" เลือกหลายรูปแล้ว
 *   - มือถือ (รองรับแชร์ไฟล์): บันทึกลงเครื่องผ่านหน้าต่างแชร์ — iPhone เลือก "บันทึกรูปภาพ" เข้าแอปรูปภาพได้ทันที
 *   - คอม: โหลดเป็น .zip ไฟล์เดียว (zip บนมือถือต้องไปแตกไฟล์เอง ไม่สะดวก)
 */
export default function PhotoBrowser({
    slug,
    photos,
    faceEnabled,
    facesPurgeAt,
    bibEnabled,
    phoneEnabled,
    pagination,
}: {
    slug: string
    photos: PhotoCard[]
    faceEnabled: boolean
    /** วันที่ลบข้อมูลใบหน้าของงาน (ข้อความภาษาไทยแล้ว) — แจ้งผู้ใช้ตาม PDPA */
    facesPurgeAt: string | null
    bibEnabled: boolean
    phoneEnabled: boolean
    pagination?: React.ReactNode
}) {
    const modes: { id: Mode; label: string }[] = [
        ...(faceEnabled ? [{ id: "face" as const, label: "ใบหน้า" }] : []),
        ...(bibEnabled ? [{ id: "bib" as const, label: "เลข BIB" }] : []),
        ...(phoneEnabled ? [{ id: "phone" as const, label: "เบอร์โทร" }] : []),
    ]
    const [mode, setMode] = useState<Mode | undefined>(modes[0]?.id)
    const [value, setValue] = useState("")
    const [consent, setConsent] = useState(false)
    const [selfiePreview, setSelfiePreview] = useState<string | null>(null)
    const selfieRef = useRef<File | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [results, setResults] = useState<PhotoCard[] | null>(null)
    const [open, setOpen] = useState<PhotoCard | null>(null)
    const [selecting, setSelecting] = useState(false)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    // รูปที่โหลดเตรียมไว้แล้วสำหรับหน้าต่างแชร์ — share() ต้องเรียกตรงจากการกดปุ่ม จึงแยกเป็นสองขั้น
    // ผูกกับชุดที่เลือกตอนเตรียม (selected เป็น Set ใหม่ทุกครั้งที่เปลี่ยน) — เลือกเพิ่ม/ลด ชุดเดิมใช้ไม่ได้อีก
    const [preparedFor, setPreparedFor] = useState<{ selection: Set<string>; files: File[] } | null>(null)
    const prepared = preparedFor?.selection === selected ? preparedFor.files : null
    const [preparing, setPreparing] = useState<number | null>(null)
    const canShare = useSyncExternalStore(noSubscribe, canShareFiles, () => false)

    async function prepareShare() {
        const selection = selected
        const ids = [...selection]
        setPreparing(0)
        setError(null)
        try {
            const files: File[] = []
            for (const id of ids) {
                const res = await fetch(`/api/photos/${id}/download`)
                if (!res.ok) throw new Error(String(res.status))
                files.push(new File([await res.blob()], filenameFrom(res, `${id}.jpg`), { type: "image/jpeg" }))
                setPreparing(files.length)
            }
            setPreparedFor({ selection, files })
        } catch {
            setError("โหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง หรือโหลดทีละรูป")
        } finally {
            setPreparing(null)
        }
    }

    async function share() {
        if (!prepared) return
        try {
            await navigator.share({ files: prepared })
            setSelected(new Set())
            setSelecting(false)
        } catch (e) {
            // ผู้ใช้กดยกเลิกหน้าต่างแชร์ — ไม่ใช่ข้อผิดพลาด
            if (!(e instanceof DOMException && e.name === "AbortError")) setError("บันทึกไม่สำเร็จ ลองโหลดเป็น .zip หรือทีละรูป")
        }
    }

    function toggle(id: string) {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else if (next.size < MAX_ZIP) next.add(id)
            return next
        })
    }

    function showResults(photos: PhotoCard[] | null) {
        setResults(photos)
        setSelected(new Set())
    }

    async function pickSelfie(picked: File | undefined) {
        if (!picked) return
        setError(null)
        const file = await toJpeg(picked)
        if (!file) return setError("เบราว์เซอร์นี้เปิดไฟล์ HEIC ไม่ได้ — ถ่ายเซลฟี่ใหม่ หรือเลือกรูป JPG/PNG")
        selfieRef.current = file
        if (selfiePreview) URL.revokeObjectURL(selfiePreview)
        setSelfiePreview(URL.createObjectURL(file))
    }

    async function search(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        setMessage(null)
        if (!mode) return

        const fd = new FormData()
        fd.set("mode", mode)
        if (mode === "face") {
            if (!selfieRef.current) return setError("ถ่ายหรือเลือกรูปเซลฟี่ก่อน")
            if (!consent) return setError("กรุณายินยอมให้ใช้ภาพใบหน้าเพื่อค้นหา")
            fd.set("selfie", selfieRef.current)
            fd.set("consent", "1")
        } else {
            if (!value.trim()) return setError(mode === "bib" ? "กรอกเลข BIB" : "กรอกเบอร์โทร")
            fd.set("value", value.trim())
        }

        setLoading(true)
        try {
            const res = await fetch(`/api/events/${encodeURIComponent(slug)}/search`, { method: "POST", body: fd })
            const j = await res.json()
            if (!res.ok) return setError(j.error ?? "ค้นหาไม่สำเร็จ")
            showResults(j.photos ?? [])
            if (j.message) setMessage(j.message)
        } catch {
            setError("เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง")
        } finally {
            setLoading(false)
        }
    }

    const shown = results ?? photos

    return (
        <>
            {mode && (
                <form onSubmit={search} className="bg-paper rounded-2xl raise p-4 mt-5 space-y-3">
                    <div className="flex gap-1 bg-paper-2 rounded-xl p-1 w-fit">
                        {modes.map((m) => (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => {
                                    setMode(m.id)
                                    setError(null)
                                }}
                                className={`px-4 h-9 rounded-lg text-sm ${mode === m.id ? "bg-paper raise font-semibold" : "text-ink-soft"}`}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>

                    {mode === "face" ? (
                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                {/* eslint-disable-next-line @next/next/no-img-element -- object URL ของไฟล์ในเครื่อง */}
                                {selfiePreview && <img src={selfiePreview} alt="" className="w-16 h-16 rounded-xl object-cover" />}
                                <label className="h-11 px-4 inline-flex items-center rounded-xl border border-line text-sm cursor-pointer hover:border-ink">
                                    {selfiePreview ? "เปลี่ยนรูป" : "ถ่ายเซลฟี่ / เลือกรูป"}
                                    <input
                                        type="file"
                                        accept="image/*,.heic,.heif"
                                        capture="user"
                                        className="sr-only"
                                        onChange={(e) => pickSelfie(e.target.files?.[0])}
                                    />
                                </label>
                            </div>
                            <label className="flex items-start gap-2 text-xs text-ink-soft">
                                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
                                <span>
                                    ยินยอมให้ใช้ภาพใบหน้านี้เพื่อค้นหารูปของฉันในงานนี้เท่านั้น — ระบบไม่บันทึกรูปเซลฟี่ไว้
                                    {facesPurgeAt && ` · ข้อมูลใบหน้าในรูปงานจะถูกลบภายใน ${facesPurgeAt}`}
                                </span>
                            </label>
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            <input
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                inputMode={mode === "phone" ? "tel" : "text"}
                                placeholder={mode === "bib" ? "เช่น M-060" : "เบอร์ที่ใช้สมัคร"}
                                className="w-full sm:max-w-xs h-11 px-3 rounded-xl border border-line text-[15px] bg-transparent focus:outline-none focus:border-ink"
                            />
                            {mode === "bib" && (
                                <p className="text-xs text-ink-mute">
                                    ผลอาจมีรูปของคนที่ใช้เลขเดียวกันต่างระยะ/เพศ{faceEnabled && " — ค้นด้วยใบหน้าจะแม่นกว่า"}
                                </p>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                        <button disabled={loading} className="h-11 px-6 rounded-xl bg-navy text-white hover:bg-navy-deep text-sm font-semibold disabled:opacity-50">
                            {loading ? "กำลังค้นหา..." : "ค้นหารูป"}
                        </button>
                        {results && (
                            <button
                                type="button"
                                onClick={() => {
                                    showResults(null)
                                    setMessage(null)
                                }}
                                className="text-sm text-ink-soft underline"
                            >
                                ดูรูปทั้งหมด
                            </button>
                        )}
                    </div>
                    {error && <p className="text-sm text-danger">{error}</p>}
                </form>
            )}

            <div className="flex items-center justify-between gap-3 mt-5 min-h-9">
                <p className="text-sm text-ink-soft tnum">
                    {results && (message ?? `พบ ${results.length.toLocaleString("th-TH")} รูป`)}
                </p>
                {shown.length > 0 && (
                    <div className="flex items-center gap-2 shrink-0">
                        {selecting && (
                            <button
                                type="button"
                                onClick={() =>
                                    setSelected(selected.size ? new Set() : new Set(shown.slice(0, MAX_ZIP).map((p) => p.id)))
                                }
                                className="h-9 px-3 rounded-lg text-sm text-ink-soft hover:text-ink"
                            >
                                {selected.size ? "ล้าง" : `เลือกทั้งหมด${shown.length > MAX_ZIP ? ` (${MAX_ZIP} รูปแรก)` : ""}`}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => {
                                setSelecting(!selecting)
                                setSelected(new Set())
                            }}
                            className={`h-9 px-4 rounded-lg text-sm font-semibold border ${selecting ? "bg-navy text-white border-navy" : "border-line hover:border-ink"}`}
                        >
                            {selecting ? "ยกเลิก" : "เลือกรูป"}
                        </button>
                    </div>
                )}
            </div>

            <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mt-3">
                {shown.map((p) => {
                    const on = selected.has(p.id)
                    return (
                        <li key={p.id}>
                            <button
                                onClick={() => (selecting ? toggle(p.id) : setOpen(p))}
                                aria-pressed={selecting ? on : undefined}
                                className={`relative block w-full aspect-[3/2] bg-paper-3 rounded-lg overflow-hidden ${on ? "ring-4 ring-move" : ""}`}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element -- รูปย่อจาก Blob ย่อมาแล้ว */}
                                {p.thumb && <img src={p.thumb} alt="" className={`w-full h-full object-cover transition ${on ? "scale-95 rounded-md" : ""}`} loading="lazy" />}
                                {selecting && (
                                    <span
                                        className={`absolute top-2 right-2 w-7 h-7 rounded-full border-2 inline-flex items-center justify-center text-sm font-bold ${
                                            on ? "bg-move border-move text-ink" : "bg-black/25 border-white"
                                        }`}
                                    >
                                        {on && "✓"}
                                    </span>
                                )}
                            </button>
                        </li>
                    )
                })}
            </ul>

            {selecting && selected.size > 0 && (
                // .zip ส่งเป็น form ธรรมดา ให้เบราว์เซอร์โหลดเอง — ไม่ต้องเก็บทั้งไฟล์ไว้ในหน่วยความจำของหน้าเว็บ
                <form method="post" action="/api/photos/zip" className="sticky bottom-4 z-40 mt-4 flex flex-col items-center gap-2 pb-safe">
                    {[...selected].map((id) => (
                        <input key={id} type="hidden" name="id" value={id} />
                    ))}
                    {canShare && selected.size <= MAX_SHARE ? (
                        <>
                            {prepared ? (
                                <button type="button" onClick={share} className="h-12 px-6 rounded-2xl bg-move text-ink font-bold raise-lg tnum">
                                    บันทึก {prepared.length.toLocaleString("th-TH")} รูปลงเครื่อง
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={prepareShare}
                                    disabled={preparing !== null}
                                    className="h-12 px-6 rounded-2xl bg-move text-ink font-bold raise-lg tnum disabled:opacity-80"
                                >
                                    {preparing !== null
                                        ? `กำลังเตรียมรูป ${preparing}/${selected.size}…`
                                        : `เตรียมบันทึก ${selected.size.toLocaleString("th-TH")} รูป`}
                                </button>
                            )}
                            <button className="text-xs text-ink-soft underline bg-paper/90 rounded px-2 py-0.5">หรือโหลดเป็น .zip</button>
                        </>
                    ) : (
                        <>
                            <button className="h-12 px-6 rounded-2xl bg-move text-ink font-bold raise-lg tnum">
                                ดาวน์โหลด {selected.size.toLocaleString("th-TH")} รูป (.zip)
                            </button>
                            {canShare && (
                                <span className="text-xs text-ink-soft bg-paper/90 rounded px-2 py-0.5">
                                    บันทึกลงเครื่องได้ครั้งละไม่เกิน {MAX_SHARE} รูป
                                </span>
                            )}
                        </>
                    )}
                </form>
            )}

            {!results && pagination}

            {open && (
                <div className="fixed inset-0 z-50 bg-black/85 flex flex-col" onClick={() => setOpen(null)}>
                    <div className="flex justify-end gap-2 p-3" onClick={(e) => e.stopPropagation()}>
                        <a href={`/api/photos/${open.id}/download`} className="h-10 px-4 inline-flex items-center rounded-xl bg-move text-ink text-sm font-semibold">
                            ดาวน์โหลดรูปเต็ม
                        </a>
                        <button onClick={() => setOpen(null)} className="h-10 px-4 rounded-xl bg-white/15 text-white text-sm">ปิด</button>
                    </div>
                    <div className="flex-1 min-h-0 flex items-center justify-center p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element -- รูปพรีวิวมีลายน้ำจาก Blob */}
                        {open.preview && <img src={open.preview} alt="" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />}
                    </div>
                </div>
            )}
        </>
    )
}
