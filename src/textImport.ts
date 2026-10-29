// Заказ из текстового файла: строки «Поле: значение» (рус., пол., англ.) и то, что узнаётся само —
// VIN, телефон, e-mail. Без подписей текст уходит в примечания. Свободный текст лучше разбирает
// Claude на сервере (тот же разбор, что у голоса) — это делает экран импорта, если есть общая база.
import { COUNTRIES } from './countries'
import type { Order } from './types'
import { formatPlate, normalizePlate, normalizeVin } from './validate'

export type TextField =
  | 'plate'
  | 'plateCountry'
  | 'vin'
  | 'make'
  | 'model'
  | 'year'
  | 'mileage'
  | 'color'
  | 'paintCode'
  | 'client'
  | 'phone'
  | 'email'
  | 'assignee'
  | 'dueDate'
  | 'notes'

export type ParsedText = Partial<Record<TextField, string>>

// подписи в нижнем регистре, без точек и двоеточий; первая подходящая
const LABELS: [TextField, string[]][] = [
  ['plateCountry', ['страна', 'страна регистрации', 'kraj', 'kraj rejestracji', 'country']],
  ['plate', ['номер', 'госномер', 'гос номер', 'рег номер', 'номерной знак', 'nr rej', 'nr rejestracyjny', 'numer rejestracyjny', 'rejestracja', 'tablica', 'plate', 'reg']],
  ['vin', ['vin', 'вин', 'nr vin', 'номер кузова', 'nr nadwozia']],
  ['make', ['марка', 'marka', 'make', 'brand']],
  ['model', ['модель', 'model']],
  ['year', ['год', 'год выпуска', 'rok', 'rok produkcji', 'year']],
  ['mileage', ['пробег', 'przebieg', 'mileage', 'km']],
  ['color', ['цвет', 'kolor', 'color', 'colour']],
  ['paintCode', ['код краски', 'kod lakieru', 'kod koloru', 'paint code']],
  ['client', ['клиент', 'владелец', 'имя', 'фио', 'заказчик', 'klient', 'właściciel', 'imię i nazwisko', 'imię', 'nazwisko', 'firma', 'client', 'owner', 'name']],
  ['phone', ['телефон', 'тел', 'моб', 'telefon', 'tel', 'kom', 'phone']],
  ['email', ['email', 'e-mail', 'почта', 'эл почта', 'mail']],
  ['assignee', ['ответственный', 'мастер', 'сотрудник', 'mechanik', 'pracownik', 'odpowiedzialny', 'lakiernik']],
  ['dueDate', ['срок', 'срок готовности', 'готовность', 'дата выдачи', 'termin', 'termin realizacji', 'termin odbioru', 'due', 'deadline']],
  ['notes', ['примечания', 'примечание', 'заметки', 'комментарий', 'работы', 'uwagi', 'notatki', 'opis', 'zakres prac', 'notes']],
]

const LABEL_OF = new Map(LABELS.flatMap(([f, list]) => list.map((l) => [l, f] as const)))

const cleanLabel = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.:№#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Байты файла → текст: UTF-8, а если файл в старой кодировке — Windows-1251 или 1250 */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '')
  } catch {
    const cyr = new TextDecoder('windows-1251').decode(buf)
    const letters = cyr.match(/\p{L}/gu)?.length ?? 0
    const cyrLetters = cyr.match(/[а-яё]/giu)?.length ?? 0
    return letters && cyrLetters / letters > 0.5 ? cyr : new TextDecoder('windows-1250').decode(buf)
  }
}

/** Несколько заказов в одном файле — разделены строкой «---» или «===» */
export function splitOrders(text: string): string[] {
  return text
    .split(/^\s*(?:-{3,}|={3,})\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** «31.10.2026», «31.10», «2026-10-31» → «2026-10-31» */
export function parseDate(raw: string, now = new Date()): string {
  const iso = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  const dmy = raw.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/)
  let y: number, m: number, d: number
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (dmy) {
    d = Number(dmy[1])
    m = Number(dmy[2])
    y = dmy[3] ? Number(dmy[3].length === 2 ? '20' + dmy[3] : dmy[3]) : now.getFullYear()
  } else return ''
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return ''
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/
const PHONE_RE = /(?:\+|00)?\d[\d\s()-]{7,16}\d/

function cleanValue(f: TextField, v: string): string {
  v = v.trim()
  if (f === 'vin') return normalizeVin(v)
  if (f === 'year') return v.match(/\b(19|20)\d{2}\b/)?.[0] ?? ''
  if (f === 'mileage') return v.replace(/\D/g, '')
  if (f === 'email') return v.match(EMAIL_RE)?.[0] ?? ''
  if (f === 'phone') return v.match(PHONE_RE)?.[0].trim() ?? v
  if (f === 'dueDate') return parseDate(v)
  if (f === 'plateCountry') {
    const c = v.toUpperCase()
    return COUNTRIES.find((x) => x.code === c || x.iso === c)?.code ?? ''
  }
  return v
}

const addLine = (cur: string | undefined, s: string) => (cur ? cur + '\n' + s : s)

/** Разбор одного заказа. Строки без подписи и всё лишнее — в notes. */
export function parseOrderText(text: string): ParsedText {
  const out: ParsedText = {}
  const rest: string[] = []
  let last: TextField | undefined
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) {
      last = undefined
      continue
    }
    const m = s.match(/^([^:=\t]{1,40}?)\s*[:=\t]\s*(.*)$/)
    const field = m ? LABEL_OF.get(cleanLabel(m[1])) : undefined
    if (m && field) {
      const v = cleanValue(field, m[2])
      if (v && !out[field]) out[field] = v
      else if (v && field === 'notes') out.notes = addLine(out.notes, v)
      last = field
      continue
    }
    // продолжение примечаний на следующих строках
    if (last === 'notes') {
      out.notes = addLine(out.notes, s)
      continue
    }
    rest.push(s)
  }

  // без подписей: узнаём по виду
  const free = rest.join('\n')
  if (!out.vin) {
    // 17 знаков подряд, хотя бы одна буква и одна цифра
    const v = free.toUpperCase().match(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-HJ-NPR-Z0-9]{17}\b/)
    if (v) out.vin = v[0]
  }
  if (!out.email) {
    const e = free.match(EMAIL_RE)?.[0]
    if (e) out.email = e
  }
  if (!out.phone) {
    const p = free.match(PHONE_RE)?.[0]
    if (p && p.replace(/\D/g, '').length >= 9) out.phone = p.trim()
  }
  const leftovers = rest.filter((s) => !(out.email && s === out.email) && !(out.phone && s === out.phone) && !(out.vin && normalizeVin(s) === out.vin))
  if (leftovers.length) out.notes = [out.notes, ...leftovers].filter(Boolean).join('\n')

  if (out.plate) out.plate = formatPlate(out.plate, out.plateCountry || 'PL')
  return out
}

/** Поля разбора → изменения заказа */
export function parsedToPatch(p: ParsedText): Partial<Order> {
  const patch: Partial<Order> = {}
  for (const [k, v] of Object.entries(p) as [TextField, string][]) if (v) (patch as Record<string, string>)[k] = v
  if (patch.plate && !normalizePlate(patch.plate)) delete patch.plate
  return patch
}
