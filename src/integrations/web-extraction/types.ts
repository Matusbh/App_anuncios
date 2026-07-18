export interface ExtractedPageContent {
  title: string | null
  metaDescription: string | null
  headings: {
    h1: Array<string>
    h2: Array<string>
    h3: Array<string>
  }
  visibleText: string
  candidateImages: Array<string>
  colors: Array<string>
}

interface ExtractPageContentSuccess {
  success: true
  /** true cuando el contenido extraido es minimo/incompleto (ej. Browserless tambien fallo pero hubo algo de texto). */
  partial: boolean
  partialReason?: string
  source: 'fetch' | 'browserless'
  content: ExtractedPageContent
}

interface ExtractPageContentFailure {
  success: false
  errorReason: string
}

export type ExtractPageContentResult =
  ExtractPageContentSuccess | ExtractPageContentFailure
