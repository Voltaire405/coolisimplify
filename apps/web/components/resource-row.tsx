'use client'

import { StatusIndicator, LedCard } from './status-indicator'
import { ContextMenu } from './context-menu'
import {
  Box,
  Workflow,
  Database,
  Play,
  Square,
  Rocket,
  RotateCcw,
  MoreHorizontal,
  Loader2,
} from 'lucide-react'
import type { Resource } from '@/lib/types'
import { isResourceActive, type ResourceType, type BatchAction } from '@/hooks/use-coolify'

interface ResourceRowProps {
  resource: Resource
  type: ResourceType
  selected: boolean
  selectionIndex?: number
  busy?: boolean
  busyAction?: BatchAction | 'delete'
  onToggleSelect: () => void
  onAction: (action: BatchAction | 'delete') => void
  onBatchAdd: (action: BatchAction) => void
}

const typeIcons = {
  application: Box,
  service: Workflow,
  database: Database,
} as const

const ACTION_LABEL: Record<BatchAction | 'delete', string> = {
  start: 'starting',
  stop: 'stopping',
  restart: 'restarting',
  deploy: 'deploying',
  delete: 'deleting',
}

export function ResourceRow({
  resource,
  type,
  selected,
  selectionIndex,
  busy = false,
  busyAction,
  onToggleSelect,
  onAction,
  onBatchAdd,
}: ResourceRowProps) {
  const status = (resource as { status?: string }).status
  const active = isResourceActive(status)
  const name = (resource as { name?: string }).name || 'Unnamed'
  const domain = (resource as { fqdn?: string | null }).fqdn || undefined
  const Icon = typeIcons[type]
  const menuItems: Array<{
    label: string
    action: BatchAction | 'delete'
    disabled?: boolean
    dangerous?: boolean
  }> = [
    { label: 'Start', action: 'start', disabled: busy || active },
    { label: 'Stop', action: 'stop', disabled: busy || !active },
    { label: 'Restart', action: 'restart', disabled: busy },
    // Databases have no deploy concept in the Coolify API.
    ...(type !== 'database'
      ? [{ label: 'Redeploy', action: 'deploy' as const, disabled: busy }]
      : []),
    { label: 'Delete', action: 'delete' as const, dangerous: true, disabled: busy },
  ]

  return (
    <LedCard active={active} className="px-3 py-3 sm:px-4 sm:py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 items-start gap-2 sm:flex-1 sm:items-center sm:gap-3">
          {selected && selectionIndex ? (
            <button
              type="button"
              onClick={onToggleSelect}
              disabled={busy}
              aria-label={`${name} selected as ${selectionIndex}; click to remove from queue`}
              title={`Position ${selectionIndex} in batch queue`}
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold leading-none text-background tabular-nums disabled:opacity-40 sm:mt-0 sm:h-5 sm:w-5"
            >
              {selectionIndex}
            </button>
          ) : (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              aria-label={`Select ${name}`}
              disabled={busy}
              className="mt-1 h-5 w-5 shrink-0 rounded border-border disabled:opacity-40 sm:mt-0 sm:h-4 sm:w-4"
            />
          )}
          <StatusIndicator active={active} className="mt-2 shrink-0 sm:mt-0" />
          <Icon className="mt-1 h-4 w-4 shrink-0 text-muted-foreground sm:mt-0" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="min-w-0 max-w-full truncate text-sm font-medium">
                {name}
              </span>
              <span className="shrink-0 rounded border border-border px-1 py-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                {type}
              </span>
              {busy && (
                <span
                  role="status"
                  aria-live="polite"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-foreground/40 bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-foreground"
                >
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  {busyAction ? ACTION_LABEL[busyAction] : 'queued'}
                </span>
              )}
            </div>
            {domain && (
              <p className="truncate text-xs leading-5 text-muted-foreground">
                {domain}
              </p>
            )}
          </div>
        </div>

        <div className="ml-8 flex items-center justify-end gap-1 sm:ml-0">
          {type !== 'database' && (
            <button
              onClick={() => onBatchAdd('deploy')}
              disabled={busy}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 sm:h-auto sm:w-auto sm:p-1.5"
              aria-label="Queue redeploy"
              title={
                busy
                  ? 'Request in progress'
                  : 'Queue redeploy (rolling update if possible)'
              }
            >
              <Rocket className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => onBatchAdd('restart')}
            disabled={busy}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 sm:h-auto sm:w-auto sm:p-1.5"
            aria-label="Queue restart"
            title={busy ? 'Request in progress' : 'Queue restart (no rebuild)'}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onAction(active ? 'stop' : 'start')}
            disabled={busy}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50 sm:h-auto sm:w-auto sm:p-1.5"
            aria-label={busy ? 'Working' : active ? 'Stop' : 'Start'}
            title={busy ? 'Request in progress' : active ? 'Stop' : 'Start'}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : active ? (
              <Square className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>
          <ContextMenu items={menuItems} onSelect={onAction}>
            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
          </ContextMenu>
        </div>
      </div>
    </LedCard>
  )
}
