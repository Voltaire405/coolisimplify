"use client"

import { useEffect, useRef, useState } from "react"
import {
  Box,
  Workflow,
  Database,
  Server,
  GitBranch,
  Container,
  Tag,
  X,
  Check,
  Loader2,
  Pencil,
  Eye,
  EyeOff,
} from "lucide-react"
import { CopyButton } from "./copy-button"
import { StatusIndicator } from "./status-indicator"
import { EnvironmentVariableEditor } from "./environment-variable-editor"
import { isResourceActive, useClient } from "@/hooks/use-coolify"
import type {
  Resource,
  ResourceType,
  Database as DatabaseResource,
  Tag as TagType,
} from "@/lib/types"
import {
  classifyApplicationSource,
  dockerImageLabel,
  editableConfig,
  configEditPayload,
  type EditableConfig,
} from "@/lib/app-detail"
import { databaseConnectionUrls } from "@/lib/database-detail"
import {
  classifyResourceState,
  RESOURCE_STATE_LABEL,
} from "@/lib/resource-state"
import { cn } from "@workspace/ui/lib/utils"

export type DrawerTab = "details" | "vars"

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
  onNotify?: (message: string, type: "success" | "error") => void
  /** Persist an edited Docker image tag or git branch; resolves true on success. */
  onConfigEdit?: (
    uuid: string,
    payload: Record<string, unknown>
  ) => Promise<boolean>
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
      <div className={cn("min-w-0 flex-1", className)}>
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="mt-0.5 text-sm text-foreground">{children}</div>
      </div>
    </div>
  )
}

function Value({ children }: { children: React.ReactNode }) {
  return <span className="break-words whitespace-pre-wrap">{children}</span>
}

/**
 * A masked, copyable value (used for database connection URLs). Hidden by
 * default behind an eye toggle; the clipboard button always copies the real
 * value, whether or not it is revealed.
 */
function SecretValue({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 flex-1 truncate font-mono">
        {revealed ? value : "••••••••"}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        aria-label={revealed ? "Hide value" : "Reveal value"}
        title={revealed ? "Hide" : "Reveal"}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
      >
        {revealed ? (
          <EyeOff className="h-3.5 w-3.5" />
        ) : (
          <Eye className="h-3.5 w-3.5" />
        )}
      </button>
      <CopyButton value={value} label="Copy connection URL" />
    </span>
  )
}

/**
 * Click-to-edit value row for the tag/branch fields, mirroring InlineRename:
 * click to edit, Enter/blur commits, Esc cancels. Calls onSubmit with the new
 * value; a no-op (unchanged) commit sends nothing.
 */
