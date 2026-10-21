import { NextRequest, NextResponse } from "next/server"
import { sessionCookieOptions } from "@/lib/auth"
import { SESSION_COOKIE, signSession } from "@/lib/session"
import { isAdminEmail, verifiedEmailFromCode } from "@/lib/google-oauth"

// Google ส่งกลับมาพร้อม code — ตรวจ state, แลกเป็นอีเมลที่ยืนยันแล้ว, อนุญาตเฉพาะ ADMIN_EMAILS
export async function GET(request: NextRequest) {
    const fail = (error: string) => {
        const res = NextResponse.redirect(new URL(`/login?error=${error}`, process.env.APP_URL || request.url))
        res.cookies.delete({ name: "runphoto_oauth", path: "/api/auth/google" })
        return res
    }

    let saved: { state?: string; nonce?: string; next?: string } = {}
    try {
        saved = JSON.parse(request.cookies.get("runphoto_oauth")?.value ?? "{}")
    } catch {}
    const params = request.nextUrl.searchParams
    const code = params.get("code")
    if (params.get("error") || !code) return fail("google-cancel")
    if (!saved.state || params.get("state") !== saved.state || !saved.nonce) return fail("google-state")

    let email: string
    try {
        email = await verifiedEmailFromCode(code, request.nextUrl.origin, saved.nonce)
    } catch (e) {
        console.error("[google login]", e)
        return fail("google-failed")
    }
    if (!isAdminEmail(email)) return fail("not-admin")

    // เด้งกลับได้เฉพาะหน้าแอดมิน — กัน open redirect
    const next = saved.next?.startsWith("/admin") ? saved.next : "/admin"
    const res = NextResponse.redirect(new URL(next, process.env.APP_URL || request.url))
    res.cookies.set(SESSION_COOKIE, await signSession(email), sessionCookieOptions)
    res.cookies.delete({ name: "runphoto_oauth", path: "/api/auth/google" })
    return res
}
