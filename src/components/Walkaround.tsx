// Круговое видео при приёмке: запись камерой в приложении (MediaRecorder),
// а если она недоступна — системной камерой или из галереи.
import { useEffect, useRef, useState } from 'react'
import { useSettings, useT } from '../settingsHooks'
import type { Order, VideoRef } from '../types'
import { addVideo, deleteVideos, formatDuration, useVideoUrl } from '../videos'

const MAX_SEC = 180
const MAX_BYTES = 300 * 1024 * 1024
// ~2,5 Мбит/с: 3 минуты ≈ 56 МБ — грузится на сервер даже по мобильной сети
const BITRATE = 2_500_000

const MIME = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

const canRecord = () => typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined'

async function openCamera(): Promise<MediaStream> {
  const video = { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
  // со звуком мастер может проговаривать повреждения; без микрофона — только видео
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: true })
  } catch {
    return navigator.mediaDevices.getUserMedia({ video, audio: false })
  }
}

// длительность файла из галереи / системной камеры
const fileDuration = (blob: Blob) =>
  new Promise<number>((resolve) => {
    const v = document.createElement('video')
    const url = URL.createObjectURL(blob)
    const done = (d: number) => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(d) ? d : 0)
    }
    v.preload = 'metadata'
    v.onloadedmetadata = () => done(v.duration)
    v.onerror = () => done(0)
    v.src = url
  })

interface Taken {
  blob: Blob
  duration: number
  url: string
}

