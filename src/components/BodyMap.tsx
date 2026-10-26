import { VIEW_H, VIEW_W, getLayout } from '../body'
import type { BodyType, ElementWork } from '../types'
import { useT } from '../settingsHooks'
import { WORK_BY_ID } from '../works'

interface Props {
  elements: Record<string, ElementWork>
  onSelect?: (id: string) => void
  selected?: string | null
  bodyType?: BodyType
  // для PDF: стили прямо в атрибутах (html2canvas не видит CSS-классы внутри SVG)
  inline?: boolean
  // ширина в px для inline-режима (высота — по пропорции)
  width?: number
}

// отметка «повреждение было до приёмки»
export const DAMAGE_COLOR = '#ff8f00'

const INLINE = {
  el: { fill: '#f2f4f7', stroke: '#8a94a3', strokeWidth: 1.5 },
  marked: { stroke: '#15181d', strokeWidth: 1.8 },
  label: { fontSize: 9, fill: '#555', textAnchor: 'middle', dominantBaseline: 'middle', fontFamily: 'sans-serif' },
  labelMarked: { fill: '#fff', fontWeight: 700, stroke: 'rgba(0,0,0,.55)', strokeWidth: 2.2, paintOrder: 'stroke' },
  caption: { fontSize: 10, fill: '#666', textAnchor: 'middle', letterSpacing: '0.12em', fontWeight: 600, fontFamily: 'sans-serif' },
  wheel: { fill: '#3a3f47' },
  damageOnly: { fill: '#e6e9ee', strokeDasharray: '4 3' },
  damage: { fill: DAMAGE_COLOR, stroke: '#fff', strokeWidth: 1.2 },
} as const

export default function BodyMap({ elements, onSelect, selected, bodyType, inline, width = VIEW_W }: Props) {
  const t = useT()
  const { elements: BODY, wheels } = getLayout(bodyType)
  const cap = inline ? INLINE.caption : undefined
  return (
    <svg
      className="bodymap"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width={inline ? width : undefined}
      height={inline ? (width * VIEW_H) / VIEW_W : undefined}
      role="img"
      aria-label={t('map.aria')}
    >
      <defs>
        {BODY.map((e) => {
          const works = elements[e.id]?.works ?? []
          if (works.length < 2) return null
          // жёсткие полосы — по одной на каждый вид работ
          const step = 100 / works.length
          return (
            <linearGradient key={e.id} id={`g-${e.id}`} x1="0" y1="0" x2="1" y2="1">
              {works.flatMap((w, i) => [
                <stop key={w + 'a'} offset={`${i * step}%`} stopColor={WORK_BY_ID[w].color} />,
                <stop key={w + 'b'} offset={`${(i + 1) * step}%`} stopColor={WORK_BY_ID[w].color} />,
              ])}
            </linearGradient>
          )
        })}
      </defs>

      <text x={200} y={16} className="bm-caption" style={cap}>{t('map.front')}</text>
      <text x={200} y={597} className="bm-caption" style={cap}>{t('map.rear')}</text>
      <text x={70} y={60} className="bm-caption" style={cap}>{t('map.left')}</text>
      <text x={330} y={60} className="bm-caption" style={cap}>{t('map.right')}</text>

      {wheels.map((w, i) => (
        <circle key={i} cx={w.cx} cy={w.cy} r={19} className="bm-wheel" style={inline ? INLINE.wheel : undefined} />
      ))}

      {BODY.map((e) => {
        const works = elements[e.id]?.works ?? []
        const damaged = Boolean(elements[e.id]?.damage?.length)
        const fill = works.length === 0 ? undefined : works.length === 1 ? WORK_BY_ID[works[0]].color : `url(#g-${e.id})`
        const cls = ['bm-el', works.length ? 'bm-marked' : '', damaged && !works.length ? 'bm-damaged' : '', selected === e.id ? 'bm-selected' : ''].join(' ')
        const inlineStyle = { ...INLINE.el, ...(works.length ? INLINE.marked : damaged ? INLINE.damageOnly : {}), ...(fill ? { fill } : {}) }
        return (
          <g key={e.id} onClick={() => onSelect?.(e.id)} className={onSelect ? 'bm-click' : undefined}>
            <path
              d={e.d}
              className={cls}
              style={inline ? inlineStyle : fill ? { fill } : undefined}
            >
              <title>{t(`el.${e.key}`)}</title>
            </path>
            <text
              x={e.cx}
              y={e.cy}
              transform={e.vertical ? `rotate(-90 ${e.cx} ${e.cy})` : undefined}
              className={'bm-label' + (works.length ? ' bm-label-marked' : '')}
              style={inline ? { ...INLINE.label, ...(works.length ? INLINE.labelMarked : {}) } : undefined}
            >
              {t(`els.${e.key}`)}
            </text>
            {damaged ? (
              <circle cx={e.cx + (e.vertical ? 9 : 0)} cy={e.cy - (e.vertical ? 0 : 10)} r={4} className="bm-damage" style={inline ? INLINE.damage : undefined}>
                <title>{t('damage.legend')}</title>
              </circle>
            ) : null}
            {!inline && elements[e.id]?.note ? <circle cx={e.cx - 5} cy={e.cy + 10} r={2.5} className="bm-note-dot" /> : null}
            {!inline && elements[e.id]?.photos?.length ? (
              <g className="bm-photo" transform={`translate(${e.cx + 1} ${e.cy + 6})`}>
                <rect width={9} height={7} rx={1.5} />
                <circle cx={4.5} cy={3.6} r={1.8} />
              </g>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
