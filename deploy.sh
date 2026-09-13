#!/usr/bin/env bash
# Deploy on the VPS:  cd /var/www/html/geo && ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "==> pulling"
git pull --ff-only

echo "==> installing"
npm ci

echo "==> migrating"
npm run migrate

echo "==> building"
npm run build

echo "==> restarting"
if pm2 describe geo-web > /dev/null 2>&1; then
  pm2 restart ecosystem.config.js --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save

echo "==> done — http://5.78.222.163/geo"
pm2 status
