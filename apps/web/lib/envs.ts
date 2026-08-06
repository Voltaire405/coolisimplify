import type { EnvironmentVariable, ResourceType } from './types'

/**
 * The env-var endpoints are identical across applications, services, and
 * databases (`/{plural}/{uuid}/envs`). Centralising the URL mapping here keeps
 * the client and the editor from each re-deriving it.
 */
const ENV_PLURAL: Record<ResourceType, string> = {
  application: 'applications',
  service: 'services',
  database: 'databases',
}

/** `/{plural}/{resourceUuid}/envs` — list/create/update (PATCH) base path. */
export function envBasePath(type: ResourceType, resourceUuid: string): string {
  return `/${ENV_PLURAL[type]}/${resourceUuid}/envs`
}

/**
 * `/{plural}/{resourceUuid}/envs/{envUuid}` — single-env item path. Coolify
 * only exposes DELETE here; updates go to `envBasePath` keyed by `key` (see
 * ADR-0003). A key rename is therefore delete-then-create.
 */
export function envItemPath(
  type: ResourceType,
  resourceUuid: string,
  envUuid: string,
): string {
  return `${envBasePath(type, resourceUuid)}/${envUuid}`
}

/**
 * The editable value of an env var. The API returns the decrypted value in
 * `real_value` when readable, and the raw `value` otherwise. For `is_shown_once`
 * secrets the value is not readable back at all (`real_value` is null) — see
 * ADR-0003 and clone.ts.
 */
export function envValue(env: Pick<EnvironmentVariable, 'real_value' | 'value'>): string {
  return env.real_value ?? env.value ?? ''
}

/**
 * Whether an env var's value is readable back through the API. `is_shown_once`
 * secrets are stored once and never exposed again; their `real_value` is null,
 * so editing them means replacing the value entirely.
 */
export function isValueReadable(
  env: Pick<EnvironmentVariable, 'is_shown_once' | 'real_value'>,
): boolean {
  return !(env.is_shown_once && env.real_value == null)
}

/** Database env endpoints do not accept `is_preview`. */
export function envSupportsPreview(type: ResourceType): boolean {
  return type !== 'database'
}

/**
 * Case-insensitive substring match on the key only. Used by the Env Editor's
 * search box to narrow the list down to the variables worth editing; values are
 * intentionally ignored — they may be masked or hold secrets.
 */
export function filterEnvsByKey(
  envs: EnvironmentVariable[],
  query: string,
): EnvironmentVariable[] {
  const q = query.trim().toLowerCase()
  if (!q) return envs
  return envs.filter((e) => e.key.toLowerCase().includes(q))
}
