#!/usr/bin/env bash
# Установка сервера Windauto на чистый VPS (Ubuntu/Debian), запускать от root:
#   bash install.sh [домен]
# Без домена используется <IP>.sslip.io — HTTPS-сертификат выпускается автоматически.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null; then
  echo "Устанавливаю Docker…"
  curl -fsSL https://get.docker.com | sh
fi

IP=$(curl -fsS4 https://api.ipify.org)
DOMAIN=${1:-$IP.sslip.io}

if [ ! -f .env ]; then
  PASS=$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 12)
  cat > .env <<ENV
DOMAIN=$DOMAIN
ADMIN_LOGIN=admin
ADMIN_PASSWORD=$PASS
ENV
  chmod 600 .env
  NEW=1
fi

# брандмауэр, если включён
if command -v ufw >/dev/null && ufw status | grep -q active; then
  ufw allow 80/tcp && ufw allow 443/tcp
fi

docker compose up -d --build

# ежедневная резервная копия в 03:30
( crontab -l 2>/dev/null | grep -v windauto-backup || true; echo "30 3 * * * $(pwd)/backup.sh >/dev/null 2>&1 # windauto-backup" ) | crontab -

source .env
echo
echo "Готово. Адрес сервера для приложения: https://$DOMAIN"
if [ "${NEW:-}" = 1 ]; then
  echo "Администратор: логин $ADMIN_LOGIN, пароль $ADMIN_PASSWORD (смените в приложении)"
fi
