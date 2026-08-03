// Verifies that every clone payload the dashboard can build is accepted by
// Coolify's create endpoints, without touching a live instance.
//
// Coolify validates create bodies against a strict per-endpoint allowlist and
// 422s on anything unexpected, so this walks each clone flow (application via
// GitHub App / Dockerfile / Docker Compose, service, and every database
// engine), builds the payload from a synthetic source detail with every schema
// field populated, and checks it against the request schema in
// coolify-openapi-v4.x.yaml plus the controller's extra rules.
//
// Run with: pnpm check:clone-payload
import { createSchema, componentSchema } from './coolify-spec.mjs'
import {
  buildClonePayload,
  DATABASE_CREDENTIAL_FIELDS,
} from '../apps/web/lib/clone.ts'

const DB_PATHS = {
  postgresql: '/databases/postgresql',
  mysql: '/databases/mysql',
  mariadb: '/databases/mariadb',
  redis: '/databases/redis',
  keydb: '/databases/keydb',
  dragonfly: '/databases/dragonfly',
  clickhouse: '/databases/clickhouse',
  mongodb: '/databases/mongodb',
}

/**
 * Fields the controller requires base64-encoded. An empty string counts as
 * present for `$request->has()` and then fails `mb_detect_encoding()`, so it
 * must be omitted rather than encoded — both checks return the same
 * "should be base64 encoded" message.
 */
const BASE64_FIELDS = [
  'dockerfile',
  'docker_compose_raw',
  'custom_nginx_configuration',
  'custom_labels',
]

/** Mirrors Coolify's isBase64Encoded(): strict decode + re-encode round-trip. */
function isBase64(s) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) return false
  try {
    return Buffer.from(s, 'base64').toString('base64') === s
  } catch {
    return false
  }
}

/** The spec has no Database component; the create schemas cover what we read. */
function databaseSchema() {
  const merged = {}
  for (const p of Object.values(DB_PATHS)) Object.assign(merged, createSchema(p).props)
  return merged
}

/** A GET detail with every schema field populated: worst case for leakage. */
function syntheticDetail(component, overrides) {
  const schema = component === 'Database' ? databaseSchema() : componentSchema(component)
  const d = {}
  for (const [key, meta] of Object.entries(schema)) {
    switch (meta.type) {
      case 'integer': d[key] = 1; break
      case 'boolean': d[key] = true; break
      case 'object': d[key] = {}; break
      case 'array': d[key] = []; break
      default: d[key] = meta.enum ? meta.enum[0] : `v_${key}`
    }
  }
  return { ...d, ...overrides }
}

function validate(payload, allowed, required, props) {
  const problems = []
  for (const k of Object.keys(payload)) {
    if (!allowed.has(k)) problems.push(`field not allowed: ${k}`)
  }
  for (const k of required) {
    if (!(k in payload)) problems.push(`missing required: ${k}`)
  }
  for (const [k, v] of Object.entries(payload)) {
    const meta = props[k]
    if (!meta?.type) continue
    if (v === null) {
      if (!meta.nullable) problems.push(`${k}: null but not nullable`)
      continue
    }
    const actual = Array.isArray(v) ? 'array' : typeof v
    const want = meta.type === 'integer' || meta.type === 'number' ? 'number' : meta.type
    if (want === 'array' ? actual !== 'array' : actual !== want) {
      problems.push(`${k}: expected ${meta.type}, got ${actual}`)
    }
    if (meta.enum && !meta.enum.includes(v)) {
      problems.push(`${k}: ${JSON.stringify(v)} not in [${meta.enum}]`)
    }
  }
  for (const k of BASE64_FIELDS) {
    const v = payload[k]
    if (typeof v !== 'string') continue
    if (v === '') problems.push(`${k}: empty string sent; the field must be omitted`)
    else if (!isBase64(v)) problems.push(`${k}: must be base64-encoded`)
  }
  return problems
}

const TARGET = {
  projectUuid: 'proj-uuid',
  serverUuid: 'srv-uuid',
  environmentUuid: 'env-uuid',
  name: 'Resource-copy',
}
const GITHUB_APPS = [{ id: 3, uuid: 'gh-app-uuid', name: 'gh' }]

/**
 * Fields the real v4.x controller accepts on create but that the synced
 * OpenAPI file does not list yet. The controller's `$allowedFields` is the
 * source of truth: an unknown field 422s with "This field is not allowed."
 *
 * https://github.com/coollabsio/coolify/blob/v4.x/app/Http/Controllers/Api/ApplicationsController.php
 */
