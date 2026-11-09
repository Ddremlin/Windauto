// Блокировка приложения PIN-кодом: потерянный или оставленный телефон не открывает базу клиентов.
// PIN хранится только на этом устройстве — как хеш PBKDF2 с солью. Приложение запирается при запуске
// и после того, как пробыло в фоне дольше заданного времени. Много неверных попыток — пауза растёт.
import { useSyncExternalStore } from 'react'

const KEY = 'windauto.lock.v1'
const ITER = 150_000

export interface LockConfig {
  salt: string
  hash: string
  // через сколько минут в фоне запирать (0 — сразу)
  minutes: number
  // неверных попыток подряд и до какого времени ждать
  fails: number
  waitUntil: number
}

function load(): LockConfig | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return v && typeof v.hash === 'string' ? v : null
  } catch {
    return null
  }
}
function save(c: LockConfig | null) {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c))
    else localStorage.removeItem(KEY)
  } catch {
    /* приватный режим */
  }
}

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)))

async function derive(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: ITER }, key, 256))
}

export const PIN_RE = /^\d{4,8}$/

let config = load()
let locked = Boolean(config)
let hiddenAt = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const lockEnabled = () => Boolean(config)
export const lockMinutes = () => config?.minutes ?? 1

export async function setPin(pin: string, minutes = config?.minutes ?? 1) {
  if (!PIN_RE.test(pin)) throw new Error('pin')
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  config = { salt, hash: await derive(pin, salt), minutes, fails: 0, waitUntil: 0 }
  save(config)
  emit()
}

export function setLockMinutes(minutes: number) {
  if (!config) return
  config = { ...config, minutes }
  save(config)
  emit()
}

/** Сколько секунд ещё ждать после неверных попыток */
export const waitLeft = () => Math.max(0, Math.ceil(((config?.waitUntil ?? 0) - Date.now()) / 1000))

/** Проверить PIN; верный — отпирает. false — неверный (или ещё идёт пауза) */
export async function unlock(pin: string): Promise<boolean> {
  if (!config) return true
  if (waitLeft()) return false
  if ((await derive(pin, config.salt)) === config.hash) {
    config = { ...config, fails: 0, waitUntil: 0 }
    save(config)
    locked = false
    emit()
    return true
  }
  const fails = config.fails + 1
  // после 5 ошибок: 30 с, 1 мин, 2 мин… до часа
  const wait = fails >= 5 ? Math.min(3600, 30 * 2 ** (fails - 5)) * 1000 : 0
  config = { ...config, fails, waitUntil: wait ? Date.now() + wait : 0 }
  save(config)
  emit()
  return false
}

/** Снять PIN (нужен текущий) */
export async function removePin(pin: string): Promise<boolean> {
  if (!config) return true
  if (waitLeft() || (await derive(pin, config.salt)) !== config.hash) return false
  forgetPin()
  return true
}

/** PIN забыт: снимается вместе с данными компании на устройстве (это делает вызывающий) */
export function forgetPin() {
  config = null
  save(null)
  locked = false
  emit()
}

export function initAppLock() {
  document.addEventListener('visibilitychange', () => {
    if (!config) return
    if (document.visibilityState === 'hidden') hiddenAt = Date.now()
    else if (hiddenAt && Date.now() - hiddenAt >= config.minutes * 60_000) {
      locked = true
      emit()
    }
  })
}

export const useAppLocked = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => locked && Boolean(config),
  )

export const useLockConfig = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => config,
  )
