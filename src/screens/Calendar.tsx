import { useMemo, useState } from 'react'
import { orderNo } from '../docNumber'
import TopBar from '../components/TopBar'
import { useSettings } from '../settingsHooks'
import type { Order, OrderStatus } from '../types'
import { formatPlate } from '../validate'
import { ACTIVE_STATUSES, STATUSES } from '../works'

interface Props {
  orders: Order[]
  onOpen: (id: string) => void
}

type Mode = 'due' | 'created'
const MODE_KEY = 'windauto.calMode'
const HIDDEN_KEY = 'windauto.calHidden'
// точек в клетке дня; остальные — «+n»
const DOTS = 4

const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'created' ? 'created' : 'due'
  } catch {
    return 'due'
  }
}

function loadHidden(): OrderStatus[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((s) => STATUSES.includes(s)) : []
  } catch {
    return []
  }
}

const remember = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* только на эту сессию */
  }
}

const isOverdue = (o: Order, today: string) => Boolean(o.dueDate) && ACTIVE_STATUSES.includes(o.status) && o.status !== 'done' && o.dueDate < today

// Календарь заказов: по сроку готовности или по дню приёмки, цвет — статус
export default function Calendar({ orders, onOpen }: Props) {
  const { t, locale } = useSettings()
  const today = dayKey(new Date())
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [selected, setSelected] = useState<string | null>(today)
  const [mode, setModeState] = useState<Mode>(loadMode)
  const [hidden, setHiddenState] = useState<OrderStatus[]>(loadHidden)

  const setMode = (m: Mode) => {
    setModeState(m)
    remember(MODE_KEY, m)
  }
  const toggleStatus = (s: OrderStatus) => {
    const next = hidden.includes(s) ? hidden.filter((x) => x !== s) : [...hidden, s]
    setHiddenState(next)
    remember(HIDDEN_KEY, JSON.stringify(next))
  }

  const visible = useMemo(() => orders.filter((o) => !hidden.includes(o.status)), [orders, hidden])

  const byDay = useMemo(() => {
    const map = new Map<string, Order[]>()
    for (const o of visible) {
      const k = mode === 'due' ? o.dueDate : dayKey(new Date(o.createdAt))
      if (!k) continue
      const list = map.get(k) ?? []
      list.push(o)
      map.set(k, list)
    }
    // внутри дня — по порядку статусов
    for (const list of map.values()) list.sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status))
    return map
  }, [visible, mode])

  const noDue = mode === 'due' ? visible.filter((o) => !o.dueDate && o.status !== 'issued') : []

  // сетка месяца с понедельника, 6 недель не нужны — сколько займёт
  const cells = useMemo(() => {
    const first = new Date(month)
    const shift = (first.getDay() + 6) % 7
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - shift)
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    const total = Math.ceil((shift + days) / 7) * 7
    return Array.from({ length: total }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }, [month])

  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' })),
    [locale],
  )

  const shiftMonth = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))
  const goToday = () => {
    const d = new Date()
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1))
    setSelected(today)
  }

  // без «г.» в русском: «Октябрь 2026»
  const title = `${month.toLocaleDateString(locale, { month: 'long' })} ${month.getFullYear()}`
  const dayList = selected === 'nodue' ? noDue : selected ? (byDay.get(selected) ?? []) : []
  const carOf = (o: Order) => [o.make, o.model].filter(Boolean).join(' ')

  return (
    <div className="screen">
      <TopBar current="calendar" />
      <main className="content">
        <div className="seg-row two">
          {(['due', 'created'] as Mode[]).map((m) => (
            <button key={m} className={'seg' + (mode === m ? ' active' : '')} onClick={() => setMode(m)}>
              {t(m === 'due' ? 'cal.byDue' : 'cal.byCreated')}
            </button>
          ))}
        </div>

        <section className="panel cal">
          <div className="cal-head">
            <button className="icon-btn" aria-label={t('cal.prev')} onClick={() => shiftMonth(-1)}>‹</button>
            <h2 className="cal-title">{title}</h2>
            <button className="icon-btn" aria-label={t('cal.next')} onClick={() => shiftMonth(1)}>›</button>
          </div>
          <div className="cal-grid" role="grid">
            {weekdays.map((w, i) => (
              <span key={i} className={'cal-wd' + (i >= 5 ? ' weekend' : '')}>{w}</span>
            ))}
            {cells.map((d) => {
              const k = dayKey(d)
              const list = byDay.get(k) ?? []
              const other = d.getMonth() !== month.getMonth()
              const late = mode === 'due' && list.some((o) => isOverdue(o, today))
              return (
                <button
                  key={k}
                  role="gridcell"
                  aria-selected={selected === k}
                  aria-label={`${d.toLocaleDateString(locale, { day: 'numeric', month: 'long' })}: ${list.length}`}
                  className={
                    'cal-day' +
                    (other ? ' other' : '') +
                    (k === today ? ' today' : '') +
                    (selected === k ? ' selected' : '') +
                    (late ? ' late' : '') +
                    ((d.getDay() + 6) % 7 >= 5 ? ' weekend' : '')
                  }
                  onClick={() => setSelected(k)}
                >
                  <span className="cal-num">{d.getDate()}</span>
                  <span className="cal-dots">
                    {list.slice(0, DOTS).map((o) => (
                      <span key={o.id} className={`cal-dot s-${o.status}`} />
                    ))}
                    {list.length > DOTS && <span className="cal-more">+{list.length - DOTS}</span>}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="cal-foot">
            <button className="btn small" onClick={goToday}>{t('cal.today')}</button>
            {noDue.length > 0 && (
              <button className={'btn small ghost' + (selected === 'nodue' ? ' active' : '')} onClick={() => setSelected('nodue')}>
                {t('cal.noDue', { n: noDue.length })}
              </button>
            )}
          </div>
        </section>

        <div className="status-counts" role="group" aria-label={t('cal.legend')}>
          {STATUSES.map((s) => (
            <button
              key={s}
              className={`status cal-legend st-${s}` + (hidden.includes(s) ? ' off' : '')}
              aria-pressed={!hidden.includes(s)}
              onClick={() => toggleStatus(s)}
            >
              <span className={`cal-dot s-${s}`} /> {t(`status.${s}`)}
            </button>
          ))}
        </div>
        <p className="hint">{t('cal.legend')}</p>

        {selected && (
          <section className="panel">
            <h2>
              {selected === 'nodue'
                ? t('cal.noDue', { n: noDue.length })
                : new Date(selected + 'T12:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
            </h2>
            {dayList.length === 0 ? (
              <p className="muted">{t('cal.none')}</p>
            ) : (
              <ul className="plain-list cal-orders">
                {dayList.map((o) => (
                  <li key={o.id}>
                    <button className="cal-order" onClick={() => onOpen(o.id)}>
                      <span className={`cal-bar s-${o.status}`} />
                      <span className="cal-order-text">
                        <b>{o.plate ? formatPlate(o.plate, o.plateCountry) : carOf(o) || t('list.noPlate')}</b>
                        <small className="muted">
                          {[o.plate && carOf(o), o.client, o.assignee && `👷 ${o.assignee}`, o.number && `№ ${orderNo(o)}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </span>
                      <span className={`status st-${o.status}`}>
                        {mode === 'due' && isOverdue(o, today) ? '⚠ ' + t('cal.overdue') : t(`status.${o.status}`)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
