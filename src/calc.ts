// Калькулятор: состояние и нажатия кнопок. Порядок действий как в телефонном калькуляторе:
// «×» и «÷» раньше «+» и «−»; «%» после «+»/«−» — процент от того, что набрано до него.

export type Op = '+' | '-' | '*' | '/'

export interface CalcState {
  // набранное выражение без текущего числа: [число, действие, число, действие…]
  tokens: (number | Op)[]
  // текущее число, как набирают: «12.5», «-3», «0.»
  entry: string
  // после «=»: выражение и результат; следующая цифра начинает новый счёт
  shown?: { expr: (number | Op)[]; value: number }
  error?: boolean
}

export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | Op | '=' | '%' | '±' | 'back' | 'C'

export const EMPTY: CalcState = { tokens: [], entry: '' }

const MAX_DIGITS = 15

// 0.1 + 0.2 = 0.3, а не 0.30000000000000004
export const round = (v: number) => (Number.isFinite(v) ? Number.parseFloat(v.toPrecision(12)) : v)

export function evaluate(tokens: (number | Op)[]): number {
  const list = tokens.slice()
  if (typeof list[list.length - 1] === 'string') list.pop()
  if (!list.length) return 0
  // сначала умножение и деление
  const sums: (number | Op)[] = [list[0]]
  for (let i = 1; i < list.length; i += 2) {
    const op = list[i] as Op
    const n = list[i + 1] as number
    if (op === '*' || op === '/') {
      const a = sums.pop() as number
      sums.push(op === '*' ? a * n : a / n)
    } else sums.push(op, n)
  }
  let r = sums[0] as number
  for (let i = 1; i < sums.length; i += 2) r = sums[i] === '+' ? r + (sums[i + 1] as number) : r - (sums[i + 1] as number)
  return round(r)
}

/** Что сейчас на экране крупно: набираемое число или результат */
export function currentValue(s: CalcState): number {
  if (s.entry && s.entry !== '-') return Number(s.entry)
  if (s.shown) return s.shown.value
  return s.tokens.length ? evaluate(s.tokens) : 0
}

const fromNumber = (v: number) => String(round(v))

export function press(s: CalcState, key: Key): CalcState {
  if (key === 'C') return EMPTY
  if (s.error) s = EMPTY

  if (/^[0-9]$/.test(key)) {
    if (s.shown) s = EMPTY
    const digits = s.entry.replace(/\D/g, '').length
    if (digits >= MAX_DIGITS) return s
    const entry = s.entry === '0' ? key : s.entry === '-0' ? '-' + key : s.entry + key
    return { ...s, entry }
  }

  if (key === '.') {
    if (s.shown) s = EMPTY
    if (s.entry.includes('.')) return s
    return { ...s, entry: (s.entry === '' || s.entry === '-' ? s.entry + '0' : s.entry) + '.' }
  }

  if (key === '+' || key === '-' || key === '*' || key === '/') {
    if (s.shown) return { tokens: [s.shown.value, key], entry: '' }
    if (!s.entry || s.entry === '-') {
      // действие подряд — заменяем предыдущее
      if (!s.tokens.length) return { tokens: [0, key], entry: '' }
      return { ...s, tokens: [...s.tokens.slice(0, -1), key], entry: '' }
    }
    return { tokens: [...s.tokens, Number(s.entry), key], entry: '' }
  }

  if (key === '=') {
    if (s.shown) return s
    const expr = s.entry && s.entry !== '-' ? [...s.tokens, Number(s.entry)] : s.tokens.slice(0, -1)
    if (!expr.length) return s
    const value = evaluate(expr)
    if (!Number.isFinite(value)) return { ...EMPTY, error: true }
    return { tokens: [], entry: '', shown: { expr, value } }
  }

  if (key === '%') {
    const base = s.shown ? s.shown.value : Number(s.entry || 0)
    if (s.shown || !s.tokens.length) return { tokens: [], entry: fromNumber(base / 100) }
    const op = s.tokens[s.tokens.length - 1]
    // 200 + 10% → 200 + 20; 200 × 10% → 200 × 0.1
    const pct = op === '+' || op === '-' ? (evaluate(s.tokens) * base) / 100 : base / 100
    return { ...s, entry: fromNumber(pct) }
  }

  if (key === '±') {
    if (s.shown) return { tokens: [], entry: fromNumber(-s.shown.value) }
    if (!s.entry) return { ...s, entry: '-' }
    return { ...s, entry: s.entry.startsWith('-') ? s.entry.slice(1) : '-' + s.entry }
  }

  if (key === 'back') {
    if (s.shown) return EMPTY
    if (s.entry) return { ...s, entry: s.entry.slice(0, -1) }
    // стираем действие — предыдущее число снова набирается
    if (s.tokens.length) {
      const tokens = s.tokens.slice(0, -1)
      const last = tokens.pop()
      return { tokens, entry: last === undefined ? '' : fromNumber(last as number) }
    }
    return s
  }
  return s
}

/** Подставить число (из памяти или истории) вместо набираемого */
export function putValue(s: CalcState, v: number): CalcState {
  const base = s.shown || s.error ? EMPTY : s
  return { ...base, entry: fromNumber(v) }
}

export const OP_SIGN: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' }

/** Число для экрана: «12 345,5» по-польски и по-русски */
export function formatNum(v: number | string, locale: string): string {
  const raw = typeof v === 'number' ? fromNumber(v) : v
  if (raw === '' || raw === '-') return raw || '0'
  // очень большие и очень маленькие — как есть (1e+21)
  if (/e/i.test(raw)) return raw
  const neg = raw.startsWith('-')
  const [int, frac] = raw.replace('-', '').split('.')
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: true }).format(BigInt(int || '0'))
  const dec = new Intl.NumberFormat(locale).format(1.5).charAt(1)
  return (neg ? '−' : '') + grouped + (frac !== undefined ? dec + frac : '')
}

export function formatExpr(tokens: (number | Op)[], locale: string): string {
  return tokens.map((x) => (typeof x === 'number' ? formatNum(x, locale) : OP_SIGN[x])).join(' ')
}
