// Заказы из таблицы (.ods LibreOffice/OpenOffice, .xlsx Excel или .csv): строка заголовков — «Марка», «Nr rej.», «Telefon»…,
// каждая строка под ней — заказ. Строки превращаются в текст «Поле: значение» и разбираются как текстовый файл.
// Без заголовков таблица читается как текст: «подпись | значение» в двух столбцах тоже понимается.
import { LABEL_OF, cleanLabel, splitOrders, type TextField } from './textImport'

export interface SheetRow {
  /** номер строки в таблице, с 1 */
  n: number
  cells: string[]
}

export interface Sheet {
  name: string
  rows: SheetRow[]
}

export interface SheetBlock {
  /** строка таблицы; null — кусок таблицы без заголовков */
  row: number | null
  text: string
  /** заказ из строки с заголовками — поля уже разложены, ИИ не нужен */
  table: boolean
}

/** строк-заказов из одного листа */
export const MAX_ROWS = 500
// повторы пустых строк и столбцов в .ods бывают на миллион — дальше не разворачиваем
const MAX_REPEAT = 1000

// ---------- zip: .ods и .xlsx ----------

type ZipEntry = { method: number; size: number; local: number }

/** Оглавление zip → чтение файла из него по имени (null — нет такого) */
function openZip(buf: ArrayBuffer): (name: string) => Promise<string | null> {
  const v = new DataView(buf)
  const u16 = (o: number) => v.getUint16(o, true)
  const u32 = (o: number) => v.getUint32(o, true)
  // конец центрального каталога — в последних 64 КБ
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 0xffff); i--)
    if (u32(i) === 0x06054b50) {
      eocd = i
      break
    }
  if (eocd < 0) throw new Error('not a zip')
  const dec = new TextDecoder()
  const entries = new Map<string, ZipEntry>()
  let p = u32(eocd + 16)
  for (let n = u16(eocd + 10); n > 0 && u32(p) === 0x02014b50; n--) {
    const nameLen = u16(p + 28)
    entries.set(dec.decode(new Uint8Array(buf, p + 46, nameLen)), { method: u16(p + 10), size: u32(p + 20), local: u32(p + 42) })
    p += 46 + nameLen + u16(p + 30) + u16(p + 32)
  }
  return async (name) => {
    const e = entries.get(name)
    if (!e) return null
    const data = new Uint8Array(buf, e.local + 30 + u16(e.local + 26) + u16(e.local + 28), e.size)
    if (e.method === 0) return dec.decode(data)
    if (e.method !== 8) throw new Error(`zip method ${e.method}`)
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return dec.decode(await new Response(stream).arrayBuffer())
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescapeXml = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m),
  )
const attr = (attrs: string, name: string) => {
  const m = attrs.match(new RegExp(`\\s${name}="([^"]*)"`))
  return m ? unescapeXml(m[1]) : ''
}

