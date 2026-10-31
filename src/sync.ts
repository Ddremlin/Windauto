// Синхронизация с сервером Windauto.
// Телефон работает с локальными данными; изменения копятся и отправляются,
// когда есть связь. Конфликты: побеждает более позднее изменение заказа.
import { useSyncExternalStore } from 'react'
import { deletePhotos, getLocalPhoto, markRemoteSource, orderPhotoIds } from './photos'
import { deleteVideos, getLocalVideo, markRemoteVideoSource, orderVideoIds, videoType } from './videos'
import { applyRemoteShared, getSettings, hasShared, onSharedChange, pickShared, resetShared, setSharedStamp, type SharedSettings } from './settingsStore'
import { mergeOrders } from './merge'
import { getOrders, migrate, onLocalChange, removeOrder, replaceAllOrders, setServerNumbering, upsertOrder } from './storage'
import type { Order } from './types'

export interface SyncUser {
  id: string
  login: string
  name: string
  role: 'admin' | 'staff'
  disabled?: boolean
  email?: string
  // новый email ждёт подтверждения по ссылке из письма
  newEmail?: string
  // приглашён по email, пароль ещё не задал
  invited?: boolean
  // своя компания и права — приходят при входе и в /api/me
  orgId?: string
  orgName?: string
  owner?: boolean
  platform?: boolean
  // Pro: ИИ и фото/видео на сервере
  pro?: boolean
}

interface State {
  server: string
  token: string
  user: SyncUser | null
  lastRev: number
  dirty: Record<string, true>
  deleted: Record<string, number>
  uploaded: Record<string, true>
  sharedDirty: boolean
  lastSyncAt: number
}

export interface SyncStatus {
  connected: boolean
  server: string
  user: SyncUser | null
  syncing: boolean
  online: boolean
  lastSyncAt: number
  pending: number
  error: string | null
  authError: boolean
}

const KEY = 'windauto.sync.v1'
const EMPTY: State = { server: '', token: '', user: null, lastRev: 0, dirty: {}, deleted: {}, uploaded: {}, sharedDirty: false, lastSyncAt: 0 }

function load(): State {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { ...EMPTY }
  }
}

let state = load()
const persist = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

// --- статус для интерфейса ---
let status: SyncStatus = makeStatus({ syncing: false, error: null, authError: false })
const statusListeners = new Set<() => void>()

function makeStatus(p: Pick<SyncStatus, 'syncing' | 'error' | 'authError'>): SyncStatus {
  return {
    ...p,
    connected: Boolean(state.token),
    server: state.server,
    user: state.user,
    online: navigator.onLine,
    lastSyncAt: state.lastSyncAt,
    pending: Object.keys(state.dirty).length + Object.keys(state.deleted).length + (state.sharedDirty ? 1 : 0),
  }
}
function setStatus(p: Partial<Pick<SyncStatus, 'syncing' | 'error' | 'authError'>> = {}) {
  status = makeStatus({ syncing: status.syncing, error: status.error, authError: status.authError, ...p })
  statusListeners.forEach((l) => l())
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      statusListeners.add(l)
      return () => statusListeners.delete(l)
    },
    () => status,
  )
}

