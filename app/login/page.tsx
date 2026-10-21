import { redirect } from "next/navigation"
import { isAdmin } from "@/lib/auth"
import LoginForm from "@/components/LoginForm"

export const metadata = { title: "เข้าสู่ระบบผู้ดูแล" }

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
    if (await isAdmin()) redirect("/admin")
    const next = (await searchParams).next

    return (
        <div className="max-w-sm mx-auto px-4 py-16">
            <p className="eyebrow">ผู้ดูแลระบบ</p>
            <h1 className="display text-2xl mt-1 mb-6">เข้าสู่ระบบ</h1>
            <LoginForm next={typeof next === "string" ? next : ""} />
        </div>
    )
}
