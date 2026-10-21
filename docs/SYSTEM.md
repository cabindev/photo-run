# RunPhoto — เอกสารระบบ

ระบบให้นักวิ่งของงาน **รันลัดโต้ง** หารูปตัวเองแล้วดาวน์โหลดได้ฟรี
เดิมแจกรูปเป็นโฟลเดอร์ Google Drive แต่งานหนึ่งมีกว่า 14,000 รูป ไล่หาตัวเองแทบไม่ได้ ระบบนี้จึงให้ค้นด้วย **ใบหน้า** (หลัก) หรือ **เลข BIB** (สำรอง)

- เว็บจริง: https://photo.runludtong.com
- โค้ด: https://github.com/cabindev/photo-run
- เว็บหลัก (สมัครวิ่ง): https://runludtong.com — ระบบนี้แยกกัน มีล็อกอินของตัวเอง

---

## 1. ภาพรวมการทำงาน

```
ช่างภาพอัปโหลด ──► Google Drive (ต้นฉบับ — อยู่ที่นี่ที่เดียว)
                        │
                        │  ซิงก์: npm run sync -- <slug>
                        ▼
        ┌───────────────────────────────────────────────┐
        │ ทีละรูป (พร้อมกัน SYNC_CONCURRENCY รูป)        │
        │  1. โหลดต้นฉบับเข้าหน่วยความจำ (ไม่เขียนลงดิสก์)  │
        │  2. ย่อ thumb 400px + preview 1280px มีลายน้ำ   │──► Azure Blob (แสดงบนเว็บ)
        │  3. OCR หาเลข BIB (ถ้าเปิดไว้)                 │──► Azure AI Vision ──► ตาราง PhotoBib
        │  4. หาใบหน้า + แปลงเป็นเวกเตอร์ (ในเครื่อง)      │──► ตาราง PhotoFace
        └───────────────────────────────────────────────┘

นักวิ่ง ──► เลือกงาน ──► ค้นด้วยเซลฟี่ / BIB ──► ดูรูป (preview มีลายน้ำ)
                                              └─► ดาวน์โหลดรูปเต็ม: เซิร์ฟเวอร์ดึงจาก Drive แล้วส่งต่อ
```

| ส่วน | อยู่ที่ไหน |
|---|---|
| เว็บ + ซิงก์ + โมเดลใบหน้า | VPS (Plesk, Debian) — Next.js 16 รันผ่าน Passenger |
| ฐานข้อมูล | MariaDB บน VPS เดียวกัน (ฐาน `runphoto`, รับเฉพาะ localhost) |
| รูปต้นฉบับ | Google Drive (อ่านด้วย service account) |
| รูปย่อ/พรีวิว | Azure Blob Storage `runphotoblob01` / container `photos` (อ่านสาธารณะ) |
| อ่าน BIB | Azure AI Services `runphoto-ai` (S0) |
| DNS / CDN | Cloudflare (record `photo` แบบ Proxied) |
| SSL ต้นทาง | Let's Encrypt ออกผ่าน Plesk |

Azure ทั้งหมดอยู่ใน resource group **`runphoto-rg`** (Southeast Asia)

---

## 2. การค้นหา

### 2.1 ค้นด้วยใบหน้า (วิธีหลัก)

- โมเดล open-source ของ OpenCV รันในเซิร์ฟเวอร์เราเอง ผ่าน `onnxruntime-node` — **ไม่ส่งหน้าไปบริการภายนอก ไม่มีค่าใช้จ่ายต่อรูป**
  - **YuNet** (MIT) — หาหน้าและจุดสำคัญ 5 จุด รับภาพ 640×640 ตายตัว จึงตัดรูปเป็นช่องเพื่อจับหน้าคนที่อยู่ไกล
  - **SFace** (Apache-2.0) — จัดหน้าให้ตรงเป็น 112×112 แล้วแปลงเป็นเวกเตอร์ 128 มิติ
- เทียบด้วย cosine similarity เกณฑ์ **0.45** (`MATCH_THRESHOLD` ใน `lib/face.ts`)
  OpenCV แนะนำ 0.363 แต่ทดสอบกับงานจริงแล้ว ในงานที่มีหลายหมื่นหน้า คนหน้าคล้ายหลุดมาช่วง 0.36–0.43
