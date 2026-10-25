// Страна регистрации авто: код с полосы номерного знака и ISO-код для названия.
export interface Country {
  code: string // как на номере
  iso: string
  eu?: boolean // синяя полоса EU со звёздами
  flag?: [string, string] // своя полоса-флаг (сверху, снизу)
}

export const COUNTRIES: Country[] = [
  { code: 'PL', iso: 'PL', eu: true },
  { code: 'D', iso: 'DE', eu: true },
  { code: 'UA', iso: 'UA', flag: ['#0057b7', '#ffd700'] },
  { code: 'LT', iso: 'LT', eu: true },
  { code: 'CZ', iso: 'CZ', eu: true },
  { code: 'SK', iso: 'SK', eu: true },
  { code: 'BY', iso: 'BY', flag: ['#c8313e', '#4aa657'] },
  { code: 'LV', iso: 'LV', eu: true },
  { code: 'EST', iso: 'EE', eu: true },
  { code: 'NL', iso: 'NL', eu: true },
  { code: 'B', iso: 'BE', eu: true },
  { code: 'F', iso: 'FR', eu: true },
  { code: 'I', iso: 'IT', eu: true },
  { code: 'E', iso: 'ES', eu: true },
  { code: 'A', iso: 'AT', eu: true },
  { code: 'H', iso: 'HU', eu: true },
  { code: 'RO', iso: 'RO', eu: true },
  { code: 'BG', iso: 'BG', eu: true },
  { code: 'S', iso: 'SE', eu: true },
  { code: 'DK', iso: 'DK', eu: true },
  { code: 'FIN', iso: 'FI', eu: true },
  { code: 'IRL', iso: 'IE', eu: true },
  { code: 'P', iso: 'PT', eu: true },
  { code: 'GR', iso: 'GR', eu: true },
  { code: 'SLO', iso: 'SI', eu: true },
  { code: 'HR', iso: 'HR', eu: true },
  { code: 'L', iso: 'LU', eu: true },
  { code: 'N', iso: 'NO' },
  { code: 'CH', iso: 'CH' },
  { code: 'UK', iso: 'GB' },
  { code: 'MD', iso: 'MD' },
  { code: 'TR', iso: 'TR' },
]

export const countryByCode = (code: string | undefined): Country =>
  COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0]

export function countryName(c: Country, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(c.iso) ?? c.code
  } catch {
    return c.code
  }
}
