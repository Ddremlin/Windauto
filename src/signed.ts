// Отпечаток того, что клиент подтверждает подписью при приёмке:
// данные авто, комплектность, работы, цены, повреждения. Фото «после» не входят.
import type { Order } from './types'

const SIGNED_FIELDS = ['plate', 'vin', 'make', 'model', 'mileage', 'bodyType', 'discount', 'intake', 'client', 'phone'] as const

export function signedDigest(o: Order): string {
  const elements = Object.keys(o.elements)
    .sort()
    .map((id) => {
      const e = o.elements[id]
      const prices = e.works.map((w) => `${w}=${e.prices?.[w] ?? ''}`).join(',')
      return `${id}:${prices}|${e.parts ?? ''}|${(e.damage ?? []).join(',')}|${e.note ?? ''}|${(e.photos ?? []).length}`
    })
  const fields = SIGNED_FIELDS.map((k) => JSON.stringify(o[k] ?? ''))
  return fnv1a([...fields, ...elements].join('\n'))
}

// FNV-1a, 32 бита — достаточно, чтобы заметить изменение
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