- ตอนค้น โหลดเวกเตอร์ทั้งงานเข้าหน่วยความจำครั้งเดียว (งานละ ~20MB) เก็บ cache 10 นาที
- เซลฟี่ไม่ถูกบันทึก — แปลงเป็นเวกเตอร์ในหน่วยความจำแล้วทิ้ง ผู้ใช้ต้องติ๊กยินยอมก่อนค้น
- ข้อมูลจากงานรันลัดโต้ง #8: 96% ของรูปเจอหน้าอย่างน้อย 1 หน้า

ไฟล์: `lib/face.ts` (โมเดล), `lib/search.ts` (`searchByFace`)

### 2.2 ค้นด้วยเลข BIB (สำรอง — เปิด/ปิดได้ทีละงาน)

- Azure AI Vision อ่านข้อความในรูป → กรองเฉพาะคำที่หน้าตาเหมือน BIB (`lib/bib.ts`)
- เก็บแบบ normalize: ตัวพิมพ์ใหญ่ ตัดขีด/ช่องว่าง (`M-060` → `M060`)
- กรองขยะที่เจอจริง:
  - เก็บเฉพาะคำที่ OCR มั่นใจ ≥ 0.8 — ตัวอักษรไทยบนป้ายมักถูกอ่านเป็นเลขแบบไม่มั่นใจ (เช่น "รัน" → "526")
  - ข้ามเลขที่ตรงกับปีของงาน (ค.ศ./พ.ศ.) — ซุ้มมักเขียนปีไว้
- **ข้อจำกัด:** ป้าย BIB ของรันลัดโต้งแยก เพศ (F/M) กับตัวเลขไว้คนละช่อง ระบบเก็บได้แค่ตัวเลข
  ค้น "134" จึงได้ทั้ง F134 และ M134 — หน้าเว็บมีข้อความเตือนไว้แล้ว ใช้ใบหน้าจะแม่นกว่า
- ค่าใช้จ่าย ~$1.5 ต่อ 1,000 รูป — งานใหม่ค่าเริ่มต้นคือ **ปิด** (ติ๊กเปิดในฟอร์มสร้างงาน)

### 2.3 ค้นด้วยเบอร์โทร (ยังไม่เปิดใช้)

ต้องมี API ฝั่งเว็บสมัครที่แปลงเบอร์เป็นเลข BIB — สัญญา API อยู่ใน `lib/search.ts`
ตั้ง `RUNLUDTONG_LOOKUP_URL` / `RUNLUDTONG_LOOKUP_SECRET` แล้วแท็บนี้จะขึ้นเอง

### 2.4 ดาวน์โหลดรูปเต็ม

`/api/photos/<id>/download` — เซิร์ฟเวอร์ดึงไฟล์จาก Drive ด้วย service account แล้วสตรีมต่อ
ไม่ต้องเปิดแชร์โฟลเดอร์ Drive เป็นสาธารณะ

---

## 3. คู่มือผู้ดูแล

### 3.1 ล็อกอิน

หน้า https://photo.runludtong.com/login (ปุ่ม "เข้าสู่ระบบ" มุมขวาบน)

| วิธี | ใครเข้าได้ |
|---|---|
| **เข้าสู่ระบบด้วย Google** | เฉพาะอีเมลใน `ADMIN_EMAILS` (คั่นด้วย `,`) |
| ชื่อผู้ใช้ + รหัสผ่าน | บัญชีเดียวใน `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` |

- Google ใช้ OAuth client เดียวกับเว็บสมัคร (โปรเจกต์ Google Cloud `activerun`) — redirect URI ของระบบนี้คือ `https://photo.runludtong.com/api/auth/google/callback`
- รหัสผ่านแอดมินบนเซิร์ฟเวอร์ดูได้ที่ `private/runphoto/admin-password.txt` (ดูหัวข้อ 4.2)
- เปลี่ยนรหัส: `npm run admin:password -- <ไฟล์ .env>` แล้วรีสตาร์ทแอป
- session อยู่ 7 วัน · ใส่รหัสผิดได้ 5 ครั้งต่อ 15 นาที

### 3.2 เพิ่มงานใหม่

