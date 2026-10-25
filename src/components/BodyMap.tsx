import { VIEW_H, VIEW_W, getLayout } from '../body'
import type { BodyType, ElementWork } from '../types'
import { WORK_BY_ID } from '../works'

interface Props {
  elements: Record<string, ElementWork>
  onSelect?: (id: string) => void
  selected?: string | null
  bodyType?: BodyType
}

export default function BodyMap({ elements, onSelect, selected, bodyType }: Props) {
  const { elements: BODY, wheels } = getLayout(bodyType)
  return (
    <svg className="bodymap" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label="Развёртка кузова">
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

      <text x={200} y={16} className="bm-caption">ПЕРЕД</text>
      <text x={200} y={597} className="bm-caption">ЗАД</text>
      <text x={70} y={60} className="bm-caption">ЛЕВЫЙ БОРТ</text>
      <text x={330} y={60} className="bm-caption">ПРАВЫЙ БОРТ</text>

      {wheels.map((w, i) => (
        <circle key={i} cx={w.cx} cy={w.cy} r={19} className="bm-wheel" />
      ))}

      {BODY.map((e) => {
        const works = elements[e.id]?.works ?? []
        const fill = works.length === 0 ? undefined : works.length === 1 ? WORK_BY_ID[works[0]].color : `url(#g-${e.id})`
        const cls = ['bm-el', works.length ? 'bm-marked' : '', selected === e.id ? 'bm-selected' : ''].join(' ')
        return (
          <g key={e.id} onClick={() => onSelect?.(e.id)} className={onSelect ? 'bm-click' : undefined}>
            <path d={e.d} className={cls} style={fill ? { fill } : undefined}>
              <title>{e.label}</title>
            </path>
            <text
              x={e.cx}
              y={e.cy}
              transform={e.vertical ? `rotate(-90 ${e.cx} ${e.cy})` : undefined}
              className={'bm-label' + (works.length ? ' bm-label-marked' : '')}>
              {e.short}
            </text>
            {elements[e.id]?.note ? <circle cx={e.cx - 5} cy={e.cy + 10} r={2.5} className="bm-note-dot" /> : null}
            {elements[e.id]?.photos?.length ? (
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
