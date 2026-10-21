import "server-only"
import { createRemoteJWKSet, jwtVerify } from "jose"

/**
 * ล็อกอินแอดมินด้วย Google (OAuth 2.0 authorization code) — ใช้ OAuth client เดียวกับเว็บสมัคร runludtong ได้
 * แค่เพิ่ม redirect URI `<APP_URL>/api/auth/google/callback` ใน Google Cloud Console
 * เข้าได้เฉพาะอีเมลใน ADMIN_EMAILS (คั่นด้วย ,) — บัญชี Google อื่นล็อกอินผ่านแต่ไม่ได้สิทธิ์
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"))

export function isGoogleLoginConfigured(): boolean {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.ADMIN_EMAILS)
}

/** หลัง Cloudflare/Passenger request.url อาจเป็น http://localhost:<port> — ใช้ APP_URL ถ้าตั้งไว้ */
export function redirectUri(requestOrigin: string): string {
    return `${(process.env.APP_URL || requestOrigin).replace(/\/$/, "")}/api/auth/google/callback`
}

export function authorizeUrl(origin: string, state: string, nonce: string): string {
    const url = new URL(AUTH_URL)
    url.search = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        redirect_uri: redirectUri(origin),
        response_type: "code",
        scope: "openid email",
        state,
        nonce,
        prompt: "select_account",
    }).toString()
    return url.toString()
}

/** แลก code เป็น id_token แล้วตรวจลายเซ็น/ผู้ออก/ผู้รับ/nonce — คืนอีเมลที่ยืนยันแล้ว */
export async function verifiedEmailFromCode(code: string, origin: string, nonce: string): Promise<string> {
    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            redirect_uri: redirectUri(origin),
            grant_type: "authorization_code",
        }),
    })
    if (!res.ok) throw new Error(`Google token ${res.status}: ${await res.text()}`)
    const { id_token } = (await res.json()) as { id_token?: string }
    if (!id_token) throw new Error("Google ไม่ส่ง id_token มา")

    const { payload } = await jwtVerify(id_token, jwks, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: process.env.GOOGLE_CLIENT_ID,
    })
    if (payload.nonce !== nonce) throw new Error("nonce ไม่ตรง")
    if (payload.email_verified !== true || typeof payload.email !== "string") throw new Error("อีเมลยังไม่ยืนยัน")
    return payload.email.toLowerCase()
}

export function isAdminEmail(email: string): boolean {
    return (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
        .includes(email.toLowerCase())
}
