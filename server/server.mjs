// Windauto — сервер синхронизации.
// Node 24, без внешних зависимостей: node:http + node:sqlite, фото — файлы на диске.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, renameSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = Number(process.env.PORT ?? 8080)
const DATA = process.env.DATA_DIR ?? './data'
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'https://ddremlin.github.io,http://localhost:5173,http://localhost:4173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const MAX_JSON = 20 * 1024 * 1024
const MAX_PHOTO = 15 * 1024 * 1024
const SESSION_DAYS = 180

mkdirSync(join(DATA, 'photos'), { recursive: true })
const db = new DatabaseSync(join(DATA, 'windauto.db'))
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
    pass TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff', disabled INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
    rev INTEGER NOT NULL, updated_by TEXT
  );
  CREATE INDEX IF NOT EXISTS orders_rev ON orders(rev);
  CREATE TABLE IF NOT EXISTS shared (
    key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL, rev INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`)

const log = (...a) => console.log(new Date().toISOString(), ...a)
const now = () => Date.now()
const newId = () => randomBytes(12).toString('base64url')

// --- пароли ---
const hashPass = (p) => {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(p, salt, 32).toString('hex')}`
}
const checkPass = (p, stored) => {
  const [salt, hash] = stored.split(':')
  const a = Buffer.from(hash, 'hex')
  const b = scryptSync(p, Buffer.from(salt, 'hex'), 32)
  return a.length === b.length && timingSafeEqual(a, b)
}

// --- первый запуск: администратор ---
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const login = (process.env.ADMIN_LOGIN || 'admin').toLowerCase()
  const pass = process.env.ADMIN_PASSWORD || randomBytes(6).toString('base64url')
  db.prepare('INSERT INTO users (id, login, name, pass, role, created) VALUES (?, ?, ?, ?, ?, ?)').run(
    newId(), login, 'Администратор', hashPass(pass), 'admin', now(),
  )
  log(`Создан администратор: логин "${login}"` + (process.env.ADMIN_PASSWORD ? '' : `, пароль "${pass}" — смените его в приложении`))
}

