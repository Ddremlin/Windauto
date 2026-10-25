// Развёртка кузова: в центре вид сверху (перед вверху),
// по бокам «откинутые» борта — верх борта примыкает к крыше, колёса снаружи.
// Подписи элементов — в i18n.ts по ключу el.<key> / els.<key>.
import type { BodyType } from './types'

export interface BodyElement {
  id: string
  key: string
  d: string
  cx: number
  cy: number
  vertical?: boolean
}

export interface BodyLayout {
  elements: BodyElement[]
  wheels: { cx: number; cy: number }[]
}

export const VIEW_W = 400
export const VIEW_H = 600

export const BODY_TYPES: BodyType[] = ['sedan', 'hatchback', 'wagon', 'suv', 'coupe', 'pickup']

const rect = (x: number, y: number, w: number, h: number, r = 6) =>
  `M${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}` +
  `H${x + r}Q${x},${y + h} ${x},${y + h - r}V${y + r}Q${x},${y} ${x + r},${y}Z`

const trapezoid = (y0: number, y1: number, wide: 'top' | 'bottom') =>
  wide === 'top'
    ? `M144,${y0}H256L246,${y1}H154Z`
    : `M154,${y0}H246L256,${y1}H144Z`

const el = (id: string, d: string, cx: number, cy: number, key = id): BodyElement => ({ id, key, d, cx, cy })

// Борт с колёсной аркой у внешнего края. side: 1 — левый, -1 — правый (зеркально).
function fender(outer: number, inner: number, y: number, h: number, archY: number, side: 1 | -1) {
  const r = 24
  const sweep = side === 1 ? 1 : 0
  const o = outer
  const c = 14 * side
  return (
    `M${inner},${y}H${o + c}Q${o},${y} ${o},${y + 14}V${archY - r}` +
    `A${r},${r} 0 0 ${sweep} ${o},${archY + r}V${y + h - 14}Q${o},${y + h} ${o + c},${y + h}H${inner}Z`
  )
}

interface SideSpec {
  // двери: [начало, конец] по Y; одна дверь — купе, две — остальные
  doors: [number, number][]
  rear: { y0: number; y1: number; archY: number; kind: 'quarter' | 'bedside' }
  pillars: { a: [number, number]; b?: [number, number]; c: [number, number]; d?: [number, number] }
  sill?: 'sill' | 'step'
}

function side(s_: 'l' | 'r', spec: SideSpec): BodyElement[] {
  const s = s_ === 'l' ? 1 : -1
  const X = (x: number) => (s === 1 ? x : VIEW_W - x)
  const R = (x: number, y: number, w: number, h: number, r?: number) =>
    s === 1 ? rect(x, y, w, h, r) : rect(VIEW_W - x - w, y, w, h, r)
  const doorsY0 = spec.doors[0][0]
  const doorsY1 = spec.doors[spec.doors.length - 1][1]
  const mid = (a: number, b: number) => (a + b) / 2
  const door = (id: string, [y0, y1]: [number, number], key?: string) => el(id, R(40, y0, 60, y1 - y0, 4), X(70), mid(y0, y1), key)

  const doors =
    spec.doors.length === 1
      ? [door(`door_f_${s_}`, [doorsY0, doorsY1], `door_${s_}`)]
      : [door(`door_f_${s_}`, spec.doors[0]), door(`door_r_${s_}`, spec.doors[1])]

  const { rear, pillars } = spec
  const rearId = rear.kind === 'quarter' ? `quarter_${s_}` : `bedside_${s_}`
  const pillar = (k: 'a' | 'b' | 'c' | 'd', y: [number, number]) => el(`pillar_${k}_${s_}`, R(104, y[0], 14, y[1] - y[0], 3), X(111), mid(...y))

  return [
    el(`fender_f_${s_}`, fender(X(40), X(100), 84, 112, 136, s), X(81), 140),
    ...doors,
    el(rearId, fender(X(40), X(100), rear.y0, rear.y1 - rear.y0, rear.archY, s), X(81), rear.archY + 4),
    { ...el(`sill_${s_}`, R(22, doorsY0, 14, doorsY1 - doorsY0, 4), X(29), mid(doorsY0, doorsY1), `${spec.sill ?? 'sill'}_${s_}`), vertical: true },
    el(`mirror_${s_}`, R(104, 204, 30, 18, 5), X(119), 213),
    pillar('a', pillars.a),
    ...(pillars.b ? [pillar('b', pillars.b)] : []),
    pillar('c', pillars.c),
    ...(pillars.d ? [pillar('d', pillars.d)] : []),
  ]
}

// Общий перед для всех кузовов
const front: BodyElement[] = [
  el('bumper_f', rect(136, 26, 128, 36, 16), 200, 44),
  el('headlight_l', rect(138, 66, 36, 14, 5), 156, 73),
  el('grille', rect(178, 66, 44, 14, 4), 200, 73),
  el('headlight_r', rect(226, 66, 36, 14, 5), 244, 73),
  el('hood', rect(140, 84, 120, 110, 10), 200, 139),
  el('windshield', trapezoid(198, 242, 'top'), 200, 220),
]

