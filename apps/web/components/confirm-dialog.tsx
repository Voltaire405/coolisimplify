'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Square } from 'lucide-react'
import { cn } from '@workspace/ui/lib/utils'
import type { ResourceType } from '@/hooks/use-coolify'
import type { DeleteOptions } from '@/lib/types'
export type { DeleteOptions } from '@/lib/types'

const DEFAULT_DELETE_OPTIONS: DeleteOptions = {
  delete_volumes: false,
  delete_configurations: true,
  delete_connected_networks: true,
  docker_cleanup: false,
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

function DeleteWarning({
  deleteVolumes,
  subject,
}: {
  deleteVolumes: boolean
  subject: string
}) {
  return (
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
          The containers, configuration <strong>and all data volumes</strong> of{' '}
          {subject} will be permanently deleted. This cannot be undone.
        </>
      ) : (
        <>
          Only the Coolify resources and their containers will be removed.{' '}
          <strong>Data volumes will be kept</strong> on the server.
        </>
      )}
    </div>
  )
}

function DeleteOptionsFields({
  options,
  onChange,
}: {
  options: DeleteOptions
  onChange: (key: keyof DeleteOptions, value: boolean) => void
}) {
  return (
    <div className="mt-3 space-y-2 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={options.delete_volumes}
          onChange={(e) => onChange('delete_volumes', e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <span>
          Delete volumes{' '}
          <span className="text-destructive">(all persistent data)</span>
        </span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={options.delete_configurations}
          onChange={(e) => onChange('delete_configurations', e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <span>Delete configuration files</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={options.delete_connected_networks}
          onChange={(e) =>
            onChange('delete_connected_networks', e.target.checked)
          }
          className="h-4 w-4 rounded border-border"
        />
        <span>Delete connected networks</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={options.docker_cleanup}
          onChange={(e) => onChange('docker_cleanup', e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <span>Run docker cleanup on the server</span>
      </label>
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
  const [options, setOptions] = useState<DeleteOptions>(DEFAULT_DELETE_OPTIONS)
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

      <DeleteWarning
        deleteVolumes={options.delete_volumes}
        subject={`this ${resourceType}`}
      />

      <DeleteOptionsFields
        options={options}
        onChange={(key, value) =>
          setOptions((prev) => ({ ...prev, [key]: value }))
        }
      />

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
          onClick={() => onConfirm(options)}
          className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-white hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {options.delete_volumes ? 'Delete with data' : 'Delete resource'}
        </button>
      </div>
    </ModalShell>
  )
}

export interface BatchDeleteResource {
  uuid: string
  type: ResourceType
  name: string
}

interface BatchDeleteConfirmDialogProps {
  resources: BatchDeleteResource[]
  skipped?: number
  onCancel: () => void
  onConfirm: (opts: DeleteOptions) => void
}

export function BatchDeleteConfirmDialog({
  resources,
  skipped = 0,
  onCancel,
  onConfirm,
}: BatchDeleteConfirmDialogProps) {
  const [options, setOptions] = useState<DeleteOptions>(DEFAULT_DELETE_OPTIONS)
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const accepted = typed === 'ACCEPT'
  const countLabel = `${resources.length} resource${resources.length === 1 ? '' : 's'}`

  return (
    <ModalShell onCancel={onCancel} labelledBy="batch-delete-dialog-title">
      <h2
        id="batch-delete-dialog-title"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <AlertTriangle className="h-4 w-4 text-destructive" />
        Delete {countLabel}
      </h2>

      <p className="mt-2 text-xs text-muted-foreground">
        This destructive action permanently removes the selected resources.
        Review the list and options before continuing.
      </p>

      <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
        {resources.map((resource) => (
          <li
            key={`${resource.type}:${resource.uuid}`}
            className="flex items-center justify-between gap-2"
          >
            <span className="min-w-0 truncate">{resource.name}</span>
            <span className="shrink-0 text-[10px] tracking-wider text-muted-foreground uppercase">
              {resource.type}
            </span>
          </li>
        ))}
      </ul>
      {skipped > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {skipped} selected resource{skipped === 1 ? '' : 's'} will be skipped
          because it is no longer available or is already busy.
        </p>
      )}

      <DeleteWarning
        deleteVolumes={options.delete_volumes}
        subject="the selected resources"
      />
      <DeleteOptionsFields
        options={options}
        onChange={(key, value) =>
          setOptions((prev) => ({ ...prev, [key]: value }))
        }
      />

      <label className="mt-4 block text-xs text-muted-foreground">
        Type{' '}
        <span className="font-mono font-semibold text-foreground">ACCEPT</span>{' '}
        to confirm:
        <input
          ref={inputRef}
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-foreground/40 focus:outline-none"
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
          disabled={!accepted}
          onClick={() => onConfirm(options)}
          className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-white hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Delete {resources.length}
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