// --- HTTP ---
export class ApiError extends Error {
  status: number
  // код ошибки от сервера (unverified, email_taken…) — по нему показываем текст на языке интерфейса
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function api<T>(path: string, init: RequestInit = {}, server = state.server, token = state.token): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  if (token) headers.Authorization = `Bearer ${token}`
  if (init.body && typeof init.body === 'string') headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(server + path, { ...init, headers })
  } catch {
    throw new ApiError(0, 'Нет связи с сервером / Brak połączenia z serwerem')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`, body.code)
  }
  return res.json()
}

export function normalizeServer(s: string): string {
  let u = s.trim().replace(/\/+$/, '')
  if (u && !/^https?:\/\//.test(u)) u = 'https://' + u
  return u
}

// --- фото с сервера ---
markRemoteSource(async (id) => {
  if (!state.token) return undefined
  const res = await fetch(`${state.server}/api/photos/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${state.token}` },
  }).catch(() => null)
  return res?.ok ? res.blob() : undefined
})

markRemoteVideoSource(async (id) => {
  if (!state.token) return undefined
  const res = await fetch(`${state.server}/api/videos/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${state.token}` },
  }).catch(() => null)
  return res?.ok ? res.blob() : undefined
})

// --- цикл синхронизации ---
let running = false
let again = false
let timer: ReturnType<typeof setTimeout> | undefined
let interval: ReturnType<typeof setInterval> | undefined
let events: EventSource | null = null

export function scheduleSync(delay = 1500) {
  if (!state.token) return
  clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), delay)
}

type RemoteOrder = { id: string; updatedAt: number; deleted: boolean; data: Order | null }

function applyRemote(r: RemoteOrder) {
  const local = getOrders().find((o) => o.id === r.id)
  if (r.deleted) {
    // своё изменение новее удаления — заказ остаётся и уйдёт на сервер снова
    if (state.dirty[r.id] && local && local.updatedAt > r.updatedAt) return
    if (local) {
      deletePhotos(orderPhotoIds(local))
      deleteVideos(orderVideoIds(local))
      removeOrder(r.id, { remote: true })
    }
    delete state.dirty[r.id]
    delete state.deleted[r.id]
    return
  }
  if (!r.data) return
  const remote = migrate({ ...r.data, updatedAt: r.updatedAt })
  ;[...orderPhotoIds(remote), ...orderVideoIds(remote)].forEach((id) => (state.uploaded[id] = true))
  // заказ удалён здесь, но ещё не отправлено: чужая правка новее удаления — побеждает она
  if (state.deleted[r.id]) {
    if (state.deleted[r.id] >= r.updatedAt) return
    delete state.deleted[r.id]
  }
  if (state.dirty[r.id] && local) {
    // есть неотправленные свои правки — сливаем по полям и отправим результат
    upsertOrder(mergeOrders(local, remote), { remote: true })
    scheduleSync(300)
    return
  }
  if (!local || local.updatedAt < remote.updatedAt) upsertOrder(remote, { remote: true })
  delete state.dirty[r.id]
}

export async function syncNow(): Promise<void> {
  if (!state.token) return
  if (running) {
    again = true
    return
  }
  running = true
  setStatus({ syncing: true })
  try {
    // тариф и права могут смениться на сервере — освежаем раз в 10 минут
    if (Date.now() - meAt > 600_000) await refreshMe()
    // 1. новые фото — раньше заказов, чтобы на других телефонах они уже были.
    // Без Pro фото и видео остаются на телефоне; после включения Pro загрузятся сами
    const media = isPro()
    for (const id of media ? getOrders().flatMap(orderPhotoIds) : []) {
      if (state.uploaded[id]) continue
      const blob = await getLocalPhoto(id)
      if (!blob) continue
      await api(`/api/photos/${encodeURIComponent(id)}`, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } })
      state.uploaded[id] = true
      persist()
    }
    // круговые видео — после фото: они большие и грузятся дольше
    for (const id of media ? getOrders().flatMap(orderVideoIds) : []) {
      if (state.uploaded[id]) continue
      const blob = await getLocalVideo(id)
      if (!blob) continue
      await api(`/api/videos/${encodeURIComponent(id)}`, { method: 'PUT', body: blob, headers: { 'Content-Type': videoType(id) } })
      state.uploaded[id] = true
      persist()
    }

    // 2. свои изменения
    // общие настройки отправляет только администратор; заполненные в старой
    // версии (без отметки времени) получают минимальную, чтобы не затереть серверные
    const isAdmin = state.user?.role === 'admin'
    if (!isAdmin) state.sharedDirty = false
    else if (!getSettings().sharedUpdatedAt && hasShared(getSettings())) {
      setSharedStamp(1)
      state.sharedDirty = true
    }
    const sent = new Map<string, number>()
    const payload: RemoteOrder[] = []
    for (const id of Object.keys(state.dirty)) {
      const o = getOrders().find((x) => x.id === id)
      if (!o) {
        delete state.dirty[id]
        continue
      }
      sent.set(id, o.updatedAt)
      payload.push({ id, updatedAt: o.updatedAt, deleted: false, data: o })
    }
    for (const [id, at] of Object.entries(state.deleted)) {
      sent.set(id, at)
      payload.push({ id, updatedAt: at, deleted: true, data: null })
    }
    const s = getSettings()
    const sharedSent = state.sharedDirty ? s.sharedUpdatedAt : 0
    if (payload.length || sharedSent) {
      const res = await api<{ accepted: string[]; rejected?: RemoteOrder[]; merged?: RemoteOrder[]; rev: number }>('/api/sync', {
        method: 'POST',
        body: JSON.stringify({ orders: payload, settings: sharedSent ? { data: pickShared(s), updatedAt: sharedSent } : undefined }),
      })
      for (const id of res.accepted) {
        // если заказ успели изменить во время отправки — отправим ещё раз
        const cur = getOrders().find((x) => x.id === id)
        if (!cur || cur.updatedAt === sent.get(id)) delete state.dirty[id]
        if (state.deleted[id] === sent.get(id)) delete state.deleted[id]
      }
      // сервер слил нашу версию с чужой (или выдал номер) — берём его результат,
      // если заказ не меняли во время отправки; иначе сливаем ещё раз у себя
      for (const r of [...(res.merged ?? []), ...(res.rejected ?? [])]) {
        const cur = getOrders().find((x) => x.id === r.id)
        if (!cur || cur.updatedAt === sent.get(r.id)) delete state.dirty[r.id]
        if (state.deleted[r.id] === sent.get(r.id)) delete state.deleted[r.id]
        applyRemote(r)
      }
      if (sharedSent && getSettings().sharedUpdatedAt === sharedSent) state.sharedDirty = false
      persist()
    }

    // 3. чужие изменения
    const pull = await api<{ rev: number; orders: RemoteOrder[]; settings: { data: SharedSettings; updatedAt: number } | null }>(
      `/api/sync?since=${state.lastRev}`,
    )
    pull.orders.forEach(applyRemote)
    if (pull.settings && !state.sharedDirty) applyRemoteShared(pull.settings.data, pull.settings.updatedAt)
    state.lastRev = pull.rev
    state.lastSyncAt = Date.now()
    persist()
    setStatus({ error: null, authError: false })
  } catch (e) {
    const err = e as ApiError
    // Pro выключили — узнаём об этом и синхронизируем дальше без фото и видео
    if (err.status === 402 && state.user?.pro) {
      await refreshMe()
      if (!state.user?.pro) again = true
    }
    setStatus({ error: err.status === 402 ? null : err.message, authError: err.status === 401 })
    if (err.status === 401) stopLive()
  } finally {
    running = false
    setStatus({ syncing: false })
    if (again) {
      again = false
      scheduleSync(200)
    }
  }
}

function startLive() {
  stopLive()
  if (!state.token) return
  interval = setInterval(() => void syncNow(), 60_000)
  try {
    events = new EventSource(`${state.server}/api/events?token=${encodeURIComponent(state.token)}`)
    events.addEventListener('rev', (e) => {
      if (Number((e as MessageEvent).data) > state.lastRev) scheduleSync(300)
    })
  } catch {
    events = null
  }
}

function stopLive() {
  clearInterval(interval)
  events?.close()
  events = null
}

// --- вход / выход ---
// какой компании принадлежат заказы на телефоне (запоминаем и после выхода)
const DATA_ORG_KEY = 'windauto.dataOrg'
const dataOrg = () => {
  try {
    return localStorage.getItem(DATA_ORG_KEY) ?? ''
  } catch {
    return ''
  }
}
const setDataOrg = (id: string) => {
  try {
    localStorage.setItem(DATA_ORG_KEY, id)
  } catch {
    /* приватный режим */
  }
}

/** Убрать с телефона заказы, фото и реквизиты прежней компании (на её сервере они остаются) */
function clearLocalData() {
  const list = getOrders()
  deletePhotos(list.flatMap(orderPhotoIds))
  deleteVideos(list.flatMap(orderVideoIds))
  replaceAllOrders([])
  resetShared()
}

/**
 * Вход. Если на телефоне заказы другой компании, спрашиваем (confirmSwitch) и убираем их,
 * иначе они уехали бы в новую компанию.
 */
export async function connect(server: string, login: string, password: string, confirmSwitch: (from: string) => boolean = () => true) {
  const url = normalizeServer(server)
  const res = await api<{ token: string; user: SyncUser }>(
    '/api/login',
    { method: 'POST', body: JSON.stringify({ login, password }) },
    url,
    '',
  )
  const prev = dataOrg()
  const orgId = res.user.orgId ?? ''
  if (prev && orgId && prev !== orgId && getOrders().length) {
    if (!confirmSwitch(prev)) {
      await api('/api/logout', { method: 'POST' }, url, res.token).catch(() => {})
      return false
    }
    clearLocalData()
  }
  if (orgId) setDataOrg(orgId)
  // всё, что уже есть на телефоне, отправляем на сервер
  const dirty: Record<string, true> = {}
  getOrders().forEach((o) => (dirty[o.id] = true))
  const isAdmin = res.user.role === 'admin'
  // у сотрудника цены и реквизиты всегда берутся с сервера
  if (!isAdmin) setSharedStamp(0)
  state = { ...EMPTY, server: url, token: res.token, user: res.user, dirty, sharedDirty: isAdmin && getSettings().sharedUpdatedAt > 0 }
  persist()
  setServerNumbering(true)
  setStatus({ error: null, authError: false })
  startLive()
  await syncNow()
  return true
}

export async function disconnect() {
  await api('/api/logout', { method: 'POST' }).catch(() => {})
  stopLive()
  state = { ...EMPTY, server: state.server }
  persist()
  setServerNumbering(false)
  staffCache = []
  setStatus({ error: null, authError: false })
}

// --- регистрация компании и письма (без входа) ---
const post = <T,>(server: string, path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) }, normalizeServer(server), '')

export const serverInfo = (server: string) => api<{ registration?: boolean }>('/api/info', {}, normalizeServer(server), '')
export const register = (server: string, r: { company: string; name: string; email: string; password: string; lang: string; accept: boolean }) =>
  post(server, '/api/register', r)
export const resendVerify = (server: string, email: string) => post(server, '/api/verify/resend', { email })
export const forgotPassword = (server: string, login: string) => post(server, '/api/password/forgot', { login })
export const legalUrl = (server: string, doc: 'privacy' | 'terms', lang: string) => `${normalizeServer(server)}/legal/${doc}?lang=${lang}`

// --- своя компания ---
export interface OrgInfo {
  id: string
  name: string
  created: number
  ownerId: string
}
export const getOrg = () => api<{ org: OrgInfo }>('/api/org').then((r) => r.org)
export const renameOrg = (name: string) => api('/api/org', { method: 'PATCH', body: JSON.stringify({ name }) })
/** Удалить компанию со всеми данными (только владелец) — и выйти */
export async function deleteOrg(password: string) {
  await api('/api/org', { method: 'DELETE', body: JSON.stringify({ password }) })
  stopLive()
  clearLocalData()
  state = { ...EMPTY, server: state.server }
  persist()
  setServerNumbering(false)
  setStatus({ error: null, authError: false })
}

// --- владелец платформы: все компании ---
export interface OrgSummary {
  id: string
  name: string
  created: number
  blocked: boolean
  pro: boolean
  owner: { name: string; login: string; email: string } | null
  users: number
  orders: number
  lastSeen: number
}
export const listOrgs = () => api<{ orgs: OrgSummary[] }>('/api/platform/orgs').then((r) => r.orgs)
export const setOrgBlocked = (id: string, blocked: boolean) =>
  api(`/api/platform/orgs/${id}`, { method: 'PATCH', body: JSON.stringify({ blocked }) })
export const setOrgPro = (id: string, pro: boolean) => api(`/api/platform/orgs/${id}`, { method: 'PATCH', body: JSON.stringify({ pro }) })
export const removeOrg = (id: string) => api(`/api/platform/orgs/${id}`, { method: 'DELETE' })

// --- администрирование ---
export const listUsers = () => api<{ users: SyncUser[] }>('/api/users').then((r) => r.users)
export const createUser = (u: { login: string; email: string; name: string; password: string; role: 'admin' | 'staff' }) =>
  api<{ user: SyncUser }>('/api/users', { method: 'POST', body: JSON.stringify(u) }).then((r) => r.user)
export const patchUser = (id: string, patch: Partial<{ name: string; password: string; disabled: boolean; role: string; invite: boolean }>) =>
  api<{ user: SyncUser }>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => r.user)
export const deleteUser = (id: string) => api(`/api/users/${id}`, { method: 'DELETE' })
export const changePassword = (oldPassword: string, newPassword: string) =>
  api('/api/password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) })

/** Свой email: сервер шлёт ссылку на новый адрес, сменится после перехода по ней */
export async function changeEmail(email: string, password: string) {
  await api('/api/me/email', { method: 'POST', body: JSON.stringify({ email, password }) })
  await refreshMe()
}

// --- сотрудники для выбора ответственного (доступно всем) ---
let staffCache: SyncUser[] = []
export async function listStaff(): Promise<SyncUser[]> {
  if (!state.token) return []
  try {
    staffCache = (await api<{ users: SyncUser[] }>('/api/staff')).users
  } catch {
    /* офлайн — последний известный список */
  }
  return staffCache
}

// --- история изменений заказа ---
export interface HistoryEntry {
  at: number
  user: string
  action: 'create' | 'update' | 'delete' | 'merge'
  changes: { key: string; from?: string; to?: string }[]
}
export const getHistory = (id: string) =>
  api<{ history: HistoryEntry[] }>(`/api/orders/${encodeURIComponent(id)}/history`).then((r) => r.history)

// --- запуск ---
export function initSync() {
  setServerNumbering(Boolean(state.token))
  onLocalChange((c) => {
    if (!state.token) return
    if (c.type === 'upsert') state.dirty[c.order.id] = true
    else {
      delete state.dirty[c.id]
      state.deleted[c.id] = c.at
    }
    persist()
    setStatus()
    scheduleSync()
  })
  onSharedChange(() => {
    if (!state.token || state.user?.role !== 'admin') return
    state.sharedDirty = true
    persist()
    setStatus()
    scheduleSync()
  })
  window.addEventListener('online', () => {
    setStatus()
    scheduleSync(500)
  })
  window.addEventListener('offline', () => setStatus())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(300)
  })
  if (state.token) {
    startLive()
    scheduleSync(300)
    refreshMe()
  }
}

/** Свежие данные о себе и компании (название, права); заодно запоминаем, чьи заказы на телефоне */
let meAt = 0
export async function refreshMe() {
  meAt = Date.now()
  try {
    const { user } = await api<{ user: SyncUser }>('/api/me')
    state.user = user
    persist()
    if (user.orgId && !dataOrg()) setDataOrg(user.orgId)
    setStatus()
  } catch {
    /* офлайн — в следующий раз */
  }
}

// --- распознавание VIN / номера / техпаспорта по фото (на сервере, через Claude) ---
export type ScanKind = 'vin' | 'plate' | 'doc'

export interface Recognized {
  value: string
  country?: string
  confident: boolean
}

// техпаспорт (dowód rejestracyjny): пустая строка — поле не прочитано
export interface RecognizedDoc {
  plate: string
  vin: string
  make: string
  model: string
  year: string
  owner: string
  confident: boolean
}

/** Подключены к общей базе */
export const isConnected = () => Boolean(state.token)
/** Компания с Pro: ИИ и фото/видео на сервере */
export const isPro = () => Boolean(state.token && state.user?.pro)
/** ИИ на сервере — только в Pro */
export const canRecognize = isPro

// --- отзывы клиентов о ремонте ---
export interface Review {
  orderId: string
  // когда отправили ссылку
  sentAt: number
  // 0 — клиент ещё не ответил
  stars: number
  comment: string
  at: number
}

export const reviewLink = (orderId: string, lang: string) =>
  api<{ url: string }>('/api/reviews/link', { method: 'POST', body: JSON.stringify({ orderId, lang }) }).then((r) => r.url)
export const listReviews = () => api<{ reviews: Review[] }>('/api/reviews').then((r) => r.reviews)

// для чтения мелких символов хватает 1600 px по большей стороне (техпаспорт — 2000)
async function toJpegBase64(file: Blob, maxSide = 1600): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * k)
  canvas.height = Math.round(bmp.height * k)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]
}

export async function recognize(kind: 'vin' | 'plate', file: Blob): Promise<Recognized>
export async function recognize(kind: 'doc', file: Blob): Promise<RecognizedDoc>
export async function recognize(kind: ScanKind, file: Blob): Promise<Recognized | RecognizedDoc> {
  const image = await toJpegBase64(file, kind === 'doc' ? 2000 : 1600)
  return api('/api/recognize', { method: 'POST', body: JSON.stringify({ kind, image }) })
}

// --- голосовой ввод: распознанный телефоном текст → поля заказа (Claude на сервере) ---
export interface VoiceElement {
  id: string
  works: string[]
  damage: string[]
  // zł за работы по элементу; 0 — не названа
  price: number
  note: string
}

export interface VoiceResult {
  // пустая строка — об этом поле ничего не сказано
  fields: Record<string, string>
  elements: VoiceElement[]
  confident: boolean
}

type Named = { id: string; name: string }

export const parseVoice = (text: string, lists: { elements: Named[]; works: Named[]; damages: Named[] }) =>
  api<VoiceResult>('/api/voice', { method: 'POST', body: JSON.stringify({ text, ...lists }) })

// --- «Помощь»: сообщение разработчику (можно и без входа — тогда на сервер обновлений) ---
export interface SupportMessage {
  via: 'email' | 'telegram'
  message: string
  contact: string
  version: string
  device: string
  lang: string
}
export const sendSupport = (m: SupportMessage, fallbackServer: string) =>
  api<{ ok: true }>('/api/support', { method: 'POST', body: JSON.stringify(m) }, state.server || fallbackServer, state.token)
