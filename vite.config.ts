import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Content-Security-Policy прямо в index.html — для APK (там нет Caddy с заголовком) и вторым слоем для сайта.
// Скрипты — только свои файлы: даже если в данные заказа попадёт <script>, он не выполнится.
// connect-src https: — приложение может подключаться к своему серверу (по умолчанию app.dmerlinauto.vip).
// Только в сборке: в режиме разработки Vite вставляет встроенные скрипты
function csp(): Plugin {
  // тестовая сборка (e2e) ходит на сервер по http://127.0.0.1
  const extra = (process.env.VITE_UPDATE_SERVER ?? '').startsWith('http://') ? ' ' + process.env.VITE_UPDATE_SERVER : ''
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    `connect-src 'self' https:${extra}`,
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'windauto-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), csp()],
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version} (${new Date().toISOString().slice(0, 10)})`),
  },
  server: { host: true },
  preview: { host: true },
})
