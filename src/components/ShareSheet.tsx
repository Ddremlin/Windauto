import { useEffect, useState } from 'react'
import { LANGS, makeT, type Lang } from '../i18n'
import { useSettings } from '../settings'
import { downloadBlob, makePdf, orderText, pdfFileName, sharePdf, whatsappUrl } from '../share'
import type { Order } from '../types'

interface Props {
  order: Order
  onClose: () => void
}

export default function ShareSheet({ order, onClose }: Props) {
  const { t, settings } = useSettings()
  const [lang, setLang] = useState<Lang>(settings.docLang)
  const [pdf, setPdf] = useState<{ blob: Blob; lang: Lang } | null>(null)
  const [busy, setBusy] = useState(false)
  const ready = pdf && pdf.lang === lang ? pdf.blob : null
  const name = pdfFileName(order)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // PDF готовится несколько секунд — после этого браузер уже не считает
  // нажатие «свежим» для share(), поэтому отправка — отдельным нажатием
  const generate = async () => {
    setBusy(true)
    try {
      setPdf({ blob: await makePdf(order, lang), lang })
    } catch (e) {
      alert(t('share.error', { e: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  const whatsapp = () => {
    if (!order.phone) alert(t('share.noPhone'))
    window.open(whatsappUrl(order.phone, orderText(order, lang, settings)), '_blank')
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('app.share')}>
        <div className="sheet-handle" />
        <h2>{t('share.title')}</h2>

        <div className="seg-row two">
          {LANGS.map((l) => (
            <button key={l.id} className={'seg' + (lang === l.id ? ' active' : '')} onClick={() => setLang(l.id)}>
              {l.label}
            </button>
          ))}
        </div>

        <div className="share-list">
          {ready ? (
            <button className="share-item primary" onClick={() => sharePdf(ready, name, makeT(lang)('doc.title'))}>
              <span className="share-icon">📤</span>
              <span>
                <b>{t('share.pdf')}</b>
                <small>{name}</small>
              </span>
            </button>
          ) : (
            <button className="share-item" onClick={generate} disabled={busy}>
              <span className="share-icon">{busy ? '⏳' : '📄'}</span>
              <span>
                <b>{busy ? t('share.making') : t('share.pdf')}</b>
                <small>{t('share.pdfHint')}</small>
              </span>
            </button>
          )}
          {ready && (
            <button className="share-item" onClick={() => downloadBlob(ready, name)}>
              <span className="share-icon">⬇️</span>
              <span>
                <b>{t('share.download')}</b>
              </span>
            </button>
          )}
          <button className="share-item" onClick={whatsapp}>
            <span className="share-icon">💬</span>
            <span>
              <b>{t('share.whatsapp')}</b>
              <small>{order.phone || t('share.whatsappHint')}</small>
            </span>
          </button>
          <button
            className="share-item"
            onClick={() => {
              onClose()
              setTimeout(() => window.print(), 100)
            }}
          >
            <span className="share-icon">🖨</span>
            <span>
              <b>{t('share.print')}</b>
            </span>
          </button>
        </div>

        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose}>
            {t('app.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
