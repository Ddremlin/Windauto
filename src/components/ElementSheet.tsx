import { useEffect } from 'react'
import { deletePhotos, elementPhotoIds } from '../photos'
import { useSettings } from '../settingsHooks'
import { currencySymbol } from '../settingsStore'
import { PhotoStrip } from './Photos'
import type { DamageId, ElementWork, WorkId } from '../types'
import { DAMAGES, EXCLUSIVE, WORKS, elementTotal, formatMoney } from '../works'

interface Props {
  label: string
  value: ElementWork | undefined
  onChange: (v: ElementWork | undefined) => void
  onClose: () => void
}

const parsePrice = (s: string): number | undefined => {
  const n = Number(s.replace(/\s/g, '').replace(',', '.'))
  return s.trim() && Number.isFinite(n) && n >= 0 ? n : undefined
}

export default function ElementSheet({ label, value, onChange, onClose }: Props) {
  const { t, settings } = useSettings()
  const works = value?.works ?? []
  const prices = value?.prices ?? {}
  const note = value?.note ?? ''
  const photos = value?.photos ?? []
  const photosAfter = value?.photosAfter ?? []
  const damage = value?.damage ?? []
  const allPhotos = elementPhotoIds(value)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const commit = (next: Partial<ElementWork>) => {
    const v: ElementWork = { works, prices, note, photos, photosAfter, damage, parts: value?.parts, ...next }
    if (v.works.length === 0 && !v.note?.trim() && !v.photos?.length && !v.photosAfter?.length && !v.damage?.length && !v.parts)
      return onChange(undefined)
    // цены снятых работ запоминаем — вдруг галочку вернут
    onChange({
      works: v.works,
      prices: Object.keys(v.prices ?? {}).length ? v.prices : undefined,
      parts: v.parts || undefined,
      damage: v.damage?.length ? v.damage : undefined,
      note: v.note || undefined,
      photos: v.photos?.length ? v.photos : undefined,
      photosAfter: v.photosAfter?.length ? v.photosAfter : undefined,
    })
  }

  const clear = () => {
    if (allPhotos.length && !confirm(t('sheet.clearConfirm', { n: allPhotos.length }))) return
    deletePhotos(allPhotos)
    onChange(undefined)
  }

  const toggle = (id: WorkId) => {
    let next: WorkId[]
    if (works.includes(id)) {
      next = works.filter((w) => w !== id)
    } else {
      const group = EXCLUSIVE.find((g) => g.includes(id)) ?? []
      next = [...works.filter((w) => !group.includes(w)), id]
      // порядок как в справочнике, чтобы полосы на схеме были стабильными
      next.sort((a, b) => WORKS.findIndex((w) => w.id === a) - WORKS.findIndex((w) => w.id === b))
      // цена по умолчанию из настроек, если для элемента ещё не вводили
      const def = settings.defaultPrices[id]
      if (prices[id] === undefined && def !== undefined) return commit({ works: next, prices: { ...prices, [id]: def } })
    }
    commit({ works: next })
  }

  const setPrice = (id: WorkId, raw: string) => {
    const next = { ...prices }
    const n = parsePrice(raw)
    if (n === undefined) delete next[id]
    else next[id] = n
    commit({ prices: next })
  }

  const toggleDamage = (id: DamageId) =>
    commit({ damage: damage.includes(id) ? damage.filter((d) => d !== id) : DAMAGES.filter((d) => d === id || damage.includes(d)) })

  const total = elementTotal(value)

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={label}>
        <div className="sheet-handle" />
        <h2>{label}</h2>
        <div className="work-list">
          {WORKS.map((w) => {
            const on = works.includes(w.id)
            return (
              <div key={w.id} className={'work-item' + (on ? ' checked' : '')}>
                <label className="work-check">
                  <input type="checkbox" checked={on} onChange={() => toggle(w.id)} />
                  <span className="swatch" style={{ background: w.color }} />
                  <span>{t(`work.${w.id}`)}</span>
                </label>
                {on && (
                  <label className="price">
                    <input
                      inputMode="decimal"
                      placeholder="0"
                      defaultValue={prices[w.id] != null ? String(prices[w.id]).replace('.', ',') : ''}
                      onChange={(e) => setPrice(w.id, e.target.value)}
                      aria-label={t('sheet.price', { work: t(`work.${w.id}`) })}
                    />
                    <span>{currencySymbol()}</span>
                  </label>
                )}
              </div>
            )
          })}
        </div>
        <div className="work-item parts-item">
          <span className="work-check">
            <span className="swatch parts-swatch" />
            <span>{t('sheet.parts')}</span>
          </span>
          <label className="price">
            <input
              inputMode="decimal"
              placeholder="0"
              defaultValue={value?.parts != null ? String(value.parts).replace('.', ',') : ''}
              onChange={(e) => commit({ parts: parsePrice(e.target.value) })}
              aria-label={t('sheet.parts')}
            />
            <span>{currencySymbol()}</span>
          </label>
        </div>
        <div className="sheet-total">
          <span>{t('sheet.elementTotal')}</span>
          <strong>{formatMoney(total)}</strong>
        </div>
        <div className="sheet-section">
          <span className="field-label">{t('damage.sheet')}</span>
          <div className="check-grid">
            {DAMAGES.map((d) => (
              <label key={d} className={'check-chip damage' + (damage.includes(d) ? ' on' : '')}>
                <input type="checkbox" checked={damage.includes(d)} onChange={() => toggleDamage(d)} />
                {t(`damage.${d}`)}
              </label>
            ))}
          </div>
        </div>
        <div className="sheet-section">
          <span className="field-label">{t('sheet.photos')} {photos.length ? `(${photos.length})` : ''}</span>
          <PhotoStrip
            ids={photos}
            onAdd={(ids) => commit({ photos: [...photos, ...ids] })}
            onDelete={(id) => {
              deletePhotos([id])
              commit({ photos: photos.filter((p) => p !== id) })
            }}
          />
        </div>
        <div className="sheet-section">
          <span className="field-label">{t('sheet.photosAfter')} {photosAfter.length ? `(${photosAfter.length})` : ''}</span>
          <PhotoStrip
            ids={photosAfter}
            onAdd={(ids) => commit({ photosAfter: [...photosAfter, ...ids] })}
            onDelete={(id) => {
              deletePhotos([id])
              commit({ photosAfter: photosAfter.filter((p) => p !== id) })
            }}
          />
        </div>
        <textarea placeholder={t('sheet.note')} value={note} rows={2} onChange={(e) => commit({ note: e.target.value })} />
        <div className="sheet-actions">
          <button className="btn ghost" onClick={clear} disabled={!value}>
            {t('app.clear')}
          </button>
          <button className="btn primary" onClick={onClose}>
            {t('app.done')}
          </button>
        </div>
      </div>
    </div>
  )
}
