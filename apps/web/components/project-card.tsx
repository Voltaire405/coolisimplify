'use client'

import { useState, useMemo, useEffect } from 'react'
import { ResourceRow } from './resource-row'
import { StatusIndicator } from './status-indicator'
import { ChevronDown, ChevronRight, Folder, Layers } from 'lucide-react'
import type {
  Project,
  Application,
  Service,
  Database,
} from '@/lib/types'
import {
  isResourceActive,
  useEnvironments,
  type ResourceType,
  type BatchAction,
  type RowAction,
} from '@/hooks/use-coolify'

interface ProjectCardProps {
  project: Project
  applications: Application[]
  services: Service[]
  databases: Database[]
  selected: Set<string>
  onToggleSelect: (id: string) => void
  onAction: (uuid: string, type: ResourceType, action: RowAction) => void
  onBatchAdd: (uuid: string, type: ResourceType, action: BatchAction) => void
  onRename: (
    uuid: string,
    type: ResourceType,
    newName: string,
  ) => Promise<boolean>
  onOpenProperties?: (uuid: string, type: ResourceType) => void
  isBusy?: (uuid: string) => boolean
  busyAction?: (uuid: string) => RowAction | undefined
  selectionOrder?: Map<string, number>
  refreshSignal?: number
}

const TYPE_ORDER: Record<ResourceType, number> = {
  application: 0,
  service: 1,
  database: 2,
}

type ResourceWithType =
  | { type: 'application'; resource: Application }
  | { type: 'service'; resource: Service }
  | { type: 'database'; resource: Database }

export function ProjectCard({
  project,
  applications,
  services,
  databases,
  selected,
  onToggleSelect,
  onAction,
  onBatchAdd,
  onRename,
  onOpenProperties,
  isBusy,
  busyAction,
  selectionOrder,
  refreshSignal,
}: ProjectCardProps) {
  const [expanded, setExpanded] = useState(false)
  const { data: environments, refetch: refetchEnvironments } = useEnvironments(
    expanded ? project.uuid : null,
  )

  // After a resource is cloned into this project, re-fetch the environment
  // list so an already-expanded card shows the new resource without the user
  // having to collapse and expand it again.
  useEffect(() => {
    if (refreshSignal !== undefined && refreshSignal > 0) {
      void refetchEnvironments()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal])

  const envIds = useMemo(
    () => new Set(environments.map((e) => e.id)),
    [environments],
  )

  const groups = useMemo(() => {
    const map = new Map<
      number,
      { name: string; resources: ResourceWithType[] }
    >()
    for (const env of environments) {
      map.set(env.id, { name: env.name, resources: [] })
    }
    for (const app of applications) {
      if (app.environment_id != null && map.has(app.environment_id)) {
        map.get(app.environment_id)!.resources.push({ type: 'application', resource: app })
      }
    }
    for (const svc of services) {
      if (svc.environment_id != null && map.has(svc.environment_id)) {
        map.get(svc.environment_id)!.resources.push({ type: 'service', resource: svc })
      }
    }
    for (const db of databases) {
      if (db.environment_id != null && map.has(db.environment_id)) {
        map.get(db.environment_id)!.resources.push({ type: 'database', resource: db })
      }
    }
    const result = Array.from(map.values()).filter((g) => g.resources.length > 0)
    for (const group of result) {
      // Within each environment: applications first, then services, then databases,
      // each block sorted alphabetically.
      group.resources.sort((a, b) => {
        const t = TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
        if (t !== 0) return t
        return (a.resource.name || '').localeCompare(b.resource.name || '')
      })
    }
    result.sort((a, b) => a.name.localeCompare(b.name))
    return result
  }, [environments, applications, services, databases])

  const projectResources = useMemo(() => {
    if (envIds.size === 0) {
      return { apps: 0, services: 0, dbs: 0, active: 0, total: 0 }
    }
    const apps = applications.filter(
      (a) => a.environment_id != null && envIds.has(a.environment_id),
    )
    const svcs = services.filter(
      (s) => s.environment_id != null && envIds.has(s.environment_id),
    )
    const dbs = databases.filter(
      (d) => d.environment_id != null && envIds.has(d.environment_id),
    )
    const active =
      apps.filter((a) => isResourceActive(a.status)).length +
      svcs.filter((s) => isResourceActive(s.status)).length +
      dbs.filter((d) => isResourceActive(d.status)).length
    return {
      apps: apps.length,
      services: svcs.length,
      dbs: dbs.length,
      active,
      total: apps.length + svcs.length + dbs.length,
    }
  }, [applications, services, databases, envIds])

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2 px-3 py-3 text-left transition-colors hover:bg-muted/50 sm:items-center sm:gap-3 sm:px-4"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground sm:mt-0" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground sm:mt-0" />
        )}
        <Folder className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground sm:mt-0" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="truncate text-sm font-semibold">{project.name}</span>
            {project.description && (
              <span className="truncate text-xs leading-5 text-muted-foreground sm:inline">
                {project.description}
              </span>
            )}
          </div>
        </div>
        {expanded && projectResources.total > 0 && (
          <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:gap-3">
            <span className="flex items-center gap-1 leading-none">
              <Layers className="h-3 w-3" />
              {projectResources.total}
            </span>
            <span className="flex items-center gap-1 leading-none">
              <StatusIndicator active={projectResources.active > 0} />
              {projectResources.active}/{projectResources.total}
            </span>
          </div>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-3 pb-3 pt-2 sm:px-4 sm:pb-4">
          {groups.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No resources in this project.
            </p>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.name}>
                  <h4 className="mb-2 text-xs font-medium uppercase text-muted-foreground sm:tracking-wider">
                    {group.name}
                  </h4>
                  <div className="space-y-2">
                    {group.resources.map(({ resource, type }) => {
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
                            onAction(resource.uuid, type, action)
                          }
                          onBatchAdd={(action) =>
                            onBatchAdd(resource.uuid, type, action)
                          }
                          onRename={(newName) =>
                            onRename(resource.uuid, type, newName)
                          }
                          onOpenProperties={
                            onOpenProperties
                              ? () => onOpenProperties(resource.uuid, type)
                              : undefined
                          }
                        />
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
