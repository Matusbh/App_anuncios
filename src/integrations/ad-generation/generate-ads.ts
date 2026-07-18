import Anthropic from '@anthropic-ai/sdk'

import { createAdSchema, createAdsArraySchema } from './schema.ts'
import type { AdLlmOutput } from './schema.ts'
import type { BrandProfileLlmOutput } from '../brand-profile/index.ts'
import type { z } from 'zod'

// Sonnet: copywriting creativo on-tone se beneficia de un modelo mas capaz que
// el Haiku que usamos para extraccion factual del perfil de marca.
const MODEL = 'claude-sonnet-5'
const LLM_TIMEOUT_MS = 25_000
const MAX_OUTPUT_TOKENS = 2_048
const MAX_RETRIES_ON_INVALID_OUTPUT = 1

const BASE_SYSTEM_PROMPT = `You are an on-brand ad copywriter. You write ads strictly from the brand profile the user provides.

Rules:
- Never invent facts, features, claims, or numbers that aren't in the brand profile.
- Match the brand's tone of voice.
- imageUrl must be exactly one of the candidate image URLs provided, or the empty string "" if none were provided. Never invent an image URL.
- Each ad needs a distinct creativeIdea (the concept/angle behind it) — don't submit near-duplicate ads.`

function buildBrandProfileBlock(brandProfile: BrandProfileLlmOutput): string {
  return `Brand profile:
- What they do: ${brandProfile.whatTheyDo}
- Target audience: ${brandProfile.targetAudience}
- Value proposition: ${brandProfile.valueProposition}
- Tone of voice: ${brandProfile.toneOfVoice}
(Any field above may read "not_found" — if so, do not invent that fact; work only with what's known.)

Candidate images (imageUrl must be exactly one of these, or "" if the list is empty):
${brandProfile.candidateImages.length > 0 ? brandProfile.candidateImages.join('\n') : '(none)'}`
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError')
      return 'Timeout esperando respuesta del LLM'
    return error.message
  }
  return String(error)
}

function extractToolInput(
  response: Anthropic.Message,
  toolName: string,
): unknown | null {
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === toolName) {
      return block.input
    }
  }
  return null
}

function logTokenUsage(
  usage: Anthropic.Usage,
  label: string,
  attempt: number,
): void {
  console.log(
    `[${label}] intento ${attempt} - tokens: input=${usage.input_tokens} output=${usage.output_tokens}`,
  )
}

function buildAdPropertiesSchema(allowedImageUrls: Array<string>) {
  const imageUrlProperty =
    allowedImageUrls.length > 0
      ? {
          type: 'string' as const,
          enum: allowedImageUrls,
          description: 'Must be exactly one of the candidate image URLs.',
        }
      : {
          type: 'string' as const,
          enum: [''],
          description:
            'No candidate images were provided; must be the empty string.',
        }

  return {
    creativeIdea: {
      type: 'string' as const,
      description: 'Short description of the concept/angle behind this ad.',
    },
    primaryText: {
      type: 'string' as const,
      description: 'The main body copy of the ad.',
    },
    headline: {
      type: 'string' as const,
      description: 'Short, punchy headline.',
    },
    description: {
      type: 'string' as const,
      description: 'Secondary supporting line.',
    },
    cta: {
      type: 'string' as const,
      description: 'Call to action text, e.g. "Shop now", "Learn more".',
    },
    imageUrl: imageUrlProperty,
  }
}

const AD_REQUIRED_FIELDS = [
  'creativeIdea',
  'primaryText',
  'headline',
  'description',
  'cta',
  'imageUrl',
]

function buildSingleAdToolInputSchema(allowedImageUrls: Array<string>) {
  return {
    type: 'object' as const,
    properties: buildAdPropertiesSchema(allowedImageUrls),
    required: AD_REQUIRED_FIELDS,
  }
}

function buildAdsArrayToolInputSchema(allowedImageUrls: Array<string>) {
  return {
    type: 'object' as const,
    properties: {
      ads: {
        type: 'array' as const,
        minItems: 1,
        maxItems: 3,
        items: {
          type: 'object' as const,
          properties: buildAdPropertiesSchema(allowedImageUrls),
          required: AD_REQUIRED_FIELDS,
        },
      },
    },
    required: ['ads'],
  }
}

interface StructuredCallSuccess<T> {
  success: true
  data: T
  usage: { inputTokens: number; outputTokens: number }
}

interface StructuredCallFailure {
  success: false
  errorReason: string
}

