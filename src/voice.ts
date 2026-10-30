// Голосовой ввод. Речь в текст переводит сам телефон (Web Speech API: Google на Android, Apple на iPhone);
// разбор текста по полям заказа — Claude на сервере (sync.parseVoice). Здесь — распознавание речи
// и применение результата к заказу.
import { SpeechRecognition } from '@capacitor-community/speech-recognition'
import { COUNTRIES } from './countries'
import { isNative } from './native'
import type { VoiceResult } from './sync'
import type { DamageId, ElementWork, Order, WorkId } from './types'
import { formatPlate, normalizeVin } from './validate'
import { DAMAGES, EXCLUSIVE, WORKS } from './works'

// --- распознавание речи ---

interface SpeechResultList {
  length: number
  [i: number]: { isFinal: boolean; 0: { transcript: string } }
}

interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: SpeechResultList }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type RecognitionCtor = new () => Recognition

const ctor = (): RecognitionCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export const speechSupported = () => isNative || Boolean(ctor())

// белорусский распознавание речи в Android не понимает — диктуют по-русски
export const SPEECH_LANG = { ru: 'ru-RU', pl: 'pl-PL', uk: 'uk-UA' } as const

export interface Listening {
  // закончить и отдать то, что успели сказать
  stop: () => void
  // бросить без результата
  cancel: () => void
}

/**
 * Слушает, пока не вызовут stop/cancel: распознавание в браузере само замолкает после паузы —
 * перезапускаем. onText — весь текст за сессию (готовый + ещё распознаваемый хвост).
 */
export function listen(
  lang: string,
  onText: (final: string, interim: string) => void,
  onEnd: (final: string, error?: string) => void,
): Listening {
  if (isNative) return listenNative(lang, onText, onEnd)
  const Ctor = ctor()
  if (!Ctor) {
    onEnd('', 'unsupported')
    return { stop: () => {}, cancel: () => {} }
  }
  let finalText = ''
  let active = true
  let failed: string | undefined
  let rec: Recognition

  const join = (a: string, b: string) => (a && b ? `${a} ${b}` : a || b).trim()

  const start = () => {
    rec = new Ctor()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    // результаты одной сессии распознавания; после перезапуска — новая сессия
    let session = ''
    rec.onresult = (e) => {
      let interim = ''
      session = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) session = join(session, r[0].transcript)
        else interim = join(interim, r[0].transcript)
      }
      onText(join(finalText, session), interim)
    }
    rec.onerror = (e) => {
      // тишина и прерывание — не ошибки
      if (e.error !== 'no-speech' && e.error !== 'aborted') failed = e.error
    }
    rec.onend = () => {
      finalText = join(finalText, session)
      if (active && !failed) return start()
      active = false
      onEnd(finalText, failed)
    }
    rec.start()
  }
  start()

  return {
    stop: () => {
      active = false
      rec.stop()
    },
    cancel: () => {
      active = false
      rec.onend = null
      rec.abort()
    },
  }
}

/**
 * То же в Android-приложении: распознаёт система Android (в WebView Web Speech API нет).
 * После паузы Android замолкает, а об ошибке «ничего не услышал» плагин не сообщает —
 * поэтому раз в полсекунды проверяем, слушает ли он ещё, и перезапускаем.
 */
function listenNative(
  lang: string,
  onText: (final: string, interim: string) => void,
  onEnd: (final: string, error?: string) => void,
): Listening {
  let finalText = ''
  let session = ''
  let active = true
  let restarting = false
  let stopping = false
  let watchdog: ReturnType<typeof setInterval> | undefined

  const join = (a: string, b: string) => (a && b ? `${a} ${b}` : a || b).trim()
  const finish = (error?: string) => {
    if (!active) return
    active = false
    clearInterval(watchdog)
    SpeechRecognition.removeAllListeners()
    SpeechRecognition.stop().catch(() => {})
    onEnd(join(finalText, session), error)
  }
  const begin = () =>
    SpeechRecognition.start({ language: lang, partialResults: true, popup: false, maxResults: 1 }).catch(() => {})

  // сессия закончилась: забираем её текст и слушаем дальше
  const restart = async () => {
    if (restarting || stopping || !active) return
    restarting = true
    // финальный результат приходит чуть позже сигнала «замолчал»
    await new Promise((r) => setTimeout(r, 400))
    finalText = join(finalText, session)
    session = ''
    if (active && !stopping) await begin()
    restarting = false
  }

  void (async () => {
    const perm = await SpeechRecognition.requestPermissions().catch(() => undefined)
    if (perm?.speechRecognition !== 'granted') return finish('not-allowed')
    if (!(await SpeechRecognition.available().catch(() => ({ available: false }))).available) return finish('unsupported')
    if (!active) return
    await SpeechRecognition.addListener('partialResults', ({ matches }) => {
      if (!active || !matches?.[0]) return
      session = matches[0]
      onText(finalText, session)
    })
    await SpeechRecognition.addListener('listeningState', ({ status }) => {
      if (status === 'stopped') void restart()
    })
    await begin()
    watchdog = setInterval(async () => {
      if (!active || restarting || stopping) return
      const { listening } = await SpeechRecognition.isListening().catch(() => ({ listening: false }))
      if (!listening) void restart()
    }, 500)
  })()

  return {
    stop: () => {
      if (!active || stopping) return
      // больше не перезапускаем, но даём долететь последнему результату
      stopping = true
      clearInterval(watchdog)
      SpeechRecognition.stop().catch(() => {})
      setTimeout(() => finish(), 400)
    },
    cancel: () => {
      active = false
      clearInterval(watchdog)
      SpeechRecognition.removeAllListeners()
      SpeechRecognition.stop().catch(() => {})
    },
  }
}

