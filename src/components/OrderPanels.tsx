// Разделы карточки заказа: состояние при приёмке, согласие RODO, итоги сметы,
// подписи, история изменений, уведомление «машина готова».
import { useEffect, useState } from 'react'
import { BODY_TYPES, getLayout } from '../body'
import { rodoClause } from '../rodo'
import { signedDigest } from '../signed'
import { useSettings } from '../settingsHooks'
import { mailtoUrl, readyText, smsUrl, whatsappUrl } from '../share'
import { getHistory, useSyncStatus, type HistoryEntry } from '../sync'
import type { Consent, Intake, IntakeItem, Order, Signature, SignatureKind } from '../types'
import { INTAKE_ITEMS, formatMoney, fuelLabel, type Totals } from '../works'
import SignaturePad from './SignaturePad'

// --- состояние автомобиля при приёмке ---
const FUEL_STEPS = [0, 2, 4, 6, 8]

export function IntakePanel({ intake, onChange }: { intake: Intake; onChange: (v: Intake) => void }) {
  const { t } = useSettings()
  const toggle = (id: IntakeItem) =>
    onChange({
      ...intake,
      items: intake.items.includes(id) ? intake.items.filter((x) => x !== id) : INTAKE_ITEMS.filter((x) => x === id || intake.items.includes(x)),
    })
  const keys = intake.keys ?? 0
  return (
    <section className="panel">
      <h2>{t('intake.title')}</h2>
      <span className="field-label">{t('intake.fuel')}</span>
      <div className="seg-row fuel" role="radiogroup" aria-label={t('intake.fuel')}>
        {FUEL_STEPS.map((v) => (
          <button
            key={v}
            role="radio"
            aria-checked={intake.fuel === v}
            className={'seg' + (intake.fuel === v ? ' active' : '')}
            onClick={() => onChange({ ...intake, fuel: intake.fuel === v ? undefined : v })}
          >
            {v === 0 ? t('intake.fuelEmpty') : v === 8 ? t('intake.fuelFull') : fuelLabel(v)}
          </button>
        ))}
      </div>
      <div className="stepper-row">
        <span className="field-label">{t('intake.keys')}</span>
        <div className="stepper">
          <button className="icon-btn" aria-label="−" disabled={keys <= 0} onClick={() => onChange({ ...intake, keys: Math.max(0, keys - 1) })}>−</button>
          <b aria-live="polite">{intake.keys ?? '—'}</b>
          <button className="icon-btn" aria-label="+" onClick={() => onChange({ ...intake, keys: Math.min(9, keys + 1) })}>+</button>
        </div>
      </div>
      <span className="field-label">{t('intake.items')}</span>
      <div className="check-grid">
        {INTAKE_ITEMS.map((id) => (
          <label key={id} className={'check-chip' + (intake.items.includes(id) ? ' on' : '')}>
            <input type="checkbox" checked={intake.items.includes(id)} onChange={() => toggle(id)} />
            {t(`intake.${id}`)}
          </label>
        ))}
      </div>
      <label className="field wide formula">
        <span className="field-label">{t('intake.belongings')}</span>
        <textarea
          rows={2}
          placeholder={t('intake.belongingsPh')}
          value={intake.belongings ?? ''}
          onChange={(e) => onChange({ ...intake, belongings: e.target.value || undefined })}
        />
      </label>
    </section>
  )
}

// --- согласие на обработку данных ---
export function ConsentBlock({ consent, onChange }: { consent: Consent; onChange: (v: Consent) => void }) {
  const { t, settings } = useSettings()
  const [open, setOpen] = useState(false)
  const set = (patch: Partial<Consent>) => {
    const next = { ...consent, ...patch }
    onChange({ ...next, at: next.rodo || next.contact ? Date.now() : undefined })
  }
  return (
    <div className="consent">
      <label className="consent-row">
        <input type="checkbox" checked={consent.rodo} onChange={(e) => set({ rodo: e.target.checked })} />
        <span>{t('consent.rodo')}</span>
      </label>
      <label className="consent-row">
        <input type="checkbox" checked={consent.contact} onChange={(e) => set({ contact: e.target.checked })} />
        <span>{t('consent.contact')}</span>
      </label>
      <button className="link-btn" onClick={() => setOpen(!open)}>
        {open ? t('consent.hide') : t('consent.show')}
      </button>
      {open && <p className="consent-text">{rodoClause(settings, settings.docLang)}</p>}
    </div>
  )
}

