// Заказы: единое хранилище в памяти + localStorage.
// Экраны подписываются через useOrders, синхронизация — через onLocalChange.
import { useSyncExternalStore } from 'react'
import { orderPhotoIds, photosToDataUrls, restorePhotos } from './photos'
import type { Order } from './types'

const KEY = 'windauto.orders.v1'

function load(): Order[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Partial<Order>[]).map(migrate) : []
  } catch {
    return []
  }
}

function save(orders: Order[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(orders))
  } catch (e) {
    alert('Не удалось сохранить данные / Nie udało się zapisać danych: ' + (e as Error).message)
  }
}

// дополняет заказы из старых версий новыми полями
export function migrate(o: Partial<Order>): Order {
  return { ...newOrder(), ...o } as Order
}

export function newOrder(): Order {
  const now = Date.now()
  return {
    id: crypto.randomUUID?.() ?? String(now) + Math.random().toString(16).slice(2),
    createdAt: now,
    updatedAt: now,
    status: 'new',
    plate: '', plateCountry: 'PL', vin: '', make: '', model: '', year: '', mileage: '',
    color: '', paintCode: '', paintFormula: '',
    bodyType: 'sedan',
    client: '', phone: '', email: '', notes: '',
    elements: {},
  }
}

// --- хранилище ---
let orders: Order[] = load()
const listeners = new Set<() => void>()
type Change = { type: 'upsert'; order: Order } | { type: 'delete'; id: string; at: number }
const changeListeners = new Set<(c: Change) => void>()

function commit(next: Order[]) {
  orders = next
  save(orders)
  listeners.forEach((l) => l())
}

export const getOrders = () => orders

/** Подписка на локальные изменения (для синхронизации) */
export function onLocalChange(fn: (c: Change) => void) {
  changeListeners.add(fn)
  return () => changeListeners.delete(fn)
}

export function upsertOrder(o: Order, { remote = false } = {}) {
  const next = remote ? o : { ...o, updatedAt: Math.max(o.updatedAt, Date.now()) }
  const i = orders.findIndex((x) => x.id === o.id)
  const list = orders.slice()
  if (i < 0) list.unshift(next)
  else list[i] = next
  commit(list)
  if (!remote) changeListeners.forEach((l) => l({ type: 'upsert', order: next }))
}

export function removeOrder(id: string, { remote = false } = {}) {
  commit(orders.filter((x) => x.id !== id))
  if (!remote) changeListeners.forEach((l) => l({ type: 'delete', id, at: Date.now() }))
}

export function replaceAllOrders(list: Order[]) {
  commit(list)
  list.forEach((o) => changeListeners.forEach((l) => l({ type: 'upsert', order: o })))
}

// изменения в другой вкладке
window.addEventListener('storage', (e) => {
  if (e.key === KEY) {
    orders = load()
    listeners.forEach((l) => l())
  }
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
  const blob = new Blob([JSON.stringify({ app: 'windauto', version: 2, orders: list, photos })], { type: 'application/json' })
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
