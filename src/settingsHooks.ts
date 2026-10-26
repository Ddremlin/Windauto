import { createContext, useContext } from 'react'
import { type T } from './i18n'
import type { Settings } from './settingsStore'

export interface SettingsContextValue {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  t: T
  locale: string
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('SettingsProvider missing')
  return ctx
}

export const useT = () => useSettings().t