1. ช่างภาพอัปโหลดรูปลงโฟลเดอร์ Google Drive (มีโฟลเดอร์ย่อยได้ — ระบบไล่ทั้งหมด)
2. **แชร์โฟลเดอร์ให้** `runphoto-drive@runphoto.iam.gserviceaccount.com` แบบ **ผู้มีสิทธิ์อ่าน**
3. หน้า `/admin` → **สร้างงาน**: ชื่องาน, slug (ใช้ในลิงก์ เช่น `runludtong-9`), วันที่, ลิงก์โฟลเดอร์ Drive
   ติ๊ก "อ่านเลข BIB" ถ้าต้องการ (มีค่าใช้จ่าย)
4. **ซิงก์รูป** — งานใหญ่ให้รันบนเซิร์ฟเวอร์ (หัวข้อ 4.4) ปุ่ม "ซิงก์รูป" ในหน้าแอดมินใช้ได้กับงานเล็ก
   แต่ Passenger อาจหยุดโปรเซสก่อนเสร็จ — รันซ้ำได้ รูปที่ทำแล้วจะข้าม
5. ตรวจในหน้า `/admin` (จำนวนรูป / ผิดพลาด / ใบหน้า) แล้วกด **เผยแพร่**
6. ส่งลิงก์ `https://photo.runludtong.com/e/<slug>` ให้นักวิ่ง

ช่างภาพอัปรูปเพิ่มทีหลัง → ซิงก์ซ้ำ จะทำเฉพาะรูปใหม่

### 3.3 ปุ่มอื่นในหน้าแอดมิน

| ปุ่ม | ทำอะไร |
|---|---|
| ซ่อนงาน / เผยแพร่ | สลับให้นักวิ่งเห็นงานหรือไม่ |
| ลบข้อมูลใบหน้า | ลบเวกเตอร์ใบหน้าทั้งงาน + ปิดค้นด้วยใบหน้า (รูปและ BIB อยู่ต่อ) — ใช้เมื่อครบกำหนดตาม PDPA |
| ลบงาน | ลบใบหน้า + รูปย่อใน Blob + ข้อมูลในฐานข้อมูล (ไม่แตะต้นฉบับใน Drive) |

ปุ่มลบต้องกดสองครั้งเพื่อยืนยัน

---

## 4. Production (VPS)

### 4.1 เข้าเครื่อง

```bash
ssh runludtong            # ตั้งไว้ใน ~/.ssh/config (key: ~/.ssh/id_runludtong)
```

### 4.2 ที่อยู่ไฟล์

| อะไร | path |
|---|---|
| แอป (git checkout) | `/var/www/vhosts/runludtong.com/photo.runludtong.com` |
| document root | `…/photo.runludtong.com/public` — ไฟล์ `.env` จึงเปิดผ่านเว็บไม่ได้ |
| `.env` ของ production | `…/photo.runludtong.com/.env` (สิทธิ์ 600) |
| ไฟล์ลับอื่น | `/var/www/vhosts/runludtong.com/private/runphoto/` — key Google Drive, รหัสฐานข้อมูล, รหัสแอดมิน, log ซิงก์ |
| log ของแอป | `/var/log/passenger/passenger.log` (บรรทัด `App <pid> output:`) |
| log ของ Apache/nginx | `/var/www/vhosts/system/photo.runludtong.com/logs/` |

แอปรันด้วย system user ของ subscription runludtong.com — คำสั่งด้านล่างใช้ `$(stat -c %U /var/www/vhosts/runludtong.com/httpdocs)` หาชื่อ user ให้

### 4.3 Deploy

```bash
# บนเครื่อง dev
git push

# บน VPS
ssh runludtong 'su -s /bin/bash $(stat -c %U /var/www/vhosts/runludtong.com/httpdocs) \
  -c "bash /var/www/vhosts/runludtong.com/photo.runludtong.com/scripts/deploy.sh"'
```

`scripts/deploy.sh`: `git pull` → `npm ci` → `npm run models` → `prisma migrate deploy` → `npm run build` → แตะ `tmp/restart.txt` ให้ Passenger รีสตาร์ท

### 4.4 ซิงก์งานบนเซิร์ฟเวอร์

```bash
ssh runludtong
U=$(stat -c %U /var/www/vhosts/runludtong.com/httpdocs)
su -s /bin/bash $U -c "cd /var/www/vhosts/runludtong.com/photo.runludtong.com && \
  export PATH=/opt/plesk/node/24/bin:\$PATH && \
  SYNC_CONCURRENCY=12 nohup nice -n 10 npm run sync -- <slug> \
  > /var/www/vhosts/runludtong.com/private/runphoto/sync.log 2>&1 &"

tail -f /var/www/vhosts/runludtong.com/private/runphoto/sync.log
```

