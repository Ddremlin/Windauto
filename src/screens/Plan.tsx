import { useCallback, useEffect, useState } from 'react'
import TopBar from '../components/TopBar'
import { useSettings } from '../settingsHooks'
import { ApiError, billingPortal, checkout, getPlan, refreshMe, useSyncStatus, type PlanInfo } from '../sync'

const GB = 1024 ** 3
// «1,5 ГБ» / «1,5 GB» — единицы на языке интерфейса
const size = (b: number, locale: string) =>
  b >= GB / 10
    ? new Intl.NumberFormat(locale, { style: 'unit', unit: 'gigabyte', maximumFractionDigits: 1 }).format(b / GB)
    : new Intl.NumberFormat(locale, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 0 }).format(b / 1024 ** 2)
const DAY = 86400_000

// Тариф компании: что действует сейчас, сколько использовано, что даёт Pro, оплата через Stripe (карта, BLIK)
export default function Plan() {
  const { t, locale } = useSettings()
  const sync = useSyncStatus()
  const [plan, setPlan] = useState<PlanInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const admin = sync.user?.role === 'admin'

  const load = useCallback(async () => {
    if (!sync.connected) return
    try {
      setPlan(await getPlan())
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [sync.connected])

  // вернулись со страницы оплаты — тариф мог смениться
  useEffect(() => {
    void load()
    const on = () => {
      if (document.visibilityState === 'visible') {
        void load()
        void refreshMe()
      }
    }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [load])

  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await f()
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined
      setError(code && t(`err.${code}`) !== `err.${code}` ? t(`err.${code}`) : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const date = (ms: number) => new Date(ms).toLocaleDateString(locale)
  const status = () => {
    if (!plan) return ''
    if (plan.plan === 'pro') return t('plan.manual')
    if (plan.plan === 'trial') return t('plan.trial', { n: Math.max(1, Math.ceil((plan.trialUntil - Date.now()) / DAY)) })
    if (plan.plan === 'paid') return plan.status === 'canceling' ? t('plan.canceling', { date: date(plan.paidUntil) }) : t('plan.paid', { date: date(plan.paidUntil) })
    return t('plan.free')
  }
  const isPro = plan ? plan.plan !== 'free' : false
  // подписка уже есть (или идёт) — оплачивать второй раз не нужно
  const subscribed = plan?.plan === 'paid' && ['active', 'trialing', 'past_due', 'canceling'].includes(plan.status)

  return (
    <div className="screen">
      <TopBar current="plan" />
      <main className="content">
        <section className="panel">
          <h2>⭐ {t('plan.title')}</h2>
          {!sync.connected ? (
            <p className="hint">{t('plan.local')}</p>
          ) : !plan ? (
            <p className="hint">{error || '…'}</p>
          ) : (
            <div className="stack">
              <div className={'plan-status' + (isPro ? ' pro' : '')}>{status()}</div>
              {plan.status === 'past_due' && <p className="warn-text">{t('plan.pastDue')}</p>}
              <div className="plan-usage">
                <b>{t('plan.usage')}</b>
                <Meter label={t('plan.storage', { used: size(plan.usage.bytes, locale), total: size(plan.usage.quota, locale) })} value={plan.usage.bytes} max={plan.usage.quota} />
                {plan.usage.maxUsers ? (
                  <Meter label={t('plan.users', { n: plan.usage.users, max: plan.usage.maxUsers })} value={plan.usage.users} max={plan.usage.maxUsers} />
                ) : (
                  <div className="hint">{t('plan.usersUnlimited', { n: plan.usage.users })}</div>
                )}
                {plan.usage.maxAi > 0 && <Meter label={t('plan.ai', { n: plan.usage.ai, max: plan.usage.maxAi })} value={plan.usage.ai} max={plan.usage.maxAi} />}
              </div>
              {sync.mediaFull && <p className="warn-text">{t('err.quota_free')}</p>}
            </div>
          )}
        </section>

        <section className="panel">
          <h2>{t('plan.features')}</h2>
          <ul className="plan-features">
            <li>🤖 {t('plan.f.ai', { n: 500 })}</li>
            <li>🎥 {t('plan.f.video')}</li>
            <li>☁ {t('plan.f.storage', { gb: 50, free: 1 })}</li>
            <li>👥 {t('plan.f.users', { n: 2 })}</li>
            <li>🏷 {t('plan.f.logo')}</li>
            <li>⭐ {t('plan.f.reviews')}</li>
            <li>📤 {t('plan.f.export')}</li>
            <li>🕓 {t('plan.f.history', { n: plan?.historyDays || 90 })}</li>
            <li>💬 {t('plan.f.support')}</li>
          </ul>
          {plan && (
            <p className="plan-prices">
              <b>{t('plan.month', { price: plan.prices.month })}</b>
              <br />
              {t('plan.year', { price: plan.prices.year })}
            </p>
          )}
        </section>

        {plan && (
          <section className="panel">
            {!admin ? (
              <p className="hint">{t('plan.adminOnly')}</p>
            ) : !plan.canPay ? (
              <p className="hint">{t('plan.noBilling')}</p>
            ) : (
              <div className="stack">
                {!subscribed && plan.plan !== 'pro' && (
                  <>
                    <button className="btn primary" disabled={busy} onClick={() => run(() => checkout('month'))}>
                      {busy ? t('plan.opening') : `${t('plan.payMonth')} — ${plan.prices.month} zł`}
                    </button>
                    <button className="btn" disabled={busy} onClick={() => run(() => checkout('year'))}>
                      {t('plan.payYear')} — {plan.prices.year} zł
                    </button>
                    <p className="hint">{t('plan.payHint')}</p>
                  </>
                )}
                {plan.customer && (
                  <button className="btn" disabled={busy} onClick={() => run(billingPortal)}>
                    {t('plan.manage')} <small className="hint">— {t('plan.manageHint')}</small>
                  </button>
                )}
                <button className="btn ghost" disabled={busy} onClick={() => run(load)}>
                  ⟳ {t('plan.refresh')}
                </button>
              </div>
            )}
            {error && <p className="warn-text">⚠ {error}</p>}
          </section>
        )}
      </main>
    </div>
  )
}

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100))
  return (
    <div className="meter">
      <div className="meter-label">{label}</div>
      <div className="meter-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <span style={{ width: pct + '%' }} className={pct >= 90 ? 'high' : ''} />
      </div>
    </div>
  )
}
