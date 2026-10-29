import { useEffect, useState } from 'react'
import { useSettings } from '../settingsHooks'
import { syncNow, useSyncStatus } from '../sync'

export type Section = 'orders' | 'clients' | 'calendar' | 'stats' | 'calc' | 'import' | 'sync' | 'settings'

const PATHS: Record<Section, string> = {
  orders: '/',
  clients: '/clients',
  calendar: '/calendar',
  stats: '/stats',
  calc: '/calc',
  import: '/import',
  sync: '/sync',
  settings: '/settings',
}

const go = (path: string) => {
  location.hash = path
  window.scrollTo(0, 0)
}

// Шапка разделов: слева меню (шторка с разделами), по центру Windauto — на главный экран
export default function TopBar({ current }: { current: Section }) {
  const { t } = useSettings()
  const sync = useSyncStatus()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const warn = sync.connected && (sync.authError || !!sync.error || !sync.online)
  const syncIcon = sync.syncing ? '⟳' : warn ? '⚠' : sync.pending ? '↑' : '✓'
  const syncState = !sync.connected
    ? t('menu.syncOff')
    : sync.syncing
      ? t('sync.syncing')
      : !sync.online
        ? t('sync.offline')
        : sync.authError || sync.error
          ? t('menu.syncError')
          : sync.pending
            ? t('sync.pending', { n: sync.pending })
            : t('sync.ok')

  const nav = (s: Section) => {
    setOpen(false)
    if (s !== current) go(PATHS[s])
  }

  const items: { id: Section; icon: string; label: string; hint?: string }[] = [
    { id: 'orders', icon: '📋', label: t('menu.orders') },
    { id: 'clients', icon: '👥', label: t('menu.clients') },
    { id: 'calendar', icon: '📅', label: t('menu.calendar') },
    { id: 'import', icon: '📄', label: t('menu.import') },
    { id: 'stats', icon: '📊', label: t('stats.title') },
    { id: 'calc', icon: '🧮', label: t('menu.calc') },
    { id: 'sync', icon: '☁', label: t('menu.sync'), hint: syncState },
    { id: 'settings', icon: '⚙', label: t('app.settings') },
  ]

  return (
    <>
      <header className="topbar centered">
        <button className="icon-btn menu-btn" aria-label={t('menu.open')} aria-expanded={open} onClick={() => setOpen(true)}>
          ☰{warn && <span className="menu-dot" />}
        </button>
        <button className="brand-btn" onClick={() => nav('orders')} aria-label={t('menu.home')}>
          Windauto
        </button>
        <span className="topbar-spacer" />
      </header>

      <div className={'drawer-backdrop' + (open ? ' open' : '')} onClick={() => setOpen(false)} />
      <nav className={'drawer' + (open ? ' open' : '')} aria-hidden={!open} inert={!open}>
        <div className="drawer-head">Windauto</div>
        {items.map((it) => (
          <div key={it.id} className={'drawer-row' + (it.id === current ? ' active' : '')}>
            <button className="drawer-item" aria-current={it.id === current ? 'page' : undefined} onClick={() => nav(it.id)}>
              <span className="drawer-icon">{it.icon}</span>
              <span className="drawer-text">
                {it.label}
                {it.hint && <small className={warn && it.id === 'sync' ? 'warn' : ''}>{it.hint}</small>}
              </span>
            </button>
            {it.id === 'sync' && sync.connected && !sync.authError && (
              <button
                className={'sync-badge' + (warn ? ' warn' : '') + (sync.syncing ? ' spin' : '')}
                aria-label={t('sync.now')}
                disabled={sync.syncing}
                onClick={() => syncNow()}
              >
                {syncIcon}
              </button>
            )}
          </div>
        ))}
        <p className="drawer-foot">{t('set.version', { v: __APP_VERSION__ })}</p>
      </nav>
    </>
  )
}
