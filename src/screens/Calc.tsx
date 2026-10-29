import { useEffect, useState } from 'react'
import TopBar from '../components/TopBar'
import { EMPTY, currentValue, formatExpr, formatNum, press, putValue, round, type CalcState, type Key, type Op } from '../calc'
import { useSettings } from '../settingsHooks'

const STORE_KEY = 'windauto.calc.v1'
const HISTORY_MAX = 30

interface Saved {
  // число в памяти (M); null — память пуста
  memory: number | null
  history: { expr: (number | Op)[]; value: number }[]
}

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? '') as Saved
    return { memory: typeof s.memory === 'number' ? s.memory : null, history: Array.isArray(s.history) ? s.history : [] }
  } catch {
    return { memory: null, history: [] }
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s))
  } catch {
    /* только на эту сессию */
  }
}

// клавиатура компьютера → кнопки
const KEYBOARD: Record<string, Key> = {
  Enter: '=', '=': '=', Backspace: 'back', Escape: 'C', Delete: 'C', ',': '.', '.': '.',
  '+': '+', '-': '-', '*': '*', '/': '/', '%': '%',
}

const PAD: { k: Key; label: string; cls?: string }[] = [
  { k: 'C', label: 'C', cls: 'fn' },
  { k: 'back', label: '⌫', cls: 'fn' },
  { k: '%', label: '%', cls: 'fn' },
  { k: '/', label: '÷', cls: 'op' },
  { k: '7', label: '7' }, { k: '8', label: '8' }, { k: '9', label: '9' },
  { k: '*', label: '×', cls: 'op' },
  { k: '4', label: '4' }, { k: '5', label: '5' }, { k: '6', label: '6' },
  { k: '-', label: '−', cls: 'op' },
  { k: '1', label: '1' }, { k: '2', label: '2' }, { k: '3', label: '3' },
  { k: '+', label: '+', cls: 'op' },
  { k: '±', label: '±' }, { k: '0', label: '0' }, { k: '.', label: ',' },
  { k: '=', label: '=', cls: 'eq' },
]

// Калькулятор с памятью (MC, MR, M+, M−) и историей; память и история сохраняются на телефоне
export default function Calc() {
  const { t, locale } = useSettings()
  const [st, setSt] = useState<CalcState>(EMPTY)
  const [saved, setSaved] = useState<Saved>(load)
  const [copied, setCopied] = useState(false)

  const update = (next: Saved) => {
    setSaved(next)
    save(next)
  }

  const key = (k: Key) => {
    const next = press(st, k)
    // посчитанный пример — в историю
    if (k === '=' && next.shown && next.shown !== st.shown)
      update({ ...saved, history: [next.shown, ...saved.history].slice(0, HISTORY_MAX) })
    setSt(next)
  }

  const value = currentValue(st)
  const memAdd = (sign: 1 | -1) => update({ ...saved, memory: round((saved.memory ?? 0) + sign * value) })

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = /^[0-9]$/.test(e.key) ? (e.key as Key) : KEYBOARD[e.key]
      if (!k) return
      e.preventDefault()
      key(k)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value).replace('.', ','))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* буфер обмена недоступен */
    }
  }

  const main = st.error ? t('calc.error') : st.entry ? formatNum(st.entry, locale) : formatNum(value, locale)
  const expr = st.shown
    ? formatExpr(st.shown.expr, locale) + ' ='
    : formatExpr(st.tokens, locale)

  return (
    <div className="screen">
      <TopBar current="calc" />
      <main className="content calc">
        <section className="calc-display" aria-live="polite">
          <div className="calc-top">
            <span className={'calc-mem' + (saved.memory !== null ? ' on' : '')}>
              {saved.memory !== null && <>M = {formatNum(saved.memory, locale)}</>}
            </span>
            <button className="link-btn" onClick={copy} aria-label={t('calc.copy')}>
              {copied ? t('calc.copied') : '⧉ ' + t('calc.copy')}
            </button>
          </div>
          <div className="calc-expr">{expr || ' '}</div>
          <div className={'calc-main' + (main.length > 12 ? ' long' : '')}>{main}</div>
        </section>

        <div className="calc-mrow" role="group" aria-label={t('calc.memory')}>
          <button className="calc-key mem" disabled={saved.memory === null} onClick={() => update({ ...saved, memory: null })}>MC</button>
          <button className="calc-key mem" disabled={saved.memory === null} onClick={() => saved.memory !== null && setSt(putValue(st, saved.memory))}>MR</button>
          <button className="calc-key mem" onClick={() => memAdd(1)}>M+</button>
          <button className="calc-key mem" onClick={() => memAdd(-1)}>M−</button>
        </div>

        <div className="calc-pad">
          {PAD.map((b) => (
            <button key={b.k} className={'calc-key' + (b.cls ? ' ' + b.cls : '')} onClick={() => key(b.k)}>
              {b.label}
            </button>
          ))}
        </div>

        <section className="panel">
          <h2>{t('calc.history')}</h2>
          {saved.history.length === 0 ? (
            <p className="muted">{t('calc.noHistory')}</p>
          ) : (
            <>
              <ul className="plain-list calc-history">
                {saved.history.map((h, i) => (
                  <li key={i}>
                    <button className="calc-hist-item" onClick={() => setSt(putValue(st, h.value))}>
                      <span className="muted">{formatExpr(h.expr, locale)} =</span>
                      <b>{formatNum(h.value, locale)}</b>
                    </button>
                  </li>
                ))}
              </ul>
              <button className="btn small ghost" onClick={() => update({ ...saved, history: [] })}>
                {t('calc.clearHistory')}
              </button>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
