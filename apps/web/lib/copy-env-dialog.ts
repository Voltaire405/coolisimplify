import type { CoolifyClient } from "./coolify-client"
import {
  buildEnvCopy,
  type EnvCopyInput,
  type EnvCopyPlan,
  type EnvCopyResource,
  type EnvCopySection,
} from "./copy-env"
import {
  envSupportsPreview,
  partitionEnvsByPreview,
  sortEnvsByKey,
} from "./envs"
import type { ResourceWithType } from "./tree"
import type { EnvironmentVariable, ResourceType } from "./types"

/**
 * The section the destination dialog lands on: applications default to the
 * source's own section, services and databases are always Production (only
 * applications can hold preview variables — ADR-0008), so their radio is
 * never rendered.
 */
export function defaultDestinationSection(
  type: ResourceType,
  sourceIsPreview: boolean | undefined
): EnvCopySection {
  if (!envSupportsPreview(type)) return "Production"
  return sourceIsPreview ? "Preview" : "Production"
}

/**
 * The existing keys of the chosen destination section, sorted A-Z — offered by
 * the dialog's key combo. Picking one means replace; typing a new key creates.
 */
export function destinationKeyOptions(
  envs: EnvironmentVariable[],
  section: EnvCopySection
): string[] {
  const { production, preview } = partitionEnvsByPreview(envs)
  return sortEnvsByKey(section === "Preview" ? preview : production).map(
    (e) => e.key
  )
}

/**
 * The destination Resources matching the dialog's search query, case-
 * insensitively over the same fields the Palette searches: name, type, domain
 * (fqdn) and server name (CONTEXT.md). An empty query keeps the whole list.
 */
export function filterDestinationResources(
  resources: ResourceWithType[],
  query: string
): ResourceWithType[] {
  const q = query.trim().toLowerCase()
  if (!q) return resources
  return resources.filter((r) => {
    const domain = (r.resource as { fqdn?: string | null }).fqdn ?? ""
    const server = (
      r.resource as { destination?: { server?: { name?: string } } }
    ).destination?.server?.name
    return (
      (r.resource.name || "").toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q) ||
      domain.toLowerCase().includes(q) ||
      (server ?? "").toLowerCase().includes(q)
    )
  })
}

/** The dialog's copy verdict: the plan itself, or the refusal as an error. */
export type CopyDialogVerdict = { plan: EnvCopyPlan } | { error: string }

/** Runs the #7 decision module; refusals become errors the dialog can show. */
export function computeCopyPlan(input: EnvCopyInput): CopyDialogVerdict {
  try {
    return { plan: buildEnvCopy(input) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Copy failed" }
  }
}

/** The inline success message the source's Env Editor shows after a copy. */
export function copySuccessMessage(
  key: string,
  destinationName: string,
  section: EnvCopySection
): string {
  return `Copied ${key} to ${destinationName} (${section})`
}

/**
 * Executes a confirmed copy through the existing client: POST to create a new
 * variable, PATCH (routed by key) to replace an existing one — see ADR-0003.
 */
export async function executeEnvCopy(
  client: CoolifyClient,
  destination: EnvCopyResource,
  plan: EnvCopyPlan
): Promise<void> {
  if (plan.action === "create") {
    await client.createEnvFor(destination.type, destination.uuid, plan.payload)
  } else {
    await client.updateEnv(destination.type, destination.uuid, plan.payload)
  }
}
