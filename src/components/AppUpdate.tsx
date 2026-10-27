// Android-приложение обновляется с сервера Windauto: сравниваем versionCode установленного APK
// с тем, что выложен на сервере (/api/app), и по нажатию скачиваем и открываем установщик.
import { App as CapApp } from '@capacitor/app'
import { FileOpener } from '@capacitor-community/file-opener'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { useEffect, useState } from 'react'
import { isNative, UPDATE_SERVER } from '../native'
import { useT } from '../settingsHooks'
import { useSyncStatus } from '../sync'

interface Latest {
  versionCode?: number
  versionName?: string
  size?: number
}

export default function AppUpdate() {
  const t = useT()
  const { server } = useSyncStatus()
  const base = server || UPDATE_SERVER
  const [latest, setLatest] = useState<Latest | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isNative) return
    const check = async () => {
      try {
        const [info, res] = await Promise.all([CapApp.getInfo(), fetch(`${base}/api/app`)])
        const l: Latest = await res.json()
        setLatest(l.versionCode && l.versionCode > Number(info.build) ? l : null)
      } catch {
        /* нет связи — проверим в следующий раз */
      }
    }
    check()
    // и каждый раз, когда приложение снова открывают
    const sub = CapApp.addListener('resume', check)
    return () => void sub.then((s) => s.remove())
  }, [base])

  if (!latest) return null

  const install = async () => {
    setError('')
    setProgress(0)
    const sub = await Filesystem.addListener('progress', (p) => setProgress(p.contentLength ? p.bytes / p.contentLength : 0))
    try {
      const { path } = await Filesystem.downloadFile({
        url: `${base}/api/app/apk`,
        path: 'windauto.apk',
        directory: Directory.Cache,
        progress: true,
      })
      await FileOpener.open({ filePath: path!, contentType: 'application/vnd.android.package-archive' })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      sub.remove()
      setProgress(null)
    }
  }

  return (
    <div className="app-update no-print">
      <span>
        {t('update.available', { version: latest.versionName ?? '' })}
        {latest.size ? <small> · {(latest.size / 1048576).toFixed(1)} MB</small> : null}
        {error && <small className="error"> {error}</small>}
      </span>
      <button className="btn primary" onClick={install} disabled={progress !== null}>
        {progress !== null ? `${Math.round(progress * 100)}%` : t('update.install')}
      </button>
    </div>
  )
}
