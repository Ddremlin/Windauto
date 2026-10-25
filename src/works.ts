import type { ElementWork, OrderStatus, WorkId } from './types'

export interface WorkType {
  id: WorkId
  label: string
  short: string
  color: string
}

export const WORKS: WorkType[] = [
  { id: 'replace', label: 'Замена', short: 'Зам', color: '#e53935' },
  { id: 'repair', label: 'Ремонт / рихтовка', short: 'Рем', color: '#fb8c00' },
  { id: 'paint_partial', label: 'Окрас частичный', short: 'ОкЧ', color: '#64b5f6' },
  { id: 'paint_full', label: 'Окрас полный', short: 'ОкП', color: '#1e50c8' },
  { id: 'polish', label: 'Полировка', short: 'Пол', color: '#43a047' },
  { id: 'rr', label: 'Снятие / установка', short: 'С/У', color: '#9e9e9e' },
  { id: 'plastic', label: 'Ремонт пластика', short: 'Пласт', color: '#8e24aa' },
  { id: 'pdr', label: 'PDR (без покраски)', short: 'PDR', color: '#fdd835' },
  { id: 'weld', label: 'Сварка', short: 'Свар', color: '#6d4c41' },
]

export const WORK_BY_ID = Object.fromEntries(WORKS.map((w) => [w.id, w])) as Record<WorkId, WorkType>

// Работы, которые не могут быть отмечены одновременно на одном элементе
export const EXCLUSIVE: WorkId[][] = [['paint_partial', 'paint_full']]

export const STATUS_LABEL: Record<OrderStatus, string> = {
  new: 'Принят',
  in_work: 'В работе',
  done: 'Готов',
}

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
