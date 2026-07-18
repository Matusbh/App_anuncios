import { z } from 'zod'

const adShape = z.object({
  creativeIdea: z.string().min(1),
  primaryText: z.string().min(1),
  headline: z.string().min(1),
  description: z.string().min(1),
  cta: z.string().min(1),
  imageUrl: z.string(),
})

export type AdLlmOutput = z.infer<typeof adShape>

/**
 * imageUrl debe ser exactamente una de las candidateImages del perfil de marca,
 * o "" si el perfil no trae ninguna candidata (nunca una URL inventada).
 */
export function createAdSchema(allowedImageUrls: Array<string>) {
  const hasCandidates = allowedImageUrls.length > 0
  return adShape.refine(
    (ad) =>
      hasCandidates
        ? allowedImageUrls.includes(ad.imageUrl)
        : ad.imageUrl === '',
    {
      message: hasCandidates
        ? `imageUrl debe ser una de las candidateImages del perfil: ${allowedImageUrls.join(', ')}`
        : 'No hay candidateImages disponibles; imageUrl debe ser un string vacio.',
      path: ['imageUrl'],
    },
  )
}

export function createAdsArraySchema(allowedImageUrls: Array<string>) {
  return z.object({
    ads: z.array(createAdSchema(allowedImageUrls)).min(1).max(3),
  })
}
