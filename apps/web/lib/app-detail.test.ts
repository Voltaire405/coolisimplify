// Verifies how the drawer classifies an application's build source for the
// Details tab: a Docker-image app must show the image (and tag), not the
// placeholder git repository Coolify stores on non-git apps.
//
// Background: Coolify's create-dockerimage and create-dockerfile controllers
// hardcode `git_repository = 'coollabsio/coolify'` and `git_branch = 'main'`
// on every non-git app, so `git_repository` presence is NOT a reliable signal
// that an application is git-based. Real signal: `build_pack`.
import { describe, expect, it } from 'vitest'
import {
  batchConfigTarget,
  classifyApplicationSource,
  configEditPayload,
  dockerImageLabel,
  editableConfig,
  redeployClearedBy,
  sharedConfigValue,
  versionLabel,
  type BatchConfigApp,
} from './app-detail'

// Real Coolify stores the placeholder repo on dockerimage apps.
const dockerImageApp = {
  build_pack: 'dockerimage',
  git_repository: 'coollabsio/coolify',
  git_branch: 'main',
  docker_registry_image_name: 'ghcr.io/coollabsio/coolify',
  docker_registry_image_tag: 'latest',
}

const gitApp = {
  build_pack: 'nixpacks',
  git_repository: 'org/repo',
  git_branch: 'main',
  docker_registry_image_name: null,
  docker_registry_image_tag: null,
}

const dockerfileApp = {
  build_pack: 'dockerfile',
  git_repository: 'coollabsio/coolify',
  git_branch: 'main',
}

describe('classifyApplicationSource', () => {
  it('classifies a docker-image app by build_pack, ignoring the placeholder repo', () => {
    expect(classifyApplicationSource(dockerImageApp)).toBe('docker-image')
  })

  it('still classifies a real git app as git', () => {
    expect(classifyApplicationSource(gitApp)).toBe('git')
  })

  it('does not call a dockerfile app git just because it carries the placeholder', () => {
    expect(classifyApplicationSource(dockerfileApp)).toBe('dockerfile')
  })

  it('treats a Dockerfile inside a real git repo as git-based', () => {
    // `source_id` (a GitHub App) or `private_key_id` (a deploy key) is what
    // distinguishes a genuine repo from the hardcoded placeholder.
    expect(
      classifyApplicationSource({
        build_pack: 'dockerfile',
        git_repository: 'org/repo',
        source_id: 3,
      }),
    ).toBe('git')
    expect(
      classifyApplicationSource({
        build_pack: 'dockerfile',
        git_repository: 'git@github.com:org/repo.git',
        private_key_id: 1,
      }),
    ).toBe('git')
  })
})

describe('dockerImageLabel', () => {
  it('renders name:tag', () => {
    expect(dockerImageLabel(dockerImageApp)).toBe(
      'ghcr.io/coollabsio/coolify:latest',
    )
  })

  it('renders the bare name when the tag is absent', () => {
    expect(
      dockerImageLabel({
        docker_registry_image_name: 'nginx',
        docker_registry_image_tag: null,
      }),
    ).toBe('nginx')
  })
})

describe('versionLabel', () => {
  // The card shows the git branch for git-backed apps and the image tag for
  // docker-image apps; nothing else (including services/databases) has either.
  it('shows the git branch for a git-backed app', () => {
    expect(versionLabel(gitApp)).toBe('main')
  })

  it('shows the image tag for a docker-image app', () => {
    expect(versionLabel(dockerImageApp)).toBe('latest')
  })

  it('ignores the placeholder git branch on non-git apps', () => {
    // Coolify hardcodes git_branch = 'main' on dockerimage/dockerfile apps;
    // showing it would mislabel the row as git-backed.
    expect(versionLabel(dockerfileApp)).toBeNull()
  })

  it('shows the branch for a Dockerfile inside a real git repo', () => {
    expect(
      versionLabel({
        build_pack: 'dockerfile',
        git_repository: 'org/repo',
        git_branch: 'dev',
        source_id: 3,
      }),
    ).toBe('dev')
  })

  it('returns null when the branch is empty', () => {
    expect(
      versionLabel({ build_pack: 'nixpacks', git_repository: 'org/repo', git_branch: '  ' }),
    ).toBeNull()
  })

  it('returns null for an unsupported source', () => {
    expect(versionLabel({ build_pack: 'nixpacks' })).toBeNull()
  })
})

