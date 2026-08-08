"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, Copy, Eye, EyeOff, Loader2, Search } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { ModalShell } from "./confirm-dialog"
import { EnvBadges } from "./env-badges"
import {
  useAllEnvironments,
  useApplications,
  useClient,
  useDatabases,
  useProjects,
  useServices,
} from "@/hooks/use-coolify"
import { envValue, isValueReadable } from "@/lib/envs"
import {
  computeCopyPlan,
  copySuccessMessage,
  defaultDestinationSection,
  destinationLocationLabel,
  destinationKeyOptions,
  executeEnvCopy,
  filterDestinationResources,
  withDestinationLocations,
  type DestinationOption,
} from "@/lib/copy-env-dialog"
import type {
  EnvCopyResource,
  EnvCopySection,
  EnvCopySource,
} from "@/lib/copy-env"
import { compareResources, type ResourceWithType } from "@/lib/tree"
import type { EnvironmentVariable } from "@/lib/types"

interface CopyEnvDialogProps {
  /** The row's Resource + variable being copied (the #7 module's source). */
  source: EnvCopySource
  onCancel: () => void
  /** Fired with the inline success message once the copy is confirmed. */
  onCopied: (message: string) => void
}

/**
 * A selectable destination: the #7 module's Resource plus how the dialog names
 * it — its display name and the Project / Environment it lives in, without
 * which two same-named Resources are indistinguishable.
 */
interface Destination extends EnvCopyResource {
  name: string
  location: string
}

/**
 * The "Copy to…" dialog (issue #8): pick a destination Resource from a
 * searchable flat list (every Resource of the instance except the source),
 * choose the destination section (Applications only, default = the source's
 * own section; Services and Databases are always Production), and pick or type
 * the destination key — an existing key replaces, a new key creates. The
 * create/replace verdict comes from the #7 decision module; on confirm the
 * copy goes through the existing client (POST or PATCH-by-key, ADR-0003) and
 * the source's Env Editor shows an inline success message.
 */
