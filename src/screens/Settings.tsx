import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import SyncSection from '../components/SyncSection'
import { LANGS } from '../i18n'
import { useSettings, type Settings as S } from '../settings'
import { exportJson, importJson } from '../storage'
import { useSyncStatus } from '../sync'
import type { Order, WorkId } from '../types'
import { WORKS } from '../works'

interface Props {
  orders: Order[]
  onImport: (list: Order[]) => void
  onBack: () => void
}

const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`)

export default function Settings({ orders, onImport, onBack }: Props) {
  const { t, settings, update } = useSettings()
  const fileRef = useRef<HTMLInputElement>(null)
  const [used, setUsed] = useState<string>('')
  const sync = useSyncStatus()
  // в общей базе данные сервиса и цены меняет только администратор
  const locked = sync.connected && sync.user?.role !== 'admin'

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => e.usage !== undefined && setUsed(fmtBytes(e.usage)))
  }, [orders])

  const text = (key: keyof S, label: string, extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input value={settings[key] as string} onChange={(e) => update({ [key]: e.target.value })} disabled={locked} {...extra} />
    </label>
  )

  const setPrice = (id: WorkId, raw: string) => {
    const n = Number(raw.replace(/\s/g, '').replace(',', '.'))
    const next = { ...settings.defaultPrices }
    if (raw.trim() && Number.isFinite(n) && n >= 0) next[id] = n
    else delete next[id]
    update({ defaultPrices: next })
  }

  const handleFile = async (f: File | undefined) => {
    if (!f) return
    try {
      const list = await importJson(f)
      if (confirm(t('list.restoreConfirm', { n: list.length, m: orders.length }))) onImport(list)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" aria-label={t('app.back')} onClick={onBack}>←</button>
        <h1>{t('set.title')}</h1>
      </header>

      <main className="content">
        <SyncSection />

        <section className="panel">
          <h2>{t('set.lang')}</h2>
          <div className="seg-row two">
            {LANGS.map((l) => (
              <button key={l.id} className={'seg' + (settings.lang === l.id ? ' active' : '')} onClick={() => update({ lang: l.id })}>
                {l.label}
              </button>
            ))}
          </div>
          <h2>{t('set.docLang')}</h2>
          <div className="seg-row two">
            {LANGS.map((l) => (
              <button key={l.id} className={'seg' + (settings.docLang === l.id ? ' active' : '')} onClick={() => update({ docLang: l.id })}>
                {l.label}
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>{t('set.shop')}</h2>
          <p className="hint">{locked ? t('sync.sharedLocked') : t('set.shopHint')}</p>
          <div className="stack">
            {text('shopName', t('set.shopName'))}
            {text('shopAddress', t('set.shopAddress'))}
            <div className="grid">
              {text('shopPhone', t('set.shopPhone'), { type: 'tel', inputMode: 'tel' })}
              {text('shopNip', t('set.shopNip'), { inputMode: 'numeric' })}
            </div>
          </div>
        </section>

        <section className="panel">
          <h2>{t('set.prices')}</h2>
          <p className="hint">{locked ? t('sync.sharedLocked') : t('set.pricesHint')}</p>
          {/* key: поля без контроля — пересоздаём, когда цены пришли с сервера */}
          <div className="price-list" key={sync.connected && locked ? settings.sharedUpdatedAt : 0}>
            {WORKS.map((w) => (
              <label key={w.id} className="price-row">
                <span className="swatch" style={{ background: w.color }} />
                <span className="price-name">{t(`work.${w.id}`)}</span>
                <span className="price">
                  <input
                    inputMode="decimal"
                    placeholder="—"
                    defaultValue={settings.defaultPrices[w.id] != null ? String(settings.defaultPrices[w.id]).replace('.', ',') : ''}
                    onChange={(e) => setPrice(w.id, e.target.value)}
                    disabled={locked}
                  />
                  <span>zł</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>{t('set.data')}</h2>
          <div className="stack">
            <button className="btn" onClick={() => exportJson(orders)}>{t('list.backup')}</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>{t('list.restore')}</button>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
            {used && <p className="hint">{t('set.storage', { used })}</p>}
            <p className="hint">{t('set.version', { v: __APP_VERSION__ })}</p>
          </div>
        </section>
      </main>
    </div>
  )
}
