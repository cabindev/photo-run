"use client"

import { useActionState } from "react"
import { login } from "@/app/login/actions"

export default function LoginForm({ next }: { next: string }) {
    const [error, action, pending] = useActionState(login, null)

    return (
        <form action={action} className="bg-paper rounded-2xl raise p-5 space-y-4">
            <input type="hidden" name="next" value={next} />
            <div>
                <label htmlFor="username" className="text-[12px] text-ink-mute mb-1.5 block">ชื่อผู้ใช้</label>
                <input
                    id="username"
                    name="username"
                    required
                    autoFocus
                    autoComplete="username"
                    autoCapitalize="none"
                    className="w-full h-11 px-3 rounded-xl border border-line text-[15px] bg-transparent focus:outline-none focus:border-ink"
                />
            </div>
            <div>
                <label htmlFor="password" className="text-[12px] text-ink-mute mb-1.5 block">รหัสผ่าน</label>
                <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    className="w-full h-11 px-3 rounded-xl border border-line text-[15px] bg-transparent focus:outline-none focus:border-ink"
                />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button disabled={pending} className="w-full h-11 rounded-xl bg-navy text-white hover:bg-navy-deep font-medium disabled:opacity-50">
                {pending ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}
            </button>
        </form>
    )
}
