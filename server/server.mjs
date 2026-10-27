// Windauto — сервер синхронизации.
// Node 24: node:http + node:sqlite, фото — файлы на диске. Единственная зависимость — Anthropic SDK
// для распознавания VIN и номера по фото (нужен ANTHROPIC_API_KEY, без него распознавание выключено).
import Anthropic from '@anthropic-ai/sdk'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { changedKeys, getField, mergeOrders, sameOrder } from './merge.mjs'

const PORT = Number(process.env.PORT ?? 8080)
const DATA = process.env.DATA_DIR ?? './data'
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'https://ddremlin.github.io,http://localhost:5173,http://localhost:4173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const MAX_JSON = 20 * 1024 * 1024
const MAX_PHOTO = 15 * 1024 * 1024
// круговое видео при приёмке: ~2,5 Мбит/с × 3 мин ≈ 60 МБ, с запасом под видео из галереи
const MAX_VIDEO = 300 * 1024 * 1024
const SESSION_DAYS = 180
const MAX_RECOGNIZE = 8 * 1024 * 1024
const AI_MODEL = process.env.AI_MODEL || 'claude-opus-5-5'
const ai = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null

mkdirSync(join(DATA, 'photos'), { recursive: true })
mkdirSync(join(DATA, 'videos'), { recursive: true })
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
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, at INTEGER NOT NULL,
    user_id TEXT, action TEXT NOT NULL, changes TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS history_order ON history(order_id, at);
  CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, first INTEGER NOT NULL);
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

// --- защита входа от перебора (в базе — переживает перезапуск сервера) ---
const ATTEMPT_WINDOW = 15 * 60_000
const MAX_ATTEMPTS = 10
const tooMany = (ip) => {
  const a = db.prepare('SELECT count, first FROM login_attempts WHERE ip = ?').get(ip)
  return Boolean(a && a.count >= MAX_ATTEMPTS && now() - a.first < ATTEMPT_WINDOW)
}
const fail = (ip) => {
  const a = db.prepare('SELECT count, first FROM login_attempts WHERE ip = ?').get(ip)
  if (!a || now() - a.first > ATTEMPT_WINDOW)
    db.prepare('INSERT INTO login_attempts (ip, count, first) VALUES (?, 1, ?) ON CONFLICT(ip) DO UPDATE SET count = 1, first = excluded.first').run(ip, now())
  else db.prepare('UPDATE login_attempts SET count = count + 1 WHERE ip = ?').run(ip)
}
const clearAttempts = (ip) => db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip)
// старые записи и просроченные сессии — раз в час
const cleanup = () => {
  db.prepare('DELETE FROM login_attempts WHERE first < ?').run(now() - ATTEMPT_WINDOW)
  db.prepare('DELETE FROM sessions WHERE created < ?').run(now() - SESSION_DAYS * 86400_000)
}
cleanup()
setInterval(cleanup, 3600_000).unref()

