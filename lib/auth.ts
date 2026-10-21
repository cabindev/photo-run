import "server-only"
import crypto from "node:crypto"
import { promisify } from "node:util"
import { cookies } from "next/headers"
import { verifySession, signSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session"

/**
 * ล็อกอินแอดมินของระบบรูปเอง (แยกจากเว็บสมัคร) — บัญชีแอดมินเดียว: ADMIN_USERNAME + ADMIN_PASSWORD_HASH
 * ตั้ง/เปลี่ยนด้วย `npm run admin:password` (พิมพ์รหัสใน Terminal ไม่แสดงบนจอ)
 * นักวิ่งไม่ต้องล็อกอิน — ค้น/โหลดรูปได้เลย
 */

const scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>

/** hash รูปแบบ scrypt:<salt base64>:<key base64> (สร้างโดย scripts/set-admin-password.ts) — ห้ามใช้ $ เพราะ Next ขยายตัวแปรใน .env */
export async function checkCredentials(username: string, password: string): Promise<boolean> {
    const [algo, salt, key] = (process.env.ADMIN_PASSWORD_HASH ?? "").split(":")
    const expectedUser = (process.env.ADMIN_USERNAME ?? "").trim().toLowerCase()
    if (algo !== "scrypt" || !salt || !key || !expectedUser) return false
    const expected = Buffer.from(key, "base64")
    // คำนวณ hash เสมอแม้ชื่อผิด — ไม่ให้เวลาตอบบอกได้ว่าชื่อถูกหรือผิด
    const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length)
    const passOk = crypto.timingSafeEqual(actual, expected)
    return passOk && username.trim().toLowerCase() === expectedUser
}

/** ชื่อผู้ใช้แอดมินที่ล็อกอินอยู่ หรือ null */
export async function getAdmin(): Promise<string | null> {
    return verifySession((await cookies()).get(SESSION_COOKIE)?.value)
}

export async function isAdmin(): Promise<boolean> {
    return (await getAdmin()) !== null
}

export async function requireAdmin(): Promise<void> {
    if (!(await isAdmin())) throw new Error("ต้องเป็นผู้ดูแลระบบ")
}

export async function startSession(username: string): Promise<void> {
    ;(await cookies()).set(SESSION_COOKIE, await signSession(username), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_MAX_AGE,
    })
}

export async function endSession(): Promise<void> {
    ;(await cookies()).delete(SESSION_COOKIE)
}
