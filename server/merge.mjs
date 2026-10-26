// Слияние двух версий заказа по полям — копия src/merge.ts (менять вместе).
// order._ft: время изменения каждого поля; ключ — имя поля или «el:<id>» / «sig:<вид>».
const FIXED = new Set(['id', 'createdAt', 'updatedAt', '_ft'])
const MAPS = { elements: 'el', signatures: 'sig' }
const PREFIX_FIELD = Object.fromEntries(Object.entries(MAPS).map(([f, p]) => [p, f]))

function keysOf(o) {
  const out = []
  for (const k of Object.keys(o)) {
    if (FIXED.has(k)) continue
    const prefix = MAPS[k]
    if (prefix) for (const sub of Object.keys(o[k] ?? {})) out.push(`${prefix}:${sub}`)
    else out.push(k)
  }
  return out
}

function split(key) {
  const i = key.indexOf(':')
  if (i < 0) return [key, null]
  const field = PREFIX_FIELD[key.slice(0, i)]
  return field ? [field, key.slice(i + 1)] : [key, null]
}

export function getField(o, key) {
  const [field, sub] = split(key)
  return sub === null ? o[field] : o[field]?.[sub]
}

function setField(o, key, value) {
  const [field, sub] = split(key)
  if (sub === null) {
    if (value === undefined) delete o[field]
    else o[field] = value
    return
  }
  const map = { ...(o[field] ?? {}) }
  if (value === undefined) delete map[sub]
  else map[sub] = value
  o[field] = map
}

const stable = (v) =>
  v && typeof v === 'object'
    ? Array.isArray(v)
      ? `[${v.map(stable).join(',')}]`
      : `{${Object.keys(v)
          .filter((k) => v[k] !== undefined)
          .sort()
          .map((k) => JSON.stringify(k) + ':' + stable(v[k]))
          .join(',')}}`
    : (JSON.stringify(v) ?? 'undefined')

export const same = (a, b) => stable(a) === stable(b)

export function changedKeys(prev, next) {
  const keys = new Set([...keysOf(prev), ...keysOf(next)])
  return [...keys].filter((k) => !same(getField(prev, k), getField(next, k)))
}

export function mergeOrders(a, b) {
  const newer = b.updatedAt >= a.updatedAt ? b : a
  const out = structuredClone(newer)
  const ft = {}
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
  return out
}

/** Одинаковые ли заказы, не считая updatedAt */
export const sameOrder = (a, b) => same({ ...a, updatedAt: 0 }, { ...b, updatedAt: 0 })
