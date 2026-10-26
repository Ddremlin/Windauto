// Снимок номера или VIN читается на телефоне. Сеть нужна один раз, чтобы скачать модель.
import { readPlate, readVin } from './scanText'

export interface Recognized {
  value: string
  country?: string
  confident: boolean
}

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

async function canvasOf(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file)
  const long = Math.max(bmp.width, bmp.height)
  const target = long < 1200 ? 1600 : Math.min(long, 2000)
  const k = target / long
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * k))
  canvas.height = Math.max(1, Math.round(bmp.height * k))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bmp.close?.()
    throw new Error('canvas')
  }
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close?.()
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    const c = Math.min(255, Math.max(0, (y - 128) * 1.8 + 128))
    d[i] = c
    d[i + 1] = c
    d[i + 2] = c
  }
  ctx.putImageData(img, 0, 0)
  return canvas
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
  if (kind === 'vin') {
    const fromCode = await barcodeVin(file)
    if (fromCode) return { value: fromCode, confident: true }
  }
  const worker = await engine()
  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    tessedit_pageseg_mode: '11',
    preserve_interword_spaces: '1',
  })
  const canvas = await canvasOf(file)
  const { data } = await worker.recognize(canvas)
  // ноль бывает у верного чтения, когда оценка уверенности не посчиталась
  const sure = data.confidence === 0 || data.confidence >= 45
  if (kind === 'vin') {
    const vin = readVin(data.text)
    if (!vin) return { value: '', confident: false }
    return { value: vin.value, confident: vin.confident && sure }
  }
  const plate = readPlate(data.text)
  if (!plate) return { value: '', confident: false }
  return { value: plate.value, country: plate.country, confident: plate.confident && sure }
}
