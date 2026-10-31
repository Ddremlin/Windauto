#!/usr/bin/env bash
# Резервная копия: база аккаунтов, базы и фото всех компаний → ./backups/windauto-YYYY-MM-DD.tar.gz
# (хранятся 30 последних). Видео не включаются — они большие.
set -euo pipefail
cd "$(dirname "$0")"
# BACKUP_PASSPHRASE — шифровать копию (AES-256); BACKUP_COPY_TO — куда ещё скопировать,
# например u123456@u123456.your-storagebox.de:windauto/ (вход по ключу), туда же досылаются новые видео;
# HEALTHCHECK_URL — пинг healthchecks.io: начало, успех или /fail (нет пинга — придёт тревога). Всё — в .env
BACKUP_PASSPHRASE=$(grep -s '^BACKUP_PASSPHRASE=' .env | cut -d= -f2- || true)
BACKUP_COPY_TO=$(grep -s '^BACKUP_COPY_TO=' .env | cut -d= -f2- || true)
HEALTHCHECK_URL=$(grep -s '^HEALTHCHECK_URL=' .env | cut -d= -f2- || true)
ping_hc() { [ -z "$HEALTHCHECK_URL" ] || curl -fsS -m 10 --retry 3 -o /dev/null "$HEALTHCHECK_URL$1" || true; }
trap 'ping_hc /fail' ERR
ping_hc /start
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
if [ -n "$BACKUP_COPY_TO" ]; then
  scp -q -o BatchMode=yes "$OUT" "$BACKUP_COPY_TO"
  # видео — без шифрования (как и на самом сервере), передаются только новые; удалённые на сервере остаются в копии
  VIDEOS=$(cd data && ls -d orgs/*/videos 2>/dev/null || true)
  [ -z "$VIDEOS" ] || (cd data && rsync -aR -e 'ssh -o BatchMode=yes' $VIDEOS "${BACKUP_COPY_TO%/}/videos/")
fi
ls -1t backups/windauto-*.tar.gz* | tail -n +31 | xargs -r rm --
ping_hc ""
echo "Готово: $OUT"
