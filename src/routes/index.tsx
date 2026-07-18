import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { FormEvent } from 'react'

import { createProject } from '../server/projects.ts'

export const Route = createFileRoute('/')({ component: Home })

// Progreso simulado: no hay SSE/polling de estado real, esto es solo
// feedback visual mientras dura la unica llamada bloqueante a createProject.
const STEPS = [
  'Extrayendo contenido de la pagina...',
  'Generando perfil de marca...',
  'Generando anuncios...',
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
        err instanceof Error ? err.message : 'Algo salio mal, intenta de nuevo',
      )
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold">Snaprime</h1>
      <p className="text-center text-gray-600">
        Pega la URL de una web y genera un perfil de marca y anuncios listos
        para editar.
      </p>

      <form onSubmit={handleSubmit} className="flex w-full gap-2">
        <input
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://ejemplo.com"
          disabled={submitting}
          className="flex-1 rounded border border-gray-300 px-3 py-2 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {submitting ? 'Creando...' : 'Crear'}
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
