// Выгрузка заказов в CSV для Excel и бухгалтерии (Pro): «;» и BOM — так польский/русский Excel
// открывает файл сразу, без мастера импорта; суммы — с запятой
import { getLayout } from './body'
import { intakeAt } from './booking'
import { orderNo } from './docNumber'
import { makeT, type Lang } from './i18n'
import type { PriceSettings } from './works'
import type { Order } from './types'
import { formatPlate } from './validate'
import { orderTotals } from './works'

const cell = (v: string | number) => {
  const s = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : v
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function ordersCsv(orders: Order[], s: PriceSettings, lang: Lang): string {
  const t = makeT(lang)
  const head = [
    t('csv.number'), t('csv.date'), t('csv.status'), t('order.plate'), 'VIN', t('order.make'), t('order.model'), t('order.year'),
    t('csv.client'), t('order.phone'), t('order.email'), t('csv.assignee'), t('csv.due'), t('csv.works'),
    t('csv.net'), t('csv.vat'), t('csv.gross'),
  ]
  const rows = orders.map((o) => {
    const ids = getLayout(o.bodyType).elements.map((e) => e.id)
    const tot = orderTotals(o, s, ids)
    const works = ids
      .filter((id) => o.elements[id]?.works.length)
      .map((id) => `${t(`el.${getLayout(o.bodyType).elements.find((e) => e.id === id)?.key ?? id}`)}: ${o.elements[id].works.map((w) => t(`work.${w}`)).join(', ')}`)
      .concat((o.extras ?? []).map((x) => x.name.trim()).filter(Boolean))
      .join(' | ')
    return [
      orderNo(o), new Date(intakeAt(o)).toISOString().slice(0, 10), t(`status.${o.status}`), formatPlate(o.plate, o.plateCountry), o.vin, o.make, o.model, o.year,
      o.client, o.phone, o.email, o.assignee, o.dueDate, works, tot.net, tot.vat, tot.gross,
    ]
  })
  return '﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n'
}