// --- итоги сметы ---
export function TotalsView({ totals, discount, onDiscount }: { totals: Totals; discount?: number; onDiscount?: (v: number) => void }) {
  const { t } = useSettings()
  const vat = totals.vatRate > 0
  return (
    <div className="totals">
      {totals.parts > 0 && (
        <>
          <div><span>{t('tot.labor')}</span><span>{formatMoney(totals.labor)}</span></div>
          <div><span>{t('tot.parts')}</span><span>{formatMoney(totals.parts)}</span></div>
        </>
      )}
      {onDiscount && (
        <div className="totals-discount">
          <label htmlFor="discount">{t('tot.discount')}</label>
          <span className="price">
            <input
              id="discount"
              inputMode="decimal"
              placeholder="0"
              defaultValue={discount ? String(discount).replace('.', ',') : ''}
              onChange={(e) => {
                const n = Number(e.target.value.replace(',', '.'))
                onDiscount(Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0)
              }}
            />
            <span>%</span>
          </span>
        </div>
      )}
      {totals.discount > 0 && (
        <div><span>{t('tot.discountSum', { p: totals.discountPct })}</span><span>−{formatMoney(totals.discount)}</span></div>
      )}
      {vat && (
        <>
          <div><span>{t('tot.net')}</span><span>{formatMoney(totals.net)}</span></div>
          <div><span>{t('tot.vat', { r: totals.vatRate })}</span><span>{formatMoney(totals.vat)}</span></div>
        </>
      )}
      <div className="grand-total">
        <span>{vat ? t('tot.gross') : t('order.total')}</span>
        <strong>{formatMoney(totals.gross)}</strong>
      </div>
    </div>
  )
}

// --- подписи ---
const SIG_KINDS: SignatureKind[] = ['acceptClient', 'acceptMaster', 'issueClient']

