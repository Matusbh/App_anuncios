import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { FormEvent } from 'react'

import { createProject } from '../server/projects.ts'

export const Route = createFileRoute('/')({ component: Home })

// Simulated progress: there's no real SSE/status polling, this is just
// visual feedback while the single blocking createProject call runs.
const STEPS = [
  'Extracting page content...',
  'Generating brand profile...',
  'Generating ads...',
]

function Home() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!submitting) return
    setStepIndex(0)
    const timers = [
      setTimeout(() => setStepIndex(1), 4000),
      setTimeout(() => setStepIndex(2), 12000),
    ]
    return () => timers.forEach(clearTimeout)
  }, [submitting])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!url.trim()) return

    setError(null)
    setSubmitting(true)
    try {
      const result = await createProject({ data: { url: url.trim() } })
      await navigate({
        to: '/project/$projectId',
        params: { projectId: result.projectId },
      })
    } catch (err) {
      setSubmitting(false)
      setError(
        err instanceof Error ? err.message : 'Something went wrong, try again',
      )
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold">Snaprime</h1>
      <p className="text-center text-gray-600">
        Paste a website URL and generate a brand profile and ready-to-edit ads.
      </p>

      <form onSubmit={handleSubmit} className="flex w-full gap-2">
        <input
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com"
          disabled={submitting}
          className="flex-1 rounded border border-gray-300 px-3 py-2 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {submitting ? 'Creating...' : 'Create'}
        </button>
      </form>

      {submitting && (
        <div className="w-full rounded border border-blue-200 bg-blue-50 p-4 text-blue-800">
          {STEPS[stepIndex]}
        </div>
      )}

      {error && (
        <div className="w-full rounded border border-red-200 bg-red-50 p-4 text-red-800">
          {error}
        </div>
      )}
    </div>
  )
}
