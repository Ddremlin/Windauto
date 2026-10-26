// Заказы: единое хранилище в памяти + IndexedDB.
// Экраны подписываются через useOrders, синхронизация — через onLocalChange.
// До версии 1.3 заказы лежали в localStorage — при первом запуске переносим их.
import { useSyncExternalStore } from 'react'
import { stampChanges } from './merge'
import { tx, writeMany } from './idb'
import { orderPhotoIds, photosToDataUrls, restorePhotos } from './photos'
import type { Order, OrderStatus } from './types'

const LEGACY_KEY = 'windauto.orders.v1'
const COUNTER_KEY = 'windauto.counter.v1'

// дополняет заказы из старых версий новыми полями
export function migrate(o: Partial<Order>): Order {
  const base = newOrder()
  const m = { ...base, ...o } as Order
  m.intake = { ...base.intake, ...(o.intake ?? {}) }
  m.consent = { ...base.consent, ...(o.consent ?? {}) }
  m.signatures = { ...(o.signatures ?? {}) }
  m.elements = { ...(o.elements ?? {}) }
  if (!STATUSES_ALL.includes(m.status)) m.status = 'new'
  return m
}

const STATUSES_ALL: OrderStatus[] = ['new', 'in_work', 'waiting_parts', 'done', 'issued']

export function newOrder(): Order {
  const now = Date.now()
  return {
    id: crypto.randomUUID?.() ?? String(now) + Math.random().toString(16).slice(2),
    number: '',
    createdAt: now,
    updatedAt: now,
    status: 'new',
    plate: '', plateCountry: 'PL', vin: '', make: '', model: '', year: '', mileage: '',
    color: '', paintCode: '', paintFormula: '', paintNotes: '',
    bodyType: 'sedan',
    client: '', phone: '', email: '', notes: '',
    assignee: '', dueDate: '', discount: 0,
    intake: { items: [] },
    consent: { rodo: false, contact: false },
    signatures: {},
    elements: {},
  }
}

// --- номера заказов ---
// В общей базе номер выдаёт сервер (единая нумерация для всех телефонов),
// без сервера — локальный счётчик по годам.
let serverNumbering = false
export function setServerNumbering(on: boolean) {
  serverNumbering = on
}

const NUMBER_RE = /^(\d{4})\/(\d+)$/

export function nextLocalNumber(year = new Date().getFullYear()): string {
  let counters: Record<string, number> = {}
  try {
    counters = JSON.parse(localStorage.getItem(COUNTER_KEY) ?? '{}')
  } catch {
    /* пусто */
  }
  // не меньше уже существующих номеров (например, после восстановления из копии)
  const used = orders.reduce((max, o) => {
    const m = o.number.match(NUMBER_RE)
    return m && Number(m[1]) === year ? Math.max(max, Number(m[2])) : max
  }, 0)
  const n = Math.max(counters[year] ?? 0, used) + 1
  counters[year] = n
  try {
    localStorage.setItem(COUNTER_KEY, JSON.stringify(counters))
  } catch {
    /* номер всё равно уникален в пределах сессии */
  }
  return formatNumber(year, n)
}

export const formatNumber = (year: number, n: number) => `${year}/${String(n).padStart(4, '0')}`

// --- хранилище ---
let orders: Order[] = []
const listeners = new Set<() => void>()
type Change = { type: 'upsert'; order: Order } | { type: 'delete'; id: string; at: number }
const changeListeners = new Set<(c: Change) => void>()
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('windauto-orders') : null

const sortList = (list: Order[]) => list.sort((a, b) => b.updatedAt - a.updatedAt)

async function readAll(): Promise<Order[]> {
  const list = await tx<Partial<Order>[]>('orders', 'readonly', (s) => s.getAll())
  return sortList(list.map(migrate))
}

/** Загрузка заказов при запуске (и перенос из localStorage) */
export async function initStorage() {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const list = (JSON.parse(legacy) as Partial<Order>[]).map(migrate)
      await writeMany('orders', list.map((o) => [o.id, o]))
      localStorage.removeItem(LEGACY_KEY)
    }
  } catch (e) {
    console.error('migration', e)
  }
  try {
    orders = await readAll()
  } catch (e) {
    // IndexedDB недоступна (приватный режим старого Safari) — работаем в памяти
    console.error('IndexedDB', e)
    orders = []
  }
}

let saveError = false
function persist(puts: Order[], deletes: string[] = []) {
  writeMany(
    'orders',
    puts.map((o) => [o.id, o]),
    deletes,
  )
    .then(() => {
      saveError = false
      channel?.postMessage('changed')
    })
    .catch((e: Error) => {
      if (saveError) return
      saveError = true
      alert('Не удалось сохранить данные / Nie udało się zapisać danych: ' + e.message)
    })
}

function commit(next: Order[]) {
  orders = next
  listeners.forEach((l) => l())
}

export const getOrders = () => orders

/** Подписка на локальные изменения (для синхронизации) */
export function onLocalChange(fn: (c: Change) => void) {
  changeListeners.add(fn)
  return () => changeListeners.delete(fn)
}

export function upsertOrder(o: Order, { remote = false } = {}) {
  const i = orders.findIndex((x) => x.id === o.id)
  const prev = i < 0 ? undefined : orders[i]
  let next = o
  if (!remote) {
    next = { ...o, updatedAt: Math.max(o.updatedAt, Date.now(), (prev?.updatedAt ?? 0) + 1) }
    // экран мог держать копию без номера и отметок — не теряем их
    if (prev?.number && !next.number) next.number = prev.number
    if (prev?._ft || next._ft) next._ft = { ...prev?._ft, ...next._ft }
    if (!prev && !next.number && !serverNumbering) next.number = nextLocalNumber(new Date(next.createdAt).getFullYear())
    next = stampChanges(prev, next)
  }
  const list = orders.slice()
  if (i < 0) list.unshift(next)
  else list[i] = next
  commit(list)
  persist([next])
  if (!remote) changeListeners.forEach((l) => l({ type: 'upsert', order: next }))
  return next
}

export function removeOrder(id: string, { remote = false } = {}) {
  commit(orders.filter((x) => x.id !== id))
  persist([], [id])
  if (!remote) changeListeners.forEach((l) => l({ type: 'delete', id, at: Date.now() }))
}

export function replaceAllOrders(list: Order[]) {
  const ids = new Set(list.map((o) => o.id))
  const gone = orders.filter((o) => !ids.has(o.id)).map((o) => o.id)
  commit(sortList(list.slice()))
  persist(list, gone)
  list.forEach((o) => changeListeners.forEach((l) => l({ type: 'upsert', order: o })))
}

// изменения в другой вкладке
channel?.addEventListener('message', () => {
  readAll()
    .then((list) => commit(list))
    .catch(() => {})
})

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useOrders() {
  const list = useSyncExternalStore(subscribe, getOrders)
  return { orders: list, upsert: upsertOrder, remove: removeOrder, replaceAll: replaceAllOrders }
}

// --- резервная копия ---
export async function exportJson(list: Order[]) {
  const photos = await photosToDataUrls(list.flatMap(orderPhotoIds))
  const blob = new Blob([JSON.stringify({ app: 'windauto', version: 3, orders: list, photos })], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `windauto-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export async function importJson(file: File): Promise<Order[]> {
  const data = JSON.parse(await file.text())
  const list = Array.isArray(data) ? data : data.orders
  if (!Array.isArray(list)) throw new Error('Неверный формат файла / Nieprawidłowy format pliku')
  if (data.photos) await restorePhotos(data.photos)
  return (list as Partial<Order>[]).map(migrate)
}