// --- номера заказов «2026/0142»: единая нумерация на сервере ---
const NUMBER_RE = /^(\d{4})\/(\d+)$/
const numberKey = (year) => `num:${year}`
const getCounter = (year) => Number(db.prepare('SELECT value FROM meta WHERE key = ?').get(numberKey(year))?.value ?? 0)
const setCounter = (year, n) =>
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(numberKey(year), String(n))
const nextNumber = (year) => {
  const n = getCounter(year) + 1
  setCounter(year, n)
  return `${year}/${String(n).padStart(4, '0')}`
}
// номер, выданный телефоном без сервера, — счётчик не должен его повторить
const noteNumber = (number) => {
  const m = String(number).match(NUMBER_RE)
  if (m && Number(m[2]) > getCounter(m[1])) setCounter(m[1], Number(m[2]))
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
function addHistory(orderId, userId, action, changes) {
  // автосохранение идёт на каждое нажатие — правки одного человека подряд склеиваем
  const last = db.prepare('SELECT id, at, user_id, action, changes FROM history WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(orderId)
  if (action === 'update' && last && last.action === 'update' && last.user_id === userId && now() - last.at < HISTORY_MERGE_MS) {
    const merged = JSON.parse(last.changes)
    for (const c of changes) {
      const i = merged.findIndex((m) => m.key === c.key)
      if (i < 0) merged.push(c)
      else merged[i] = { ...c, from: merged[i].from }
    }
    // поле вернули как было — убираем из записи
    const kept = merged.filter((c) => !('from' in c) || c.from !== c.to)
    db.prepare('UPDATE history SET at = ?, changes = ? WHERE id = ?').run(now(), JSON.stringify(kept), last.id)
    return
  }
  db.prepare('INSERT INTO history (order_id, at, user_id, action, changes) VALUES (?, ?, ?, ?, ?)').run(
    orderId, now(), userId, action, JSON.stringify(changes),
  )
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

const VIDEO_TYPES = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }
const videoPath = (id) => {
  const m = id.match(/^([A-Za-z0-9_-]{8,64})\.(mp4|webm|mov)$/)
  if (!m) throw new HttpError(400, 'Неверный id видео')
  return { path: join(DATA, 'videos', id), type: VIDEO_TYPES[m[2]] }
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
    clearAttempts(ip)
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

  // фото (JPEG base64) → VIN или номер
  'POST /api/recognize': async (req, url) => {
    const u = auth(req, url)
    if (!ai) throw new HttpError(503, 'Распознавание не настроено на сервере (нет ANTHROPIC_API_KEY)')
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

  // отправить свои изменения. Если на сервере версия, которую телефон ещё не видел, —
  // сливаем по полям (у каждого поля своё время изменения) и возвращаем результат в merged.
  // Там же — заказы, которым сервер выдал номер.
  'POST /api/sync': async (req, url) => {
    const u = auth(req, url)
    const { orders = [], settings } = await readJson(req)
    const accepted = []
    const rejected = []
    const merged = []
    let changed = false
    const asRemote = (row) => ({ id: row.id, updatedAt: row.updated_at, deleted: !!row.deleted, data: row.deleted ? null : JSON.parse(row.data) })
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
        const curData = cur && !cur.deleted ? { ...JSON.parse(cur.data), updatedAt: cur.updated_at } : null

        if (o.deleted) {
          // заказ правили после того, как телефон его удалил, — удаление отклоняем
          if (cur && cur.updated_at > o.updatedAt) {
            rejected.push(asRemote(cur))
            continue
          }
          if (!cur?.deleted) {
            put.run(o.id, null, o.updatedAt, 1, nextRev(), u.id)
            addHistory(o.id, u.id, 'delete', [])
            changed = true
          }
          accepted.push(o.id)
          continue
        }

        if (!o.data || typeof o.data !== 'object') continue
        // удалён на сервере позже этой правки
        if (cur?.deleted && cur.updated_at > o.updatedAt) {
          rejected.push(asRemote(cur))
          continue
        }
        const incoming = { ...o.data, id: o.id, updatedAt: o.updatedAt }
        let data = curData ? mergeOrders(curData, incoming) : incoming
        let byServer = !sameOrder(data, incoming)
        if (!data.number) {
          data.number = nextNumber(new Date(data.createdAt || now()).getFullYear())
          data._ft = { ...data._ft, number: now() }
          byServer = true
        } else noteNumber(data.number)

        // ничего нового — не пишем и не будим другие телефоны
        if (curData && sameOrder(curData, data)) {
          if (byServer) merged.push({ id: o.id, updatedAt: cur.updated_at, deleted: false, data: curData })
          else accepted.push(o.id)
          continue
        }
        // результат отличается от присланного — новая отметка, чтобы его забрали все
        if (byServer) data.updatedAt = Math.max(data.updatedAt, cur?.updated_at ?? 0) + 1
        put.run(o.id, JSON.stringify(data), data.updatedAt, 0, nextRev(), u.id)
        if (curData) addHistory(o.id, u.id, byServer && cur.updated_at > o.updatedAt ? 'merge' : 'update', describeChanges(curData, data))
        else addHistory(o.id, u.id, 'create', [])
        changed = true
        if (byServer) merged.push({ id: o.id, updatedAt: data.updatedAt, deleted: false, data })
        else accepted.push(o.id)
      }
      if (settings && typeof settings.updatedAt === 'number' && u.role === 'admin') {
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
    return { accepted, rejected, merged, rev }
  },

  // сотрудники для выбора ответственного — доступно всем
  'GET /api/staff': (req, url) => {
    auth(req, url)
    return {
      users: db
        .prepare('SELECT id, login, name, role, disabled FROM users WHERE disabled = 0 ORDER BY name, login')
        .all()
        .map(publicUser),
    }
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

// /api/users/:id, /api/photos/:id и /api/videos/:id
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

  m = url.pathname.match(/^\/api\/orders\/([^/]+)\/history$/)
  if (m && req.method === 'GET') {
    auth(req, url)
    const history = db
      .prepare(
        `SELECT h.at, h.action, h.changes, COALESCE(NULLIF(u.name, ''), u.login, '—') AS user
         FROM history h LEFT JOIN users u ON u.id = h.user_id WHERE h.order_id = ? ORDER BY h.id DESC LIMIT 200`,
      )
      .all(decodeURIComponent(m[1]))
      .map((r) => ({ at: r.at, user: r.user, action: r.action, changes: JSON.parse(r.changes) }))
    return send(res, 200, { history })
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
  m = url.pathname.match(/^\/api\/videos\/([^/]+)$/)
  if (m) {
    auth(req, url)
    const { path, type } = videoPath(m[1])
    if (req.method === 'PUT') {
      await saveStream(req, path, MAX_VIDEO)
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