function EditableValue({
  config,
  label,
  saving,
  onCommit,
}: {
  config: EditableConfig
  label: string
  saving?: boolean
  onCommit: (next: EditableConfig) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(config.value)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const start = () => {
    if (saving) return
    setValue(config.value)
    setEditing(true)
  }

  const cancel = () => {
    if (busy) return
    setEditing(false)
  }

  const commit = async () => {
    if (busy) return
    const next = value.trim()
    if (next === config.value) {
      setEditing(false)
      return
    }
    setBusy(true)
    try {
      const saved = await onCommit({ ...config, value: next })
      if (saved) setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        disabled={saving}
        title={`Click to edit ${label}`}
        className="group inline-flex max-w-full items-center gap-1 rounded-sm text-left hover:bg-muted disabled:cursor-default disabled:opacity-50"
      >
        <span className="truncate">{config.value || "—"}</span>
        <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </button>
    )
  }

  return (
    <span className="flex min-w-0 items-center gap-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            void commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            cancel()
          }
        }}
        onBlur={cancel}
        disabled={busy}
        spellCheck={false}
        aria-label={label}
        className="w-40 rounded-md border border-border bg-background px-2 py-0.5 text-sm text-foreground focus:ring-1 focus:ring-foreground/40 focus:outline-none disabled:opacity-50"
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void commit()}
        disabled={busy || !value.trim()}
        aria-label={`Confirm ${label}`}
        title="Confirm"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted disabled:opacity-40"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={cancel}
        disabled={busy}
        aria-label="Cancel edit"
        title="Cancel"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-destructive hover:bg-muted disabled:opacity-40"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  )
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
        "-mb-px border-b-2 px-3 py-1.5 text-xs font-medium",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
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
  onConfigEdit,
}: ResourceDrawerProps) {
  const { client } = useClient()
  const Icon = typeIcons[type]
  const name = (resource as { name?: string }).name || "Unnamed"
  const status = (resource as { status?: string }).status
  const state = classifyResourceState(status)
  const active = isResourceActive(status)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  // The API embeds the server a resource is actually deployed on at
  // destination.server (ADR-0001).
  const serverName = (
    resource as { destination?: { server?: { name?: string } } }
  ).destination?.server?.name

  // Application-specific fields (git / docker image). Coolify stores a
  // placeholder `git_repository`/`git_branch` on non-git apps (dockerimage,
  // dockerfile), so `build_pack` is the discriminator, not the git fields.
  const app = type === "application" ? (resource as ApplicationLike) : null
  const appSource = app ? classifyApplicationSource(app) : null
  const repo = app?.git_repository?.trim()
  const dockerImage = app?.docker_registry_image_name?.trim()
  const imageLabel = dockerImageLabel(app ?? {})
  const showGit = appSource === "git" && !!repo
  const showDockerImage = appSource === "docker-image" && !!dockerImage
  const editConfig = app ? editableConfig(app) : null
  const [savingConfig, setSavingConfig] = useState(false)

  // The list endpoint does not return an application's `settings`, so the
  // preview-deployments flag has to come from the detail endpoint. Fetch it
  // once per application (ADR-0008); services and databases never need it.
  const [previewDeploymentsEnabled, setPreviewDeploymentsEnabled] = useState<
    boolean | undefined
  >(undefined)
  useEffect(() => {
    let cancelled = false
    setPreviewDeploymentsEnabled(undefined)
    if (type !== "application" || !client) return
    client
      .getApplication(resource.uuid)
      .then((detail) => {
        if (!cancelled) {
          setPreviewDeploymentsEnabled(
            detail.settings?.is_preview_deployments_enabled
          )
        }
      })
      .catch(() => {
        // Best-effort: without the flag the Env Editor falls back to deriving
        // the Preview section state from the presence of preview variables.
      })
    return () => {
      cancelled = true
    }
  }, [client, type, resource.uuid])

  const commitConfig = async (next: EditableConfig) => {
    if (!onConfigEdit) return false
    setSavingConfig(true)
    try {
      return await onConfigEdit(resource.uuid, configEditPayload(next))
    } finally {
      setSavingConfig(false)
    }
  }

  const fqdn = (resource as { fqdn?: string | null }).fqdn?.trim()
  const portsExposes = (
    resource as { ports_exposes?: string }
  ).ports_exposes?.trim()
  const portsMappings = (
    resource as { ports_mappings?: string | null }
  ).ports_mappings?.trim()
  const networkAliases = (
    resource as { custom_network_aliases?: string | null }
  ).custom_network_aliases?.trim()
  // Coolify names the container after the resource UUID; the API does not
  // expose a separate container_name field.
  const containerName =
    (resource as { container_name?: string | null }).container_name?.trim() ||
    resource.uuid
  const tags = (resource as { tags?: TagType[] | null }).tags

  // Database connection URLs are masked by default (SecretValue) and only shown
  // when Coolify supplied them. The public one is omitted when not exposed.
  const dbUrls =
    type === "database"
      ? databaseConnectionUrls(resource as DatabaseResource)
      : null

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
            <span className="shrink-0 rounded border border-border px-1 py-0 text-[10px] tracking-wider text-muted-foreground uppercase">
              {type}
            </span>
          </div>
          {(projectName || environmentName) && (
            <p className="truncate text-xs text-muted-foreground">
              {[projectName, environmentName].filter(Boolean).join(" / ")}
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
        <TabButton
          active={tab === "details"}
          onClick={() => onTabChange("details")}
        >
          Details
        </TabButton>
        <TabButton active={tab === "vars"} onClick={() => onTabChange("vars")}>
          Variables
        </TabButton>
      </div>

      {tab === "details" ? (
        <div className="mt-4 space-y-3">
          <PropertyRow icon={Server} label="Server">
            <Value>{serverName ?? "—"}</Value>
          </PropertyRow>

          {type === "application" && showGit && (
            <PropertyRow icon={GitBranch} label="Repository">
              <div className="flex min-w-0 flex-col gap-1">
                <Value>{repo}</Value>
                {editConfig?.kind === "branch" && (
                  <EditableValue
                    config={editConfig}
                    label="Git branch"
                    saving={savingConfig}
                    onCommit={commitConfig}
                  />
                )}
              </div>
            </PropertyRow>
          )}

          {type === "application" && !showGit && showDockerImage && (
            <PropertyRow icon={Container} label="Docker image">
              <div className="flex min-w-0 flex-col gap-1">
                <Value>{imageLabel}</Value>
                {editConfig?.kind === "tag" && (
                  <EditableValue
                    config={editConfig}
                    label="Image tag"
                    saving={savingConfig}
                    onCommit={commitConfig}
                  />
                )}
              </div>
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

          {type === "database" && dbUrls?.label && dbUrls.internalUrl && (
            <PropertyRow
              icon={Database}
              label={`${dbUrls.label} URL (internal)`}
            >
              <SecretValue value={dbUrls.internalUrl} />
            </PropertyRow>
          )}
          {type === "database" && dbUrls?.label && dbUrls.publicUrl && (
            <PropertyRow icon={Database} label={`${dbUrls.label} URL (public)`}>
              <SecretValue value={dbUrls.publicUrl} />
            </PropertyRow>
          )}

          {type === "application" && fqdn && (
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
                    className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] tracking-wider text-muted-foreground uppercase"
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
              previewDeploymentsEnabled={previewDeploymentsEnabled}
              onChanged={(message) => onNotify?.(message, "success")}
              onError={(message) => onNotify?.(message, "error")}
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
