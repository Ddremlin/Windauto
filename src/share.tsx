// PDF листа приёмки / акта выдачи и тексты для WhatsApp, SMS, e-mail
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { getLayout } from './body'
import AcceptanceDoc, { DOC_WIDTH, type DocKind } from './components/AcceptanceDoc'
import { orderNo } from './docNumber'
import { LOCALE, makeT, type Lang } from './i18n'
import { isNative, saveFileNative, shareFileNative, shareTextNative } from './native'
import { getPhoto, orderPhotoIds } from './photos'
import { LangOverride, SettingsProvider } from './settings'
import type { Settings } from './settingsStore'
import type { Order } from './types'
import { formatPlate, normalizePlate } from './validate'
import { elementTotal, formatMoney, orderTotals } from './works'

const A4_H = (DOC_WIDTH * 297) / 210
const MARGIN_MM = 12
const MARGIN_PX = (MARGIN_MM / 210) * DOC_WIDTH

export function pdfFileName(o: Order, kind: DocKind = 'acceptance'): string {
  const plate = normalizePlate(o.plate) || orderNo(o).replace(/\W+/g, '-')
  return `${kind === 'handover' ? 'wydanie' : 'protokol'}_${plate}_${new Date(o.createdAt).toISOString().slice(0, 10)}.pdf`
}

