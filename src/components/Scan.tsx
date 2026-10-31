import { useRef, useState } from 'react'
import { recognizePhoto, type Recognized } from '../ocr'
import { useT } from '../settingsHooks'
import { canRecognize, isConnected, recognize, type RecognizedDoc } from '../sync'

// Кнопка камеры у поля номера и VIN: с общей базой читает сервер (Claude), иначе — телефон.
export function useScan(kind: 'vin' | 'plate', onResult: (r: Recognized) => void) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const start = () => {
    setMessage(null)
    inputRef.current?.click()
  }

  const handle = async (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    setBusy(true)
    try {
      const r = await recognizePhoto(kind, file)
      if (!r.value) setMessage(t('scan.notFound'))
      else {
        onResult(r)
        setMessage(r.confident ? null : t('scan.check'))
      }
    } catch {
      setMessage(t('scan.fail'))
    } finally {
      setBusy(false)
    }
  }

  const button = (
    <>
      <button
        type="button"
        className={'scan-btn no-print' + (busy ? ' busy' : '')}
        title={t('scan.button')}
        aria-label={t('scan.button')}
        disabled={busy}
        onClick={start}
      >
        {busy ? <span className="spinner" /> : cameraIcon}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => handle(e.target.files?.[0])}
      />
    </>
  )
  return { button, message: busy ? t('scan.busy') : message }
}

// Техпаспорт: снимок → поля карточки. onResult возвращает, сколько полей заполнено.
export function useDocScan(onResult: (r: RecognizedDoc) => number) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const start = () => {
    if (!canRecognize()) return setMessage(t(isConnected() ? 'pro.needed' : 'scan.needServer'))
    setMessage(null)
    inputRef.current?.click()
  }

  const handle = async (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    setBusy(true)
    setMessage(t('scan.busy'))
    try {
      const r = await recognize('doc', file)
      if (!r.vin && !r.plate && !r.make) return setMessage(t('scan.docNotFound'))
      const n = onResult(r)
      setMessage(n === 0 ? t('scan.docNothingNew') : r.confident ? t('scan.docDone', { n }) : t('scan.docCheck', { n }))
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const input = <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => handle(e.target.files?.[0])} />
  return { start, busy, message, input }
}

const cameraIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </svg>
)
