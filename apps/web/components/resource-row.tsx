'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@workspace/ui/lib/utils'
import { StatusIndicator, LedCard } from './status-indicator'
import { ContextMenu } from './context-menu'
import { InlineRename } from './inline-rename'
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
  Terminal,
} from 'lucide-react'
import type { Resource } from '@/lib/types'
import {
  isResourceActive,
  type ResourceType,
  type BatchAction,
  type RowAction,
} from '@/hooks/use-coolify'
import { canRunAction, isNeverDeployed } from '@/lib/resource-state'
import { isCloneable } from '@/lib/clone'
import { versionLabel } from '@/lib/app-detail'

interface ResourceRowProps {
  resource: Resource
  type: ResourceType
  selected: boolean
  selectionIndex?: number
  busy?: boolean
  busyAction?: RowAction
  /** This Application's config was edited but not yet applied (ADR-0005). */
  redeployNeeded?: boolean
  /** Pulse the row after palette navigation so the eye lands on it. */
  highlighted?: boolean
  onToggleSelect: () => void
  onAction: (action: RowAction) => void
  onBatchAdd: (action: BatchAction) => void
  onRename: (newName: string) => Promise<boolean>
  onOpenProperties?: () => void
}

const typeIcons = {
  application: Box,
  service: Workflow,
  database: Database,
} as const

const ACTION_LABEL: Record<RowAction, string> = {
  start: 'starting',
  stop: 'stopping',
  restart: 'restarting',
  deploy: 'deploying',
  delete: 'deleting',
  clone: 'cloning',
  properties: 'properties',
  variables: 'variables',
  logs: 'logs',
}

// Reason shown in title/aria-label when an action is disabled because the
// resource's current state does not allow it.
function unavailableReason(action: string): string {
  if (action === 'start') return 'Already running or transitioning'
  if (action === 'stop') return 'Not running'
  if (action === 'restart') return 'Only available while running or on error'
  if (action === 'deploy') return 'Only available while running or on error'
  return 'Not available in the current state'
}

