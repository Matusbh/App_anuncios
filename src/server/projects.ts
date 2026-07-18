import { createServerFn } from '@tanstack/react-start'
import { notFound } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../db/index.ts'
import { ads, brandProfiles, projects } from '../db/schema.ts'
import { extractPageContent } from '../integrations/web-extraction/index.ts'
import { generateBrandProfile } from '../integrations/brand-profile/index.ts'
import { generateAds } from '../integrations/ad-generation/index.ts'

export const createProject = createServerFn({ method: 'POST' })
  .validator(z.object({ url: z.string().min(1, 'URL requerida') }))
  .handler(async ({ data }) => {
    // Insert de una unica fila: .returning() siempre trae exactamente esa fila.
    const [project] = await db
      .insert(projects)
      .values({ url: data.url, status: 'pending' })
      .returning()

    await db
      .update(projects)
      .set({ status: 'extracting', updatedAt: new Date() })
      .where(eq(projects.id, project.id))

    const extracted = await extractPageContent(data.url)

    if (!extracted.success) {
      await db
        .update(projects)
        .set({
          status: 'failed',
          errorMessage: extracted.errorReason,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, project.id))
      return { projectId: project.id, status: 'failed' as const }
    }

    const profileResult = await generateBrandProfile(extracted.content)

    if (!profileResult.success) {
      // Fallo parcial: la extraccion SI funciono, asi que no descartamos el
      // proyecto entero solo porque el perfil de marca fallo. Queda "ready"
      // (hay algo que mostrar) con el motivo visible en error_message.
      await db
        .update(projects)
        .set({
          status: 'ready',
          errorMessage: `No se pudo generar el perfil de marca: ${profileResult.errorReason}`,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, project.id))
      return { projectId: project.id, status: 'ready' as const }
    }

    const profile = profileResult.profile
    await db.insert(brandProfiles).values({
      projectId: project.id,
      whatTheyDo: profile.whatTheyDo,
      targetAudience: profile.targetAudience,
      valueProposition: profile.valueProposition,
      toneOfVoice: profile.toneOfVoice,
      colorPalette: profile.colorPalette,
      candidateImages: profile.candidateImages,
    })

    const adsResult = await generateAds(profile)

    if (!adsResult.success) {
      // Mismo criterio: el perfil de marca ya se guardo, un fallo generando
      // anuncios no debe tirar ese trabajo. "ready" con lo que hay.
      await db
        .update(projects)
        .set({
          status: 'ready',
          errorMessage: `No se pudieron generar los anuncios: ${adsResult.errorReason}`,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, project.id))
      return { projectId: project.id, status: 'ready' as const }
    }

    await db.insert(ads).values(
      adsResult.ads.map((ad) => ({
        projectId: project.id,
        creativeIdea: ad.creativeIdea,
        primaryText: ad.primaryText,
        headline: ad.headline,
        description: ad.description,
        cta: ad.cta,
        imageUrl: ad.imageUrl,
      })),
    )

    await db
      .update(projects)
      .set({ status: 'ready', errorMessage: null, updatedAt: new Date() })
      .where(eq(projects.id, project.id))

    return { projectId: project.id, status: 'ready' as const }
  })

export const getProject = createServerFn({ method: 'GET' })
  .validator(z.object({ projectId: z.number() }))
  .handler(async ({ data }) => {
    const project = (
      await db.select().from(projects).where(eq(projects.id, data.projectId))
    ).at(0)

    if (!project) {
      throw notFound()
    }

    const brandProfile = (
      await db
        .select()
        .from(brandProfiles)
        .where(eq(brandProfiles.projectId, data.projectId))
    ).at(0)

    const projectAds = await db
      .select()
      .from(ads)
      .where(eq(ads.projectId, data.projectId))
      .orderBy(ads.id)

    return {
      project,
      brandProfile: brandProfile ?? null,
      ads: projectAds,
    }
  })