// глобальный счётчик изменений — клиенты забирают всё, что новее их rev
const nextRev = () => {
  const cur = Number(db.prepare("SELECT value FROM meta WHERE key = 'rev'").get()?.value ?? 0) + 1
  db.prepare("INSERT INTO meta (key, value) VALUES ('rev', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(cur))
  return cur
}
const currentRev = () => Number(db.prepare("SELECT value FROM meta WHERE key = 'rev'").get()?.value ?? 0)

// --- SSE: уведомляем открытые приложения об изменениях ---
const listeners = new Set()
const broadcast = (rev) => {
  for (const res of listeners) res.write(`event: rev\ndata: ${rev}\n\n`)
}
setInterval(() => {
  for (const res of listeners) res.write(': ping\n\n')
}, 25_000)

// --- защита входа от перебора ---
const attempts = new Map()
const tooMany = (ip) => {
  const a = attempts.get(ip)
  return a && a.count >= 10 && now() - a.first < 15 * 60_000
}
const fail = (ip) => {
  const a = attempts.get(ip)
  if (!a || now() - a.first > 15 * 60_000) attempts.set(ip, { count: 1, first: now() })
  else a.count++
}

// --- HTTP ---
class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

const readBody = (req, limit) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new HttpError(413, 'Слишком большой запрос'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

const readJson = async (req) => {
  try {
    return JSON.parse((await readBody(req, MAX_JSON)).toString('utf8') || '{}')
  } catch (e) {
    if (e instanceof HttpError) throw e
    throw new HttpError(400, 'Неверный JSON')
  }
}

const auth = (req, url) => {
  const h = req.headers.authorization ?? ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token')
  if (!token) throw new HttpError(401, 'Нужен вход')
  const row = db
    .prepare('SELECT u.id, u.login, u.name, u.role, u.disabled, s.created FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?')
    .get(token)
  if (!row || row.disabled || now() - row.created > SESSION_DAYS * 86400_000) throw new HttpError(401, 'Сессия недействительна')
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(now(), token)
  return { id: row.id, login: row.login, name: row.name, role: row.role, token }
}

const adminOnly = (u) => {
  if (u.role !== 'admin') throw new HttpError(403, 'Только для администратора')
}

const PHOTO_ID = /^[A-Za-z0-9_-]{8,64}$/
const photoPath = (id) => {
  if (!PHOTO_ID.test(id)) throw new HttpError(400, 'Неверный id фото')
  return join(DATA, 'photos', `${id}.jpg`)
}

const publicUser = (u) => ({ id: u.id, login: u.login, name: u.name, role: u.role, disabled: !!u.disabled })

const routes = {
  'GET /api/health': () => ({ ok: true, rev: currentRev() }),

  'POST /api/login': async (req) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress
    if (tooMany(ip)) throw new HttpError(429, 'Слишком много попыток, подождите 15 минут')
    const { login, password } = await readJson(req)
    const u = db.prepare('SELECT * FROM users WHERE login = ?').get(String(login ?? '').trim().toLowerCase())
    if (!u || u.disabled || !checkPass(String(password ?? ''), u.pass)) {
      fail(ip)
      throw new HttpError(401, 'Неверный логин или пароль')
    }
    attempts.delete(ip)
    const token = randomBytes(32).toString('base64url')
    db.prepare('INSERT INTO sessions (token, user_id, created, last_seen) VALUES (?, ?, ?, ?)').run(token, u.id, now(), now())
    log(`вход: ${u.login}`)
    return { token, user: publicUser(u) }
  },

  'POST /api/logout': (req, url) => {
    const u = auth(req, url)
    db.prepare('DELETE FROM sessions WHERE token = ?').run(u.token)
    return { ok: true }
  },

  'GET /api/me': (req, url) => {
    const { token: _, ...u } = auth(req, url)
    return { user: u }
  },

  'POST /api/password': async (req, url) => {
    const u = auth(req, url)
    const { oldPassword, newPassword } = await readJson(req)
    const row = db.prepare('SELECT pass FROM users WHERE id = ?').get(u.id)
    if (!checkPass(String(oldPassword ?? ''), row.pass)) throw new HttpError(400, 'Текущий пароль неверный')
    if (String(newPassword ?? '').length < 6) throw new HttpError(400, 'Пароль — минимум 6 символов')
    db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPass(newPassword), u.id)
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(u.id, u.token)
    return { ok: true }
  },

  // забрать изменения, новее since
  'GET /api/sync': (req, url) => {
    auth(req, url)
    const since = Number(url.searchParams.get('since') ?? 0)
    const orders = db
      .prepare('SELECT id, data, updated_at, deleted FROM orders WHERE rev > ? ORDER BY rev')
      .all(since)
      .map((r) => ({ id: r.id, updatedAt: r.updated_at, deleted: !!r.deleted, data: r.deleted ? null : JSON.parse(r.data) }))
    const s = db.prepare("SELECT data, updated_at FROM shared WHERE key = 'settings' AND rev > ?").get(since)
    return { rev: currentRev(), orders, settings: s ? { data: JSON.parse(s.data), updatedAt: s.updated_at } : null }
  },

  // отправить свои изменения; при конфликте побеждает более позднее updatedAt
  'POST /api/sync': async (req, url) => {
    const u = auth(req, url)
    const { orders = [], settings } = await readJson(req)
    const accepted = []
    const rejected = []
    let changed = false
    db.exec('BEGIN')
    try {
      const get = db.prepare('SELECT id, data, updated_at, deleted FROM orders WHERE id = ?')
      const put = db.prepare(
        `INSERT INTO orders (id, data, updated_at, deleted, rev, updated_by) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at,
           deleted = excluded.deleted, rev = excluded.rev, updated_by = excluded.updated_by`,
      )
      for (const o of orders) {
        if (typeof o?.id !== 'string' || !o.id || typeof o.updatedAt !== 'number') continue
        const cur = get.get(o.id)
        if (cur && cur.updated_at > o.updatedAt) {
          rejected.push({ id: cur.id, updatedAt: cur.updated_at, deleted: !!cur.deleted, data: cur.deleted ? null : JSON.parse(cur.data) })
          continue
        }
        put.run(o.id, o.deleted ? null : JSON.stringify(o.data), o.updatedAt, o.deleted ? 1 : 0, nextRev(), u.id)
        accepted.push(o.id)
        changed = true
      }
      if (settings && typeof settings.updatedAt === 'number') {
        const cur = db.prepare("SELECT updated_at FROM shared WHERE key = 'settings'").get()
        if (!cur || cur.updated_at <= settings.updatedAt) {
          db.prepare(
            `INSERT INTO shared (key, data, updated_at, rev) VALUES ('settings', ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, rev = excluded.rev`,
          ).run(JSON.stringify(settings.data), settings.updatedAt, nextRev())
          changed = true
        }
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    const rev = currentRev()
    if (changed) broadcast(rev)
    return { accepted, rejected, rev }
  },

  'GET /api/events': (req, url, res) => {
    auth(req, url)
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.write(`event: rev\ndata: ${currentRev()}\n\n`)
    listeners.add(res)
    req.on('close', () => listeners.delete(res))
    return undefined
  },

  'GET /api/users': (req, url) => {
    adminOnly(auth(req, url))
    return { users: db.prepare('SELECT * FROM users ORDER BY created').all().map(publicUser) }
  },

  'POST /api/users': async (req, url) => {
    adminOnly(auth(req, url))
    const { login, name, password, role } = await readJson(req)
    const l = String(login ?? '').trim().toLowerCase()
    if (!/^[a-z0-9._-]{3,32}$/.test(l)) throw new HttpError(400, 'Логин: 3–32 символа, латиница, цифры, . _ -')
    if (String(password ?? '').length < 6) throw new HttpError(400, 'Пароль — минимум 6 символов')
    if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(l)) throw new HttpError(409, 'Такой логин уже есть')
    const id = newId()
    db.prepare('INSERT INTO users (id, login, name, pass, role, created) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, l, String(name ?? '').trim(), hashPass(password), role === 'admin' ? 'admin' : 'staff', now(),
    )
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) }
  },
}

