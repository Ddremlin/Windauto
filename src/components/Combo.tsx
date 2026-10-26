import { useMemo, useState, type Ref } from 'react'
import { norm, suggest } from '../cars'

interface Props {
  label: string
  value: string
  items: string[]
  onChange: (v: string) => void
  onPick?: (v: string) => void
  placeholder?: string
  inputRef?: Ref<HTMLInputElement>
}

// Поле с подсказками из списка: фильтр по первым буквам, но можно вписать и своё.
export default function Combo({ label, value, items, onChange, onPick, placeholder, inputRef }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const exact = items.find((it) => norm(it) === norm(value))
  // значение уже из списка — показываем весь список, чтобы было легко сменить
  const list = useMemo(() => (exact ? items : suggest(items, value)), [items, value, exact])

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    setActive(-1)
    onPick?.(v)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || !list.length) return
    if (e.key === 'ArrowDown') setActive((a) => (a + 1) % list.length)
    else if (e.key === 'ArrowUp') setActive((a) => (a <= 0 ? list.length - 1 : a - 1))
    else if (e.key === 'Enter' && active >= 0) pick(list[active])
    else if (e.key === 'Escape') setOpen(false)
    else return
    e.preventDefault()
  }

  return (
    <label className="field combo">
      <span className="field-label">{label}</span>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onBlur={() => {
          setOpen(false)
          // «skoda» → «Škoda»: приводим к написанию из списка
          if (exact && exact !== value) onChange(exact)
        }}
        onKeyDown={onKeyDown}
      />
      {open && list.length > 0 && (
        // mousedown не отдаёт фокус, иначе blur закроет список раньше клика
        <ul className="combo-list" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {list.map((it, i) => (
            <li
              key={it}
              role="option"
              aria-selected={it === exact}
              className={(i === active ? 'active' : '') + (it === exact ? ' current' : '')}
              onClick={() => pick(it)}
            >
              {it}
            </li>
          ))}
        </ul>
      )}
    </label>
  )
}
