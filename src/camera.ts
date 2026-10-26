// Камера для кругового видео: выбор объектива и зум.
// 0.5× — сверхширокий объектив. Его дают двумя способами:
//  • «составная» камера iPhone (Dual Wide / Triple): один поток с плавным зумом, где zoom 1 = 0.5×, 2 = 1×;
//  • отдельная камера «Ultra Wide» — переключаемся на неё (только до начала записи).
// Названия камер браузер показывает после разрешения на камеру и на языке системы.

const FRONT = /front|user|передн|przedn|facing front/i
const ULTRA = /ultra|сверхширок|ультраширок|ultraszerok|0[.,]5/i
// составные камеры со сверхшироким объективом: зум начинается с 0.5×
const MULTI_ULTRA = /dual wide|triple|двойн\S* широк|тройн|podwójn\S* szerok|potrójn/i

export interface Cameras {
  // составная камера (плавный зум от 0.5×)
  multi?: string
  // отдельный сверхширокий объектив
  ultra?: string
  // все задние камеры — на Android сверхширокую по названию не узнать, даём перебрать
  backs: string[]
}

export function classifyCameras(devices: Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>[]): Cameras {
  // задние камеры: без пометки «фронтальная» (у части Android в названии нет ни back, ни front)
  const back = devices.filter((d) => d.kind === 'videoinput' && d.label && !FRONT.test(d.label))
  return {
    multi: back.find((d) => MULTI_ULTRA.test(d.label))?.deviceId,
    ultra: back.find((d) => ULTRA.test(d.label) && !MULTI_ULTRA.test(d.label))?.deviceId,
    backs: back.map((d) => d.deviceId),
  }
}

/** множитель зума, который соответствует 1× (у составных камер iPhone — 2) */
export const zoomBase = (label: string) => (MULTI_ULTRA.test(label) ? 2 : 1)

export interface ZoomRange {
  min: number
  max: number
}

export function zoomRange(stream: MediaStream): ZoomRange | null {
  const track = stream.getVideoTracks()[0]
  const caps = track?.getCapabilities?.() as { zoom?: ZoomRange } | undefined
  return caps?.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: caps.zoom.max } : null
}

export const currentZoom = (stream: MediaStream): number | undefined =>
  (stream.getVideoTracks()[0]?.getSettings() as { zoom?: number } | undefined)?.zoom

export function setZoom(stream: MediaStream, zoom: number) {
  const track = stream.getVideoTracks()[0]
  return track?.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] })
}

export const isPortrait = () => window.matchMedia('(orientation: portrait)').matches

// кадр в ориентации экрана: телефон вертикально — вертикальное видео 720×1280, боком — 1280×720
export async function openCamera(deviceId?: string): Promise<MediaStream> {
  const [w, h] = isPortrait() ? [720, 1280] : [1280, 720]
  const video: MediaTrackConstraints = {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
    width: { ideal: w },
    height: { ideal: h },
    aspectRatio: { ideal: w / h },
    frameRate: { ideal: 30 },
  }
  // со звуком мастер может проговаривать повреждения; без микрофона — только видео
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: true })
  } catch (e) {
    if (deviceId && (e as DOMException).name === 'OverconstrainedError') throw e
    return navigator.mediaDevices.getUserMedia({ video, audio: false })
  }
}

export const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((tr) => tr.stop())

export const trackLabel = (s: MediaStream) => s.getVideoTracks()[0]?.label ?? ''

/** кнопки зума: 0.5×, 1×, 2×, 3× — какие из них доступны */
export function zoomLevels(range: ZoomRange | null, base: number, hasUltra: boolean): number[] {
  const inRange = (l: number) => range !== null && l * base >= range.min - 0.01 && l * base <= range.max + 0.01
  return [0.5, 1, 2, 3].filter((l) => l === 1 || inRange(l) || (l === 0.5 && hasUltra))
}
