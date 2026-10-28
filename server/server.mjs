// Windauto — сервер синхронизации.
// Node 24: node:http + node:sqlite, фото — файлы на диске. Единственная зависимость — Anthropic SDK
// для распознавания VIN и номера по фото (нужен ANTHROPIC_API_KEY, без него распознавание выключено).
//
// Компании изолированы друг от друга: у каждой своя база и папки с фото и видео — data/orgs/<id>/.
// Общая только база аккаунтов data/accounts.db: компании, пользователи, сессии, одноразовые ссылки из писем.
import Anthropic from '@anthropic-ai/sdk'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { mailFor, sendMail } from './mail.mjs'
import { changedKeys, getField, mergeOrders, sameOrder } from './merge.mjs'
import { legalPage, messagePage, pageText, passwordPage } from './pages.mjs'

const PORT = Number(process.env.PORT ?? 8080)
const DATA = process.env.DATA_DIR ?? './data'
// веб-версия отдаётся с того же адреса, что и API (Caddy, папка web/) — CORS ей не нужен;
// здесь — другие адреса, например http://localhost:5173 для разработки
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
// Android-приложение (Capacitor) открывает страницы с https://localhost
ORIGINS.push('https://localhost')
const APP_DIR = join(DATA, 'app')
// адрес сервера в ссылках из писем; без него — из заголовков запроса
const PUBLIC_URL = (process.env.PUBLIC_URL ?? '').replace(/\/+$/, '')
// регистрация новых компаний; REGISTRATION=off — только свои сотрудники
const REGISTRATION = process.env.REGISTRATION !== 'off'
// не больше стольких новых компаний в час с одного адреса
const REGISTER_PER_HOUR = Number(process.env.REGISTER_PER_HOUR ?? 5)
const MAX_JSON = 20 * 1024 * 1024
// запросы без входа и небольшие формы — чтобы гигантским телом нельзя было занять память
const MAX_FORM = 16 * 1024
const MAX_PHOTO = 15 * 1024 * 1024
// круговое видео при приёмке: ~2,5 Мбит/с × 3 мин ≈ 60 МБ, с запасом под видео из галереи
const MAX_VIDEO = 300 * 1024 * 1024
const SESSION_DAYS = 180
const PASS_MIN = 8
const MAX_RECOGNIZE = 8 * 1024 * 1024
const AI_MODEL = process.env.AI_MODEL || 'claude-opus-5-5'
// распознавание и голос — платные запросы: не больше стольких в сутки на компанию
const AI_PER_DAY = Number(process.env.AI_PER_DAY ?? 500)
// место под фото и видео одной компании
const ORG_QUOTA = Number(process.env.ORG_QUOTA_GB ?? 20) * 1024 ** 3
// приглашения сотрудникам — письма на чужие адреса: не больше стольких в сутки на компанию
const INVITES_PER_DAY = Number(process.env.INVITES_PER_DAY ?? 20)
const ai = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null

const log = (...a) => console.log(new Date().toISOString(), ...a)
const now = () => Date.now()
const newId = () => randomBytes(12).toString('base64url')

const ACCOUNTS_SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL,
    blocked INTEGER NOT NULL DEFAULT 0, owner_id TEXT
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, login TEXT UNIQUE NOT NULL, email TEXT UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL DEFAULT '',
    pass TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'staff', disabled INTEGER NOT NULL DEFAULT 0,
    platform INTEGER NOT NULL DEFAULT 0, lang TEXT NOT NULL DEFAULT 'ru', created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS users_org ON users(org_id);
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tokens (
    hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, first INTEGER NOT NULL);
`

const ORG_SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
    rev INTEGER NOT NULL, updated_by TEXT
  );
  CREATE INDEX IF NOT EXISTS orders_rev ON orders(rev);
  CREATE TABLE IF NOT EXISTS shared (
    key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL, rev INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, at INTEGER NOT NULL,
    user_id TEXT, action TEXT NOT NULL, changes TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS history_order ON history(order_id, at);
`

// --- переход со старой схемы (одна база data/windauto.db на всех) ---
// Всё, что было, становится первой компанией; её администратор — владелец компании и платформы.
function migrateLegacy() {
  const legacy = join(DATA, 'windauto.db')
  if (!existsSync(legacy) || existsSync(join(DATA, 'accounts.db'))) return
  const old = new DatabaseSync(legacy)
  old.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  const settings = old.prepare("SELECT data FROM shared WHERE key = 'settings'").get()
  let name = 'Windauto'
  try {
    name = JSON.parse(settings?.data ?? '{}').shopName?.trim() || name
  } catch {
    /* оставляем по умолчанию */
  }
  const orgId = newId()
  const tmp = join(DATA, 'accounts.db.tmp')
  rmSync(tmp, { force: true })
  const acc = new DatabaseSync(tmp)
  acc.exec(ACCOUNTS_SCHEMA)
  const users = old.prepare('SELECT * FROM users ORDER BY created').all()
  const owner = users.find((u) => u.role === 'admin') ?? users[0]
  acc.prepare('INSERT INTO orgs (id, name, created, owner_id) VALUES (?, ?, ?, ?)').run(orgId, name, now(), owner?.id ?? null)
  const addUser = acc.prepare(
    'INSERT INTO users (id, org_id, login, name, pass, role, disabled, email_verified, platform, created) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
  )
  for (const u of users) addUser.run(u.id, orgId, u.login, u.name, u.pass, u.role, u.disabled, u.id === owner?.id ? 1 : 0, u.created)
  // телефоны остаются подключёнными
  const addSession = acc.prepare('INSERT INTO sessions (token, user_id, created, last_seen) VALUES (?, ?, ?, ?)')
  for (const s of old.prepare('SELECT * FROM sessions').all()) addSession.run(s.token, s.user_id, s.created, s.last_seen)
  acc.close()
  old.close()
  const dir = join(DATA, 'orgs', orgId)
  mkdirSync(dir, { recursive: true })
  renameSync(legacy, join(dir, 'org.db'))
  for (const ext of ['-wal', '-shm']) rmSync(legacy + ext, { force: true })
  for (const d of ['photos', 'videos']) if (existsSync(join(DATA, d))) renameSync(join(DATA, d), join(dir, d))
  renameSync(tmp, join(DATA, 'accounts.db'))
  log(`перенос данных: компания «${name}» (${orgId}), пользователей: ${users.length}`)
}

mkdirSync(join(DATA, 'orgs'), { recursive: true })
migrateLegacy()
const db = new DatabaseSync(join(DATA, 'accounts.db'))
db.exec(ACCOUNTS_SCHEMA)
// новый email ждёт подтверждения по ссылке, до этого вход — по старому
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'new_email')) db.exec('ALTER TABLE users ADD COLUMN new_email TEXT')
// в базе — только хеш токена сессии: утечка базы или копии не даёт войти. Старые токены хешируем на месте
const sha = (s) => createHash('sha256').update(s).digest('hex')
{
  const plain = db.prepare("SELECT token FROM sessions WHERE length(token) != 64").all()
  if (plain.length) {
    const upd = db.prepare('UPDATE sessions SET token = ? WHERE token = ?')
    for (const { token } of plain) upd.run(sha(token), token)
  }
}

