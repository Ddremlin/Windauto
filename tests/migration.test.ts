// Переход со старой схемы (одна база data/windauto.db): всё становится первой компанией,
// телефоны остаются подключёнными, заказы, нумерация и фото на месте.
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'
import { scryptSync } from 'node:crypto'

const PORT = 19000 + Math.floor(Math.random() * 1000)
const URL_ = `http://127.0.0.1:${PORT}`
const dir = mkdtempSync(join(tmpdir(), 'windauto-mig-'))
let proc: ChildProcess

// пароль в формате старого сервера
const hash = (p: string) => {
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
  return `${salt.toString('hex')}:${scryptSync(p, salt, 32).toString('hex')}`
}

function legacyData() {
  const db = new DatabaseSync(join(dir, 'windauto.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE users (id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
      pass TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff', disabled INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL);
    CREATE TABLE orders (id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
      rev INTEGER NOT NULL, updated_by TEXT);
    CREATE TABLE shared (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL, rev INTEGER NOT NULL);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, at INTEGER NOT NULL,
      user_id TEXT, action TEXT NOT NULL, changes TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE login_attempts (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, first INTEGER NOT NULL);
  `)
  const t = Date.now()
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, 0, ?)').run('u-admin', 'admin', 'Szef', hash('stare-haslo'), 'admin', t - 1000)
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, 0, ?)').run('u-jan', 'jan', 'Jan', hash('jan-haslo'), 'staff', t)
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run('phone-token', 'u-jan', t, t)
  const o = { id: 'old-1', number: '2026/0007', plate: 'WL 1', createdAt: t, updatedAt: 50, elements: {}, signatures: {} }
  db.prepare('INSERT INTO orders VALUES (?, ?, ?, 0, 3, ?)').run('old-1', JSON.stringify(o), 50, 'u-admin')
  db.prepare("INSERT INTO shared VALUES ('settings', ?, 10, 2)").run(JSON.stringify({ shopName: 'Blacharnia Szefa' }))
  db.prepare("INSERT INTO meta VALUES ('rev', '3'), ('num:2026', '7')").run()
  db.prepare("INSERT INTO history (order_id, at, user_id, action) VALUES ('old-1', ?, 'u-admin', 'create')").run(t)
  db.close()
  mkdirSync(join(dir, 'photos'))
  writeFileSync(join(dir, 'photos', 'old-photo-1.jpg'), 'jpeg')
}

async function start() {
  proc = spawn(process.execPath, ['server/server.mjs'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ANTHROPIC_API_KEY: '', NODE_NO_WARNINGS: '1' },
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

before(async () => {
  legacyData()
  await start()
})
after(async () => {
  await new Promise((r) => (proc.once('exit', r), proc.kill('SIGTERM')))
  rmSync(dir, { recursive: true, force: true })
})

const get = async (path: string, token: string) => {
  const r = await fetch(URL_ + path, { headers: { Authorization: `Bearer ${token}` } })
  return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }
}

test('старые данные переехали в первую компанию', async () => {
  assert.equal(existsSync(join(dir, 'windauto.db')), false)
  assert.equal(existsSync(join(dir, 'photos')), false)

  // телефон сотрудника остался подключён
  const me = await get('/api/me', 'phone-token')
  assert.equal(me.status, 200)
  assert.equal(me.body.user.login, 'jan')
  assert.equal(me.body.user.orgName, 'Blacharnia Szefa')

  const sync = await get('/api/sync?since=0', 'phone-token')
  assert.deepEqual(sync.body.orders.map((o: { id: string }) => o.id), ['old-1'])
  assert.equal(sync.body.settings.data.shopName, 'Blacharnia Szefa')
  assert.equal(sync.body.rev, 3)
  assert.equal((await get('/api/photos/old-photo-1', 'phone-token')).body, 'jpeg')
  assert.equal((await get('/api/orders/old-1/history', 'phone-token')).body.history[0].user, 'Szef')

  // старые пароли работают; администратор — владелец компании и платформы
  const login = await fetch(URL_ + '/api/login', { method: 'POST', body: JSON.stringify({ login: 'admin', password: 'stare-haslo' }) })
  const { token, user } = await login.json()
  assert.equal(user.owner, true)
  assert.equal(user.platform, true)

  // нумерация продолжается
  const o = { id: 'new-1', number: '', createdAt: Date.parse('2026-05-01'), updatedAt: 100, elements: {}, signatures: {} }
  const r = await fetch(URL_ + '/api/sync', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ orders: [{ id: 'new-1', updatedAt: 100, deleted: false, data: o }] }),
  })
  assert.equal((await r.json()).merged[0].data.number, '2026/0008')
})
