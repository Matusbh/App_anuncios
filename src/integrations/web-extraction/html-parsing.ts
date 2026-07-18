import { parse } from 'node-html-parser'
import type { HTMLElement } from 'node-html-parser'

import type { ExtractedPageContent } from './types.ts'

const MAX_CANDIDATE_IMAGES = 8
const ICON_MAX_DIMENSION_PX = 40
const MAX_COLORS = 5
const HEX_COLOR_PATTERN =
  /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g

/** Texto visible del documento, ignorando script/style/noscript (y opcionalmente nav/header/footer). */
export function extractVisibleText(
  html: string,
  { excludeChrome }: { excludeChrome: boolean },
): string {
  // node-html-parser trata <!DOCTYPE ...> como un TextNode normal y lo cuela en textContent.
  const root = parse(html.replace(/<!DOCTYPE[^>]*>/i, ''))
  const tagsToStrip = excludeChrome
    ? ['script', 'style', 'noscript', 'nav', 'header', 'footer']
    : ['script', 'style', 'noscript']

  for (const tag of tagsToStrip) {
    for (const el of root.querySelectorAll(tag)) {
      el.remove()
    }
  }

  return root.textContent.replace(/\s+/g, ' ').trim()
}

function resolveUrl(maybeRelative: string, baseUrl: string): string | null {
  try {
    return new URL(maybeRelative, baseUrl).toString()
  } catch {
    return null
  }
}

function looksLikeIcon(img: HTMLElement): boolean {
  const width = Number(img.getAttribute('width'))
  const height = Number(img.getAttribute('height'))
  if (!width || !height) return false
  return width < ICON_MAX_DIMENSION_PX && height < ICON_MAX_DIMENSION_PX
}

function extractCandidateImages(
  root: HTMLElement,
  baseUrl: string,
): Array<string> {
  const images: Array<string> = []

  const ogImage = root
    .querySelector('meta[property="og:image"]')
    ?.getAttribute('content')
  if (ogImage) {
    const resolved = resolveUrl(ogImage, baseUrl)
    if (resolved) images.push(resolved)
  }

  const body = root.querySelector('body') ?? root
  for (const img of body.querySelectorAll('img')) {
    if (images.length >= MAX_CANDIDATE_IMAGES) break

    const src = img.getAttribute('src')
    if (!src || src.startsWith('data:')) continue
    if (looksLikeIcon(img)) continue

    const resolved = resolveUrl(src, baseUrl)
    if (resolved && !images.includes(resolved)) images.push(resolved)
  }

  return images.slice(0, MAX_CANDIDATE_IMAGES)
}

/** Busca theme-color y colores hex en atributos style="" inline (sin parsear CSS de verdad). */
function extractColors(root: HTMLElement): Array<string> {
  const colors: Array<string> = []

  const themeColor = root
    .querySelector('meta[name="theme-color"]')
    ?.getAttribute('content')
  if (themeColor && HEX_COLOR_PATTERN.test(themeColor)) {
    colors.push(themeColor)
  }
  HEX_COLOR_PATTERN.lastIndex = 0

  for (const el of root.querySelectorAll('[style]')) {
    if (colors.length >= MAX_COLORS) break
    const style = el.getAttribute('style') ?? ''
    const matches = style.match(HEX_COLOR_PATTERN)
    if (!matches) continue
    for (const match of matches) {
      if (colors.length >= MAX_COLORS) break
      if (!colors.includes(match)) colors.push(match)
    }
  }

  return colors
}

export function parseHtmlContent(
  html: string,
  baseUrl: string,
): ExtractedPageContent {
  const root = parse(html)

  const title = root.querySelector('title')?.textContent.trim() || null
  const metaDescription =
    root
      .querySelector('meta[name="description"]')
      ?.getAttribute('content')
      ?.trim() || null

  const headings = {
    h1: root
      .querySelectorAll('h1')
      .map((el) => el.textContent.trim())
      .filter(Boolean),
    h2: root
      .querySelectorAll('h2')
      .map((el) => el.textContent.trim())
      .filter(Boolean),
    h3: root
      .querySelectorAll('h3')
      .map((el) => el.textContent.trim())
      .filter(Boolean),
  }

  return {
    title,
    metaDescription,
    headings,
    visibleText: extractVisibleText(html, { excludeChrome: true }),
    candidateImages: extractCandidateImages(root, baseUrl),
    colors: extractColors(root),
  }
}
