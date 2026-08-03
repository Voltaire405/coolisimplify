'use client'

import { Box, Workflow, Database, Server, GitBranch, Container, Tag, Folder, Layers } from 'lucide-react'
import { ModalShell } from './confirm-dialog'
import { CopyButton } from './copy-button'
import { StatusIndicator } from './status-indicator'
import { EnvironmentVariableEditor } from './environment-variable-editor'
import { isResourceActive, useClient } from '@/hooks/use-coolify'
import type { Resource, ResourceType, Tag as TagType } from '@/lib/types'
import { classifyResourceState, RESOURCE_STATE_LABEL } from '@/lib/resource-state'
import { cn } from '@workspace/ui/lib/utils'

const typeIcons = {
  application: Box,
  service: Workflow,
  database: Database,
} as const

interface ResourcePropertiesDialogProps {
  resource: Resource
  type: ResourceType
  projectName: string
  environmentName: string
  onClose: () => void
  /** Toast sink; forwarded to the env editor for save/delete feedback. */
  onNotify?: (message: string, type: 'success' | 'error') => void
}

function PropertyRow({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className={cn('min-w-0 flex-1', className)}>
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="mt-0.5 text-sm text-foreground">{children}</div>
      </div>
    </div>
  )
}

function Value({ children }: { children: React.ReactNode }) {
  return <span className="break-words whitespace-pre-wrap">{children}</span>
}

export function ResourcePropertiesDialog({
  resource,
  type,
  projectName,
  environmentName,
  onClose,
  onNotify,
}: ResourcePropertiesDialogProps) {
  const { client } = useClient()
  const Icon = typeIcons[type]
  const name = (resource as { name?: string }).name || 'Unnamed'
  const status = (resource as { status?: string }).status
  const state = classifyResourceState(status)
  const active = isResourceActive(status)

  // The API embeds the server a resource is actually deployed on at
  // destination.server — server_id on the resource itself isn't reliable
  // (not present for every resource type, and Server.id from GET /servers
  // isn't guaranteed either, so joining the two was matching arbitrarily).
  const serverName = (resource as { destination?: { server?: { name?: string } } }).destination
    ?.server?.name

  // Application-specific fields (git / docker image).
  const app = type === 'application' ? (resource as ApplicationLike) : null
  const repo = app?.git_repository?.trim()
  const branch = app?.git_branch?.trim()
  const dockerImage = app?.docker_registry_image_name?.trim()
  const dockerImageTag = app?.docker_registry_image_tag?.trim()
  const showGit = !!repo
  const showDockerImage = !!dockerImage

  const fqdn = (resource as { fqdn?: string | null }).fqdn?.trim()
  const portsExposes = (resource as { ports_exposes?: string }).ports_exposes?.trim()
  const portsMappings = (resource as { ports_mappings?: string | null }).ports_mappings?.trim()
  const networkAliases = (resource as { custom_network_aliases?: string | null })
    .custom_network_aliases?.trim()
  // Coolify names the container after the resource UUID; the API does not
  // expose a separate container_name field.
  const containerName = (resource as { container_name?: string | null }).container_name?.trim() || resource.uuid
  const tags = (resource as { tags?: TagType[] | null }).tags

  return (
    <ModalShell onCancel={onClose} labelledBy="resource-properties-title">
      <div className="flex max-h-[calc(100dvh-3rem)] flex-col overflow-y-auto">
        <div className="flex items-center gap-2 pr-8">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h2 id="resource-properties-title" className="min-w-0 truncate text-sm font-semibold">
            {name}
          </h2>
          <span className="shrink-0 rounded border border-border px-1 py-0 text-[10px] uppercase tracking-wider text-muted-foreground">
            {type}
          </span>
        </div>

        <div className="mt-4 space-y-3">
          <PropertyRow icon={Server} label="Server">
            <Value>{serverName ?? '—'}</Value>
          </PropertyRow>

          <PropertyRow icon={Folder} label="Project">
            <Value>{projectName || '—'}</Value>
          </PropertyRow>

          <PropertyRow icon={Layers} label="Environment">
            <Value>{environmentName || '—'}</Value>
          </PropertyRow>

          {type === 'application' && showGit && (
            <PropertyRow icon={GitBranch} label="Repository">
              <Value>
                {repo}
                {branch && (
                  <>
                    {' '}
                    <span className="text-muted-foreground">({branch})</span>
                  </>
                )}
              </Value>
            </PropertyRow>
          )}

          {type === 'application' && !showGit && showDockerImage && (
            <PropertyRow icon={Container} label="Docker image">
              <Value>
                {dockerImage}
                {dockerImageTag && (
                  <>
                    :
                    <span className="text-muted-foreground">{dockerImageTag}</span>
                  </>
                )}
              </Value>
            </PropertyRow>
          )}

          {status && (
            <PropertyRow icon={Box} label="Status">
              <span className="inline-flex items-center gap-2">
                <StatusIndicator active={active} className="h-2 w-2" />
                <span className="capitalize">{RESOURCE_STATE_LABEL[state].toLowerCase()}</span>
              </span>
            </PropertyRow>
          )}

          {type === 'application' && fqdn && (
            <PropertyRow icon={Box} label="Domain">
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 break-words">{fqdn}</span>
                <CopyButton value={fqdn} label={`Copy domain ${fqdn}`} />
              </div>
            </PropertyRow>
          )}

          {portsExposes && (
            <PropertyRow icon={Box} label="Ports exposed">
              <Value>{portsExposes}</Value>
            </PropertyRow>
          )}

          {portsMappings && (
            <PropertyRow icon={Box} label="Port mappings">
              <Value>{portsMappings}</Value>
            </PropertyRow>
          )}

          {networkAliases && (
            <PropertyRow icon={Box} label="Network aliases">
              <Value>{networkAliases}</Value>
            </PropertyRow>
          )}

          <PropertyRow icon={Container} label="Container name">
            <Value>{containerName}</Value>
          </PropertyRow>

          <PropertyRow icon={Tag} label="Tags">
            {tags && tags.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag.uuid}
                    className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    {tag.name}
                  </span>
                ))}
              </span>
            ) : (
              <Value>—</Value>
            )}
          </PropertyRow>
        </div>

        {client && (
          <div className="mt-4 border-t border-border pt-3">
            <EnvironmentVariableEditor
              client={client}
              type={type}
              resourceUuid={resource.uuid}
              onChanged={(message) => onNotify?.(message, 'success')}
              onError={(message) => onNotify?.(message, 'error')}
            />
          </div>
        )}
      </div>
    </ModalShell>
  )
}

interface ApplicationLike {
  git_repository?: string
  git_branch?: string
  docker_registry_image_name?: string | null
  docker_registry_image_tag?: string | null
}
