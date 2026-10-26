// Круговое видео при приёмке. Файл лежит в IndexedDB (тот же склад, что и фото),
// в заказе — только VideoRef. На сервер уходит отдельно от фото: /api/videos/:id.
import { useEffect, useState } from 'react'
import { tx as idbTx } from './idb'
import type { Order, VideoRef } from './types'

const tx = <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => idbTx<T>('photos', mode, fn)

const newId = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2)

const extOf = (type: string) => (type.includes('webm') ? 'webm' : type.includes('quicktime') ? 'mov' : 'mp4')

export const videoType = (id: string) =>
  id.endsWith('.webm') ? 'video/webm' : id.endsWith('.mov') ? 'video/quicktime' : 'video/mp4'

export async function addVideo(blob: Blob, duration: number): Promise<VideoRef> {
  const id = `${newId()}.${extOf(blob.type)}`
  await tx('readwrite', (s) => s.put(blob, id))
  return { id, at: Date.now(), duration: Math.round(duration) }
}

export const getLocalVideo = (id: string) => tx('readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>)

// источник видео, которых нет на телефоне (сервер синхронизации)
let remoteSource: ((id: string) => Promise<Blob | undefined>) | null = null
export function markRemoteVideoSource(fn: typeof remoteSource) {
  remoteSource = fn
}

/** Видео с телефона, а если его нет — с сервера (и сохраняем у себя) */
export async function getVideo(id: string): Promise<Blob | undefined> {
  const local = await getLocalVideo(id)
  if (local || !remoteSource) return local
  const blob = await remoteSource(id).catch(() => undefined)
  if (blob) await tx('readwrite', (s) => s.put(blob, id)).catch(() => {})
  return blob
}

export async function deleteVideos(ids: string[]) {
  await Promise.all(ids.map((id) => tx('readwrite', (s) => s.delete(id)).catch(() => {})))
}

export const orderVideoIds = (o: Order): string[] => (o.walkaround ? [o.walkaround.id] : [])

/** object URL видео; loading — пока качается с сервера */
export function useVideoUrl(id: string | undefined): { url?: string; loading: boolean } {
  const [state, setState] = useState<{ id: string; url?: string } | null>(null)
  useEffect(() => {
    if (!id) return
    let url: string | undefined
    let alive = true
    getVideo(id).then((blob) => {
      if (!alive) return
      url = blob ? URL.createObjectURL(blob) : undefined
      setState({ id, url })
    })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [id])
  if (!id) return { loading: false }
  return state?.id === id ? { url: state.url, loading: false } : { loading: true }
}

export const formatDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
