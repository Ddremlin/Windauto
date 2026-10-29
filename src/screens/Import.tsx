import { useRef, useState } from 'react'
import { getLayout } from '../body'
import { PlateBadge } from '../components/Plate'
import TopBar from '../components/TopBar'
import { useSettings } from '../settingsHooks'
import { newOrder } from '../storage'
import { canRecognize, parseVoice } from '../sync'
import { isSheetFile, readSheets, sheetBlocks } from '../sheetImport'
import { decodeText, parseOrderText, parsedToPatch, splitOrders } from '../textImport'
import type { Order } from '../types'
import { applyVoice } from '../voice'
import { DAMAGES, WORKS } from '../works'

interface Props {
  onCreate: (orders: Order[]) => void
}

interface Block {
  source: string
  text: string
  /** строка таблицы с заголовками — поля уже по столбцам */
  table?: boolean
}

interface Item extends Block {
  patch: Partial<Order>
  include: boolean
}

type SortBy = 'file' | 'plate' | 'car' | 'client' | 'due'
const SORTS: SortBy[] = ['file', 'plate', 'car', 'client', 'due']
const sortKey: Record<Exclude<SortBy, 'file'>, (p: Partial<Order>) => string> = {
  plate: (p) => p.plate ?? '',
  car: (p) => [p.make, p.model].filter(Boolean).join(' '),
  client: (p) => p.client ?? '',
  due: (p) => p.dueDate ?? '',
}

// ограничение сервера на текст для разбора
const AI_MAX = 4000

