import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import TopBar from '../components/TopBar'
import LangSelect from '../components/LangSelect'
import { rodoClause } from '../rodo'
import { useSettings } from '../settingsHooks'
import { CURRENCIES, currencyOf, currencySymbol, type Currency, type Settings as S } from '../settingsStore'
import { exportJson, importJson } from '../storage'
import { useSyncStatus } from '../sync'
import type { Order, WorkId } from '../types'
import { WORKS } from '../works'

interface Props {
  orders: Order[]
  onImport: (list: Order[]) => void
}

const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`)

export default function Settings({ orders, onImport }: Props) {
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
      <TopBar current="settings" />

      <main className="content">
        <section className="panel">
          <h2>{t('set.lang')}</h2>
          <LangSelect
            value={settings.lang}
            label={t('set.lang')}
            // польский интерфейс — и сообщения клиенту по-польски
            onChange={(lang) => update(lang === 'pl' ? { lang, docLang: 'pl' } : { lang })}
          />
          <h2>{t('set.docLang')}</h2>
          <LangSelect value={settings.docLang} label={t('set.docLang')} onChange={(docLang) => update({ docLang })} />
          <h2>{t('set.currency')}</h2>
          {settings.lang === 'pl' ? (
            <p className="hint">{t('set.currencyPl')}</p>
          ) : (
            <>
              <select value={currencyOf(settings)} onChange={(e) => update({ currency: e.target.value as Currency })}>
                {(Object.keys(CURRENCIES) as Currency[]).map((c) => (
                  <option key={c} value={c}>
                    {c} — {CURRENCIES[c]}
                  </option>
                ))}
              </select>
              <p className="hint">{t('set.currencyHint')}</p>
            </>
          )}
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
            <label className="field">
              <span className="field-label">{t('set.rodo')}</span>
              <textarea
                rows={4}
                placeholder={rodoClause({ ...settings, rodoText: '' }, settings.docLang)}
                value={settings.rodoText}
                onChange={(e) => update({ rodoText: e.target.value })}
                disabled={locked}
              />
              <span className="field-hint muted">{t('set.rodoHint')}</span>
            </label>
          </div>
        </section>

        <section className="panel">
          <h2>{t('set.prices')}</h2>
          <p className="hint">{locked ? t('sync.sharedLocked') : t('set.pricesHint')}</p>
          <div className="seg-row two">
            {[true, false].map((g) => (
              <button key={String(g)} className={'seg' + (settings.pricesGross === g ? ' active' : '')} onClick={() => update({ pricesGross: g })} disabled={locked}>
                {t(g ? 'set.gross' : 'set.net')}
              </button>
            ))}
          </div>
          <label className="price-row vat-row" key={'vat' + (locked ? settings.sharedUpdatedAt : 0)}>
            <span className="price-name">{t('set.vat')}</span>
            <span className="price">
              <input
                inputMode="numeric"
                defaultValue={String(settings.vatRate)}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(',', '.'))
                  if (e.target.value.trim() === '' || (Number.isFinite(n) && n >= 0 && n <= 50)) update({ vatRate: e.target.value.trim() === '' ? 0 : n })
                }}
                disabled={locked}
              />
              <span>%</span>
            </span>
          </label>
          <p className="hint">{t('set.vatHint')}</p>
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
                  <span>{currencySymbol()}</span>
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
