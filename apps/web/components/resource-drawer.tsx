'use client'

import { useEffect } from 'react'
import {
  Box,
  Workflow,
  Database,
  Server,
  GitBranch,
  Container,
  Tag,
  X,
} from 'lucide-react'
import { CopyButton } from './copy-button'
import { StatusIndicator } from './status-indicator'
import { EnvironmentVariableEditor } from './environment-variable-editor'
import { isResourceActive, useClient } from '@/hooks/use-coolify'
import type { Resource, ResourceType, Tag as TagType } from '@/lib/types'
import { classifyApplicationSource, dockerImageLabel } from '@/lib/app-detail'
import { classifyResourceState, RESOURCE_STATE_LABEL } from '@/lib/resource-state'
import { cn } from '@workspace/ui/lib/utils'

export type DrawerTab = 'details' | 'vars'

const typeIcons = {
  application: Box,
  service: Workflow,
  database: Database,
} as const

interface ResourceDrawerProps {
  resource: Resource
  type: ResourceType
  projectName: string
  environmentName: string
  tab: DrawerTab
  onTabChange: (tab: DrawerTab) => void
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-1.5 text-xs font-medium',
        active
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

export function ResourceDrawer({
  resource,
  type,
  projectName,
  environmentName,
  tab,
  onTabChange,
  onClose,
  onNotify,
}: ResourceDrawerProps) {
  const { client } = useClient()
  const Icon = typeIcons[type]
  const name = (resource as { name?: string }).name || 'Unnamed'
  const status = (resource as { status?: string }).status
  const state = classifyResourceState(status)
  const active = isResourceActive(status)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // The API embeds the server a resource is actually deployed on at
  // destination.server (ADR-0001).
  const serverName = (resource as { destination?: { server?: { name?: string } } })
    .destination?.server?.name

  // Application-specific fields (git / docker image). Coolify stores a
  // placeholder `git_repository`/`git_branch` on non-git apps (dockerimage,
  // dockerfile), so `build_pack` is the discriminator, not the git fields.
  const app = type === 'application' ? (resource as ApplicationLike) : null
  const appSource = app ? classifyApplicationSource(app) : null
  const repo = app?.git_repository?.trim()
  const branch = app?.git_branch?.trim()
  const dockerImage = app?.docker_registry_image_name?.trim()
  const imageLabel = dockerImageLabel(app ?? {})
  const showGit = appSource === 'git' && !!repo
  const showDockerImage = appSource === 'docker-image' && !!dockerImage

  const fqdn = (resource as { fqdn?: string | null }).fqdn?.trim()
  const portsExposes = (resource as { ports_exposes?: string }).ports_exposes?.trim()
  const portsMappings = (resource as { ports_mappings?: string | null }).ports_mappings?.trim()
  const networkAliases = (resource as { custom_network_aliases?: string | null })
    .custom_network_aliases?.trim()
  // Coolify names the container after the resource UUID; the API does not
  // expose a separate container_name field.
  const containerName =
    (resource as { container_name?: string | null }).container_name?.trim() ||
    resource.uuid
  const tags = (resource as { tags?: TagType[] | null }).tags

  return (
    <div
      role="complementary"
      aria-label={`Details of ${name}`}
      className="flex min-h-full flex-col p-4"
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="min-w-0 truncate text-sm font-semibold">{name}</h2>
            <span className="shrink-0 rounded border border-border px-1 py-0 text-[10px] uppercase tracking-wider text-muted-foreground">
              {type}
            </span>
          </div>
          {(projectName || environmentName) && (
            <p className="truncate text-xs text-muted-foreground">
              {[projectName, environmentName].filter(Boolean).join(' / ')}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close drawer"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex gap-1 border-b border-border" role="tablist">
        <TabButton active={tab === 'details'} onClick={() => onTabChange('details')}>
          Details
        </TabButton>
        <TabButton active={tab === 'vars'} onClick={() => onTabChange('vars')}>
          Variables
        </TabButton>
      </div>

      {tab === 'details' ? (
        <div className="mt-4 space-y-3">
          <PropertyRow icon={Server} label="Server">
            <Value>{serverName ?? '—'}</Value>
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
              <Value>{imageLabel}</Value>
            </PropertyRow>
          )}

          {status && (
            <PropertyRow icon={Box} label="Status">
              <span className="inline-flex items-center gap-2">
                <StatusIndicator active={active} className="h-2 w-2" />
                <span className="capitalize">
                  {RESOURCE_STATE_LABEL[state].toLowerCase()}
                </span>
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
                {tags.map((t) => (
                  <span
                    key={t.uuid}
                    className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    {t.name}
                  </span>
                ))}
              </span>
            ) : (
              <Value>—</Value>
            )}
          </PropertyRow>
        </div>
      ) : (
        <div className="mt-4 min-h-0 flex-1">
          {client ? (
            <EnvironmentVariableEditor
              client={client}
              type={type}
              resourceUuid={resource.uuid}
              onChanged={(message) => onNotify?.(message, 'success')}
              onError={(message) => onNotify?.(message, 'error')}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Coolify is not configured.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

interface ApplicationLike {
  build_pack?: string
  git_repository?: string
  git_branch?: string
  docker_registry_image_name?: string | null
  docker_registry_image_tag?: string | null
}
