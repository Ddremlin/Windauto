import { useEffect, useState } from 'react'
import type { T } from '../i18n'
import { UPDATE_SERVER } from '../native'
import PasswordInput from './PasswordInput'
import { useSettings } from '../settingsHooks'
import {
  ApiError,
  changeEmail,
  changePassword,
  connect,
  createUser,
  deleteOrg,
  deleteUser,
  disconnect,
  forgotPassword,
  getOrg,
  legalUrl,
  listOrgs,
  listUsers,
  patchUser,
  refreshMe,
  register,
  removeOrg,
  renameOrg,
  resendVerify,
  serverInfo,
  setOrgBlocked,
  syncNow,
  useSyncStatus,
  type OrgSummary,
  type SyncUser,
} from '../sync'

/** Текст ошибки на языке интерфейса: по коду от сервера, иначе — как прислал сервер */
function errText(t: T, e: unknown): string {
  const code = e instanceof ApiError ? e.code : undefined
  if (code && t(`err.${code}`) !== `err.${code}`) return t(`err.${code}`)
  return (e as Error).message
}

// сервер по умолчанию — свой; другой можно вписать
const DEFAULT_SERVER = UPDATE_SERVER.replace(/^https:\/\//, '')

type Mode = 'login' | 'register' | 'forgot'

export default function SyncSection() {
  const { t, locale } = useSettings()
  const st = useSyncStatus()

  if (!st.connected || st.authError) return <AuthPanel />

  const state = st.syncing
    ? t('sync.syncing')
    : !st.online
      ? t('sync.offline')
      : st.error
        ? t('sync.error', { e: st.error })
        : st.pending
          ? t('sync.pending', { n: st.pending })
          : t('sync.ok')

  return (
    <>
      <section className="panel">
        <h2>☁ {t('sync.title')}</h2>
        <div className="stack">
          <div>
            <div>
              <b>{t('sync.as', { name: st.user?.name || st.user?.login || '' })}</b>
              {st.user?.role === 'admin' && <span className="tag">{t('users.admin')}</span>}
            </div>
            {st.user?.orgName && <div>{st.user.orgName}</div>}
            <div className="hint">{st.server}</div>
          </div>
          <div className={'sync-state' + (st.error || !st.online ? ' warn' : '')}>{state}</div>
          {st.lastSyncAt > 0 && <p className="hint">{t('sync.last', { time: new Date(st.lastSyncAt).toLocaleString(locale) })}</p>}
          <div className="row">
            <button className="btn" disabled={st.syncing} onClick={() => syncNow()}>
              ⟳ {t('sync.now')}
            </button>
            <button className="btn ghost" onClick={() => confirm(t('sync.logoutConfirm')) && disconnect()}>
              {t('sync.logout')}
            </button>
          </div>
          <MyEmail me={st.user} />
          <MyPassword />
        </div>
      </section>
      {st.user?.role === 'admin' && <OrgPanel me={st.user} />}
      {st.user?.role === 'admin' && <UsersAdmin me={st.user} />}
      {st.user?.platform && <PlatformPanel />}
    </>
  )
}

function AuthPanel() {
  const { t, settings } = useSettings()
  const st = useSyncStatus()
  const [mode, setMode] = useState<Mode>('login')
  const [server, setServer] = useState(st.server.replace(/^https:\/\//, '') || DEFAULT_SERVER)
  const [login, setLogin] = useState(st.user?.login ?? '')
  const [password, setPassword] = useState('')
  const [reg, setReg] = useState({ company: '', name: '', email: '', password: '', accept: false })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [errCode, setErrCode] = useState('')
  // письмо отправлено на этот адрес — ждём подтверждения
  const [sentTo, setSentTo] = useState('')
  const [notice, setNotice] = useState('')
  const [canRegister, setCanRegister] = useState(true)

  useEffect(() => {
    if (!server) return
    const id = setTimeout(() => {
      serverInfo(server)
        .then((i) => setCanRegister(i.registration !== false))
        .catch(() => setCanRegister(true))
    }, 500)
    return () => clearTimeout(id)
  }, [server])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setErr('')
    setErrCode('')
    setNotice('')
    try {
      await fn()
    } catch (e) {
      setErr(errText(t, e))
      setErrCode(e instanceof ApiError ? (e.code ?? '') : '')
    } finally {
      setBusy(false)
    }
  }

  const go = (m: Mode) => {
    setMode(m)
    setErr('')
    setErrCode('')
    setNotice('')
  }

  const doLogin = () =>
    run(async () => {
      const ok = await connect(server, login, password, () => confirm(t('auth.switchOrg')))
      if (ok) setPassword('')
    })

  const doRegister = () =>
    run(async () => {
      await register(server, { ...reg, lang: settings.lang })
      setSentTo(reg.email.trim())
      setLogin(reg.email.trim())
      setReg({ ...reg, password: '' })
      go('login')
    })

  const resend = (email: string) =>
    run(async () => {
      await resendVerify(server, email)
      setNotice(t('auth.resent'))
    })

  const serverField = (
    <label className="field">
      <span className="field-label">{t('sync.server')}</span>
      <input value={server} onChange={(e) => setServer(e.target.value)} placeholder={DEFAULT_SERVER} inputMode="url" autoCapitalize="off" autoCorrect="off" />
    </label>
  )

  if (mode === 'register')
    return (
      <section className="panel">
        <h2>{t('auth.registerTitle')}</h2>
        <p className="hint">{t('auth.registerHint')}</p>
        <div className="stack">
          <label className="field">
            <span className="field-label">{t('auth.company')}</span>
            <input value={reg.company} onChange={(e) => setReg({ ...reg, company: e.target.value })} autoComplete="organization" />
          </label>
          <label className="field">
            <span className="field-label">{t('auth.yourName')}</span>
            <input value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} autoComplete="name" />
          </label>
          <label className="field">
            <span className="field-label">{t('auth.email')}</span>
            <input type="email" value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} autoComplete="email" autoCapitalize="off" autoCorrect="off" />
          </label>
          <label className="field">
            <span className="field-label">{t('auth.password')}</span>
            <PasswordInput value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} autoComplete="new-password" />
          </label>
          <label className="accept">
            <input type="checkbox" checked={reg.accept} onChange={(e) => setReg({ ...reg, accept: e.target.checked })} />
            <span>
              {t('auth.acceptPre')}{' '}
              <a href={legalUrl(server, 'terms', settings.lang)} target="_blank" rel="noreferrer">
                {t('auth.terms')}
              </a>{' '}
              {t('auth.and')}{' '}
              <a href={legalUrl(server, 'privacy', settings.lang)} target="_blank" rel="noreferrer">
                {t('auth.privacy')}
              </a>
            </span>
          </label>
          {serverField}
          {err && <p className="error-text">{err}</p>}
          <button
            className="btn primary"
            disabled={busy || !server || reg.company.trim().length < 2 || !reg.email.includes('@') || reg.password.length < 8 || !reg.accept}
            onClick={doRegister}
          >
            {busy ? t('sync.connecting') : t('auth.create')}
          </button>
          <button className="link-btn" onClick={() => go('login')}>
            {t('auth.back')}
          </button>
        </div>
      </section>
    )

  if (mode === 'forgot')
    return (
      <section className="panel">
        <h2>{t('auth.forgotTitle')}</h2>
        <p className="hint">{t('auth.forgotHint')}</p>
        <div className="stack">
          <label className="field">
            <span className="field-label">{t('auth.email')}</span>
            <input type="email" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="email" autoCapitalize="off" autoCorrect="off" />
          </label>
          {serverField}
          {err && <p className="error-text">{err}</p>}
          {notice && <p className="hint">{notice}</p>}
          <button
            className="btn primary"
            disabled={busy || !server || !login.trim()}
            onClick={() =>
              run(async () => {
                await forgotPassword(server, login.trim())
                setNotice(t('auth.forgotSent'))
              })
            }
          >
            {t('auth.send')}
          </button>
          <button className="link-btn" onClick={() => go('login')}>
            {t('auth.back')}
          </button>
        </div>
      </section>
    )

  return (
    <section className="panel">
      <h2>☁ {t('sync.title')}</h2>
      <p className="hint">{st.authError ? t('sync.authError') : t('sync.hint')}</p>
      {sentTo && <p className="notice">{t('auth.checkMail', { email: sentTo })}</p>}
      <div className="stack">
        <label className="field">
          <span className="field-label">{t('sync.login')}</span>
          <input value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="off" autoCorrect="off" autoComplete="username" inputMode="email" />
        </label>
        <label className="field">
          <span className="field-label">{t('sync.password')}</span>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && doLogin()} />
        </label>
        {serverField}
        {err && <p className="error-text">{err}</p>}
        {notice && <p className="hint">{notice}</p>}
        {(errCode === 'unverified' || sentTo) && (
          <button className="link-btn" disabled={busy} onClick={() => resend(sentTo || login.trim())}>
            {t('auth.resend')}
          </button>
        )}
        <button className="btn primary" disabled={busy || !server || !login || !password} onClick={doLogin}>
          {busy ? t('sync.connecting') : t('sync.connect')}
        </button>
        <button className="link-btn" onClick={() => go('forgot')}>
          {t('auth.forgot')}
        </button>
        {canRegister && (
          <button className="btn" onClick={() => go('register')}>
            ＋ {t('auth.register')}
          </button>
        )}
      </div>
    </section>
  )
}

