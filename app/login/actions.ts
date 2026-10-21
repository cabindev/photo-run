"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { checkCredentials, endSession, startSession } from "@/lib/auth"

// กันเดารหัสผ่าน: ผิดได้ 5 ครั้งต่อ 15 นาทีต่อ IP (หน่วยความจำ — พอสำหรับเซิร์ฟเวอร์เดียว)
const failures = new Map<string, number[]>()
const WINDOW_MS = 15 * 60_000
const MAX_FAILURES = 5

export async function login(_prev: string | null, formData: FormData): Promise<string | null> {
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
    const now = Date.now()
    const recent = (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
    if (recent.length >= MAX_FAILURES) return "ลองผิดหลายครั้งเกินไป รอ 15 นาทีแล้วลองใหม่"

    if (!process.env.ADMIN_PASSWORD_HASH || !process.env.ADMIN_USERNAME) return "ยังไม่ได้ตั้งบัญชีแอดมิน (npm run admin:password)"
    const username = String(formData.get("username") ?? "").trim()
    if (!(await checkCredentials(username, String(formData.get("password") ?? "")))) {
        failures.set(ip, [...recent, now])
        return "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
    }
    failures.delete(ip)
    await startSession(process.env.ADMIN_USERNAME)

    // เด้งกลับได้เฉพาะหน้าแอดมิน — กัน open redirect
    const next = String(formData.get("next") ?? "")
    redirect(next.startsWith("/admin") ? next : "/admin")
}

export async function logout(): Promise<void> {
    await endSession()
    redirect("/")
}