export function ResourceRow({
  resource,
  type,
  selected,
  selectionIndex,
  busy = false,
  busyAction,
  redeployNeeded = false,
  highlighted = false,
  onToggleSelect,
  onAction,
  onBatchAdd,
  onRename,
  onOpenProperties,
}: ResourceRowProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (highlighted) {
      rootRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [highlighted])

  const status = (resource as { status?: string }).status
  const active = isResourceActive(status)
  const name = (resource as { name?: string }).name || 'Unnamed'
  const domain = (resource as { fqdn?: string | null }).fqdn || undefined
  // The API embeds the server a resource is actually deployed on at
  // destination.server; top-level server_id isn't reliable (see ADR-0001).
  const serverName = (resource as { destination?: { server?: { name?: string } } })
    .destination?.server?.name
  // Only applications carry a branch (git) or image tag (docker-image); the
  // value is classified via build_pack so Coolify's placeholder git fields on
  // non-git apps never leak onto the card (see app-detail.ts).
  const version =
    type === 'application' ? versionLabel(resource as Parameters<typeof versionLabel>[0]) : null
  const Icon = typeIcons[type]
  // Scope: only applications expose a logs endpoint here (databases and
  // services have their own paths, services additionally needing a
  // sub_service_name to pick a container).
  const logsUnavailable = isNeverDeployed(status)
  const disabledReason = (action: BatchAction) =>
    busy
      ? 'Request in progress'
      : !canRunAction(action, status)
        ? unavailableReason(action)
        : undefined
  const menuItems: Array<{
    label: string
    action: RowAction
    disabled?: boolean
    dangerous?: boolean
  }> = [
    {
      label: 'Start',
      action: 'start',
      disabled: busy || !canRunAction('start', status),
    },
    {
      label: 'Stop',
      action: 'stop',
      disabled: busy || !canRunAction('stop', status),
    },
    {
      label: 'Restart',
      action: 'restart',
      disabled: busy || !canRunAction('restart', status),
    },
    // Databases have no deploy concept in the Coolify API.
    ...(type !== 'database'
      ? [
          {
            label: 'Redeploy',
            action: 'deploy' as const,
            disabled: busy || !canRunAction('deploy', status),
          },
        ]
      : []),
    {
      label: 'Clone',
      action: 'clone' as const,
      disabled: busy || !isCloneable(resource, type),
    },
    {
      label: 'Details',
      action: 'properties' as const,
      disabled: busy,
    },
    {
      label: 'Variables',
      action: 'variables' as const,
      disabled: busy,
    },
    // Reading logs mutates nothing, so unlike its siblings this entry ignores
    // both `busy` and canRunAction: an exited container still holds the crash
    // trace, and a deploy in flight is exactly when you want to watch. Only a
    // resource that never got a container has nothing to read.
    ...(type === 'application'
      ? [
          {
            label: 'Logs',
            action: 'logs' as const,
            disabled: logsUnavailable,
          },
        ]
      : []),
    { label: 'Delete', action: 'delete' as const, dangerous: true, disabled: busy },
  ]

  return (
    <div
      ref={rootRef}
      className={cn(
        'scroll-mt-24 rounded-lg transition-shadow',
        highlighted && 'ring-2 ring-foreground/50',
      )}
    >
    <LedCard active={active} className="px-3 py-2.5 sm:px-3.5 sm:py-1.5">
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
            <span className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
              <InlineRename name={name} busy={busy} onSubmit={onRename} />
              <button
                type="button"
                onClick={onOpenProperties}
                disabled={busy || !onOpenProperties}
                aria-label={`View details of ${name}`}
                title="View details"
                className="shrink-0 rounded border border-border px-1 py-0 text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-muted disabled:cursor-default disabled:opacity-40"
              >
                {type}
              </button>
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
              {redeployNeeded && !busy && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400"
                  title="Configuration changed; redeploy to apply it"
                >
                  <Rocket className="h-2.5 w-2.5" />
                  Redeploy needed
                </span>
              )}
            </span>
            {(domain || serverName || version) && (
              <button
                type="button"
                onClick={onOpenProperties}
                disabled={busy || !onOpenProperties}
                aria-label={`View details of ${name}`}
                title="View details"
                className="block w-full text-left disabled:cursor-default"
              >
                {domain && (
                  <span className="block truncate text-xs leading-5 text-muted-foreground">
                    {domain}
                  </span>
                )}
                {(serverName || version) && (
                  <span className="block truncate text-xs leading-5 text-muted-foreground">
                    {serverName && <span>{serverName}</span>}
                    {serverName && version && <span> · </span>}
                    {version && <span className="font-mono">{version}</span>}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        <div className="ml-8 flex items-center justify-end gap-1 sm:ml-0">
          {type !== 'database' && (
            <button
              onClick={() => onBatchAdd('deploy')}
              disabled={busy || !canRunAction('deploy', status)}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 sm:h-auto sm:w-auto sm:p-1.5"
              aria-label={disabledReason('deploy') ?? 'Queue redeploy'}
              title={
                disabledReason('deploy') ??
                'Queue redeploy (rolling update if possible)'
              }
            >
              <Rocket className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => onBatchAdd('restart')}
            disabled={busy || !canRunAction('restart', status)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 sm:h-auto sm:w-auto sm:p-1.5"
            aria-label={disabledReason('restart') ?? 'Queue restart'}
            title={disabledReason('restart') ?? 'Queue restart (no rebuild)'}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onAction(active ? 'stop' : 'start')}
            disabled={
              busy ||
              (active
                ? !canRunAction('stop', status)
                : !canRunAction('start', status))
            }
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50 sm:h-auto sm:w-auto sm:p-1.5"
            aria-label={
              busy
                ? 'Working'
                : active
                  ? canRunAction('stop', status)
                    ? 'Stop'
                    : unavailableReason('stop')
                  : canRunAction('start', status)
                    ? 'Start'
                    : unavailableReason('start')
            }
            title={
              busy
                ? 'Request in progress'
                : active
                  ? canRunAction('stop', status)
                    ? 'Stop'
                    : unavailableReason('stop')
                  : canRunAction('start', status)
                    ? 'Start'
                    : unavailableReason('start')
            }
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : active ? (
              <Square className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>
          {/* Last in the cluster: the three buttons to its left mutate the
              resource, this one only reads it. */}
          {type === 'application' && (
            <button
              onClick={() => onAction('logs')}
              disabled={logsUnavailable}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 sm:h-auto sm:w-auto sm:p-1.5"
              aria-label={logsUnavailable ? 'No logs: never deployed' : 'View logs'}
              title={
                logsUnavailable
                  ? 'Never deployed — no container to read logs from'
                  : 'View logs'
              }
            >
              <Terminal className="h-3.5 w-3.5" />
            </button>
          )}
          <ContextMenu items={menuItems} onSelect={onAction}>
            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
          </ContextMenu>
        </div>
      </div>
    </LedCard>
    </div>
  )
}
