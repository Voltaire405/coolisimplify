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
 * Which config field the Details tab may edit for a given application, and its
 * current value. Only one field is ever editable: the Docker image tag for
 * dockerimage apps, or the git branch for git-backed apps. The image *name*
 * and repository *path* stay read-only — changing them is effectively a
 * different resource.
 */
export type EditableConfig =
  | { kind: 'tag'; value: string }
  | { kind: 'branch'; value: string }

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
): EditableConfig | null {
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
): { docker_registry_image_tag: string } | { git_branch: string } {
  return config.kind === 'tag'
    ? { docker_registry_image_tag: config.value }
    : { git_branch: config.value }
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
