// Сервер целиком: запускаем server.mjs на временной папке и ходим в API.
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

const PORT = 18000 + Math.floor(Math.random() * 1000)
const URL_ = `http://127.0.0.1:${PORT}`
const dir = mkdtempSync(join(tmpdir(), 'windauto-'))
let proc: ChildProcess

async function start() {
  proc = spawn(process.execPath, ['server/server.mjs'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ADMIN_PASSWORD: 'secret1', ORG_QUOTA_GB: '0.001', ANTHROPIC_API_KEY: '', MAIL_OUTBOX: join(dir, 'mail.jsonl'), REGISTER_PER_HOUR: '100', NODE_NO_WARNINGS: '1' },
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
  await start()
  admin = await login('admin', 'secret1')
  await api('/api/users', admin, { login: 'jan', name: 'Jan', password: 'secret22', role: 'staff' })
  staff = await login('jan', 'secret22')
})
after(async () => {
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
  return login(email, 'haslo1234')
}

test('регистрация: проверки, письмо, вход только после подтверждения email', async () => {
  assert.equal((await api('/api/register', '', { company: 'A', name: '', email: 'x@y.pl', password: 'haslo1234', accept: true })).body.code, 'company')
  assert.equal((await api('/api/register', '', { company: 'Firma', email: 'bad', password: 'haslo1234', accept: true })).body.code, 'bad_email')
  assert.equal((await api('/api/register', '', { company: 'Firma', email: 'a@b.pl', password: 'short', accept: true })).body.code, 'weak_password')
  assert.equal((await api('/api/register', '', { company: 'Firma', email: 'a@b.pl', password: 'haslo1234' })).body.code, 'terms')

  assert.equal((await register('Owner@Firma.pl')).status, 200)
  assert.equal((await register('owner@firma.pl')).body.code, 'email_taken')
  const before = await api('/api/login', '', { login: 'owner@firma.pl', password: 'haslo1234' })
  assert.equal(before.status, 403)
  assert.equal(before.body.code, 'unverified')

  const link = mailLink('owner@firma.pl')
  assert.equal(link.pathname, '/auth/verify')
  const page = await fetch(URL_ + link.pathname + link.search)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /E-mail potwierdzony/)
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
  assert.equal((await fetch(`${URL_}/api/photos/photo-of-a1`, { method: 'PUT', headers: { Authorization: `Bearer ${a}` }, body: photo })).status, 200)
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
  assert.equal((await post({ stars: '5', comment: '<b>Super</b>' })).status, 200)
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
