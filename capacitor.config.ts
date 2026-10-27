import type { CapacitorConfig } from '@capacitor/cli'

// Android-приложение: тот же код, что и сайт, но вшит в APK и работает без браузера
const config: CapacitorConfig = {
  appId: 'io.github.ddremlin.windauto',
  appName: 'Windauto',
  webDir: 'dist',
  android: {
    // подключение отладчика Chrome по USB (chrome://inspect) — для разбора проблем на телефоне
    webContentsDebuggingEnabled: true,
    buildOptions: {
      keystorePath: process.env.HOME + '/.android-keys/windauto.jks',
      keystoreAlias: 'windauto',
    },
  },
}

export default config
