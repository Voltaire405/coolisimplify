'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { ModalShell } from './confirm-dialog'
import { useClient } from '@/hooks/use-coolify'

interface DeleteProjectDialogProps {
  projectUuid: string
  projectName: string
  environmentCount: number
  /** True when at least one environment in the project still contains resources. */
  hasResources: boolean
  onCancel: () => void
  /**
   * Called after a successful delete. The parent is responsible for
   * refetching the project list and navigating away from the deleted node.
   */
  onDeleted: () => void
}

export function DeleteProjectDialog({
  projectUuid,
  projectName,
  environmentCount,
  hasResources,
  onCancel,
  onDeleted,
}: DeleteProjectDialogProps) {
  const { client } = useClient()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (!client || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await client.deleteProject(projectUuid)
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project')
      setSubmitting(false)
    }
  }

  return (
    <ModalShell onCancel={onCancel} labelledBy="delete-project-dialog-title">
      <h2
        id="delete-project-dialog-title"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <AlertTriangle className="h-4 w-4 text-destructive" />
        Delete project &laquo;{projectName}&raquo;
      </h2>

      {hasResources ? (
        <p className="mt-3 text-xs text-destructive">
          This project still contains resources inside its{' '}
          {environmentCount === 1 ? 'environment' : `${environmentCount} environments`}
          . Coolify will refuse to delete a project with non-empty
          environments — move or delete those resources first.
        </p>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          The project &laquo;{projectName}&raquo;
          {environmentCount > 0 &&
            ` and its ${environmentCount} environment${environmentCount === 1 ? '' : 's'}`}{' '}
          will be permanently removed from Coolify. This cannot be undone.
        </p>
      )}

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
          onClick={() => void handleDelete()}
          disabled={submitting || hasResources}
          className="flex items-center gap-2 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-white hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {submitting ? 'Deleting…' : 'Delete project'}
        </button>
      </div>
    </ModalShell>
  )
}
