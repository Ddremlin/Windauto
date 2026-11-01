// Автотесты интерфейса: собранная веб-версия (dist/) + настоящий сервер синхронизации на временной папке.
// Запуск: npm run e2e (локально — в образе mcr.microsoft.com/playwright, см. README).
// Своя сборка в dist-e2e: отчёты об ошибках и проверка обновлений идут на тестовый сервер, а не в прод
import { defineConfig, devices } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WEB = 4173
const API = 18090
const data = process.env.E2E_DATA ?? (process.env.E2E_DATA = mkdtempSync(join(tmpdir(), 'windauto-e2e-')))

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://127.0.0.1:${WEB}`,
    locale: 'ru-RU',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --host 127.0.0.1 --port ${WEB} --strictPort`,
      url: `http://127.0.0.1:${WEB}`,
      env: { VITE_UPDATE_SERVER: `http://127.0.0.1:${API}` },
      timeout: 180_000,
    },
    {
      command: 'node server/server.mjs',
      url: `http://127.0.0.1:${API}/api/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(API),
        DATA_DIR: data,
        ADMIN_PASSWORD: 'e2e-secret1',
        ALLOWED_ORIGINS: `http://127.0.0.1:${WEB}`,
        MAIL_OUTBOX: join(data, 'mail.jsonl'),
        ANTHROPIC_API_KEY: '',
        NODE_NO_WARNINGS: '1',
      },
    },
  ],
})
