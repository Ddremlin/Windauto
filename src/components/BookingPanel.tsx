import { bookingText, isLate, isPlanned, timeText } from '../booking'
import { toLocalInput } from '../reminders'
import { useSettings } from '../settingsHooks'
import type { Booking, Order } from '../types'

/** Запись на приёмку в заказе: когда ждём машину, подтверждение, «машина приехала» */
export function BookingPanel({ order, onChange }: { order: Order; onChange: (b: Booking | undefined) => void }) {
  const { t, locale } = useSettings()
  const b = order.booking
  if (!b) return null

  if (!isPlanned(order))
    return (
      <p className="hint booking-done">
        📅 {t('book.wasPlanned', { at: bookingText(b.at, locale), arrived: bookingText(b.arrived!, locale) })}{' '}
        <button className="link-btn no-print" onClick={() => confirm(t('book.undoConfirm')) && onChange({ ...b, arrived: undefined })}>
          {t('book.undo')}
        </button>
      </p>
    )

  const late = isLate(order)
  return (
    <div className={'booking' + (late ? ' late' : '')}>
      <h3>📅 {t('book.title')}</h3>
      <label className="field">
        <span className="field-label">{t('book.at')}</span>
        <input
          type="datetime-local"
          value={toLocalInput(b.at)}
          onChange={(e) => {
            const at = new Date(e.target.value).getTime()
            if (Number.isFinite(at)) onChange({ ...b, at })
          }}
        />
        {late && <span className="field-hint">⚠ {t('book.lateHint', { time: timeText(b.at, locale) })}</span>}
      </label>
      <label className={'check-chip' + (b.confirmed ? ' on' : '')}>
        <input type="checkbox" checked={Boolean(b.confirmed)} onChange={(e) => onChange({ ...b, confirmed: e.target.checked || undefined })} />
        {b.confirmed ? '✓ ' : ''}
        {t('book.confirmed')}
      </label>
      <div className="row">
        <button className="btn primary" onClick={() => onChange({ ...b, arrived: Date.now() })}>🚗 {t('book.arrived')}</button>
      </div>
      <p className="hint">{t('book.hint')}</p>
    </div>
  )
}
