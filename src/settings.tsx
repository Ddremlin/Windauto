import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { LOCALE, makeT, type Lang } from './i18n'
import { SettingsContext, useSettings } from './settingsHooks'
import { getSettings, subscribeSettings, updateSettings } from './settingsStore'

export function SettingsProvider({ children }: { children: ReactNode }) {
  const s = useSyncExternalStore(subscribeSettings, getSettings)

  useEffect(() => {
    document.documentElement.lang = s.lang
  }, [s.lang])

  const value = useMemo(() => ({ settings: s, update: updateSettings, t: makeT(s.lang), locale: LOCALE[s.lang] }), [s])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

/** Перевод вложенного дерева на другой язык (документ для клиента) */
export function LangOverride({ lang, children }: { lang: Lang; children: ReactNode }) {
  const ctx = useSettings()
  const value = useMemo(() => ({ ...ctx, t: makeT(lang), locale: LOCALE[lang] }), [ctx, lang])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
