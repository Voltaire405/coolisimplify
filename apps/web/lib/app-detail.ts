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
