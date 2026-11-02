// Оформление: светлая / тёмная тема и цветовая гамма (фон, панели, акцент).
// Своё на каждом телефоне. Цвета подставляются в CSS-переменные только для экрана —
// печать и PDF остаются чёрно-белыми (см. @media print в index.css).

export type ThemeMode = 'auto' | 'light' | 'dark'
export type PaletteId = 'coffee' | 'ocean' | 'forest' | 'graphite' | 'wine'

export const THEME_MODES: ThemeMode[] = ['auto', 'light', 'dark']

type Vars = Record<string, string>

// общие для всех гамм: статусы и цвета повреждений
const LIGHT_BASE: Vars = { danger: '#d32f2f', ok: '#2e7d32', warn: '#b26a00', purple: '#7b1fa2' }
const DARK_BASE: Vars = { danger: '#ef5350', ok: '#66bb6a', warn: '#ffb74d', purple: '#ce93d8' }

const tone = (bg: string, panel: string, text: string, muted: string, line: string, accent: string, accentText: string, bodyFill: string, bodyStroke: string, wheel: string): Vars => ({
  bg, panel, text, muted, line, accent, 'accent-text': accentText, 'body-fill': bodyFill, 'body-stroke': bodyStroke, wheel,
})

export const PALETTES: { id: PaletteId; light: Vars; dark: Vars }[] = [
  {
    id: 'coffee',
    light: tone('#f4ede3', '#fffaf3', '#2a1a10', '#7a6a5c', '#e2d5c3', '#8a5a2b', '#ffffff', '#f1e7da', '#9c8a76', '#3d2c20'),
    dark: tone('#170b03', '#24150a', '#f1e6d4', '#b3a28e', '#3d2b1c', '#d9b27c', '#291204', '#33200f', '#7a6450', '#0d0602'),
  },
  {
    id: 'ocean',
    light: tone('#eef3f8', '#ffffff', '#10202e', '#5e6e7e', '#d5dfe9', '#1f5fa8', '#ffffff', '#e6eef6', '#7d90a3', '#1f2a36'),
    dark: tone('#0b1219', '#131d28', '#e3ecf5', '#93a4b5', '#243241', '#6aa6e8', '#071523', '#172434', '#5b6f84', '#05090d'),
  },
  {
    id: 'forest',
    light: tone('#eef3ec', '#fbfdf9', '#17241a', '#607063', '#d4e0d2', '#2f6b3a', '#ffffff', '#e4ede1', '#7f9381', '#1e2b20'),
    dark: tone('#0b130c', '#142016', '#e2eee2', '#97ab99', '#243625', '#7fc68a', '#0a1f0e', '#182a1b', '#5f7862', '#050a05'),
  },
  {
    id: 'graphite',
    light: tone('#f1f1f2', '#ffffff', '#1b1c1e', '#6b6e73', '#dcdde0', '#3a3f47', '#ffffff', '#e9eaec', '#8a8d93', '#26282b'),
    dark: tone('#111214', '#1b1c1f', '#e8e9eb', '#a0a3a8', '#2d2f33', '#c9ccd1', '#15171a', '#23252a', '#6b6f76', '#060607'),
  },
  {
    id: 'wine',
    light: tone('#f6eeef', '#fffafa', '#2a1216', '#7a6064', '#e6d3d6', '#8e2436', '#ffffff', '#f1e3e5', '#9e8287', '#3a1a20'),
    dark: tone('#160709', '#241013', '#f3e3e5', '#b49a9e', '#3d2025', '#e48b9a', '#2a0a10', '#331519', '#7d5a60', '#0c0304'),
  },
]

export const paletteOf = (id: string) => PALETTES.find((p) => p.id === id) ?? PALETTES[0]

const block = (v: Vars, scheme: 'light' | 'dark') =>
  `:root:root{${Object.entries(v)
    .map(([k, x]) => `--${k}:${x};`)
    .join('')}color-scheme:${scheme};}`

const darkQuery = () => window.matchMedia?.('(prefers-color-scheme: dark)')

let current: { mode: ThemeMode; palette: PaletteId } = { mode: 'auto', palette: 'coffee' }
let listening = false

/** Подставляет цвета выбранной темы; вызывать при запуске и при смене настроек */
export function applyTheme(mode: ThemeMode, palette: PaletteId) {
  current = { mode, palette }
  const p = paletteOf(palette)
  const light = block({ ...LIGHT_BASE, ...p.light }, 'light')
  const dark = block({ ...DARK_BASE, ...p.dark }, 'dark')
  const css =
    mode === 'auto'
      ? `@media screen{${light}}@media screen and (prefers-color-scheme: dark){${dark}}`
      : `@media screen{${mode === 'dark' ? dark : light}}`
  let el = document.getElementById('theme-vars') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'theme-vars'
    document.head.appendChild(el)
  }
  el.textContent = css
  updateMeta()
  // в режиме «Авто» цвет строки браузера следует за системой
  if (!listening) {
    listening = true
    darkQuery()?.addEventListener?.('change', updateMeta)
  }
}

function updateMeta() {
  const p = paletteOf(current.palette)
  const isDark = current.mode === 'dark' || (current.mode === 'auto' && Boolean(darkQuery()?.matches))
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', (isDark ? p.dark : p.light).panel)
}
