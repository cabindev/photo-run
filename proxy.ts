import { NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE, verifySession } from "@/lib/session"

/**
 * /admin ต้องล็อกอินแอดมินของระบบรูป — ยังไม่ล็อกอินส่งไป /login แล้วเด้งกลับมา
 * เป็นแค่ด่านแรก — หน้าแอดมินและ server action ตรวจสิทธิ์ซ้ำอีกชั้น (requireAdmin)
 */
export async function proxy(request: NextRequest) {
    if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next()
    const login = new URL("/login", request.url)
    login.searchParams.set("next", request.nextUrl.pathname)
    return NextResponse.redirect(login)
}

export const config = {
    matcher: ["/admin/:path*"],
}
