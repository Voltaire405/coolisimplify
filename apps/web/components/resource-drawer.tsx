"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
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
  Copy,
  Info,
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
import {
  databaseConnectionUrls,
  postgresUrlFormats,
  type PostgresUrlFormats,
} from "@/lib/database-detail"
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
  /** Persist an edited Docker image tag, git branch, or network alias; resolves true on success. */
  onConfigEdit?: (
    uuid: string,
    payload: Record<string, unknown>,
    /** False for edits that must not raise the Redeploy-needed marker (network aliases). */
    markRedeployNeeded?: boolean
  ) => Promise<boolean>
}

function PropertyRow({
  icon: Icon,
  label,
  labelHint,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  /** Optional element rendered beside the label, e.g. an info tooltip icon. */
  labelHint?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className={cn("min-w-0 flex-1", className)}>
        {labelHint ? (
          <div className="flex items-center gap-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            {labelHint}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{label}</p>
        )}
        <div className="mt-0.5 text-sm text-foreground">{children}</div>
      </div>
    </div>
  )
}

function Value({ children }: { children: React.ReactNode }) {
  return <span className="break-words whitespace-pre-wrap">{children}</span>
}

/**
 * A small info icon beside a row label that reveals an explanation on hover
 * or keyboard focus. The explanation is the button's accessible name (via
 * aria-label) and the popover is wired to it with aria-describedby.
 */
function LabelTooltip({ text }: { text: string }) {
  const tooltipId = useId()
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={text}
        aria-describedby={tooltipId}
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Info className="h-3 w-3" />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-30 mb-1.5 hidden w-56 rounded-md border border-border bg-popover px-2 py-1.5 text-[11px] leading-snug text-popover-foreground shadow-sm group-focus-within:block group-hover:block"
      >
        {text}
      </span>
    </span>
  )
}

/**
 * A masked, copyable value (used for database connection URLs). Hidden by
 * default behind an eye toggle; the clipboard button always copies the real
 * value, whether or not it is revealed. When `formats` is supplied (postgres
 * only) the copy button becomes a menu that offers each rendering; otherwise
 * it stays a plain single-format CopyButton.
 */
function SecretValue({
  value,
  formats,
}: {
  value: string
  formats?: PostgresUrlFormats | null
}) {
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
      {formats ? (
        <DatabaseCopyMenu formats={formats} />
      ) : (
        <CopyButton value={value} label="Copy connection URL" />
      )}
    </span>
  )
}

/** Splits Coolify's comma-separated alias string into trimmed non-empty items. */
function parseAliases(value: string): string[] {
  return value
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
}

/**
 * Chip editor for an application's Docker network aliases. Coolify stores the
 * aliases as one comma-separated string; here each alias is its own removable
 * chip and typing a comma (or Enter) turns the draft into a chip. Every add or
 * remove commits the joined list immediately through `onCommit` (which PATCHes
 * `custom_network_aliases`); the chips update optimistically and revert to the
 * last confirmed value if the save fails.
 */