// Заказы из текстовых файлов: разбор на телефоне, в общей базе — ещё и ИИ на сервере
export default function Import({ onCreate }: Props) {
  const { t, locale, settings } = useSettings()
  const fileRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [pasted, setPasted] = useState('')
  const [useAi, setUseAi] = useState(canRecognize)
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<Item[] | null>(null)
  const [sortBy, setSortBy] = useState<SortBy>('file')
  const [notes, setNotes] = useState<string[]>([])

  const parse = async () => {
    setBusy(true)
    const msgs: string[] = []
    const blocks: Block[] = []
    for (const f of files) {
      try {
        const buf = await f.arrayBuffer()
        if (isSheetFile(f.name)) {
          const sheets = await readSheets(f.name, buf, decodeText)
          for (const sh of sheets) {
            const { blocks: list, skipped } = sheetBlocks(sh)
            if (skipped) msgs.push(t('imp.tooMany', { name: sh.name || f.name, n: list.length, skipped }))
            list.forEach((b, i) =>
              blocks.push({
                source: [
                  f.name,
                  sheets.length > 1 && sh.name,
                  b.row ? t('imp.row', { n: b.row }) : list.length > 1 && String(i + 1),
                ]
                  .filter(Boolean)
                  .join(' · '),
                text: b.text,
                table: b.table,
              }),
            )
          }
          continue
        }
        const parts = splitOrders(decodeText(buf))
        parts.forEach((text, i) => blocks.push({ source: parts.length > 1 ? `${f.name} · ${i + 1}` : f.name, text }))
      } catch {
        msgs.push(t('imp.readFail', { name: f.name }))
      }
    }
    const parts = splitOrders(pasted)
    parts.forEach((text, i) => blocks.push({ source: `${t('imp.text')}${parts.length > 1 ? ` · ${i + 1}` : ''}`, text }))

    const base = newOrder()
    const layout = getLayout(base.bodyType)
    const lists = {
      elements: layout.elements.map((e) => ({ id: e.id, name: t(`el.${e.key}`) })),
      works: WORKS.map((w) => ({ id: w.id, name: t(`work.${w.id}`) })),
      damages: DAMAGES.map((d) => ({ id: d, name: t(`damage.${d}`) })),
    }
    const ids = new Set(layout.elements.map((e) => e.id))
    let ai = useAi && canRecognize()
    const out: Item[] = []
    for (const b of blocks) {
      let patch = parsedToPatch(parseOrderText(b.text))
      // строка таблицы уже разложена по столбцам — сотни запросов к ИИ ни к чему
      if (ai && !b.table) {
        if (b.text.length > AI_MAX && !msgs.includes(t('imp.tooLong'))) msgs.push(t('imp.tooLong'))
        try {
          const r = await parseVoice(b.text.slice(0, AI_MAX), lists)
          // поля, которые нашёл ИИ, точнее; срок и ответственного он не ищет
          patch = { ...patch, ...applyVoice(base, r, ids, settings.defaultPrices).patch }
        } catch (e) {
          msgs.push(t('imp.aiFail', { e: (e as Error).message }))
          // сервер недоступен или лимит — остальные без ИИ, чтобы не ждать каждую ошибку
          ai = false
        }
      }
      out.push({ ...b, patch, include: true })
    }
    setItems(out)
    setNotes(msgs)
    setBusy(false)
  }

  const reset = () => {
    setItems(null)
    setFiles([])
    setPasted('')
    setNotes([])
    if (fileRef.current) fileRef.current.value = ''
  }

  const chosen = items?.filter((i) => i.include) ?? []
  // n — место в файле: по нему отмечаем и возвращаем исходный порядок
  const shown = (items ?? []).map((it, n) => ({ it, n }))
  if (sortBy !== 'file') {
    const key = sortKey[sortBy]
    // пустые — в конце
    shown.sort((a, b) => {
      const x = key(a.it.patch)
      const y = key(b.it.patch)
      return !x !== !y ? (x ? -1 : 1) : x.localeCompare(y, locale, { numeric: true }) || a.n - b.n
    })
  }
  const create = () => {
    onCreate(chosen.map((i) => ({ ...newOrder(), ...i.patch })))
    reset()
  }

  const allOn = !!items?.length && items.every((i) => i.include)
  const setAll = (include: boolean) => setItems((list) => list && list.map((x) => ({ ...x, include })))
  const toggle = (n: number) => setItems((list) => list && list.map((x, i) => (i === n ? { ...x, include: !x.include } : x)))

  return (
    <div className="screen">
      <TopBar current="import" />
      <main className="content">
        {!items ? (
          <section className="panel">
            <p className="hint imp-hint">{t('imp.hint')}</p>
            <button className="btn wide-btn" onClick={() => fileRef.current?.click()}>
              📄 {t('imp.files')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.text,.md,.csv,.tsv,.ods,.xlsx,.xlsm,text/plain,text/csv,application/vnd.oasis.opendocument.spreadsheet,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              multiple
              hidden
              onChange={(e) => setFiles([...(e.target.files ?? [])])}
            />
            {files.length > 0 && (
              <ul className="plain-list imp-files">
                {files.map((f, i) => (
                  <li key={i}>
                    <span>{f.name}</span>
                    <button className="link-btn" aria-label={t('app.clear')} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="field imp-paste">
              <span className="field-label">{t('imp.paste')}</span>
              <textarea rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)} />
            </label>
            {canRecognize() && (
              <label className="consent-row imp-ai">
                <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
                <span>
                  {t('imp.ai')}
                  <small className="muted"> — {t('imp.aiHint')}</small>
                </span>
              </label>
            )}
            <button className="btn primary wide-btn" disabled={busy || (!files.length && !pasted.trim())} onClick={parse}>
              {busy ? t('imp.busy') : t('imp.parse')}
            </button>
          </section>
        ) : (
          <>
            {notes.map((n, i) => (
              <p key={i} className="hint warn-text">⚠ {n}</p>
            ))}
            <div className="imp-head">
              <p className="muted">{items.length ? t('imp.found', { n: items.length }) : t('imp.empty')}</p>
              {items.length > 1 && (
                <button className="btn small" onClick={() => setAll(!allOn)}>
                  {allOn ? '☐ ' + t('imp.none') : '☑ ' + t('imp.all')}
                </button>
              )}
            </div>
            {items.length > 1 && (
              <label className="field imp-sort">
                <span className="field-label">{t('imp.sort')}</span>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
                  {SORTS.map((s) => (
                    <option key={s} value={s}>
                      {t(`imp.sort.${s}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {shown.map(({ it, n }) => {
              const p = it.patch
              const car = [p.make, p.model, p.year].filter(Boolean).join(' ')
              const works = Object.values(p.elements ?? {}).filter((v) => v.works.length).length
              const known = Object.keys(p).some((k) => k !== 'notes')
              return (
                <label key={n} className={'card imp-card' + (it.include ? '' : ' off')}>
                  <div className="card-row">
                    <span className="imp-check">
                      <input type="checkbox" checked={it.include} onChange={() => toggle(n)} />
                      {p.plate ? <PlateBadge text={p.plate} country={p.plateCountry ?? 'PL'} height={26} /> : <b>{car || t('list.noPlate')}</b>}
                    </span>
                    <small className="muted imp-src">{it.source}</small>
                  </div>
                  {p.plate && car && <div className="muted">{car}</div>}
                  {(p.client || p.phone || p.email) && <div className="muted small">{[p.client, p.phone, p.email].filter(Boolean).join(' · ')}</div>}
                  {p.vin && <div className="muted small">VIN {p.vin}</div>}
                  {(p.dueDate || p.assignee) && (
                    <div className="muted small">
                      {[p.dueDate && '⏱ ' + new Date(p.dueDate + 'T12:00').toLocaleDateString(locale), p.assignee && `👷 ${p.assignee}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  )}
                  {works > 0 && <div className="muted small">{t('imp.works', { n: works })}</div>}
                  {p.notes && <div className="imp-notes">{p.notes}</div>}
                  {!known && <div className="hint">{t('imp.noFields')}</div>}
                </label>
              )
            })}
            <button className="btn primary wide-btn" disabled={!chosen.length} onClick={create}>
              {t('imp.create', { n: chosen.length })}
            </button>
            <button className="btn ghost wide-btn" onClick={reset}>
              {t('imp.again')}
            </button>
          </>
        )}
      </main>
    </div>
  )
}