export async function makePdf(order: Order, lang: Lang, kind: DocKind = 'acceptance'): Promise<Blob> {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas-pro')])

  // фото — в object URL на время рендера
  const urls: Record<string, string> = {}
  for (const id of orderPhotoIds(order)) {
    const b = await getPhoto(id)
    if (b) urls[id] = URL.createObjectURL(b)
  }

  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-${DOC_WIDTH * 2}px;top:0;width:${DOC_WIDTH}px;z-index:-1`
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    flushSync(() =>
      root.render(
        <SettingsProvider>
          <LangOverride lang={lang}>
            <AcceptanceDoc order={order} photoUrls={urls} kind={kind} />
          </LangOverride>
        </SettingsProvider>,
      ),
    )
    const node = host.firstElementChild as HTMLElement
    await Promise.all([...node.querySelectorAll('img')].map((img) => img.decode().catch(() => {})))
    await document.fonts?.ready

    const scale = 2
    const canvas = await html2canvas(node, { scale, backgroundColor: '#ffffff', logging: false })

    // границы блоков — разрываем страницы только по ним
    const top = node.getBoundingClientRect().top
    const breaks = [...node.querySelectorAll('[data-block]')]
      .map((el) => el.getBoundingClientRect().top - top)
      .filter((y) => y > 0)
      .sort((a, b) => a - b)
    const H = node.offsetHeight
    const usable = A4_H - 2 * MARGIN_PX

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
    let start = 0
    let page = 0
    while (start < H - 1) {
      const limit = start + usable
      let end = H
      if (limit < H) {
        const fit = breaks.filter((b) => b > start + 40 && b <= limit)
        end = fit.length ? fit[fit.length - 1] : limit
      }
      const slice = document.createElement('canvas')
      slice.width = canvas.width
      slice.height = Math.ceil((end - start) * scale)
      const ctx = slice.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, slice.width, slice.height)
      ctx.drawImage(canvas, 0, -Math.floor(start * scale))
      if (page > 0) pdf.addPage()
      pdf.addImage(slice.toDataURL('image/jpeg', 0.88), 'JPEG', 0, MARGIN_MM, 210, ((end - start) / DOC_WIDTH) * 210)
      page++
      start = end
    }
    return pdf.output('blob')
  } finally {
    root.unmount()
    host.remove()
    Object.values(urls).forEach((u) => URL.revokeObjectURL(u))
  }
}

export async function sharePdf(blob: Blob, name: string, title: string): Promise<'shared' | 'downloaded'> {
  if (isNative) {
    await shareFileNative(blob, name, title)
    return 'shared'
  }
  const file = new File([blob], name, { type: 'application/pdf' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared'
    }
  }
  downloadBlob(blob, name)
  return 'downloaded'
}

/** Сохраняет файл; в приложении — в «Документы» телефона, возвращает путь */
export async function downloadBlob(blob: Blob, name: string): Promise<string | undefined> {
  if (isNative) return saveFileNative(blob, name)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

const carName = (o: Order) => [o.make, o.model, o.plate && formatPlate(o.plate, o.plateCountry)].filter(Boolean).join(' ')

export function orderText(o: Order, lang: Lang, s: Settings): string {
  const t = makeT(lang)
  const layout = getLayout(o.bodyType)
  const marked = layout.elements.filter((e) => o.elements[e.id]?.works.length || o.elements[e.id]?.parts)
  const lines = [t('doc.textHeader', { car: carName(o) }), t('doc.number', { n: orderNo(o) }), '']
  if (o.vin) lines.push(`VIN: ${o.vin}`)
  for (const e of marked) {
    const v = o.elements[e.id]
    // «Замена» → «замена», но аббревиатуры (PDR) не трогаем
    const lower = (s: string) => (/^\p{Lu}\p{Ll}/u.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
    const works = [...v.works.map((w) => lower(t(`work.${w}`))), ...(v.parts ? [lower(t('tot.parts'))] : [])].join(', ')
    const sum = elementTotal(v)
    lines.push(`• ${t(`el.${e.key}`)}: ${works}${sum ? ` — ${formatMoney(sum)}` : ''}`)
  }
  const tot = orderTotals(o, s, marked.map((e) => e.id))
  if (tot.gross) {
    lines.push('')
    if (tot.discount) lines.push(`${t('tot.discountSum', { p: tot.discountPct })}: −${formatMoney(tot.discount)}`)
    lines.push(`${tot.vatRate ? t('tot.gross') : t('order.total')}: ${formatMoney(tot.gross)}`, t('doc.disclaimer'))
  }
  if (o.dueDate) lines.push(t('doc.dueText', { d: new Date(o.dueDate + 'T12:00').toLocaleDateString(LOCALE[lang]) }))
  if (s.shopName || s.shopPhone) lines.push('', [s.shopName, s.shopPhone].filter(Boolean).join(', '))
  return lines.join('\n')
}

/** «Машина готова» — короткое сообщение клиенту */
export function readyText(o: Order, lang: Lang, s: Settings): string {
  const t = makeT(lang)
  const tot = orderTotals(o, s)
  const lines = [t('ready.text', { car: carName(o) }).replace(/\s+([,.!])/g, '$1').replace(/\s{2,}/g, ' ')]
  if (tot.gross) lines.push(t('ready.sum', { sum: formatMoney(tot.gross) }))
  if (s.shopAddress) lines.push(t('ready.where', { addr: s.shopAddress }))
  if (s.shopName || s.shopPhone) lines.push('', [s.shopName, s.shopPhone].filter(Boolean).join(', '))
  return lines.join('\n')
}

/** Польский номер без кода страны → 48…, только цифры */
function intlDigits(phone: string): string {
  let d = phone.replace(/\D/g, '')
  if (d.length === 9) d = '48' + d
  if (d.startsWith('00')) d = d.slice(2)
  return d
}

export function whatsappUrl(phone: string, text: string): string {
  return `https://wa.me/${intlDigits(phone)}?text=${encodeURIComponent(text)}`
}

/** «?&body=» понимают и Android, и iPhone */
export function smsUrl(phone: string, text: string): string {
  const d = intlDigits(phone)
  return `sms:${d ? '+' + d : ''}?&body=${encodeURIComponent(text)}`
}

export function mailtoUrl(email: string, subject: string, text: string): string {
  return `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`
}

/** Текст через системное меню «Поделиться»; false — если меню нет */
export async function shareText(text: string, title: string): Promise<boolean> {
  if (isNative) {
    await shareTextNative(text, title)
    return true
  }
  if (!navigator.share) return false
  try {
    await navigator.share({ title, text })
  } catch (e) {
    if ((e as Error).name !== 'AbortError') return false
  }
  return true
}