function NetworkAliasEditor({
  value,
  saving,
  onCommit,
}: {
  value: string
  saving: boolean
  onCommit: (next: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState("")
  // Optimistic override applied while a save is in flight; null shows the
  // confirmed value from the API. A failed save drops the override. The editor
  // is keyed by resource uuid, so re-targeting the drawer remounts it fresh.
  const [pending, setPending] = useState<string[] | null>(null)
  const aliases = pending ?? parseAliases(value)

  async function commit(next: string[]) {
    setPending(next)
    const ok = await onCommit(next.join(", "))
    if (!ok) setPending(null)
  }

  function addAlias(alias: string) {
    const trimmed = alias.trim()
    if (!trimmed || saving) return
    setDraft("")
    if (aliases.includes(trimmed)) return
    void commit([...aliases, trimmed])
  }

  function removeAlias(alias: string) {
    if (saving) return
    const next = aliases.filter((a) => a !== alias)
    if (next.length === aliases.length) return
    void commit(next)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "," || e.key === "Enter") {
      e.preventDefault()
      addAlias(draft)
    }
  }

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {aliases.map((alias) => (
        <span
          key={alias}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs text-foreground"
        >
          {alias}
          <button
            type="button"
            onClick={() => removeAlias(alias)}
            disabled={saving}
            aria-label={`Remove ${alias}`}
            title={`Remove ${alias}`}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={saving}
        placeholder={aliases.length === 0 ? "Add alias…" : ""}
        aria-label="Network alias"
        spellCheck={false}
        className="min-w-32 flex-1 bg-transparent py-0.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
      />
    </span>
  )
}

/** Copy formats offered for a Postgres connection URL, in display order. */
const POSTGRES_COPY_FORMATS: ReadonlyArray<{
  label: string
  key: keyof PostgresUrlFormats
}> = [
  { label: "Original", key: "original" },
  { label: "JDBC", key: "jdbc" },
  { label: "URI", key: "uriLong" },
  { label: "Short URI", key: "uri" },
]

/**
 * Postgres-only copy menu: a trigger that opens a small menu listing every
 * connection-URL rendering (Original / JDBC / URI / Short URI). Selecting one
 * copies that format, closes the menu, and swaps the trigger to a brief
 * "Copied" check, mirroring CopyButton's feedback. Follows the repo's only
 * menu pattern (ContextMenu): a `relative` wrapper, an absolutely positioned
 * `right-0 top-full` panel, and click-outside-to-close. Derived formats that
 * could not be computed (non-postgres input) render disabled.
 *
 * Accessibility contract: this is a real ARIA menu widget (the trigger
 * advertises `aria-haspopup="menu"`), so the panel is `role="menu"`, each
 * choice is `role="menuitem"` with `aria-disabled` when it could not be
 * derived, the panel is focused on open, and ArrowUp/ArrowDown/Home/End move
 * focus with a roving tabindex. This delivers exactly the widget the trigger
 * promises (unlike ContextMenu, which keeps `aria-haspopup="menu"` without
 * `role="menu"`).
 */
function DatabaseCopyMenu({ formats }: { formats: PostgresUrlFormats }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [currentKey, setCurrentKey] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  // The roving focus only lands on choices that can actually be copied.
  const enabledKeys = useMemo<string[]>(
    () =>
      POSTGRES_COPY_FORMATS.map(({ key }) => key).filter(
        (key) => formats[key] != null
      ),
    [formats]
  )

  // Focus the panel (not the trigger) when the menu opens so keyboard users
  // land inside the widget and can arrow through it. The focus cursor is
  // reset in the trigger's onClick (an event handler) rather than here, so this
  // effect only touches the DOM.
  useEffect(() => {
    if (open) {
      panelRef.current?.focus()
    }
  }, [open])

  // Focus returns to the trigger whenever the menu closes, per the ARIA APG
  // menu button pattern. Track the previous open state so the initial mount
  // (open === false) does not steal focus into the trigger.
  const wasOpenRef = useRef(open)
  useEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = open
    if (wasOpen && !open) {
      triggerRef.current?.focus()
    }
  }, [open])

  // The choice that is currently the roving tab stop: the last one focused, or
  // the first enabled choice when the menu just opened.
  const activeKey = currentKey ?? enabledKeys[0] ?? null

  // Escape closes just the menu. The menu is nested inside the resource drawer,
  // which installs a window-level Escape listener that closes the whole drawer;
  // stopping propagation here keeps that from firing while the menu is open.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && open) {
      setOpen(false)
      e.stopPropagation()
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open])

  // Resolves true when the write succeeded. On failure the menu stays open so
  // the user can retry; a transient message surfaces the failure. CopyButton
  // surfaces its own transient failure the same way (no false "Copied" flash).
  async function handleCopy(value: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value)
      setCopyFailed(false)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      return true
    } catch {
      // Clipboard may be unavailable (e.g. non-secure context, denied
      // permission, sandboxed iframe); surface it so the user can retry.
      setCopyFailed(true)
      return false
    }
  }

  function focusItem(key: string) {
    setCurrentKey(key)
    const item = panelRef.current?.querySelector(
      `[data-key="${key}"]`
    ) as HTMLElement | null
    item?.focus()
  }

  // Roving focus for the menu: ArrowUp/ArrowDown move by one enabled choice
  // (wrapping), Home/End jump to the first/last. Handled on the panel, which
  // holds focus when the menu opens.
  function handleMenuKeyDown(e: React.KeyboardEvent) {
    if (enabledKeys.length === 0) return
    // The panel (role="menu") holds focus until the first arrow lands on a
    // choice. At that point currentKey is null, but activeKey already defaults
    // to the first enabled choice, so a naive cursor would make the first
    // ArrowDown skip it (and the first ArrowUp skip the last). Treat the
    // just-opened state as sitting "before" the first choice: ArrowDown/Home
    // reach the first enabled choice and ArrowUp/End reach the last one.
    if (currentKey == null) {
      if (e.key === "ArrowDown" || e.key === "Home") {
        e.preventDefault()
        focusItem(enabledKeys[0]!)
        return
      }
      if (e.key === "ArrowUp" || e.key === "End") {
        e.preventDefault()
        focusItem(enabledKeys[enabledKeys.length - 1]!)
        return
      }
    }
    const cursor = Math.max(enabledKeys.indexOf(activeKey ?? ""), 0)
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        focusItem(enabledKeys[(cursor + 1) % enabledKeys.length]!)
        break
      case "ArrowUp":
        e.preventDefault()
        focusItem(
          enabledKeys[(cursor - 1 + enabledKeys.length) % enabledKeys.length]!
        )
        break
      case "Home":
        e.preventDefault()
        focusItem(enabledKeys[0]!)
        break
      case "End":
        e.preventDefault()
        focusItem(enabledKeys[enabledKeys.length - 1]!)
        break
    }
  }

  return (
    <div ref={ref} className="relative" onKeyDown={handleKeyDown}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => {
          if (!open) {
            setCurrentKey(null)
            setCopyFailed(false)
          }
          setOpen((o) => !o)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={copied ? "Copied" : "Copy connection URL"}
        title={copied ? "Copied" : "Copy connection URL"}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-foreground" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="menu"
          aria-label="Copy connection URL formats"
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
          className="absolute top-full right-0 z-30 mt-1 w-44 rounded-md border border-border bg-popover shadow-sm"
        >
          <div className="py-1">
            {POSTGRES_COPY_FORMATS.map(({ label, key }) => {
              const value = formats[key]
              return (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  data-key={key}
                  tabIndex={activeKey === key ? 0 : -1}
                  aria-disabled={value == null}
                  onFocus={() => setCurrentKey(key)}
                  onClick={() => {
                    if (value == null) return
                    setCopyFailed(false)
                    void handleCopy(value).then((ok) => {
                      // Keep the menu open on failure so the user can retry
                      // (or Escape/click-outside to dismiss).
                      if (ok) setOpen(false)
                    })
                  }}
                  className={cn(
                    "block w-full px-3 py-2 text-left text-sm transition-colors",
                    value == null
                      ? "pointer-events-none opacity-40"
                      : "text-popover-foreground hover:bg-muted"
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
          {copyFailed && (
            <div
              role="status"
              aria-live="polite"
              className="border-t border-border px-3 py-2 text-xs text-destructive"
            >
              Copy failed. Please try again.
            </div>
          )}
        </div>
      )}
    </div>
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
      // The Redeploy-needed marker means "container started with a different
      // tag/branch" (CONTEXT.md), so only those edits raise it; a network-alias
      // change is applied by any restart and must not mark the row.
      return await onConfigEdit(
        resource.uuid,
        configEditPayload(next),
        next.kind !== "network-alias"
      )
    } finally {
      setSavingConfig(false)
    }
  }

  // Persists the chip editor's joined alias list through the shared config
  // save path (PATCH custom_network_aliases, no Redeploy-needed marker).
  const commitNetworkAlias = async (next: string) => {
    return commitConfig({ kind: "network-alias", value: next })
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
  // Postgres rows offer multiple copy formats (Original/JDBC/URI/Short URI);
  // every other engine keeps the plain single-format copy button.
  const dbUrls =
    type === "database"
      ? databaseConnectionUrls(resource as DatabaseResource)
      : null
  const dbIsPostgres = dbUrls?.type === "postgresql"

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
              <SecretValue
                value={dbUrls.internalUrl}
                formats={
                  dbIsPostgres ? postgresUrlFormats(dbUrls.internalUrl) : null
                }
              />
            </PropertyRow>
          )}
          {type === "database" && dbUrls?.label && dbUrls.publicUrl && (
            <PropertyRow icon={Database} label={`${dbUrls.label} URL (public)`}>
              <SecretValue
                value={dbUrls.publicUrl}
                formats={
                  dbIsPostgres ? postgresUrlFormats(dbUrls.publicUrl) : null
                }
              />
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

          {type === "application" ? (
            <PropertyRow
              icon={Box}
              label="Network aliases"
              labelHint={
                <LabelTooltip text="Type an alias and press comma (,) or Enter to add it as a chip. Click the X to remove a chip. Changes save automatically." />
              }
            >
              <NetworkAliasEditor
                key={resource.uuid}
                value={networkAliases ?? ""}
                saving={savingConfig}
                onCommit={commitNetworkAlias}
              />
            </PropertyRow>
          ) : networkAliases ? (
            <PropertyRow icon={Box} label="Network aliases">
              <Value>{networkAliases}</Value>
            </PropertyRow>
          ) : null}

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
