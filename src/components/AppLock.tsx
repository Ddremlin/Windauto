import { useEffect, useState, type ReactNode } from 'react'
import { forgetPin, lockMinutes, PIN_RE, removePin, setLockMinutes, setPin, unlock, useAppLocked, useLockConfig, waitLeft } from '../appLock'
import { useSettings } from '../settingsHooks'
import { disconnect } from '../sync'

/** Приложение под PIN-кодом: пока заперто, данные закрыты экраном блокировки и недоступны для нажатий */
export default function AppLock({ children }: { children: ReactNode }) {
  const locked = useAppLocked()
  return (
    <>
      <div inert={locked} aria-hidden={locked} style={locked ? { visibility: 'hidden' } : undefined}>
        {children}
      </div>
      {locked && <LockScreen />}
    </>
  )
}

function LockScreen() {
  const { t } = useSettings()
  const [pin, setPinText] = useState('')
  const [err, setErr] = useState('')
  const [wait, setWait] = useState(waitLeft())

  useEffect(() => {
    if (!wait) return
    const id = setInterval(() => setWait(waitLeft()), 1000)
    return () => clearInterval(id)
  }, [wait])

  const submit = async () => {
    if (!(await unlock(pin))) {
      setPinText('')
      setWait(waitLeft())
      setErr(t('lockPin.wrong'))
    }
  }

  const forgot = async () => {
    if (!confirm(t('lockPin.forgotConfirm'))) return
    await disconnect(() => true)
    forgetPin()
  }

  return (
    <div className="app-lock" role="dialog" aria-modal="true">
      <div className="app-lock-box">
        <div className="app-lock-icon">🔒</div>
        <h1>Windauto</h1>
        <p className="muted">{t('lockPin.enter')}</p>
        <input
          className="pin-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          autoFocus
          value={pin}
          disabled={wait > 0}
          onChange={(e) => setPinText(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        {wait > 0 ? <p className="error-text">{t('lockPin.wait', { n: wait })}</p> : err && <p className="error-text">{err}</p>}
        <button className="btn primary" disabled={wait > 0 || pin.length < 4} onClick={() => void submit()}>
          {t('lockPin.unlock')}
        </button>
        <button className="link-btn" onClick={() => void forgot()}>
          {t('lockPin.forgot')}
        </button>
      </div>
    </div>
  )
}

/** Настройка PIN-кода: включить, сменить время, выключить */
export function PinSettings() {
  const { t } = useSettings()
  const config = useLockConfig()
  const [open, setOpen] = useState(false)
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [err, setErr] = useState('')
  const close = () => {
    setOpen(false)
    setA('')
    setB('')
    setErr('')
  }

  if (!open)
    return (
      <button className="link-btn" onClick={() => setOpen(true)}>
        🔢 {config ? t('lockPin.titleOn') : t('lockPin.title')}
      </button>
    )

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8)
  const pinField = (label: string, value: string, set: (v: string) => void) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={value} onChange={(e) => set(digits(e.target.value))} />
    </label>
  )

  if (config)
    return (
      <div className="stack">
        <label className="field">
          <span className="field-label">{t('lockPin.after')}</span>
          <select value={lockMinutes()} onChange={(e) => setLockMinutes(Number(e.target.value))}>
            {[1, 5, 15, 60].map((m) => (
              <option key={m} value={m}>
                {t('lockPin.minutes', { n: m })}
              </option>
            ))}
          </select>
        </label>
        {pinField(t('lockPin.current'), a, setA)}
        {err && <p className="error-text">{err}</p>}
        <button
          className="btn danger"
          disabled={a.length < 4}
          onClick={async () => ((await removePin(a)) ? close() : setErr(t('lockPin.wrong')))}
        >
          {t('lockPin.off')}
        </button>
        <button className="link-btn" onClick={close}>
          {t('app.close')}
        </button>
      </div>
    )

  return (
    <div className="stack">
      <p className="hint">{t('lockPin.intro')}</p>
      {pinField(t('lockPin.new'), a, setA)}
      {pinField(t('lockPin.again'), b, setB)}
      {err && <p className="error-text">{err}</p>}
      <button
        className="btn primary"
        disabled={!PIN_RE.test(a) || a !== b}
        onClick={async () => {
          await setPin(a)
          close()
        }}
      >
        {t('lockPin.on')}
      </button>
      <button className="link-btn" onClick={close}>
        {t('app.close')}
      </button>
    </div>
  )
}
