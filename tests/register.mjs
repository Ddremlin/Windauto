// Тесты запускаются прямо на исходниках TypeScript (node --experimental-strip-types).
// В src импорты без расширения (как принято с Vite) — дописываем «.ts» при поиске модуля.
import { register } from 'node:module'

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try {
    return await next(spec, ctx)
  } catch (e) {
    if ((spec.startsWith('.') || spec.startsWith('/')) && !/\\.[cm]?[jt]sx?$/.test(spec)) return next(spec + '.ts', ctx)
    throw e
  }
}`),
  import.meta.url,
)
