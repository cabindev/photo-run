"use client"

import { useRef, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import type { PhotoCard } from "@/lib/search"
import { canShareFiles, fetchOriginal, isShareCancel, noSubscribe } from "@/lib/client-share"
import PhotoViewer from "@/components/PhotoViewer"

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

/**
 * ช่องค้นหา (ใบหน้า / BIB / เบอร์โทร) + ตัวอย่างรูปแบบสุ่ม / ผลค้นหา
 * แตะรูป → PhotoViewer (เลื่อนดู แชร์ ดาวน์โหลดทีละรูป)
 * "เลือกรูป" เลือกหลายรูปแล้ว
 *   - มือถือ (รองรับแชร์ไฟล์): บันทึก/แชร์ผ่านหน้าต่างแชร์ — iPhone เลือก "บันทึกรูปภาพ" เข้าแอปรูปภาพได้ทันที
 *   - คอม: โหลดเป็น .zip ไฟล์เดียว (zip บนมือถือต้องไปแตกไฟล์เอง ไม่สะดวก)
 */
export default function PhotoBrowser({
    slug,
    eventName,
    photos,
    faceEnabled,
    facesPurgeAt,
    bibEnabled,
    phoneEnabled,
}: {
    slug: string
    eventName: string
    /** ตัวอย่างรูปแบบสุ่มจากเซิร์ฟเวอร์ — "สุ่มรูปอื่น" = router.refresh() */
    photos: PhotoCard[]
    faceEnabled: boolean
    /** วันที่ลบข้อมูลใบหน้าของงาน (ข้อความภาษาไทยแล้ว) — แจ้งผู้ใช้ตาม PDPA */
    facesPurgeAt: string | null
    bibEnabled: boolean
    phoneEnabled: boolean
}) {
    const router = useRouter()
    const modes: { id: Mode; label: string }[] = [
        ...(faceEnabled ? [{ id: "face" as const, label: "เซลฟี่" }] : []),
        ...(bibEnabled ? [{ id: "bib" as const, label: "เลข BIB" }] : []),
        ...(phoneEnabled ? [{ id: "phone" as const, label: "เบอร์โทร" }] : []),
    ]
    const [mode, setMode] = useState<Mode | undefined>(modes[0]?.id)
    const [value, setValue] = useState("")
    const [consent, setConsent] = useState(false)
    const [selfiePreview, setSelfiePreview] = useState<string | null>(null)
    const selfieRef = useRef<File | null>(null)
    const resultsRef = useRef<HTMLDivElement>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [results, setResults] = useState<PhotoCard[] | null>(null)
    const [openIndex, setOpenIndex] = useState<number | null>(null)
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
        setPreparing(0)
        setError(null)
        try {
            const files: File[] = []
            for (const id of selection) {
                files.push(await fetchOriginal(id))
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
            await navigator.share({ files: prepared, title: `รูปงาน ${eventName}` })
            setSelected(new Set())
            setSelecting(false)
        } catch (e) {
            if (!isShareCancel(e)) setError("บันทึกไม่สำเร็จ ลองโหลดเป็น .zip หรือทีละรูป")
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

    function showResults(found: PhotoCard[] | null) {
        setResults(found)
        setSelected(new Set())
        setSelecting(false)
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
            // มือถือ: ผลอยู่ใต้ช่องค้นหา — เลื่อนลงให้เห็นทันที
            requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
        } catch {
            setError("เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง")
        } finally {
            setLoading(false)
        }
    }

    const shown = results ?? photos
    const tab = (on: boolean) =>
        `flex-1 h-10 rounded-full text-sm font-semibold transition ${on ? "bg-navy text-white shadow-sm" : "text-ink-soft hover:text-ink"}`

    return (
        <>
            {mode && (
                <form onSubmit={search} className="relative -mt-16 sm:-mt-20 max-w-xl mx-auto bg-paper rounded-3xl raise-lg p-5 sm:p-6 space-y-4">
                    <p className="text-center font-semibold">หารูปของคุณ</p>
                    {modes.length > 1 && (
                        <div className="flex gap-1 bg-paper-2 rounded-full p-1">
                            {modes.map((m) => (
                                <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => {
                                        setMode(m.id)
                                        setError(null)
                                    }}
                                    className={tab(mode === m.id)}
                                >
                                    {m.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {mode === "face" ? (
                        <>
                            <label className="group flex items-center gap-4 rounded-2xl border-2 border-dashed border-line hover:border-navy bg-paper-2/60 p-4 cursor-pointer transition">
                                {selfiePreview ? (
                                    // eslint-disable-next-line @next/next/no-img-element -- object URL ของไฟล์ในเครื่อง
                                    <img src={selfiePreview} alt="" className="w-16 h-16 rounded-full object-cover ring-4 ring-move shrink-0" />
                                ) : (
                                    <span className="w-16 h-16 rounded-full bg-navy text-white inline-flex items-center justify-center shrink-0 group-hover:scale-105 transition">
                                        <CameraIcon />
                                    </span>
                                )}
                                <span className="min-w-0">
                                    <span className="block font-semibold">{selfiePreview ? "เปลี่ยนรูปเซลฟี่" : "ถ่ายเซลฟี่ หรือเลือกรูป"}</span>
                                    <span className="block text-xs text-ink-mute mt-0.5">หน้าตรง เห็นหน้าชัด ไม่ใส่แว่นดำ</span>
                                </span>
                                <input
                                    type="file"
                                    accept="image/*,.heic,.heif"
                                    capture="user"
                                    className="sr-only"
                                    onChange={(e) => pickSelfie(e.target.files?.[0])}
                                />
                            </label>
                            <label className="flex items-start gap-2.5 text-xs text-ink-soft leading-relaxed">
                                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-4 h-4 accent-navy shrink-0" />
                                <span>
                                    ยินยอมให้ใช้ภาพใบหน้านี้เพื่อค้นหารูปของฉันในงานนี้เท่านั้น — ระบบไม่บันทึกรูปเซลฟี่ไว้
                                    {facesPurgeAt && ` · ข้อมูลใบหน้าในรูปงานจะถูกลบภายใน ${facesPurgeAt}`}
                                </span>
                            </label>
                        </>
                    ) : (
                        <div className="space-y-1.5">
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-mute">
                                    <SearchIcon />
                                </span>
                                <input
                                    value={value}
                                    onChange={(e) => setValue(e.target.value)}
                                    inputMode={mode === "phone" ? "tel" : "text"}
                                    placeholder={mode === "bib" ? "เลข BIB เช่น 134" : "เบอร์ที่ใช้สมัคร"}
                                    className="w-full h-14 pl-12 pr-4 rounded-2xl border-2 border-line bg-paper text-lg tnum focus:outline-none focus:border-navy"
                                />
                            </div>
                            {mode === "bib" && (
                                <p className="text-xs text-ink-mute">
                                    ผลอาจมีรูปของคนที่ใช้เลขเดียวกันต่างระยะ/เพศ{faceEnabled && " — ค้นด้วยเซลฟี่จะแม่นกว่า"}
                                </p>
                            )}
                        </div>
                    )}

                    <button
                        disabled={loading}
                        className="w-full h-14 rounded-2xl bg-move text-ink text-base font-bold inline-flex items-center justify-center gap-2 hover:brightness-95 active:scale-[0.99] transition disabled:opacity-70"
                    >
                        {loading ? <Spinner /> : <SearchIcon />}
                        {loading ? "กำลังค้นหา…" : "ค้นหารูปของฉัน"}
                    </button>
                    {error && <p className="text-sm text-danger text-center">{error}</p>}
                </form>
            )}

            <div ref={resultsRef} className="flex items-end justify-between gap-3 mt-10 scroll-mt-20">
                <div className="min-w-0">
                    <p className="eyebrow">{results ? "ผลการค้นหา" : "ตัวอย่างรูปในงาน"}</p>
                    <p className="font-semibold mt-0.5 tnum">
                        {results ? (message ?? `พบ ${results.length.toLocaleString("th-TH")} รูป`) : "สุ่มมาให้ดู — ค้นด้วยเซลฟี่เพื่อหารูปของคุณ"}
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {results ? (
                        <button type="button" onClick={() => showResults(null)} className="h-9 px-3 rounded-full text-sm text-ink-soft hover:text-ink">
                            ← ตัวอย่างรูป
                        </button>
                    ) : (
                        <button type="button" onClick={() => router.refresh()} className="h-9 px-4 rounded-full text-sm border border-line hover:border-ink">
                            สุ่มรูปอื่น
                        </button>
                    )}
                    {shown.length > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                setSelecting(!selecting)
                                setSelected(new Set())
                            }}
                            className={`h-9 px-4 rounded-full text-sm font-semibold border ${selecting ? "bg-navy text-white border-navy" : "border-line hover:border-ink"}`}
                        >
                            {selecting ? "ยกเลิก" : "เลือกรูป"}
                        </button>
                    )}
                </div>
            </div>

            {selecting && (
                <div className="flex items-center justify-between mt-3 text-sm text-ink-soft">
                    <span className="tnum">เลือกแล้ว {selected.size.toLocaleString("th-TH")} รูป</span>
                    <button
                        type="button"
                        onClick={() => setSelected(selected.size ? new Set() : new Set(shown.slice(0, MAX_ZIP).map((p) => p.id)))}
                        className="underline"
                    >
                        {selected.size ? "ล้าง" : `เลือกทั้งหมด${shown.length > MAX_ZIP ? ` (${MAX_ZIP} รูปแรก)` : ""}`}
                    </button>
                </div>
            )}

            <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3 mt-4">
                {shown.map((p, i) => {
                    const on = selected.has(p.id)
                    return (
                        <li key={p.id}>
                            <button
                                onClick={() => (selecting ? toggle(p.id) : setOpenIndex(i))}
                                aria-pressed={selecting ? on : undefined}
                                className={`group relative block w-full aspect-[4/3] bg-paper-3 rounded-2xl overflow-hidden ${on ? "ring-4 ring-move" : ""}`}
                            >
                                {p.thumb && (
                                    // eslint-disable-next-line @next/next/no-img-element -- รูปย่อจาก Blob ย่อมาแล้ว
                                    <img
                                        src={p.thumb}
                                        alt=""
                                        loading="lazy"
                                        className={`w-full h-full object-cover transition duration-300 ${on ? "scale-95 rounded-xl" : "group-hover:scale-105"}`}
                                    />
                                )}
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

            {results && results.length === 0 && (
                <p className="text-center text-ink-mute py-10">ไม่พบรูป ลองเซลฟี่ใหม่ให้เห็นหน้าชัดขึ้น{bibEnabled && " หรือค้นด้วยเลข BIB"}</p>
            )}

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
                                    บันทึก / แชร์ {prepared.length.toLocaleString("th-TH")} รูป
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

            {openIndex !== null && shown[openIndex] && (
                <PhotoViewer photos={shown} index={openIndex} eventName={eventName} onIndex={setOpenIndex} onClose={() => setOpenIndex(null)} />
            )}
        </>
    )
}

function CameraIcon() {
    return (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
            <circle cx="12" cy="13" r="3.5" />
        </svg>
    )
}

function SearchIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
        </svg>
    )
}

function Spinner() {
    return <span className="w-5 h-5 rounded-full border-2 border-ink/30 border-t-ink animate-spin" aria-hidden="true" />
}
