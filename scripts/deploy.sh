#!/usr/bin/env bash
# deploy บน VPS (Plesk) — รันในโฟลเดอร์แอปด้วย user ของ subscription:
#   bash scripts/deploy.sh
# ดึงโค้ดล่าสุดจาก GitHub → ติดตั้ง → migrate → build → สั่ง Passenger รีสตาร์ท
# .env / node_modules / models ไม่อยู่ใน git จึงไม่ถูกเขียนทับ
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH=/opt/plesk/node/24/bin:$PATH

git pull --ff-only
npm ci --no-audit --no-fund
npm run models
npx prisma migrate deploy
npm run build

# Passenger รีสตาร์ทแอปเมื่อ tmp/restart.txt เปลี่ยน
mkdir -p tmp && touch tmp/restart.txt
echo "deploy เสร็จ — $(git log -1 --format='%h %s')"
