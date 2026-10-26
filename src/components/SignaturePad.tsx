import { useEffect, useRef, useState } from 'react'
import { useT } from '../settingsHooks'
import type { Signature } from '../types'

interface Props {
  title: string
  // текст над полем: что подтверждает подпись
  statement?: string
  defaultName?: string
  onSave: (s: Signature) => void
  onClose: () => void
}

interface Pt {
  x: number
  y: number
  w: number
}

const INK = '#0b1d51'

function segment(ctx: CanvasRenderingContext2D, a: Pt, b: Pt) {
  ctx.strokeStyle = INK
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = b.w
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
}

function drawStroke(ctx: CanvasRenderingContext2D, st: Pt[]) {
  ctx.beginPath()
  ctx.arc(st[0].x, st[0].y, 1.2, 0, Math.PI * 2)
  ctx.fillStyle = INK
  ctx.fill()
  for (let i = 1; i < st.length; i++) segment(ctx, st[i - 1], st[i])
}

// Подпись пальцем: рисуем на canvas, сохраняем обрезанный PNG (до 600 px по ширине).
export default function SignaturePad({ title, statement, defaultName = '', onSave, onClose }: Props) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [name, setName] = useState(defaultName)
  const [empty, setEmpty] = useState(true)
  const drawing = useRef(false)
  // штрихи в CSS-пикселях холста: при смене размера (поворот, клавиатура) пересчитываем и рисуем заново
  const strokes = useRef<Pt[][]>([])
  const size = useRef<{ w: number; h: number } | null>(null)

  // размер canvas = размер на экране × плотность пикселей
  useEffect(() => {
    const c = canvasRef.current!
    const fit = () => {
      const r = c.getBoundingClientRect()
      if (!r.width || !r.height) return
      const prev = size.current
      if (prev && (prev.w !== r.width || prev.h !== r.height)) {
        // равномерный масштаб — подпись не растягивается и остаётся в поле
        const k = Math.min(r.width / prev.w, r.height / prev.h)
        strokes.current = strokes.current.map((st) => st.map((p) => ({ ...p, x: p.x * k, y: p.y * k })))
      }
      size.current = { w: r.width, h: r.height }
      const dpr = window.devicePixelRatio || 1
      c.width = Math.round(r.width * dpr)
      c.height = Math.round(r.height * dpr)
      const ctx = c.getContext('2d')!
      ctx.scale(dpr, dpr)
      strokes.current.forEach((st) => drawStroke(ctx, st))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    // страница не должна прокручиваться под пальцем
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const pointOf = (ev: PointerEvent): Pt => {
    const r = canvasRef.current!.getBoundingClientRect()
    // нажим (стилус) или 2.4 px для пальца
    const w = ev.pressure && ev.pointerType === 'pen' ? 1 + ev.pressure * 3 : 2.4
    return { x: ev.clientX - r.left, y: ev.clientY - r.top, w }
  }

  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    canvasRef.current!.setPointerCapture(e.pointerId)
    drawing.current = true
    const st = [pointOf(e.nativeEvent)]
    strokes.current.push(st)
    drawStroke(canvasRef.current!.getContext('2d')!, st)
    setEmpty(false)
  }

  const move = (e: React.PointerEvent) => {
    const st = strokes.current.at(-1)
    if (!drawing.current || !st) return
    const ctx = canvasRef.current!.getContext('2d')!
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    for (const ev of events) {
      const p = pointOf(ev)
      segment(ctx, st[st.length - 1], p)
      st.push(p)
    }
  }

  const up = () => {
    drawing.current = false
  }

  const clear = () => {
    const c = canvasRef.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    strokes.current = []
    setEmpty(true)
  }

  const save = () => {
    const img = trim(canvasRef.current!)
    if (!img) return
    onSave({ img, at: Date.now(), ...(name.trim() ? { name: name.trim() } : {}) })
  }

  return (
    <div className="sig-overlay" role="dialog" aria-label={title}>
      <div className="sig-head">
        <h2>{title}</h2>
        {statement && <p className="sig-statement">{statement}</p>}
      </div>
      <div className="sig-area">
        <canvas
          ref={canvasRef}
          className="sig-canvas"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          aria-label={t('sig.area')}
        />
        <div className="sig-line" aria-hidden />
        {empty && <span className="sig-placeholder">{t('sig.placeholder')}</span>}
      </div>
      <label className="field sig-name">
        <span className="field-label">{t('sig.name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </label>
      <div className="sig-actions">
        <button className="btn ghost" onClick={onClose}>{t('app.cancel')}</button>
        <button className="btn ghost" onClick={clear} disabled={empty}>{t('app.clear')}</button>
        <button className="btn primary" onClick={save} disabled={empty}>{t('sig.save')}</button>
      </div>
    </div>
  )
}

/** Обрезает пустые поля вокруг подписи и уменьшает до 600 px по ширине */
function trim(c: HTMLCanvasElement): string | null {
  const ctx = c.getContext('2d')!
  const { width: w, height: h } = c
  const data = ctx.getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  const pad = 8
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(w - 1, x1 + pad)
  y1 = Math.min(h - 1, y1 + pad)
  const sw = x1 - x0 + 1
  const sh = y1 - y0 + 1
  const k = Math.min(1, 600 / sw)
  const out = document.createElement('canvas')
  out.width = Math.round(sw * k)
  out.height = Math.round(sh * k)
  out.getContext('2d')!.drawImage(c, x0, y0, sw, sh, 0, 0, out.width, out.height)
  return out.toDataURL('image/png')
}
