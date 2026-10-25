import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LOCALE, makeT, type Lang, type T } from './i18n'
import type { WorkId } from './types'

export interface Settings {
  lang: Lang
  docLang: Lang
  shopName: string
  shopAddress: string
  shopPhone: string
  shopNip: string
  defaultPrices: Partial<Record<WorkId, number>>
}

const KEY = 'windauto.settings.v1'

const DEFAULTS: Settings = {
  lang: 'ru',
  docLang: 'pl',
  shopName: '',
  shopAddress: '',
  shopPhone: '',
  shopNip: '',
  defaultPrices: {},
}

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

interface Ctx {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  t: T
  locale: string
}

const SettingsContext = createContext<Ctx | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      /* нет места — настройки останутся до перезапуска */
    }
    document.documentElement.lang = settings.lang
  }, [settings])

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), [])

  const value = useMemo(
    () => ({ settings, update, t: makeT(settings.lang), locale: LOCALE[settings.lang] }),
    [settings, update],
  )
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('SettingsProvider missing')
  return ctx
}

export const useT = () => useSettings().t

/** Перевод вложенного дерева на другой язык (документ для клиента) */
export function LangOverride({ lang, children }: { lang: Lang; children: ReactNode }) {
  const ctx = useSettings()
  const value = useMemo(() => ({ ...ctx, t: makeT(lang), locale: LOCALE[lang] }), [ctx, lang])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
