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
  restart: 'redeploying',
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
    { label: 'Redeploy', action: 'restart', disabled: busy },
    { label: 'Delete', action: 'delete', dangerous: true, disabled: busy },
  ]

  return (
    <LedCard active={active} className="py-2.5">
      <div className="flex items-center gap-3">
        {selected && selectionIndex ? (
          <button
            type="button"
            onClick={onToggleSelect}
            disabled={busy}
            aria-label={`${name} selected as ${selectionIndex}; click to remove from queue`}
            title={`Position ${selectionIndex} in batch queue`}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold leading-none text-background tabular-nums disabled:opacity-40"
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
            className="h-4 w-4 rounded border-border disabled:opacity-40"
          />
        )}
        <StatusIndicator active={active} />
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{name}</span>
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
            <p className="truncate text-xs text-muted-foreground">{domain}</p>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onBatchAdd('restart')}
            disabled={busy}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
            aria-label="Queue redeploy"
            title={busy ? 'Request in progress' : 'Queue redeploy'}
          >
            <Rocket className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onAction(active ? 'stop' : 'start')}
            disabled={busy}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
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
