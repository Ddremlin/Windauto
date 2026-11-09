#!/usr/bin/env bash
# Резервная копия: база аккаунтов, базы и фото всех компаний → ./backups/windauto-YYYY-MM-DD.tar.gz.enc
# (хранятся 30 дней). Видео в архив не входят — они большие; в копию вне сервера уходят по одному, тоже зашифрованные.
set -euo pipefail
cd "$(dirname "$0")"
# BACKUP_PASSPHRASE — пароль шифрования (AES-256). Храните его ещё и вне сервера: без него копии не расшифровать.
# BACKUP_COPY_TO — куда ещё скопировать, например u123456@u123456.your-storagebox.de:windauto/ (вход по ключу).
# Без пароля шифрования копия вне сервера не делается: данные клиентов не уходят наружу открытыми.
# HEALTHCHECK_URL — пинг healthchecks.io: начало, успех или /fail (нет пинга — придёт тревога). Всё — в .env
BACKUP_PASSPHRASE=$(grep -s '^BACKUP_PASSPHRASE=' .env | cut -d= -f2- || true)
BACKUP_COPY_TO=$(grep -s '^BACKUP_COPY_TO=' .env | cut -d= -f2- || true)
HEALTHCHECK_URL=$(grep -s '^HEALTHCHECK_URL=' .env | cut -d= -f2- || true)
ping_hc() { [ -z "$HEALTHCHECK_URL" ] || curl -fsS -m 10 --retry 3 -o /dev/null "$HEALTHCHECK_URL$1" || true; }
trap 'ping_hc /fail' ERR
ping_hc /start
if [ -n "$BACKUP_COPY_TO" ] && [ -z "$BACKUP_PASSPHRASE" ]; then
  echo "BACKUP_COPY_TO задан, а BACKUP_PASSPHRASE — нет: незашифрованную копию наружу не отправляю" >&2
  false
fi
# шифрование файла: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass pass:ПАРОЛЬ -in файл.enc -out файл — расшифровать
encrypt() { PASS="$BACKUP_PASSPHRASE" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:PASS -in "$1" -out "$2"; }
# подпись копии (HMAC-SHA256 тем же паролем): подменённую или испорченную копию видно до восстановления.
# Проверка: openssl dgst -sha256 -hmac ПАРОЛЬ -r файл.enc  — должно совпасть с файл.enc.hmac
sign() { openssl dgst -sha256 -hmac "$BACKUP_PASSPHRASE" -r "$1" | cut -d' ' -f1 > "$1.hmac"; }

mkdir -p backups
# снимки баз на ходу, без остановки сервера (от пользователя сервера, не root)
docker compose exec -T -u node api node -e "
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
  encrypt "$OUT" "$OUT.enc"
  rm -f "$OUT"
  OUT="$OUT.enc"
  sign "$OUT"
fi
chmod 600 "$OUT"*

if [ -n "$BACKUP_COPY_TO" ]; then
  REMOTE_HOST=${BACKUP_COPY_TO%%:*}
  REMOTE_DIR=${BACKUP_COPY_TO#*:}
  REMOTE_DIR=${REMOTE_DIR%/}
  rssh() { ssh -o BatchMode=yes "$REMOTE_HOST" "$@"; }
  scp -q -o BatchMode=yes "$OUT" "$OUT.hmac" "$REMOTE_HOST:$REMOTE_DIR/"
  # там тоже не дольше 30 дней (обещано в политике конфиденциальности)
  OLD=$(date -d '30 days ago' +%F)
  for f in $(rssh ls "$REMOTE_DIR" | grep -E '^windauto-[0-9]{4}-[0-9]{2}-[0-9]{2}\.tar\.gz' || true); do
    if [[ "${f:9:10}" < "$OLD" ]]; then rssh rm "$REMOTE_DIR/$f"; fi
  done

  # видео: каждое шифруется отдельно и досылается только новое; удалённые на сервере пропадают и из копии.
  # Имя в копии: <id компании>.<файл>.enc → при восстановлении расшифровать в data/orgs/<id компании>/videos/<файл>
  rssh mkdir "$REMOTE_DIR/videos-enc" 2>/dev/null || true
  REMOTE_LIST=$(rssh ls "$REMOTE_DIR/videos-enc" || true)
  LOCAL_LIST=""
  TMP=$(mktemp -d -p backups)
  trap 'rm -rf "$TMP"; ping_hc /fail' ERR
  for f in data/orgs/*/videos/*; do
    [ -f "$f" ] || continue
    case "$f" in *.tmp) continue ;; esac
    org=$(basename "$(dirname "$(dirname "$f")")")
    name="$org.$(basename "$f").enc"
    LOCAL_LIST+="$name"$'\n'
    grep -qxF "$name" <<<"$REMOTE_LIST" && continue
    encrypt "$f" "$TMP/$name"
    scp -q -o BatchMode=yes "$TMP/$name" "$REMOTE_HOST:$REMOTE_DIR/videos-enc/"
    rm -f "$TMP/$name"
  done
  rm -rf "$TMP"
  for name in $REMOTE_LIST; do
    grep -qxF "$name" <<<"$LOCAL_LIST" || rssh rm "$REMOTE_DIR/videos-enc/$name"
  done
fi
# на сервере — тоже 30 дней
find backups -maxdepth 1 -name 'windauto-*' -mtime +30 -delete
ping_hc ""
echo "Готово: $OUT"