- `nice -n 10` ให้เว็บอื่นในเครื่องได้ CPU ก่อน — VPS มี 16 CPU งาน 14,000 รูปใช้เวลาราว 30–60 นาที
- คำสั่งอื่น: `npm run sync -- --all` (ทุกงานที่เผยแพร่), `npm run sync -- <slug> --purge-faces` (ลบใบหน้า)

### 4.5 ตั้งค่า Plesk (Websites & Domains → photo.runludtong.com → Node.js)

| ช่อง | ค่า |
|---|---|
| Node.js Version | 24.x |
| Application Root | `/photo.runludtong.com` |
| Document Root | `/photo.runludtong.com/public` |
| Application Startup File | `server.js` |
| Application Mode | production |
| Custom environment variables | **ไม่ต้องใส่** — แอปอ่าน `.env` เอง ถ้าใส่จะ **ทับ** `.env` และค่าถูกเขียนลง config ของเว็บเซิร์ฟเวอร์แบบตัวอักษรธรรมดา |

### 4.6 Cloudflare

DNS ของ runludtong.com อยู่ที่ Cloudflare (ไม่ใช่ Plesk)
record: `A  photo  14.207.143.39  Proxied` — ตอนต่ออายุ SSL ถ้ามีปัญหา ให้สลับเป็น DNS only ชั่วคราว

---

## 5. ตัวแปรใน `.env`

| ตัวแปร | ใช้ทำอะไร |
|---|---|
| `DATABASE_URL` | MariaDB/MySQL (บนเครื่อง dev มีของ server เขียนเป็นคอมเมนต์ไว้) |
| `SESSION_SECRET` | เซ็นคุกกี้แอดมิน — สุ่ม ≥ 32 ตัว **แยกกันระหว่าง dev กับ production** |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` | บัญชีแอดมินแบบรหัสผ่าน (`npm run admin:password`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | ล็อกอินด้วย Google (client เดียวกับเว็บสมัคร) |
| `ADMIN_EMAILS` | อีเมลที่เป็นแอดมินได้ คั่นด้วย `,` |
| `APP_URL` | URL จริงของเว็บ ใช้สร้าง redirect URI หลัง proxy (`https://photo.runludtong.com`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | path ไฟล์ key ของ service account (อ่าน Drive) |
| `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER`, `BLOB_PUBLIC_BASE_URL` | Azure Blob |
| `AZURE_VISION_ENDPOINT`, `AZURE_VISION_KEY` | OCR อ่าน BIB |
| `SYNC_CONCURRENCY` | จำนวนรูปที่ประมวลผลพร้อมกันตอนซิงก์ (ค่าเริ่มต้น 10) |
| `WATERMARK_TEXT` | ข้อความลายน้ำบนพรีวิว |
| `MAIN_SITE_URL` | ลิงก์ "← runludtong.com" ใน navbar (ค่าเริ่มต้น `https://runludtong.com`) |
| `RUNLUDTONG_LOOKUP_URL`, `RUNLUDTONG_LOOKUP_SECRET` | ค้นด้วยเบอร์โทร (ยังไม่ใช้) |

ตัวอย่างอยู่ใน `.env.example` · `.env` และ `secrets/` ไม่ขึ้น git

---

## 6. ฐานข้อมูล

| ตาราง | เก็บอะไร |
|---|---|
| `Event` | งาน: ชื่อ, slug, โฟลเดอร์ Drive, เผยแพร่ไหม, เปิดค้นใบหน้า/BIB ไหม |
| `Photo` | หนึ่งแถวต่อรูปใน Drive: สถานะ (`PENDING`/`PROCESSED`/`FAILED`), key ใน Blob, `facesIndexedAt` |
| `PhotoBib` | เลข BIB ที่อ่านได้ (normalize แล้ว) |
| `PhotoFace` | หนึ่งแถวต่อหน้า: เวกเตอร์ 512 ไบต์, คะแนน, กรอบหน้า — **ข้อมูลชีวภาพ** |

ไม่มีตารางผู้ใช้ — แอดมินมาจาก `.env`

---

## 7. ค่าใช้จ่าย (ประมาณ)