/** Вставляет текст в поле под курсором так, чтобы React увидел изменение */
export function insertText(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? el.value.length
  const before = el.value.slice(0, start)
  const after = el.value.slice(end)
  // пробел между словами; с заглавной в начале поля или после точки
  const sep = before && !/\s$/.test(before) ? ' ' : ''
  const cap = !before.trim() || /[.!?]\s*$/.test(before)
  const piece = sep + (cap ? text.charAt(0).toUpperCase() + text.slice(1) : text)
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
  setter?.call(el, before + piece + after)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  const pos = before.length + piece.length
  el.setSelectionRange?.(pos, pos)
}

/** Поле, в которое можно диктовать: текстовый input или textarea */
export function dictationTarget(el: Element | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el
  if (el instanceof HTMLInputElement && ['text', 'search', 'email', 'tel', 'url', ''].includes(el.type))
    return el.readOnly || el.disabled ? null : el
  return null
}

// --- применение разбора к заказу ---

// подписи полей в списке изменений (ключи i18n)
export const VOICE_FIELD_LABEL: Record<string, string> = {
  plate: 'order.plate',
  plateCountry: 'order.plateCountry',
  vin: 'order.vin',
  make: 'order.make',
  model: 'order.model',
  year: 'order.year',
  mileage: 'order.mileage',
  color: 'order.color',
  paintCode: 'order.paintCode',
  paintNotes: 'order.paintNotes',
  client: 'order.clientName',
  phone: 'order.phone',
  email: 'order.email',
  notes: 'order.notes',
}

// эти поля дописываются, остальные заменяются
const APPEND = new Set(['notes', 'paintNotes'])

export type VoiceChange =
  | { kind: 'field'; key: string; from: string; to: string }
  | { kind: 'element'; id: string; works: WorkId[]; damage: DamageId[]; price?: number; note?: string }

const workOrder = (a: WorkId, b: WorkId) => WORKS.findIndex((w) => w.id === a) - WORKS.findIndex((w) => w.id === b)

/**
 * Изменения заказа по разбору голоса. elementIds — элементы текущего кузова;
 * defaultPrices — цены из настроек для новых работ без названной цены.
 */
export function applyVoice(
  order: Order,
  r: VoiceResult,
  elementIds: Set<string>,
  defaultPrices: Partial<Record<WorkId, number>>,
): { patch: Partial<Order>; changes: VoiceChange[] } {
  const patch: Partial<Order> = {}
  const changes: VoiceChange[] = []
  const o = order as unknown as Record<string, string>

  const country = (() => {
    const c = r.fields.plateCountry?.trim().toUpperCase()
    return COUNTRIES.find((x) => x.code === c || x.iso === c)?.code
  })()

  for (const key of Object.keys(VOICE_FIELD_LABEL)) {
    let v = (r.fields[key] ?? '').trim()
    if (!v || key === 'plateCountry') continue
    if (key === 'vin') v = normalizeVin(v)
    if (key === 'plate') v = formatPlate(v.toUpperCase(), country ?? order.plateCountry)
    if (key === 'mileage') v = v.replace(/\D/g, '')
    if (key === 'year') v = v.match(/\d{4}/)?.[0] ?? ''
    if (!v) continue
    const cur = o[key] ?? ''
    const next = APPEND.has(key) && cur.trim() ? `${cur.trimEnd()}\n${v}` : v
    if (next === cur) continue
    ;(patch as Record<string, string>)[key] = next
    changes.push({ kind: 'field', key, from: cur, to: APPEND.has(key) ? v : next })
  }
  if (country && country !== order.plateCountry) {
    patch.plateCountry = country
    changes.push({ kind: 'field', key: 'plateCountry', from: order.plateCountry, to: country })
  }

  const elements = { ...order.elements }
  let touched = false
  for (const e of r.elements) {
    if (!elementIds.has(e.id)) continue
    const newWorks = e.works.filter((w): w is WorkId => WORKS.some((x) => x.id === w))
    const newDamage = e.damage.filter((d): d is DamageId => DAMAGES.includes(d as DamageId))
    const note = e.note.trim()
    if (!newWorks.length && !newDamage.length && !note && !(e.price > 0)) continue
    const cur: ElementWork = elements[e.id] ?? { works: [] }
    // новая работа из взаимоисключающей группы (окрас частичный / полный) заменяет другую
    let works = cur.works.filter((w) => !newWorks.some((n) => EXCLUSIVE.some((g) => g.includes(n) && g.includes(w) && n !== w)))
    works = [...new Set([...works, ...newWorks])].sort(workOrder)
    const prices = { ...cur.prices }
    for (const w of newWorks) if (prices[w] === undefined && defaultPrices[w] !== undefined) prices[w] = defaultPrices[w]
    // названная цена — на работу, если она одна; иначе — в комментарий, чтобы не угадывать
    let priceNote = ''
    if (e.price > 0) {
      if (newWorks.length === 1) prices[newWorks[0]] = e.price
      else priceNote = `${e.price} zł`
    }
    const damage = [...new Set([...(cur.damage ?? []), ...newDamage])]
    const extra = [note, priceNote].filter(Boolean).join(', ')
    const next: ElementWork = {
      ...cur,
      works,
      ...(Object.keys(prices).length ? { prices } : {}),
      ...(damage.length ? { damage } : {}),
      ...(extra ? { note: cur.note?.trim() ? `${cur.note.trim()}; ${extra}` : extra } : {}),
    }
    elements[e.id] = next
    touched = true
    changes.push({
      kind: 'element',
      id: e.id,
      works: newWorks,
      damage: newDamage,
      ...(e.price > 0 ? { price: e.price } : {}),
      ...(extra ? { note: extra } : {}),
    })
  }
  if (touched) patch.elements = elements
  return { patch, changes }
}