const EXTRA_ALLOWED = new Set([
  'custom_network_aliases',
  'use_build_secrets',
  'is_git_submodules_enabled',
  'is_git_lfs_enabled',
  'is_git_shallow_clone_enabled',
  'disable_build_cache',
  'inject_build_args_to_dockerfile',
  'include_source_commit_in_build',
  'is_env_sorting_enabled',
  'is_pr_deployments_public_enabled',
  'stop_grace_period',
  'docker_images_to_keep',
  'is_gzip_enabled',
  'is_stripprefix_enabled',
  'is_raw_compose_deployment_enabled',
  'use_build_server',
  'docker_compose_raw',
  'custom_nginx_configuration',
  'dockerfile_target_build',
  'manual_webhook_secret_github',
  'manual_webhook_secret_gitlab',
  'manual_webhook_secret_bitbucket',
  'manual_webhook_secret_gitea',
  'tags',
  'type',
  'destination_uuid',
  'is_preview_deployments_enabled',
  'git_commit_sha',
  'private_key_uuid',
  'docker_registry_image_name',
  'docker_registry_image_tag',
  'is_force_https_enabled',
])

/**
 * Extensions to the spec's props that are not described in the synced YAML.
 * Keyed by path; used only for type-shape validation of fields the script
 * copies, not to expand what the payload may legally contain.
 */
const EXTRA_PROPS = {
  '/applications/private-github-app': {
    custom_network_aliases: { type: 'string', nullable: true, enum: null },
  },
  '/applications/dockerfile': {
    custom_network_aliases: { type: 'string', nullable: true, enum: null },
  },
}

function cases() {
  const list = []
  const app = (id, overrides) => syntheticDetail('Application', { uuid: id, ...overrides })

  list.push({
    id: 'application/github',
    type: 'application',
    detail: app('a1', {
      source_id: 3, build_pack: 'nixpacks', fqdn: 'https://a.example.com',
      git_repository: 'org/repo', git_branch: 'main', ports_exposes: '3000',
    }),
    target: { ...TARGET, domains: 'https://c.example.com' },
  })
  list.push({
    id: 'application/github (batch: no domains)',
    type: 'application',
    detail: app('a2', {
      source_id: 3, build_pack: 'nixpacks', fqdn: 'https://a.example.com',
      git_repository: 'org/repo', git_branch: 'main', ports_exposes: '3000',
    }),
    target: { ...TARGET, domains: '', autogenerateDomain: false },
  })
  // A private repo built from a Dockerfile in the repo: source_id wins in
  // detectApplicationKind, and dockerfile/custom_labels come back empty.
  list.push({
    id: 'application/github + dockerfile build pack',
    type: 'application',
    detail: app('a3', {
      source_id: 3, build_pack: 'dockerfile', fqdn: null,
      git_repository: 'org/repo', git_branch: 'release/1.0', ports_exposes: '3000',
      dockerfile: null, custom_labels: '', dockerfile_location: '/Dockerfile',
    }),
    target: { ...TARGET, domains: '' },
  })
  // The source has custom network aliases (Docker container aliases for
  // app-to-app traffic on the shared network); the clone must carry them.
  list.push({
    id: 'application/github (custom network aliases)',
    type: 'application',
    detail: app('a6', {
      source_id: 3, build_pack: 'nixpacks', fqdn: 'https://a.example.com',
      git_repository: 'org/repo', git_branch: 'main', ports_exposes: '3000',
      custom_network_aliases: 'api,backend',
    }),
    target: { ...TARGET, domains: '' },
  })
  list.push({
    id: 'application/dockerfile inline (custom network aliases)',
    type: 'application',
    detail: app('a7', {
      source_id: null, build_pack: 'dockerfile', fqdn: null, ports_exposes: '80',
      dockerfile: 'FROM alpine\nRUN echo hi',
      custom_network_aliases: 'worker',
    }),
    target: { ...TARGET, domains: '' },
  })
  list.push({
    id: 'application/github + dockercompose build pack',
    type: 'application',
    detail: app('a4', {
      source_id: 3, build_pack: 'dockercompose', fqdn: 'https://e.example.com',
      git_repository: 'org/repo', git_branch: 'main', ports_exposes: '80',
      docker_compose_domains: '{"app":{"domain":"https://e.example.com"}}',
    }),
    target: { ...TARGET, domains: 'https://e.example.com' },
  })
  list.push({
    id: 'application/dockerfile (inline)',
    type: 'application',
    detail: app('a5', {
      source_id: null, build_pack: 'dockerfile', fqdn: null, ports_exposes: '80',
      dockerfile: 'FROM alpine\nRUN echo hi',
    }),
    target: { ...TARGET, domains: '' },
  })
  list.push({
    id: 'service',
    type: 'service',
    detail: syntheticDetail('Service', {
      uuid: 's1', service_type: 'plausible',
      docker_compose_raw: 'services:\n  app:\n    image: x',
    }),
    target: TARGET,
  })

  const IMAGES = {
    postgresql: 'postgres:16', mysql: 'mysql:8', mariadb: 'mariadb:11',
    redis: 'redis:7', keydb: 'keydb:latest', dragonfly: 'dragonfly:latest',
    clickhouse: 'clickhouse:24', mongodb: 'mongo:7',
  }
  for (const [engine, image] of Object.entries(IMAGES)) {
    const secrets = {}
    for (const f of DATABASE_CREDENTIAL_FIELDS[engine].fields) {
      if (f.required) secrets[f.key] = 'S3cret!'
    }
    list.push({
      id: `database/${engine}`,
      type: 'database',
      detail: syntheticDetail('Database', { uuid: `d-${engine}`, image }),
      target: TARGET,
      secrets,
      engine,
    })
  }
  // A mixed-engine batch applies one credential set to every clone; the
  // per-engine filter must drop the ones this engine does not accept.
  const pg = {}
  for (const f of DATABASE_CREDENTIAL_FIELDS.postgresql.fields) {
    if (f.required) pg[f.key] = 'S3cret!'
  }
  list.push({
    id: 'database/redis (batch led by postgresql)',
    type: 'database',
    detail: syntheticDetail('Database', { uuid: 'd-mixed', image: 'redis:7' }),
    target: TARGET,
    secrets: pg,
    engine: 'redis',
  })
  return list
}