describe('editableConfig', () => {
  // dockerimage apps edit the tag; git apps edit the branch;
  // dockerfile-without-git apps edit nothing.
  it('offers the tag on a docker-image app', () => {
    expect(editableConfig(dockerImageApp)).toEqual({ kind: 'tag', value: 'latest' })
  })

  it('offers the branch on a git app', () => {
    expect(editableConfig(gitApp)).toEqual({ kind: 'branch', value: 'main' })
  })

  it('offers nothing on a dockerfile app with no git source', () => {
    expect(editableConfig(dockerfileApp)).toBeNull()
  })

  it('treats an absent tag as editable and empty, not as uneditable', () => {
    expect(
      editableConfig({
        build_pack: 'dockerimage',
        docker_registry_image_name: 'nginx',
        docker_registry_image_tag: null,
      }),
    ).toEqual({ kind: 'tag', value: '' })
  })
})

describe('configEditPayload', () => {
  it('patches only the edited field', () => {
    expect(configEditPayload({ kind: 'tag', value: 'v2' })).toEqual({
      docker_registry_image_tag: 'v2',
    })
    expect(configEditPayload({ kind: 'branch', value: 'dev' })).toEqual({
      git_branch: 'dev',
    })
    expect(
      configEditPayload({ kind: 'network-alias', value: 'web.alias' }),
    ).toEqual({
      custom_network_aliases: 'web.alias',
    })
  })
})

describe('redeployClearedBy (ADR-0005)', () => {
  // A deploy always clears; a restart clears only for dockerimage apps, because
  // Coolify forces restart_only off for those and so re-resolves the new tag.
  it('lets a deploy clear the marker for any build pack', () => {
    expect(redeployClearedBy('nixpacks', 'deploy')).toBe(true)
    expect(redeployClearedBy('dockerimage', 'deploy')).toBe(true)
    expect(redeployClearedBy(undefined, 'deploy')).toBe(true)
  })

  it('lets a restart clear the marker only for dockerimage apps', () => {
    expect(redeployClearedBy('dockerimage', 'restart')).toBe(true)
    expect(redeployClearedBy('nixpacks', 'restart')).toBe(false)
    expect(redeployClearedBy(undefined, 'restart')).toBe(false)
  })
})

describe('batchConfigTarget', () => {
  it('offers the branch when every app is git-backed', () => {
    expect(batchConfigTarget([gitApp, gitApp])).toEqual({
      kind: 'branch',
      label: 'Git branch',
    })
  })

  it('offers the tag when every app is a docker image', () => {
    expect(batchConfigTarget([dockerImageApp, dockerImageApp])).toEqual({
      kind: 'tag',
      label: 'Image tag',
    })
  })

  it('offers nothing for a mixed selection', () => {
    // A shared field editing two different concepts would silently write the
    // branch name into an image tag.
    expect(batchConfigTarget([gitApp, dockerImageApp])).toBeNull()
  })

  it('offers nothing when any app is unsupported', () => {
    expect(batchConfigTarget([dockerfileApp])).toBeNull()
  })

  it('offers nothing for an empty selection', () => {
    expect(batchConfigTarget([])).toBeNull()
  })
})

describe('sharedConfigValue', () => {
  const row = (over: Partial<BatchConfigApp>): BatchConfigApp => ({
    uuid: 'a',
    name: 'a',
    target: 'branch',
    current: 'main',
    assigned: 'main',
    overridden: false,
    canDeploy: true,
    ...over,
  })

  it('suggests the common current value', () => {
    expect(sharedConfigValue([row({ uuid: 'a' }), row({ uuid: 'b' })])).toBe('main')
  })

  it('suggests nothing when the apps disagree', () => {
    expect(
      sharedConfigValue([row({ uuid: 'a' }), row({ uuid: 'b', current: 'dev' })]),
    ).toBe('')
  })
})
