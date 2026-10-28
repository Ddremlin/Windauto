#!/usr/bin/env bash
# Резервная копия: база аккаунтов, базы и фото всех компаний → ./backups/windauto-YYYY-MM-DD.tar.gz
# (хранятся 30 последних). Видео не включаются — они большие.
set -euo pipefail
cd "$(dirname "$0")"
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
tar -czf "backups/windauto-$(date +%F).tar.gz" -C data backup $PHOTOS
rm -rf data/backup
ls -1t backups/windauto-*.tar.gz | tail -n +31 | xargs -r rm --
echo "Готово: backups/windauto-$(date +%F).tar.gz"
