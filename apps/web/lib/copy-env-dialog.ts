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
import type {
  Environment,
  EnvironmentVariable,
  Project,
  ResourceType,
} from "./types"

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
 * A Resource plus where it lives. Two Resources of an instance can share a
 * name, so the destination list is only unambiguous when each entry carries
 * its Project / Environment (the Palette's sublabel).
 */
export interface DestinationOption extends ResourceWithType {
  projectName: string
  environmentName: string
}

/** `Project / Environment`, or "" when the Resource's environment is unknown. */
export function destinationLocationLabel(option: {
  projectName: string
  environmentName: string
}): string {
  return [option.projectName, option.environmentName]
    .filter(Boolean)
    .join(" / ")
}

/**
 * Pairs every Resource with the Project / Environment it belongs to, matching
 * `environment_id` against the environment tree client-side (ADR-0002). A
 * Resource whose environment is unknown keeps empty names rather than being
 * dropped: it is still a valid destination.
 */
export function withDestinationLocations(
  resources: ResourceWithType[],
  projects: Project[],
  environmentsByProject: Record<string, Environment[]>
): DestinationOption[] {
  const byEnvId = new Map<number, { project: Project; env: Environment }>()
  for (const project of projects) {
    for (const env of environmentsByProject[project.uuid] ?? []) {
      byEnvId.set(env.id, { project, env })
    }
  }
  return resources.map((r) => {
    const envId = (r.resource as { environment_id?: number }).environment_id
    const ctx = envId == null ? undefined : byEnvId.get(envId)
    return {
      ...r,
      projectName: ctx?.project.name ?? "",
      environmentName: ctx?.env.name ?? "",
    }
  })
}

/**
 * The destination Resources matching the dialog's search query, case-
 * insensitively over the same fields the Palette searches: name, type, domain
 * (fqdn), server name, plus the Project / Environment the Resource lives in,
 * which is what tells same-named Resources apart. An empty query keeps the
 * whole list.
 */
export function filterDestinationResources<T extends ResourceWithType>(
  resources: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return resources
  return resources.filter((r) => {
    const domain = (r.resource as { fqdn?: string | null }).fqdn ?? ""
    const server = (
      r.resource as { destination?: { server?: { name?: string } } }
    ).destination?.server?.name
    const location = destinationLocationLabel({
      projectName: (r as { projectName?: string }).projectName ?? "",
      environmentName:
        (r as { environmentName?: string }).environmentName ?? "",
    })
    return (
      (r.resource.name || "").toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q) ||
      domain.toLowerCase().includes(q) ||
      (server ?? "").toLowerCase().includes(q) ||
      location.toLowerCase().includes(q)
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

/**
 * The inline success message the source's Env Editor shows after a copy. The
 * destination is named with its location when known, so the message points at
 * one Resource and not at every Resource sharing that name.
 */
export function copySuccessMessage(
  key: string,
  destinationName: string,
  section: EnvCopySection,
  location = ""
): string {
  const where = location ? `${destinationName} · ${location}` : destinationName
  return `Copied ${key} to ${where} (${section})`
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
