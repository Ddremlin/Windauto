#!/usr/bin/env bash
# Резервная копия: база аккаунтов, базы и фото всех компаний → ./backups/windauto-YYYY-MM-DD.tar.gz
# (хранятся 30 последних). Видео не включаются — они большие.
set -euo pipefail
cd "$(dirname "$0")"
# BACKUP_PASSPHRASE — шифровать копию (AES-256); BACKUP_COPY_TO — куда ещё скопировать,
# например u123456@u123456.your-storagebox.de:windauto/ (вход по ключу). Оба — в .env
BACKUP_PASSPHRASE=$(grep -s '^BACKUP_PASSPHRASE=' .env | cut -d= -f2- || true)
BACKUP_COPY_TO=$(grep -s '^BACKUP_COPY_TO=' .env | cut -d= -f2- || true)
mkdir -p backups
# снимки баз на ходу, без остановки сервера
docker compose exec -T api node -e "
  const { DatabaseSync } = require('node:sqlite');
  const fs = require('node:fs');
  fs.rmSync('/data/backup', { recursive: true, force: true });
  fs.mkdirSync('/data/backup/orgs', { recursive: true });
  const snap = (src, dst) => { const db = new DatabaseSync(src); db.exec(\"VACUUM INTO '\" + dst + \"'\"); db.close(); };
  snap('/data/accounts.db', '/data/backup/accounts.db');
  for (const id of fs.readdirSync('/data/orgs')) {
    if (!fs.existsSync('/data/orgs/' + id + '/org.db')) continue;
    fs.mkdirSync('/data/backup/orgs/' + id);
    snap('/data/orgs/' + id + '/org.db', '/data/backup/orgs/' + id + '/org.db');
  }
"
PHOTOS=$(cd data && ls -d orgs/*/photos 2>/dev/null || true)
OUT="backups/windauto-$(date +%F).tar.gz"
tar -czf "$OUT" -C data backup $PHOTOS
rm -rf data/backup
if [ -n "$BACKUP_PASSPHRASE" ]; then
  # расшифровать: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in файл.enc -out файл.tar.gz
  PASS="$BACKUP_PASSPHRASE" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:PASS -in "$OUT" -out "$OUT.enc"
  rm -f "$OUT"
  OUT="$OUT.enc"
fi
chmod 600 "$OUT"
[ -n "$BACKUP_COPY_TO" ] && scp -q -o BatchMode=yes "$OUT" "$BACKUP_COPY_TO"
ls -1t backups/windauto-*.tar.gz* | tail -n +31 | xargs -r rm --
echo "Готово: $OUT"
