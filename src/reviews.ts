// Отзывы клиентов с сервера: одна загрузка на всех, экраны подписываются через useReviews.
import { useEffect, useSyncExternalStore } from 'react'
import { canRecognize, listReviews, type Review } from './sync'

let reviews = new Map<string, Review>()
let loadedAt = 0
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Загрузить заново; без общей базы — пусто. Чаще раза в 20 с — не ходим. */
export function refreshReviews(force = false): Promise<void> {
  if (!canRecognize()) return Promise.resolve()
  if (loading) return loading
  if (!force && Date.now() - loadedAt < 20_000) return Promise.resolve()
  loading = listReviews()
    .then((list) => {
      reviews = new Map(list.map((r) => [r.orderId, r]))
      loadedAt = Date.now()
      listeners.forEach((l) => l())
    })
    .catch(() => {
      /* нет связи — покажем прежние */
    })
    .finally(() => {
      loading = null
    })
  return loading
}

/** Ссылку только что отправили — отмечаем сразу, не дожидаясь сервера */
export function markSent(orderId: string) {
  const cur = reviews.get(orderId)
  reviews = new Map(reviews).set(orderId, { orderId, stars: 0, comment: '', at: 0, ...cur, sentAt: Date.now() })
  listeners.forEach((l) => l())
}

export function useReviews(): Map<string, Review> {
  useEffect(() => {
    void refreshReviews()
  }, [])
  return useSyncExternalStore(subscribe, () => reviews)
}
