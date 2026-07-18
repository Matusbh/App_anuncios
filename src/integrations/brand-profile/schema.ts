import { z } from 'zod'

// "not_found" es un valor valido y esperado para los 4 campos de texto: el
// contrato de brand_profiles exige nunca inventar ni dejar null silencioso.
export const brandProfileLlmSchema = z.object({
  whatTheyDo: z.string().min(1),
  targetAudience: z.string().min(1),
  valueProposition: z.string().min(1),
  toneOfVoice: z.string().min(1),
  colorPalette: z.array(z.string()),
  candidateImages: z.array(z.string()),
})

export type BrandProfileLlmOutput = z.infer<typeof brandProfileLlmSchema>
