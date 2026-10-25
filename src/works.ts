import type { ElementWork, OrderStatus, WorkId } from './types'

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

export const STATUSES: OrderStatus[] = ['new', 'in_work', 'done']

const money = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 })
export const formatMoney = (v: number) => money.format(v)

/** Сумма по элементу — только по отмеченным работам */
export function elementTotal(v: ElementWork | undefined): number {
  if (!v) return 0
  return v.works.reduce((sum, w) => sum + (v.prices?.[w] ?? 0), 0)
}

export function orderTotal(elements: Record<string, ElementWork>, ids?: string[]): number {
  return (ids ?? Object.keys(elements)).reduce((sum, id) => sum + elementTotal(elements[id]), 0)
}
