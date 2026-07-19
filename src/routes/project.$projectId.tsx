import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { getProject } from '../server/projects.ts'
import { regenerateAd, updateAd } from '../server/ads.ts'
import type { Ad, BrandProfile, Project } from '../db/schema.ts'
import { SLOW_PROCESSING_THRESHOLD_MS } from '../lib/limits.ts'

export const Route = createFileRoute('/project/$projectId')({
  params: {
    parse: (raw) => ({ projectId: Number(raw.projectId) }),
    stringify: (parsed) => ({ projectId: String(parsed.projectId) }),
  },
  loader: ({ params }) => getProject({ data: { projectId: params.projectId } }),
  component: ProjectPage,
})

function ProjectPage() {
  const data = Route.useLoaderData()
  return (
    <ProjectView
      key={data.project.id}
      project={data.project}
      brandProfile={data.brandProfile}
      ads={data.ads}
    />
  )
}

function ProjectView({
  project,
  brandProfile,
  ads: initialAds,
}: {
  project: Project
  brandProfile: BrandProfile | null
  ads: Array<Ad>
}) {
  const [ads, setAds] = useState(initialAds)

  function handleAdUpdated(updated: Ad) {
    setAds((prev) => prev.map((ad) => (ad.id === updated.id ? updated : ad)))
  }

  const isSlow =
    project.processingTimeMs !== null &&
    project.processingTimeMs > SLOW_PROCESSING_THRESHOLD_MS

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="mb-1 break-all text-2xl font-bold">{project.url}</h1>
      <p className="mb-1 text-sm text-gray-500">Status: {project.status}</p>
      <p className="mb-6 text-sm text-gray-500">
        {formatProcessingSummary(
          project.processingTimeMs,
          project.totalTokensUsed,
        )}
      </p>

      {isSlow && (
        <div className="mb-6 rounded border border-yellow-300 bg-yellow-50 p-4 text-yellow-800">
          <p className="font-semibold">This took longer than expected</p>
          <p>
            The process took {formatSeconds(project.processingTimeMs)} in total
            (threshold: {formatSeconds(SLOW_PROCESSING_THRESHOLD_MS)}). Some
            part of it may have degraded due to a timeout.
          </p>
        </div>
      )}

      {project.status === 'failed' && (
        <div className="mb-6 rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <p className="font-semibold">This page could not be processed.</p>
          <p>{project.errorMessage}</p>
        </div>
      )}

      {project.status === 'ready' && project.errorMessage && (
        <div className="mb-6 rounded border border-yellow-300 bg-yellow-50 p-4 text-yellow-800">
          <p className="font-semibold">Partial result</p>
          <p>{project.errorMessage}</p>
        </div>
      )}

      {brandProfile && <BrandProfileCard profile={brandProfile} />}

      {ads.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {ads.map((ad) => (
            <AdCard key={ad.id} ad={ad} onUpdated={handleAdUpdated} />
          ))}
        </div>
      )}
    </div>
  )
}

function formatSeconds(ms: number | null): string {
  if (ms === null) return '—'
  return `${(ms / 1000).toFixed(1)}s`
}

