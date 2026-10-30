import { useEffect, useRef, useState } from 'react'
import { addPhoto, usePhotoUrl } from '../photos'
import { useT } from '../settingsHooks'

export function Thumb({ id, onClick }: { id: string; onClick?: () => void }) {
  const url = usePhotoUrl(id)
  const t = useT()
  return (
    <button type="button" className="thumb" onClick={onClick} aria-label={t('photo.open')}>
      {url ? <img src={url} alt="" /> : null}
    </button>
  )
}

interface StripProps {
  ids: string[]
  onAdd?: (ids: string[]) => void
  onDelete?: (id: string) => void
}

/** Миниатюры + кнопки «Камера» / «Галерея» (если передан onAdd) */
export function PhotoStrip({ ids, onAdd, onDelete }: StripProps) {
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const t = useT()
  const [open, setOpen] = useState<number | null>(null)

  const handle = async (files: FileList | null) => {
    if (!files?.length || !onAdd) return
    setBusy(true)
    try {
      const added: string[] = []
      for (const f of Array.from(files)) added.push(await addPhoto(f))
      onAdd(added)
    } catch (e) {
      alert(t('photo.saveError', { e: (e as Error).message }))
    } finally {
      setBusy(false)
      if (camRef.current) camRef.current.value = ''
      if (galRef.current) galRef.current.value = ''
    }
  }

  return (
    <div className="photos">
      {ids.length > 0 && (
        <div className="thumbs">
          {ids.map((id, i) => (
            <Thumb key={id} id={id} onClick={() => setOpen(i)} />
          ))}
        </div>
      )}
      {onAdd && (
        <div className="photo-actions no-print">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => camRef.current?.click()}>
            {t('photo.camera')}
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => galRef.current?.click()}>
            {t('photo.gallery')}
          </button>
          {busy && <span className="muted">{t('photo.saving')}</span>}
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => handle(e.target.files)} />
          <input ref={galRef} type="file" accept="image/*" multiple hidden onChange={(e) => handle(e.target.files)} />
        </div>
      )}
      {open !== null && ids[open] && (
        <PhotoViewer
          ids={ids}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onDelete={
            onDelete &&
            ((id) => {
              onDelete(id)
              setOpen(ids.length > 1 ? Math.max(0, open - (open === ids.length - 1 ? 1 : 0)) : null)
            })
          }
        />
      )}
    </div>
  )
}

