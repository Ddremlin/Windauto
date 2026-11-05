// Android-приложение (Capacitor): то, что в WebView работает не так, как в браузере, —
// «Поделиться» файлом, сохранение файлов, печать, внешние ссылки, запись видео камерой.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

export const isNative = Capacitor.isNativePlatform()

// откуда приложение берёт обновления, пока не подключено к базе (после подключения — с её сервера)
export const UPDATE_SERVER = import.meta.env?.VITE_UPDATE_SERVER || 'https://app.dmerlinauto.vip'

const Print = registerPlugin<{ print: (o: { name: string }) => Promise<void> }>('Print')

interface RecordOptions {
  maxSec: number
  bitrate: number
  tip: string
  limit: string
  cancel: string
  gallery: string
}
// path — записанный файл; иначе action: cancel (закрыли), gallery (выбрать файл), fallback (камера не открылась)
interface RecordResult {
  path?: string
  duration?: number
  action?: 'cancel' | 'gallery' | 'fallback'
  message?: string
}
const VideoRecorder = registerPlugin<{ record: (o: RecordOptions) => Promise<RecordResult> }>('VideoRecorder')

// WebView на Android не отдаёт зум камеры — круговое видео пишем нативной камерой (зум от 0.5×)
export const hasNativeRecorder = isNative && Capacitor.getPlatform() === 'android'

export async function recordVideoNative(o: RecordOptions): Promise<RecordResult & { blob?: Blob }> {
  const r = await VideoRecorder.record(o)
  if (!r.path) return r
  const blob = await (await fetch(Capacitor.convertFileSrc(r.path))).blob()
  return { ...r, blob: new Blob([blob], { type: 'video/mp4' }) }
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

// Плагин файлов принимает только base64-строку: большой файл (видео до 300 МБ) пишем кусками,
// иначе строка целиком не влезет в память. Кусок кратен 3 байтам — base64 склеивается без дыр.
const CHUNK = 3 * 1024 * 1024
async function writeChunked(path: string, blob: Blob, directory: Directory): Promise<string> {
  let uri = ''
  for (let at = 0; at < blob.size || at === 0; at += CHUNK) {
    const data = await toBase64(blob.slice(at, at + CHUNK))
    if (at === 0) uri = (await Filesystem.writeFile({ path, data, directory, recursive: true })).uri
    else await Filesystem.appendFile({ path, data, directory })
  }
  return uri
}

/** Системное меню «Поделиться» с файлами (WhatsApp, почта, Диск, «Сохранить в файлы»…) */
export async function shareFilesNative(files: { blob: Blob; name: string }[], title: string, text?: string): Promise<void> {
  const urls: string[] = []
  for (const f of files) urls.push(await writeChunked(f.name, f.blob, Directory.Cache))
  try {
    await Share.share({ title, files: urls, dialogTitle: title, ...(text ? { text } : {}) })
  } catch (e) {
    // закрыли меню — не ошибка
    if (!/cancel/i.test((e as Error).message)) throw e
  }
}

export const shareFileNative = (blob: Blob, name: string, title: string) => shareFilesNative([{ blob, name }], title)

export async function shareTextNative(text: string, title: string): Promise<void> {
  try {
    await Share.share({ title, text, dialogTitle: title })
  } catch (e) {
    if (!/cancel/i.test((e as Error).message)) throw e
  }
}

/** Сохраняет файл в «Документы» телефона; возвращает путь для сообщения пользователю */
export async function saveFileNative(blob: Blob, name: string): Promise<string> {
  await writeChunked(`Windauto/${name}`, blob, Directory.Documents)
  return `Documents/Windauto/${name}`
}

export const printNative = (name: string) => Print.print({ name })

/** Ссылка в новой вкладке; в приложении — в своём приложении (WhatsApp, браузер), а не внутри Windauto */
export function openExternal(url: string) {
  if (isNative) window.location.href = url
  else window.open(url, '_blank', 'noopener')
}
