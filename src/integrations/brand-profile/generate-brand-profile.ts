import Anthropic from '@anthropic-ai/sdk'

import { brandProfileLlmSchema } from './schema.ts'
import type { BrandProfileLlmOutput } from './schema.ts'
import type { ExtractedPageContent } from '../web-extraction/index.ts'
import { LLM_TIMEOUT_MS } from '../../lib/limits.ts'

// Haiku: extraccion estructurada de hechos explicitos, no razonamiento creativo
// profundo. Rapido y barato, encaja con el requisito de coste/latencia acotados.
const MODEL = 'claude-haiku-4-5'
const MAX_OUTPUT_TOKENS = 1024
/** Tope de caracteres de texto visible enviados al LLM, para acotar coste por llamada. */
const MAX_VISIBLE_TEXT_CHARS = 6_000
const MAX_HEADINGS_PER_LEVEL = 10
const MAX_RETRIES_ON_INVALID_OUTPUT = 1

const TOOL_NAME = 'submit_brand_profile'

// Mantener en sync manualmente con brandProfileLlmSchema (son 6 campos fijos,
// no vale la pena una dependencia de zod-to-json-schema para esto).
const BRAND_PROFILE_TOOL_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    whatTheyDo: {
      type: 'string',
      description:
        'What the company/product does, in 1-2 sentences. "not_found" if not present in the content.',
    },
    targetAudience: {
      type: 'string',
      description:
        'Who the product/service is for. "not_found" if not present in the content.',
    },
    valueProposition: {
      type: 'string',
      description:
        'The main value proposition. "not_found" if not present in the content.',
    },
    toneOfVoice: {
      type: 'string',
      description:
        'Brand tone/voice (e.g. "professional and direct", "warm and casual"). "not_found" if it cannot be inferred from the text.',
    },
    colorPalette: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Brand colors in hex if identifiable in the provided content. Empty array if none are clear.',
    },
    candidateImages: {
      type: 'array',
      items: { type: 'string' },
      description:
        'URLs of candidate images to represent the brand, only if they appear in the provided content. Empty array if none are good.',
    },
  },
  required: [
    'whatTheyDo',
    'targetAudience',
    'valueProposition',
    'toneOfVoice',
    'colorPalette',
    'candidateImages',
  ],
}

const SYSTEM_PROMPT = `You are a brand analyst. You extract a structured brand profile strictly from the page content the user provides.

Rules:
- Only use facts present in the provided content. Never invent, assume, or infer facts that aren't stated.
- If a text field's value is not present in the provided content, respond with exactly the string "not_found" for that field (lowercase, with the underscore, nothing else added).
- For colorPalette and candidateImages, only include entries that actually appear in the provided content. An empty array is correct and expected when nothing qualifies.
- Always respond by calling the ${TOOL_NAME} tool with all required fields filled in.`

interface GenerateBrandProfileSuccess {
  success: true
  profile: BrandProfileLlmOutput
  usage: { inputTokens: number; outputTokens: number }
}

interface GenerateBrandProfileFailure {
  success: false
  errorReason: string
}

export type GenerateBrandProfileResult =
  GenerateBrandProfileSuccess | GenerateBrandProfileFailure

function buildUserPrompt(extracted: ExtractedPageContent): string {
  const visibleText = extracted.visibleText.slice(0, MAX_VISIBLE_TEXT_CHARS)
  const h1 = extracted.headings.h1.slice(0, MAX_HEADINGS_PER_LEVEL)
  const h2 = extracted.headings.h2.slice(0, MAX_HEADINGS_PER_LEVEL)
  const h3 = extracted.headings.h3.slice(0, MAX_HEADINGS_PER_LEVEL)

  return `Page content extracted from a website:

Title: ${extracted.title ?? '(none)'}
Meta description: ${extracted.metaDescription ?? '(none)'}

H1: ${h1.length > 0 ? h1.join(' | ') : '(none)'}
H2: ${h2.length > 0 ? h2.join(' | ') : '(none)'}
H3: ${h3.length > 0 ? h3.join(' | ') : '(none)'}

Visible text:
"""
${visibleText || '(no visible text extracted)'}
"""

Candidate images found on the page (only reuse ones from this list, do not invent new URLs):
${extracted.candidateImages.length > 0 ? extracted.candidateImages.join('\n') : '(none)'}

Colors found on the page (only reuse ones from this list, do not invent new colors):
${extracted.colors.length > 0 ? extracted.colors.join(', ') : '(none)'}`
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError')
      return 'Timeout waiting for the LLM response'
    return error.message
  }
  return String(error)
}

