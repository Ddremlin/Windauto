// Настройки вне React: язык — свой на каждом телефоне; данные сервиса и цены — общие,
// синхронизируются между сотрудниками (sharedUpdatedAt — для выбора более свежих).
import type { Lang } from './i18n'
import type { WorkId } from './types'

export interface SharedSettings {
  shopName: string
  shopAddress: string
  shopPhone: string
  shopNip: string
  defaultPrices: Partial<Record<WorkId, number>>
  // ставка VAT, %; 0 — без VAT
  vatRate: number
  // цены вводятся брутто (с VAT)
  pricesGross: boolean
  // свой текст информации RODO; пусто — стандартный
  rodoText: string
}

export const CURRENCIES = { PLN: 'zł', EUR: '€', USD: '$', UAH: '₴', BYN: 'Br', RUB: '₽', CZK: 'Kč' } as const
export type Currency = keyof typeof CURRENCIES

export interface Settings extends SharedSettings {
  lang: Lang
  docLang: Lang
  // валюта на этом телефоне; при польском интерфейсе всегда злотый
  currency: Currency
  sharedUpdatedAt: number
}

export const SHARED_KEYS: (keyof SharedSettings)[] = [
  'shopName',
  'shopAddress',
  'shopPhone',
  'shopNip',
  'defaultPrices',
  'vatRate',
  'pricesGross',
  'rodoText',
]

const KEY = 'windauto.settings.v1'

const DEFAULTS: Settings = {
  lang: 'ru',
  docLang: 'pl',
  currency: 'PLN',
  shopName: '',
  shopAddress: '',
  shopPhone: '',
  shopNip: '',
  defaultPrices: {},
  vatRate: 23,
  pricesGross: true,
  rodoText: '',
  sharedUpdatedAt: 0,
}

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

let settings = load()
const listeners = new Set<() => void>()
const sharedListeners = new Set<() => void>()

export const getSettings = () => settings

/** Валюта сумм: польский интерфейс — злотый, иначе выбранная в Настройках */
export const currencyOf = (s: Pick<Settings, 'lang' | 'currency'>): Currency =>
  s.lang === 'pl' || !(s.currency in CURRENCIES) ? 'PLN' : s.currency
export const currencySymbol = () => CURRENCIES[currencyOf(settings)]

export const pickShared = (s: Settings): SharedSettings =>
  Object.fromEntries(SHARED_KEYS.map((k) => [k, s[k]])) as unknown as SharedSettings

function commit(next: Settings) {
  settings = next
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    /* нет места — настройки останутся до перезапуска */
  }
  listeners.forEach((l) => l())
}

export function updateSettings(patch: Partial<Settings>) {
  const touchesShared = SHARED_KEYS.some((k) => k in patch)
  commit({ ...settings, ...patch, ...(touchesShared ? { sharedUpdatedAt: Date.now() } : {}) })
  if (touchesShared) sharedListeners.forEach((l) => l())
}

/** Общие настройки, пришедшие с сервера */
export function applyRemoteShared(data: SharedSettings, updatedAt: number) {
  if (updatedAt <= settings.sharedUpdatedAt) return
  // старый сервер может не знать новых полей — оставляем значения по умолчанию
  const known = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
  commit({ ...settings, ...known, sharedUpdatedAt: updatedAt })
}

/** Есть ли в общих настройках что-то заполненное */
export const hasShared = (s: Settings) =>
  Boolean(s.shopName || s.shopAddress || s.shopPhone || s.shopNip || s.rodoText || Object.keys(s.defaultPrices).length)

/** Вход в другую компанию: реквизиты и цены прежней не должны к ней попасть */
export function resetShared() {
  commit({ ...settings, ...pickShared(DEFAULTS), sharedUpdatedAt: 0 })
}

/** Поставить отметку времени общим настройкам без уведомления (0 — уступить серверу) */
export function setSharedStamp(at: number) {
  commit({ ...settings, sharedUpdatedAt: at })
}

export function onSharedChange(fn: () => void) {
  sharedListeners.add(fn)
  return () => sharedListeners.delete(fn)
}

export function subscribeSettings(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}
