/**
 * ตั้ง/เปลี่ยนบัญชีแอดมิน — ถามชื่อผู้ใช้ + รหัสผ่าน (ไม่แสดงบนจอ) แล้วเขียน ADMIN_USERNAME / ADMIN_PASSWORD_HASH ลง .env
 *
 *   npm run admin:password            แก้ .env ในโฟลเดอร์นี้
 *   npm run admin:password -- <ไฟล์>   แก้ไฟล์ env อื่น (เช่นบนเซิร์ฟเวอร์)
 *
 * ต้องรันใน Terminal จริง (ต้องพิมพ์รหัส) — เปลี่ยนแล้วรีสตาร์ทเว็บให้โหลดค่าใหม่
 */
import fs from "node:fs"
import crypto from "node:crypto"
import { promisify } from "node:util"

const scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>

function askLine(prompt: string): Promise<string> {
    return new Promise((resolve) => {
        process.stdout.write(prompt)
        process.stdin.resume()
        process.stdin.once("data", (buf) => {
            process.stdin.pause()
            resolve(buf.toString("utf8").trim())
        })
    })
}

function setEnv(env: string, name: string, value: string): string {
    const line = `${name}="${value}"`
    const re = new RegExp(`^${name}=.*$`, "m")
    return re.test(env) ? env.replace(re, line) : `${env.trimEnd()}\n${line}\n`
}

function ask(prompt: string): Promise<string> {
    return new Promise((resolve) => {
        const stdin = process.stdin
        if (!stdin.isTTY) {
            console.error("ต้องรันใน Terminal ที่พิมพ์ได้")
            process.exit(1)
        }
        process.stdout.write(prompt)
        stdin.setRawMode(true)
        stdin.resume()
        let value = ""
        const onData = (buf: Buffer) => {
            for (const ch of buf.toString("utf8")) {
                if (ch === "\r" || ch === "\n") {
                    stdin.setRawMode(false)
                    stdin.pause()
                    stdin.off("data", onData)
                    process.stdout.write("\n")
                    return resolve(value)
                }
                if (ch === "\u0003") process.exit(130)
                if (ch === "\u007f") value = value.slice(0, -1)
                else value += ch
            }
        }
        stdin.on("data", onData)
    })
}

async function main() {
    const file = process.argv[2] || ".env"
    if (!fs.existsSync(file)) throw new Error(`ไม่พบไฟล์ ${file}`)

    const username = await askLine("ชื่อผู้ใช้แอดมิน: ")
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) throw new Error("ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - (3–32 ตัว)")
    const pw = await ask("รหัสผ่าน (อย่างน้อย 10 ตัว): ")
    if (pw.length < 10) throw new Error("รหัสผ่านสั้นเกินไป")
    if ((await ask("พิมพ์ซ้ำอีกครั้ง: ")) !== pw) throw new Error("รหัสผ่านสองครั้งไม่ตรงกัน")

    // รูปแบบเดียวกับ hashPassword ใน lib/auth.ts
    const salt = crypto.randomBytes(16)
    const hash = `scrypt:${salt.toString("base64")}:${(await scrypt(pw, salt, 64)).toString("base64")}`

    let env = fs.readFileSync(file, "utf8")
    env = setEnv(env, "ADMIN_USERNAME", username)
    env = setEnv(env, "ADMIN_PASSWORD_HASH", hash)
    fs.writeFileSync(file, env)
    console.log(`บันทึกบัญชีแอดมิน "${username}" ลง ${file} แล้ว — รีสตาร์ทเว็บเพื่อใช้ค่าใหม่`)
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
})
