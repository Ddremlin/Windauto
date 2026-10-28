import type { CapacitorConfig } from '@capacitor/cli'

// Android-приложение: тот же код, что и сайт, но вшит в APK и работает без браузера
const config: CapacitorConfig = {
  appId: 'io.github.ddremlin.windauto',
  appName: 'Windauto',
  webDir: 'dist',
  android: {
    // отладчик Chrome по USB (chrome://inspect) даёт полный доступ к данным приложения —
    // только в сборке для разбора проблем: WEBVIEW_DEBUG=1 ./scripts/build-apk.sh
    webContentsDebuggingEnabled: process.env.WEBVIEW_DEBUG === '1',
    buildOptions: {
      keystorePath: process.env.HOME + '/.android-keys/windauto.jks',
      keystoreAlias: 'windauto',
    },
  },
}

export default config
