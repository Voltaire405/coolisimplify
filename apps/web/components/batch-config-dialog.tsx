'use client'

import { useMemo, useState } from 'react'
import { GitBranch, Loader2 } from 'lucide-react'
import { ModalShell } from './confirm-dialog'
import type { BatchConfigApp, BatchConfigTarget } from '@/lib/app-detail'
import { cn } from '@workspace/ui/lib/utils'

interface BatchConfigDialogProps {
  apps: BatchConfigApp[]
  target: BatchConfigTarget
  sharedValue: string
  /** Persist a batch of edits. Resolves per-app results; caller decides redeploy. */
  onConfirm: (
    changed: Array<{ app: BatchConfigApp; value: string }>,
    redeploy: boolean,
  ) => Promise<void>
  onCancel: () => void
}

export function BatchConfigDialog({
  apps,
  target,
  sharedValue,
  onConfirm,
  onCancel,
}: BatchConfigDialogProps) {
  const [shared, setShared] = useState(sharedValue)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [redeploy, setRedeploy] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A shared-field edit is the primary input; a per-row override exists only
  // while that row is being edited. Changing the shared value drops overrides
  // so the shared value is always the source of truth.
  const changeShared = (next: string) => {
    setShared(next)
    setOverrides({})
  }

  const rows = useMemo(
    () =>
      apps.map((app) => ({
        app,
        value: overrides[app.uuid] ?? shared,
      })),
    [apps, shared, overrides],
  )

  const changed = rows.filter((r) => r.value.trim() !== r.app.current)
  const deployable = changed.filter((r) => r.app.canDeploy)
  const skipped = changed.filter((r) => !r.app.canDeploy)

  const anyEmpty = rows.some((r) => r.value.trim() === '')
  const canSubmit = !submitting && !anyEmpty

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm(
        changed.map((r) => ({ app: r.app, value: r.value.trim() })),
        redeploy,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setSubmitting(false)
    }
  }

  return (
    <ModalShell onCancel={onCancel} labelledBy="batch-config-dialog-title">
      <h2
        id="batch-config-dialog-title"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <GitBranch className="h-4 w-4" />
        Edit {target.label} for {apps.length} application
        {apps.length === 1 ? '' : 's'}
      </h2>

      <label className="mt-4 block text-sm">
        <span className="text-xs text-muted-foreground">
          New {target.label} (applied to all)
        </span>
        <input
          type="text"
          value={shared}
          onChange={(e) => changeShared(e.target.value)}
          spellCheck={false}
          placeholder={target.kind === 'branch' ? 'main' : 'latest'}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40"
        />
        {!sharedValue && apps.length > 1 && (
          <span className="mt-1 block text-xs text-muted-foreground">
            Applications currently use different values; leave blank to keep
            them unchanged.
          </span>
        )}
      </label>

      <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
        {rows.map(({ app, value }) => {
          const overridden = overrides[app.uuid] !== undefined
          return (
            <li
              key={app.uuid}
              className="flex items-center justify-between gap-2"
            >
              <span className="min-w-0 flex-1 truncate" title={app.name}>
                {app.name}
                <span className="ml-1 text-muted-foreground">
                  ({app.current})
                </span>
              </span>
              <input
                type="text"
                value={value}
                onChange={(e) =>
                  setOverrides((prev) => ({
                    ...prev,
                    [app.uuid]: e.target.value,
                  }))
                }
                aria-label={`New ${target.label} for ${app.name}`}
                spellCheck={false}
                className={cn(
                  'w-32 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40',
                  overridden ? 'border-foreground/60' : 'opacity-70',
                )}
              />
            </li>
          )
        })}
      </ul>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={redeploy}
          onChange={(e) => setRedeploy(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-xs text-muted-foreground">
          Redeploy changed applications after saving
        </span>
      </label>

      <div className="mt-2 text-xs text-muted-foreground">
        {changed.length === 0
          ? 'No changes to save.'
          : `${changed.length} application${changed.length === 1 ? '' : 's'} changed`}
        {deployable.length > 0 && redeploy && (
          <span> &middot; {deployable.length} will be redeployed</span>
        )}
        {skipped.length > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            {' '}
            &middot; {skipped.length} skipped (not running)
          </span>
        )}
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
          onClick={() => void submit()}
          disabled={!canSubmit || changed.length === 0}
          className="flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {submitting
            ? 'Saving…'
            : changed.length === 0
              ? 'No changes'
              : `Save & ${redeploy ? 'redeploy' : 'save'} ${changed.length}`}
        </button>
      </div>
    </ModalShell>
  )
}
