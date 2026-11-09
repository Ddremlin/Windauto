import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import AppLock from './components/AppLock'
import { initAppLock } from './appLock'
import { requestPersistence } from './photos'
import { SettingsProvider } from './settings'
import { isNative } from './native'
import { initStorage } from './storage'
import { initSync, reportTarget } from './sync'
import { initErrorReports } from './errorReport'
import { getSettings } from './settingsStore'
import { applyTheme } from './theme'
import './index.css'

initErrorReports(reportTarget)
// цвета — до первого кадра, чтобы не мигала тема по умолчанию
applyTheme(getSettings().theme, getSettings().palette)

// заказы читаются из IndexedDB асинхронно — показываем приложение, когда они загружены
initStorage().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <SettingsProvider>
        <AppLock>
          <App />
        </AppLock>
      </SettingsProvider>
    </StrictMode>,
  )
  initSync()
})

requestPersistence()
initAppLock()

// офлайн-режим и установка на главный экран (только в собранной версии сайта; приложению он не нужен)
if (import.meta.env.PROD && !isNative && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))
}
