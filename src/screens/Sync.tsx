import SyncSection from '../components/SyncSection'
import TopBar from '../components/TopBar'

// Раздел «Синхронизация»: вход в общую базу, сотрудники, свой email и пароль
export default function Sync() {
  return (
    <div className="screen">
      <TopBar current="sync" />
      <main className="content">
        <SyncSection />
      </main>
    </div>
  )
}