/** Свой email — для входа и восстановления пароля */
function MyEmail({ me }: { me: SyncUser | null }) {
  const { t } = useSettings()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // ссылку из письма открывают в браузере — данные о себе обновляем при каждом показе
  useEffect(() => {
    refreshMe()
  }, [])
  const save = async () => {
    setErr('')
    setBusy(true)
    try {
      await changeEmail(email.trim(), pass)
      setOpen(false)
      setEmail('')
      setPass('')
    } catch (e) {
      setErr(errText(t, e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stack">
      <div>
        <span className="field-label">{t('me.email')}: </span>
        {me?.email ? <b>{me.email}</b> : <span className="muted">{t('me.noEmail')}</span>}
      </div>
      {me?.newEmail && <p className="notice">{t('me.checkMail', { email: me.newEmail })}</p>}
      {!open ? (
        <button className="link-btn" onClick={() => setOpen(true)}>
          {t(me?.email ? 'me.change' : 'me.add')}
        </button>
      ) : (
        <div className="grid">
          <label className="field">
            <span className="field-label">{t('me.newEmail')}</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="off" autoCorrect="off" />
          </label>
          <label className="field">
            <span className="field-label">{t('me.password')}</span>
            <PasswordInput value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
          </label>
          {err && <p className="error-text wide">{err}</p>}
          <button className="btn primary wide" disabled={busy || !email.includes('@') || !pass} onClick={save}>
            {t('me.send')}
          </button>
        </div>
      )}
    </div>
  )
}

function MyPassword() {
  const { t } = useSettings()
  const [open, setOpen] = useState(false)
  const [oldP, setOldP] = useState('')
  const [newP, setNewP] = useState('')
  const [err, setErr] = useState('')
  if (!open)
    return (
      <button className="link-btn" onClick={() => setOpen(true)}>
        {t('users.changeMy')}
      </button>
    )
  const save = async () => {
    setErr('')
    try {
      await changePassword(oldP, newP)
      alert(t('users.saved'))
      setOpen(false)
      setOldP('')
      setNewP('')
    } catch (e) {
      setErr(errText(t, e))
    }
  }
  return (
    <div className="grid">
      <label className="field">
        <span className="field-label">{t('users.oldPass')}</span>
        <PasswordInput value={oldP} onChange={(e) => setOldP(e.target.value)} autoComplete="current-password" />
      </label>
      <label className="field">
        <span className="field-label">{t('users.newPass')}</span>
        <PasswordInput value={newP} onChange={(e) => setNewP(e.target.value)} autoComplete="new-password" />
      </label>
      {err && <p className="error-text wide">{err}</p>}
      <button className="btn primary wide" disabled={!oldP || newP.length < 8} onClick={save}>
        {t('users.changeMy')}
      </button>
    </div>
  )
}

/** Своя компания: название; владелец может удалить её со всеми данными */
function OrgPanel({ me }: { me: SyncUser }) {
  const { t } = useSettings()
  const [name, setName] = useState(me.orgName ?? '')
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getOrg()
      .then((o) => setName(o.name))
      .catch(() => {})
  }, [])

  const save = async () => {
    setErr('')
    try {
      await renameOrg(name)
      await refreshMe()
      setSaved(true)
    } catch (e) {
      setErr(errText(t, e))
    }
  }

  const remove = async () => {
    const p = prompt(t('org.deletePrompt', { name: me.orgName ?? '' }))
    if (!p) return
    try {
      await deleteOrg(p)
      alert(t('org.deleted'))
    } catch (e) {
      setErr(errText(t, e))
    }
  }

  return (
    <section className="panel">
      <h2>🏢 {t('org.title')}</h2>
      <div className="stack">
        <label className="field">
          <span className="field-label">{t('org.name')}</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setSaved(false)
            }}
          />
        </label>
        {err && <p className="error-text">{err}</p>}
        <button className="btn" disabled={name.trim().length < 2 || name.trim() === me.orgName} onClick={save}>
          {saved ? t('org.saved') : t('org.save')}
        </button>
        {me.owner && !me.platform && (
          <>
            <p className="hint">{t('org.deleteHint')}</p>
            <button className="btn danger" onClick={remove}>
              {t('org.delete')}
            </button>
          </>
        )}
      </div>
    </section>
  )
}

