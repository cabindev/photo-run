"use client"

import { useEffect, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"

/**
 * แถบบนสุด — หน้าแรกซ่อนไว้ให้ hero รูปเต็มจอ เลื่อนลงเกิน SHOW_AFTER px แล้วค่อยเลื่อนลงมาแสดง
 * หน้าอื่นแสดงตลอดเหมือนปกติ
 */
const SHOW_AFTER = 80

export default function SiteHeader({ children }: { children: ReactNode }) {
    const home = usePathname() === "/"
    const [scrolled, setScrolled] = useState(false)

    useEffect(() => {
        if (!home) return
        const onScroll = () => setScrolled(window.scrollY > SHOW_AFTER)
        onScroll()
        window.addEventListener("scroll", onScroll, { passive: true })
        return () => window.removeEventListener("scroll", onScroll)
    }, [home])

    if (!home) return <header className="bg-paper border-b border-line">{children}</header>
    return (
        <header
            className={`fixed inset-x-0 top-0 z-50 bg-paper/95 backdrop-blur border-b border-line transition-transform duration-300 ${
                scrolled ? "translate-y-0" : "-translate-y-full"
            }`}
        >
            {children}
        </header>
    )
}
