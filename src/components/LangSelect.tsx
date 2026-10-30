import { LANGS, isLang, type Lang } from '../i18n'

/** Выпадающий список языков */
export default function LangSelect({ value, onChange, label }: { value: Lang; onChange: (l: Lang) => void; label: string }) {
  return (
    <select className="lang-select" aria-label={label} value={value} onChange={(e) => isLang(e.target.value) && onChange(e.target.value)}>
      {LANGS.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  )
}
