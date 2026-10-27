#!/usr/bin/env bash
# Сборка Android-приложения: сайт → в APK → подпись. Результат — release-apk/windauto.apk и latest.json
# для сервера (выложить в /opt/windauto/data/app/). Перед выпуском поднимите version в package.json.
set -euo pipefail
cd "$(dirname "$0")/.."

# Capacitor CLI нужна Node 22+, сборке Android — JDK 21
NODE24=$(ls -d ~/.nvm/versions/node/v2[2-9]*/bin 2>/dev/null | tail -1 || true)
[ -n "$NODE24" ] && export PATH="$NODE24:$PATH"
export JAVA_HOME=${JAVA_HOME_21:-$HOME/.jdks/temurin-21.0.12}

npm run build
npx cap sync android
(cd android && ./gradlew assembleRelease --no-daemon -q)

VERSION=$(node -p "require('./package.json').version")
CODE=$(node -p "const [a,b,c]=require('./package.json').version.split('.').map(n=>parseInt(n));a*10000+b*100+c")
mkdir -p release-apk
cp android/app/build/outputs/apk/release/app-release.apk release-apk/windauto.apk
echo "{\"versionCode\": $CODE, \"versionName\": \"$VERSION\"}" > release-apk/latest.json
echo "Готово: release-apk/windauto.apk ($VERSION, versionCode $CODE)"
