import type { HTMLAttributes, ReactNode } from 'react'
import { useT } from '../settingsHooks'
import type { Check } from '../validate'

interface Props {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  check?: Check
  placeholder?: string
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode']
  type?: string
  mono?: boolean
  upper?: boolean
  wide?: boolean
  action?: ReactNode
  note?: string | null
}

export default function Field({ label, value, onChange, onBlur, check, placeholder, inputMode, type, mono, upper, wide, action, note }: Props) {
  const t = useT()
  const level = check?.level ?? 'empty'
  return (
    <label className={`field lvl-${level}` + (wide ? ' wide' : '')}>
      <span className="field-label">{label}</span>
      <span className={action ? 'field-row' : 'contents'}>
        <input
          value={value}
          type={type ?? 'text'}
          inputMode={inputMode}
          placeholder={placeholder}
          autoCapitalize={upper ? 'characters' : undefined}
          autoCorrect="off"
          spellCheck={false}
          className={(mono ? 'mono' : '') + (upper ? ' upper' : '')}
          onChange={(e) => onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
          onBlur={onBlur}
        />
        {action}
      </span>
      {check?.message ? <span className="field-hint">{t(check.message, check.vars)}</span> : null}
      {note ? <span className="field-hint field-note">{note}</span> : null}
    </label>
  )
}