export function CopyEnvDialog({
  source,
  onCancel,
  onCopied,
}: CopyEnvDialogProps) {
  const { client } = useClient()
  const { data: applications } = useApplications()
  const { data: services } = useServices()
  const { data: databases } = useDatabases()
  const { data: projects } = useProjects()
  const { byProject: environmentsByProject } = useAllEnvironments(projects)

  const [search, setSearch] = useState("")
  const [destination, setDestination] = useState<Destination | null>(null)
  const [section, setSection] = useState<EnvCopySection>(() =>
    defaultDestinationSection(source.resource.type, source.env.is_preview)
  )
  const [key, setKey] = useState(source.env.key)
  // Null while no destination is chosen or its variables are still loading.
  const [destEnvs, setDestEnvs] = useState<EnvironmentVariable[] | null>(null)
  const [destEnvsError, setDestEnvsError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Flat list of every Resource of the instance, the source excluded, in the
  // app's fixed order (applications, services, databases, each alphabetical).
  const resources = useMemo<DestinationOption[]>(() => {
    const all: ResourceWithType[] = [
      ...applications.map((r) => ({
        type: "application" as const,
        resource: r,
      })),
      ...services.map((r) => ({ type: "service" as const, resource: r })),
      ...databases.map((r) => ({ type: "database" as const, resource: r })),
    ]
    return withDestinationLocations(
      all.filter(
        (r) =>
          !(
            r.type === source.resource.type &&
            r.resource.uuid === source.resource.uuid
          )
      ),
      projects,
      environmentsByProject
    ).sort(compareResources)
  }, [
    applications,
    services,
    databases,
    projects,
    environmentsByProject,
    source,
  ])

  const filtered = useMemo(
    () => filterDestinationResources(resources, search),
    [resources, search]
  )

  const selectDestination = (r: DestinationOption) => {
    setDestination({
      type: r.type,
      uuid: r.resource.uuid,
      name: r.resource.name || "Unnamed",
      location: destinationLocationLabel(r),
    })
    setSection(defaultDestinationSection(r.type, source.env.is_preview))
    setKey(source.env.key)
    setError(null)
  }

  // Load the chosen destination's variables (both sections; the module
  // partitions internally) so the combo can offer its existing keys and the
  // verdict can tell create from replace.
  useEffect(() => {
    if (!client || !destination) {
      setDestEnvs(null)
      setDestEnvsError(null)
      return
    }
    let cancelled = false
    setDestEnvs(null)
    setDestEnvsError(null)
    client
      .listEnvsFor(destination.type, destination.uuid)
      .then((envs) => {
        if (!cancelled) setDestEnvs(envs)
      })
      .catch((err) => {
        if (!cancelled) {
          setDestEnvsError(
            err instanceof Error ? err.message : "Failed to load variables"
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [client, destination])

  const unreadable = !isValueReadable(source.env)
  const options = useMemo(
    () => (destination ? destinationKeyOptions(destEnvs ?? [], section) : []),
    [destEnvs, destination, section]
  )
  const verdict = useMemo(() => {
    if (!destination || destEnvs === null || destEnvsError) return null
    return computeCopyPlan({
      source,
      destination: { type: destination.type, uuid: destination.uuid },
      destinationSection: section,
      destinationKey: key,
      destinationEnvs: destEnvs,
    })
  }, [destination, destEnvs, destEnvsError, key, section, source])

  const canCopy =
    !unreadable &&
    !!destination &&
    destEnvs !== null &&
    !destEnvsError &&
    !submitting &&
    !!verdict &&
    "plan" in verdict

  const handleCopy = async () => {
    if (
      !client ||
      !destination ||
      !verdict ||
      !("plan" in verdict) ||
      submitting
    )
      return
    setSubmitting(true)
    setError(null)
    try {
      await executeEnvCopy(client, destination, verdict.plan)
      onCopied(
        copySuccessMessage(
          key.trim(),
          destination.name,
          section,
          destination.location
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell
      onCancel={onCancel}
      labelledBy="copy-env-dialog-title"
      panelClassName="max-w-lg"
    >
      <h2
        id="copy-env-dialog-title"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <Copy className="h-4 w-4 text-muted-foreground" />
        Copy &laquo;{source.env.key}&raquo; to&hellip;
      </h2>

      {/* Source variable, read-only. */}
      <div className="mt-3 rounded-md border border-border bg-muted/30 px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 font-mono text-sm break-words whitespace-pre-wrap text-foreground">
            {source.env.key}
          </span>
          <EnvBadges env={source.env} />
        </div>
        {unreadable ? (
          <p className="mt-0.5 text-xs text-muted-foreground italic">
            value not readable
          </p>
        ) : (
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground">
              {revealed ? envValue(source.env) : "••••••••••"}
            </span>
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              aria-label={
                revealed ? "Hide the source value" : "Show the source value"
              }
              title={
                revealed ? "Hide the source value" : "Show the source value"
              }
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
            >
              {revealed ? (
                <EyeOff className="h-3 w-3" />
              ) : (
                <Eye className="h-3 w-3" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* Searchable flat destination list, source excluded. */}
      <div className="mt-3">
        <p className="text-xs font-medium text-muted-foreground">Destination</p>
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search resources, projects, environments…"
            aria-label="Search destination resources"
            className="w-full rounded-md border border-border bg-background py-1 pr-2 pl-7 text-sm text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-foreground/40 focus:outline-none"
          />
        </div>
        <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
          {filtered.length === 0 && (
            <li className="text-xs text-muted-foreground">
              {resources.length === 0
                ? "No other resources"
                : "No resources match your search."}
            </li>
          )}
          {filtered.map((r) => {
            const name = r.resource.name || "Unnamed"
            const location = destinationLocationLabel(r)
            const selected =
              destination?.type === r.type &&
              destination.uuid === r.resource.uuid
            return (
              <li key={`${r.type}:${r.resource.uuid}`}>
                <button
                  type="button"
                  onClick={() => selectDestination(r)}
                  aria-pressed={selected}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-sm",
                    selected
                      ? "border-foreground/40 bg-muted"
                      : "border-border hover:bg-muted/50"
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-foreground">{name}</span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {location || "Unknown location"}
                    </span>
                  </span>
                  <span className="shrink-0 rounded border border-border px-1 py-0 text-[9px] tracking-wider text-muted-foreground uppercase">
                    {r.type}
                  </span>
                  {selected && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Section radio: applications only; services and databases are always
          Production (ADR-0008). Default = the source's own section. */}
      {destination?.type === "application" && (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground">Section</p>
          <div className="mt-1 flex gap-4">
            {(["Production", "Preview"] as const).map((s) => (
              <label
                key={s}
                className="flex items-center gap-1.5 text-xs text-foreground"
              >
                <input
                  type="radio"
                  name="copy-dest-section"
                  checked={section === s}
                  onChange={() => {
                    setSection(s)
                    setError(null)
                  }}
                  disabled={submitting}
                  className="h-3.5 w-3.5"
                />
                {s}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Editable key combo: pick an existing key (replace) or type a new one. */}
      <label className="mt-3 block">
        <span className="text-xs font-medium text-muted-foreground">
          Destination key
        </span>
        <input
          type="text"
          value={key}
          onChange={(e) => {
            setKey(e.target.value)
            setError(null)
          }}
          list="copy-dest-keys"
          spellCheck={false}
          disabled={!destination || submitting}
          aria-label="Destination key"
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground focus:ring-1 focus:ring-foreground/40 focus:outline-none disabled:opacity-50"
        />
        <datalist id="copy-dest-keys">
          {options.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </label>

      {/* Inline verdict or the reason Copy is unavailable. */}
      {unreadable ? (
        <p className="mt-2 text-xs text-destructive">
          The value is not available to copy
        </p>
      ) : destEnvsError ? (
        <p className="mt-2 text-xs text-destructive">
          Could not load destination variables: {destEnvsError}
        </p>
      ) : verdict && "error" in verdict ? (
        <p className="mt-2 text-xs text-destructive">{verdict.error}</p>
      ) : verdict && "plan" in verdict && destination ? (
        <p
          className={cn(
            "mt-2 text-xs",
            verdict.plan.action === "create"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-amber-600 dark:text-amber-400"
          )}
        >
          {verdict.plan.action === "create" ? "Will create" : "Will replace"}{" "}
          <span className="font-mono font-semibold">{key.trim()}</span> on{" "}
          {destination.name}
          {destination.location ? ` · ${destination.location}` : ""}
        </p>
      ) : null}

      {error && (
        <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={() => void handleCopy()}
          disabled={!canCopy}
          className="flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {submitting ? "Copying…" : "Copy"}
        </button>
      </div>
    </ModalShell>
  )
}