// --- пароли ---
const hashPass = (p) => {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(p, salt, 32).toString('hex')}`
}
const checkPass = (p, stored) => {
  if (!stored) return false
  const [salt, hash] = stored.split(':')
  const a = Buffer.from(hash, 'hex')
  const b = scryptSync(p, Buffer.from(salt, 'hex'), 32)
  return a.length === b.length && timingSafeEqual(a, b)
}

const DUMMY_PASS = hashPass(randomBytes(16).toString('hex'))

// --- первый запуск: компания и администратор (он же владелец платформы) ---
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const login = (process.env.ADMIN_LOGIN || 'admin').toLowerCase()
  const pass = process.env.ADMIN_PASSWORD || randomBytes(6).toString('base64url')
  const orgId = newId()
  const userId = newId()
  db.prepare('INSERT INTO orgs (id, name, created, owner_id) VALUES (?, ?, ?, ?)').run(orgId, 'Windauto', now(), userId)
  db.prepare(
    'INSERT INTO users (id, org_id, login, name, pass, role, email_verified, platform, created) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)',
  ).run(userId, orgId, login, 'Администратор', hashPass(pass), 'admin', now())
  log(`Создан администратор: логин "${login}"` + (process.env.ADMIN_PASSWORD ? '' : `, пароль "${pass}" — смените его в приложении`))
}

const dirBytes = (dir) => {
  let n = 0
  for (const f of readdirSync(dir)) {
    try {
      n += statSync(join(dir, f)).size
    } catch {
      /* удалён между чтением и stat */
    }
  }
  return n
}
const fileBytes = (path) => (existsSync(path) ? statSync(path).size : 0)
// не хватит места компании — 507, приложение покажет понятный текст
const checkQuota = (o, add) => {
  if (o.bytes + add > ORG_QUOTA) throw new HttpError(507, 'Закончилось место для фото и видео компании', 'quota')
}

// --- данные компании: своя база и папки, открываются при первом обращении ---
const ORGS = new Map()
function orgStore(id) {
  let o = ORGS.get(id)
  if (o) return o
  const dir = join(DATA, 'orgs', id)
  mkdirSync(join(dir, 'photos'), { recursive: true })
  mkdirSync(join(dir, 'videos'), { recursive: true })
  const odb = new DatabaseSync(join(dir, 'org.db'))
  odb.exec(ORG_SCHEMA)
  // после переноса со старой схемы аккаунты живут в accounts.db
  odb.exec('DROP TABLE IF EXISTS users; DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS login_attempts;')
  o = { id, dir, db: odb, listeners: new Set(), bytes: dirBytes(join(dir, 'photos')) + dirBytes(join(dir, 'videos')) }
  ORGS.set(id, o)
  return o
}
function closeOrg(id) {
  const o = ORGS.get(id)
  if (!o) return
  for (const r of o.listeners) r.end()
  o.db.close()
  ORGS.delete(id)
}

// счётчик изменений компании — телефоны забирают всё, что новее их rev
const nextRev = (o) => {
  const cur = Number(o.db.prepare("SELECT value FROM meta WHERE key = 'rev'").get()?.value ?? 0) + 1
  o.db.prepare("INSERT INTO meta (key, value) VALUES ('rev', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(cur))
  return cur
}
const currentRev = (o) => Number(o.db.prepare("SELECT value FROM meta WHERE key = 'rev'").get()?.value ?? 0)

// --- SSE: уведомляем открытые приложения компании об изменениях ---
const broadcast = (o, rev) => {
  for (const res of o.listeners) res.write(`event: rev\ndata: ${rev}\n\n`)
}
setInterval(() => {
  for (const o of ORGS.values()) for (const res of o.listeners) res.write(': ping\n\n')
}, 25_000).unref()

// --- ограничения частоты (вход, регистрация, письма); в базе — переживают перезапуск ---
const LOGIN_WINDOW = 15 * 60_000
const MAX_ATTEMPTS = 10
// неудачных входов в один аккаунт за час, со всех адресов вместе
const MAX_USER_ATTEMPTS = 30
const limited = (key, max, windowMs) => {
  const a = db.prepare('SELECT count, first FROM limits WHERE key = ?').get(key)
  return Boolean(a && a.count >= max && now() - a.first < windowMs)
}
const bump = (key, windowMs) => {
  const a = db.prepare('SELECT count, first FROM limits WHERE key = ?').get(key)
  if (!a || now() - a.first > windowMs)
    db.prepare('INSERT INTO limits (key, count, first) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, first = excluded.first').run(key, now())
  else db.prepare('UPDATE limits SET count = count + 1 WHERE key = ?').run(key)
}
const clearLimit = (key) => db.prepare('DELETE FROM limits WHERE key = ?').run(key)
/** Не больше max раз за окно — иначе 429 */
const rateLimit = (key, max, windowMs) => {
  if (limited(key, max, windowMs)) throw new HttpError(429, 'Слишком много попыток, подождите', 'too_many')
  bump(key, windowMs)
}
const clientIp = (req) => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress

// --- одноразовые ссылки из писем: в базе только хеш ---
const TOKEN_TTL = { verify: 7 * 86400_000, reset: 3600_000, invite: 7 * 86400_000, email: 86400_000 }
function makeToken(userId, kind) {
  db.prepare('DELETE FROM tokens WHERE user_id = ? AND kind = ?').run(userId, kind)
  const t = randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO tokens (hash, user_id, kind, expires) VALUES (?, ?, ?, ?)').run(sha(t), userId, kind, now() + TOKEN_TTL[kind])
  return t
}
const findToken = (t, kinds) => {
  const row = db.prepare('SELECT * FROM tokens WHERE hash = ?').get(sha(String(t ?? '')))
  return row && kinds.includes(row.kind) && row.expires > now() ? row : null
}

// просроченное — раз в час
const cleanup = () => {
  db.prepare('DELETE FROM limits WHERE first < ?').run(now() - 86400_000)
  db.prepare('DELETE FROM sessions WHERE created < ?').run(now() - SESSION_DAYS * 86400_000)
  db.prepare('DELETE FROM tokens WHERE expires < ?').run(now())
}
cleanup()
setInterval(cleanup, 3600_000).unref()

// --- письма ---
const baseUrl = (req) => PUBLIC_URL || `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers['x-forwarded-host'] ?? req.headers.host}`
async function mailUser(req, user, kind, to = user.email) {
  // на один адрес — не больше 5 писем в час, с каких бы IP ни просили
  rateLimit('to:' + to, 5, 3600_000)
  const token = makeToken(user.id, kind)
  const link = `${baseUrl(req)}${kind === 'verify' || kind === 'email' ? '/auth/verify' : '/auth/reset'}?t=${token}`
  const org = db.prepare('SELECT name FROM orgs WHERE id = ?').get(user.org_id)
  try {
    await sendMail({ to, ...mailFor(kind, user.lang, { link, company: org?.name ?? '', name: user.name }) }, log)
  } catch {
    throw new HttpError(502, 'Письмо не отправилось — попробуйте позже', 'mail_failed')
  }
}

// --- номера заказов «2026/0142»: своя нумерация у каждой компании ---
const NUMBER_RE = /^(\d{4})\/(\d+)$/
const numberKey = (year) => `num:${year}`
const getCounter = (o, year) => Number(o.db.prepare('SELECT value FROM meta WHERE key = ?').get(numberKey(year))?.value ?? 0)
const setCounter = (o, year, n) =>
  o.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(numberKey(year), String(n))
const nextNumber = (o, year) => {
  const n = getCounter(o, year) + 1
  setCounter(o, year, n)
  return `${year}/${String(n).padStart(4, '0')}`
}
// номер, выданный телефоном без сервера, — счётчик не должен его повторить
const noteNumber = (o, number) => {
  const m = String(number).match(NUMBER_RE)
  if (m && Number(m[2]) > getCounter(o, m[1])) setCounter(o, m[1], Number(m[2]))
}

// --- история изменений ---
const HISTORY_MERGE_MS = 10 * 60_000
const shortValue = (v) => (v == null ? '' : typeof v === 'object' ? undefined : String(v).slice(0, 120))
function describeChanges(prev, next) {
  return changedKeys(prev, next).map((key) => {
    const from = shortValue(getField(prev, key))
    const to = shortValue(getField(next, key))
    return from === undefined || to === undefined ? { key } : { key, from, to }
  })
}
function addHistory(o, orderId, userId, action, changes) {
  // автосохранение идёт на каждое нажатие — правки одного человека подряд склеиваем
  const last = o.db.prepare('SELECT id, at, user_id, action, changes FROM history WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(orderId)
  if (action === 'update' && last && last.action === 'update' && last.user_id === userId && now() - last.at < HISTORY_MERGE_MS) {
    const merged = JSON.parse(last.changes)
    for (const c of changes) {
      const i = merged.findIndex((m) => m.key === c.key)
      if (i < 0) merged.push(c)
      else merged[i] = { ...c, from: merged[i].from }
    }
    // поле вернули как было — убираем из записи
    const kept = merged.filter((c) => !('from' in c) || c.from !== c.to)
    o.db.prepare('UPDATE history SET at = ?, changes = ? WHERE id = ?').run(now(), JSON.stringify(kept), last.id)
    return
  }
  o.db.prepare('INSERT INTO history (order_id, at, user_id, action, changes) VALUES (?, ?, ?, ?, ?)').run(
    orderId, now(), userId, action, JSON.stringify(changes),
  )
}

// --- HTTP ---
class HttpError extends Error {
  // code — для приложения: по нему оно показывает понятный текст на языке пользователя
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
  res.end(body === undefined ? '' : JSON.stringify(body))
}
const sendHtml = (res, status, html) => {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
  res.end(html)
}

const readBody = (req, limit) =>
  new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > limit) return reject(new HttpError(413, 'Слишком большой запрос'))
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      // сверх лимита — не копим, а сразу отвечаем 413 (остаток тела Node дочитает и выбросит)
      if (size > limit) {
        chunks.length = 0
        reject(new HttpError(413, 'Слишком большой запрос'))
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

const readJson = async (req, limit = MAX_JSON) => {
  try {
    return JSON.parse((await readBody(req, limit)).toString('utf8') || '{}')
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
    .prepare(
      `SELECT u.*, s.created AS session_created, o.blocked, o.name AS org_name, o.owner_id
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN orgs o ON o.id = u.org_id WHERE s.token = ?`,
    )
    .get(sha(token))
  if (!row || row.disabled || now() - row.session_created > SESSION_DAYS * 86400_000) throw new HttpError(401, 'Сессия недействительна')
  if (row.blocked && !row.platform) throw new HttpError(403, 'Компания заблокирована', 'blocked')
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(now(), sha(token))
  return { ...userInfo(row), token: sha(token), org: orgStore(row.org_id) }
}

const adminOnly = (u) => {
  if (u.role !== 'admin') throw new HttpError(403, 'Только для администратора')
}
const platformOnly = (u) => {
  if (!u.platform) throw new HttpError(403, 'Только для владельца платформы')
}

const PHOTO_ID = /^[A-Za-z0-9_-]{8,64}$/
const photoPath = (o, id) => {
  if (!PHOTO_ID.test(id)) throw new HttpError(400, 'Неверный id фото')
  return join(o.dir, 'photos', `${id}.jpg`)
}

const VIDEO_TYPES = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }
const videoPath = (o, id) => {
  const m = id.match(/^([A-Za-z0-9_-]{8,64})\.(mp4|webm|mov)$/)
  if (!m) throw new HttpError(400, 'Неверный id видео')
  return { path: join(o.dir, 'videos', id), type: VIDEO_TYPES[m[2]] }
}

// тело запроса сразу в файл (видео не держим в памяти), через временный — без обрезков
const saveStream = (req, path, limit) =>
  new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > limit) return reject(new HttpError(413, 'Слишком большое видео'))
    const tmp = path + '.tmp'
    const out = createWriteStream(tmp)
    let size = 0
    const fail = (e) => {
      out.destroy()
      try {
        unlinkSync(tmp)
      } catch {
        /* уже нет */
      }
      reject(e)
    }
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        req.destroy()
        fail(new HttpError(413, 'Слишком большое видео'))
      }
    })
    req.on('error', fail)
    out.on('error', fail)
    out.on('finish', () => {
      renameSync(tmp, path)
      resolve(size)
    })
    req.pipe(out)
  })


// --- распознавание VIN / номера по фото ---
const RECOGNIZE = {
  vin: {
    prompt:
      'На фото — VIN автомобиля (табличка, наклейка на стойке, под лобовым стеклом, техпаспорт). ' +
      'Прочитай VIN: 17 символов, буквы I, O, Q в VIN не встречаются (это 1 и 0). ' +
      'Верни его без пробелов. Если VIN не виден или читается ненадёжно — value пустая строка.',
    schema: {
      type: 'object',
      properties: { value: { type: 'string' }, confident: { type: 'boolean' } },
      required: ['value', 'confident'],
      additionalProperties: false,
    },
  },
  plate: {
    prompt:
      'На фото — автомобиль или его номерной знак. Прочитай регистрационный номер так, как он написан на знаке ' +
      '(польский пример: «WA 12345», «KR 1AB23» — сохрани пробел между частями). ' +
      'country — код страны с полосы слева на знаке (PL, D, UA, LT, CZ…), пусто, если не видно. ' +
      'Если номер не виден — value пустая строка.',
    schema: {
      type: 'object',
      properties: { value: { type: 'string' }, country: { type: 'string' }, confident: { type: 'boolean' } },
      required: ['value', 'country', 'confident'],
      additionalProperties: false,
    },
  },
  doc: {
    prompt:
      'На фото — свидетельство о регистрации автомобиля (польский dowód rejestracyjny или другой документ ЕС ' +
      'с полями по общему образцу). Прочитай: plate — поле A (регистрационный номер, сохрани пробел, напр. «WA 12345»); ' +
      'vin — поле E (17 символов, без I, O, Q); make — D.1 (марка, напр. «VOLKSWAGEN» → «Volkswagen», «SKODA» → «Škoda»); ' +
      'model — D.3 (модель; если D.3 нет — коммерческое название из D.2), с обычным написанием, напр. «Octavia»; ' +
      'year — год выпуска («rok produkcji»), а если его нет — год из поля B (первая регистрация); ' +
      'owner — владелец/держатель из C.1.1 и C.1.2 (или C.2.1, C.2.2): «Имя Фамилия» или название фирмы. ' +
      'Поле, которое не видно или читается ненадёжно, — пустая строка. confident — false, если что-то читалось с трудом.',
    schema: {
      type: 'object',
      properties: {
        plate: { type: 'string' },
        vin: { type: 'string' },
        make: { type: 'string' },
        model: { type: 'string' },
        year: { type: 'string' },
        owner: { type: 'string' },
        confident: { type: 'boolean' },
      },
      required: ['plate', 'vin', 'make', 'model', 'year', 'owner', 'confident'],
      additionalProperties: false,
    },
  },
}

// --- голосовой ввод: текст (распознан телефоном) → поля заказа ---
const VOICE_FIELDS = ['plate', 'plateCountry', 'vin', 'make', 'model', 'year', 'mileage', 'color', 'paintCode', 'paintNotes', 'client', 'phone', 'email', 'notes']

const voiceSchema = (elements, works, damages) => ({
  type: 'object',
  properties: {
    fields: {
      type: 'object',
      properties: Object.fromEntries(VOICE_FIELDS.map((k) => [k, { type: 'string' }])),
      required: VOICE_FIELDS,
      additionalProperties: false,
    },
    elements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: elements },
          works: { type: 'array', items: { type: 'string', enum: works } },
          damage: { type: 'array', items: { type: 'string', enum: damages } },
          price: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['id', 'works', 'damage', 'price', 'note'],
        additionalProperties: false,
      },
    },
    confident: { type: 'boolean' },
  },
  required: ['fields', 'elements', 'confident'],
  additionalProperties: false,
})

const voicePrompt = (text, elements, works, damages) =>
  'Ты помогаешь мастеру кузовного сервиса в Польше заполнять лист приёмки автомобиля голосом. ' +
  'Ниже — распознанная речь мастера (русский или польский, возможны ошибки распознавания). ' +
  'Разложи сказанное по полям. Поле, о котором ничего не сказано, — пустая строка; не выдумывай.\n' +
  'Поля: plate — номер как на знаке, заглавными, с пробелом между частями («WA 12345»); ' +
  'plateCountry — код страны с номера (PL, D, UA, LT, CZ…), только если назван; vin — 17 символов без пробелов; ' +
  'make и model — с обычным написанием («Škoda», «Octavia»); year — 4 цифры; mileage — только цифры, км; ' +
  'color — цвет словами; paintCode — код краски; paintNotes — замечания к цвету и лакокрасочному покрытию; ' +
  'client — имя и фамилия или фирма; phone — как продиктован, цифрами; email; ' +
  'notes — то, что не подходит ни к одному полю (пожелания клиента, договорённости).\n' +
  'elements — элементы кузова, о которых сказано: id из списка, works — какие работы, damage — какие повреждения уже есть, ' +
  'price — названная цена в злотых за работы по элементу (0, если не названа), note — уточнение по элементу. ' +
  'Слова «левый/правый» — по ходу движения автомобиля.\n' +
  `Элементы (id: название): ${elements.map((e) => `${e.id}: ${e.name}`).join('; ')}\n` +
  `Работы: ${works.map((w) => `${w.id}: ${w.name}`).join('; ')}\n` +
  `Повреждения: ${damages.map((d) => `${d.id}: ${d.name}`).join('; ')}\n` +
  'confident — false, если речь неразборчива или что-то пришлось угадывать.\n\n' +
  `Речь мастера:\n${text}`

async function parseVoice({ text, elements, works, damages }) {
  const ids = (list) => list.map((x) => x.id)
  const response = await ai.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: voiceSchema(ids(elements), ids(works), ids(damages)) } },
    messages: [{ role: 'user', content: voicePrompt(text, elements, works, damages) }],
  })
  if (response.stop_reason === 'refusal') throw new HttpError(422, 'Не удалось разобрать')
  const out = response.content.find((b) => b.type === 'text')?.text
  if (!out) throw new HttpError(502, 'Пустой ответ разбора')
  return JSON.parse(out)
}

// список { id, name } от приложения: только короткие строки
const idList = (v, max) => {
  if (!Array.isArray(v) || !v.length || v.length > max) throw new HttpError(400, 'Неверный список')
  return v.map((x) => {
    const id = String(x?.id ?? '')
    const name = String(x?.name ?? '')
    if (!/^[\w-]{1,40}$/.test(id) || name.length > 80) throw new HttpError(400, 'Неверный список')
    return { id, name }
  })
}

async function recognize(kind, image) {
  const task = RECOGNIZE[kind]
  const response = await ai.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: task.schema } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: task.prompt },
        ],
      },
    ],
  })
  if (response.stop_reason === 'refusal') throw new HttpError(422, 'Не удалось распознать')
  const text = response.content.find((b) => b.type === 'text')?.text
  if (!text) throw new HttpError(502, 'Пустой ответ распознавания')
  return JSON.parse(text)
}

// --- пользователи ---
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const normEmail = (v) => String(v ?? '').trim().toLowerCase().slice(0, 254)
const LOGIN_RE = /^[a-z0-9._-]{3,32}$/

const publicUser = (u) => ({
  id: u.id, login: u.login, name: u.name, role: u.role, disabled: !!u.disabled,
  email: u.email ?? '', invited: !u.pass,
})
const userRow = (where, ...args) =>
  db.prepare(`SELECT u.*, o.blocked, o.name AS org_name, o.owner_id FROM users u JOIN orgs o ON o.id = u.org_id WHERE ${where}`).get(...args)
// пользователь вместе с его компанией — для входа и /api/me
const userInfo = (row) => ({
  ...publicUser(row), newEmail: row.new_email ?? '', orgId: row.org_id, orgName: row.org_name, owner: row.owner_id === row.id, platform: !!row.platform, lang: row.lang,
})

// язык страниц из писем: ?lang=, язык пользователя, язык браузера
const langOf = (req, url, userId) => {
  const q = url.searchParams.get('lang')
  if (q === 'ru' || q === 'pl') return q
  const u = userId && db.prepare('SELECT lang FROM users WHERE id = ?').get(userId)
  if (u) return u.lang
  return /^pl/i.test(req.headers['accept-language'] ?? '') ? 'pl' : 'ru'
}

/** Удаляет компанию целиком: базу, фото, видео и все аккаунты */
function deleteOrg(id) {
  closeOrg(id)
  rmSync(join(DATA, 'orgs', id), { recursive: true, force: true })
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id = ?)').run(id)
    db.prepare('DELETE FROM tokens WHERE user_id IN (SELECT id FROM users WHERE org_id = ?)').run(id)
    db.prepare('DELETE FROM users WHERE org_id = ?').run(id)
    db.prepare('DELETE FROM orgs WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

const orgSummary = (org) => {
  const owner = db.prepare('SELECT name, login, email FROM users WHERE id = ?').get(org.owner_id)
  const users = db.prepare('SELECT COUNT(*) AS n, MAX(s.last_seen) AS seen FROM users u LEFT JOIN sessions s ON s.user_id = u.id WHERE u.org_id = ?').get(org.id)
  let orders = 0
  try {
    orders = orgStore(org.id).db.prepare('SELECT COUNT(*) AS n FROM orders WHERE deleted = 0').get().n
  } catch {
    /* папки компании нет */
  }
  return {
    id: org.id, name: org.name, created: org.created, blocked: !!org.blocked,
    owner: owner ? { name: owner.name, login: owner.login, email: owner.email ?? '' } : null,
    users: db.prepare('SELECT COUNT(*) AS n FROM users WHERE org_id = ?').get(org.id).n,
    orders, lastSeen: users.seen ?? 0,
  }
}

// название компании и имя попадают в письма — без ссылок, адресов и управляющих символов
const LINKISH = /https?:|www\.|@|[a-z0-9-]\.(?:[a-z]{2,}|xn--)(?:[/\s]|$)|[\u0000-\u001f\u007f<>]/i
const goodCompany = (s) => s.length >= 2 && !LINKISH.test(s)
const goodName = (s) => !LINKISH.test(s)

const aiLimit = (u) => {
  if (limited('ai:' + u.orgId, AI_PER_DAY, 86400_000)) throw new HttpError(429, 'Распознавание: дневной лимит компании исчерпан', 'ai_limit')
  bump('ai:' + u.orgId, 86400_000)
}
const inviteLimit = (u) => rateLimit('invite:' + u.orgId, INVITES_PER_DAY, 86400_000)
// письма по запросу без входа: ответ одинаковый, даже если лимит на адрес исчерпан
async function mailQuiet(req, user, kind) {
  try {
    await mailUser(req, user, kind)
  } catch (e) {
    if (e.code !== 'too_many') throw e
    log(`письмо не отправлено (лимит на адрес): ${kind} → ${user.email}`)
  }
}

const routes = {
  'GET /api/health': () => ({ ok: true }),

  // что умеет сервер — без входа
  'GET /api/info': () => ({ registration: REGISTRATION }),

  'POST /api/login': async (req) => {
    const key = 'login:' + clientIp(req)
    if (limited(key, MAX_ATTEMPTS, LOGIN_WINDOW)) throw new HttpError(429, 'Слишком много попыток, подождите 15 минут', 'too_many')
    const { login, password } = await readJson(req, MAX_FORM)
    const l = String(login ?? '').trim().toLowerCase().slice(0, 254)
    // и на аккаунт — подбор пароля с множества адресов
    const userKey = 'login-user:' + l
    if (l && limited(userKey, MAX_USER_ATTEMPTS, 3600_000)) throw new HttpError(429, 'Слишком много попыток, подождите 15 минут', 'too_many')
    const u = l ? userRow('u.login = ? OR u.email = ?', l, l) : null
    // проверка пароля и для несуществующего логина — по времени ответа не узнать, есть ли такой
    const ok = checkPass(String(password ?? ''), u?.pass || DUMMY_PASS)
    if (!u || u.disabled || !u.pass || !ok) {
      bump(key, LOGIN_WINDOW)
      if (l) bump(userKey, 3600_000)
      throw new HttpError(401, 'Неверный логин или пароль', 'login_failed')
    }
    clearLimit(key)
    clearLimit(userKey)
    if (u.email && !u.email_verified) throw new HttpError(403, 'Подтвердите email — ссылка в письме', 'unverified')
    if (u.blocked && !u.platform) throw new HttpError(403, 'Компания заблокирована', 'blocked')
    const token = randomBytes(32).toString('base64url')
    db.prepare('INSERT INTO sessions (token, user_id, created, last_seen) VALUES (?, ?, ?, ?)').run(sha(token), u.id, now(), now())
    log(`вход: ${u.login} (${u.org_name})`)
    return { token, user: userInfo(u) }
  },

  // новая компания и её владелец; войти можно после подтверждения email
  'POST /api/register': async (req) => {
    if (!REGISTRATION) throw new HttpError(403, 'Регистрация закрыта', 'registration_closed')
    const b = await readJson(req, MAX_FORM)
    const company = String(b.company ?? '').trim().slice(0, 100)
    const name = String(b.name ?? '').trim().slice(0, 100)
    const email = normEmail(b.email)
    const password = String(b.password ?? '')
    const lang = b.lang === 'pl' ? 'pl' : 'ru'
    if (!goodCompany(company)) throw new HttpError(400, 'Укажите название компании', 'company')
    if (name.length > 0 && !goodName(name)) throw new HttpError(400, 'Имя без ссылок и адресов', 'bad_name')
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Неверный email', 'bad_email')
    if (password.length < PASS_MIN) throw new HttpError(400, `Пароль — минимум ${PASS_MIN} символов`, 'weak_password')
    if (!b.accept) throw new HttpError(400, 'Нужно принять условия', 'terms')
    rateLimit('register:' + clientIp(req), REGISTER_PER_HOUR, 3600_000)
    if (db.prepare('SELECT 1 FROM users WHERE email = ? OR login = ?').get(email, email))
      throw new HttpError(409, 'Этот email уже зарегистрирован', 'email_taken')
    const orgId = newId()
    const userId = newId()
    db.exec('BEGIN')
    try {
      db.prepare('INSERT INTO orgs (id, name, created, owner_id) VALUES (?, ?, ?, ?)').run(orgId, company, now(), userId)
      db.prepare(
        'INSERT INTO users (id, org_id, login, email, name, pass, role, lang, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(userId, orgId, email, email, name, hashPass(password), 'admin', lang, now())
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    log(`регистрация: «${company}», ${email}`)
    try {
      await mailUser(req, userRow('u.id = ?', userId), 'verify')
    } catch {
      throw new HttpError(502, 'Компания создана, но письмо не отправилось — нажмите «Отправить письмо ещё раз»', 'mail_failed')
    }
    return { ok: true }
  },

  'POST /api/verify/resend': async (req) => {
    rateLimit('mail:' + clientIp(req), 5, 15 * 60_000)
    const email = normEmail((await readJson(req, MAX_FORM)).email)
    const u = email ? userRow('u.email = ?', email) : null
    if (u && u.pass && !u.email_verified) await mailQuiet(req, u, 'verify')
    // одинаковый ответ — по нему не узнать, есть ли такой email
    return { ok: true }
  },

  'POST /api/password/forgot': async (req) => {
    rateLimit('mail:' + clientIp(req), 5, 15 * 60_000)
    const l = normEmail((await readJson(req, MAX_FORM)).login)
    const u = l ? userRow('u.email = ? OR u.login = ?', l, l) : null
    // приглашённый, но ещё не задавший пароль, получает приглашение заново
    if (u?.email && !u.disabled) await mailQuiet(req, u, u.pass ? 'reset' : 'invite')
    return { ok: true }
  },

  // ссылка из письма «подтвердите email» (при регистрации или смене email)
  'GET /auth/verify': (req, url, res) => {
    const tok = findToken(url.searchParams.get('t'), ['verify', 'email'])
    const lang = langOf(req, url, tok?.user_id)
    if (!tok) return sendHtml(res, 400, messagePage(lang, pageText(lang).badLink, false))
    if (tok.kind === 'email') {
      const e = db.prepare('SELECT new_email FROM users WHERE id = ?').get(tok.user_id)?.new_email
      // пока шло письмо, адрес мог занять кто-то другой
      const taken = e && db.prepare('SELECT 1 FROM users WHERE (email = ? OR login = ?) AND id != ?').get(e, e, tok.user_id)
      if (!e || taken) return sendHtml(res, 400, messagePage(lang, pageText(lang).badLink, false))
      db.prepare('UPDATE users SET email = new_email, new_email = NULL WHERE id = ?').run(tok.user_id)
    }
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(tok.user_id)
    db.prepare('DELETE FROM tokens WHERE hash = ?').run(tok.hash)
    log(`email подтверждён: ${tok.user_id}`)
    return sendHtml(res, 200, messagePage(lang, pageText(lang).verified))
  },

  // ссылка из письма «новый пароль» или приглашения сотрудника
  'GET /auth/reset': (req, url, res) => {
    const t = url.searchParams.get('t')
    const tok = findToken(t, ['reset', 'invite'])
    const lang = langOf(req, url, tok?.user_id)
    if (!tok) return sendHtml(res, 400, messagePage(lang, pageText(lang).badLink, false))
    const u = db.prepare('SELECT email FROM users WHERE id = ?').get(tok.user_id)
    return sendHtml(res, 200, passwordPage(lang, { token: t, kind: tok.kind, email: u?.email }))
  },

  'POST /auth/reset': async (req, url, res) => {
    const form = new URLSearchParams((await readBody(req, 10_000)).toString('utf8'))
    const t = form.get('t')
    const tok = findToken(t, ['reset', 'invite'])
    const lang = langOf(req, url, tok?.user_id)
    const txt = pageText(lang)
    if (!tok) return sendHtml(res, 400, messagePage(lang, txt.badLink, false))
    const password = form.get('password') ?? ''
    const again = (error) => {
      const u = db.prepare('SELECT email FROM users WHERE id = ?').get(tok.user_id)
      return sendHtml(res, 400, passwordPage(lang, { token: t, kind: tok.kind, email: u?.email, error }))
    }
    if (password.length < PASS_MIN) return again(txt.short)
    if (password !== form.get('password2')) return again(txt.mismatch)
    // ссылка пришла на почту — значит, email настоящий
    db.prepare('UPDATE users SET pass = ?, email_verified = 1 WHERE id = ?').run(hashPass(password), tok.user_id)
    db.prepare("DELETE FROM tokens WHERE user_id = ? AND kind IN ('reset', 'invite')").run(tok.user_id)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(tok.user_id)
    log(`пароль задан по ссылке (${tok.kind}): ${tok.user_id}`)
    return sendHtml(res, 200, messagePage(lang, txt.saved))
  },

  'GET /legal/privacy': (req, url, res) => sendHtml(res, 200, legalPage('privacy', url.searchParams.get('lang') === 'ru' ? 'ru' : 'pl')),
  'GET /legal/terms': (req, url, res) => sendHtml(res, 200, legalPage('terms', url.searchParams.get('lang') === 'ru' ? 'ru' : 'pl')),

  'POST /api/logout': (req, url) => {
    const u = auth(req, url)
    db.prepare('DELETE FROM sessions WHERE token = ?').run(u.token)
    return { ok: true }
  },

  'GET /api/me': (req, url) => {
    const { token: _, org: __, ...u } = auth(req, url)
    return { user: u }
  },

  'POST /api/password': async (req, url) => {
    const u = auth(req, url)
    const { oldPassword, newPassword } = await readJson(req, MAX_FORM)
    const row = db.prepare('SELECT pass FROM users WHERE id = ?').get(u.id)
    if (!checkPass(String(oldPassword ?? ''), row.pass)) throw new HttpError(400, 'Текущий пароль неверный', 'old_password')
    if (String(newPassword ?? '').length < PASS_MIN) throw new HttpError(400, `Пароль — минимум ${PASS_MIN} символов`, 'weak_password')
    db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPass(newPassword), u.id)
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(u.id, u.token)
    return { ok: true }
  },

  // свой email: письмо со ссылкой на новый адрес, сменится после перехода по ней
  'POST /api/me/email': async (req, url) => {
    const u = auth(req, url)
    rateLimit('email:' + u.id, 5, 15 * 60_000)
    const { email, password } = await readJson(req, MAX_FORM)
    const e = normEmail(email)
    if (!EMAIL_RE.test(e)) throw new HttpError(400, 'Неверный email', 'bad_email')
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)
    if (!checkPass(String(password ?? ''), row.pass)) throw new HttpError(400, 'Неверный пароль', 'old_password')
    if (e === row.email && row.email_verified) return { ok: true, newEmail: '' }
    if (db.prepare('SELECT 1 FROM users WHERE (email = ? OR login = ?) AND id != ?').get(e, e, u.id))
      throw new HttpError(409, 'Этот email уже зарегистрирован', 'email_taken')
    db.prepare('UPDATE users SET new_email = ? WHERE id = ?').run(e, u.id)
    await mailUser(req, row, 'email', e)
    log(`смена email: ${row.login} → ${e}`)
    return { ok: true, newEmail: e }
  },

  // фото (JPEG base64) → VIN или номер
  'POST /api/recognize': async (req, url) => {
    const u = auth(req, url)
    if (!ai) throw new HttpError(503, 'Распознавание не настроено на сервере (нет ANTHROPIC_API_KEY)')
    aiLimit(u)
    const { kind, image } = JSON.parse((await readBody(req, MAX_RECOGNIZE)).toString('utf8') || '{}')
    if (!Object.hasOwn(RECOGNIZE, kind)) throw new HttpError(400, 'kind: vin, plate или doc')
    if (typeof image !== 'string' || !image) throw new HttpError(400, 'Нет фото')
    try {
      const out = await recognize(kind, image)
      log(`распознавание ${kind}: ${u.login} → ${kind === 'doc' ? out.vin || out.plate || '—' : out.value || '—'}`)
      return out
    } catch (e) {
      if (e instanceof HttpError) throw e
      if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Распознавание перегружено, попробуйте через минуту')
      if (e instanceof Anthropic.APIError) {
        log('ошибка распознавания', e.status, e.message)
        throw new HttpError(502, 'Сервис распознавания недоступен')
      }
      throw e
    }
  },

  // голосовой ввод: текст → поля заказа, элементы и работы
  'POST /api/voice': async (req, url) => {
    const u = auth(req, url)
    if (!ai) throw new HttpError(503, 'Разбор голоса не настроен на сервере (нет ANTHROPIC_API_KEY)')
    aiLimit(u)
    const body = await readJson(req)
    const text = String(body.text ?? '').trim()
    if (!text) throw new HttpError(400, 'Пустой текст')
    if (text.length > 4000) throw new HttpError(400, 'Слишком длинный текст')
    const input = { text, elements: idList(body.elements, 100), works: idList(body.works, 30), damages: idList(body.damages, 30) }
    try {
      const out = await parseVoice(input)
      log(`голос: ${u.login}, ${text.length} симв. → ${out.elements.length} эл.`)
      return out
    } catch (e) {
      if (e instanceof HttpError) throw e
      if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Разбор голоса перегружен, попробуйте через минуту')
      if (e instanceof Anthropic.APIError) {
        log('ошибка разбора голоса', e.status, e.message)
        throw new HttpError(502, 'Сервис разбора голоса недоступен')
      }
      throw e
    }
  },

  // забрать изменения своей компании, новее since
  'GET /api/sync': (req, url) => {
    const { org: o } = auth(req, url)
    const since = Number(url.searchParams.get('since') ?? 0)
    const orders = o.db
      .prepare('SELECT id, data, updated_at, deleted FROM orders WHERE rev > ? ORDER BY rev')
      .all(since)
      .map((r) => ({ id: r.id, updatedAt: r.updated_at, deleted: !!r.deleted, data: r.deleted ? null : JSON.parse(r.data) }))
    const s = o.db.prepare("SELECT data, updated_at FROM shared WHERE key = 'settings' AND rev > ?").get(since)
    return { rev: currentRev(o), orders, settings: s ? { data: JSON.parse(s.data), updatedAt: s.updated_at } : null }
  },

  // отправить свои изменения. Если на сервере версия, которую телефон ещё не видел, —
  // сливаем по полям (у каждого поля своё время изменения) и возвращаем результат в merged.
  // Там же — заказы, которым сервер выдал номер.
  'POST /api/sync': async (req, url) => {
    const u = auth(req, url)
    const o = u.org
    const { orders = [], settings } = await readJson(req)
    const accepted = []
    const rejected = []
    const merged = []
    let changed = false
    const asRemote = (row) => ({ id: row.id, updatedAt: row.updated_at, deleted: !!row.deleted, data: row.deleted ? null : JSON.parse(row.data) })
    o.db.exec('BEGIN')
    try {
      const get = o.db.prepare('SELECT id, data, updated_at, deleted FROM orders WHERE id = ?')
      const put = o.db.prepare(
        `INSERT INTO orders (id, data, updated_at, deleted, rev, updated_by) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at,
           deleted = excluded.deleted, rev = excluded.rev, updated_by = excluded.updated_by`,
      )
      for (const x of orders) {
        if (typeof x?.id !== 'string' || !x.id || typeof x.updatedAt !== 'number') continue
        const cur = get.get(x.id)
        const curData = cur && !cur.deleted ? { ...JSON.parse(cur.data), updatedAt: cur.updated_at } : null

        if (x.deleted) {
          // заказ правили после того, как телефон его удалил, — удаление отклоняем
          if (cur && cur.updated_at > x.updatedAt) {
            rejected.push(asRemote(cur))
            continue
          }
          if (!cur?.deleted) {
            put.run(x.id, null, x.updatedAt, 1, nextRev(o), u.id)
            addHistory(o, x.id, u.id, 'delete', [])
            changed = true
          }
          accepted.push(x.id)
          continue
        }

        if (!x.data || typeof x.data !== 'object') continue
        // удалён на сервере позже этой правки
        if (cur?.deleted && cur.updated_at > x.updatedAt) {
          rejected.push(asRemote(cur))
          continue
        }
        const incoming = { ...x.data, id: x.id, updatedAt: x.updatedAt }
        let data = curData ? mergeOrders(curData, incoming) : incoming
        let byServer = !sameOrder(data, incoming)
        if (!data.number) {
          data.number = nextNumber(o, new Date(data.createdAt || now()).getFullYear())
          data._ft = { ...data._ft, number: now() }
          byServer = true
        } else noteNumber(o, data.number)

        // ничего нового — не пишем и не будим другие телефоны
        if (curData && sameOrder(curData, data)) {
          if (byServer) merged.push({ id: x.id, updatedAt: cur.updated_at, deleted: false, data: curData })
          else accepted.push(x.id)
          continue
        }
        // результат отличается от присланного — новая отметка, чтобы его забрали все
        if (byServer) data.updatedAt = Math.max(data.updatedAt, cur?.updated_at ?? 0) + 1
        put.run(x.id, JSON.stringify(data), data.updatedAt, 0, nextRev(o), u.id)
        if (curData) addHistory(o, x.id, u.id, byServer && cur.updated_at > x.updatedAt ? 'merge' : 'update', describeChanges(curData, data))
        else addHistory(o, x.id, u.id, 'create', [])
        changed = true
        if (byServer) merged.push({ id: x.id, updatedAt: data.updatedAt, deleted: false, data })
        else accepted.push(x.id)
      }
      if (settings && typeof settings.updatedAt === 'number' && u.role === 'admin') {
        const cur = o.db.prepare("SELECT updated_at FROM shared WHERE key = 'settings'").get()
        if (!cur || cur.updated_at <= settings.updatedAt) {
          o.db.prepare(
            `INSERT INTO shared (key, data, updated_at, rev) VALUES ('settings', ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, rev = excluded.rev`,
          ).run(JSON.stringify(settings.data), settings.updatedAt, nextRev(o))
          changed = true
        }
      }
      o.db.exec('COMMIT')
    } catch (e) {
      o.db.exec('ROLLBACK')
      throw e
    }
    const rev = currentRev(o)
    if (changed) broadcast(o, rev)
    return { accepted, rejected, merged, rev }
  },

  // сотрудники компании для выбора ответственного — доступно всем в компании
  'GET /api/staff': (req, url) => {
    const u = auth(req, url)
    return {
      users: db
        .prepare('SELECT * FROM users WHERE org_id = ? AND disabled = 0 ORDER BY name, login')
        .all(u.orgId)
        .map(publicUser),
    }
  },

  'GET /api/events': (req, url, res) => {
    const { org: o } = auth(req, url)
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.write(`event: rev\ndata: ${currentRev(o)}\n\n`)
    o.listeners.add(res)
    req.on('close', () => o.listeners.delete(res))
    return undefined
  },

  // Android-приложение: какая версия APK лежит на сервере (data/app/latest.json) — без входа,
  // чтобы обновиться мог и телефон, ещё не подключённый к базе
  'GET /api/app': () => {
    const info = join(APP_DIR, 'latest.json')
    if (!existsSync(info) || !existsSync(join(APP_DIR, 'windauto.apk'))) return {}
    const { versionCode, versionName } = JSON.parse(readFileSync(info, 'utf8'))
    return { versionCode, versionName, size: statSync(join(APP_DIR, 'windauto.apk')).size }
  },

  'GET /api/app/apk': (req, url, res) => {
    const path = join(APP_DIR, 'windauto.apk')
    if (!existsSync(path)) throw new HttpError(404, 'APK не выложен')
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': statSync(path).size,
      'Content-Disposition': 'attachment; filename="windauto.apk"',
      'Cache-Control': 'no-cache',
    })
    createReadStream(path).pipe(res)
    return undefined
  },

  'GET /api/users': (req, url) => {
    const me = auth(req, url)
    adminOnly(me)
    return { users: db.prepare('SELECT * FROM users WHERE org_id = ? ORDER BY created').all(me.orgId).map(publicUser) }
  },

  // сотрудник: с логином и паролем от администратора или приглашение по email (пароль задаст сам)
  'POST /api/users': async (req, url) => {
    const me = auth(req, url)
    adminOnly(me)
    const { login, name, password, role, email } = await readJson(req, MAX_FORM)
    const e = email ? normEmail(email) : ''
    if (e && !EMAIL_RE.test(e)) throw new HttpError(400, 'Неверный email', 'bad_email')
    const invite = Boolean(e) && !password
    const n = String(name ?? '').trim().slice(0, 100)
    if (!goodName(n)) throw new HttpError(400, 'Имя без ссылок и адресов', 'bad_name')
    // с паролем от администратора — свой логин; email из формы ещё не проверен, он подтверждается письмом
    // и до этого не служит для входа: иначе можно было бы занять чужой адрес
    const l = invite ? e : String(login ?? '').trim().toLowerCase()
    if (!invite && !LOGIN_RE.test(l)) throw new HttpError(400, 'Логин: 3–32 символа, латиница, цифры, . _ -', 'bad_login')
    if (!invite && String(password ?? '').length < PASS_MIN) throw new HttpError(400, `Пароль — минимум ${PASS_MIN} символов`, 'weak_password')
    if (db.prepare('SELECT 1 FROM users WHERE login = ? OR email = ?').get(l, l)) throw new HttpError(409, 'Такой логин уже есть', 'login_taken')
    if (e && db.prepare('SELECT 1 FROM users WHERE email = ? OR login = ?').get(e, e)) throw new HttpError(409, 'Этот email уже зарегистрирован', 'email_taken')
    if (e) inviteLimit(me)
    const id = newId()
    db.prepare(
      'INSERT INTO users (id, org_id, login, email, new_email, email_verified, name, pass, role, lang, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, me.orgId, l, invite ? e : null, invite || !e ? null : e, invite ? 0 : 1, n, invite ? '' : hashPass(password), role === 'admin' ? 'admin' : 'staff', me.lang, now())
    try {
      if (invite) await mailUser(req, userRow('u.id = ?', id), 'invite')
      else if (e) await mailUser(req, userRow('u.id = ?', id), 'email', e)
    } catch {
      throw new HttpError(502, 'Сотрудник добавлен, но письмо не отправилось — нажмите «Отправить приглашение»', 'mail_failed')
    }
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) }
  },

  // своя компания
  'GET /api/org': (req, url) => {
    const u = auth(req, url)
    const org = db.prepare('SELECT * FROM orgs WHERE id = ?').get(u.orgId)
    return { org: { id: org.id, name: org.name, created: org.created, ownerId: org.owner_id } }
  },

  'PATCH /api/org': async (req, url) => {
    const u = auth(req, url)
    adminOnly(u)
    const name = String((await readJson(req, MAX_FORM)).name ?? '').trim().slice(0, 100)
    if (!goodCompany(name)) throw new HttpError(400, 'Укажите название компании', 'company')
    db.prepare('UPDATE orgs SET name = ? WHERE id = ?').run(name, u.orgId)
    return { ok: true }
  },

  // удалить компанию со всеми данными — только владелец, с паролем
  'DELETE /api/org': async (req, url) => {
    const u = auth(req, url)
    if (!u.owner) throw new HttpError(403, 'Удалить компанию может только её владелец', 'not_owner')
    const { password } = await readJson(req, MAX_FORM)
    if (!checkPass(String(password ?? ''), db.prepare('SELECT pass FROM users WHERE id = ?').get(u.id).pass))
      throw new HttpError(400, 'Неверный пароль', 'old_password')
    if (db.prepare('SELECT 1 FROM users WHERE org_id = ? AND platform = 1').get(u.orgId))
      throw new HttpError(400, 'Компанию владельца платформы удалить нельзя', 'platform_org')
    log(`компания удалена владельцем: «${u.orgName}» (${u.orgId}), ${u.login}`)
    deleteOrg(u.orgId)
    return { ok: true }
  },

  // владелец платформы: все компании
  'GET /api/platform/orgs': (req, url) => {
    platformOnly(auth(req, url))
    return { orgs: db.prepare('SELECT * FROM orgs ORDER BY created DESC').all().map(orgSummary) }
  },
}

// /api/users/:id, /api/platform/orgs/:id, /api/orders/:id/history, /api/photos/:id и /api/videos/:id
async function dynamicRoute(req, res, url) {
  let m = url.pathname.match(/^\/api\/users\/([\w-]+)$/)
  if (m) {
    const me = auth(req, url)
    adminOnly(me)
    const target = userRow('u.id = ? AND u.org_id = ?', m[1], me.orgId)
    if (!target) throw new HttpError(404, 'Нет такого сотрудника')
    const isOwner = target.owner_id === target.id
    if (req.method === 'PATCH') {
      const { name, password, disabled, role, invite } = await readJson(req, MAX_FORM)
      if (target.id === me.id && (disabled || role === 'staff')) throw new HttpError(400, 'Нельзя отключить или понизить себя')
      // свой пароль — только со старым, через /api/password: украденной сессии не хватит, чтобы забрать аккаунт
      if (target.id === me.id && password !== undefined) throw new HttpError(400, 'Свой пароль меняйте в разделе «Мой пароль»', 'own_password')
      if (name !== undefined && !goodName(String(name).trim())) throw new HttpError(400, 'Имя без ссылок и адресов', 'bad_name')
      if (isOwner && target.id !== me.id && (disabled !== undefined || role !== undefined || password !== undefined))
        throw new HttpError(403, 'Владельца компании нельзя изменить', 'owner')
      if (name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim().slice(0, 100), target.id)
      if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role === 'admin' ? 'admin' : 'staff', target.id)
      if (password !== undefined) {
        if (String(password).length < PASS_MIN) throw new HttpError(400, `Пароль — минимум ${PASS_MIN} символов`, 'weak_password')
        db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPass(password), target.id)
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id)
      }
      if (disabled !== undefined) {
        db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, target.id)
        if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id)
      }
      // приглашение ещё раз — пока сотрудник не задал пароль
      if (invite) {
        if (!target.email || target.pass) throw new HttpError(400, 'Сотрудник уже задал пароль')
        inviteLimit(me)
        await mailUser(req, target, 'invite')
      }
      return send(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)) })
    }
    if (req.method === 'DELETE') {
      if (target.id === me.id) throw new HttpError(400, 'Нельзя удалить себя')
      if (isOwner) throw new HttpError(403, 'Владельца компании нельзя удалить', 'owner')
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id)
      db.prepare('DELETE FROM tokens WHERE user_id = ?').run(target.id)
      db.prepare('DELETE FROM users WHERE id = ?').run(target.id)
      return send(res, 200, { ok: true })
    }
  }

  m = url.pathname.match(/^\/api\/platform\/orgs\/([\w-]+)$/)
  if (m) {
    const me = auth(req, url)
    platformOnly(me)
    const org = db.prepare('SELECT * FROM orgs WHERE id = ?').get(m[1])
    if (!org) throw new HttpError(404, 'Нет такой компании')
    if (org.id === me.orgId) throw new HttpError(400, 'Это ваша компания')
    if (req.method === 'PATCH') {
      const { blocked } = await readJson(req, MAX_FORM)
      db.prepare('UPDATE orgs SET blocked = ? WHERE id = ?').run(blocked ? 1 : 0, org.id)
      // заблокированные сразу теряют доступ
      if (blocked) {
        db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id = ?)').run(org.id)
        for (const r of orgStore(org.id).listeners) r.end()
      }
      log(`компания ${blocked ? 'заблокирована' : 'разблокирована'}: «${org.name}»`)
      return send(res, 200, { org: orgSummary(db.prepare('SELECT * FROM orgs WHERE id = ?').get(org.id)) })
    }
    if (req.method === 'DELETE') {
      log(`компания удалена владельцем платформы: «${org.name}» (${org.id})`)
      deleteOrg(org.id)
      return send(res, 200, { ok: true })
    }
  }

  m = url.pathname.match(/^\/api\/orders\/([^/]+)\/history$/)
  if (m && req.method === 'GET') {
    const u = auth(req, url)
    const names = new Map(db.prepare('SELECT id, name, login FROM users WHERE org_id = ?').all(u.orgId).map((r) => [r.id, r.name || r.login]))
    const history = u.org.db
      .prepare('SELECT at, action, changes, user_id FROM history WHERE order_id = ? ORDER BY id DESC LIMIT 200')
      .all(decodeURIComponent(m[1]))
      .map((r) => ({ at: r.at, user: names.get(r.user_id) ?? '—', action: r.action, changes: JSON.parse(r.changes) }))
    return send(res, 200, { history })
  }

  m = url.pathname.match(/^\/api\/photos\/([^/]+)$/)
  if (m) {
    const u = auth(req, url)
    const p = photoPath(u.org, m[1])
    if (req.method === 'PUT') {
      const buf = await readBody(req, MAX_PHOTO)
      const old = fileBytes(p)
      checkQuota(u.org, buf.length - old)
      // запись через временный файл — не оставляем обрезанные фото
      writeFileSync(p + '.tmp', buf)
      renameSync(p + '.tmp', p)
      u.org.bytes += buf.length - old
      return send(res, 200, { ok: true })
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!existsSync(p)) throw new HttpError(404, 'Нет фото')
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': statSync(p).size, 'Cache-Control': 'private, max-age=31536000, immutable' })
      if (req.method === 'HEAD') return res.end()
      return createReadStream(p).pipe(res)
    }
  }
  m = url.pathname.match(/^\/api\/videos\/([^/]+)$/)
  if (m) {
    const u = auth(req, url)
    const { path, type } = videoPath(u.org, m[1])
    if (req.method === 'PUT') {
      const old = fileBytes(path)
      checkQuota(u.org, Number(req.headers['content-length'] ?? 0) - old)
      // без Content-Length — не дальше остатка квоты
      const size = await saveStream(req, path, Math.min(MAX_VIDEO, ORG_QUOTA - u.org.bytes + old))
      u.org.bytes += size - old
      return send(res, 200, { ok: true })
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!existsSync(path)) throw new HttpError(404, 'Нет видео')
      const size = statSync(path).size
      const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable' }
      // Range — чтобы плеер мог перематывать без загрузки целиком
      const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
        if (start >= size || start > end) {
          res.writeHead(416, { 'Content-Range': `bytes */${size}` })
          return res.end()
        }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
        if (req.method === 'HEAD') return res.end()
        return createReadStream(path, { start, end }).pipe(res)
      }
      res.writeHead(200, { ...headers, 'Content-Length': size })
      if (req.method === 'HEAD') return res.end()
      return createReadStream(path).pipe(res)
    }
  }
  throw new HttpError(404, 'Не найдено')
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range')
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
    if (!res.headersSent) send(res, status, { error: e.message, ...(e.code ? { code: e.code } : {}) })
    else res.end()
  }
})

server.listen(PORT, () => log(`Windauto server :${PORT}, data=${DATA}, origins=${ORIGINS.join(' ')}`))

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    log('остановка')
    for (const id of [...ORGS.keys()]) closeOrg(id)
    server.close(() => {
      db.close()
      process.exit(0)
    })
  })
