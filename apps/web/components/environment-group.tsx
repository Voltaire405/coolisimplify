'use client'

import { useState, useMemo } from 'react'
import { ResourceRow } from './resource-row'
import { StatusIndicator } from './status-indicator'
import { ChevronDown, ChevronRight, Layers } from 'lucide-react'
import type { Application, Service, Database } from '@/lib/types'
import {
  isResourceActive,
  type ResourceType,
  type BatchAction,
  type RowAction,
} from '@/hooks/use-coolify'

type ResourceWithType =
  | { type: 'application'; resource: Application }
  | { type: 'service'; resource: Service }
  | { type: 'database'; resource: Database }

interface EnvironmentGroupProps {
  name: string
  resources: ResourceWithType[]
  projectName: string
  autoExpand: boolean
  selected: Set<string>
  onToggleSelect: (id: string) => void
  onAction: (
    uuid: string,
    type: ResourceType,
    action: RowAction,
    projectName?: string,
    environmentName?: string,
  ) => void
  onBatchAdd: (uuid: string, type: ResourceType, action: BatchAction) => void
  onRename: (
    uuid: string,
    type: ResourceType,
    newName: string,
  ) => Promise<boolean>
  onOpenProperties?: (
    uuid: string,
    type: ResourceType,
    projectName: string,
    environmentName: string,
  ) => void
  isBusy?: (uuid: string) => boolean
  busyAction?: (uuid: string) => RowAction | undefined
  selectionOrder?: Map<string, number>
}

export function EnvironmentGroup({
  name,
  resources,
  projectName,
  autoExpand,
  selected,
  onToggleSelect,
  onAction,
  onBatchAdd,
  onRename,
  onOpenProperties,
  isBusy,
  busyAction,
  selectionOrder,
}: EnvironmentGroupProps) {
  const [expanded, setExpanded] = useState(autoExpand)

  const active = useMemo(
    () => resources.filter((r) => isResourceActive(r.resource.status)).length,
    [resources],
  )
  const total = resources.length

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <h4 className="flex-1 truncate text-xs font-medium uppercase text-muted-foreground sm:tracking-wider">
          {name}
        </h4>
        <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 leading-none">
            <Layers className="h-3 w-3" />
            {total}
          </span>
          <span className="flex items-center gap-1 leading-none">
            <StatusIndicator active={active > 0} />
            {active}/{total}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {resources.map(({ resource, type }) => {
            const id = `${type}:${resource.uuid}`
            return (
              <ResourceRow
                key={id}
                resource={resource}
                type={type}
                selected={selected.has(id)}
                selectionIndex={selectionOrder?.get(id)}
                busy={isBusy ? isBusy(resource.uuid) : false}
                busyAction={busyAction?.(resource.uuid)}
                onToggleSelect={() => onToggleSelect(id)}
                onAction={(action) =>
                  onAction(resource.uuid, type, action, projectName, name)
                }
                onBatchAdd={(action) => onBatchAdd(resource.uuid, type, action)}
                onRename={(newName) => onRename(resource.uuid, type, newName)}
                onOpenProperties={
                  onOpenProperties
                    ? () =>
                        onOpenProperties(resource.uuid, type, projectName, name)
                    : undefined
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
