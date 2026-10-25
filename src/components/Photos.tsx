import { useEffect, useRef, useState } from 'react'
import { addPhoto, usePhotoUrl } from '../photos'

export function Thumb({ id, onClick }: { id: string; onClick?: () => void }) {
  const url = usePhotoUrl(id)
  return (
    <button type="button" className="thumb" onClick={onClick} aria-label="Открыть фото">
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
  const [open, setOpen] = useState<number | null>(null)

  const handle = async (files: FileList | null) => {
    if (!files?.length || !onAdd) return
    setBusy(true)
    try {
      const added: string[] = []
      for (const f of Array.from(files)) added.push(await addPhoto(f))
      onAdd(added)
    } catch (e) {
      alert('Не удалось сохранить фото: ' + (e as Error).message)
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
            📷 Камера
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => galRef.current?.click()}>
            🖼 Галерея
          </button>
          {busy && <span className="muted">Сохраняю…</span>}
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

function PhotoViewer({ ids, index, onIndex, onClose, onDelete }: ViewerProps) {
  const id = ids[index]
  const url = usePhotoUrl(id)
  const touchX = useRef<number | null>(null)
  const prev = () => index > 0 && onIndex(index - 1)
  const next = () => index < ids.length - 1 && onIndex(index + 1)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div
      className="viewer"
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return
        const dx = e.changedTouches[0].clientX - touchX.current
        if (dx > 50) prev()
        if (dx < -50) next()
        touchX.current = null
      }}
    >
      <div className="viewer-bar">
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть">✕</button>
        <span>
          {index + 1} / {ids.length}
        </span>
        {onDelete ? (
          <button className="icon-btn" aria-label="Удалить фото" onClick={() => confirm('Удалить фото?') && onDelete(id)}>
            🗑
          </button>
        ) : (
          <span />
        )}
      </div>
      <div className="viewer-img">{url ? <img src={url} alt="" /> : null}</div>
      {ids.length > 1 && (
        <div className="viewer-nav">
          <button className="icon-btn" onClick={prev} disabled={index === 0}>‹</button>
          <button className="icon-btn" onClick={next} disabled={index === ids.length - 1}>›</button>
        </div>
      )}
    </div>
  )
}
