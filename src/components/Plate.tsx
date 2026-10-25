// Номер в виде настоящего знака: белая табличка, полоса страны слева.
// Стили инлайновые — знак попадает и в PDF (html2canvas).
import type { CSSProperties, ReactNode } from 'react'
import { COUNTRIES, countryByCode, countryName } from '../countries'
import { useSettings } from '../settings'

const FONT = "'Roboto Condensed', 'Arial Narrow', 'DIN Condensed', sans-serif-condensed, Arial, sans-serif"

// 12 звёзд по кругу
function EuStars({ size }: { size: number }) {
  const r = size * 0.36
  const s = size * 0.075
  const star = (cx: number, cy: number) =>
    Array.from({ length: 10 }, (_, i) => {
      const a = (Math.PI / 5) * i - Math.PI / 2
      const rr = i % 2 ? s * 0.42 : s
      return `${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`
    }).join(' ')
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }} aria-hidden>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (Math.PI / 6) * i
        return <polygon key={i} points={star(size / 2 + r * Math.sin(a), size / 2 - r * Math.cos(a))} fill="#ffcc00" />
      })}
    </svg>
  )
}

function Band({ code, height }: { code: string; height: number }) {
  const c = countryByCode(code)
  const w = Math.round(height * 0.42)
  const style: CSSProperties = {
    width: w,
    flex: `0 0 ${w}px`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: height * 0.06,
    boxSizing: 'border-box',
    color: '#fff',
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: height * (c.code.length > 2 ? 0.2 : 0.26),
    lineHeight: 1,
    background: c.eu ? '#003399' : c.flag ? `linear-gradient(${c.flag[0]} 50%, ${c.flag[1]} 50%)` : '#e8e8e8',
  }
  return (
    <span style={style}>
      {c.eu && (
        <span style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <EuStars size={w * 0.82} />
        </span>
      )}
      <span
        style={{
          color: c.eu ? '#fff' : '#111',
          ...(c.flag ? { background: 'rgba(255,255,255,.85)', padding: '1px 2px', borderRadius: 2, marginTop: 'auto' } : {}),
        }}
      >
        {c.code}
      </span>
    </span>
  )
}

const plateBox = (height: number, extra: CSSProperties = {}): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'stretch',
  height,
  background: '#fff',
  border: `${Math.max(1, Math.round(height / 18))}px solid #111`,
  borderRadius: height * 0.12,
  overflow: 'hidden',
  boxSizing: 'border-box',
  color: '#111',
  verticalAlign: 'middle',
  ...extra,
})

const textStyle = (height: number): CSSProperties => ({
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: height * 0.62,
  letterSpacing: '0.04em',
  lineHeight: 1,
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
})

/** Номер только для показа (список, PDF) */
export function PlateBadge({ text, country, height = 30 }: { text: ReactNode; country?: string; height?: number }) {
  return (
    <span style={plateBox(height)}>
      <Band code={countryByCode(country).code} height={height} />
      <span style={{ ...textStyle(height), color: '#111', display: 'flex', alignItems: 'center', padding: `0 ${height * 0.3}px` }}>{text}</span>
    </span>
  )
}

interface InputProps {
  value: string
  country: string
  onChange: (v: string) => void
  onCountry: (code: string) => void
  onBlur?: () => void
  label: string
  hint?: string
  level: string
}

/** Поле ввода номера; страна — нажатием на полосу */
export function PlateInput({ value, country, onChange, onCountry, onBlur, label, hint, level }: InputProps) {
  const { locale, t } = useSettings()
  const h = 60
  const border = level === 'error' ? '#c62828' : level === 'warn' ? '#b26a00' : '#111'
  return (
    <label className={`field wide plate-field lvl-${level}`}>
      <span className="field-label">{label}</span>
      <span style={plateBox(h, { display: 'flex', width: '100%', maxWidth: 360, borderColor: border })}>
        <span style={{ position: 'relative', display: 'flex' }}>
          <Band code={country} height={h} />
          <select
            aria-label={t('order.plateCountry')}
            value={countryByCode(country).code}
            onChange={(e) => onCountry(e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%' }}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {countryName(c, locale)}
              </option>
            ))}
          </select>
        </span>
        <input
          value={value}
          placeholder={country === 'PL' ? 'WA 12345' : ''}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          onBlur={onBlur}
          style={{
            ...textStyle(h),
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: 0,
            background: 'transparent',
            color: '#111',
            textAlign: 'center',
            padding: '0 8px',
            height: '100%',
            borderRadius: 0,
          }}
        />
      </span>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}
