import crypto from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { authorizeUrl, isGoogleLoginConfigured } from "@/lib/google-oauth"

// เริ่มล็อกอินด้วย Google — เก็บ state/nonce/next ไว้ในคุกกี้ชั่วคราว 10 นาที แล้วส่งไปหน้า Google
export async function GET(request: NextRequest) {
    if (!isGoogleLoginConfigured()) return NextResponse.redirect(new URL("/login?error=google-off", request.url))

    const state = crypto.randomBytes(16).toString("base64url")
    const nonce = crypto.randomBytes(16).toString("base64url")
    const next = request.nextUrl.searchParams.get("next") ?? ""

    const res = NextResponse.redirect(authorizeUrl(request.nextUrl.origin, state, nonce))
    res.cookies.set("runphoto_oauth", JSON.stringify({ state, nonce, next }), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/auth/google",
        maxAge: 600,
    })
    return res
}