interface ViewerProps {
  ids: string[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  onDelete?: (id: string) => void
}

type Pt = { x: number; y: number }
type View = { s: number; x: number; y: number }

const MAX_ZOOM = 6
const DOUBLE_TAP_ZOOM = 2.5
const FIT: View = { s: 1, x: 0, y: 0 }

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/** Увеличение фото: два пальца, двойное касание, колесо мыши; увеличенное — двигается пальцем */
function useZoom(resetKey: string) {
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(FIT)
  const [moving, setMoving] = useState(false)
  const pointers = useRef(new Map<number, Pt>())
  // начало жеста: вид, точки пальцев
  const start = useRef<{ view: View; a: Pt; b?: Pt } | null>(null)
  const lastTap = useRef<{ at: number; p: Pt } | null>(null)
  const swipe = useRef<{ x: number; moved: boolean; pinch: boolean } | null>(null)

  const [prevKey, setPrevKey] = useState(resetKey)
  if (prevKey !== resetKey) {
    setPrevKey(resetKey)
    setView(FIT)
  }

  // точка относительно центра фото
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = box.current!.getBoundingClientRect()
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }
  }
  // не уводить фото за край
  const clamp = (v: View): View => {
    const r = box.current?.getBoundingClientRect()
    if (v.s <= 1 || !r) return FIT
    const mx = ((v.s - 1) * r.width) / 2
    const my = ((v.s - 1) * r.height) / 2
    return { s: v.s, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) }
  }
  // масштаб s вокруг точки p (точка фото под p остаётся на месте)
  const zoomAt = (from: View, s: number, p0: Pt, p: Pt = p0): View => {
    s = Math.max(1, Math.min(MAX_ZOOM, s))
    return clamp({ s, x: p.x - ((p0.x - from.x) * s) / from.s, y: p.y - ((p0.y - from.y) * s) / from.s })
  }

  const begin = () => {
    const [a, b] = [...pointers.current.values()]
    start.current = { view, a, b }
  }

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      pointers.current.set(e.pointerId, local(e))
      setMoving(true)
      begin()
      if (pointers.current.size === 1) swipe.current = { x: e.clientX, moved: false, pinch: false }
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!pointers.current.has(e.pointerId) || !start.current) return
      pointers.current.set(e.pointerId, local(e))
      const [a, b] = [...pointers.current.values()]
      const st = start.current
      if (b && st.b) {
        setView(zoomAt(st.view, (st.view.s * dist(a, b)) / dist(st.a, st.b), mid(st.a, st.b), mid(a, b)))
        if (swipe.current) swipe.current.moved = swipe.current.pinch = true
      } else if (st.view.s > 1) {
        setView(clamp({ ...st.view, x: st.view.x + a.x - st.a.x, y: st.view.y + a.y - st.a.y }))
      }
      if (swipe.current && dist(a, st.a) > 10) swipe.current.moved = true
    },
    onPointerUp: (e: React.PointerEvent): 'prev' | 'next' | null => {
      const p = pointers.current.get(e.pointerId)
      pointers.current.delete(e.pointerId)
      let result: 'prev' | 'next' | null = null
      if (pointers.current.size) begin()
      else {
        setMoving(false)
        start.current = null
        const sw = swipe.current
        swipe.current = null
        // после щипка не листаем, даже если вернули фото к исходному размеру
        if (sw && !sw.pinch && view.s <= 1) {
          const dx = e.clientX - sw.x
          if (dx > 50) result = 'prev'
          else if (dx < -50) result = 'next'
        }
        // двойное касание: увеличить в этом месте или вернуть целиком
        if (p && sw && !sw.moved) {
          const now = Date.now()
          const tap = lastTap.current
          if (tap && now - tap.at < 300 && dist(tap.p, p) < 30) {
            lastTap.current = null
            setView(view.s > 1 ? FIT : zoomAt(view, DOUBLE_TAP_ZOOM, p))
          } else lastTap.current = { at: now, p }
        }
      }
      return result
    },
    onPointerCancel: (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId)
      if (!pointers.current.size) {
        setMoving(false)
        start.current = null
        swipe.current = null
      }
    },
    onWheel: (e: React.WheelEvent) => setView((v) => zoomAt(v, v.s * (e.deltaY < 0 ? 1.25 : 0.8), local(e))),
  }

  return { box, view, moving, handlers, reset: () => setView(FIT) }
}

function PhotoViewer({ ids, index, onIndex, onClose, onDelete }: ViewerProps) {
  const id = ids[index]
  const url = usePhotoUrl(id)
  const t = useT()
  const { box, view, moving, handlers, reset } = useZoom(id)
  const prev = () => index > 0 && onIndex(index - 1)
  const next = () => index < ids.length - 1 && onIndex(index + 1)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
      if (e.key === '0') reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="viewer" onClick={(e) => e.stopPropagation()}>
      <div className="viewer-bar">
        <button className="icon-btn" onClick={onClose} aria-label={t('app.close')}>✕</button>
        <span>
          {index + 1} / {ids.length}
        </span>
        {onDelete ? (
          <button className="icon-btn" aria-label={t('photo.delete')} onClick={() => confirm(t('photo.deleteConfirm')) && onDelete(id)}>
            🗑
          </button>
        ) : (
          <span />
        )}
      </div>
      <div
        ref={box}
        className="viewer-img"
        {...handlers}
        onPointerUp={(e) => {
          const go = handlers.onPointerUp(e)
          if (go === 'prev') prev()
          if (go === 'next') next()
        }}
      >
        {url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            className={moving ? '' : 'settle'}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
          />
        ) : null}
      </div>
      {ids.length > 1 && (
        <div className="viewer-nav">
          <button className="icon-btn" onClick={prev} disabled={index === 0}>‹</button>
          <button className="icon-btn" onClick={next} disabled={index === ids.length - 1}>›</button>
        </div>
      )}
    </div>
  )
}
