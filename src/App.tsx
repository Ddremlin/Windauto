import { useCallback, useEffect, useState } from 'react'
import AppUpdate from './components/AppUpdate'
import { RemindersBanner } from './components/Reminders'
import { useReminderService } from './components/useReminderService'
import Calc from './screens/Calc'
import Calendar from './screens/Calendar'
import { ClientList, ClientPage } from './screens/Clients'
import { clientPath, listClients } from './clients'
import Import from './screens/Import'
import OrderEdit from './screens/OrderEdit'
import OrderList from './screens/OrderList'
import Settings from './screens/Settings'
import Stats from './screens/Stats'
import Sync from './screens/Sync'
import { newOrder, useOrders } from './storage'
import type { Order } from './types'

// Простая навигация через hash: #/ — список, #/order/<id> — заказ, #/new — новый,
// #/settings, #/stats, #/sync, #/calendar, #/calc, #/import, #/clients, #/client/<ключ>
function useRoute() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash.replace(/^#/, '') || '/'
}

const go = (path: string) => {
  location.hash = path
  window.scrollTo(0, 0)
}

function readRoute() {
  return location.hash.replace(/^#/, '') || '/'
}

export default function App() {
  const route = useRoute()
  const { orders, upsert, remove, replaceAll } = useOrders()
  const [draft, setDraft] = useState<Order | null>(() => (readRoute() === '/new' ? newOrder() : null))
  const [draftRoute, setDraftRoute] = useState(readRoute)
  const openOrder = useCallback((id: string) => go(`/order/${id}`), [])
  useReminderService(orders, openOrder)

  // Черновик создаём только при входе на #/new, а не пока маршрут ещё не сменился после «назад».
  if (route !== draftRoute) {
    setDraftRoute(route)
    if (route === '/new' && !draft) setDraft(newOrder())
  }

  if (route === '/new') {
    if (!draft) return null
    const d = orders.find((x) => x.id === draft.id) ?? draft
    return (
      <OrderEdit
        key={d.id}
        initial={d}
        onSave={(o) => {
          const saved = upsert(o)
          // после первого сохранения заказ живёт по своему адресу
          history.replaceState(null, '', `#/order/${o.id}`)
          return saved
        }}
        onDelete={remove}
        onBack={() => {
          setDraft(null)
          go('/')
        }}
      />
    )
  }

  if (route === '/stats') return <Stats orders={orders} onOpen={(id) => go(`/order/${id}`)} />

  if (route === '/settings') return <Settings orders={orders} onImport={replaceAll} />

  if (route === '/sync') return <Sync />

  if (route === '/calc') return <Calc />

  if (route === '/clients') return <ClientList orders={orders} onOpenClient={(key) => go(clientPath(key))} />

  const cm = route.match(/^\/client\/(.+)$/)
  if (cm) {
    const key = decodeURIComponent(cm[1])
    return (
      <ClientPage
        client={listClients(orders).find((c) => c.key === key)}
        onBack={() => go('/clients')}
        onOpen={(id) => go(`/order/${id}`)}
        onSave={upsert}
        onNewOrder={(c) => {
          setDraft({ ...newOrder(), client: c.name, phone: c.phone, email: c.email })
          go('/new')
        }}
      />
    )
  }

  if (route === '/calendar') return <Calendar orders={orders} onOpen={(id) => go(`/order/${id}`)} />

  if (route === '/import')
    return (
      <Import
        onCreate={(list) => {
          const saved = list.map((o) => upsert(o))
          // один заказ — сразу открываем, несколько — в списке
          go(saved.length === 1 ? `/order/${saved[0].id}` : '/')
        }}
      />
    )

  const m = route.match(/^\/order\/(.+)$/)
  if (m) {
    const o = orders.find((x) => x.id === m[1]) ?? (draft?.id === m[1] ? draft : null)
    if (o)
      return (
        <OrderEdit
          key={o.id}
          initial={o}
          onSave={upsert}
          onDelete={remove}
          onBack={() => {
            setDraft(null)
            go('/')
          }}
        />
      )
  }

  return (
    <>
      <AppUpdate />
      <OrderList
      orders={orders}
      banner={<RemindersBanner orders={orders} onSave={upsert} onOpen={openOrder} />}
      onOpen={(id) => go(`/order/${id}`)}
      onCreate={() => {
        setDraft(newOrder())
        go('/new')
      }}
      />
    </>
  )
}
