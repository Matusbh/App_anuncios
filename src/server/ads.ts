import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../db/index.ts'
import { ads, brandProfiles } from '../db/schema.ts'
import type { Ad } from '../db/schema.ts'
import { regenerateOneAd } from '../integrations/ad-generation/index.ts'
import type { AdLlmOutput } from '../integrations/ad-generation/index.ts'
import type { BrandProfileLlmOutput } from '../integrations/brand-profile/index.ts'

const updateAdFieldsSchema = z
  .object({
    primaryText: z.string().optional(),
    headline: z.string().optional(),
    description: z.string().optional(),
    cta: z.string().optional(),
    imageUrl: z.string().optional(),
  })
  .refine(
    (fields) =>
      fields.primaryText !== undefined ||
      fields.headline !== undefined ||
      fields.description !== undefined ||
      fields.cta !== undefined ||
      fields.imageUrl !== undefined,
    { message: 'Must include at least one field to update' },
  )

export const updateAd = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      adId: z.number(),
      fields: updateAdFieldsSchema,
    }),
  )
  .handler(async ({ data }) => {
    const updated = (
      await db
        .update(ads)
        .set({ ...data.fields, isUserEdited: true, updatedAt: new Date() })
        .where(eq(ads.id, data.adId))
        .returning()
    ).at(0)

    if (!updated) {
      throw new Error(`Ad ${data.adId} not found`)
    }

    return updated
  })

function dbAdToLlmShape(row: Ad): AdLlmOutput {
  return {
    creativeIdea: row.creativeIdea ?? '',
    primaryText: row.primaryText ?? '',
    headline: row.headline ?? '',
    description: row.description ?? '',
    cta: row.cta ?? '',
    imageUrl: row.imageUrl ?? '',
  }
}

interface RegenerateAdSuccess {
  success: true
  ad: Ad
}

interface RegenerateAdFailure {
  success: false
  errorReason: string
}

export const regenerateAd = createServerFn({ method: 'POST' })
  .validator(z.object({ adId: z.number() }))
  .handler(
    async ({ data }): Promise<RegenerateAdSuccess | RegenerateAdFailure> => {
      const existingAd = (
        await db.select().from(ads).where(eq(ads.id, data.adId))
      ).at(0)
      if (!existingAd) {
        throw new Error(`Ad ${data.adId} not found`)
      }

      const brandProfile = (
        await db
          .select()
          .from(brandProfiles)
          .where(eq(brandProfiles.projectId, existingAd.projectId))
      ).at(0)
      if (!brandProfile) {
        return {
          success: false,
          errorReason: 'This project does not have a saved brand profile',
        }
      }

      const brandProfileShape: BrandProfileLlmOutput = {
        whatTheyDo: brandProfile.whatTheyDo,
        targetAudience: brandProfile.targetAudience,
        valueProposition: brandProfile.valueProposition,
        toneOfVoice: brandProfile.toneOfVoice,
        colorPalette: brandProfile.colorPalette ?? [],
        candidateImages: brandProfile.candidateImages ?? [],
      }

      const result = await regenerateOneAd(
        brandProfileShape,
        dbAdToLlmShape(existingAd),
      )

      if (!result.success) {
        return { success: false, errorReason: result.errorReason }
      }

      // Solo esta fila: nunca tocamos otros ads del mismo proyecto.
      const updated = (
        await db
          .update(ads)
          .set({
            creativeIdea: result.ad.creativeIdea,
            primaryText: result.ad.primaryText,
            headline: result.ad.headline,
            description: result.ad.description,
            cta: result.ad.cta,
            imageUrl: result.ad.imageUrl,
            isUserEdited: false,
            updatedAt: new Date(),
          })
          .where(eq(ads.id, data.adId))
          .returning()
      ).at(0)

      if (!updated) {
        throw new Error(`Ad ${data.adId} not found while updating`)
      }

      return { success: true, ad: updated }
    },
  )
