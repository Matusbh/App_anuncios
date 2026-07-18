import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

export const projects = pgTable('projects', {
  id: serial().primaryKey(),
  url: text().notNull(),
  status: text()
    .notNull()
    .default('pending')
    .$type<'pending' | 'extracting' | 'ready' | 'failed'>(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export type Project = InferSelectModel<typeof projects>
export type NewProject = InferInsertModel<typeof projects>

export const brandProfiles = pgTable('brand_profiles', {
  id: serial().primaryKey(),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  // Nunca null silencioso: si el LLM no lo encuentra en la pagina, se guarda "not_found".
  whatTheyDo: text('what_they_do').notNull(),
  targetAudience: text('target_audience').notNull(),
  valueProposition: text('value_proposition').notNull(),
  toneOfVoice: text('tone_of_voice').notNull(),
  colorPalette: jsonb('color_palette').$type<Array<string>>(),
  candidateImages: jsonb('candidate_images').$type<Array<string>>(),
  createdAt: timestamp('created_at').defaultNow(),
})

export type BrandProfile = InferSelectModel<typeof brandProfiles>
export type NewBrandProfile = InferInsertModel<typeof brandProfiles>

export const ads = pgTable('ads', {
  id: serial().primaryKey(),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  creativeIdea: text('creative_idea'),
  primaryText: text('primary_text'),
  headline: text(),
  description: text(),
  cta: text(),
  imageUrl: text('image_url'),
  isUserEdited: boolean('is_user_edited').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export type Ad = InferSelectModel<typeof ads>
export type NewAd = InferInsertModel<typeof ads>