function UsersAdmin({ me }: { me: SyncUser }) {
  const { t } = useSettings()
  const [users, setUsers] = useState<SyncUser[]>([])
  const [form, setForm] = useState({ login: '', email: '', name: '', password: '', role: 'staff' as 'staff' | 'admin' })
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  // владельца компании нельзя отключить или удалить — кнопки ему не показываем
  const [ownerId, setOwnerId] = useState('')

  const reload = () => listUsers().then(setUsers).catch((e) => setErr(errText(t, e)))
  useEffect(() => {
    reload()
    getOrg()
      .then((o) => setOwnerId(o.ownerId))
      .catch(() => {})
  }, [])

  const run = async (fn: () => Promise<unknown>) => {
    setErr('')
    try {
      await fn()
      await reload()
    } catch (e) {
      setErr(errText(t, e))
    }
  }

  const invite = Boolean(form.email.trim()) && !form.password
  const create = () =>
    run(async () => {
      await createUser(form)
      setForm({ login: '', email: '', name: '', password: '', role: 'staff' })
      setAdding(false)
      alert(invite ? t('users.inviteSent', { email: form.email.trim() }) : t('users.created'))
    })

  const canCreate = invite || ((form.login.length >= 3 || form.email.includes('@')) && form.password.length >= 8)

  return (
    <section className="panel">
      <h2>👥 {t('users.title')}</h2>
      <ul className="users">
        {users.map((u) => {
          const isOwner = u.id === ownerId
          return (
            <li key={u.id} className={u.disabled ? 'off' : ''}>
              <div>
                <b>{u.name || u.login}</b> <span className="muted">{u.email || '@' + u.login}</span>
                <div className="muted">
                  {u.role === 'admin' ? t('users.admin') : t('users.staff')}
                  {isOwner && ` · ${t('users.owner')}`}
                  {u.invited && ` · ${t('users.invited')}`}
                  {u.disabled && ` · ${t('users.disabled')}`}
                  {u.id === me.id && ` · ${t('users.you')}`}
                </div>
              </div>
              {u.id !== me.id && !isOwner && (
                <div className="user-actions">
                  {u.invited ? (
                    <button
                      className="btn small"
                      onClick={() =>
                        run(async () => {
                          await patchUser(u.id, { invite: true })
                          alert(t('users.inviteSent', { email: u.email ?? '' }))
                        })
                      }
                    >
                      {t('users.inviteAgain')}
                    </button>
                  ) : (
                    <button
                      className="btn small"
                      onClick={() => {
                        const p = prompt(t('users.resetPrompt', { name: u.name || u.login }))
                        if (p) run(() => patchUser(u.id, { password: p }))
                      }}
                    >
                      {t('users.resetPass')}
                    </button>
                  )}
                  <button className="btn small" onClick={() => run(() => patchUser(u.id, { disabled: !u.disabled }))}>
                    {u.disabled ? t('users.enable') : t('users.disable')}
                  </button>
                  <button
                    className="btn small danger"
                    onClick={() => confirm(t('users.deleteConfirm', { name: u.name || u.login })) && run(() => deleteUser(u.id))}
                  >
                    {t('users.delete')}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {err && <p className="error-text">{err}</p>}
      {adding ? (
        <div className="stack">
          <p className="hint">{t('users.inviteHint')}</p>
          <div className="grid">
            <label className="field">
              <span className="field-label">{t('users.name')}</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">{t('users.email')}</span>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoCapitalize="off" autoCorrect="off" />
            </label>
          </div>
          <label className="field">
            <span className="field-label">{t('users.login')}</span>
            <input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value.toLowerCase() })} autoCapitalize="off" autoCorrect="off" />
          </label>
          <label className="field">
            <span className="field-label">{t('users.password')}</span>
            <PasswordInput value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
          </label>
          <div className="seg-row two">
            {(['staff', 'admin'] as const).map((r) => (
              <button key={r} className={'seg' + (form.role === r ? ' active' : '')} onClick={() => setForm({ ...form, role: r })}>
                {r === 'admin' ? t('users.admin') : t('users.staff')}
              </button>
            ))}
          </div>
          <button className="btn primary" disabled={!canCreate} onClick={create}>
            {t('users.create')}
          </button>
        </div>
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>
          ＋ {t('users.add')}
        </button>
      )}
    </section>
  )
}

/** Владелец платформы: все компании — блокировка и удаление */
function PlatformPanel() {
  const { t, locale } = useSettings()
  const [orgs, setOrgs] = useState<OrgSummary[]>([])
  const [err, setErr] = useState('')

  const reload = () => listOrgs().then(setOrgs).catch((e) => setErr(errText(t, e)))
  useEffect(() => {
    reload()
  }, [])

  const run = async (fn: () => Promise<unknown>) => {
    setErr('')
    try {
      await fn()
      await reload()
    } catch (e) {
      setErr(errText(t, e))
    }
  }

  return (
    <section className="panel">
      <h2>🌐 {t('platform.title')}</h2>
      <ul className="users">
        {orgs.map((o) => (
          <li key={o.id} className={o.blocked ? 'off' : ''}>
            <div>
              <b>{o.name}</b> {o.blocked && <span className="tag danger">{t('platform.blocked')}</span>}
              <div className="muted">{[o.owner?.name, o.owner?.email || o.owner?.login].filter(Boolean).join(' · ')}</div>
              <div className="muted">
                {new Date(o.created).toLocaleDateString(locale)} · {t('platform.users', { n: o.users })} · {t('platform.orders', { n: o.orders })} ·{' '}
                {o.lastSeen ? t('platform.lastSeen', { time: new Date(o.lastSeen).toLocaleDateString(locale) }) : t('platform.never')}
              </div>
            </div>
            <div className="user-actions">
              <button
                className="btn small"
                onClick={() =>
                  (o.blocked || confirm(t('platform.blockConfirm', { name: o.name }))) && run(() => setOrgBlocked(o.id, !o.blocked))
                }
              >
                {o.blocked ? t('platform.unblock') : t('platform.block')}
              </button>
              <button className="btn small danger" onClick={() => confirm(t('platform.deleteConfirm', { name: o.name })) && run(() => removeOrg(o.id))}>
                {t('platform.delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {err && <p className="error-text">{err}</p>}
    </section>
  )
}
