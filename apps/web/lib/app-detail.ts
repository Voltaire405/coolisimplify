// How the drawer classifies an application's build source for the Details tab.
// The classification must mirror the real Coolify API contract: the non-git
// creation endpoints (dockerimage, dockerfile-without-git) store a placeholder
// `git_repository` of `coollabsio/coolify` and `git_branch` of `main`, so git
// field presence is not a reliable signal on its own. Real git-backed apps
// carry a `source_id` or `private_key_id`; `build_pack` separates docker-image
// apps from everything else.

export type ApplicationSource = 'git' | 'docker-image' | 'dockerfile' | 'other'

export function classifyApplicationSource(
  app: {
    build_pack?: string
    git_repository?: string | null
    source_id?: string | number | null
    private_key_id?: string | number | null
  },
): ApplicationSource {
  if (app.build_pack === 'dockerimage') return 'docker-image'
  const hasGitSource =
    app.source_id != null || app.private_key_id != null
  if (app.build_pack === 'dockerfile') {
    return hasGitSource ? 'git' : 'dockerfile'
  }
  if (app.git_repository) return 'git'
  return 'other'
}

/** `name:tag`, or just the name when there is no tag. */
export function dockerImageLabel(
  app: {
    docker_registry_image_name?: string | null
    docker_registry_image_tag?: string | null
  },
): string | null {
  const name = app.docker_registry_image_name?.trim()
  const tag = app.docker_registry_image_tag?.trim()
  if (!name) return null
  return tag ? `${name}:${tag}` : name
}

/**
 * The branch (git) or image tag (docker-image) shown on the resource card.
 * Only applications carry either concept, so this returns null for anything
 * else. The value is derived with `classifyApplicationSource`, never from the
 * git fields alone: Coolify stores a placeholder `git_repository`/`git_branch`
 * on non-git apps, which would otherwise leak a fake "main" onto docker-image
 * and dockerfile rows.
 */
export function versionLabel(
  app: {
    build_pack?: string
    git_repository?: string | null
    git_branch?: string | null
    source_id?: string | number | null
    private_key_id?: string | number | null
    docker_registry_image_name?: string | null
    docker_registry_image_tag?: string | null
  },
): string | null {
  const source = classifyApplicationSource(app)
  if (source === 'docker-image') {
    return app.docker_registry_image_tag?.trim() || null
  }
  if (source === 'git') {
    return app.git_branch?.trim() || null
  }
  return null
}

/**
 * The tag/branch config fields, derived by `editableConfig` from the build
 * source. The image *name* and repository *path* stay read-only — changing
 * them is effectively a different resource.
 */
export type SourceConfig =
  | { kind: 'tag'; value: string }
  | { kind: 'branch'; value: string }

/**
 * Any config field the Details tab may edit, and its current value. The
 * tag/branch fields come from `editableConfig`; the network-alias field is
 * drawer-constructed (it applies to every application regardless of build
 * pack, so no single discriminator produces it).
 */
export type EditableConfig =
  | SourceConfig
  | { kind: 'network-alias'; value: string }

export function editableConfig(
  app: {
    build_pack?: string
    git_repository?: string | null
    git_branch?: string | null
    source_id?: string | number | null
    private_key_id?: string | number | null
    docker_registry_image_name?: string | null
    docker_registry_image_tag?: string | null
  },
): SourceConfig | null {
  const source = classifyApplicationSource(app)
  if (source === 'docker-image') {
    return { kind: 'tag', value: app.docker_registry_image_tag?.trim() ?? '' }
  }
  if (source === 'git') {
    return { kind: 'branch', value: app.git_branch?.trim() ?? '' }
  }
  return null
}

/** PATCH body for an edited config field. */
export function configEditPayload(
  config: EditableConfig,
):
  | { docker_registry_image_tag: string }
  | { git_branch: string }
  | { custom_network_aliases: string } {
  if (config.kind === 'tag') return { docker_registry_image_tag: config.value }
  if (config.kind === 'branch') return { git_branch: config.value }
  return { custom_network_aliases: config.value }
}

/**
 * Whether a converging action clears the Redeploy-needed marker.
 *
 * Asymmetric per build pack: Coolify forces `restart_only` off for dockerimage
 * apps (ApplicationDeploymentJob), so a Restart re-resolves the updated tag
 * and recreates the container — it applies the change. For git apps a
 * restart-only keeps the existing image at the current commit and does NOT
 * checkout the new branch, so only a Redeploy clears. A Redeploy always
 * clears.
 */
export function redeployClearedBy(
  buildPack: string | undefined,
  action: 'restart' | 'deploy',
): boolean {
  if (action === 'deploy') return true
  return buildPack === 'dockerimage'
}

// --- Batch "Edit config" composition ----------------------------------------

export type BatchConfigTarget =
  | { kind: 'branch'; label: 'Git branch' }
  | { kind: 'tag'; label: 'Image tag' }

export interface BatchConfigApp {
  uuid: string
  name: string
  /** The field this app edits (tag for dockerimage, branch for git). */
  target: 'tag' | 'branch'
  /** Current configured value. */
  current: string
  /** New value assigned by the shared field; per-row override may differ. */
  assigned: string
  /** Whether the row was overridden by hand (vs. following the shared value). */
  overridden: boolean
  canDeploy: boolean
}

/**
 * Determine the batch edit target from a list of Applications. Every app must
 * be the same kind (all git or all dockerimage) for a shared field to make
 * sense; a mixed or unsupported selection is not editable.
 */
export function batchConfigTarget(
  apps: Array<{
    build_pack?: string
    git_repository?: string | null
    git_branch?: string | null
    source_id?: string | number | null
    private_key_id?: string | number | null
    docker_registry_image_name?: string | null
    docker_registry_image_tag?: string | null
  }>,
): BatchConfigTarget | null {
  const kinds = new Set<string>()
  for (const app of apps) {
    const source = classifyApplicationSource(app)
    if (source === 'docker-image') kinds.add('tag')
    else if (source === 'git') kinds.add('branch')
    else return null
  }
  if (kinds.size !== 1) return null
  return kinds.has('tag')
    ? { kind: 'tag', label: 'Image tag' }
    : { kind: 'branch', label: 'Git branch' }
}

/** Suggested shared value: the common current value, or '' when they differ. */
export function sharedConfigValue(apps: BatchConfigApp[]): string {
  const first = apps[0]?.current ?? ''
  return apps.every((a) => a.current === first) ? first : ''
}
