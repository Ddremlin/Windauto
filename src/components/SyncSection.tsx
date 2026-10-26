import { useEffect, useState } from 'react'
import { useSettings } from '../settingsHooks'
import {
  changePassword,
  connect,
  createUser,
  deleteUser,
  disconnect,
  listUsers,
  patchUser,
  syncNow,
  useSyncStatus,
  type SyncUser,
} from '../sync'

export default function SyncSection() {
  const { t, locale } = useSettings()
  const st = useSyncStatus()
  const [server, setServer] = useState(st.server)
  const [login, setLogin] = useState(st.user?.login ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const doConnect = async () => {
    setBusy(true)
    setErr('')
    try {
      await connect(server, login, password)
      setPassword('')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!st.connected || st.authError) {
    return (
      <section className="panel">
        <h2>☁ {t('sync.title')}</h2>
        <p className="hint">{st.authError ? t('sync.authError') : t('sync.hint')}</p>
        <div className="stack">
          <label className="field">
            <span className="field-label">{t('sync.server')}</span>
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="1.2.3.4.sslip.io" inputMode="url" autoCapitalize="off" autoCorrect="off" />
          </label>
          <div className="grid">
            <label className="field">
              <span className="field-label">{t('sync.login')}</span>
              <input value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="off" autoCorrect="off" autoComplete="username" />
            </label>
            <label className="field">
              <span className="field-label">{t('sync.password')}</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && doConnect()} />
            </label>
          </div>
          {err && <p className="error-text">{err}</p>}
          <button className="btn primary" disabled={busy || !server || !login || !password} onClick={doConnect}>
            {busy ? t('sync.connecting') : t('sync.connect')}
          </button>
        </div>
      </section>
    )
  }

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
          <MyPassword />
        </div>
      </section>
      {st.user?.role === 'admin' && <UsersAdmin me={st.user} />}
    </>
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
      setErr((e as Error).message)
    }
  }
  return (
    <div className="grid">
      <label className="field">
        <span className="field-label">{t('users.oldPass')}</span>
        <input type="password" value={oldP} onChange={(e) => setOldP(e.target.value)} autoComplete="current-password" />
      </label>
      <label className="field">
        <span className="field-label">{t('users.newPass')}</span>
        <input type="password" value={newP} onChange={(e) => setNewP(e.target.value)} autoComplete="new-password" />
      </label>
      {err && <p className="error-text wide">{err}</p>}
      <button className="btn primary wide" disabled={!oldP || newP.length < 6} onClick={save}>
        {t('users.changeMy')}
      </button>
    </div>
  )
}

function UsersAdmin({ me }: { me: SyncUser }) {
  const { t } = useSettings()
  const [users, setUsers] = useState<SyncUser[]>([])
  const [form, setForm] = useState({ login: '', name: '', password: '', role: 'staff' as 'staff' | 'admin' })
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)

  const reload = () => listUsers().then(setUsers).catch((e) => setErr(e.message))
  useEffect(() => {
    reload()
  }, [])

  const run = async (fn: () => Promise<unknown>) => {
    setErr('')
    try {
      await fn()
      await reload()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const create = () =>
    run(async () => {
      await createUser(form)
      setForm({ login: '', name: '', password: '', role: 'staff' })
      setAdding(false)
      alert(t('users.created'))
    })

  return (
    <section className="panel">
      <h2>👥 {t('users.title')}</h2>
      <ul className="users">
        {users.map((u) => (
          <li key={u.id} className={u.disabled ? 'off' : ''}>
            <div>
              <b>{u.name || u.login}</b> <span className="muted">@{u.login}</span>
              <div className="muted">
                {u.role === 'admin' ? t('users.admin') : t('users.staff')}
                {u.disabled && ` · ${t('users.disabled')}`}
                {u.id === me.id && ` · ${t('users.you')}`}
              </div>
            </div>
            {u.id !== me.id && (
              <div className="user-actions">
                <button
                  className="btn small"
                  onClick={() => {
                    const p = prompt(t('users.resetPrompt', { name: u.name || u.login }))
                    if (p) run(() => patchUser(u.id, { password: p }))
                  }}
                >
                  {t('users.resetPass')}
                </button>
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
        ))}
      </ul>
      {err && <p className="error-text">{err}</p>}
      {adding ? (
        <div className="stack">
          <div className="grid">
            <label className="field">
              <span className="field-label">{t('users.login')}</span>
              <input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value.toLowerCase() })} autoCapitalize="off" autoCorrect="off" />
            </label>
            <label className="field">
              <span className="field-label">{t('users.name')}</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span className="field-label">{t('users.password')}</span>
            <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
          </label>
          <div className="seg-row two">
            {(['staff', 'admin'] as const).map((r) => (
              <button key={r} className={'seg' + (form.role === r ? ' active' : '')} onClick={() => setForm({ ...form, role: r })}>
                {r === 'admin' ? t('users.admin') : t('users.staff')}
              </button>
            ))}
          </div>
          <button className="btn primary" disabled={form.login.length < 3 || form.password.length < 6} onClick={create}>
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
