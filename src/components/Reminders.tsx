// Напоминания позвонить клиенту: блок в заказе, список «позвонить» на главном экране и служба уведомлений.
import { useEffect, useState } from 'react'
import {
  BEFORE_OPTIONS,
  askNotifyPermission,
  beforeParts,
  carOf,
  myReminders,
  remindAt,
  toLocalInput,
  whenText,
  type Due,
} from '../reminders'
import { useSettings } from '../settingsHooks'
import { useSyncStatus } from '../sync'
import type { Order, Reminder } from '../types'

type T = ReturnType<typeof useSettings>['t']

const beforeLabel = (t: T, min: number) => {
  if (!min) return t('rem.atTime')
  const { n, unit } = beforeParts(min)
  return t(`rem.before.${unit}`, { n })
}


const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

// время по умолчанию: срок готовности в 10:00, иначе завтра в 10:00
function defaultAt(o: Order): number {
  const d = o.dueDate ? new Date(o.dueDate + 'T10:00') : new Date(Date.now() + 86400_000)
  if (!o.dueDate) d.setHours(10, 0, 0, 0)
  // прошло — через час, округлив до получаса
  return d.getTime() > Date.now() ? d.getTime() : Math.ceil((Date.now() + 3600_000) / 1_800_000) * 1_800_000
}

const newId = () => crypto.randomUUID?.() ?? String(Date.now()) + Math.random().toString(16).slice(2)

/** Блок в заказе: напоминания позвонить этому клиенту */
export function RemindersBlock({ order, onChange }: { order: Order; onChange: (list: Reminder[]) => void }) {
  const { t, locale } = useSettings()
  const sync = useSyncStatus()
  const me = sync.user?.login ?? ''
  const list = (order.reminders ?? []).slice().sort((a, b) => a.at - b.at)
  const [form, setForm] = useState<{ at: string; before: number; note: string } | null>(null)
  const [denied, setDenied] = useState(false)

  const add = async () => {
    if (!form) return
    const at = new Date(form.at).getTime()
    if (!Number.isFinite(at)) return
    onChange([...(order.reminders ?? []), { id: newId(), at, before: form.before, note: form.note.trim(), user: me }])
    setForm(null)
    setDenied(!(await askNotifyPermission()))
  }
  const patch = (id: string, p: Partial<Reminder>) => onChange((order.reminders ?? []).map((r) => (r.id === id ? { ...r, ...p } : r)))
  const remove = (id: string) => onChange((order.reminders ?? []).filter((r) => r.id !== id))

  return (
    <div className="reminders no-print">
      {list.map((r) => {
        const late = !r.done && remindAt(r) <= Date.now()
        return (
          <div key={r.id} className={'reminder' + (r.done ? ' done' : late ? ' late' : '')}>
            <button className="reminder-check" aria-label={t('rem.done')} aria-pressed={!!r.done} onClick={() => patch(r.id, { done: !r.done })}>
              {r.done ? '✓' : ''}
            </button>
            <span className="reminder-text">
              <b>📞 {whenText(r.at, locale)}</b>
              <small className="muted">
                {[beforeLabel(t, r.before), r.user && r.user !== me && `👷 ${r.user}`, r.note].filter(Boolean).join(' · ')}
              </small>
            </span>
            <button className="link-btn" aria-label={t('app.clear')} onClick={() => remove(r.id)}>✕</button>
          </div>
        )
      })}

      {form ? (
        <div className="reminder-form">
          <label className="field">
            <span className="field-label">{t('rem.when')}</span>
            <input type="datetime-local" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} />
          </label>
          <span className="field-label">{t('rem.remind')}</span>
          <div className="check-grid">
            {BEFORE_OPTIONS.map((m) => (
              <button key={m} type="button" className={'check-chip' + (form.before === m ? ' on' : '')} onClick={() => setForm({ ...form, before: m })}>
                {beforeLabel(t, m)}
              </button>
            ))}
          </div>
          <input type="text" placeholder={t('rem.notePh')} value={form.note} maxLength={200} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div className="reminder-actions">
            <button className="btn ghost" onClick={() => setForm(null)}>{t('app.cancel')}</button>
            <button className="btn primary" disabled={!form.at} onClick={add}>{t('rem.save')}</button>
          </div>
        </div>
      ) : (
        <button className="btn small" onClick={() => setForm({ at: toLocalInput(defaultAt(order)), before: 60, note: '' })}>
          ⏰ {t('rem.add')}
        </button>
      )}
      {denied && <p className="warn-text">⚠ {t('rem.denied')}</p>}
    </div>
  )
}

/** Главный экран: кому пора звонить (и что будет сегодня) */
export function RemindersBanner({ orders, onSave, onOpen }: { orders: Order[]; onSave: (o: Order) => void; onOpen: (id: string) => void }) {
  const { t, locale } = useSettings()
  const sync = useSyncStatus()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])
  const now = Date.now()
  const endOfDay = new Date().setHours(23, 59, 59, 999)
  // пора звонить — и всё, о чём напомнят до конца дня
  const list = myReminders(orders, sync.user?.login ?? '').filter((d) => remindAt(d.r) <= endOfDay)
  if (!list.length) return null

  const done = ({ order, r }: Due) =>
    onSave({ ...order, reminders: (order.reminders ?? []).map((x) => (x.id === r.id ? { ...x, done: true } : x)), updatedAt: Date.now() })

  return (
    <section className="reminder-banner">
      {list.map((d) => {
        const due = remindAt(d.r) <= now
        return (
          <div key={d.r.id} className={'reminder' + (due ? ' late' : '')}>
            <button className="reminder-check" aria-label={t('rem.done')} onClick={() => done(d)} />
            <button className="reminder-text plain" onClick={() => onOpen(d.order.id)}>
              <b>
                📞 {d.order.client || d.order.phone || t('cl.noName')}
                <span className="muted"> · {new Date(d.r.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
              </b>
              <small className="muted">{[carOf(d.order), d.r.note].filter(Boolean).join(' · ')}</small>
            </button>
            {d.order.phone && (
              <a className="btn small primary" href={telHref(d.order.phone)}>
                {t('rem.callBtn')}
              </a>
            )}
          </div>
        )
      })}
    </section>
  )
}
