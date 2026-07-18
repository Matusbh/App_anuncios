import { extractVisibleText, parseHtmlContent } from './html-parsing.ts'
import { fetchRenderedHtml } from './browserless.ts'
import type { ExtractPageContentResult } from './types.ts'
import { SIMPLE_FETCH_TIMEOUT_MS } from '../../lib/limits.ts'

/** Por debajo de esto asumimos que es una SPA que necesita JS para pintar contenido. */
const MIN_VISIBLE_TEXT_THRESHOLD = 250
const USER_AGENT =
  'Mozilla/5.0 (compatible; SnaprimeBot/1.0; +https://snaprime.dev/bot)'

type SimpleFetchResult =
  | { ok: true; html: string }
  | { ok: false; errorReason: string; httpStatus?: number }

function countVisibleTextLength(html: string): number {
  return extractVisibleText(html, { excludeChrome: false }).length
}

async function fetchSimpleHtml(url: string): Promise<SimpleFetchResult> {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(SIMPLE_FETCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      return {
        ok: false,
        errorReason: `La pagina respondio ${response.status} ${response.statusText}`,
        httpStatus: response.status,
      }
    }

    return { ok: true, html: await response.text() }
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return {
        ok: false,
        errorReason: 'Timeout al hacer fetch simple de la pagina',
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, errorReason: `Fallo el fetch simple: ${message}` }
  }
}

/**
 * Extrae contenido estructurado de una URL: fetch simple primero, y si el HTML
 * resultante tiene muy poco texto visible (probable SPA), cae a Browserless
 * para obtener el HTML ya renderizado. Nunca lanza: los fallos se devuelven
 * como success: false, y el contenido parcial como partial: true.
 */
export async function extractPageContent(
  url: string,
): Promise<ExtractPageContentResult> {
  try {
    new URL(url)
  } catch {
    return { success: false, errorReason: `URL invalida: ${url}` }
  }

  const simple = await fetchSimpleHtml(url)

  // Error HTTP real (404/500/...): la pagina no existe o el servidor falla,
  // renderizarla con Browserless no lo va a arreglar.
  if (!simple.ok && simple.httpStatus !== undefined) {
    return { success: false, errorReason: simple.errorReason }
  }

  const simpleTextLength = simple.ok ? countVisibleTextLength(simple.html) : 0
  const simpleContentIsThin = simpleTextLength < MIN_VISIBLE_TEXT_THRESHOLD

  if (simple.ok && !simpleContentIsThin) {
    return {
      success: true,
      partial: false,
      source: 'fetch',
      content: parseHtmlContent(simple.html, url),
    }
  }

  const rendered = await fetchRenderedHtml(url)

  if (rendered.ok) {
    const renderedTextLength = countVisibleTextLength(rendered.html)
    const stillThin = renderedTextLength < MIN_VISIBLE_TEXT_THRESHOLD
    return {
      success: true,
      partial: stillThin,
      partialReason: stillThin
        ? 'La pagina sigue con muy poco texto visible incluso tras renderizar JS'
        : undefined,
      source: 'browserless',
      content: parseHtmlContent(rendered.html, url),
    }
  }

  // Browserless fallo. Si el fetch simple al menos trajo algo, degradamos con eso
  // en vez de fallar del todo.
  if (simple.ok) {
    return {
      success: true,
      partial: true,
      partialReason: `Contenido minimo (probable pagina JS-rendered) y el fallback de Browserless fallo: ${rendered.errorReason}`,
      source: 'fetch',
      content: parseHtmlContent(simple.html, url),
    }
  }

  return {
    success: false,
    errorReason: `Fetch simple fallo (${simple.errorReason}) y el fallback de Browserless tambien fallo (${rendered.errorReason})`,
  }
}
