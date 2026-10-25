import { useCallback, useEffect, useState } from 'react'
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
    plate: '', vin: '', make: '', model: '', year: '', mileage: '',
    color: '', paintCode: '', paintFormula: '',
    bodyType: 'sedan',
    client: '', phone: '', notes: '',
    elements: {},
  }
}

export function useOrders() {
  const [orders, setOrders] = useState<Order[]>(load)

  useEffect(() => save(orders), [orders])

  // синхронизация между вкладками
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === KEY && setOrders(load())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const upsert = useCallback((o: Order) => {
    setOrders((list) => {
      const next = { ...o, updatedAt: Date.now() }
      const i = list.findIndex((x) => x.id === o.id)
      if (i < 0) return [next, ...list]
      const copy = list.slice()
      copy[i] = next
      return copy
    })
  }, [])

  const remove = useCallback((id: string) => setOrders((list) => list.filter((x) => x.id !== id)), [])

  const replaceAll = useCallback((list: Order[]) => setOrders(list), [])

  return { orders, upsert, remove, replaceAll }
}

export async function exportJson(orders: Order[]) {
  const photos = await photosToDataUrls(orders.flatMap(orderPhotoIds))
  const blob = new Blob([JSON.stringify({ app: 'windauto', version: 2, orders, photos })], { type: 'application/json' })
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
