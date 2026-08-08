import type { EnvironmentVariable, EnvVarCreate, ResourceType } from "./types"
import {
  envUpdateIncludesPreview,
  envValue,
  isValueReadable,
  partitionEnvsByPreview,
  sameEnvKey,
} from "./envs.ts"

/** The two destination sections a copy can land in (ADR-0008). */
export type EnvCopySection = "Production" | "Preview"

/** Identifies a Resource (type + uuid) as a copy source or destination. */
export interface EnvCopyResource {
  type: ResourceType
  uuid: string
}

export interface EnvCopySource {
  resource: EnvCopyResource
  env: EnvironmentVariable
}

export interface EnvCopyInput {
  source: EnvCopySource
  destination: EnvCopyResource
  /**
   * Section the copy lands in. Dictates `is_preview` of the payload — the
   * source's own section is never carried over.
   */
  destinationSection: EnvCopySection
  /** Chosen destination key; may rename the variable at the destination. */
  destinationKey: string
  /**
   * The destination's env vars across both sections. The module matches
   * within the chosen section only — the same key may exist once per section
   * (ADR-0008), so a Production row must not trigger a replace in Preview.
   */
  destinationEnvs: EnvironmentVariable[]
}

export interface EnvCopyPlan {
  action: "create" | "replace"
  /** The POST (create) or PATCH (replace) payload, per the env-var schemas. */
  payload: EnvVarCreate
  /** The destination env var being overwritten, on replace. */
  target?: EnvironmentVariable
}

/**
 * The pure decision and payload-building core of copying an Environment
 * Variable from one Resource to another (issue #7). Decides create-vs-replace
 * by exact, case-insensitive, trimmed key match within the chosen destination
 * section — the same semantics as the Env Editor's duplicate validation —
 * validates the destination key, gates on unreadable source values, refuses
 * self-copy, and builds the faithful copy payload.
 *
 * Refusals throw; the message is what the UI surfaces inline.
 */
export function buildEnvCopy(input: EnvCopyInput): EnvCopyPlan {
  const {
    source,
    destination,
    destinationSection,
    destinationKey,
    destinationEnvs,
  } = input
  const key = destinationKey.trim()

  // A shown-once secret whose real value was never returned cannot be copied:
  // the only value we could send would be empty, silently losing the secret.
  // An empty-but-readable value is allowed — deliberately empty variables copy.
  if (!isValueReadable(source.env)) {
    throw new Error("The value is not available to copy")
  }
  if (!key) {
    throw new Error("Key is required")
  }

  // Self-copy: same Resource, same key, same section is a no-op replace. The
  // dialog excludes the source Resource from the picker; the module refuses
  // anyway so the invariant holds even for a direct caller.
  const sourceSection: EnvCopySection = source.env.is_preview
    ? "Preview"
    : "Production"
  const sameResource =
    destination.type === source.resource.type &&
    destination.uuid === source.resource.uuid
  const sameKey = sameEnvKey(key, source.env.key)
  if (sameResource && sameKey && destinationSection === sourceSection) {
    throw new Error("Cannot copy a variable onto itself")
  }

  const isPreview = destinationSection === "Preview"
  const { production, preview } = partitionEnvsByPreview(destinationEnvs)
  const sectionEnvs = isPreview ? preview : production
  const matches = sectionEnvs.filter((e) => sameEnvKey(e.key, key))
  // The Env Editor never lets a section hold two case-insensitive matches of
  // the same key; if the destination already does, replacing one would leave
  // the section in a state the editor refuses, and PATCH-by-key would pick an
  // arbitrary row. Refuse instead of silently fixing only one.
  if (matches.length > 1) {
    throw new Error(
      `Key «${key}» already exists more than once in ${destinationSection}`
    )
  }
  const target = matches[0]

  // Faithful copy: the source's value and flags, with `is_preview` dictated by
  // the chosen section. Flags are sent explicitly, even when false, so a
  // replace overwrites the destination's flags with the source's. Databases
  // never send `is_preview` — their env schemas do not accept it.
  const payload: EnvVarCreate = {
    key,
    value: envValue(source.env),
    is_literal: source.env.is_literal ?? false,
    is_multiline: source.env.is_multiline ?? false,
    is_shown_once: source.env.is_shown_once ?? false,
    ...(envUpdateIncludesPreview(destination.type)
      ? { is_preview: isPreview }
      : {}),
  }

  return target
    ? { action: "replace", payload, target }
    : { action: "create", payload }
}