// /api/users/:id и /api/photos/:id
async function dynamicRoute(req, res, url) {
  let m = url.pathname.match(/^\/api\/users\/([\w-]+)$/)
  if (m) {
    const me = auth(req, url)
    adminOnly(me)
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(m[1])
    if (!target) throw new HttpError(404, 'Нет такого сотрудника')
    if (req.method === 'PATCH') {
      const { name, password, disabled, role } = await readJson(req)
      if (target.id === me.id && (disabled || role === 'staff')) throw new HttpError(400, 'Нельзя отключить или понизить себя')
      if (name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim(), target.id)
      if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role === 'admin' ? 'admin' : 'staff', target.id)
      if (password !== undefined) {
        if (String(password).length < 6) throw new HttpError(400, 'Пароль — минимум 6 символов')
        db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPass(password), target.id)
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id)
      }
      if (disabled !== undefined) {
        db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, target.id)
        if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id)
      }
      return send(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)) })
    }
    if (req.method === 'DELETE') {
      if (target.id === me.id) throw new HttpError(400, 'Нельзя удалить себя')
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id)
      db.prepare('DELETE FROM users WHERE id = ?').run(target.id)
      return send(res, 200, { ok: true })
    }
  }

  m = url.pathname.match(/^\/api\/photos\/([^/]+)$/)
  if (m) {
    auth(req, url)
    const p = photoPath(m[1])
    if (req.method === 'PUT') {
      const buf = await readBody(req, MAX_PHOTO)
      // запись через временный файл — не оставляем обрезанные фото
      writeFileSync(p + '.tmp', buf)
      renameSync(p + '.tmp', p)
      return send(res, 200, { ok: true })
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!existsSync(p)) throw new HttpError(404, 'Нет фото')
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': statSync(p).size, 'Cache-Control': 'private, max-age=31536000, immutable' })
      if (req.method === 'HEAD') return res.end()
      return createReadStream(p).pipe(res)
    }
  }
  throw new HttpError(404, 'Не найдено')
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Max-Age', '86400')
  }
  if (req.method === 'OPTIONS') return res.writeHead(204).end()

  const url = new URL(req.url ?? '/', 'http://x')
  try {
    const handler = routes[`${req.method} ${url.pathname}`]
    if (handler) {
      const out = await handler(req, url, res)
      if (out !== undefined) send(res, 200, out)
      return
    }
    await dynamicRoute(req, res, url)
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status === 500) log('ошибка', req.method, url.pathname, e)
    if (!res.headersSent) send(res, status, { error: e.message })
    else res.end()
  }
})

server.listen(PORT, () => log(`Windauto server :${PORT}, data=${DATA}, origins=${ORIGINS.join(' ')}`))

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    log('остановка')
    for (const r of listeners) r.end()
    server.close(() => {
      db.close()
      process.exit(0)
    })
  })
