import { useEffect, useState } from 'react'
import { makeT, type Lang } from '../i18n'
import LangSelect from './LangSelect'
import { useSettings } from '../settingsHooks'
import { isNative, openExternal, printNative } from '../native'
import { downloadBlob, mailtoUrl, makePdf, orderText, pdfFileName, readyText, sharePdf, shareText, smsUrl, whatsappUrl } from '../share'
import type { Order } from '../types'
import type { DocKind } from './AcceptanceDoc'

interface Props {
  order: Order
  onClose: () => void
}

export default function ShareSheet({ order, onClose }: Props) {
  const { t, settings } = useSettings()
  const [lang, setLang] = useState<Lang>(settings.docLang)
  // после ремонта по умолчанию — акт выдачи
  const [kind, setKind] = useState<DocKind>(order.status === 'done' || order.status === 'issued' ? 'handover' : 'acceptance')
  const [pdf, setPdf] = useState<{ blob: Blob; lang: Lang; kind: DocKind; at: number } | null>(null)
  const [busy, setBusy] = useState(false)
  // PDF устарел, если заказ изменили после его создания
  const ready = pdf && pdf.lang === lang && pdf.kind === kind && pdf.at >= order.updatedAt ? pdf.blob : null
  const name = pdfFileName(order, kind)
  const docTitle = makeT(lang)(kind === 'handover' ? 'doc.handoverTitle' : 'doc.title')

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
      setPdf({ blob: await makePdf(order, lang, kind), lang, kind, at: order.updatedAt })
    } catch (e) {
      alert(t('share.error', { e: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  const text = () => (kind === 'handover' ? readyText(order, lang, settings) : orderText(order, lang, settings))

  const whatsapp = () => {
    if (!order.phone) alert(t('share.noPhone'))
    openExternal(whatsappUrl(order.phone, text()))
  }

  const sms = () => {
    window.location.href = smsUrl(order.phone, text())
  }

  const email = () => {
    const car = [order.make, order.model, order.plate].filter(Boolean).join(' ')
    window.location.href = mailtoUrl(order.email, `${docTitle}${car ? ' — ' + car : ''}`, text())
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text())
      alert(t('share.copied'))
    } catch {
      prompt(t('share.copyManual'), text())
    }
  }

  const message = async () => {
    if (!(await shareText(text(), docTitle))) copy()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('app.share')}>
        <div className="sheet-handle" />
        <h2>{t('share.title')}</h2>

        <div className="seg-row two">
          {(['acceptance', 'handover'] as DocKind[]).map((k) => (
            <button key={k} className={'seg' + (kind === k ? ' active' : '')} onClick={() => setKind(k)}>
              {t(k === 'handover' ? 'share.handover' : 'share.acceptance')}
            </button>
          ))}
        </div>

        <LangSelect value={lang} onChange={setLang} label={t('set.docLang')} />

        <div className="share-list">
          {ready ? (
            <button className="share-item primary" onClick={() => sharePdf(ready, name, docTitle)}>
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
            <button className="share-item" onClick={async () => {
              const path = await downloadBlob(ready, name)
              if (path) alert(t('share.saved', { path }))
            }}>
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
          <button className="share-item" onClick={sms}>
            <span className="share-icon">✉️</span>
            <span>
              <b>{t('share.sms')}</b>
              <small>{order.phone || t('share.smsHint')}</small>
            </span>
          </button>
          <button className="share-item" onClick={email}>
            <span className="share-icon">📧</span>
            <span>
              <b>{t('share.email')}</b>
              <small>{order.email || t('share.emailHint')}</small>
            </span>
          </button>
          <button className="share-item" onClick={message}>
            <span className="share-icon">📨</span>
            <span>
              <b>{t('share.text')}</b>
              <small>{t('share.textHint')}</small>
            </span>
          </button>
          <button className="share-item" onClick={copy}>
            <span className="share-icon">📋</span>
            <span>
              <b>{t('share.copy')}</b>
            </span>
          </button>
          <button
            className="share-item"
            onClick={() => {
              onClose()
              setTimeout(() => (isNative ? printNative(docTitle) : window.print()), 100)
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
