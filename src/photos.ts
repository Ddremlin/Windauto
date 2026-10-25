// Фото повреждений хранятся в IndexedDB (localStorage для них мал),
// в заказе — только их id.
import { useEffect, useState } from 'react'
import type { Order } from './types'

const DB = 'windauto'
const STORE = 'photos'
const MAX_SIDE = 1600
const QUALITY = 0.82

let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const newId = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2)

/** Уменьшает фото до MAX_SIDE по большей стороне и пережимает в JPEG */
async function compress(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null)
  if (!bmp) return file
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * k)
  canvas.height = Math.round(bmp.height * k)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', QUALITY))
  return out ?? file
}

export async function addPhoto(file: Blob): Promise<string> {
  const id = newId()
  // сжимаем до открытия транзакции — IndexedDB закрывает её, пока ждём await
  const blob = await compress(file)
  await tx('readwrite', (s) => s.put(blob, id))
  return id
}

export async function getLocalPhoto(id: string): Promise<Blob | undefined> {
  return tx('readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>)
}

// источник фото, которых нет на телефоне (сервер синхронизации)
let remoteSource: ((id: string) => Promise<Blob | undefined>) | null = null
export function markRemoteSource(fn: typeof remoteSource) {
  remoteSource = fn
}

/** Фото с телефона, а если его нет — с сервера (и сохраняем у себя) */
export async function getPhoto(id: string): Promise<Blob | undefined> {
  const local = await getLocalPhoto(id)
  if (local || !remoteSource) return local
  const blob = await remoteSource(id).catch(() => undefined)
  if (blob) await tx('readwrite', (s) => s.put(blob, id)).catch(() => {})
  return blob
}

export async function deletePhotos(ids: string[]) {
  await Promise.all(ids.map((id) => tx('readwrite', (s) => s.delete(id)).catch(() => {})))
}

export function orderPhotoIds(o: Order): string[] {
  return Object.values(o.elements).flatMap((e) => e.photos ?? [])
}

// небольшой кэш object URL, чтобы миниатюры не мигали при перерисовке
const urlCache = new Map<string, string>()

export function usePhotoUrl(id: string): string | undefined {
  const [url, setUrl] = useState(() => urlCache.get(id))
  useEffect(() => {
    if (urlCache.has(id)) return setUrl(urlCache.get(id))
    let alive = true
    getPhoto(id).then((b) => {
      if (!b || !alive) return
      const u = URL.createObjectURL(b)
      urlCache.set(id, u)
      setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [id])
  return url
}

// Для резервной копии: фото в base64
export async function photosToDataUrls(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const id of ids) {
    const b = await getPhoto(id)
    if (!b) continue
    out[id] = await new Promise((r) => {
      const fr = new FileReader()
      fr.onload = () => r(fr.result as string)
      fr.readAsDataURL(b)
    })
  }
  return out
}

export async function restorePhotos(data: Record<string, string>) {
  for (const [id, url] of Object.entries(data)) {
    const blob = await (await fetch(url)).blob()
    await tx('readwrite', (s) => s.put(blob, id))
  }
}

// просим браузер не вычищать хранилище при нехватке места
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {})
}