function extractToolInput(response: Anthropic.Message): unknown | null {
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === TOOL_NAME) {
      return block.input
    }
  }
  return null
}

function logTokenUsage(usage: Anthropic.Usage, attempt: number): void {
  console.log(
    `[generateBrandProfile] intento ${attempt} - tokens: input=${usage.input_tokens} output=${usage.output_tokens}`,
  )
}

/** Si el LLM no aporta colores/imagenes utilizables, cae a lo que ya trajo la extraccion. */
function applyExtractionFallbacks(
  profile: BrandProfileLlmOutput,
  extracted: ExtractedPageContent,
): BrandProfileLlmOutput {
  return {
    ...profile,
    colorPalette:
      profile.colorPalette.length > 0 ? profile.colorPalette : extracted.colors,
    candidateImages:
      profile.candidateImages.length > 0
        ? profile.candidateImages
        : extracted.candidateImages,
  }
}

/**
 * Genera un perfil de marca estructurado a partir del contenido ya extraido de
 * una pagina. Nunca lanza: los fallos de red/timeout/validacion se devuelven
 * como success: false.
 */
export async function generateBrandProfile(
  extracted: ExtractedPageContent,
): Promise<GenerateBrandProfileResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      success: false,
      errorReason: 'ANTHROPIC_API_KEY is not configured',
    }
  }

  const client = new Anthropic({ apiKey })
  const userPrompt = buildUserPrompt(extracted)

  let retryHint: string | undefined
  let lastValidationError = ''

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES_ON_INVALID_OUTPUT + 1;
    attempt++
  ) {
    let response: Anthropic.Message
    try {
      response = await client.messages.create(
        {
          model: MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: retryHint ? `${userPrompt}\n\n${retryHint}` : userPrompt,
            },
          ],
          tools: [
            {
              name: TOOL_NAME,
              description: 'Submit the extracted brand profile.',
              input_schema: BRAND_PROFILE_TOOL_INPUT_SCHEMA,
            },
          ],
          tool_choice: { type: 'tool', name: TOOL_NAME },
        },
        { signal: AbortSignal.timeout(LLM_TIMEOUT_MS) },
      )
    } catch (error) {
      return {
        success: false,
        errorReason: `LLM call failed (attempt ${attempt}): ${describeError(error)}`,
      }
    }

    logTokenUsage(response.usage, attempt)

    // See the equivalent check in ad-generation/generate-ads.ts: a truncated
    // tool call fails validation with a confusing "field X is missing" error
    // rather than a clear one, so handle it explicitly and tell the model why.
    if (response.stop_reason === 'max_tokens') {
      lastValidationError =
        'Response was cut off: it exceeded the output token limit before completing'
      retryHint = `Your previous response was cut off because it exceeded the token limit before finishing the ${TOOL_NAME} call. Keep every field noticeably shorter so the full response fits well within the limit.`
      continue
    }

    const toolInput = extractToolInput(response)
    if (toolInput === null) {
      lastValidationError = 'The model did not call the expected tool'
      retryHint = `Your previous response did not call the ${TOOL_NAME} tool. You must call it with all required fields.`
      continue
    }

    const result = brandProfileLlmSchema.safeParse(toolInput)
    if (result.success) {
      return {
        success: true,
        profile: applyExtractionFallbacks(result.data, extracted),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      }
    }

    lastValidationError = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    console.log(
      `[generateBrandProfile] intento ${attempt} - validacion fallo: ${lastValidationError}`,
    )
    retryHint = `Your previous tool call did not match the required schema (${lastValidationError}). Call ${TOOL_NAME} again with ALL required fields, correctly typed.`
  }

  return {
    success: false,
    errorReason: `The LLM response did not pass validation after ${MAX_RETRIES_ON_INVALID_OUTPUT + 1} attempts: ${lastValidationError}`,
  }
}
