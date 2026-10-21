import type { Metadata, Viewport } from "next"
import Link from "next/link"
import { Prompt } from "next/font/google"
import { getAdmin } from "@/lib/auth"
import { logout } from "@/app/login/actions"
import SiteHeader from "@/components/SiteHeader"
import "./globals.css"

const prompt = Prompt({
    subsets: ["latin", "thai"],
    weight: ["300", "400", "500", "600", "700"],
    variable: "--font-prompt",
})

export const metadata: Metadata = {
    title: { default: "RunPhoto · ค้นหารูปงานวิ่ง", template: "%s · RunPhoto" },
    description: "ค้นหารูปของคุณจากงานวิ่งด้วยใบหน้า เลข BIB หรือเบอร์โทร",
}

export const viewport: Viewport = {
    themeColor: "#002B5A",
    width: "device-width",
    initialScale: 1,
}

// เว็บหลักของงานวิ่ง — ลิงก์ใน navbar ให้กลับไปได้
const MAIN_SITE_URL = process.env.MAIN_SITE_URL || "https://runludtong.com"

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    const admin = await getAdmin()

    return (
        // suppressHydrationWarning: ส่วนขยายเบราว์เซอร์มักยัด attribute ใส่ <html>/<body> ก่อน hydrate (เหมือนเว็บสมัคร)
        <html lang="th" suppressHydrationWarning>
            <body className={`${prompt.variable} font-sans min-h-dvh flex flex-col`} suppressHydrationWarning>
                <SiteHeader>
                    <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
                        <Link href="/" aria-label="RunLudtong Photo หน้าแรก" className="inline-flex items-center gap-2">
                            {/* โลโก้เดียวกับเว็บสมัคร (public/runludtong-logo.svg) — ระบุขนาดจริงกัน layout กระโดด */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src="/runludtong-logo.svg" alt="RunLudtong" width={490} height={440} className="h-9 w-auto" />
                            <span className="text-[11px] font-bold tracking-[0.16em] text-navy border-l border-line pl-2">PHOTO</span>
                        </Link>
                        <nav className="flex items-center gap-3 sm:gap-4 text-sm text-ink-soft whitespace-nowrap">
                            <a href={MAIN_SITE_URL} className="hover:text-ink">
                                ← runludtong<span className="hidden sm:inline">.com</span>
                            </a>
                            {admin && <Link href="/admin" className="hover:text-ink">จัดการงาน</Link>}
                            {admin && <span className="hidden sm:inline text-ink-mute truncate max-w-[30vw]">{admin}</span>}
                            {admin ? (
                                <form action={logout}>
                                    <button className="text-ink-mute hover:text-ink">ออกจากระบบ</button>
                                </form>
                            ) : (
                                <Link href="/login" className="h-8 px-3 inline-flex items-center rounded-lg border border-line hover:border-ink hover:text-ink">
                                    เข้าสู่ระบบ
                                </Link>
                            )}
                        </nav>
                    </div>
                </SiteHeader>
                <main className="flex-1">{children}</main>
                <footer className="text-center text-xs text-ink-mute py-8 px-4">
                    รูปทั้งหมดเป็นลิขสิทธิ์ของช่างภาพ · ข้อมูลใบหน้าใช้เพื่อค้นหารูปเท่านั้นและถูกลบตามกำหนด
                </footer>
            </body>
        </html>
    )
}
