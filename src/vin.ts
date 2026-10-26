// Расшифровка VIN без интернета: марка по коду производителя (WMI, первые 2–3 символа)
// и год выпуска по 10-му символу. Год в 10-м символе обязателен только в Северной Америке;
// европейские заводы многих марок ставят туда что угодно, поэтому год предлагаем
// только для марок, у которых он надёжен.
import { normalizeVin } from './validate'

interface Wmi {
  make: string
  // 10-й символ VIN — год модели
  year?: boolean
}

// длинные префиксы проверяются раньше коротких
const WMI: Record<string, Wmi> = {
  // VAG
  WVW: { make: 'Volkswagen', year: true },
  WV1: { make: 'Volkswagen', year: true },
  WV2: { make: 'Volkswagen', year: true },
  WV3: { make: 'Volkswagen', year: true },
  VWV: { make: 'Volkswagen', year: true },
  '3VW': { make: 'Volkswagen', year: true },
  LSV: { make: 'Volkswagen', year: true },
  WAU: { make: 'Audi', year: true },
  WA1: { make: 'Audi', year: true },
  WUA: { make: 'Audi', year: true },
  TRU: { make: 'Audi', year: true },
  TMB: { make: 'Škoda', year: true },
  VSS: { make: 'Seat', year: true },
  WP0: { make: 'Porsche', year: true },
  WP1: { make: 'Porsche', year: true },
  // немецкие
  WBA: { make: 'BMW' },
  WBS: { make: 'BMW' },
  WBY: { make: 'BMW' },
  '4US': { make: 'BMW', year: true },
  '5UX': { make: 'BMW', year: true },
  '5YM': { make: 'BMW', year: true },
  WMW: { make: 'Mini' },
  WDB: { make: 'Mercedes-Benz' },
  WDC: { make: 'Mercedes-Benz' },
  WDD: { make: 'Mercedes-Benz' },
  WDF: { make: 'Mercedes-Benz' },
  W1K: { make: 'Mercedes-Benz' },
  W1N: { make: 'Mercedes-Benz' },
  W1V: { make: 'Mercedes-Benz' },
  WME: { make: 'Smart' },
  W0L: { make: 'Opel' },
  W0V: { make: 'Opel' },
  WF0: { make: 'Ford' },
  NM0: { make: 'Ford' },
  '1FA': { make: 'Ford', year: true },
  '1FM': { make: 'Ford', year: true },
  '1FT': { make: 'Ford', year: true },
  '2FM': { make: 'Ford', year: true },
  '3FA': { make: 'Ford', year: true },
  // французские
  VF1: { make: 'Renault' },
  VF3: { make: 'Peugeot' },
  VR3: { make: 'Peugeot' },
  VF7: { make: 'Citroën' },
  VR7: { make: 'Citroën' },
  VR1: { make: 'DS' },
  UU1: { make: 'Dacia' },
  UU3: { make: 'Dacia' },
  // итальянские
  ZFA: { make: 'Fiat' },
  ZAR: { make: 'Alfa Romeo' },
  ZLA: { make: 'Lancia' },
  ZAM: { make: 'Maserati' },
  ZFF: { make: 'Ferrari' },
  ZCF: { make: 'Iveco' },
  // японские
  JTH: { make: 'Lexus', year: true },
  JTJ: { make: 'Lexus', year: true },
  JT: { make: 'Toyota', year: true },
  SB1: { make: 'Toyota', year: true },
  NMT: { make: 'Toyota', year: true },
  VNK: { make: 'Toyota', year: true },
  MR0: { make: 'Toyota', year: true },
  JHM: { make: 'Honda', year: true },
  JHL: { make: 'Honda', year: true },
  SHH: { make: 'Honda', year: true },
  SHS: { make: 'Honda', year: true },
  JMZ: { make: 'Mazda' },
  JM1: { make: 'Mazda', year: true },
  JM3: { make: 'Mazda', year: true },
  JN1: { make: 'Nissan' },
  JN8: { make: 'Nissan' },
  SJN: { make: 'Nissan' },
  VSK: { make: 'Nissan' },
  JS: { make: 'Suzuki' },
  TSM: { make: 'Suzuki' },
  JMB: { make: 'Mitsubishi' },
  JMY: { make: 'Mitsubishi' },
  JA: { make: 'Mitsubishi' },
  JF1: { make: 'Subaru', year: true },
  JF2: { make: 'Subaru', year: true },
  // корейские
  KMH: { make: 'Hyundai', year: true },
  KMF: { make: 'Hyundai', year: true },
  TMA: { make: 'Hyundai', year: true },
  NLH: { make: 'Hyundai', year: true },
  KNA: { make: 'Kia', year: true },
  KNC: { make: 'Kia', year: true },
  KNE: { make: 'Kia', year: true },
  U5Y: { make: 'Kia', year: true },
  U6Y: { make: 'Kia', year: true },
  KPT: { make: 'SsangYong' },
  KL: { make: 'Chevrolet' },
  // прочие
  YV1: { make: 'Volvo', year: true },
  YV4: { make: 'Volvo', year: true },
  LYV: { make: 'Volvo', year: true },
  SAL: { make: 'Land Rover' },
  SAJ: { make: 'Jaguar' },
  SAD: { make: 'Jaguar' },
  YS3: { make: 'Saab' },
  XTA: { make: 'Lada' },
  '5YJ': { make: 'Tesla', year: true },
  '7SA': { make: 'Tesla', year: true },
  XP7: { make: 'Tesla', year: true },
  LRW: { make: 'Tesla', year: true },
  LSJ: { make: 'MG' },
  LC0: { make: 'BYD' },
  LGX: { make: 'BYD' },
  '1G1': { make: 'Chevrolet', year: true },
  '1J4': { make: 'Jeep', year: true },
  '1J8': { make: 'Jeep', year: true },
}

const PREFIXES = Object.keys(WMI).sort((a, b) => b.length - a.length)

// 10-й символ: A=1980 … Y=2000, 1=2001 … 9=2009, затем снова A=2010 …
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789'

export function vinYear(code: string, now = new Date().getFullYear()): number | null {
  const i = YEAR_CODES.indexOf(code)
  if (i < 0) return null
  // самый поздний год цикла, не позже следующего года (модельный год)
  let y = 1980 + i
  while (y + 30 <= now + 1) y += 30
  return y
}

export interface VinInfo {
  make?: string
  year?: number
}

export function decodeVin(raw: string, now = new Date().getFullYear()): VinInfo {
  const vin = normalizeVin(raw)
  if (vin.length !== 17 || /[IOQ]/.test(vin)) return {}
  const prefix = PREFIXES.find((p) => vin.startsWith(p))
  if (!prefix) return {}
  const w = WMI[prefix]
  const year = w.year ? vinYear(vin[9], now) : null
  return { make: w.make, ...(year ? { year } : {}) }
}
