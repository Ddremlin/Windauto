#!/usr/bin/env bash
# Сборка и публикация на GitHub Pages (ветка gh-pages)
set -euo pipefail
cd "$(dirname "$0")"
npm run build
touch dist/.nojekyll
REMOTE=$(git remote get-url origin)
TMP=$(mktemp -d)
cp -r dist/. "$TMP"
cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name)" -c user.email="$(git -C "$OLDPWD" config user.email)" \
  commit -q -m "Deploy $(date '+%Y-%m-%d %H:%M')"
git -c credential.helper= -c credential.helper="$(git -C "$OLDPWD" config credential.helper)" push -q -f "$REMOTE" gh-pages
cd - >/dev/null
rm -rf "$TMP"
echo "Опубликовано: https://ddremlin.github.io/Windauto/"
