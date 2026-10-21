// จุดเริ่มสำหรับ Plesk Node.js (Passenger) — Passenger ต้องการไฟล์ที่เรียก .listen() เอง และส่ง PORT มาให้
// ตอน dev ใช้ `npm run dev` ตามปกติ ไม่ต้องใช้ไฟล์นี้
// ไฟล์นี้ไม่ผ่าน bundler — Passenger โหลดด้วย require() ของ Node ตรงๆ
/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require("node:http")
const next = require("next")

const port = parseInt(process.env.PORT || "3001", 10)
const app = next({ dev: false })
const handle = app.getRequestHandler()

app.prepare().then(() => {
    createServer((req, res) => handle(req, res)).listen(port, () => {
        console.log(`> RunPhoto ready on :${port}`)
    })
})