function Recorder({ onSave, onClose }: { onSave: (r: VideoRef) => void; onClose: () => void }) {
  const t = useT()
  const liveRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const startedAt = useRef(0)
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const [ready, setReady] = useState(false)
  const [noCamera, setNoCamera] = useState(!canRecord())
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [taken, setTaken] = useState<Taken | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
    setReady(false)
  }

  const startCamera = () => {
    if (!canRecord()) return
    openCamera()
      .then((s) => {
        streamRef.current = s
        if (liveRef.current) liveRef.current.srcObject = s
        setReady(true)
      })
      .catch(() => setNoCamera(true))
  }

  useEffect(() => {
    startCamera()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      if (recRef.current?.state === 'recording') recRef.current.stop()
      streamRef.current?.getTracks().forEach((tr) => tr.stop())
      document.body.style.overflow = prev
    }
  }, [])

  // таймер записи и автостоп
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000
      setElapsed(s)
      if (s >= MAX_SEC) recRef.current?.stop()
    }, 250)
    return () => clearInterval(id)
  }, [recording])

  useEffect(() => {
    if (!taken) return
    return () => URL.revokeObjectURL(taken.url)
  }, [taken])

  const start = () => {
    const stream = streamRef.current
    if (!stream) return
    const mimeType = MIME.find((m) => MediaRecorder.isTypeSupported(m))
    const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: BITRATE })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    rec.onstop = () => {
      setRecording(false)
      const duration = (Date.now() - startedAt.current) / 1000
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'video/mp4' })
      stopCamera()
      setTaken({ blob, duration, url: URL.createObjectURL(blob) })
    }
    recRef.current = rec
    startedAt.current = Date.now()
    setElapsed(0)
    setError(null)
    rec.start(1000)
    setRecording(true)
  }

  const fromFile = async (file: File | undefined) => {
    if (camRef.current) camRef.current.value = ''
    if (galRef.current) galRef.current.value = ''
    if (!file) return
    stopCamera()
    setTaken({ blob: file, duration: await fileDuration(file), url: URL.createObjectURL(file) })
  }

  const redo = () => {
    setTaken(null)
    setError(null)
    if (canRecord() && !noCamera) startCamera()
  }

  const save = async () => {
    if (!taken) return
    if (taken.blob.size > MAX_BYTES) return setError(t('video.tooBig'))
    setSaving(true)
    try {
      onSave(await addVideo(taken.blob, taken.duration))
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  const fileInputs = (
    <>
      <input ref={camRef} type="file" accept="video/*" capture="environment" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
      <input ref={galRef} type="file" accept="video/*" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
    </>
  )

  return (
    <div className="rec-overlay" role="dialog" aria-label={t('video.title')}>
      {taken ? (
        <video className="rec-video" src={taken.url} controls playsInline autoPlay />
      ) : noCamera ? (
        <div className="rec-nocam">
          <p>{t('video.noCamera')}</p>
          <button className="btn primary" onClick={() => camRef.current?.click()}>{t('video.systemCamera')}</button>
          <button className="btn" onClick={() => galRef.current?.click()}>{t('video.gallery')}</button>
        </div>
      ) : (
        <video ref={liveRef} className="rec-video" muted playsInline autoPlay />
      )}

      <div className="rec-top">
        {recording ? (
          <span className="rec-badge">● {formatDuration(elapsed)} / {formatDuration(MAX_SEC)}</span>
        ) : !taken && !noCamera ? (
          <span className="rec-tip">
            {t('video.walk')}
            <small>{t('video.limit', { min: MAX_SEC / 60 })}</small>
          </span>
        ) : null}
      </div>

      <div className="rec-bar">
        {error && <p className="rec-error">{error}</p>}
        {taken ? (
          <>
            <button className="btn" onClick={redo} disabled={saving}>{t('video.redo')}</button>
            <button className="btn primary" onClick={save} disabled={saving}>{saving ? t('video.saving') : t('video.save')}</button>
          </>
        ) : recording ? (
          <button className="rec-btn stop" onClick={() => recRef.current?.stop()} aria-label={t('video.stop')} />
        ) : (
          <>
            <button className="btn ghost rec-light" onClick={onClose}>{t('app.cancel')}</button>
            {!noCamera && <button className="rec-btn" onClick={start} disabled={!ready} aria-label={t('video.start')} />}
            {!noCamera && <button className="btn ghost rec-light" onClick={() => galRef.current?.click()}>{t('video.gallery')}</button>}
            {noCamera && <span />}
          </>
        )}
      </div>
      {fileInputs}
    </div>
  )
}

export function WalkaroundPanel({ order, onChange }: { order: Order; onChange: (v: VideoRef | undefined) => void }) {
  const { t, locale } = useSettings()
  const [rec, setRec] = useState(false)
  const v = order.walkaround
  const { url, loading } = useVideoUrl(v?.id)
  const signed = Boolean(order.signatures.acceptClient || order.signatures.acceptMaster)

  const record = () => {
    if (v && signed && !confirm(t('video.replaceSigned'))) return
    setRec(true)
  }

  const remove = () => {
    if (!v || !confirm(signed ? t('video.replaceSigned') : t('video.removeConfirm'))) return
    deleteVideos([v.id])
    onChange(undefined)
  }

  return (
    <section className="panel no-print">
      <h2>{t('video.title')}</h2>
      {v ? (
        <>
          {url ? (
            <video className="walk-video" src={url} controls playsInline preload="metadata" />
          ) : (
            <p className="muted">{loading ? t('video.loading') : t('video.missing')}</p>
          )}
          <div className="walk-meta">
            <small className="muted">
              {t('video.recorded', { date: new Date(v.at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }), dur: formatDuration(v.duration) })}
            </small>
            <span className="row">
              <button className="btn small ghost" onClick={record}>{t('video.redo')}</button>
              <button className="btn small ghost danger" onClick={remove}>{t('video.remove')}</button>
            </span>
          </div>
        </>
      ) : (
        <>
          <p className="muted">{t('video.hint')}</p>
          <button className="btn primary wide-btn" onClick={record}>🎥 {t('video.record')}</button>
        </>
      )}
      {rec && (
        <Recorder
          onClose={() => setRec(false)}
          onSave={(ref) => {
            if (v) deleteVideos([v.id])
            onChange(ref)
            setRec(false)
          }}
        />
      )}
    </section>
  )
}