function schemaFor(c) {
  if (c.type === 'application') {
    // environment_name is an alternative to environment_uuid, not a second
    // requirement, so the spec's `required` overstates it.
    const path = c.detail.source_id != null
      ? '/applications/private-github-app'
      : '/applications/dockerfile'
    const schema = createSchema(path)
    schema.props = { ...schema.props, ...(EXTRA_PROPS[path] ?? {}) }
    return schema
  }
  return createSchema(c.type === 'service' ? '/services' : DB_PATHS[c.engine])
}

let failures = 0
for (const c of cases()) {
  let problems
  try {
    const payload = buildClonePayload(
      c.detail, c.type, c.target, c.secrets ?? {}, GITHUB_APPS,
    )
    const schema = schemaFor(c)
    problems = validate(
      payload,
      new Set([...Object.keys(schema.props), ...EXTRA_ALLOWED]),
      schema.required.filter((k) => k !== 'environment_name'),
      schema.props,
    )
  } catch (err) {
    problems = [`threw: ${err.message}`]
  }
  if (problems.length) {
    failures += 1
    console.log(`FAIL  ${c.id}`)
    for (const p of problems) console.log(`        ${p}`)
  } else {
    console.log(`ok    ${c.id}`)
  }
}

// The bug being guarded: cloning an application must carry the source's
// custom network aliases (Docker container aliases on the shared network).
for (const c of cases().filter((c) => c.type === 'application' && c.detail.custom_network_aliases)) {
  let payload
  try {
    payload = buildClonePayload(
      c.detail, c.type, c.target, c.secrets ?? {}, GITHUB_APPS,
    )
  } catch (err) {
    failures += 1
    console.log(`FAIL  ${c.id}: network aliases — threw: ${err.message}`)
    continue
  }
  if (payload.custom_network_aliases !== c.detail.custom_network_aliases) {
    failures += 1
    console.log(
      `FAIL  ${c.id}: network aliases — clone payload has custom_network_aliases=${JSON.stringify(payload.custom_network_aliases)}, expected ${JSON.stringify(c.detail.custom_network_aliases)}`,
    )
  } else {
    console.log(`ok    ${c.id}: custom_network_aliases preserved`)
  }
}

console.log(
  failures
    ? `\nFAIL — ${failures} payload(s) would be rejected with 422`
    : '\nPASS — every clone payload conforms to the create schemas',
)
process.exit(failures ? 1 : 0)
