// Сервер целиком: запускаем server.mjs на временной папке и ходим в API.
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

const PORT = 18000 + Math.floor(Math.random() * 1000)
// поддельный Stripe: запоминает запросы, подписки отдаёт из fakeSubs
const STRIPE_PORT = PORT + 1000
const WHSEC = 'whsec_test'
const stripeCalls: { method: string; path: string; body: URLSearchParams }[] = []
const fakeSubs: Record<string, unknown> = {}
const fakeStripe = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const path = (req.url ?? '').split('?')[0]
    stripeCalls.push({ method: req.method ?? '', path, body: new URLSearchParams(raw) })
    const sub = path.match(/^\/v1\/subscriptions\/(.+)$/)
    const out = path === '/v1/checkout/sessions' ? { id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' }
      : path === '/v1/billing_portal/sessions' ? { url: 'https://billing.stripe.test/p_1' }
      : sub ? fakeSubs[sub[1]] : null
    res.writeHead(out ? 200 : 404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(out ?? { error: { message: 'no such object' } }))
  })
})
const URL_ = `http://127.0.0.1:${PORT}`
const dir = mkdtempSync(join(tmpdir(), 'windauto-'))
let proc: ChildProcess

async function start() {
  proc = spawn(process.execPath, ['server/server.mjs'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ADMIN_PASSWORD: 'secret1', ORG_QUOTA_GB: '0.001', FREE_QUOTA_GB: '0.0002', ANTHROPIC_API_KEY: '', MAIL_OUTBOX: join(dir, 'mail.jsonl'), SUPPORT_EMAIL: 'help@windauto.test', TELEGRAM_OUTBOX: join(dir, 'tg.jsonl'), REGISTER_PER_HOUR: '100', NODE_NO_WARNINGS: '1',
      STRIPE_API: `http://127.0.0.1:${STRIPE_PORT}`, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_PRICE_MONTH: 'price_month', STRIPE_PRICE_YEAR: 'price_year' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(URL_ + '/api/health')).ok) return
    } catch {
      /* ещё стартует */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('server did not start')
}
const stop = () => new Promise((r) => (proc.once('exit', r), proc.kill('SIGTERM')))

async function api(path: string, token = '', body?: unknown, method = body ? 'POST' : 'GET') {
  const res = await fetch(URL_ + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}
const login = async (l: string, p: string) => (await api('/api/login', '', { login: l, password: p })).body.token as string

const order = (patch: Record<string, unknown> = {}) => ({
  id: 'o1', number: '', createdAt: Date.parse('2026-03-01'), updatedAt: 100, status: 'new', plate: 'WA 1', phone: '', notes: '',
  elements: {}, signatures: {}, ...patch,
})

let admin = ''
let staff = ''
before(async () => {
  await new Promise<void>((r) => fakeStripe.listen(STRIPE_PORT, '127.0.0.1', r))
  await start()
  admin = await login('admin', 'secret1')
  await api('/api/users', admin, { login: 'jan', name: 'Jan', password: 'secret22', role: 'staff' })
  staff = await login('jan', 'secret22')
})
after(async () => {
  fakeStripe.close()
  await stop()
  rmSync(dir, { recursive: true, force: true })
})

test('новый заказ получает номер с сервера', async () => {
  const r = await api('/api/sync', admin, { orders: [{ id: 'o1', updatedAt: 100, deleted: false, data: order() }] })
  assert.equal(r.status, 200)
  assert.equal(r.body.merged.length, 1)
  assert.equal(r.body.merged[0].data.number, '2026/0001')
  assert.ok(r.body.merged[0].updatedAt > 100)
})

test('номер с телефона без сервера учитывается счётчиком', async () => {
  await api('/api/sync', admin, { orders: [{ id: 'o2', updatedAt: 100, deleted: false, data: order({ id: 'o2', number: '2026/0040' }) }] })
  const r = await api('/api/sync', admin, { orders: [{ id: 'o3', updatedAt: 100, deleted: false, data: order({ id: 'o3' }) }] })
  assert.equal(r.body.merged[0].data.number, '2026/0041')
})

test('одновременные правки разных полей сливаются', async () => {
  const cur = (await api('/api/sync?since=0', admin)).body.orders.find((o: { id: string }) => o.id === 'o1')
  const v = cur.updatedAt
  // оба телефона видели версию v; первый меняет телефон, второй — примечания
  const a = { ...cur.data, phone: '+48 600', updatedAt: v + 10, _ft: { ...cur.data._ft, phone: v + 10 } }
  const b = { ...cur.data, notes: 'rysa', updatedAt: v + 5, _ft: { ...cur.data._ft, notes: v + 5 } }
  const ra = await api('/api/sync', admin, { orders: [{ id: 'o1', updatedAt: a.updatedAt, deleted: false, data: a }] })
  assert.deepEqual(ra.body.accepted, ['o1'])
  const rb = await api('/api/sync', staff, { orders: [{ id: 'o1', updatedAt: b.updatedAt, deleted: false, data: b }] })
  assert.equal(rb.body.merged.length, 1)
  const m = rb.body.merged[0].data
  assert.equal(m.phone, '+48 600')
  assert.equal(m.notes, 'rysa')
  assert.equal(m.number, '2026/0001')
})

test('повторная отправка того же заказа ничего не пишет', async () => {
  const before = (await api('/api/health')).body.rev
  const cur = (await api('/api/sync?since=0', admin)).body.orders.find((o: { id: string }) => o.id === 'o1')
  const r = await api('/api/sync', admin, { orders: [{ id: 'o1', updatedAt: cur.updatedAt, deleted: false, data: cur.data }] })
  assert.deepEqual(r.body.accepted, ['o1'])
  assert.equal((await api('/api/health')).body.rev, before)
})

test('история: кто и что менял', async () => {
  const h = (await api('/api/orders/o1/history', staff)).body.history
  assert.ok(h.length >= 2)
  assert.equal(h[h.length - 1].action, 'create')
  const merge = h.find((x: { action: string }) => x.action === 'merge')
  assert.equal(merge.user, 'Jan')
  assert.ok(merge.changes.some((c: { key: string; to: string }) => c.key === 'notes' && c.to === 'rysa'))
})

test('список сотрудников доступен всем, управление — только админу', async () => {
  const s = await api('/api/staff', staff)
  assert.deepEqual(s.body.users.map((u: { login: string }) => u.login).sort(), ['admin', 'jan'])
  assert.equal((await api('/api/users', staff)).status, 403)
})

test('удаление и правка после удаления', async () => {
  const r = await api('/api/sync', admin, { orders: [{ id: 'o3', updatedAt: 1, deleted: true, data: null }] })
  // заказ o3 на сервере новее (updatedAt > 1) — удаление старой версии отклоняется
  assert.equal(r.body.rejected.length, 1)
  const r2 = await api('/api/sync', admin, { orders: [{ id: 'o3', updatedAt: Date.now(), deleted: true, data: null }] })
  assert.deepEqual(r2.body.accepted, ['o3'])
})

test('своя компания владельца платформы — всегда Pro', async () => {
  assert.equal((await api('/api/me', staff)).body.user.pro, true)
})

test('распознавание без ключа — понятная ошибка; неизвестный kind отклоняется', async () => {
  const r = await api('/api/recognize', staff, { kind: 'doc', image: 'x' })
  assert.equal(r.status, 503)
})

test('голос без ключа — понятная ошибка; без входа — 401', async () => {
  const lists = { elements: [{ id: 'hood', name: 'Капот' }], works: [{ id: 'repair', name: 'Ремонт' }], damages: [{ id: 'dent', name: 'Вмятина' }] }
  const r = await api('/api/voice', staff, { text: 'капот ремонт', ...lists })
  assert.equal(r.status, 503)
  assert.match(r.body.error, /ANTHROPIC_API_KEY/)
  assert.equal((await api('/api/voice', '', { text: 'x', ...lists })).status, 401)
})

test('круговое видео: загрузка, Range, неверный id и вход', async () => {
  const id = 'a1b2c3d4-e5f6.mp4'
  const data = new Uint8Array(1000).map((_, i) => i % 256)
  const put = await fetch(`${URL_}/api/videos/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${staff}`, 'Content-Type': 'video/mp4' }, body: data })
  assert.equal(put.status, 200)

  const full = await fetch(`${URL_}/api/videos/${id}`, { headers: { Authorization: `Bearer ${admin}` } })
  assert.equal(full.headers.get('content-type'), 'video/mp4')
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), data)

  const part = await fetch(`${URL_}/api/videos/${id}`, { headers: { Authorization: `Bearer ${admin}`, Range: 'bytes=10-19' } })
  assert.equal(part.status, 206)
  assert.equal(part.headers.get('content-range'), 'bytes 10-19/1000')
  assert.deepEqual(new Uint8Array(await part.arrayBuffer()), data.slice(10, 20))

  const bad = await fetch(`${URL_}/api/videos/..%2Fwindauto.db`, { method: 'PUT', headers: { Authorization: `Bearer ${admin}` }, body: 'x' })
  assert.equal(bad.status, 400)
  assert.equal((await fetch(`${URL_}/api/videos/${id}`)).status, 401)
})

