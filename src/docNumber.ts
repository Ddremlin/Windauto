import type { Order } from './types'

/** Номер листа приёмки из даты создания: ГГММДД-ЧЧММ */
export function docNumber(o: Order): string {
  const d = new Date(o.createdAt)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}
