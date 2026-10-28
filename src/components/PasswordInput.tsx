import { useState, type InputHTMLAttributes } from 'react'
import { useT } from '../settingsHooks'

// поле пароля с кнопкой «показать / скрыть»
export default function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const t = useT()
  const [shown, setShown] = useState(false)
  return (
    <span className="pass-wrap">
      <input {...props} type={shown ? 'text' : 'password'} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <button
        type="button"
        className="pass-eye"
        aria-label={t(shown ? 'auth.hidePass' : 'auth.showPass')}
        aria-pressed={shown}
        onClick={(e) => {
          e.preventDefault()
          setShown(!shown)
        }}
      >
        {shown ? '🙈' : '👁'}
      </button>
    </span>
  )
}
