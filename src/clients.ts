// Клиент — не отдельная запись, а заказы с одним телефоном (или, без телефона, с одним именем).
// По ним — сколько раз приезжал и внутренняя оценка мастеров.
import type { ClientRating, Order } from './types'

/** Ключ клиента: последние 9 цифр телефона, иначе имя без регистра; пусто — не определить */
export function clientKey(o: Pick<Order, 'phone' | 'client'>): string {
  const d = o.phone.replace(/\D/g, '')
  if (d.length >= 7) return 'tel:' + d.slice(-9)
  const name = o.client.trim().toLowerCase().replace(/\s+/g, ' ')
  return name.length >= 3 ? 'name:' + name : ''
}

export interface ClientProfile {
  orders: number
  // средняя оценка по заказам, где её ставили; 0 — не оценивали
  avg: number
  rated: number
  // последняя оценка с заметкой
  last?: ClientRating
}

export function profileOf(list: Order[]): ClientProfile {
  const ratings = list
    .map((o) => o.clientRating)
    .filter((r): r is ClientRating => Boolean(r?.stars))
    .sort((a, b) => b.at - a.at)
  const avg = ratings.length ? Math.round((ratings.reduce((s, r) => s + r.stars, 0) / ratings.length) * 10) / 10 : 0
  return { orders: list.length, avg, rated: ratings.length, last: ratings[0] }
}

/** Профили всех клиентов разом — для списка заказов */
export function clientProfiles(orders: Order[]): Map<string, ClientProfile> {
  const groups = new Map<string, Order[]>()
  for (const o of orders) {
    const k = clientKey(o)
    if (!k) continue
    const g = groups.get(k) ?? []
    g.push(o)
    groups.set(k, g)
  }
  return new Map([...groups].map(([k, g]) => [k, profileOf(g)]))
}

// «плохой» клиент — средняя оценка 2 и ниже
export const isRisky = (p: ClientProfile | undefined) => Boolean(p && p.rated && p.avg <= 2)
