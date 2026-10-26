import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { requestPersistence } from './photos'
import { SettingsProvider } from './settings'
import { initStorage } from './storage'
import { initSync } from './sync'
import './index.css'

// заказы читаются из IndexedDB асинхронно — показываем приложение, когда они загружены
initStorage().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </StrictMode>,
  )
  initSync()
})

requestPersistence()

// офлайн-режим и установка на главный экран (только в собранной версии)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))
}
