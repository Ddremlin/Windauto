// Разбор текста с фото номера и VIN. Камера и модель распознавания сюда не входят.
import { COUNTRIES } from './countries'
import { checkPlate, checkVin, normalizePlate } from './validate'

const VIN_FIX: Record<string, string> = { I: '1', O: '0', Q: '0' }

export interface ReadVin {
  value: string
  confident: boolean
}

export interface ReadPlate {
  value: string
  country?: string
  confident: boolean
}

function vinCheckDigit(vin: string): boolean {
  return checkVin(vin).message === 'v.vinOk'
}

/** 17 знаков VIN из сырого текста распознавания. */
export function readVin(text: string): ReadVin | null {
  const tokens = text.toUpperCase().match(/[A-Z0-9]+/g) ?? []
  const parts = tokens.filter((t) => t !== 'VIN').map((t) => t.replace(/[IOQ]/g, (c) => VIN_FIX[c]))
  const found: string[] = []
  for (let i = 0; i < parts.length; i++) {
    let acc = ''
    for (let j = i; j < Math.min(parts.length, i + 6); j++) {
      acc += parts[j]
      if (acc.length > 24) break
      if (acc.length < 17) continue
      for (let k = 0; k + 17 <= acc.length; k++) found.push(acc.slice(k, k + 17))
    }
  }
  const all = [...new Set(found)]
  if (!all.length) return null
  const checked = all.find(vinCheckDigit)
  const value = checked ?? all[0]
  return { value, confident: all.length === 1 || Boolean(checked) }
}

function plateScore(value: string, country: string): number {
  const s = normalizePlate(value)
  if (s.length < 4 || s.length > 10) return -1
  const level = checkPlate(s, country).level
  if (level === 'ok') return 3
  if (level === 'warn') return 2
  return -1
}

/** Номер и, если на снимке видна полоса страны, её код. */
export function readPlate(text: string): ReadPlate | null {
  const tokens = text.toUpperCase().match(/[A-Z0-9]+/g) ?? []
  const candidates: { value: string; country?: string; score: number }[] = []

  const push = (parts: string[], country?: string) => {
    if (!parts.length) return
    const windows = [parts.join('')]
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j <= Math.min(parts.length, i + 4); j++) windows.push(parts.slice(i, j).join(''))
    }
    const ctry = country ?? 'PL'
    for (const window of windows) {
      const value = normalizePlate(window)
      const score = plateScore(value, ctry)
      if (score >= 0) candidates.push({ value, country, score: score + (country ? 0.1 : 0) })
    }
  }

  push(tokens)
  if (tokens.length > 1) {
    const known = COUNTRIES.find((c) => c.code === tokens[0])
    if (known) push(tokens.slice(1), known.code)
  }

  if (!candidates.length) return null
  candidates.sort((a, b) => b.score - a.score || b.value.length - a.value.length)
  const best = candidates[0]
  return { value: best.value, country: best.country, confident: best.score >= 3 }
}
