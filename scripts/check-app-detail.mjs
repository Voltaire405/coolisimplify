// Verifies how the drawer classifies an application's build source for the
// Details tab: a Docker-image app must show the image (and tag), not the
// placeholder git repository Coolify stores on non-git apps.
//
// Background: Coolify's create-dockerimage and create-dockerfile controllers
// hardcode `git_repository = 'coollabsio/coolify'` and `git_branch = 'main'`
// on every non-git app, so `git_repository` presence is NOT a reliable signal
// that an application is git-based. Real signal: `build_pack`.
//
// Run with: pnpm check:app-detail
import assert from 'node:assert/strict'
import {
  classifyApplicationSource,
  dockerImageLabel,
  editableConfig,
  configEditPayload,
  redeployClearedBy,
  batchConfigTarget,
  sharedConfigValue,
} from '../apps/web/lib/app-detail.ts'

// --- docker-image apps: the reported bug ------------------------------------
// Real Coolify stores the placeholder repo on dockerimage apps.
const dockerImageApp = {
  build_pack: 'dockerimage',
  git_repository: 'coollabsio/coolify',
  git_branch: 'main',
  docker_registry_image_name: 'ghcr.io/coollabsio/coolify',
  docker_registry_image_tag: 'latest',
}

assert.equal(classifyApplicationSource(dockerImageApp), 'docker-image')
assert.equal(dockerImageLabel(dockerImageApp), 'ghcr.io/coollabsio/coolify:latest')

// Tag may be absent.
assert.equal(
  dockerImageLabel({
    build_pack: 'dockerimage',
    docker_registry_image_name: 'nginx',
    docker_registry_image_tag: null,
  }),
  'nginx',
)

// --- real git apps still show the repository --------------------------------
const gitApp = {
  build_pack: 'nixpacks',
  git_repository: 'org/repo',
  git_branch: 'main',
  docker_registry_image_name: null,
  docker_registry_image_tag: null,
}
assert.equal(classifyApplicationSource(gitApp), 'git')
assert.equal(gitApp.git_repository, 'org/repo')

// --- dockerfile apps are not git-based (same placeholder) -------------------
assert.equal(
  classifyApplicationSource({
    build_pack: 'dockerfile',
    git_repository: 'coollabsio/coolify',
    git_branch: 'main',
  }),
  'dockerfile',
)

// --- a Dockerfile inside a real git repo is still git-based -----------------
assert.equal(
  classifyApplicationSource({
    build_pack: 'dockerfile',
    git_repository: 'org/repo',
    git_branch: 'main',
    source_id: 3,
  }),
  'git',
)
assert.equal(
  classifyApplicationSource({
    build_pack: 'dockerfile',
    git_repository: 'git@github.com:org/repo.git',
    private_key_id: 1,
  }),
  'git',
)

// --- editable config target --------------------------------------------------
// dockerimage apps edit the tag; git apps edit the branch; dockerfile-without-git
// apps edit nothing.
assert.deepEqual(editableConfig(dockerImageApp), { kind: 'tag', value: 'latest' })
assert.deepEqual(editableConfig(gitApp), { kind: 'branch', value: 'main' })
assert.equal(
  editableConfig({
    build_pack: 'dockerfile',
    git_repository: 'coollabsio/coolify',
    git_branch: 'main',
  }),
  null,
)
// An absent tag is still an editable, empty value.
assert.deepEqual(
  editableConfig({
    build_pack: 'dockerimage',
    docker_registry_image_name: 'nginx',
    docker_registry_image_tag: null,
  }),
  { kind: 'tag', value: '' },
)

// --- PATCH payloads ----------------------------------------------------------
assert.deepEqual(configEditPayload({ kind: 'tag', value: 'v2' }), {
  docker_registry_image_tag: 'v2',
})
assert.deepEqual(configEditPayload({ kind: 'branch', value: 'dev' }), {
  git_branch: 'dev',
})

// --- clear rule (ADR-0005): asymmetric per build pack ------------------------
// A deploy always clears; a restart clears only for dockerimage apps.
assert.equal(redeployClearedBy('nixpacks', 'deploy'), true)
assert.equal(redeployClearedBy('nixpacks', 'restart'), false)
assert.equal(redeployClearedBy('dockerimage', 'restart'), true)
assert.equal(redeployClearedBy('dockerimage', 'deploy'), true)
assert.equal(redeployClearedBy(undefined, 'deploy'), true)
assert.equal(redeployClearedBy(undefined, 'restart'), false)

// --- batch config target (shared-field composition) --------------------------
// All git -> branch; all dockerimage -> tag; mixed or unsupported -> null.
assert.deepEqual(batchConfigTarget([gitApp, gitApp]), {
  kind: 'branch',
  label: 'Git branch',
})
assert.deepEqual(batchConfigTarget([dockerImageApp, dockerImageApp]), {
  kind: 'tag',
  label: 'Image tag',
})
assert.equal(batchConfigTarget([gitApp, dockerImageApp]), null)
assert.equal(
  batchConfigTarget([
    { build_pack: 'dockerfile', git_repository: 'coollabsio/coolify', git_branch: 'main' },
  ]),
  null,
)

// --- shared value suggestion -------------------------------------------------
assert.equal(
  sharedConfigValue([
    { uuid: 'a', name: 'a', target: 'branch', current: 'main', assigned: 'main', overridden: false, canDeploy: true },
    { uuid: 'b', name: 'b', target: 'branch', current: 'main', assigned: 'main', overridden: false, canDeploy: true },
  ]),
  'main',
)
assert.equal(
  sharedConfigValue([
    { uuid: 'a', name: 'a', target: 'branch', current: 'main', assigned: 'main', overridden: false, canDeploy: true },
    { uuid: 'b', name: 'b', target: 'branch', current: 'dev', assigned: 'main', overridden: false, canDeploy: true },
  ]),
  '',
)

console.log('PASS — application source classification matches the real API contract')