export function SignaturesPanel({ order, master, onChange }: { order: Order; master: string; onChange: (kind: SignatureKind, s: Signature | undefined) => void }) {
  const { t, locale } = useSettings()
  const [pad, setPad] = useState<SignatureKind | null>(null)
  const issueVisible = order.status === 'done' || order.status === 'issued' || order.signatures.issueClient
  const kinds = SIG_KINDS.filter((k) => k !== 'issueClient' || issueVisible)
  // лист изменили после подписи клиента (работы, цены, данные авто) — предупреждаем
  const accept = order.signatures.acceptClient
  const changedAfter = Boolean(accept?.hash && accept.hash !== signedDigest(order))
  // подписи приёмки — только после кругового видео
  const needVideo = (k: SignatureKind) => k !== 'issueClient' && !order.walkaround
  return (
    <section className="panel">
      <h2>{t('sig.title')}</h2>
      <div className="sig-list">
        {kinds.map((k) => {
          const s = order.signatures[k]
          return (
            <div key={k} className="sig-item">
              <div className="sig-item-head">
                <b>{t(`sig.${k}`)}</b>
                {s && (
                  <small className="muted">
                    {s.name ? s.name + ', ' : ''}
                    {new Date(s.at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}
                  </small>
                )}
              </div>
              {s ? (
                <div className="sig-preview">
                  <img src={s.img} alt={t(`sig.${k}`)} />
                  <button className="btn small ghost" onClick={() => confirm(t('sig.removeConfirm')) && onChange(k, undefined)}>
                    {t('sig.remove')}
                  </button>
                </div>
              ) : needVideo(k) ? (
                <>
                  <button className="btn" disabled>✍ {t('sig.sign')}</button>
                  <small className="warn-text">{t('video.needFirst')}</small>
                </>
              ) : (
                <button className="btn" onClick={() => setPad(k)}>✍ {t('sig.sign')}</button>
              )}
            </div>
          )
        })}
      </div>
      {changedAfter && <p className="warn-text">{t('sig.changedAfter')}</p>}
      {pad && (
        <SignaturePad
          title={t(`sig.${pad}`)}
          statement={pad === 'acceptMaster' ? undefined : t(`sig.statement.${pad}`)}
          defaultName={pad === 'acceptMaster' ? master : order.client}
          onClose={() => setPad(null)}
          onSave={(s) => {
            onChange(pad, pad === 'acceptClient' ? { ...s, hash: signedDigest(order) } : s)
            setPad(null)
          }}
        />
      )}
    </section>
  )
}

// --- машина готова: сообщить клиенту ---
export function ReadyNotice({ order }: { order: Order }) {
  const { t, settings } = useSettings()
  const text = () => readyText(order, settings.docLang, settings)
  if (order.status !== 'done') return null
  return (
    <div className="ready-notice no-print">
      <span>{t('ready.title')}</span>
      <div className="ready-actions">
        <button className="btn small" onClick={() => window.open(whatsappUrl(order.phone, text()), '_blank')} disabled={!order.phone}>
          💬 WhatsApp
        </button>
        <button className="btn small" onClick={() => (window.location.href = smsUrl(order.phone, text()))} disabled={!order.phone}>
          ✉️ SMS
        </button>
        <button
          className="btn small"
          onClick={() => (window.location.href = mailtoUrl(order.email, t('ready.subject'), text()))}
          disabled={!order.email}
        >
          📧 E-mail
        </button>
      </div>
      {!order.consent.contact && <small className="muted">{t('ready.noConsent')}</small>}
    </div>
  )
}

// --- история изменений (только в общей базе) ---
const FIELD_LABEL: Record<string, string> = {
  number: 'order.number',
  status: 'order.status',
  walkaround: 'video.title',
  plate: 'order.plate',
  plateCountry: 'order.plateCountry',
  vin: 'order.vin',
  make: 'order.make',
  model: 'order.model',
  year: 'order.year',
  mileage: 'order.mileage',
  color: 'order.color',
  paintCode: 'order.paintCode',
  paintFormula: 'order.formula',
  paintNotes: 'order.paintNotes',
  bodyType: 'order.body',
  client: 'order.clientName',
  phone: 'order.phone',
  email: 'order.email',
  notes: 'order.notes',
  assignee: 'order.assignee',
  dueDate: 'order.dueDate',
  discount: 'tot.discount',
  intake: 'intake.title',
  consent: 'consent.title',
}

const ALL_ELEMENTS = new Map(BODY_TYPES.flatMap((b) => getLayout(b).elements.map((e) => [e.id, e.key] as const)))

export function HistoryPanel({ orderId }: { orderId: string }) {
  const { t, locale } = useSettings()
  const sync = useSyncStatus()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    getHistory(orderId)
      .then((h) => alive && (setItems(h), setError(null)))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [open, orderId, sync.lastSyncAt])

  if (!sync.connected) return null

  const label = (key: string) => {
    if (key.startsWith('el:')) {
      const k = ALL_ELEMENTS.get(key.slice(3))
      return k ? t(`el.${k}`) : key.slice(3)
    }
    if (key.startsWith('sig:')) return t(`sig.${key.slice(4)}`)
    return FIELD_LABEL[key] ? t(FIELD_LABEL[key]) : key
  }
  const value = (key: string, v: string | undefined) => {
    if (!v) return '—'
    if (key === 'status') return t(`status.${v}`)
    if (key === 'bodyType') return t(`body.${v}`)
    return v
  }

  return (
    <section className="panel no-print">
      <button className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h2>{t('hist.title')}</h2>
        <span>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <>
          {error && <p className="error-text">{error}</p>}
          {!items && !error && <p className="muted">{t('hist.loading')}</p>}
          {items?.length === 0 && <p className="muted">{t('hist.empty')}</p>}
          <ul className="history">
            {items?.map((h, i) => (
              <li key={i}>
                <div className="hist-head">
                  <b>{h.user}</b>
                  <span className="muted">{new Date(h.at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</span>
                </div>
                <div className="hist-action">{t(`hist.${h.action}`)}</div>
                {h.changes.length > 0 && (
                  <ul className="hist-changes">
                    {h.changes.map((c, j) => (
                      <li key={j}>
                        {label(c.key)}
                        {'to' in c && (
                          <span className="muted">
                            : {value(c.key, c.from)} → {value(c.key, c.to)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
