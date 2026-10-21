import fs from "node:fs"
import { drive as createDrive, type drive_v3 } from "@googleapis/drive"
import { GoogleAuth } from "google-auth-library"

/**
 * อ่านรูปจาก Google Drive ด้วย service account
 * โฟลเดอร์ของงานต้องแชร์ให้อีเมล service account (xxx@yyy.iam.gserviceaccount.com) แบบ Viewer
 *
 * ไม่เอาลิงก์ Drive ไปแสดงบนเว็บตรงๆ — โดนโควตา/บล็อกฝังรูป ใช้แค่ดึงมาประมวลผลและส่งต้นฉบับผ่านเซิร์ฟเวอร์
 */
let client: drive_v3.Drive | null = null

function getDrive(): drive_v3.Drive {
    if (client) return client
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    if (!raw) throw new Error("ยังไม่ได้ตั้ง GOOGLE_SERVICE_ACCOUNT_JSON")
    // รับได้ทั้ง JSON ทั้งก้อน และ path ไปยังไฟล์ JSON
    const credentials = JSON.parse(raw.trim().startsWith("{") ? raw : fs.readFileSync(raw, "utf8"))
    const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/drive.readonly"] })
    client = createDrive({ version: "v3", auth })
    return client
}

export type DriveImage = {
    id: string
    name: string
    folderName: string | null
    takenAt: Date | null
    width: number | null
    height: number | null
}

const FOLDER = "application/vnd.google-apps.folder"

/** ไล่ทุกรูปในโฟลเดอร์และโฟลเดอร์ย่อยทั้งหมด */
export async function listImagesRecursive(folderId: string): Promise<DriveImage[]> {
    const drive = getDrive()
    const out: DriveImage[] = []
    const queue: { id: string; name: string | null }[] = [{ id: folderId, name: null }]
    const seen = new Set<string>()

    while (queue.length) {
        const folder = queue.shift()!
        if (seen.has(folder.id)) continue
        seen.add(folder.id)

        let pageToken: string | undefined
        do {
            const res = await drive.files.list({
                q: `'${folder.id}' in parents and trashed = false and (mimeType = '${FOLDER}' or mimeType contains 'image/')`,
                fields: "nextPageToken, files(id, name, mimeType, imageMediaMetadata(time, width, height))",
                pageSize: 1000,
                pageToken,
                supportsAllDrives: true,
                includeItemsFromAllDrives: true,
            })
            for (const f of res.data.files ?? []) {
                if (!f.id || !f.name) continue
                if (f.mimeType === FOLDER) {
                    queue.push({ id: f.id, name: f.name })
                    continue
                }
                out.push({
                    id: f.id,
                    name: f.name,
                    folderName: folder.name,
                    takenAt: parseExifTime(f.imageMediaMetadata?.time),
                    width: f.imageMediaMetadata?.width ?? null,
                    height: f.imageMediaMetadata?.height ?? null,
                })
            }
            pageToken = res.data.nextPageToken ?? undefined
        } while (pageToken)
    }
    return out
}

export async function downloadFile(fileId: string): Promise<Buffer> {
    const res = await getDrive().files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" },
    )
    return Buffer.from(res.data as ArrayBuffer)
}

/** สตรีมต้นฉบับให้ผู้ใช้ดาวน์โหลด — ไม่ต้องโหลดทั้งไฟล์เข้าหน่วยความจำ */
export async function streamFile(fileId: string): Promise<NodeJS.ReadableStream> {
    const res = await getDrive().files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "stream" },
    )
    return res.data as NodeJS.ReadableStream
}

// Drive ให้เวลาถ่ายจาก EXIF เป็น "2026:10:18 06:28:51" (เวลาตามกล้อง ไม่มีโซนเวลา — ถือเป็นเวลาไทย)
function parseExifTime(t: string | null | undefined): Date | null {
    const m = t?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/)
    if (!m) return null
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+07:00`)
    return isNaN(d.getTime()) ? null : d
}
