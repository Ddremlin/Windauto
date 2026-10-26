import { useSettings } from '../settingsHooks'
import type { Order } from '../types'
import { orderNo } from '../docNumber'

/** «№ 2026/0142»; в общей базе новый заказ получает номер с сервера при синхронизации */
export default function AcceptanceNo({ order, pendingServer }: { order: Order; pendingServer?: boolean }) {
  const { t } = useSettings()
  if (!order.number && pendingServer) return <span className="order-no pending">{t('order.numberPending')}</span>
  return <b className="order-no">{t('doc.number', { n: orderNo(order) })}</b>
}
