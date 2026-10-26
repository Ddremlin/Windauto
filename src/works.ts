import type { DamageId, ElementWork, IntakeItem, Order, OrderStatus, WorkId } from './types'

// Подписи — в i18n.ts по ключу work.<id>
export interface WorkType {
  id: WorkId
  color: string
}

export const WORKS: WorkType[] = [
  { id: 'replace', color: '#e53935' },
  { id: 'repair', color: '#fb8c00' },
  { id: 'paint_partial', color: '#64b5f6' },
  { id: 'paint_full', color: '#1e50c8' },
  { id: 'polish', color: '#43a047' },
  { id: 'rr', color: '#9e9e9e' },
  { id: 'plastic', color: '#8e24aa' },
  { id: 'pdr', color: '#fdd835' },
  { id: 'weld', color: '#6d4c41' },
]

export const WORK_BY_ID = Object.fromEntries(WORKS.map((w) => [w.id, w])) as Record<WorkId, WorkType>

// Работы, которые не могут быть отмечены одновременно на одном элементе
export const EXCLUSIVE: WorkId[][] = [['paint_partial', 'paint_full']]

// Повреждения, которые уже были при приёмке (подписи — damage.<id>)
export const DAMAGES: DamageId[] = ['scratch', 'dent', 'chip', 'crack', 'rust', 'broken']

// Комплектность при приёмке (подписи — intake.<id>)
export const INTAKE_ITEMS: IntakeItem[] = [
  'docs',
  'service_book',
  'spare_wheel',
  'repair_kit',
  'jack',
  'first_aid',
  'extinguisher',
  'triangle',
  'vest',
  'child_seat',
  'parcel_shelf',
  'mats',
  'radio_panel',
  'charging_cable',
]

/** Уровень топлива в восьмых → «1/4», «1/2»… */
export const fuelLabel = (v: number | undefined) =>
  v === undefined ? '—' : v === 0 ? '0' : v === 8 ? '1/1' : v === 2 ? '1/4' : v === 4 ? '1/2' : v === 6 ? '3/4' : `${v}/8`

export const STATUSES: OrderStatus[] = ['new', 'in_work', 'waiting_parts', 'done', 'issued']
// статусы «машина в сервисе»
export const ACTIVE_STATUSES: OrderStatus[] = ['new', 'in_work', 'waiting_parts', 'done']

const money = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 })
export const formatMoney = (v: number) => money.format(v)

const round2 = (v: number) => Math.round(v * 100) / 100

/** Работы по элементу — только по отмеченным видам */
export function elementLabor(v: ElementWork | undefined): number {
  if (!v) return 0
  return v.works.reduce((sum, w) => sum + (v.prices?.[w] ?? 0), 0)
}

/** Сумма по элементу: работы + запчасти */
export function elementTotal(v: ElementWork | undefined): number {
  return elementLabor(v) + (v?.parts ?? 0)
}

export function orderTotal(elements: Record<string, ElementWork>, ids?: string[]): number {
  return (ids ?? Object.keys(elements)).reduce((sum, id) => sum + elementTotal(elements[id]), 0)
}

export interface PriceSettings {
  // ставка VAT, %; 0 — сервис не плательщик VAT
  vatRate: number
  // цены вводятся с VAT (брутто) или без (нетто)
  pricesGross: boolean
}

export interface Totals {
  labor: number
  parts: number
  // работы + запчасти, как введены
  subtotal: number
  discountPct: number
  discount: number
  net: number
  vat: number
  gross: number
  vatRate: number
  pricesGross: boolean
}

/** Итоги сметы: скидка, нетто, VAT, брутто */
export function orderTotals(o: Pick<Order, 'elements' | 'discount'>, s: PriceSettings, ids?: string[]): Totals {
  const list = ids ?? Object.keys(o.elements)
  const labor = list.reduce((sum, id) => sum + elementLabor(o.elements[id]), 0)
  const parts = list.reduce((sum, id) => sum + (o.elements[id]?.parts ?? 0), 0)
  const subtotal = labor + parts
  const discountPct = Math.min(100, Math.max(0, o.discount || 0))
  const discount = round2((subtotal * discountPct) / 100)
  const after = subtotal - discount
  const rate = Math.max(0, s.vatRate || 0) / 100
  let net: number, gross: number
  if (s.pricesGross) {
    gross = round2(after)
    net = round2(after / (1 + rate))
  } else {
    net = round2(after)
    gross = round2(after * (1 + rate))
  }
  return { labor, parts, subtotal, discountPct, discount, net, vat: round2(gross - net), gross, vatRate: s.vatRate || 0, pricesGross: s.pricesGross }
}
