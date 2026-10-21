import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob"

/**
 * Azure Blob เก็บเฉพาะรูปย่อ (thumb) และรูปพรีวิวมีลายน้ำ — ไม่เก็บต้นฉบับ (ต้นฉบับอยู่ที่ Drive)
 * container ต้องเปิดอ่านสาธารณะระดับ blob หรือมี CDN หน้า — BLOB_PUBLIC_BASE_URL คือ URL ที่เว็บใช้แสดงรูป
 */
let container: ContainerClient | null = null

function getContainer(): ContainerClient {
    if (container) return container
    const conn = process.env.AZURE_STORAGE_CONNECTION_STRING
    if (!conn) throw new Error("ยังไม่ได้ตั้ง AZURE_STORAGE_CONNECTION_STRING")
    container = BlobServiceClient.fromConnectionString(conn).getContainerClient(process.env.AZURE_STORAGE_CONTAINER || "photos")
    return container
}

export async function ensureContainer(): Promise<void> {
    await getContainer().createIfNotExists({ access: "blob" })
}

export async function uploadJpeg(key: string, data: Buffer): Promise<void> {
    await getContainer().getBlockBlobClient(key).uploadData(data, {
        blobHTTPHeaders: {
            blobContentType: "image/jpeg",
            // ชื่อไฟล์มี id ของรูปอยู่แล้ว เนื้อหาไม่เปลี่ยน — แคชได้นาน
            blobCacheControl: "public, max-age=31536000, immutable",
        },
    })
}

export async function deletePrefix(prefix: string): Promise<number> {
    let n = 0
    for await (const b of getContainer().listBlobsFlat({ prefix })) {
        await getContainer().deleteBlob(b.name)
        n++
    }
    return n
}

export function publicUrl(key: string | null): string | null {
    if (!key) return null
    const base = process.env.BLOB_PUBLIC_BASE_URL?.replace(/\/$/, "")
    if (!base) return null
    return `${base}/${key}`
}
