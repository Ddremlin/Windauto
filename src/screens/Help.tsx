import { useState } from 'react'
import TopBar from '../components/TopBar'
import { UPDATE_SERVER, openExternal } from '../native'
import { useSettings } from '../settingsHooks'
import { ApiError, sendSupport, useSyncStatus } from '../sync'

const TELEGRAM = 'https://t.me/windautohelp'
type Via = 'email' | 'telegram'

// «Android 16; Pixel 7» из user agent — чтобы разработчик знал, на чём ошибка
const device = () => navigator.userAgent.match(/\(([^)]+)\)/)?.[1].replace(/; wv\b/, '').slice(0, 120) ?? navigator.platform

// Помощь: написать разработчику — письмом через сервер или в Telegram
export default function Help() {
  const { t, settings } = useSettings()
  const sync = useSyncStatus()
  const [via, setVia] = useState<Via>('email')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState(sync.user?.email ?? '')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')

  const info = { version: __APP_VERSION__, device: device(), lang: settings.lang }

  const send = async () => {
    setBusy(true)
    setError('')
    setDone('')
    try {
      await sendSupport({ via, message: message.trim(), contact: contact.trim(), ...info }, UPDATE_SERVER)
      setDone(t('help.sent'))
      setMessage('')
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined
      // бот на сервере не настроен — открываем чат, текст вставят сами
      if (code === 'no_telegram') return openTelegram()
      setError(code && t(`err.${code}`) !== `err.${code}` ? t(`err.${code}`) : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // ссылкой на чат текст не передать — копируем, человек вставляет сам
  const openTelegram = async () => {
    const text = `${message.trim()}\n\n— Windauto ${info.version}, ${info.device}`
    let copied = false
    try {
      await navigator.clipboard.writeText(text)
      copied = true
    } catch {
      /* без буфера — просто откроем чат */
    }
    openExternal(TELEGRAM)
    setDone(copied ? t('help.tgCopied') : '')
  }

  return (
    <div className="screen">
      <TopBar current="help" />
      <main className="content">
        <section className="panel">
          <h2>{t('help.write')}</h2>
          <div className="seg-row two">
            {(['email', 'telegram'] as Via[]).map((v) => (
              <button
                key={v}
                className={'seg' + (via === v ? ' active' : '')}
                onClick={() => {
                  setVia(v)
                  setDone('')
                  setError('')
                }}
              >
                {v === 'email' ? '✉️ E-mail' : '✈️ Telegram'}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="field-label">{t('help.message')}</span>
            <textarea rows={6} maxLength={5000} placeholder={t('help.messagePh')} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">{t('help.contact')}</span>
            <input type="text" inputMode="email" maxLength={200} placeholder={t('help.contactPh')} value={contact} onChange={(e) => setContact(e.target.value)} />
          </label>
          <button className="btn primary wide-btn" disabled={busy || message.trim().length < 3} onClick={send}>
            {busy ? t('help.sending') : t('help.send')}
          </button>
          {via === 'telegram' && (
            <p className="hint">
              {t('help.tgHint')}{' '}
              <button className="link-btn" onClick={openTelegram}>
                @windautohelp
              </button>
            </p>
          )}
          {done && <p className="ok-text">✓ {done}</p>}
          {error && <p className="warn-text">⚠ {error}</p>}
        </section>

        <section className="panel">
          <h2>{t('help.about')}</h2>
          <p className="muted">
            {t('set.version', { v: info.version })}
            <br />
            {t('help.device')}: {info.device}
          </p>
        </section>
      </main>
    </div>
  )
}
