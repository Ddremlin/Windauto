// Общий поиск: одна строка — клиенты, машины и заказы сразу.
// Без учёта регистра и диакритики (ł = l, ś = s, ё = е), несколько слов — все должны найтись
// («škoda kowal»), номер — с пробелами и без («wa12» найдёт «WA 12345»), телефон — по цифрам.
import { clientKey, listClients, type ClientInfo } from './clients'
import type { Order } from './types'
import { normalizePlate } from './validate'

/** Один символ без регистра и диакритики; ł и đ не раскладываются — отдельно */
function foldChar(c: string): string {
  const lower = c.toLowerCase()
  if (lower === 'ł') return 'l'
  if (lower === 'đ') return 'd'
  if (lower === 'ß') return 's'
  const base = lower.normalize('NFD').replace(/[̀-ͯ]/g, '')
  return base || lower
}

export const fold = (s: string) => [...s].map(foldChar).join('')

const digitsOf = (s: string) => s.replace(/\D/g, '')

export interface Query {
  tokens: string[]
}

export function parseQuery(q: string): Query {
  return { tokens: fold(q).split(/\s+/).filter(Boolean) }
}

/** Запрос похож на телефон («+48 600 100», «600-100-200»): варианты цифр без польского префикса 48 / 0048 */
function phoneDigits(q: Query): string[] {
  const raw = q.tokens.join(' ')
  if (!/^[\d\s+()-]+$/.test(raw)) return []
  const d = digitsOf(raw)
  const local = d.replace(/^(00)?48(?=\d{3})/, '')
  return d.length < 3 ? [] : [...new Set([d, local])].filter((x) => x.length >= 3)
}

/** Каждое слово запроса есть в тексте (или, если слово — цифры от 3, в цифрах телефона) */
function matchAll(q: Query, text: string, digits = ''): boolean {
  const phone = phoneDigits(q)
  if (digits && phone.some((d) => digits.includes(d))) return true
  return q.tokens.every((tok) => {
    if (text.includes(tok)) return true
    const d = digitsOf(tok)
    return d.length >= 3 && d.length === tok.replace(/[\s+()-]/g, '').length && digits.includes(d)
  })
}

const plateKey = (o: Pick<Order, 'plate'>) => normalizePlate(o.plate)

function orderText(o: Order): string {
  return fold(
    [o.number, o.plate, plateKey(o), o.vin, o.make, o.model, o.year, o.color, o.paintCode, o.client, o.phone, o.email, o.notes, o.assignee].join(' '),
  )
}

export interface CarHit {
  key: string
  plate: string
  plateCountry: string
  vin: string
  car: string
  client: string
  // заказы этой машины, новые сверху
  orders: Order[]
  // карточка владельца (последнего), если его можно определить
  clientKey: string
}

export interface SearchResult {
  clients: ClientInfo[]
  cars: CarHit[]
  orders: Order[]
}

const EMPTY: SearchResult = { clients: [], cars: [], orders: [] }

/** Машины: по номеру, без номера — по VIN */
function listCars(orders: Order[]): CarHit[] {
  const map = new Map<string, Order[]>()
  for (const o of orders) {
    const k = plateKey(o) || o.vin.trim().toUpperCase()
    if (!k) continue
    const g = map.get(k) ?? []
    g.push(o)
    map.set(k, g)
  }
  return [...map].map(([key, list]) => {
    const sorted = list.slice().sort((a, b) => b.createdAt - a.createdAt)
    const pick = (f: (o: Order) => string) => sorted.map(f).find((v) => v.trim())?.trim() ?? ''
    const last = sorted[0]
    return {
      key,
      plate: pick((o) => o.plate),
      plateCountry: last.plateCountry,
      vin: pick((o) => o.vin),
      car: pick((o) => [o.make, o.model].filter(Boolean).join(' ')),
      client: pick((o) => o.client),
      orders: sorted,
      clientKey: clientKey(last),
    }
  })
}

export function search(orders: Order[], q: string): SearchResult {
  const query = parseQuery(q)
  if (!query.tokens.length) return EMPTY
  const clients = listClients(orders).filter((c) =>
    matchAll(
      query,
      fold([c.name, c.email, c.phone, ...c.cars.flatMap((car) => [car.car, car.plate, normalizePlate(car.plate)])].join(' ')),
      digitsOf(c.phone),
    ),
  )
  const cars = listCars(orders)
    .filter((car) => matchAll(query, fold([car.plate, car.key, car.vin, car.car, car.client].join(' '))))
    .sort((a, b) => b.orders[0].createdAt - a.orders[0].createdAt)
  const found = orders.filter((o) => matchAll(query, orderText(o), digitsOf(o.phone))).sort((a, b) => b.updatedAt - a.updatedAt)
  return { clients, cars, orders: found }
}

/** Куски текста для подсветки: [текст, совпало?]. Совпадения ищутся без регистра и диакритики */
export function highlight(text: string, q: Query): [string, boolean][] {
  if (!text || !q.tokens.length) return [[text, false]]
  const chars = [...text]
  const folded = chars.map(foldChar)
  // позиция в сложенной строке → индекс символа исходной
  const owner: number[] = []
  folded.forEach((f, i) => {
    for (let k = 0; k < f.length; k++) owner.push(i)
  })
  const flat = folded.join('')
  const mark = new Array<boolean>(chars.length).fill(false)
  for (const tok of q.tokens) {
    let from = 0
    for (;;) {
      const at = flat.indexOf(tok, from)
      if (at < 0) break
      for (let p = at; p < at + tok.length; p++) mark[owner[p]] = true
      from = at + tok.length
    }
  }
  const out: [string, boolean][] = []
  chars.forEach((c, i) => {
    const last = out[out.length - 1]
    if (last && last[1] === mark[i]) last[0] += c
    else out.push([c, mark[i]])
  })
  return out
}
