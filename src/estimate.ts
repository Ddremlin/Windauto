// Смета списком: деталь — работа — цена, итоги. Форматы: текст, CSV (Excel), HTML, PDF (из того же HTML).
import { getLayout, partName } from './body'
import { intakeAt } from './booking'
import { orderNo } from './docNumber'
import { LOCALE, makeT, type Lang } from './i18n'
import type { Settings } from './settingsStore'
import type { Order } from './types'
import { formatPlate, normalizePlate } from './validate'
import { formatMoney, orderTotals, type Totals } from './works'

export type EstimateFormat = 'pdf' | 'csv' | 'html' | 'txt'
export const ESTIMATE_FORMATS: EstimateFormat[] = ['pdf', 'csv', 'html', 'txt']

export interface EstimateLine {
  part: string
  work: string
  // 0 — цена не указана
  price: number
}

export interface Estimate {
  title: string
  number: string
  date: string
  car: string
  vin: string
  client: string
  lines: EstimateLine[]
  // итоговые строки: подпись и сумма (скидка — отрицательная)
  sums: [string, number][]
  total: [string, number]
  totals: Totals
  disclaimer: string
  shop: string
}

export function buildEstimate(o: Order, lang: Lang, s: Settings): Estimate {
  const t = makeT(lang)
  const layout = getLayout(o.bodyType)
  const lower = (x: string) => (/^\p{Lu}\p{Ll}/u.test(x) ? x[0].toLowerCase() + x.slice(1) : x)
  const lines: EstimateLine[] = []
  const ids: string[] = []
  for (const e of layout.parts) {
    const v = o.elements[e.id]
    if (!v || !(v.works.length || v.parts)) continue
    ids.push(e.id)
    const part = partName(t, e)
    for (const w of v.works) lines.push({ part, work: lower(t(`work.${w}`)), price: v.prices?.[w] ?? 0 })
    if (v.parts) lines.push({ part, work: lower(t('tot.parts')), price: v.parts })
  }
  for (const x of o.extras ?? []) if (x.name.trim()) lines.push({ part: t('extra.title'), work: x.name.trim(), price: x.price ?? 0 })

  const tot = orderTotals(o, s, ids)
  const sums: [string, number][] = [[t('tot.labor'), tot.labor]]
  if (tot.parts) sums.push([t('tot.parts'), tot.parts])
  if (tot.discount) sums.push([t('tot.discountSum', { p: tot.discountPct }), -tot.discount])
  if (tot.vatRate) sums.push([t('tot.net'), tot.net], [t('tot.vat', { r: tot.vatRate }), tot.vat])
  return {
    title: t('est.title'),
    number: orderNo(o),
    date: new Date(intakeAt(o)).toLocaleDateString(LOCALE[lang]),
    car: [o.make, o.model, o.year].filter(Boolean).join(' ') + (o.plate ? ` · ${formatPlate(o.plate, o.plateCountry)}` : ''),
    vin: o.vin,
    client: o.client,
    lines,
    sums,
    total: [tot.vatRate ? t('tot.gross') : t('order.total'), tot.gross],
    totals: tot,
    disclaimer: t('doc.disclaimer'),
    shop: [s.shopName, s.shopAddress, s.shopPhone].filter(Boolean).join(', '),
  }
}

export function estimateFileName(o: Order, f: EstimateFormat): string {
  const plate = normalizePlate(o.plate) || orderNo(o).replace(/\W+/g, '-')
  return `kosztorys_${plate}_${new Date(intakeAt(o)).toISOString().slice(0, 10)}.${f}`
}

const money = (v: number) => (v ? formatMoney(v) : '—')

