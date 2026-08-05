'use client'

import { useState } from 'react'
import { Folder, Loader2 } from 'lucide-react'
import { ModalShell } from './confirm-dialog'
import { useClient } from '@/hooks/use-coolify'

interface CreateProjectDialogProps {
  onCancel: () => void
  /**
   * Called with the new project's uuid after a successful create. The parent
   * is responsible for refetching the project list and navigating.
   */
  onCreated: (projectUuid: string) => void
}

export function CreateProjectDialog({
  onCancel,
  onCreated,
}: CreateProjectDialogProps) {
  const { client } = useClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = name.trim()
  const canSubmit = !!client && trimmed.length > 0 && !submitting

  async function handleSubmit() {
    if (!client || !canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await client.createProject({
        name: trimmed,
        description: description.trim() || undefined,
      })
      onCreated(res.uuid)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
      setSubmitting(false)
    }
  }

  return (
    <ModalShell onCancel={onCancel} labelledBy="create-project-dialog-title">
      <h2
        id="create-project-dialog-title"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <Folder className="h-4 w-4" />
        Create project
      </h2>

      <div className="mt-3 space-y-3 text-sm">
        <label className="block">
          <span className="text-xs text-muted-foreground">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleSubmit()
              }
            }}
            autoFocus
            spellCheck={false}
            placeholder="my-project"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40"
          />
        </label>

        <label className="block">
          <span className="text-xs text-muted-foreground">
            Description (optional)
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What is this project for?"
            className="mt-1 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40"
          />
        </label>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {submitting ? 'Creating…' : 'Create'}
        </button>
      </div>
    </ModalShell>
  )
}
