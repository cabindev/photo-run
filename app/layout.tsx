import type { Metadata, Viewport } from "next"
import Link from "next/link"
import { Prompt } from "next/font/google"
import { getAdmin } from "@/lib/auth"
import { logout } from "@/app/login/actions"
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
    themeColor: "#000000",
    width: "device-width",
    initialScale: 1,
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    const admin = await getAdmin()

    return (
        // suppressHydrationWarning: ส่วนขยายเบราว์เซอร์มักยัด attribute ใส่ <html>/<body> ก่อน hydrate (เหมือนเว็บสมัคร)
        <html lang="th" suppressHydrationWarning>
            <body className={`${prompt.variable} font-sans min-h-dvh flex flex-col`} suppressHydrationWarning>
                <header className="bg-paper border-b border-line">
                    <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
                        <Link href="/" className="font-bold tracking-tight">
                            <span className="bg-move px-1.5 py-0.5 rounded-md mr-1">RUN</span>PHOTO
                        </Link>
                        <nav className="flex items-center gap-4 text-sm text-ink-soft">
                            {admin && <Link href="/admin" className="hover:text-ink">จัดการงาน</Link>}
                            {admin && <span className="text-ink-mute truncate max-w-[30vw]">{admin}</span>}
                            {admin && (
                                <form action={logout}>
                                    <button className="text-ink-mute hover:text-ink">ออกจากระบบ</button>
                                </form>
                            )}
                        </nav>
                    </div>
                </header>
                <main className="flex-1">{children}</main>
                <footer className="text-center text-xs text-ink-mute py-8 px-4">
                    รูปทั้งหมดเป็นลิขสิทธิ์ของช่างภาพ · ข้อมูลใบหน้าใช้เพื่อค้นหารูปเท่านั้นและถูกลบตามกำหนด
                </footer>
            </body>
        </html>
    )
}
