'use client'

import { useMemo } from 'react'
import { ResourceRow } from './resource-row'
import { StatusIndicator } from './status-indicator'
import { Layers } from 'lucide-react'
import type { ResourceWithType } from '@/lib/tree'
import {
  isResourceActive,
  type ResourceType,
  type BatchAction,
  type RowAction,
} from '@/hooks/use-coolify'

interface EnvironmentSectionProps {
  /** Header text: the Environment name, prefixed with the Project name on aggregate views. */
  title: string
  projectName: string
  environmentName: string
  resources: ResourceWithType[]
  selected: Set<string>
  onToggleSelect: (id: string) => void
  onAction: (uuid: string, type: ResourceType, action: RowAction) => void
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

export function EnvironmentSection({
  title,
  projectName,
  environmentName,
  resources,
  selected,
  onToggleSelect,
  onAction,
  onBatchAdd,
  onRename,
  onOpenProperties,
  isBusy,
  busyAction,
  selectionOrder,
}: EnvironmentSectionProps) {
  const active = useMemo(
    () => resources.filter((r) => isResourceActive(r.resource.status)).length,
    [resources],
  )
  const total = resources.length

  return (
    <section>
      <div className="flex items-center gap-2">
        <h4 className="min-w-0 flex-1 truncate text-xs font-medium uppercase text-muted-foreground sm:tracking-wider">
          {title}
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
      </div>

      {total === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No resources in this environment.
        </p>
      ) : (
        <div className="mt-2 space-y-1.5">
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
                onAction={(action) => onAction(resource.uuid, type, action)}
                onBatchAdd={(action) => onBatchAdd(resource.uuid, type, action)}
                onRename={(newName) => onRename(resource.uuid, type, newName)}
                onOpenProperties={
                  onOpenProperties
                    ? () =>
                        onOpenProperties(
                          resource.uuid,
                          type,
                          projectName,
                          environmentName,
                        )
                    : undefined
                }
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