// We don't use toLocaleString: without full ICU data (local Node or the
// Workers runtime) non-English locale thousands separators aren't applied.
function formatThousands(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatProcessingSummary(
  processingTimeMs: number | null,
  totalTokensUsed: number | null,
): string {
  const parts: Array<string> = []
  if (processingTimeMs !== null)
    parts.push(`Generated in ${formatSeconds(processingTimeMs)}`)
  if (totalTokensUsed !== null) {
    parts.push(`${formatThousands(totalTokensUsed)} tokens used`)
  }
  return parts.join(' · ')
}

function NotFoundAware({ value }: { value: string }) {
  if (value === 'not_found') {
    return <span className="italic text-gray-400">Not found on the page</span>
  }
  return <>{value}</>
}

function BrandProfileCard({ profile }: { profile: BrandProfile }) {
  return (
    <div className="rounded border border-gray-200 p-4">
      <h2 className="mb-3 text-lg font-semibold">Brand profile</h2>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase text-gray-500">
            What they do
          </dt>
          <dd>
            <NotFoundAware value={profile.whatTheyDo} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-gray-500">
            Target audience
          </dt>
          <dd>
            <NotFoundAware value={profile.targetAudience} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-gray-500">
            Value proposition
          </dt>
          <dd>
            <NotFoundAware value={profile.valueProposition} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-gray-500">
            Tone of voice
          </dt>
          <dd>
            <NotFoundAware value={profile.toneOfVoice} />
          </dd>
        </div>
      </dl>

      {profile.colorPalette && profile.colorPalette.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs font-medium uppercase text-gray-500">
            Colors
          </span>
          {profile.colorPalette.map((color) => (
            <span
              key={color}
              title={color}
              className="h-5 w-5 rounded-full border border-gray-300"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AdCard({ ad, onUpdated }: { ad: Ad; onUpdated: (ad: Ad) => void }) {
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function saveField(
    fields: Partial<
      Record<'primaryText' | 'headline' | 'description' | 'cta', string>
    >,
  ) {
    setError(null)
    try {
      const updated = await updateAd({ data: { adId: ad.id, fields } })
      onUpdated(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the change')
    }
  }

  async function handleRegenerate() {
    setRegenerating(true)
    setError(null)
    try {
      const result = await regenerateAd({ data: { adId: ad.id } })
      if (!result.success) {
        setError(result.errorReason)
      } else {
        onUpdated(result.ad)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not regenerate')
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <div
      className="flex flex-col rounded border border-gray-200 p-4"
      data-testid="ad-card"
      data-ad-id={ad.id}
    >
      {ad.imageUrl ? (
        <img
          src={ad.imageUrl}
          alt={ad.headline ?? ''}
          className="mb-3 h-40 w-full rounded object-cover"
        />
      ) : (
        <div className="mb-3 flex h-40 w-full items-center justify-center rounded bg-gray-100 text-sm text-gray-400">
          No image
        </div>
      )}

      <EditableField
        label="Headline"
        value={ad.headline ?? ''}
        onSave={(value) => saveField({ headline: value })}
        className="text-lg font-semibold"
      />
      <EditableField
        label="Primary text"
        value={ad.primaryText ?? ''}
        onSave={(value) => saveField({ primaryText: value })}
        multiline
      />
      <EditableField
        label="Description"
        value={ad.description ?? ''}
        onSave={(value) => saveField({ description: value })}
        multiline
      />
      <EditableField
        label="CTA"
        value={ad.cta ?? ''}
        onSave={(value) => saveField({ cta: value })}
        className="mt-2 inline-block w-fit rounded bg-black px-3 py-1 text-sm text-white"
      />

      {ad.isUserEdited && (
        <p className="mt-2 text-xs text-gray-400">Manually edited</p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <button
        onClick={handleRegenerate}
        disabled={regenerating}
        className="mt-3 rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
      >
        {regenerating ? 'Regenerating...' : 'Regenerate'}
      </button>
    </div>
  )
}

function EditableField({
  label,
  value,
  onSave,
  multiline = false,
  className = '',
}: {
  label: string
  value: string
  onSave: (value: string) => void
  multiline?: boolean
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  function commit() {
    setEditing(false)
    if (draft !== value) onSave(draft)
  }

  if (editing) {
    return (
      <div className="mb-2">
        <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
          {label}
        </span>
        {multiline ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setDraft(value)
                setEditing(false)
              }
            }}
            rows={3}
            className="w-full rounded border border-gray-300 p-1 text-sm"
          />
        ) : (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') {
                setDraft(value)
                setEditing(false)
              }
            }}
            className="w-full rounded border border-gray-300 p-1 text-sm"
          />
        )}
      </div>
    )
  }

  return (
    <div className="mb-2 cursor-text" onClick={() => setEditing(true)}>
      <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
        {label}
      </span>
      <p className={className || 'text-sm'}>
        {value || (
          <span className="italic text-gray-400">(empty, click to edit)</span>
        )}
      </p>
    </div>
  )
}
