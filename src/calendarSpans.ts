// Полоски «машина в ремонте» для календаря: от дня приёмки до срока готовности (или дня выдачи).
// Дни — строки YYYY-MM-DD в местном времени, их можно сравнивать как строки.
import { calendarAt, isPlanned, localDay } from './booking'
import type { Order } from './types'

export type SpanState = 'planned' | 'active' | 'ready' | 'overdue' | 'issued'

export interface Span {
  order: Order
  start: string
  end: string
  // срока нет — полоска идёт до сегодня
  open: boolean
  state: SpanState
  // доля пройденного пути до срока: 0 — только приняли, 1 — срок сегодня
  ratio: number
  // дней до срока (отрицательное — просрочен); null — срока нет
  left: number | null
}

const DAY = 86400_000
// за сколько дней до срока полоска начинает желтеть
const URGENT_DAYS = 7
const dayMs = (d: string) => new Date(d + 'T12:00').getTime()
export const daysBetween = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / DAY)
export const addDays = (d: string, n: number) => localDay(dayMs(d) + n * DAY)

export function orderSpan(o: Order, today: string): Span {
  const start = localDay(calendarAt(o))
  const due = o.dueDate || ''
  let end: string
  let state: SpanState
  if (o.status === 'issued') {
    state = 'issued'
    // без подписи при выдаче день выдачи неизвестен — срок, иначе последняя правка
    const at = o.signatures.issueClient?.at
    end = at ? localDay(at) : due || localDay(o.updatedAt)
  } else if (isPlanned(o)) {
    state = 'planned'
    end = due || start
  } else if (o.status === 'done') {
    // готова и ждёт клиента — до срока, а если он прошёл, до сегодня
    state = 'ready'
    end = due && due > today ? due : today
  } else if (due && due < today) {
    state = 'overdue'
    end = today
  } else {
    state = 'active'
    end = due || today
  }
  if (end < start) end = start
  const left = due ? daysBetween(today, due) : null
  const total = due ? Math.max(1, daysBetween(start, due)) : 0
  const ratio = due ? Math.min(1, Math.max(0, daysBetween(start, today) / total)) : 0
  return { order: o, start, end, open: !due && state !== 'issued', state, ratio, left }
}

/** Цвет полоски: зелёный в начале ремонта → жёлтый → красный к сроку; просрочка — тёмно-красный */
export function spanColor(s: Span): string {
  if (s.state === 'issued') return 'hsl(30 8% 62%)'
  if (s.state === 'ready') return 'hsl(122 45% 40%)'
  if (s.state === 'overdue') return 'hsl(0 75% 40%)'
  if (s.open) return 'hsl(35 25% 55%)'
  // краснеет и по пройденной части ремонта, и по дням до срока (за неделю — уже желтеет)
  const urgency = Math.max(s.ratio, s.left === null ? 0 : 1 - Math.max(0, s.left) / URGENT_DAYS)
  return `hsl(${Math.round(120 * (1 - Math.min(1, urgency)))} 70% 42%)`
}

/** Цвет линии в конкретный день: от зелёного в день приёмки до красного в день выдачи */
export function dayColor(s: Span, day: string): string {
  if (s.state === 'issued') return 'hsl(30 8% 62%)'
  const due = s.order.dueDate
  if (!due) return 'hsl(35 25% 55%)'
  if (day > due) return 'hsl(0 75% 38%)'
  const f = Math.min(1, Math.max(0, daysBetween(s.start, day) / Math.max(1, daysBetween(s.start, due))))
  return `hsl(${Math.round(120 * (1 - f))} 70% 45%)`
}

/** Фон куска линии в неделе: цвет по каждому дню, переходы плавные */
export function segmentBackground(g: Segment, first: string): string {
  const n = g.col1 - g.col0 + 1
  const stops = Array.from({ length: n }, (_, i) => `${dayColor(g.span, addDays(first, g.col0 + i))} ${(((i + 0.5) / n) * 100).toFixed(1)}%`)
  return n === 1 ? dayColor(g.span, addDays(first, g.col0)) : `linear-gradient(to right, ${stops.join(', ')})`
}

export interface Segment {
  span: Span
  // столбцы недели 0–6 включительно
  col0: number
  col1: number
  lane: number
  // полоска начинается / кончается в этой неделе (скруглённые края)
  head: boolean
  tail: boolean
}

/** Куски полосок в неделе (7 дней с first) и их ряды: длинные и ранние — выше */
export function weekSegments(spans: Span[], first: string): { segments: Segment[]; lanes: number } {
  const last = addDays(first, 6)
  const list = spans
    .filter((s) => s.start <= last && s.end >= first)
    .sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || a.order.id.localeCompare(b.order.id))
  const laneEnd: number[] = []
  const segments: Segment[] = []
  for (const span of list) {
    const col0 = span.start < first ? 0 : daysBetween(first, span.start)
    const col1 = span.end > last ? 6 : daysBetween(first, span.end)
    let lane = laneEnd.findIndex((e) => e < col0)
    if (lane < 0) lane = laneEnd.length
    laneEnd[lane] = col1
    segments.push({ span, col0, col1, lane, head: span.start >= first, tail: span.end <= last })
  }
  return { segments, lanes: laneEnd.length }
}

/** Машины, чьи полоски проходят через день: сначала с ближайшим сроком */
export function spansOn(spans: Span[], day: string): Span[] {
  return spans
    .filter((s) => s.start <= day && s.end >= day)
    .sort((a, b) => (a.left ?? 1e9) - (b.left ?? 1e9) || a.start.localeCompare(b.start))
}
