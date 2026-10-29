// Служба напоминаний: планирует уведомления Android, на сайте показывает уведомления браузера
import { useEffect } from 'react'
import { carOf, myReminders, notifyWeb, onNotificationTap, scheduleNative, whenText, type Due } from '../reminders'
import { useSettings } from '../settingsHooks'
import { useSyncStatus } from '../sync'
import type { Order } from '../types'

type T = ReturnType<typeof useSettings>['t']

/** Текст уведомления */
function notifyText(t: T, locale: string, { order, r }: Due) {
  const who = order.client || order.phone || carOf(order)
  return {
    title: `📞 ${t('rem.call')}: ${who}`,
    body: [whenText(r.at, locale), order.client && order.phone, carOf(order), r.note].filter(Boolean).join(' · '),
  }
}

export function useReminderService(orders: Order[], open: (orderId: string) => void) {
  const { t, locale } = useSettings()
  const sync = useSyncStatus()
  const me = sync.user?.login ?? ''

  useEffect(() => onNotificationTap(open), [open])

  useEffect(() => {
    const list = myReminders(orders, me)
    const text = (d: Due) => notifyText(t, locale, d)
    // правки идут пачками (ввод текста) — планируем, когда всё утихло
    const id = setTimeout(() => void scheduleNative(list, text), 1500)
    notifyWeb(list, text, open)
    const web = setInterval(() => notifyWeb(list, text, open), 30_000)
    return () => {
      clearTimeout(id)
      clearInterval(web)
    }
  }, [orders, me, t, locale, open])
}
