export type Level = 'ok' | 'warn' | 'error' | 'empty'

export interface Check {
  level: Level
  // ключ перевода из i18n.ts
  message?: string
  vars?: Record<string, string | number>
}

// Первая буква польского номера — воеводство (H — службы, U — армия)
const PL_REGION = 'BCDEFGKLNOPRSTWZ'
const PL_STANDARD = new RegExp(`^[${PL_REGION}][A-Z]{1,2}[0-9A-Z]{4,5}$`)
const PL_INDIVIDUAL = new RegExp(`^[${PL_REGION}][0-9][A-Z0-9]{3,5}$`)
const PL_SERVICE = /^[HU][A-Z]{1,3}[0-9A-Z]{3,5}$/

export function normalizePlate(raw: string): string {
  let s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  // полоска EU с кодом страны, если её ввели вместе с номером
  if (s.startsWith('PL') && s.length > 8) s = s.slice(2)
  return s
}

/** "WA12345" -> "WA 12345", "KRA1234" -> "KRA 1234" */
export function formatPlate(raw: string): string {
  const s = normalizePlate(raw)
  if (PL_INDIVIDUAL.test(s)) return `${s.slice(0, 2)} ${s.slice(2)}`
  const m = s.match(/^([A-Z]{2,3})([0-9].*)$/) ?? s.match(/^([A-Z]{3})(.+)$/)
  return m ? `${m[1]} ${m[2]}` : s
}

export function checkPlatePL(raw: string): Check {
  const s = normalizePlate(raw)
  if (!s) return { level: 'empty' }
  if (s.length < 4 || s.length > 8) return { level: 'error', message: 'v.plateLen' }
  if (PL_STANDARD.test(s)) {
    const district = s.match(/^[A-Z]{2,3}/)![0]
    const rest = s.slice(district.length)
    // в польских номерах после кода повята не используют B, D, I, O, Z
    if (/[BDIOZ]/.test(rest)) return { level: 'warn', message: 'v.plateLetters' }
    return { level: 'ok', message: 'v.plateOk' }
  }
  if (PL_INDIVIDUAL.test(s)) return { level: 'ok', message: 'v.plateIndividual' }
  if (PL_SERVICE.test(s)) return { level: 'ok', message: 'v.plateService' }
  return { level: 'warn', message: 'v.plateForeign' }
}

const VIN_MAP: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
}
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

export function normalizeVin(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function checkVin(raw: string): Check {
  const s = normalizeVin(raw)
  if (!s) return { level: 'empty' }
  if (/[IOQ]/.test(s)) return { level: 'error', message: 'v.vinIOQ' }
  if (s.length !== 17) return { level: 'error', message: 'v.vinLen', vars: { n: s.length } }
  let sum = 0
  for (let i = 0; i < 17; i++) {
    const c = s[i]
    const v = c >= '0' && c <= '9' ? Number(c) : VIN_MAP[c]
    sum += v * VIN_WEIGHTS[i]
  }
  const rem = sum % 11
  const expected = rem === 10 ? 'X' : String(rem)
  // контрольная цифра обязательна только для Северной Америки, в Европе часто не совпадает
  if (s[8] !== expected) return { level: 'ok', message: 'v.vinOkNoCheck' }
  return { level: 'ok', message: 'v.vinOk' }
}

export function checkEmail(raw: string): Check {
  const s = raw.trim()
  if (!s) return { level: 'empty' }
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? { level: 'ok' } : { level: 'warn', message: 'v.email' }
}
