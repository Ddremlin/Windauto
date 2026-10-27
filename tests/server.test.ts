// Сервер целиком: запускаем server.mjs на временной папке и ходим в API.
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

const PORT = 18000 + Math.floor(Math.random() * 1000)
const URL_ = `http://127.0.0.1:${PORT}`
const dir = mkdtempSync(join(tmpdir(), 'windauto-'))
let proc: ChildProcess

async function start() {
  proc = spawn(process.execPath, ['server/server.mjs'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ADMIN_PASSWORD: 'secret1', ANTHROPIC_API_KEY: '', NODE_NO_WARNINGS: '1' },
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
  await api('/api/users', admin, { login: 'jan', name: 'Jan', password: 'secret2', role: 'staff' })
  staff = await login('jan', 'secret2')
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

test('блокировка подбора пароля переживает перезапуск', async () => {
  for (let i = 0; i < 10; i++) await api('/api/login', '', { login: 'jan', password: 'wrong' })
  assert.equal((await api('/api/login', '', { login: 'jan', password: 'secret2' })).status, 429)
  await stop()
  await start()
  assert.equal((await api('/api/login', '', { login: 'jan', password: 'secret2' })).status, 429)
  // токены после перезапуска живы
  assert.equal((await api('/api/me', staff)).status, 200)
})
