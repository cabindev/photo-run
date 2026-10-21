import { SignJWT, jwtVerify } from "jose"

/**
 * คุกกี้ session ของแอดมิน = JWT เซ็นด้วย SESSION_SECRET (HS256) — ไม่มีข้อมูลส่วนตัวในนั้น
 * แยกไฟล์จาก lib/auth.ts เพราะ proxy.ts ใช้ด้วย (ไม่ต้องดึง node:crypto/scrypt เข้า proxy)
 */
export const SESSION_COOKIE = "runphoto_admin"
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60

function key(): Uint8Array {
    const secret = process.env.SESSION_SECRET
    if (!secret || secret.length < 32) throw new Error("ตั้ง SESSION_SECRET อย่างน้อย 32 ตัวอักษร")
    return new TextEncoder().encode(secret)
}

export async function signSession(username: string): Promise<string> {
    return new SignJWT({ role: "admin", sub: username })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(`${SESSION_MAX_AGE}s`)
        .sign(key())
}

/** คืนชื่อผู้ใช้แอดมินถ้า session ถูกต้อง ไม่งั้น null */
export async function verifySession(token: string | undefined): Promise<string | null> {
    if (!token) return null
    try {
        const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] })
        return payload.role === "admin" && payload.sub ? payload.sub : null
    } catch {
        return null
    }
}