const rearLights = (y: number) => [
  el('taillight_l', rect(138, y, 40, 14, 5), 158, y + 7),
  el('taillight_r', rect(222, y, 40, 14, 5), 242, y + 7),
]

const liftgate = (y: number, h: number, labelY = y + h / 2) => el('liftgate', rect(140, y, 120, h, 10), 200, labelY)

const rearBumper = (y: number) => el('bumper_r', rect(136, y, 128, 36, 16), 200, y + 18)

function build(center: BodyElement[], spec: SideSpec): BodyLayout {
  return {
    elements: [...front, ...center, ...side('l', spec), ...side('r', spec)],
    wheels: [136, spec.rear.archY].flatMap((cy) => [{ cx: 40, cy }, { cx: VIEW_W - 40, cy }]),
  }
}

const LAYOUTS: Record<BodyType, BodyLayout> = {
  sedan: build(
    [
      el('roof', rect(154, 246, 92, 130, 8), 200, 311),
      el('rear_glass', trapezoid(380, 416, 'bottom'), 200, 398),
      el('trunk', rect(140, 420, 120, 90, 10), 200, 465),
      ...rearLights(514),
      rearBumper(532),
    ],
    {
      doors: [[200, 310], [314, 414]],
      rear: { y0: 418, y1: 530, archY: 466, kind: 'quarter' },
      pillars: { a: [228, 268], b: [292, 332], c: [376, 414] },
    },
  ),

  hatchback: build(
    [
      el('roof', rect(154, 246, 92, 130, 8), 200, 311),
      el('rear_glass', trapezoid(380, 412, 'bottom'), 200, 396),
      liftgate(416, 60),
      ...rearLights(480),
      rearBumper(498),
    ],
    {
      doors: [[200, 300], [304, 384]],
      rear: { y0: 388, y1: 494, archY: 440, kind: 'quarter' },
      pillars: { a: [228, 268], b: [282, 318], c: [346, 384] },
    },
  ),

  wagon: build(
    [
      el('roof', rect(154, 246, 92, 170, 8), 200, 331),
      el('rear_glass', rect(150, 420, 100, 28, 6), 200, 434),
      liftgate(452, 58),
      ...rearLights(514),
      rearBumper(532),
    ],
    {
      doors: [[200, 310], [314, 404]],
      rear: { y0: 408, y1: 530, archY: 470, kind: 'quarter' },
      pillars: { a: [228, 268], b: [292, 332], c: [366, 404], d: [416, 446] },
    },
  ),

  suv: build(
    [
      el('roof_rail_l', rect(142, 250, 8, 162, 4), 146, 331),
      el('roof', rect(154, 246, 92, 170, 8), 200, 331),
      el('roof_rail_r', rect(250, 250, 8, 162, 4), 254, 331),
      el('rear_glass', rect(150, 420, 100, 26, 6), 200, 433),
      liftgate(450, 62, 465),
      el('spare_wheel', rect(172, 478, 56, 28, 12), 200, 492),
      ...rearLights(516),
      rearBumper(534),
    ],
    {
      doors: [[200, 314], [318, 408]],
      rear: { y0: 412, y1: 530, archY: 472, kind: 'quarter' },
      pillars: { a: [228, 268], b: [294, 336], c: [370, 408], d: [418, 448] },
      sill: 'step',
    },
  ),

  coupe: build(
    [
      el('roof', rect(154, 246, 92, 100, 8), 200, 296),
      el('rear_glass', trapezoid(350, 404, 'bottom'), 200, 377),
      el('trunk', rect(140, 408, 120, 102, 10), 200, 459),
      ...rearLights(514),
      rearBumper(532),
    ],
    {
      doors: [[200, 350]],
      rear: { y0: 354, y1: 530, archY: 466, kind: 'quarter' },
      pillars: { a: [228, 268], c: [346, 396] },
    },
  ),

  pickup: build(
    [
      el('roof', rect(154, 246, 92, 94, 8), 200, 293, 'roof_cab'),
      el('rear_glass', rect(154, 344, 92, 16, 4), 200, 352, 'rear_glass_cab'),
      el('bed', rect(140, 366, 120, 134, 6), 200, 433),
      el('tailgate', rect(140, 504, 120, 24, 6), 200, 516),
      ...rearLights(532),
      rearBumper(550),
    ],
    {
      doors: [[200, 280], [284, 350]],
      rear: { y0: 366, y1: 528, archY: 450, kind: 'bedside' },
      pillars: { a: [228, 268], b: [272, 300], c: [322, 350] },
    },
  ),
}

export function getLayout(type: BodyType | undefined): BodyLayout {
  return LAYOUTS[type ?? 'sedan'] ?? LAYOUTS.sedan
}
