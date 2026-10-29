// Напоминания позвонить клиенту. В приложении — системные уведомления Android (срабатывают и когда
// приложение закрыто), на сайте — уведомление браузера, пока вкладка открыта. Плюс список «позвонить» на главном экране.
import { LocalNotifications } from '@capacitor/local-notifications'
import { isNative } from './native'
import type { Order, Reminder } from './types'
import { formatPlate } from './validate'

// варианты «напомнить за», минуты
export const BEFORE_OPTIONS = [0, 15, 30, 60, 120, 1440, 2880]

export const whenText = (ms: number, locale: string) =>
  new Date(ms).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export const carOf = (o: Order) =>
  [[o.make, o.model].filter(Boolean).join(' '), o.plate && formatPlate(o.plate, o.plateCountry)].filter(Boolean).join(' · ')

export const remindAt = (r: Reminder) => r.at - r.before * 60_000

/** Напоминание для этого сотрудника: своё или созданное без общей базы */
export const isMine = (r: Reminder, me: string) => !r.user || r.user === me

export interface Due {
  order: Order
  r: Reminder
}

/** Невыполненные напоминания сотрудника, ближайшие сверху */
export function myReminders(orders: Order[], me: string): Due[] {
  const out: Due[] = []
  for (const order of orders) for (const r of order.reminders ?? []) if (!r.done && isMine(r, me)) out.push({ order, r })
  return out.sort((a, b) => remindAt(a.r) - remindAt(b.r))
}

/** id уведомления Android — целое число из id напоминания */
export function notifId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0
  return (h & 0x7fffffff) || 1
}

/** «за 1 ч», «за 2 дня»: число и единица для подписи */
export function beforeParts(min: number): { n: number; unit: 'min' | 'h' | 'd' } {
  if (min && min % 1440 === 0) return { n: min / 1440, unit: 'd' }
  if (min && min % 60 === 0) return { n: min / 60, unit: 'h' }
  return { n: min, unit: 'min' }
}

/** Значение для <input type="datetime-local"> */
export function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export interface NotifyText {
  title: string
  body: string
}

/** Разрешение на уведомления — спрашиваем, когда создают первое напоминание */
export async function askNotifyPermission(): Promise<boolean> {
  try {
    if (isNative) return (await LocalNotifications.requestPermissions()).display === 'granted'
    if (typeof Notification === 'undefined') return false
    if (Notification.permission === 'default') return (await Notification.requestPermission()) === 'granted'
    return Notification.permission === 'granted'
  } catch {
    return false
  }
}

// --- Android: держим запланированными ровно будущие напоминания ---
// свой канал с высокой важностью — уведомление всплывает поверх экрана, со звуком и вибрацией
const CHANNEL = 'call-reminders'
let channelReady = false
async function ensureChannel() {
  if (channelReady) return
  await LocalNotifications.createChannel({ id: CHANNEL, name: 'Позвонить клиенту / Zadzwoń do klienta', importance: 4, vibration: true, visibility: 1 })
  channelReady = true
}

let lastPlan = ''
export async function scheduleNative(list: Due[], text: (d: Due) => NotifyText) {
  if (!isNative) return
  const now = Date.now()
  const future = list.filter((d) => remindAt(d.r) > now)
  const plan = JSON.stringify(future.map((d) => [d.r.id, remindAt(d.r), text(d)]))
  if (plan === lastPlan) return
  try {
    const { display } = await LocalNotifications.checkPermissions()
    if (display !== 'granted') return
    await ensureChannel()
    const pending = (await LocalNotifications.getPending()).notifications
    if (pending.length) await LocalNotifications.cancel({ notifications: pending.map((n) => ({ id: n.id })) })
    if (future.length)
      await LocalNotifications.schedule({
        notifications: future.map((d) => ({
          id: notifId(d.r.id),
          ...text(d),
          schedule: { at: new Date(remindAt(d.r)), allowWhileIdle: true },
          channelId: CHANNEL,
          extra: { orderId: d.order.id },
        })),
      })
    lastPlan = plan
  } catch (e) {
    console.error('reminders', e)
  }
}

/** Нажали на уведомление — открыть заказ */
export function onNotificationTap(open: (orderId: string) => void) {
  if (!isNative) return () => {}
  const sub = LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    const id = a.notification.extra?.orderId
    if (typeof id === 'string') open(id)
  })
  return () => void sub.then((s) => s.remove())
}

// --- сайт: уведомление браузера, пока вкладка открыта; показанные — запоминаем ---
const SHOWN_KEY = 'windauto.remindersShown'
function shownSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

export function notifyWeb(list: Due[], text: (d: Due) => NotifyText, open: (orderId: string) => void) {
  if (isNative || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const now = Date.now()
  const shown = shownSet()
  let changed = false
  for (const d of list) {
    // давно прошедшие не показываем — они и так в списке на главном экране
    if (shown.has(d.r.id) || remindAt(d.r) > now || now - remindAt(d.r) > 6 * 3600_000) continue
    const n = new Notification(text(d).title, { body: text(d).body, tag: d.r.id })
    n.onclick = () => {
      window.focus()
      open(d.order.id)
    }
    shown.add(d.r.id)
    changed = true
  }
  if (changed)
    try {
      localStorage.setItem(SHOWN_KEY, JSON.stringify([...shown].slice(-200)))
    } catch {
      /* покажем ещё раз — не страшно */
    }
}
