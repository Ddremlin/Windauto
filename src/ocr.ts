// Снимок номера или VIN. С общей базой читает сервер (Claude) — точно и с любого ракурса.
// Без сервера, без сети или без ключа на сервере — Tesseract на телефоне (модель скачивается один раз).
import { readPlate, readVin } from './scanText'
import { canRecognize, recognize, type Recognized } from './sync'

export type { Recognized } from './sync'

interface OcrWorker {
  setParameters: (params: Record<string, string>) => Promise<unknown>
  recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string; confidence: number } }>
}

let pending: Promise<OcrWorker> | null = null

function engine(): Promise<OcrWorker> {
  if (!pending) {
    pending = (async () => {
      const { createWorker } = await import('tesseract.js')
      const base = import.meta.env.BASE_URL
      return createWorker('eng', 1, {
        workerPath: `${base}ocr/worker.min.js`,
        corePath: `${base}ocr/tesseract-core-simd-lstm.wasm.js`,
        langPath: `${base}ocr`,
      })
    })().catch((error: unknown) => {
      pending = null
      throw error
    })
  }
  return pending
}

// --- подготовка снимка ---

// часть кадра (доли от ширины/высоты), растянутая до target по большей стороне
function crop(bmp: ImageBitmap, box: [number, number, number, number], target: number): HTMLCanvasElement {
  const [x, y, w, h] = [box[0] * bmp.width, box[1] * bmp.height, box[2] * bmp.width, box[3] * bmp.height]
  const k = target / Math.max(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * k))
  canvas.height = Math.max(1, Math.round(h * k))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(bmp, x, y, w, h, 0, 0, canvas.width, canvas.height)
  return canvas
}

function gray(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const ctx = canvas.getContext('2d')!
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const g = new Uint8ClampedArray(d.length / 4)
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  return g
}

function paint(canvas: HTMLCanvasElement, g: Uint8ClampedArray, fn: (v: number) => number) {
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < g.length; i++) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = fn(g[i])
  ctx.putImageData(img, 0, 0)
}

// повышение контраста — мягкий вариант
function contrast(canvas: HTMLCanvasElement): HTMLCanvasElement {
  paint(canvas, gray(canvas), (y) => (y - 128) * 1.8 + 128)
  return canvas
}

// чёрно-белое по порогу Оцу; светлый текст на тёмном (выбитый VIN) переворачиваем
function binarize(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const g = gray(canvas)
  const hist = new Array<number>(256).fill(0)
  for (const v of g) hist[v]++
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, best = 0, thr = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = g.length - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) ** 2
    if (between > best) [best, thr] = [between, t]
  }
  const dark = g.reduce((n, v) => n + (v <= thr ? 1 : 0), 0)
  // фон — большинство пикселей; он должен стать белым
  const invert = dark > g.length / 2
  paint(canvas, g, (y) => ((y > thr) !== invert ? 255 : 0))
  return canvas
}

// --- проходы Tesseract ---

interface Pass {
  box: [number, number, number, number]
  prep: (c: HTMLCanvasElement) => HTMLCanvasElement
  psm: string // 11 — разрозненный текст, 7 — одна строка, 6 — блок
}

const FULL: [number, number, number, number] = [0, 0, 1, 1]
// цель обычно в центре кадра
const BAND: [number, number, number, number] = [0.1, 0.3, 0.8, 0.4]
const CENTER: [number, number, number, number] = [0.2, 0.38, 0.6, 0.24]

const PASSES: Pass[] = [
  { box: FULL, prep: contrast, psm: '11' },
  { box: BAND, prep: binarize, psm: '6' },
  { box: CENTER, prep: binarize, psm: '7' },
  { box: FULL, prep: binarize, psm: '11' },
  { box: CENTER, prep: contrast, psm: '7' },
]

const rank = (r: Recognized | null) => (!r?.value ? 0 : r.confident ? 2 : 1)

async function readOnDevice(kind: 'vin' | 'plate', file: Blob): Promise<Recognized> {
  if (kind === 'vin') {
    const fromCode = await barcodeVin(file)
    if (fromCode) return { value: fromCode, confident: true }
  }
  const worker = await engine()
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  let best: Recognized = { value: '', confident: false }
  try {
    for (const pass of PASSES) {
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        tessedit_pageseg_mode: pass.psm,
        preserve_interword_spaces: '1',
      })
      const long = Math.max(bmp.width * pass.box[2], bmp.height * pass.box[3])
      const canvas = pass.prep(crop(bmp, pass.box, Math.min(2000, Math.max(1600, long))))
      const { data } = await worker.recognize(canvas)
      // ноль бывает у верного чтения, когда оценка уверенности не посчиталась
      const sure = data.confidence === 0 || data.confidence >= 45
      const r = parse(kind, data.text, sure)
      if (rank(r) > rank(best)) best = r!
      if (rank(best) === 2) break
    }
  } finally {
    bmp.close?.()
  }
  return best
}

function parse(kind: 'vin' | 'plate', text: string, sure: boolean): Recognized | null {
  if (kind === 'vin') {
    const vin = readVin(text)
    return vin && { value: vin.value, confident: vin.confident && sure }
  }
  const plate = readPlate(text)
  return plate && { value: plate.value, country: plate.country, confident: plate.confident && sure }
}

async function barcodeVin(file: Blob): Promise<string | null> {
  const Det = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (src: ImageBitmap) => Promise<{ rawValue: string }[]> } }).BarcodeDetector
  if (!Det) return null
  try {
    const det = new Det({ formats: ['code_39', 'code_128', 'qr_code', 'data_matrix', 'pdf417'] })
    const bmp = await createImageBitmap(file)
    const codes = await det.detect(bmp)
    bmp.close?.()
    for (const code of codes) {
      const vin = readVin(code.rawValue)
      if (vin) return vin.value
    }
  } catch {
    return null
  }
  return null
}

export async function recognizePhoto(kind: 'vin' | 'plate', file: Blob): Promise<Recognized> {
  if (canRecognize()) {
    try {
      return await recognize(kind, file)
    } catch {
      // нет сети, старый сервер, нет ключа, перегрузка — читаем на телефоне
    }
  }
  return readOnDevice(kind, file)
}