/** content.xml → листы со строками; пустые строки остаются пустыми (ими разделены куски без заголовков) */
export function parseOdsXml(xml: string): Sheet[] {
  const sheets: Sheet[] = []
  let sheet: Sheet | null = null
  let row: string[] | null = null
  let rowRepeat = 1
  let rowN = 0
  let cell: { paras: string[]; repeat: number; type: string; value: string; date: string } | null = null
  let inP = false
  // пустые клетки ждут непустую справа — хвост из тысяч пустых не нужен
  let blanks = 0
  // примечание к клетке — не данные
  let note = 0

  const endCell = () => {
    if (!cell || !row) return
    const shown = cell.paras.join('\n').trim()
    let v = shown
    if (cell.type === 'date' && cell.date) v = cell.date.slice(0, 10)
    // длинное число (телефон) показано как 6,01E+08 — берём само значение
    else if (cell.type === 'float' && /e[+-]?\d/i.test(shown) && cell.value) v = cell.value
    if (!v) blanks += cell.repeat
    else {
      for (; blanks > 0; blanks--) row.push('')
      for (let i = 0; i < Math.min(cell.repeat, MAX_REPEAT); i++) row.push(v)
    }
    cell = null
  }
  const endRow = () => {
    if (!sheet || !row) return
    if (row.length) for (let i = 0; i < Math.min(rowRepeat, MAX_REPEAT); i++) sheet.rows.push({ n: rowN + i + 1, cells: row })
    else sheet.rows.push({ n: rowN + 1, cells: [] })
    rowN += rowRepeat
    row = null
  }
  const add = (s: string) => {
    if (cell && inP) cell.paras[cell.paras.length - 1] += s
  }

  for (const m of xml.matchAll(/<(\/?)([\w:.-]+)((?:[^>"]|"[^"]*")*?)(\/?)>|([^<]+)/g)) {
    const [, close, tag, attrs = '', self, text] = m
    if (text !== undefined) {
      if (!note) add(unescapeXml(text))
      continue
    }
    if (tag === 'office:annotation') {
      if (close) note--
      else if (!self) note++
      continue
    }
    if (note || tag.startsWith('?') || tag.startsWith('!')) continue
    if (close) {
      if (tag === 'table:table-cell' || tag === 'table:covered-table-cell') endCell()
      else if (tag === 'table:table-row') endRow()
      else if (tag === 'table:table') sheet = null
      else if (tag === 'text:p' || tag === 'text:h') inP = false
      continue
    }
    switch (tag) {
      case 'table:table':
        sheet = { name: attr(attrs, 'table:name'), rows: [] }
        sheets.push(sheet)
        rowN = 0
        break
      case 'table:table-row':
        row = []
        blanks = 0
        rowRepeat = Number(attr(attrs, 'table:number-rows-repeated')) || 1
        if (self) endRow()
        break
      case 'table:table-cell':
      case 'table:covered-table-cell':
        cell = {
          paras: [],
          repeat: Number(attr(attrs, 'table:number-columns-repeated')) || 1,
          type: attr(attrs, 'office:value-type'),
          value: attr(attrs, 'office:value'),
          date: attr(attrs, 'office:date-value'),
        }
        if (self) endCell()
        break
      case 'text:p':
      case 'text:h':
        if (cell) {
          cell.paras.push('')
          inP = !self
        }
        break
      case 'text:s':
        add(' '.repeat(Number(attr(attrs, 'text:c')) || 1))
        break
      case 'text:tab':
        add(' ')
        break
      case 'text:line-break':
        add('\n')
        break
    }
  }
  return sheets
}

/** Файл .ods → листы */
export async function readOds(buf: ArrayBuffer): Promise<Sheet[]> {
  const xml = await openZip(buf)('content.xml')
  if (!xml) throw new Error('no content.xml')
  return parseOdsXml(xml)
}

// ---------- .xlsx: листы, общие строки, форматы дат ----------

// без префиксов пространств имён: <x:row> → <row>
const noNs = (xml: string) => xml.replace(/<(\/?)[\w-]+:/g, '<$1')
// текст из <t> внутри строки, без фонетических подсказок <rPh>
const runs = (xml: string) =>
  unescapeXml([...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]).join(''))

// встроенные форматы дат Excel
const DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57])
function isDateFormat(code: string): boolean {
  const c = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
  return /[dy]/i.test(c) || (/m/i.test(c) && !/[hs]/i.test(c))
}

/** № строки и столбца из «AB12» */
const colOf = (ref: string) => [...ref.replace(/\d+$/, '').toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1

/** Лист .xlsx; strings — общие строки, dateStyles — номера стилей с датой */
export function parseXlsxSheet(name: string, xml: string, strings: string[], dateStyles: Set<number>, date1904 = false): Sheet {
  const rows: SheetRow[] = []
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  let prev = 0
  for (const rm of noNs(xml).matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const n = Number(attr(rm[1], 'r')) || prev + 1
    const cells: string[] = []
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1]
      const body = cm[2] ?? ''
      const ref = attr(a, 'r')
      const col = ref ? colOf(ref) : cells.length
      const type = attr(a, 't')
      const raw = unescapeXml(body.match(/<v>([^<]*)<\/v>/)?.[1] ?? '')
      let v = ''
      if (type === 's') v = strings[Number(raw)] ?? ''
      else if (type === 'inlineStr') v = runs(body.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? '')
      else if (type === 'str' || type === 'b') v = raw
      else if (raw && type !== 'e') {
        const num = Number(raw)
        if (dateStyles.has(Number(attr(a, 's'))) && Number.isFinite(num)) v = new Date(epoch + Math.floor(num) * 86400_000).toISOString().slice(0, 10)
        // 6.012003E8 → 601200300
        else v = /e/i.test(raw) && Number.isFinite(num) ? String(num) : raw
      }
      v = v.trim()
      if (!v) continue
      while (cells.length < col) cells.push('')
      cells[col] = v
    }
    // пропущенные строки — пустая строка-разделитель
    if (n > prev + 1) rows.push({ n: prev + 1, cells: [] })
    rows.push({ n, cells })
    prev = n
  }
  return { name, rows }
}

