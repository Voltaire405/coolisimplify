'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Square } from 'lucide-react'
import { cn } from '@workspace/ui/lib/utils'
import type { ResourceType } from '@/hooks/use-coolify'

export interface DeleteOptions {
  delete_volumes: boolean
  delete_configurations: boolean
  delete_connected_networks: boolean
  docker_cleanup: boolean
}

export function ModalShell({
  onCancel,
  labelledBy,
  children,
}: {
  onCancel: () => void
  labelledBy: string
  children: React.ReactNode
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="relative w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg"
      >
        {children}
      </div>
    </div>
  )
}

interface DeleteConfirmDialogProps {
  resourceName: string
  resourceType: ResourceType
  onCancel: () => void
  onConfirm: (opts: DeleteOptions) => void
}

export function DeleteConfirmDialog({
  resourceName,
  resourceType,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  // Conservative defaults: keep persistent data unless explicitly requested.
  // The Coolify API defaults every flag to true, so each one is sent explicitly.
  const [deleteVolumes, setDeleteVolumes] = useState(false)
  const [deleteConfigurations, setDeleteConfigurations] = useState(true)
  const [deleteNetworks, setDeleteNetworks] = useState(true)
  const [dockerCleanup, setDockerCleanup] = useState(false)
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const nameMatches = typed === resourceName

  return (
    <ModalShell onCancel={onCancel} labelledBy="delete-dialog-title">
      <h2
        id="delete-dialog-title"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <AlertTriangle className="h-4 w-4 text-destructive" />
        Delete {resourceType} &laquo;{resourceName}&raquo;
      </h2>

      <div
        className={cn(
          'mt-3 rounded-md border px-3 py-2 text-xs',
          deleteVolumes
            ? 'border-destructive/30 bg-destructive/5 text-destructive'
            : 'border-border bg-muted/50 text-muted-foreground',
        )}
      >
        {deleteVolumes ? (
          <>
            The containers, configuration <strong>and all data volumes</strong>{' '}
            of this {resourceType} will be permanently deleted. This cannot be
            undone.
          </>
        ) : (
          <>
            Only the Coolify resource and its containers will be removed.{' '}
            <strong>Data volumes will be kept</strong> on the server.
          </>
        )}
      </div>

      <div className="mt-3 space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={deleteVolumes}
            onChange={(e) => setDeleteVolumes(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span>
            Delete volumes <span className="text-destructive">(all persistent data)</span>
          </span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={deleteConfigurations}
            onChange={(e) => setDeleteConfigurations(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span>Delete configuration files</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={deleteNetworks}
            onChange={(e) => setDeleteNetworks(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span>Delete connected networks</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={dockerCleanup}
            onChange={(e) => setDockerCleanup(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span>Run docker cleanup on the server</span>
        </label>
      </div>

      <label className="mt-4 block text-xs text-muted-foreground">
        Type <span className="font-mono font-semibold text-foreground">{resourceName}</span> to
        confirm:
        <input
          ref={inputRef}
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40"
        />
      </label>

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Cancel
        </button>
        <button
          disabled={!nameMatches}
          onClick={() =>
            onConfirm({
              delete_volumes: deleteVolumes,
              delete_configurations: deleteConfigurations,
              delete_connected_networks: deleteNetworks,
              docker_cleanup: dockerCleanup,
            })
          }
          className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-white hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {deleteVolumes ? 'Delete with data' : 'Delete resource'}
        </button>
      </div>
    </ModalShell>
  )
}

interface StopConfirmDialogProps {
  names: string[]
  onCancel: () => void
  onConfirm: () => void
}

export function StopConfirmDialog({
  names,
  onCancel,
  onConfirm,
}: StopConfirmDialogProps) {
  const many = names.length > 1
  return (
    <ModalShell onCancel={onCancel} labelledBy="stop-dialog-title">
      <h2
        id="stop-dialog-title"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <Square className="h-4 w-4" />
        {many ? `Stop ${names.length} resources` : `Stop «${names[0]}»`}
      </h2>
      {many && (
        <ul className="mt-2 max-h-32 list-inside list-disc overflow-y-auto text-xs text-muted-foreground">
          {names.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {many ? 'They' : 'It'} will stay stopped and unreachable until started
        again. No data is deleted.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          autoFocus
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:bg-foreground/90"
        >
          {many ? `Stop ${names.length}` : 'Stop'}
        </button>
      </div>
    </ModalShell>
  )
}
