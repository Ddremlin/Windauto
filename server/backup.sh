#!/usr/bin/env bash
# Резервная копия базы и фото: ./backups/windauto-YYYY-MM-DD.tar.gz (хранятся 30 последних)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
docker compose exec -T api node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/data/windauto.db');
  db.exec(\"VACUUM INTO '/data/backup.db'\");
"
tar -czf "backups/windauto-$(date +%F).tar.gz" -C data backup.db photos
rm -f data/backup.db
ls -1t backups/windauto-*.tar.gz | tail -n +31 | xargs -r rm --
echo "Готово: backups/windauto-$(date +%F).tar.gz"
