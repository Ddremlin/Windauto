// Поле ввода не должно прятаться под закреплённой шапкой или под клавиатурой.
// Когда выезжает клавиатура, окно WebView становится ниже, и браузер прокручивает поле к самому верху —
// прямо под шапку (position: sticky), поле в фокусе, но его не видно.
// 1) --topbar-h: настоящая высота шапки → html { scroll-padding-top } (браузер сам учитывает отступ);
// 2) подстраховка: после появления клавиатуры или фокуса поле, оказавшееся вне видимой части, ставим в её середину.

const EDITABLE = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), textarea, select, [contenteditable="true"]'

function topbarHeight(): number {
  const bar = document.querySelector<HTMLElement>('.topbar')
  if (!bar || getComputedStyle(bar).position !== 'sticky') return 0
  return bar.getBoundingClientRect().height
}

let frame = 0
let lastH = -1
// не чаще раза за кадр: наблюдатель срабатывает на любое изменение страницы
function setTopbarVar() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    const h = Math.round(topbarHeight())
    if (h !== lastH) document.documentElement.style.setProperty('--topbar-h', `${(lastH = h)}px`)
  })
}

/** Поле видно целиком между шапкой и клавиатурой? Если нет — в середину видимой части */
function revealFocused() {
  const el = document.activeElement as HTMLElement | null
  if (!el || !el.matches?.(EDITABLE)) return
  const vv = window.visualViewport
  const visibleTop = (vv?.offsetTop ?? 0) + (el.closest('.topbar') ? 0 : topbarHeight())
  const visibleBottom = (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight)
  const r = el.getBoundingClientRect()
  const margin = 8
  if (r.top >= visibleTop + margin && r.bottom <= visibleBottom - margin) return
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  // центр окна может всё ещё быть под шапкой (очень низкое окно) — досдвигаем
  const after = el.getBoundingClientRect()
  if (after.top < visibleTop + margin) window.scrollBy({ top: after.top - visibleTop - margin, behavior: 'instant' })
}

export function initKeyboardFix() {
  setTopbarVar()
  // шапка меняется (другой экран, поворот, шрифт) — обновляем отступ
  new MutationObserver(() => setTopbarVar()).observe(document.body, { childList: true, subtree: true })
  window.addEventListener('resize', setTopbarVar)

  let timer: ReturnType<typeof setTimeout> | undefined
  const later = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(revealFocused, ms)
  }
  // клавиатура выезжает — окно меняет высоту; браузер уже прокрутил по-своему, поправляем после него
  window.visualViewport?.addEventListener('resize', () => later(120))
  window.addEventListener('resize', () => later(120))
  // фокус на поле при уже открытой клавиатуре (переход к следующему полю)
  document.addEventListener('focusin', () => later(350))
}
