import LangSelect from '../components/LangSelect'
import SyncSection from '../components/SyncSection'
import { useSettings } from '../settingsHooks'

// Первая страница без входа: вход и регистрация. Заказы — только после входа и только своей компании.
export default function Welcome() {
  const { t, settings, update } = useSettings()
  return (
    <div className="screen welcome">
      <main className="content">
        <div className="welcome-head">
          <h1>Windauto</h1>
          <p className="muted">{t('welcome.tagline')}</p>
          <LangSelect
            value={settings.lang}
            label={t('set.lang')}
            onChange={(lang) => update(lang === 'pl' ? { lang, docLang: 'pl' } : { lang })}
          />
        </div>
        <SyncSection />
      </main>
    </div>
  )
}
