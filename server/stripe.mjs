// Stripe без SDK: запросы к REST API формой и проверка подписи вебхуков.
// STRIPE_SECRET_KEY — ключ (sk_test_… для проверки), STRIPE_WEBHOOK_SECRET — whsec_… эндпоинта,
// STRIPE_API (для тестов) — свой адрес вместо https://api.stripe.com
import { createHmac, timingSafeEqual } from 'node:crypto'

const API = () => (process.env.STRIPE_API || 'https://api.stripe.com').replace(/\/+$/, '')
export const stripeReady = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET)

// { a: { b: [1, 2] } } → a[b][0]=1&a[b][1]=2 — так Stripe принимает вложенные параметры
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (typeof v === 'object') form(v, key, out)
    else out.append(key, String(v))
  }
  return out
}

export async function stripe(method, path, params) {
  const body = params && method !== 'GET' ? form(params) : undefined
  const qs = params && method === 'GET' ? '?' + form(params) : ''
  const res = await fetch(API() + '/v1' + path + qs, {
    method,
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data.error?.message ?? 'ошибка'}`)
  return data
}

/** Событие вебхука, если подпись верна и не старше 5 минут; иначе null */
export function verifyWebhook(raw, header, secret = process.env.STRIPE_WEBHOOK_SECRET, nowSec = Date.now() / 1000) {
  const parts = String(header ?? '').split(',').map((p) => p.split('='))
  const t = Number(parts.find(([k]) => k === 't')?.[1])
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v)
  if (!secret || !t || !sigs.length || Math.abs(nowSec - t) > 300) return null
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex'))
  const ok = sigs.some((s) => {
    const b = Buffer.from(s)
    return b.length === expected.length && timingSafeEqual(b, expected)
  })
  if (!ok) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Подпись для тестов — как её ставит Stripe */
export const signWebhook = (raw, secret, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`

// конец оплаченного периода: в новых версиях API — у позиции подписки, в старых — у самой подписки
export const periodEnd = (sub) => (sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end ?? 0) * 1000
export const periodOf = (sub) => sub.items?.data?.[0]?.price?.recurring?.interval ?? sub.items?.data?.[0]?.plan?.interval ?? ''