export function estimateText(e: Estimate, lang: Lang): string {
  const t = makeT(lang)
  const out = [`${e.title} ${t('doc.number', { n: e.number })} · ${e.date}`, e.car]
  if (e.vin) out.push(`VIN: ${e.vin}`)
  if (e.client) out.push(e.client)
  out.push('')
  e.lines.forEach((l, i) => out.push(`${i + 1}. ${l.part} — ${l.work}: ${money(l.price)}`))
  out.push('')
  for (const [k, v] of e.sums) out.push(`${k}: ${v < 0 ? '−' + formatMoney(-v) : formatMoney(v)}`)
  out.push(`${e.total[0]}: ${formatMoney(e.total[1])}`, '', e.disclaimer)
  if (e.shop) out.push('', e.shop)
  return out.join('\n')
}

// «;» и BOM — польский/русский Excel открывает сразу; суммы с запятой
const cell = (v: string | number) => {
  const s = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : v
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function estimateCsv(e: Estimate, lang: Lang): string {
  const t = makeT(lang)
  const rows: (string | number)[][] = [
    [`${e.title} ${t('doc.number', { n: e.number })}`, e.date, e.car, e.vin],
    [],
    ['#', t('est.part'), t('est.work'), t('est.price')],
    ...e.lines.map((l, i) => [String(i + 1), l.part, l.work, l.price]),
    [],
    ...e.sums.map(([k, v]) => ['', '', k, v]),
    ['', '', e.total[0], e.total[1]],
  ]
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n'
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Содержимое сметы (без <html>) — для файла .html и для PDF; все поля экранированы */
export function estimateBody(e: Estimate, lang: Lang, logo?: string): string {
  const t = makeT(lang)
  const td = (s: string, cls = '') => `<td${cls ? ` class="${cls}"` : ''}>${esc(s)}</td>`
  const sum = (v: number) => (v < 0 ? '−' + formatMoney(-v) : formatMoney(v))
  return `<div class="est">
<div class="est-head">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<div><h1>${esc(e.title)} ${esc(t('doc.number', { n: e.number }))}</h1>
<p>${esc(e.date)}${e.shop ? ' · ' + esc(e.shop) : ''}</p></div></div>
<p><b>${esc(e.car)}</b>${e.vin ? `<br>VIN: ${esc(e.vin)}` : ''}${e.client ? `<br>${esc(e.client)}` : ''}</p>
<table><thead><tr><th>#</th><th>${esc(t('est.part'))}</th><th>${esc(t('est.work'))}</th><th class="r">${esc(t('est.price'))}</th></tr></thead><tbody>
${e.lines.map((l, i) => `<tr>${td(String(i + 1), 'n')}${td(l.part)}${td(l.work)}${td(money(l.price), 'r')}</tr>`).join('\n')}
</tbody><tfoot>
${e.sums.map(([k, v]) => `<tr><td colspan="3" class="r">${esc(k)}</td>${td(sum(v), 'r')}</tr>`).join('\n')}
<tr class="total"><td colspan="3" class="r">${esc(e.total[0])}</td>${td(formatMoney(e.total[1]), 'r')}</tr>
</tfoot></table>
<p class="note">${esc(e.disclaimer)}</p>
</div>`
}

export const ESTIMATE_CSS = `.est{font:14px/1.45 Arial,Helvetica,sans-serif;color:#222;max-width:760px;margin:0 auto;padding:24px;background:#fff}
.est-head{display:flex;gap:16px;align-items:center;border-bottom:2px solid #222;margin-bottom:12px}
.est-head img{max-height:56px;max-width:160px}
.est h1{font-size:20px;margin:0 0 4px}.est-head p{margin:0 0 10px;color:#555}
.est table{width:100%;border-collapse:collapse;margin:12px 0}
.est th,.est td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
.est th{background:#f2f2f2;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
.est .r{text-align:right;white-space:nowrap}.est .n{color:#888;width:24px}
.est tfoot td{border-bottom:0;padding:3px 8px}
.est tr.total td{font-size:17px;font-weight:bold;border-top:2px solid #222;padding-top:8px}
.est .note{color:#666;font-size:12px}`

export function estimateHtml(e: Estimate, lang: Lang, logo?: string): string {
  return `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(`${e.title} ${e.number}`)}</title><style>${ESTIMATE_CSS}</style></head>
<body>${estimateBody(e, lang, logo)}</body></html>`
}