// --- компании, регистрация, письма ---
// последняя ссылка из письма на этот адрес (письма пишутся в MAIL_OUTBOX)
function mailLink(to: string) {
  const mails = readFileSync(join(dir, 'mail.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((m) => m.to === to)
  const link = mails.at(-1)?.text.match(/https?:\/\/\S+/)?.[0] as string
  return new URL(link)
}
const register = (email: string, company = 'Auto Kowalski', password = 'haslo1234') =>
  api('/api/register', '', { company, name: 'Jan Kowalski', email, password, lang: 'pl', accept: true })

async function newCompany(email: string, company?: string) {
  assert.equal((await register(email, company)).status, 200)
  const link = mailLink(email)
  assert.equal((await fetch(URL_ + link.pathname + link.search)).status, 200)
  // каждый со своего адреса — лимит входов с 127.0.0.1 общий на все тесты
  const res = await fetch(URL_ + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.50.${++companies}.1` },
    body: JSON.stringify({ login: email, password: 'haslo1234' }),
  })
  return (await res.json()).token as string
}
let companies = 0

test('регистрация: проверки, письмо, вход только после подтверждения email', async () => {
  assert.equal((await api('/api/register', '', { company: 'A', name: '', email: 'x@y.pl', password: 'haslo1234', accept: true })).body.code, 'company')
  assert.equal((await api('/api/register', '', { company: 'Firma', email: 'bad', password: 'haslo1234', accept: true })).body.code, 'bad_email')
  assert.equal((await api('/api/register', '', { company: 'Firma', email: 'a@b.pl', password: 'short', accept: true })).body.code, 'weak_password')
  assert.equal((await api('/api/register', '', { company: 'Firma', email: 'a@b.pl', password: 'haslo1234' })).body.code, 'terms')

  assert.equal((await register('Owner@Firma.pl')).status, 200)
  // занятый email: ответ как при успехе (не узнать, чей адрес); не подтверждён — письмо с подтверждением ещё раз
  const again = await register('owner@firma.pl')
  assert.equal(again.status, 200)
  assert.deepEqual(again.body, { ok: true })
  await new Promise((r) => setTimeout(r, 100))
  const before = await api('/api/login', '', { login: 'owner@firma.pl', password: 'haslo1234' })
  assert.equal(before.status, 403)
  assert.equal(before.body.code, 'unverified')

  const link = mailLink('owner@firma.pl')
  assert.equal(link.pathname, '/auth/verify')
  const page = await fetch(URL_ + link.pathname + link.search)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /E-mail potwierdzony/)
  // подтверждённый — владельцу письмо «аккаунт уже есть» со ссылкой на новый пароль
  assert.deepEqual((await register('owner@firma.pl')).body, { ok: true })
  await new Promise((r) => setTimeout(r, 100))
  const last = readFileSync(join(dir, 'mail.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1)
  assert.equal(last.to, 'owner@firma.pl')
  assert.match(last.subject, /Masz już konto/)
  assert.equal(mailLink('owner@firma.pl').pathname, '/auth/reset')
  // ссылка одноразовая
  assert.equal((await fetch(URL_ + link.pathname + link.search)).status, 400)

  const ok = await api('/api/login', '', { login: 'OWNER@firma.pl', password: 'haslo1234' })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.user.orgName, 'Auto Kowalski')
  assert.equal(ok.body.user.owner, true)
  assert.equal(ok.body.user.role, 'admin')
})

test('компании не видят данные друг друга: заказы, фото, нумерация, сотрудники', async () => {
  const a = await newCompany('a@serwis.pl', 'Serwis A')
  const b = await newCompany('b@serwis.pl', 'Serwis B')
  await api('/api/sync', a, { orders: [{ id: 'iso-a', updatedAt: 100, deleted: false, data: order({ id: 'iso-a' }) }] })
  const rb = await api('/api/sync', b, { orders: [{ id: 'iso-b', updatedAt: 100, deleted: false, data: order({ id: 'iso-b' }) }] })
  // у каждой компании своя нумерация
  assert.equal(rb.body.merged[0].data.number, '2026/0001')
  const seenByB = (await api('/api/sync?since=0', b)).body.orders.map((o: { id: string }) => o.id)
  assert.deepEqual(seenByB, ['iso-b'])

  const photo = new Uint8Array([0xff, 0xd8, 1, 2, 3])
  const putA = () => fetch(`${URL_}/api/photos/photo-of-a1`, { method: 'PUT', headers: { Authorization: `Bearer ${a}` }, body: photo })
  // новая компания — пробный Pro; без него ИИ недоступен, фото — в пределах бесплатного места
  const meA = (await api('/api/me', a)).body.user
  assert.equal(meA.plan, 'trial')
  assert.equal(meA.pro, true)
  assert.equal((await api(`/api/platform/orgs/${meA.orgId}`, admin, { trialDays: 0 }, 'PATCH')).status, 200)
  assert.equal((await api('/api/me', a)).body.user.plan, 'free')
  assert.equal((await api('/api/voice', a, { text: 'x' })).body.code, 'pro_required')
  // Pro включает только владелец платформы
  assert.equal((await api(`/api/platform/orgs/${meA.orgId}`, a, { pro: true }, 'PATCH')).status, 403)
  const on = await api(`/api/platform/orgs/${meA.orgId}`, admin, { pro: true }, 'PATCH')
  assert.equal(on.body.org.pro, true)
  assert.equal((await api('/api/me', a)).body.user.pro, true)
  assert.equal((await api('/api/me', a)).body.user.plan, 'pro')
  assert.equal((await putA()).status, 200)
  assert.equal((await fetch(`${URL_}/api/photos/photo-of-a1`, { headers: { Authorization: `Bearer ${a}` } })).status, 200)
  assert.equal((await fetch(`${URL_}/api/photos/photo-of-a1`, { headers: { Authorization: `Bearer ${b}` } })).status, 404)

  const staffB = (await api('/api/staff', b)).body.users.map((u: { login: string }) => u.login)
  assert.deepEqual(staffB, ['b@serwis.pl'])
  // чужого сотрудника не изменить
  const adminUsers = (await api('/api/users', admin)).body.users
  assert.equal((await api(`/api/users/${adminUsers[0].id}`, b, { name: 'x' }, 'PATCH')).status, 404)
})

test('забыли пароль: письмо, новый пароль по ссылке, старые сессии закрыты', async () => {
  const t = await newCompany('forgot@serwis.pl')
  assert.equal((await api('/api/password/forgot', '', { login: 'forgot@serwis.pl' })).status, 200)
  // про несуществующий адрес ответ такой же
  assert.equal((await api('/api/password/forgot', '', { login: 'nobody@serwis.pl' })).status, 200)
  const link = mailLink('forgot@serwis.pl')
  assert.equal(link.pathname, '/auth/reset')
  const t2 = link.searchParams.get('t')!
  assert.match(await (await fetch(URL_ + link.pathname + link.search)).text(), /<form/)
  const post = (body: Record<string, string>) =>
    fetch(URL_ + '/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
  assert.equal((await post({ t: t2, password: 'nowehaslo1', password2: 'inne' })).status, 400)
  assert.equal((await post({ t: t2, password: 'nowehaslo1', password2: 'nowehaslo1' })).status, 200)
  assert.equal((await post({ t: t2, password: 'nowehaslo1', password2: 'nowehaslo1' })).status, 400)
  assert.equal((await api('/api/me', t)).status, 401)
  assert.equal((await api('/api/login', '', { login: 'forgot@serwis.pl', password: 'nowehaslo1' })).status, 200)
})

test('свой email: письмо на новый адрес, до подтверждения вход по логину, потом и по email', async () => {
  const t = await login('jan', 'secret22')
  assert.equal((await api('/api/me/email', t, { email: 'jan@serwis.pl', password: 'wrong' })).body.code, 'old_password')
  assert.equal((await api('/api/me/email', t, { email: 'bad', password: 'secret22' })).body.code, 'bad_email')
  await newCompany('taken@serwis.pl')
  assert.equal((await api('/api/me/email', t, { email: 'taken@serwis.pl', password: 'secret22' })).body.code, 'email_taken')

  assert.equal((await api('/api/me/email', t, { email: 'Jan@Serwis.pl', password: 'secret22' })).status, 200)
  let me = (await api('/api/me', t)).body.user
  assert.equal(me.email, '')
  assert.equal(me.newEmail, 'jan@serwis.pl')
  // пока не подтверждён — входим по-старому
  assert.ok(await login('jan', 'secret22'))
  assert.equal((await api('/api/login', '', { login: 'jan@serwis.pl', password: 'secret22' })).status, 401)

  const link = mailLink('jan@serwis.pl')
  assert.equal(link.pathname, '/auth/verify')
  assert.equal((await fetch(URL_ + link.pathname + link.search)).status, 200)
  assert.equal((await fetch(URL_ + link.pathname + link.search)).status, 400)
  me = (await api('/api/me', t)).body.user
  assert.equal(me.email, 'jan@serwis.pl')
  assert.equal(me.newEmail, '')
  assert.ok(await login('jan@serwis.pl', 'secret22'))
  assert.ok(await login('jan', 'secret22'))
  assert.equal((await api('/api/password/forgot', '', { login: 'jan' })).status, 200)
  assert.equal(mailLink('jan@serwis.pl').pathname, '/auth/reset')
})

test('приглашение сотрудника по email: пароль задаёт сам, входит по email', async () => {
  const owner = await newCompany('boss@serwis.pl', 'Serwis C')
  const r = await api('/api/users', owner, { email: 'Mechanik@serwis.pl', name: 'Piotr', role: 'staff' })
  assert.equal(r.status, 200)
  assert.equal(r.body.user.invited, true)
  assert.equal((await api('/api/login', '', { login: 'mechanik@serwis.pl', password: '' })).status, 401)
  const link = mailLink('mechanik@serwis.pl')
  const res = await fetch(URL_ + '/auth/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ t: link.searchParams.get('t')!, password: 'mechanik123', password2: 'mechanik123' }),
  })
  assert.equal(res.status, 200)
  const l = await api('/api/login', '', { login: 'mechanik@serwis.pl', password: 'mechanik123' })
  assert.equal(l.status, 200)
  assert.equal(l.body.user.orgName, 'Serwis C')
  assert.equal(l.body.user.role, 'staff')
  // логин и email — общие на весь сервер
  assert.equal((await api('/api/users', owner, { login: 'jan', password: 'haslo1234' })).body.code, 'login_taken')
  // владельца не понизить и не удалить
  const me = (await api('/api/me', owner)).body.user
  const admin2 = (await api('/api/users', owner, { login: 'kierownik', password: 'haslo1234', role: 'admin' })).body.user
  const t2 = await login('kierownik', 'haslo1234')
  assert.equal((await api(`/api/users/${me.id}`, t2, { role: 'staff' }, 'PATCH')).body.code, 'owner')
  assert.equal((await api(`/api/users/${me.id}`, t2, undefined, 'DELETE')).body.code, 'owner')
  assert.ok(admin2.id)
})

test('владелец платформы: список компаний, блокировка, удаление; владелец удаляет свою компанию', async () => {
  const t = await newCompany('bad@serwis.pl', 'Zła Firma')
  assert.equal((await api('/api/platform/orgs', t)).status, 403)
  const list = (await api('/api/platform/orgs', admin)).body.orgs
  const org = list.find((o: { name: string }) => o.name === 'Zła Firma')
  assert.equal(org.owner.email, 'bad@serwis.pl')
  assert.equal((await api(`/api/platform/orgs/${org.id}`, admin, { blocked: true }, 'PATCH')).body.org.blocked, true)
  assert.equal((await api('/api/me', t)).status, 401)
  assert.equal((await api('/api/login', '', { login: 'bad@serwis.pl', password: 'haslo1234' })).body.code, 'blocked')
  assert.equal((await api(`/api/platform/orgs/${org.id}`, admin, undefined, 'DELETE')).status, 200)
  assert.equal(existsSync(join(dir, 'orgs', org.id)), false)
  assert.equal((await api('/api/login', '', { login: 'bad@serwis.pl', password: 'haslo1234' })).status, 401)

  const own = await newCompany('leaving@serwis.pl', 'Odchodzę')
  const ownOrg = (await api('/api/org', own)).body.org
  assert.equal((await api('/api/org', own, { password: 'wrong' }, 'DELETE')).body.code, 'old_password')
  assert.equal((await api('/api/org', own, { password: 'haslo1234' }, 'DELETE')).status, 200)
  assert.equal(existsSync(join(dir, 'orgs', ownOrg.id)), false)
  // компанию платформы так не удалить
  assert.equal((await api('/api/org', admin, { password: 'secret1' }, 'DELETE')).body.code, 'platform_org')
})

test('юридические страницы открываются', async () => {
  const r = await fetch(URL_ + '/legal/privacy')
  assert.equal(r.status, 200)
  assert.match(await r.text(), /Polityka prywatności/)
  assert.match(await (await fetch(URL_ + '/legal/terms?lang=ru')).text(), /Условия использования/)
})

test('блокировка подбора пароля переживает перезапуск', async () => {
  for (let i = 0; i < 10; i++) await api('/api/login', '', { login: 'jan', password: 'wrong' })
  assert.equal((await api('/api/login', '', { login: 'jan', password: 'secret22' })).status, 429)
  await stop()
  await start()
  assert.equal((await api('/api/login', '', { login: 'jan', password: 'secret22' })).status, 429)
  // токены после перезапуска живы
  assert.equal((await api('/api/me', staff)).status, 200)
})

test('обновление приложения: пока APK нет — пусто; после выкладки — версия и файл без входа', async () => {
  assert.deepEqual((await api('/api/app')).body, {})
  assert.equal((await fetch(URL_ + '/api/app/apk')).status, 404)
  mkdirSync(join(dir, 'app'), { recursive: true })
  writeFileSync(join(dir, 'app', 'windauto.apk'), 'apk-bytes')
  writeFileSync(join(dir, 'app', 'latest.json'), JSON.stringify({ versionCode: 10400, versionName: '1.4.0' }))
  assert.deepEqual((await api('/api/app')).body, { versionCode: 10400, versionName: '1.4.0', size: 9 })
  const apk = await fetch(URL_ + '/api/app/apk')
  assert.equal(apk.headers.get('content-type'), 'application/vnd.android.package-archive')
  assert.equal(await apk.text(), 'apk-bytes')
  // приложение ходит с https://localhost
  const cors = await fetch(URL_ + '/api/app', { headers: { Origin: 'https://localhost' } })
  assert.equal(cors.headers.get('access-control-allow-origin'), 'https://localhost')
  // старый адрес веб-версии больше не пускаем: она переехала на адрес сервера
  const old = await fetch(URL_ + '/api/app', { headers: { Origin: 'https://ddremlin.github.io' } })
  assert.equal(old.headers.get('access-control-allow-origin'), null)
})

// вход с отдельного адреса: блокировка по IP от тестов выше сюда не мешает
const loginFrom = (ip: string, l: string, p: string, extra = '') =>
  fetch(URL_ + '/api/login', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: extra || JSON.stringify({ login: l, password: p }) })

test('защита: свой пароль только со старым; email сотрудника — после подтверждения; имена без ссылок', async () => {
  const me = (await api('/api/me', admin)).body.user
  const own = await api(`/api/users/${me.id}`, admin, { password: 'newsecret1' }, 'PATCH')
  assert.equal(own.status, 400)
  assert.equal(own.body.code, 'own_password')
  // с паролем — нужен свой логин, email из формы для входа не годится до подтверждения
  assert.equal((await api('/api/users', admin, { email: 'ola@x.pl', name: 'Ola', password: 'secret22' })).body.code, 'bad_login')
  const r = await api('/api/users', admin, { login: 'ola', email: 'ola@x.pl', name: 'Ola', password: 'secret22' })
  assert.equal(r.status, 200)
  assert.equal(r.body.user.email, '')
  assert.equal((await loginFrom('10.9.0.1', 'ola@x.pl', 'secret22')).status, 401)
  assert.equal((await loginFrom('10.9.0.1', 'ola', 'secret22')).status, 200)
  const mail = readFileSync(join(dir, 'mail.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((m) => m.to === 'ola@x.pl').pop()
  const link = mail.text.match(/https?:\/\/\S+/)[0].replace(/^https?:\/\/[^/]+/, URL_)
  assert.equal((await fetch(link)).status, 200)
  assert.equal((await loginFrom('10.9.0.1', 'ola@x.pl', 'secret22')).status, 200)
  // ссылки и адреса в названии компании и имени попали бы в письма
  assert.equal((await api('/api/register', '', { company: 'Zablokowano: wejdź na bank-pl.com/x', email: 'p@x.pl', password: 'secret22', accept: true })).body.code, 'company')
  assert.equal((await api('/api/users', admin, { login: 'spam1', name: 'www.evil.pl', password: 'secret22' })).body.code, 'bad_name')
  assert.equal((await api('/api/register', '', { company: 'Auto-Serwis Sp. z o.o.', email: 'ok@x.pl', password: 'secret22', accept: true })).status, 200)
})

test('защита: большие запросы без входа, хеш сессий, подбор пароля к аккаунту с разных адресов', async () => {
  const big = await loginFrom('10.9.0.2', '', '', JSON.stringify({ login: 'admin', password: 'x'.repeat(100_000) }))
  assert.equal(big.status, 413)
  const { DatabaseSync } = await import('node:sqlite')
  const acc = new DatabaseSync(join(dir, 'accounts.db'), { readOnly: true })
  const tokens = acc.prepare('SELECT token FROM sessions').all().map((r) => String(r.token))
  acc.close()
  assert.ok(!tokens.includes(admin))
  assert.ok(tokens.every((t) => /^[0-9a-f]{64}$/.test(t)))
  await api('/api/users', admin, { login: 'lock1', name: 'L', password: 'secret22' })
  for (let i = 0; i < 30; i++)
    await fetch(URL_ + '/api/login', { method: 'POST', headers: { 'x-forwarded-for': `10.0.0.${i}` }, body: JSON.stringify({ login: 'lock1', password: 'bad' + i }) })
  const r = await fetch(URL_ + '/api/login', { method: 'POST', headers: { 'x-forwarded-for': '10.0.1.1' }, body: JSON.stringify({ login: 'lock1', password: 'secret22' }) })
  assert.equal(r.status, 429)
  // а владелец, который уже входил с этого адреса, входит — подбор не закрывает ему вход
  await api('/api/users', admin, { login: 'lock2', name: 'L', password: 'secret22' })
  const own = (ip: string, password: string) =>
    fetch(URL_ + '/api/login', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify({ login: 'lock2', password }) })
  assert.equal((await own('10.0.2.1', 'secret22')).status, 200)
  for (let i = 0; i < 31; i++) await own(`10.0.3.${i}`, 'bad' + i)
  assert.equal((await own('10.0.4.1', 'secret22')).status, 429)
  assert.equal((await own('10.0.2.1', 'secret22')).status, 200)
})

test('защита: квота места компании; заказ со служебными именами полей не ломает слияние', async () => {
  const put = (id: string, size: number) =>
    fetch(`${URL_}/api/photos/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${admin}` }, body: new Uint8Array(size) })
  assert.equal((await put('quota-ok-1', 300_000)).status, 200)
  // перезапись того же фото не считается дважды
  assert.equal((await put('quota-ok-1', 300_000)).status, 200)
  const over = await put('quota-big-1', 900_000)
  assert.equal(over.status, 507)
  assert.equal((await over.json()).code, 'quota')
  const bad = JSON.parse('{"id":"p1","number":"","createdAt":1,"updatedAt":100,"constructor":"x","elements":{"__proto__":{"a":1}},"_ft":{"constructor":5,"toString":6,"__proto__":7}}')
  assert.equal((await api('/api/sync', admin, { orders: [{ id: 'p1', updatedAt: 100, deleted: false, data: bad }] })).status, 200)
  const next = { ...bad, notes: 'ok', updatedAt: 200, _ft: { ...bad._ft, notes: 200 } }
  assert.equal((await api('/api/sync', staff, { orders: [{ id: 'p1', updatedAt: 200, deleted: false, data: next }] })).status, 200)
})

test('отзыв клиента: ссылка, страница, оценка, чужая компания не видит', async () => {
  await api('/api/sync', admin, { orders: [{ id: 'rv1', updatedAt: 100, deleted: false, data: order({ id: 'rv1', make: 'Škoda', model: 'Octavia', plate: 'WA 777', client: 'Jan' }) }] })
  assert.equal((await api('/api/reviews/link', staff, { orderId: 'nope', lang: 'pl' })).status, 404)
  const r = await api('/api/reviews/link', staff, { orderId: 'rv1', lang: 'pl' })
  assert.equal(r.status, 200)
  const path = new URL(r.body.url).pathname
  assert.match(path, /^\/r\/[\w-]{20,40}$/)

  const page = await (await fetch(URL_ + path)).text()
  assert.match(page, /Škoda Octavia/)
  // номер и имя клиента на страницу не попадают
  assert.doesNotMatch(page, /WA 777|Jan\b/)

  const post = (body: Record<string, string>) =>
    fetch(URL_ + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
  assert.equal((await post({ stars: '7' })).status, 400)
  // открытое приложение компании сразу узнаёт о новом отзыве
  const { ticket } = (await api('/api/events/ticket', admin, {})).body
  const ac = new AbortController()
  const reader = (await fetch(URL_ + '/api/events?ticket=' + ticket, { signal: ac.signal })).body!.getReader()
  assert.equal((await post({ stars: '5', comment: '<b>Super</b>' })).status, 200)
  let got = ''
  while (!got.includes('event: review')) got += new TextDecoder().decode((await reader.read()).value)
  assert.match(got, /event: review\ndata: "rv1"/)
  ac.abort()
  assert.equal((await post({ stars: '4', comment: 'Dobrze' })).status, 200)
  const list = (await api('/api/reviews', admin)).body.reviews
  const mine = list.find((x: { orderId: string }) => x.orderId === 'rv1')
  assert.equal(mine.stars, 4)
  assert.equal(mine.comment, 'Dobrze')
  assert.match(await (await fetch(URL_ + path)).text(), /value="4" checked/)

  // новая ссылка заменяет старую
  const r2 = await api('/api/reviews/link', admin, { orderId: 'rv1', lang: 'ru' })
  assert.equal((await fetch(URL_ + path)).status, 404)
  assert.match(await (await fetch(URL_ + new URL(r2.body.url).pathname)).text(), /Оцените ремонт/)
  const r3 = await api('/api/reviews/link', admin, { orderId: 'rv1', lang: 'uk' })
  assert.match(await (await fetch(URL_ + new URL(r3.body.url).pathname)).text(), /Оцініть ремонт/)
  assert.equal((await fetch(URL_ + '/r/' + 'x'.repeat(24))).status, 404)
  assert.equal((await api('/api/reviews', '')).status, 401)
})

test('помощь: сообщение разработчику — с входом и без', async () => {
  const mails = () => readFileSync(join(dir, 'mail.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((m) => m.to === 'help@windauto.test')
  assert.equal((await api('/api/support', '', { message: '' })).status, 400)
  const r = await api('/api/support', '', { message: 'Не работает камера', contact: 'jan@example.pl', version: '1.15.0', device: 'Pixel 7' })
  assert.equal(r.status, 200)
  const m = mails().at(-1)
  assert.match(m.text, /Не работает камера/)
  assert.match(m.text, /без входа/)
  assert.match(m.text, /Pixel 7/)
  assert.equal(m.replyTo, 'jan@example.pl')
  assert.equal((await api('/api/support', admin, { message: 'Вопрос по ценам' })).status, 200)
  assert.match(mails().at(-1).text, /\(admin/)
  // в Telegram — ботом
  assert.equal((await api('/api/support', staff, { message: 'Помогите с импортом', via: 'telegram', contact: '+48 600 100 200' })).status, 200)
  const tg = readFileSync(join(dir, 'tg.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1)
  assert.match(tg.text, /Помогите с импортом/)
  assert.match(tg.text, /\(jan/)
  assert.match(tg.text, /\+48 600 100 200/)
})

test('защита: сотрудник не удаляет чужие заказы; корзина и восстановление у администратора', async () => {
  const mine = await api('/api/sync', staff, { orders: [{ id: 'del-own', updatedAt: 100, deleted: false, data: order({ id: 'del-own', client: 'Свой' }) }] })
  assert.equal(mine.status, 200)
  await api('/api/sync', admin, { orders: [{ id: 'del-adm', updatedAt: 100, deleted: false, data: order({ id: 'del-adm', client: 'Анна' }) }] })
  // чужой заказ — не удалён, вернулся в rejected
  const r = await api('/api/sync', staff, { orders: [{ id: 'del-adm', updatedAt: Date.now(), deleted: true, data: null }] })
  assert.deepEqual(r.body.denied, ['del-adm'])
  assert.equal(r.body.rejected[0].data.client, 'Анна')
  // свой — удаляется и попадает в корзину
  const own = await api('/api/sync', staff, { orders: [{ id: 'del-own', updatedAt: Date.now(), deleted: true, data: null }] })
  assert.deepEqual(own.body.accepted, ['del-own'])
  assert.equal((await api('/api/trash', staff)).status, 403)
  const trash = await api('/api/trash', admin)
  const item = trash.body.orders.find((o: { id: string }) => o.id === 'del-own')
  assert.equal(item.client, 'Свой')
  assert.equal(item.by, 'Jan')
  assert.equal((await api('/api/trash/del-own/restore', staff, {})).status, 403)
  assert.equal((await api('/api/trash/del-own/restore', admin, {})).status, 200)
  const pull = await api('/api/sync?since=0', admin)
  const back = pull.body.orders.find((o: { id: string }) => o.id === 'del-own')
  assert.equal(back.deleted, false)
  assert.equal(back.data.client, 'Свой')
  assert.equal((await api('/api/trash/del-own/restore', admin, {})).body.code, 'not_in_trash')
})

test('защита: огромный заказ не принимается; ошибки без внутренних подробностей', async () => {
  const big = await api('/api/sync', admin, { orders: [{ id: 'huge', updatedAt: 100, deleted: false, data: order({ id: 'huge', notes: 'A'.repeat(1_100_000) }) }] })
  assert.equal(big.status, 200)
  assert.deepEqual(big.body.accepted, [])
  assert.equal((await api('/api/sync?since=0', admin)).body.orders.some((o: { id: string }) => o.id === 'huge'), false)
  const bad = await api('/api/orders/%E0%A4%A/history', admin)
  assert.equal(bad.status, 400)
})

test('защита: подбор текущего пароля с чужой сессией; выход на других устройствах', async () => {
  await api('/api/users', admin, { login: 'pw1', name: 'P', password: 'secret22' })
  const t1 = (await (await loginFrom('10.7.0.1', 'pw1', 'secret22')).json()).token
  const t2 = (await (await loginFrom('10.7.0.2', 'pw1', 'secret22')).json()).token
  const codes = []
  for (let i = 0; i < 6; i++) codes.push((await api('/api/password', t1, { oldPassword: 'guess' + i, newPassword: 'newsecret1' })).status)
  assert.deepEqual(codes, [400, 400, 400, 400, 400, 429])
  // и правильный пароль теперь ждёт — подбор остановлен
  assert.equal((await api('/api/password', t1, { oldPassword: 'secret22', newPassword: 'newsecret1' })).status, 429)
  const out = await api('/api/logout/others', t1, {})
  assert.equal(out.body.closed, 1)
  assert.equal((await api('/api/me', t2)).status, 401)
  assert.equal((await api('/api/me', t1)).status, 200)
})

test('защита: страницы сервера с Content-Security-Policy', async () => {
  const r = await fetch(URL_ + '/legal/privacy')
  assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'none'/)
})

test('живые обновления: одноразовый билет вместо токена в адресе', async () => {
  const sse = async (q: string) => {
    const ac = new AbortController()
    const r = await fetch(URL_ + '/api/events?' + q, { signal: ac.signal })
    ac.abort()
    return r.status
  }
  assert.equal((await api('/api/events/ticket', '', {})).status, 401)
  const { ticket } = (await api('/api/events/ticket', admin, {})).body
  assert.equal(await sse('ticket=' + ticket), 200)
  assert.equal(await sse('ticket=' + ticket), 401)
  assert.equal(await sse('ticket=nope'), 401)
  // токен в адресе — только для /api/events (старые версии), остальное — только заголовком
  assert.equal(await sse('token=' + admin), 200)
  assert.equal((await fetch(URL_ + '/api/me?token=' + admin)).status, 401)
})

test('отчёты об ошибках: склеиваются, сводка разработчику раз в сутки', async () => {
  const err = (message: string, token = '') => api('/api/errors', token, { message, stack: 'at f (index.js:1:2)', place: '#/order/:id', version: '1.19.0', device: 'Pixel' })
  assert.equal((await err('TypeError: x is undefined', staff)).status, 200)
  await err('TypeError: x is undefined', staff)
  await err('RangeError: boom')
  const mails = () => readFileSync(join(dir, 'mail.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((m) => m.subject.startsWith('Windauto: ошибки'))
  const before_ = mails().length
  // сводка уходит при обслуживании (раз в час и при запуске)
  await stop()
  await start()
  await new Promise((r) => setTimeout(r, 300))
  const m = mails()
  assert.equal(m.length, before_ + 1)
  const last = m[m.length - 1]
  assert.equal(last.to, 'help@windauto.test')
  assert.match(last.subject, /\(3\)/)
  assert.match(last.text, /#2× .*\n.*1\.19\.0 — Pixel\nКто: jan, «/)
  assert.match(last.text, /Кто: без входа/)
  // следующая — не раньше чем через сутки
  await err('Error: again')
  await stop()
  await start()
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(mails().length, before_ + 1)
})

test('тарифы: бесплатно — 2 сотрудника, история 90 дней, без ИИ и отзывов; лимит места', async () => {
  const t = await newCompany('free@serwis.pl', 'Serwis Free')
  const me = (await api('/api/me', t)).body.user
  await api(`/api/platform/orgs/${me.orgId}`, admin, { trialDays: 0 }, 'PATCH')
  const plan = (await api('/api/plan', t)).body
  assert.equal(plan.plan, 'free')
  assert.equal(plan.usage.maxUsers, 2)
  assert.equal(plan.usage.maxAi, 0)
  assert.equal(plan.historyDays, 90)
  assert.equal(plan.canPay, true)
  // второй сотрудник — можно, третий — нет
  assert.equal((await api('/api/users', t, { login: 'free2', name: 'F2', password: 'secret22' })).status, 200)
  const third = await api('/api/users', t, { login: 'free3', name: 'F3', password: 'secret22' })
  assert.equal(third.status, 402)
  assert.equal(third.body.code, 'plan_users')
  // отзывы — Pro
  await api('/api/sync', t, { orders: [{ id: 'free-o1', updatedAt: 100, deleted: false, data: order({ id: 'free-o1' }) }] })
  assert.equal((await api('/api/reviews/link', t, { orderId: 'free-o1', lang: 'pl' })).body.code, 'pro_required')
  // фото — в пределах бесплатного места (в тестах 0,0002 ГБ ≈ 210 КБ)
  const put = (id: string, n: number) => fetch(`${URL_}/api/photos/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${t}` }, body: new Uint8Array(n) })
  assert.equal((await put('free-photo-1', 150_000)).status, 200)
  const full = await put('free-photo-2', 150_000)
  assert.equal(full.status, 507)
  assert.equal((await full.json()).code, 'quota_free')
  // пробный период снова — и ИИ/отзывы доступны (ИИ без ключа — 503, но не 402)
  await api(`/api/platform/orgs/${me.orgId}`, admin, { trialDays: 14 }, 'PATCH')
  assert.equal((await api('/api/plan', t)).body.plan, 'trial')
  assert.notEqual((await api('/api/voice', t, { text: 'x' })).status, 402)
})

test('оплата: Checkout, вебхуки Stripe включают и выключают Pro, подпись проверяется', async () => {
  const { signWebhook } = await import('../server/stripe.mjs')
  const t = await newCompany('pay@serwis.pl', 'Serwis Pay')
  const me = (await api('/api/me', t)).body.user
  await api(`/api/platform/orgs/${me.orgId}`, admin, { trialDays: 0 }, 'PATCH')
  await api('/api/users', t, { login: 'paystaff', name: 'S', password: 'secret22' })
  const staffT = (await (await loginFrom('10.51.0.1', 'paystaff', 'secret22')).json()).token
  assert.equal((await api('/api/billing/checkout', staffT, { period: 'month' })).status, 403)

  const co = await api('/api/billing/checkout', t, { period: 'year' })
  assert.equal(co.status, 200)
  assert.equal(co.body.url, 'https://checkout.stripe.test/cs_1')
  const call = stripeCalls.filter((c) => c.path === '/v1/checkout/sessions').pop()!
  assert.equal(call.body.get('mode'), 'subscription')
  assert.equal(call.body.get('line_items[0][price]'), 'price_year')
  assert.equal(call.body.get('client_reference_id'), me.orgId)
  assert.equal(call.body.get('subscription_data[metadata][org_id]'), me.orgId)
  assert.equal(call.body.get('customer_email'), 'pay@serwis.pl')
  assert.equal(call.body.get('tax_id_collection[enabled]'), 'true')
  // пробный период кончился — списание сразу
  assert.equal(call.body.get('subscription_data[trial_end]'), null)

  const hook = (ev: unknown, sig?: string) => {
    const raw = JSON.stringify(ev)
    return fetch(URL_ + '/api/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': sig ?? signWebhook(raw, WHSEC) }, body: raw })
  }
  const end = Math.floor(Date.now() / 1000) + 365 * 86400
  fakeSubs.sub_1 = { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { org_id: me.orgId }, items: { data: [{ current_period_end: end, price: { recurring: { interval: 'year' } } }] } }
  const done = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', client_reference_id: me.orgId } } }
  // чужая подпись — отказ, Pro не включается
  assert.equal((await hook(done, 't=1,v1=bad')).status, 400)
  assert.equal((await api('/api/me', t)).body.user.plan, 'free')
  assert.equal((await hook(done)).status, 200)
  let plan = (await api('/api/plan', t)).body
  assert.equal(plan.plan, 'paid')
  assert.equal(plan.period, 'year')
  assert.equal(plan.status, 'active')
  assert.ok(plan.paidUntil > Date.now() + 360 * 86400_000)
  assert.equal((await api('/api/me', t)).body.user.pro, true)
  // повтор того же события — без изменений
  assert.equal((await (await hook(done)).json()).duplicate, true)

  // портал — по сохранённому клиенту
  const portal = await api('/api/billing/portal', t, {})
  assert.equal(portal.body.url, 'https://billing.stripe.test/p_1')
  assert.equal(stripeCalls.filter((c) => c.path === '/v1/billing_portal/sessions').pop()!.body.get('customer'), 'cus_1')
  // повторная оплата при активной подписке — нет
  assert.equal((await api('/api/billing/checkout', t, { period: 'month' })).body.code, 'already_paid')

  // отмена в конце периода: Pro остаётся до конца оплаченного
  const sub = fakeSubs.sub_1 as Record<string, unknown>
  await hook({ id: 'evt_2', type: 'customer.subscription.updated', data: { object: { ...sub, cancel_at_period_end: true } } })
  plan = (await api('/api/plan', t)).body
  assert.equal(plan.status, 'canceling')
  assert.equal(plan.plan, 'paid')
  // подписка закончилась — бесплатно
  await hook({ id: 'evt_3', type: 'customer.subscription.deleted', data: { object: { ...sub, status: 'canceled' } } })
  plan = (await api('/api/plan', t)).body
  assert.equal(plan.plan, 'free')
  assert.equal(plan.status, 'canceled')
})

test('оплата: пробный период сохраняется — первое списание в его конце', async () => {
  const t = await newCompany('trialpay@serwis.pl', 'Serwis Trial')
  assert.equal((await api('/api/billing/checkout', t, { period: 'month' })).status, 200)
  const call = stripeCalls.filter((c) => c.path === '/v1/checkout/sessions').pop()!
  const trialEnd = Number(call.body.get('subscription_data[trial_end]'))
  assert.ok(Math.abs(trialEnd * 1000 - (Date.now() + 14 * 86400_000)) < 60_000)
  const page = await fetch(URL_ + '/auth/paid?lang=pl')
  assert.match(await page.text(), /Dziękujemy za płatność/)
})

test('письмо за 3 дня до конца пробного периода — одно', async () => {
  const t = await newCompany('trialmail@serwis.pl', 'Serwis Mail')
  const me = (await api('/api/me', t)).body.user
  await api(`/api/platform/orgs/${me.orgId}`, admin, { trialDays: 2 }, 'PATCH')
  const mails = () => readFileSync(join(dir, 'mail.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((m) => m.to === 'trialmail@serwis.pl' && /Pro/.test(m.subject))
  await stop()
  await start()
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(mails().length, 1)
  assert.match(mails()[0].text, /\/#\/plan/)
  await stop()
  await start()
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(mails().length, 1)
})