| รายการ | ค่าใช้จ่าย |
|---|---|
| VPS / MariaDB | ใช้เครื่องเดิมของ SDN ไม่มีเพิ่ม |
| ค้นด้วยใบหน้า | ฟรี (รันเอง) |
| Azure Blob | ไม่กี่ดอลลาร์ต่อเดือน (งานละ ~1–2GB รูปย่อ) |
| Azure Vision (เฉพาะงานที่เปิด BIB) | ~$1.5 ต่อ 1,000 รูป |
| Cloudflare / Let's Encrypt / GitHub | ฟรี |

---

## 8. PDPA

- ใบหน้าเป็นข้อมูลชีวภาพ — ต้องติ๊กยินยอมก่อนค้น, ไม่เก็บเซลฟี่, เวกเตอร์ใบหน้าไม่ออกนอกเซิร์ฟเวอร์
- ลบข้อมูลใบหน้าของงานเมื่อครบกำหนด (ปุ่มในหน้าแอดมิน หรือ `--purge-faces`)
- ท้ายทุกหน้ามีข้อความแจ้งว่าข้อมูลใบหน้าใช้เพื่อค้นหารูปเท่านั้น

---

## 9. แก้ปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| ดาวน์โหลดรูปเต็มได้ 500 | ดู `passenger.log` — ถ้า `ENOENT …google-service-account.json` แปลว่า `GOOGLE_SERVICE_ACCOUNT_JSON` ชี้ path ผิด (เช็ค Custom environment variables ใน Plesk ซึ่งทับ `.env`) |
| แก้ `.env` แล้วไม่มีผล | ต้องรีสตาร์ทแอป (`touch tmp/restart.txt` หรือ Restart App ใน Plesk) และเช็คว่าไม่มีค่าเดียวกันใน Plesk ทับอยู่ |
| ซิงก์แล้วรูปขึ้น FAILED | ดูคอลัมน์ `error` ในตาราง `Photo` — ส่วนใหญ่เน็ตหลุด/Drive จำกัดความถี่ ซิงก์ซ้ำได้ (ลองใหม่สูงสุด 3 ครั้งต่อรูป) |
| ค้นด้วยใบหน้าไม่ขึ้นแท็บ | งานยังไม่มีข้อมูลใบหน้า (ยังไม่ซิงก์ หรือถูกลบใบหน้าแล้ว) หรือไม่มีไฟล์โมเดล → `npm run models` |
| ค้น BIB ได้รูปคนอื่นปน | ดู 2.2 — เลขซ้ำต่างเพศ/ระยะ หรือ OCR อ่านป้ายอื่นเป็นเลข |
| ล็อกอิน Google ขึ้น "ไม่มีสิทธิ์ผู้ดูแล" | อีเมลไม่อยู่ใน `ADMIN_EMAILS` |
| ล็อกอิน Google ขึ้น redirect_uri_mismatch | เพิ่ม `<APP_URL>/api/auth/google/callback` ใน OAuth client (Google Cloud → โปรเจกต์ activerun) |

---

## 10. โครงสร้างโค้ด

```
app/
  page.tsx                    หน้าแรก — รายการงานที่เผยแพร่
  e/[slug]/page.tsx           หน้างาน — แกลเลอรี + ค้นหา
  admin/                      หน้าแอดมิน + server actions
  login/                      หน้าล็อกอิน + actions
  api/events/[slug]/search    API ค้นหา (face / bib / phone)
  api/photos/[id]/download    ดาวน์โหลดรูปเต็มจาก Drive
  api/auth/google/            ล็อกอินด้วย Google
lib/
  pipeline.ts                 ซิงก์ / ประมวลผลรูป / ลบใบหน้า
  face.ts                     โมเดลใบหน้า (YuNet + SFace)
  search.ts                   ค้นด้วยใบหน้า / BIB / เบอร์โทร
  bib.ts                      กรองและ normalize เลข BIB
  azure.ts                    Azure Vision OCR
  drive.ts                    Google Drive
  blob.ts                     Azure Blob
  images.ts                   ย่อรูป + ลายน้ำ (sharp)
  auth.ts, session.ts         ล็อกอินแอดมิน
  google-oauth.ts             OAuth กับ Google
scripts/
  sync-event.ts               npm run sync
  download-models.ts          npm run models
  set-admin-password.ts       npm run admin:password
  deploy.sh                   deploy บน VPS
server.js                     จุดเริ่มสำหรับ Passenger
proxy.ts                      กัน /admin ให้เฉพาะคนล็อกอิน
```
