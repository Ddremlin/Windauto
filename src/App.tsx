import { useEffect, useState } from 'react'
import AppUpdate from './components/AppUpdate'
import OrderEdit from './screens/OrderEdit'
import OrderList from './screens/OrderList'
import Settings from './screens/Settings'
import Stats from './screens/Stats'
import Sync from './screens/Sync'
import { newOrder, useOrders } from './storage'
import type { Order } from './types'

// Простая навигация через hash: #/ — список, #/order/<id> — заказ, #/new — новый, #/settings, #/stats, #/sync
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
      onOpen={(id) => go(`/order/${id}`)}
      onCreate={() => {
        setDraft(newOrder())
        go('/new')
      }}
      />
    </>
  )
}
