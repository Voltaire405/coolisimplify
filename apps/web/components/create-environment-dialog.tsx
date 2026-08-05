'use client'

import { useState } from 'react'
import { Boxes, Loader2 } from 'lucide-react'
import { ModalShell } from './confirm-dialog'
import { useClient } from '@/hooks/use-coolify'

interface CreateEnvironmentDialogProps {
  projectUuid: string
  projectName: string
  onCancel: () => void
  /**
   * Called with the new environment's uuid after a successful create. The
   * parent is responsible for refetching environments and navigating.
   */
  onCreated: (environmentUuid: string) => void
}

export function CreateEnvironmentDialog({
  projectUuid,
  projectName,
  onCancel,
  onCreated,
}: CreateEnvironmentDialogProps) {
  const { client } = useClient()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = name.trim()
  const canSubmit = !!client && trimmed.length > 0 && !submitting

  async function handleSubmit() {
    if (!client || !canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await client.createEnvironment(projectUuid, trimmed)
      onCreated(res.uuid)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create environment')
      setSubmitting(false)
    }
  }

  return (
    <ModalShell onCancel={onCancel} labelledBy="create-environment-dialog-title">
      <h2
        id="create-environment-dialog-title"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <Boxes className="h-4 w-4" />
        Create environment
      </h2>

      <div className="mt-1 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Project: <span className="font-medium text-foreground">{projectName}</span>
      </div>

      <div className="mt-3 text-sm">
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
            placeholder="production"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40"
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
