import { useState } from 'react'
import { downloadBlob, shareFiles } from '../share'
import { useT } from '../settingsHooks'

interface Props {
  // файл берём только по нажатию: видео может быть большим и лежать на сервере
  get: () => Promise<Blob | undefined>
  name: string
  title: string
  className?: string
}

/** Кнопки «Скачать» и «Поделиться» для фото или видео */
export default function MediaActions({ get, name, title, className = 'icon-btn' }: Props) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const run = async (fn: (b: Blob) => Promise<unknown>) => {
    setBusy(true)
    try {
      const b = await get()
      if (!b) return alert(t('media.missing'))
      await fn(b)
    } catch (e) {
      alert(t('share.error', { e: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        aria-label={t('media.download')}
        title={t('media.download')}
        onClick={() =>
          run(async (b) => {
            const path = await downloadBlob(b, name)
            if (path) alert(t('share.saved', { path }))
          })
        }
      >
        {busy ? '⏳' : '⬇️'}
      </button>
      <button type="button" className={className} disabled={busy} aria-label={t('media.share')} title={t('media.share')} onClick={() => run((b) => shareFiles([{ blob: b, name }], title))}>
        📤
      </button>
    </>
  )
}
