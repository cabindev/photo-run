# RunPhoto — ค้นหารูปงานวิ่งด้วยใบหน้า / BIB / เบอร์โทร

Next.js 16 + Prisma (MySQL) · รูปต้นฉบับอยู่ Google Drive · Azure Blob / Vision · ใบหน้าใช้โมเดล OpenCV รันในเครื่อง

เว็บจริง: https://photo.runludtong.com · **เอกสารระบบฉบับเต็ม (การทำงาน, คู่มือแอดมิน, deploy, แก้ปัญหา): [docs/SYSTEM.md](docs/SYSTEM.md)**

## การทำงาน

```
ช่างภาพอัปโหลด → Google Drive (ต้นฉบับอยู่ที่นี่)
                    │  npm run sync -- <slug>  หรือปุ่ม "ซิงก์รูป" ในหน้า /admin
                    ▼
     ย่อรูป thumb 400px / preview 1280px + ลายน้ำ → Azure Blob (ใช้แสดงบนเว็บ)
     Azure Vision OCR → เลข BIB → ตาราง PhotoBib
     YuNet + SFace (onnxruntime-node) → เวกเตอร์ใบหน้า → ตาราง PhotoFace
```

- ค้นด้วย **BIB**: ค้นจาก PhotoBib (เก็บแบบ normalize: `M-060` → `M060`)
- ค้นด้วย **เบอร์โทร**: ถามเว็บสมัครว่าเบอร์นี้ได้ BIB อะไร แล้วค้นเหมือน BIB (ดูสัญญา API ใน `lib/search.ts`)
- ค้นด้วย **ใบหน้า**: แปลงเซลฟี่เป็นเวกเตอร์ → เทียบ cosine กับทุกหน้าของงานในหน่วยความจำ (lib/face.ts, lib/search.ts) — เซลฟี่ไม่ถูกบันทึกและไม่ส่งออกนอกเซิร์ฟเวอร์
- **ดาวน์โหลดรูปเต็ม**: เซิร์ฟเวอร์ดึงจาก Drive ด้วย service account แล้วส่งต่อ (ไม่ต้องเปิดแชร์ไฟล์)

## เริ่มต้น (dev)

```bash
cp .env.example .env      # กรอกค่า
npm install
npm run models          # โมเดลใบหน้า ~39MB
npx prisma migrate dev
npm run admin:password    # ตั้งรหัสผ่านแอดมิน
npm run dev               # http://localhost:3001
```

## สิ่งที่ต้องตั้งค่า

| ตัวแปร | ได้มาจาก |
|---|---|
| `SESSION_SECRET` | สุ่มเอง ≥ 32 ตัว (`openssl rand -base64 48`) — เซ็นคุกกี้แอดมิน |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` | `npm run admin:password` (พิมพ์ชื่อและรหัสใน Terminal) |
| `GOOGLE_CLIENT_ID/SECRET`, `ADMIN_EMAILS`, `APP_URL` | ล็อกอินแอดมินด้วย Google — OAuth client เดียวกับเว็บสมัคร + redirect URI `<APP_URL>/api/auth/google/callback` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Cloud → service account → key (JSON) แล้วแชร์โฟลเดอร์รูปให้อีเมล service account แบบ Viewer |
| `AZURE_STORAGE_CONNECTION_STRING`, `BLOB_PUBLIC_BASE_URL` | Storage account → Access keys; URL = `https://<account>.blob.core.windows.net/photos` |
| `AZURE_VISION_ENDPOINT/KEY` | Azure AI Vision (อ่าน BIB) — หรือ Azure AI Services แบบ S0 |
| (โมเดลใบหน้า) | `npm run models` — โหลด YuNet/SFace จาก opencv_zoo มาไว้ที่ `models/` (ไม่อยู่ใน git) |
| `RUNLUDTONG_LOOKUP_URL/SECRET` | API ค้นเบอร์โทรของเว็บสมัคร (ยังไม่ได้ทำฝั่งเว็บสมัคร) |

## ผู้ดูแล

หน้า `/admin` ล็อกอินที่ `/login` (แยกจากเว็บสมัคร) — ด้วย Google (เฉพาะอีเมลใน `ADMIN_EMAILS`) หรือชื่อผู้ใช้ + รหัสผ่าน
ตั้ง/เปลี่ยนรหัส: `npm run admin:password` แล้วรีสตาร์ทเว็บ · นักวิ่งไม่ต้องล็อกอิน

## Deploy

`git push` แล้วรัน `scripts/deploy.sh` บน VPS — ดู [docs/SYSTEM.md](docs/SYSTEM.md#4-production-vps)

## PDPA

- ใบหน้าเป็นข้อมูลชีวภาพ: ต้องติ๊กยินยอมก่อนค้น, ไม่เก็บเซลฟี่
- ลบข้อมูลใบหน้าของงานเมื่อครบกำหนด: ปุ่ม "ลบข้อมูลใบหน้า" ใน /admin หรือ `npm run sync -- <slug> --purge-faces`
