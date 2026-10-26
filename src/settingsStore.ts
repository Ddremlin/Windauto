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
}

export interface Settings extends SharedSettings {
  lang: Lang
  docLang: Lang
  sharedUpdatedAt: number
}

export const SHARED_KEYS: (keyof SharedSettings)[] = ['shopName', 'shopAddress', 'shopPhone', 'shopNip', 'defaultPrices']

const KEY = 'windauto.settings.v1'

const DEFAULTS: Settings = {
  lang: 'ru',
  docLang: 'pl',
  shopName: '',
  shopAddress: '',
  shopPhone: '',
  shopNip: '',
  defaultPrices: {},
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
  commit({ ...settings, ...data, sharedUpdatedAt: updatedAt })
}

/** Есть ли в общих настройках что-то заполненное */
export const hasShared = (s: Settings) =>
  Boolean(s.shopName || s.shopAddress || s.shopPhone || s.shopNip || Object.keys(s.defaultPrices).length)

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