/** Файл .xlsx → листы по порядку книги */
export async function readXlsx(buf: ArrayBuffer): Promise<Sheet[]> {
  const read = openZip(buf)
  const book = await read('xl/workbook.xml')
  if (!book) throw new Error('no workbook.xml')
  const wb = noNs(book)
  const rels = new Map(
    [...noNs((await read('xl/_rels/workbook.xml.rels')) ?? '').matchAll(/<Relationship\b([^>]*)>/g)].map((m) => [attr(m[1], 'Id'), attr(m[1], 'Target')]),
  )
  const strings = [...noNs((await read('xl/sharedStrings.xml')) ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g)].map((m) => runs(m[1] ?? ''))

  const styles = noNs((await read('xl/styles.xml')) ?? '')
  const custom = new Map([...styles.matchAll(/<numFmt\b([^>]*)>/g)].map((m) => [Number(attr(m[1], 'numFmtId')), attr(m[1], 'formatCode')]))
  const xfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? ''
  const dateStyles = new Set<number>()
  ;[...xfs.matchAll(/<xf\b([^>]*)>/g)].forEach((m, i) => {
    const id = Number(attr(m[1], 'numFmtId'))
    if (DATE_FMT_IDS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))) dateStyles.add(i)
  })
  const date1904 = /<workbookPr\b[^>]*\sdate1904="(1|true)"/.test(wb)

  const sheets: Sheet[] = []
  for (const m of wb.matchAll(/<sheet\b([^>]*)>/g)) {
    const target = rels.get(attr(m[1], 'r:id') || attr(m[1], 'id'))
    if (!target) continue
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')
    const xml = await read(path)
    if (xml) sheets.push(parseXlsxSheet(attr(m[1], 'name'), xml, strings, dateStyles, date1904))
  }
  return sheets
}

// ---------- .csv ----------

/** Текст .csv → один лист; разделитель — «;», табуляция или «,», что чаще в первой строке */
export function csvSheet(text: string): Sheet {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const count = (c: string) => first.split(c).length - 1
  const sep = [';', '\t', ','].reduce((a, b) => (count(b) > count(a) ? b : a))
  const rows: SheetRow[] = []
  let cells: string[] = []
  let cur = ''
  let quoted = false
  const endRow = () => {
    cells.push(cur.trim())
    rows.push({ n: rows.length + 1, cells: cells.some(Boolean) ? cells : [] })
    cells = []
    cur = ''
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"' && !cur.trim()) quoted = true
    else if (c === sep && count(sep)) {
      cells.push(cur.trim())
      cur = ''
    } else if (c === '\n') endRow()
    else if (c !== '\r') cur += c
  }
  if (cur || cells.length) endRow()
  return { name: '', rows }
}

// ---------- лист → заказы ----------

// столбцы-нумерация: «Lp.», «№», «№ п/п»
const IGNORE = new Set(['', 'lp', 'nr', 'no', 'n', 'п/п', 'n п/п'])
// первая подпись поля — её и понимает разбор текста
const CANON = new Map<TextField, string>()
for (const [label, f] of LABEL_OF) if (!CANON.has(f)) CANON.set(f, label)

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ')

/** Лист → куски текста для разбора: по строке на заказ, если нашлась строка заголовков.
 *  skipped — строки сверх MAX_ROWS */
export function sheetBlocks(sheet: Sheet): { blocks: SheetBlock[]; skipped: number } {
  const { rows } = sheet
  // заголовки — в первых строках, хотя бы два знакомых столбца
  const hi = rows.slice(0, 10).findIndex((r) => r.cells.filter((c) => LABEL_OF.has(cleanLabel(c))).length >= 2)
  if (hi < 0) {
    const text = rows
      .map(({ cells }) => {
        const c = cells.filter(Boolean).map(oneLine)
        return c.length > 1 ? `${c[0]}: ${c.slice(1).join(' ')}` : (c[0] ?? '')
      })
      .join('\n')
    return { blocks: splitOrders(text).map((text) => ({ row: null, text, table: false })), skipped: 0 }
  }

  const head = rows[hi].cells
  const fields = head.map((h) => LABEL_OF.get(cleanLabel(h)))
  const data = rows.slice(hi + 1).filter((r) => r.cells.length)
  const blocks = data.slice(0, MAX_ROWS).map((r) => {
      const lines: string[] = []
      const notes: string[] = []
      r.cells.forEach((v, i) => {
        if (!v) return
        const f = fields[i]
        const h = (head[i] ?? '').replace(/[:=\t]/g, ' ').trim()
        if (f === 'notes') notes.push(`${CANON.get(f)}: ${v}`)
        else if (f) lines.push(`${CANON.get(f)}: ${oneLine(v)}`)
        // незнакомый столбец — в примечания с его названием
        else if (!IGNORE.has(cleanLabel(h))) lines.push(h ? `${h}: ${oneLine(v)}` : oneLine(v))
      })
      // примечания в конце: их продолжение на следующих строках не захватит другие столбцы
      return { row: r.n, text: [...lines, ...notes].join('\n'), table: true }
    })
  return { blocks, skipped: Math.max(0, data.length - MAX_ROWS) }
}

export const isSheetFile = (name: string) => /\.(ods|xlsx|xlsm|csv|tsv)$/i.test(name)

/** Любой файл-таблица → листы */
export async function readSheets(name: string, buf: ArrayBuffer, decode: (b: ArrayBuffer) => string): Promise<Sheet[]> {
  if (/\.ods$/i.test(name)) return readOds(buf)
  if (/\.xls[xm]$/i.test(name)) return readXlsx(buf)
  return [csvSheet(decode(buf))]
}
