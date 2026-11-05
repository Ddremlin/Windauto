import { useMemo, useState } from 'react'
import { calendarAt, isLate, isPlanned, timeText } from '../booking'
import { orderSpan, segmentBackground, spanColor, spansOn, weekSegments, type Span } from '../calendarSpans'
import { orderNo } from '../docNumber'
import TopBar from '../components/TopBar'
import { useSettings } from '../settingsHooks'
import type { Order, OrderStatus } from '../types'
import { formatPlate } from '../validate'
import { ACTIVE_STATUSES, STATUSES } from '../works'

interface Props {
  orders: Order[]
  onOpen: (id: string) => void
  // новая запись на приёмку на день YYYY-MM-DD
  onPlan: (day: string) => void
}

// span — полоски «в ремонте» от приёмки до срока
type Mode = 'span' | 'due' | 'created'
const MODES: Mode[] = ['span', 'due', 'created']
// линий в неделе; остальные — «+n» в дне
const LANES = 6
const MODE_KEY = 'windauto.calMode'
const HIDDEN_KEY = 'windauto.calHidden'
// точек в клетке дня; остальные — «+n»
const DOTS = 4

const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function loadMode(): Mode {
  try {
    const m = localStorage.getItem(MODE_KEY) as Mode | null
    return m && MODES.includes(m) ? m : 'span'
  } catch {
    return 'span'
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
export default function Calendar({ orders, onOpen, onPlan }: Props) {
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
      const k = mode === 'due' ? o.dueDate : dayKey(new Date(calendarAt(o)))
      if (!k) continue
      const list = map.get(k) ?? []
      list.push(o)
      map.set(k, list)
    }
    // внутри дня: приёмка — по времени, срок — по порядку статусов
    for (const list of map.values())
      list.sort(mode === 'due' ? (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) : (a, b) => calendarAt(a) - calendarAt(b))
    return map
  }, [visible, mode])

  const spans = useMemo(() => (mode === 'span' ? visible.map((o) => orderSpan(o, today)) : []), [visible, mode, today])

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
  const daySpans = mode === 'span' && selected && selected !== 'nodue' ? spansOn(spans, selected) : []
  const leftText = (s: Span) =>
    s.state === 'issued'
      ? t('status.issued')
      : s.state === 'planned'
        ? t('book.status')
        : s.left === null
          ? t('span.noDue')
          : s.left < 0
            ? t('span.late', { n: -s.left })
            : s.left === 0
              ? t('span.today')
              : t('span.left', { n: s.left })
  const carOf = (o: Order) => [o.make, o.model].filter(Boolean).join(' ')

  return (
    <div className="screen">
      <TopBar current="calendar" />
      <main className="content">
        <div className="seg-row">
          {MODES.map((m) => (
            <button key={m} className={'seg' + (mode === m ? ' active' : '')} onClick={() => setMode(m)}>
              {t(m === 'span' ? 'cal.bySpan' : m === 'due' ? 'cal.byDue' : 'cal.byCreated')}
            </button>
          ))}
        </div>

        <section className="panel cal">
          <div className="cal-head">
            <button className="icon-btn" aria-label={t('cal.prev')} onClick={() => shiftMonth(-1)}>‹</button>
            <h2 className="cal-title">{title}</h2>
            <button className="icon-btn" aria-label={t('cal.next')} onClick={() => shiftMonth(1)}>›</button>
          </div>
          {mode === 'span' ? (
            <SpanGrid cells={cells} month={month} today={today} selected={selected} onSelect={setSelected} spans={spans} weekdays={weekdays} />
          ) : (
          <div className="cal-grid" role="grid">
            {weekdays.map((w, i) => (
              <span key={i} className={'cal-wd' + (i >= 5 ? ' weekend' : '')}>{w}</span>
            ))}
            {cells.map((d) => {
              const k = dayKey(d)
              const list = byDay.get(k) ?? []
              const other = d.getMonth() !== month.getMonth()
              const late = mode === 'due' ? list.some((o) => isOverdue(o, today)) : list.some((o) => isLate(o))
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
                      <span key={o.id} className={`cal-dot s-${o.status}` + (isPlanned(o) ? ' planned' : '')} />
                    ))}
                    {list.length > DOTS && <span className="cal-more">+{list.length - DOTS}</span>}
                  </span>
                </button>
              )
            })}
          </div>
          )}
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
        <p className="hint">{mode === 'span' ? t('cal.spanLegend') : `${t('cal.legend')} ${t('book.legend')}`}</p>

        {selected && (
          <section className="panel">
            <div className="panel-head">
            <h2>
              {selected === 'nodue'
                ? t('cal.noDue', { n: noDue.length })
                : new Date(selected + 'T12:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
            </h2>
              {selected !== 'nodue' && selected >= today && (
                <button className="btn small primary" onClick={() => onPlan(selected)}>📅 {t('book.add')}</button>
              )}
            </div>
            {mode === 'span' ? (
              daySpans.length === 0 ? (
                <p className="muted">{t('cal.none')}</p>
              ) : (
                <ul className="plain-list cal-orders">
                  {daySpans.map((sp) => {
                    const o = sp.order
                    return (
                      <li key={o.id}>
                        <button className={'cal-order' + (sp.state === 'planned' ? ' planned' : '')} onClick={() => onOpen(o.id)}>
                          <span className="cal-bar" style={{ background: spanColor(sp) }} />
                          <span className="cal-order-text">
                            <b>{o.plate ? formatPlate(o.plate, o.plateCountry) : carOf(o) || t('list.noPlate')}</b>
                            <small className="muted">
                              {[spanDates(sp, locale), o.plate && carOf(o), o.client, o.assignee && `👷 ${o.assignee}`].filter(Boolean).join(' · ')}
                            </small>
                          </span>
                          <span className="status span-left" style={{ color: spanColor(sp), borderColor: spanColor(sp) }}>
                            {sp.state === 'overdue' ? '⚠ ' : ''}
                            {leftText(sp)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )
            ) : dayList.length === 0 ? (
              <p className="muted">{t('cal.none')}</p>
            ) : (
              <ul className="plain-list cal-orders">
                {dayList.map((o) => (
                  <li key={o.id}>
                    <button className={'cal-order' + (isPlanned(o) ? ' planned' : '')} onClick={() => onOpen(o.id)}>
                      {mode === 'created' && <span className="cal-time">{timeText(calendarAt(o), locale)}</span>}
                      <span className={`cal-bar s-${o.status}`} />
                      <span className="cal-order-text">
                        <b>{o.plate ? formatPlate(o.plate, o.plateCountry) : carOf(o) || t('list.noPlate')}</b>
                        <small className="muted">
                          {[o.plate && carOf(o), o.client, o.assignee && `👷 ${o.assignee}`, o.number && `№ ${orderNo(o)}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </span>
                      {isPlanned(o) ? (
                        <span className={'status st-planned' + (isLate(o) ? ' late' : '')}>
                          {isLate(o) ? '⚠ ' + t('book.late') : (o.booking?.confirmed ? '✓ ' : '📅 ') + t('book.status')}
                        </span>
                      ) : (
                        <span className={`status st-${o.status}`}>
                          {mode === 'due' && isOverdue(o, today) ? '⚠ ' + t('cal.overdue') : t(`status.${o.status}`)}
                        </span>
                      )}
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

const shortDate = (d: string, locale: string) => new Date(d + 'T12:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' })
const spanDates = (s: Span, locale: string) => `${shortDate(s.start, locale)} – ${s.open ? '…' : shortDate(s.end, locale)}`

interface GridProps {
  cells: Date[]
  month: Date
  today: string
  selected: string | null
  onSelect: (day: string) => void
  spans: Span[]
  weekdays: string[]
}

// Месяц по неделям: в каждой неделе — клетки дней и поверх них полоски машин в ремонте
function SpanGrid({ cells, month, today, selected, onSelect, spans, weekdays }: GridProps) {
  const { locale } = useSettings()
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))
  return (
    <div className="span-cal" role="grid">
      <div className="span-wds">
        {weekdays.map((w, i) => (
          <span key={i} className={'cal-wd' + (i >= 5 ? ' weekend' : '')}>{w}</span>
        ))}
      </div>
      {weeks.map((week) => {
        const first = dayKey(week[0])
        const { segments, lanes } = weekSegments(spans, first)
        const shown = Math.min(lanes, LANES)
        return (
          <div key={first} className="span-week" style={{ '--lanes': shown } as React.CSSProperties}>
            {week.map((d, col) => {
              const k = dayKey(d)
              const count = segments.filter((g) => g.col0 <= col && g.col1 >= col).length
              const more = segments.filter((g) => g.lane >= LANES && g.col0 <= col && g.col1 >= col).length
              return (
                <button
                  key={k}
                  role="gridcell"
                  aria-selected={selected === k}
                  aria-label={`${d.toLocaleDateString(locale, { day: 'numeric', month: 'long' })}: ${count}`}
                  className={
                    'cal-day span-day' +
                    (d.getMonth() !== month.getMonth() ? ' other' : '') +
                    (k === today ? ' today' : '') +
                    (selected === k ? ' selected' : '') +
                    (col >= 5 ? ' weekend' : '')
                  }
                  onClick={() => onSelect(k)}
                >
                  <span className="cal-num">{d.getDate()}</span>
                  {more > 0 && <span className="cal-more span-more">+{more}</span>}
                </button>
              )
            })}
            {segments
              .filter((g) => g.lane < LANES)
              .map((g) => {
                const o = g.span.order
                const label = o.plate ? formatPlate(o.plate, o.plateCountry) : [o.make, o.model].filter(Boolean).join(' ') || '—'
                return (
                  <span
                    key={o.id}
                    className={'span-bar' + (g.head ? ' head' : '') + (g.tail && !g.span.open ? ' tail' : g.col1 === 6 ? ' edge' : '') + ` st-${g.span.state}`}
                    style={{ '--c0': g.col0, '--c1': g.col1, '--lane': g.lane, background: segmentBackground(g, first) } as React.CSSProperties}
                    title={`${label}: ${spanDates(g.span, locale)}`}
                    aria-hidden
                  />
                )
              })}
          </div>
        )
      })}
    </div>
  )
}
