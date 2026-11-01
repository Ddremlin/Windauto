// Отчёты об ошибках: необработанные ошибки и отклонённые промисы уходят на сервер (POST /api/errors),
// разработчику — сводка раз в сутки. Данных клиентов нет: только текст ошибки, стек, версия, экран и устройство.
// Без связи — копятся в localStorage и уходят при следующем запуске.

const QUEUE_KEY = 'windauto.errors.v1'
const MAX_PER_RUN = 10
const MAX_QUEUE = 10

interface Report {
  message: string
  stack: string
  place: string
  version: string
  device: string
}

// шум, который ничего не говорит: чужие скрипты, ResizeObserver, обрывы сети (о них и так видно в синхронизации)
const NOISE = /^Script error\.?$|ResizeObserver loop|Failed to fetch$|NetworkError|Load failed|AbortError|aborted/i

export const device = () => navigator.userAgent.match(/\(([^)]+)\)/)?.[1].replace(/; wv\b/, '').slice(0, 120) ?? navigator.platform

let target: () => { server: string; token: string } = () => ({ server: '', token: '' })
const seen = new Set<string>()
let sent = 0

// экран без идентификаторов заказов: #/order/abc123 → #/order/:id
const place = () => location.hash.replace(/\/[^/?]{8,}/g, '/:id').slice(0, 100) || '#/'

function readQueue(): Report[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function writeQueue(q: Report[]) {
  try {
    if (q.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)))
    else localStorage.removeItem(QUEUE_KEY)
  } catch {
    /* хранилище недоступно — отчёт пропадёт */
  }
}

async function send(r: Report): Promise<boolean> {
  const { server, token } = target()
  if (!server) return false
  try {
    const res = await fetch(server + '/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(r),
    })
    // 4xx (лимит, неверный запрос) — повторять бессмысленно
    return res.ok || res.status < 500
  } catch {
    return false
  }
}

export function reportError(err: unknown) {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err) ?? String(err))
  // ошибки ответа сервера (ApiError) пишет сам сервер, а «нет связи» — не ошибка приложения
  if (e.name === 'ApiError' || NOISE.test(e.message)) return
  const key = e.message + '|' + (e.stack ?? '').split('\n')[1]
  if (seen.has(key) || sent >= MAX_PER_RUN) return
  seen.add(key)
  sent++
  const r: Report = { message: `${e.name}: ${e.message}`.slice(0, 1000), stack: (e.stack ?? '').slice(0, 4000), place: place(), version: __APP_VERSION__, device: device() }
  void send(r).then((ok) => {
    if (!ok) writeQueue([...readQueue(), r])
  })
}

export function initErrorReports(getTarget: typeof target) {
  target = getTarget
  if (!import.meta.env.PROD) return
  window.addEventListener('error', (ev) => reportError(ev.error ?? ev.message))
  window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason))
  const queued = readQueue()
  if (!queued.length) return
  writeQueue([])
  void (async () => {
    const left: Report[] = []
    for (const r of queued) if (!(await send(r))) left.push(r)
    writeQueue([...left, ...readQueue()])
  })()
}
