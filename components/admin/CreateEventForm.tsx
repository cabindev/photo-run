"use client"

import { useActionState } from "react"
import { createEvent, type ActionResult } from "@/app/admin/actions"

const input = "w-full h-11 px-3 rounded-xl border border-line text-[15px] bg-transparent focus:outline-none focus:border-ink"
const label = "text-[12px] text-ink-mute mb-1.5 block"

export default function CreateEventForm() {
    const [state, action, pending] = useActionState<ActionResult | null, FormData>(createEvent, null)

    return (
        <form action={action} className="grid gap-4 sm:grid-cols-2">
            <div>
                <label className={label} htmlFor="name">ชื่องาน</label>
                <input id="name" name="name" required className={input} placeholder="รันลัดโต้ง #8" />
            </div>
            <div>
                <label className={label} htmlFor="slug">slug (ใช้ในลิงก์)</label>
                <input id="slug" name="slug" required className={input} placeholder="runludtong-8" />
            </div>
            <div>
                <label className={label} htmlFor="eventDate">วันที่จัดงาน</label>
                <input id="eventDate" name="eventDate" type="date" className={input} />
            </div>
            <div>
                <label className={label} htmlFor="organizer">ผู้จัด</label>
                <input id="organizer" name="organizer" className={input} placeholder="ไม่บังคับ" />
            </div>
            <div className="sm:col-span-2">
                <label className={label} htmlFor="driveFolder">ลิงก์โฟลเดอร์ Google Drive (แชร์ให้ service account แบบ Viewer แล้ว)</label>
                <input id="driveFolder" name="driveFolder" required className={input} placeholder="https://drive.google.com/drive/folders/..." />
            </div>
            <label className="sm:col-span-2 flex items-start gap-2 text-sm">
                <input type="checkbox" name="bibOcr" className="mt-1" />
                <span>
                    อ่านเลข BIB จากรูปด้วย OCR (Azure Vision ~$1.5 ต่อ 1,000 รูป)
                    <span className="block text-[12px] text-ink-mute">
                        ไม่ติ๊ก = ค้นด้วยใบหน้าอย่างเดียว · ใช้เมื่อเลข BIB ไม่ซ้ำกันทั้งงาน หรืออยากให้มีทางสำรองสำหรับรูปที่ไม่เห็นหน้า
                    </span>
                </span>
            </label>
            <div className="sm:col-span-2">
                <label className={label} htmlFor="bibPattern">รูปแบบเลข BIB เมื่อเปิด OCR (regex, ไม่บังคับ — ค่าเริ่มต้นรองรับ M-060, F156, 0412)</label>
                <input id="bibPattern" name="bibPattern" className={input} placeholder="^[MF]-?\d{3}$" />
            </div>
            <div className="sm:col-span-2 flex items-center gap-3">
                <button disabled={pending} className="h-11 px-6 rounded-xl bg-ink text-paper text-sm font-semibold disabled:opacity-50">
                    {pending ? "กำลังสร้าง..." : "สร้างงาน"}
                </button>
                {state && <p className={`text-sm ${state.ok ? "text-lime" : "text-danger"}`}>{state.ok ? state.message : state.error}</p>}
            </div>
        </form>
    )
}