/** Loop compartido: llama al LLM forzando una tool call, valida con Zod, reintenta una vez si falla. */
async function requestStructuredAdOutput<T>(
  client: Anthropic,
  options: {
    label: string
    systemPrompt: string
    userPrompt: string
    toolName: string
    toolDescription: string
    toolInputSchema: Anthropic.Tool.InputSchema
    schema: z.ZodType<T>
  },
): Promise<StructuredCallSuccess<T> | StructuredCallFailure> {
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
          system: options.systemPrompt,
          messages: [
            {
              role: 'user',
              content: retryHint
                ? `${options.userPrompt}\n\n${retryHint}`
                : options.userPrompt,
            },
          ],
          tools: [
            {
              name: options.toolName,
              description: options.toolDescription,
              input_schema: options.toolInputSchema,
            },
          ],
          tool_choice: { type: 'tool', name: options.toolName },
        },
        { signal: AbortSignal.timeout(LLM_TIMEOUT_MS) },
      )
    } catch (error) {
      return {
        success: false,
        errorReason: `Llamada al LLM fallo (intento ${attempt}): ${describeError(error)}`,
      }
    }

    logTokenUsage(response.usage, options.label, attempt)

    const toolInput = extractToolInput(response, options.toolName)
    if (toolInput === null) {
      lastValidationError = 'El modelo no llamo a la herramienta esperada'
      retryHint = `Your previous response did not call the ${options.toolName} tool. You must call it with all required fields.`
      continue
    }

    const result = options.schema.safeParse(toolInput)
    if (result.success) {
      return {
        success: true,
        data: result.data,
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
      `[${options.label}] intento ${attempt} - validacion fallo: ${lastValidationError}`,
    )
    retryHint = `Your previous tool call did not match the required schema (${lastValidationError}). Call ${options.toolName} again with ALL required fields, correctly typed.`
  }

  return {
    success: false,
    errorReason: `La respuesta del LLM no paso la validacion tras ${MAX_RETRIES_ON_INVALID_OUTPUT + 1} intentos: ${lastValidationError}`,
  }
}

interface GenerateAdsSuccess {
  success: true
  ads: Array<AdLlmOutput>
  usage: { inputTokens: number; outputTokens: number }
}

interface GenerateAdsFailure {
  success: false
  errorReason: string
}

export type GenerateAdsResult = GenerateAdsSuccess | GenerateAdsFailure

/** Genera entre 1 y 3 anuncios nuevos on-tone a partir del perfil de marca. Nunca lanza. */
export async function generateAds(
  brandProfile: BrandProfileLlmOutput,
): Promise<GenerateAdsResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      success: false,
      errorReason: 'ANTHROPIC_API_KEY no esta configurado',
    }
  }

  const client = new Anthropic({ apiKey })
  const userPrompt = `${buildBrandProfileBlock(brandProfile)}

Generate between 1 and 3 distinct ad concepts for this brand. Prefer fewer, stronger ads over padding to 3 with a weak variation.`

  const result = await requestStructuredAdOutput(client, {
    label: 'generateAds',
    systemPrompt: BASE_SYSTEM_PROMPT,
    userPrompt,
    toolName: 'submit_ads',
    toolDescription: 'Submit the generated ads.',
    toolInputSchema: buildAdsArrayToolInputSchema(brandProfile.candidateImages),
    schema: createAdsArraySchema(brandProfile.candidateImages),
  })

  if (!result.success) return result
  return { success: true, ads: result.data.ads, usage: result.usage }
}

interface RegenerateOneAdSuccess {
  success: true
  ad: AdLlmOutput
  usage: { inputTokens: number; outputTokens: number }
}

interface RegenerateOneAdFailure {
  success: false
  errorReason: string
}

export type RegenerateOneAdResult =
  RegenerateOneAdSuccess | RegenerateOneAdFailure

/** Regenera UN solo anuncio. Si se pasa previousAd, evita repetir su idea creativa. Nunca lanza. */
export async function regenerateOneAd(
  brandProfile: BrandProfileLlmOutput,
  previousAd?: AdLlmOutput,
): Promise<RegenerateOneAdResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      success: false,
      errorReason: 'ANTHROPIC_API_KEY no esta configurado',
    }
  }

  const client = new Anthropic({ apiKey })

  const avoidBlock = previousAd
    ? `\n\nDo not repeat this previous creative idea/angle — come up with a genuinely different one:\nPrevious creative idea: "${previousAd.creativeIdea}"\nPrevious headline: "${previousAd.headline}"`
    : ''

  const userPrompt = `${buildBrandProfileBlock(brandProfile)}

Generate exactly 1 ad for this brand.${avoidBlock}`

  const result = await requestStructuredAdOutput(client, {
    label: 'regenerateOneAd',
    systemPrompt: BASE_SYSTEM_PROMPT,
    userPrompt,
    toolName: 'submit_ad',
    toolDescription: 'Submit the generated ad.',
    toolInputSchema: buildSingleAdToolInputSchema(brandProfile.candidateImages),
    schema: createAdSchema(brandProfile.candidateImages),
  })

  if (!result.success) return result
  return { success: true, ad: result.data, usage: result.usage }
}
