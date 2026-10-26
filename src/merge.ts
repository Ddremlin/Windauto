// Слияние двух версий заказа по полям.
// Каждое изменение поля помечается временем в order._ft; при слиянии по каждому полю
// побеждает более позднее изменение, поэтому правки разных сотрудников в разных полях
// не затирают друг друга. Без отметок (старые версии) — побеждает более новый заказ целиком.
// Та же логика есть на сервере (server/merge.mjs) — менять вместе.
import type { Order } from './types'

const FIXED = new Set(['id', 'createdAt', 'updatedAt', '_ft'])
// вложенные словари, у которых каждая запись — отдельное поле
const MAPS: Record<string, string> = { elements: 'el', signatures: 'sig' }

type AnyOrder = Record<string, unknown> & { updatedAt: number; _ft?: Record<string, number> }

function keysOf(o: AnyOrder): string[] {
  const out: string[] = []
  for (const k of Object.keys(o)) {
    if (FIXED.has(k)) continue
    const prefix = MAPS[k]
    if (prefix) for (const sub of Object.keys((o[k] as object) ?? {})) out.push(`${prefix}:${sub}`)
    else out.push(k)
  }
  return out
}

function split(key: string): [string, string | null] {
  const i = key.indexOf(':')
  if (i < 0) return [key, null]
  const prefix = key.slice(0, i)
  const field = Object.keys(MAPS).find((f) => MAPS[f] === prefix)
  return field ? [field, key.slice(i + 1)] : [key, null]
}

function getField(o: AnyOrder, key: string): unknown {
  const [field, sub] = split(key)
  if (sub === null) return o[field]
  return (o[field] as Record<string, unknown> | undefined)?.[sub]
}

function setField(o: AnyOrder, key: string, value: unknown) {
  const [field, sub] = split(key)
  if (sub === null) {
    if (value === undefined) delete o[field]
    else o[field] = value
    return
  }
  const map = { ...((o[field] as Record<string, unknown>) ?? {}) }
  if (value === undefined) delete map[sub]
  else map[sub] = value
  o[field] = map
}

// сравнение без учёта порядка ключей
const stable = (v: unknown): string =>
  v && typeof v === 'object'
    ? Array.isArray(v)
      ? `[${v.map(stable).join(',')}]`
      : `{${Object.keys(v)
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map((k) => JSON.stringify(k) + ':' + stable((v as Record<string, unknown>)[k]))
          .join(',')}}`
    : JSON.stringify(v) ?? 'undefined'
const same = (a: unknown, b: unknown) => stable(a) === stable(b)

/** Ключи полей, которые отличаются в двух версиях */
export function changedKeys(prev: Order, next: Order): string[] {
  const a = prev as unknown as AnyOrder
  const b = next as unknown as AnyOrder
  const keys = new Set([...keysOf(a), ...keysOf(b)])
  return [...keys].filter((k) => !same(getField(a, k), getField(b, k)))
}

/** Помечает временем поля, изменившиеся относительно prev */
export function stampChanges(prev: Order | undefined, next: Order, at = next.updatedAt): Order {
  if (!prev) return next
  const changed = changedKeys(prev, next)
  if (!changed.length) return next
  const ft = { ...(next._ft ?? {}) }
  for (const k of changed) ft[k] = at
  return { ...next, _ft: ft }
}

/** Слияние двух версий одного заказа */
export function mergeOrders(x: Order, y: Order): Order {
  const a = x as unknown as AnyOrder
  const b = y as unknown as AnyOrder
  const newer = b.updatedAt >= a.updatedAt ? b : a
  const out: AnyOrder = structuredClone(newer)
  const ft: Record<string, number> = {}
  const keys = new Set([...keysOf(a), ...keysOf(b), ...Object.keys(a._ft ?? {}), ...Object.keys(b._ft ?? {})])
  for (const k of keys) {
    const ta = a._ft?.[k] ?? 0
    const tb = b._ft?.[k] ?? 0
    const win = ta > tb ? a : tb > ta ? b : newer
    setField(out, k, structuredClone(getField(win, k)))
    const t = Math.max(ta, tb)
    if (t) ft[k] = t
  }
  out._ft = ft
  out.updatedAt = Math.max(a.updatedAt, b.updatedAt)
  return out as unknown as Order
}

export const sameOrder = (a: Order, b: Order) => same({ ...a, updatedAt: 0 }, { ...b, updatedAt: 0 })
