// Запись на приёмку: заказ заводят заранее с ориентировочными датой и временем,
// а когда машина приезжает — отмечают «приехала» и дальше обычная приёмка.
import type { Order } from './types'

/** Машина записана, но ещё не приехала */
export const isPlanned = (o: Pick<Order, 'booking'>) => Boolean(o.booking && !o.booking.arrived)

/** Когда машину приняли (для записанных заранее — время приезда, а не создания заказа) */
export const intakeAt = (o: Pick<Order, 'booking' | 'createdAt'>) => o.booking?.arrived ?? o.createdAt

/** Время в календаре: для ожидаемых — запланированное, иначе — приёмка */
export const calendarAt = (o: Pick<Order, 'booking' | 'createdAt'>) => (o.booking && !o.booking.arrived ? o.booking.at : intakeAt(o))

/** Записан на время, которое уже прошло, а машины нет (час запаса) */
export const isLate = (o: Pick<Order, 'booking'>, now = Date.now()) => isPlanned(o) && o.booking!.at + 3600_000 < now

/** Местная дата YYYY-MM-DD */
export function localDay(ms = Date.now()): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Время по умолчанию для записи на день YYYY-MM-DD: 9:00, сегодня — ближайший целый час */
export function defaultBookingAt(day: string, now = Date.now()): number {
  const d = new Date(day + 'T09:00')
  if (d.getTime() > now) return d.getTime()
  return Math.ceil((now + 1) / 3600_000) * 3600_000
}

export const timeText = (ms: number, locale: string) => new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

export const bookingText = (ms: number, locale: string) =>
  new Date(ms).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
