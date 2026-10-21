"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { deleteEvent, purgeEventFaces, startSync, togglePublish, type ActionResult } from "@/app/admin/actions"

const btn = "h-9 px-3 rounded-lg border border-line text-sm hover:border-ink disabled:opacity-50"

/**
 * ปุ่มลบใช้ยืนยันแบบกดสองครั้งในหน้า (ไม่ใช้ window.confirm)
 */
export default function EventActions({ eventId, isPublished, hasFaces }: { eventId: string; isPublished: boolean; hasFaces: boolean }) {
    const router = useRouter()
    const [pending, start] = useTransition()
    const [msg, setMsg] = useState<ActionResult | null>(null)
    const [armed, setArmed] = useState<"purge" | "delete" | null>(null)

    const run = (fn: () => Promise<ActionResult | void>) =>
        start(async () => {
            const r = await fn()
            if (r) setMsg(r)
            setArmed(null)
            router.refresh()
        })

    return (
        <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap gap-2 justify-end">
                <button disabled={pending} className={btn} onClick={() => run(() => startSync(eventId))}>ซิงก์รูป</button>
                <button disabled={pending} className={btn} onClick={() => run(() => togglePublish(eventId))}>
                    {isPublished ? "ซ่อนงาน" : "เผยแพร่"}
                </button>
                {hasFaces && (
                    <button
                        disabled={pending}
                        className={`${btn} ${armed === "purge" ? "border-danger text-danger" : ""}`}
                        onClick={() => (armed === "purge" ? run(() => purgeEventFaces(eventId)) : setArmed("purge"))}
                    >
                        {armed === "purge" ? "กดอีกครั้งเพื่อลบใบหน้า" : "ลบข้อมูลใบหน้า"}
                    </button>
                )}
                <button
                    disabled={pending}
                    className={`${btn} ${armed === "delete" ? "border-danger text-danger" : "text-ink-mute"}`}
                    onClick={() => (armed === "delete" ? run(() => deleteEvent(eventId)) : setArmed("delete"))}
                >
                    {armed === "delete" ? "กดอีกครั้งเพื่อลบงาน" : "ลบงาน"}
                </button>
            </div>
            {msg && <p className={`text-xs ${msg.ok ? "text-lime" : "text-danger"}`}>{msg.ok ? msg.message : msg.error}</p>}
        </div>
    )
}
