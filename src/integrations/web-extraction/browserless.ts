import { BROWSERLESS_TIMEOUT_MS } from '../../lib/limits.ts'

const BROWSERLESS_BASE_URL = 'https://production-lon.browserless.io'

type BrowserlessResult =
  { ok: true; html: string } | { ok: false; errorReason: string }

/** Pide el HTML ya renderizado a Browserless (REST /content, sin driver de Puppeteer). */
export async function fetchRenderedHtml(
  url: string,
): Promise<BrowserlessResult> {
  const token = process.env.BROWSERLESS_TOKEN
  if (!token) {
    return { ok: false, errorReason: 'BROWSERLESS_TOKEN is not configured' }
  }

  try {
    const response = await fetch(
      `${BROWSERLESS_BASE_URL}/content?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(BROWSERLESS_TIMEOUT_MS),
      },
    )

    if (!response.ok) {
      return {
        ok: false,
        errorReason: `Browserless responded with ${response.status} ${response.statusText}`,
      }
    }

    const html = await response.text()
    return { ok: true, html }
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return {
        ok: false,
        errorReason: 'Browserless exceeded the rendering timeout',
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      errorReason: `Browserless call failed: ${message}`,
    }
  }
}
