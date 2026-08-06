// Verifies that every clone payload the dashboard can build is accepted by
// Coolify's create endpoints, without touching a live instance.
//
// Coolify validates create bodies against a strict per-endpoint allowlist and
// 422s on anything unexpected, so this walks each clone flow (application via
// GitHub App / Dockerfile / Docker Compose, service, and every database
// engine), builds the payload from a synthetic source detail with every schema
// field populated, and checks it against the request schema in
// coolify-openapi-v4.x.yaml plus the controller's extra rules.
import { describe, expect, it } from 'vitest'
import {
  componentSchema,
  createSchema,
  type SpecProp,
} from '../test/coolify-spec'
import { DATABASE_CREDENTIAL_FIELDS, buildClonePayload } from './clone'
import type {
  Application,
  Database,
  DatabaseType,
  GithubApp,
  ResourceType,
  Service,
} from './types'

const DB_PATHS: Record<string, string> = {
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
function isBase64(s: string): boolean {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) return false
  try {
    return Buffer.from(s, 'base64').toString('base64') === s
  } catch {
    return false
  }
}

/** The spec has no Database component; the create schemas cover what we read. */
function databaseSchema(): Record<string, SpecProp> {
  const merged: Record<string, SpecProp> = {}
  for (const p of Object.values(DB_PATHS)) Object.assign(merged, createSchema(p).props)
  return merged
}

/** A GET detail with every schema field populated: worst case for leakage. */
function syntheticDetail(
  component: string,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const schema =
    component === 'Database' ? databaseSchema() : componentSchema(component)
  const d: Record<string, unknown> = {}
  for (const [key, meta] of Object.entries(schema)) {
    switch (meta.type) {
      case 'integer':
        d[key] = 1
        break
      case 'boolean':
        d[key] = true
        break
      case 'object':
        d[key] = {}
        break
      case 'array':
        d[key] = []
        break
      default:
        d[key] = meta.enum ? meta.enum[0] : `v_${key}`
    }
  }
  return { ...d, ...overrides }
}

function validate(
  payload: Record<string, unknown>,
  allowed: Set<string>,
  required: string[],
  props: Record<string, SpecProp>,
): string[] {
  const problems: string[] = []
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
    const want =
      meta.type === 'integer' || meta.type === 'number' ? 'number' : meta.type
    if (want === 'array' ? actual !== 'array' : actual !== want) {
      problems.push(`${k}: expected ${meta.type}, got ${actual}`)
    }
    if (meta.enum && !meta.enum.includes(v as string)) {
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
const GITHUB_APPS = [{ id: 3, uuid: 'gh-app-uuid', name: 'gh' }] as GithubApp[]

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
 * Keyed by path; used only for type-shape validation of fields we copy, not to
 * expand what the payload may legally contain.
 */
const EXTRA_PROPS: Record<string, Record<string, SpecProp>> = {
  '/applications/private-github-app': {
    custom_network_aliases: { type: 'string', nullable: true, enum: null },
  },
  '/applications/dockerfile': {
    custom_network_aliases: { type: 'string', nullable: true, enum: null },
  },
}

interface CloneCase {
  id: string
  type: ResourceType
  detail: Record<string, unknown>
  target: typeof TARGET & { domains?: string; autogenerateDomain?: boolean }
  secrets?: Record<string, string>
  engine?: string
}

function cases(): CloneCase[] {
  const list: CloneCase[] = []
  const app = (id: string, overrides: Record<string, unknown>) =>
    syntheticDetail('Application', { uuid: id, ...overrides })

  list.push({
    id: 'application/github',
    type: 'application',
    detail: app('a1', {
      source_id: 3,
      build_pack: 'nixpacks',
      fqdn: 'https://a.example.com',
      git_repository: 'org/repo',
      git_branch: 'main',
      ports_exposes: '3000',
    }),
    target: { ...TARGET, domains: 'https://c.example.com' },
  })
  list.push({
    id: 'application/github (batch: no domains)',
    type: 'application',
    detail: app('a2', {
      source_id: 3,
      build_pack: 'nixpacks',
      fqdn: 'https://a.example.com',
      git_repository: 'org/repo',
      git_branch: 'main',
      ports_exposes: '3000',
    }),
    target: { ...TARGET, domains: '', autogenerateDomain: false },
  })
  // A private repo built from a Dockerfile in the repo: source_id wins in
  // detectApplicationKind, and dockerfile/custom_labels come back empty.
  list.push({
    id: 'application/github + dockerfile build pack',
    type: 'application',
    detail: app('a3', {
      source_id: 3,
      build_pack: 'dockerfile',
      fqdn: null,
      git_repository: 'org/repo',
      git_branch: 'release/1.0',
      ports_exposes: '3000',
      dockerfile: null,
      custom_labels: '',
      dockerfile_location: '/Dockerfile',
    }),
    target: { ...TARGET, domains: '' },
  })
  // The source has custom network aliases (Docker container aliases for
  // app-to-app traffic on the shared network); the clone must carry them.
  list.push({
    id: 'application/github (custom network aliases)',
    type: 'application',
    detail: app('a6', {
      source_id: 3,
      build_pack: 'nixpacks',
      fqdn: 'https://a.example.com',
      git_repository: 'org/repo',
      git_branch: 'main',
      ports_exposes: '3000',
      custom_network_aliases: 'api,backend',
    }),
    target: { ...TARGET, domains: '' },
  })
  list.push({
    id: 'application/dockerfile inline (custom network aliases)',
    type: 'application',
    detail: app('a7', {
      source_id: null,
      build_pack: 'dockerfile',
      fqdn: null,
      ports_exposes: '80',
      dockerfile: 'FROM alpine\nRUN echo hi',
      custom_network_aliases: 'worker',
    }),
    target: { ...TARGET, domains: '' },
  })
  list.push({
    id: 'application/github + dockercompose build pack',
    type: 'application',
    detail: app('a4', {
      source_id: 3,
      build_pack: 'dockercompose',
      fqdn: 'https://e.example.com',
      git_repository: 'org/repo',
      git_branch: 'main',
      ports_exposes: '80',
      docker_compose_domains: '{"app":{"domain":"https://e.example.com"}}',
    }),
    target: { ...TARGET, domains: 'https://e.example.com' },
  })
  list.push({
    id: 'application/dockerfile (inline)',
    type: 'application',
    detail: app('a5', {
      source_id: null,
      build_pack: 'dockerfile',
      fqdn: null,
      ports_exposes: '80',
      dockerfile: 'FROM alpine\nRUN echo hi',
    }),
    target: { ...TARGET, domains: '' },
  })
  list.push({
    id: 'service',
    type: 'service',
    detail: syntheticDetail('Service', {
      uuid: 's1',
      service_type: 'plausible',
      docker_compose_raw: 'services:\n  app:\n    image: x',
    }),
    target: TARGET,
  })

  const IMAGES: Record<string, string> = {
    postgresql: 'postgres:16',
    mysql: 'mysql:8',
    mariadb: 'mariadb:11',
    redis: 'redis:7',
    keydb: 'keydb:latest',
    dragonfly: 'dragonfly:latest',
    clickhouse: 'clickhouse:24',
    mongodb: 'mongo:7',
  }
  for (const [engine, image] of Object.entries(IMAGES)) {
    const secrets: Record<string, string> = {}
    for (const f of DATABASE_CREDENTIAL_FIELDS[engine as DatabaseType].fields) {
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
  const pg: Record<string, string> = {}
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

function schemaFor(c: CloneCase) {
  if (c.type === 'application') {
    const path =
      c.detail.source_id != null
        ? '/applications/private-github-app'
        : '/applications/dockerfile'
    const schema = createSchema(path)
    schema.props = { ...schema.props, ...(EXTRA_PROPS[path] ?? {}) }
    return schema
  }
  return createSchema(c.type === 'service' ? '/services' : DB_PATHS[c.engine!]!)
}

function build(c: CloneCase): Record<string, unknown> {
  return buildClonePayload(
    c.detail as unknown as Application | Service | Database,
    c.type,
    c.target,
    c.secrets ?? {},
    GITHUB_APPS,
  ) as unknown as Record<string, unknown>
}

describe('clone payloads conform to the create schemas', () => {
  it.each(cases().map((c) => [c.id, c] as const))(
    '%s would not be rejected with 422',
    (_id, c) => {
      const schema = schemaFor(c)
      const problems = validate(
        build(c),
        new Set([...Object.keys(schema.props), ...EXTRA_ALLOWED]),
        // environment_name is an alternative to environment_uuid, not a second
        // requirement, so the spec's `required` overstates it.
        schema.required.filter((k) => k !== 'environment_name'),
        schema.props,
      )
      expect(problems).toEqual([])
    },
  )
})

describe('custom network aliases survive the clone', () => {
  // The bug being guarded: cloning an application must carry the source's
  // Docker container aliases on the shared network, or app-to-app traffic in
  // the clone silently fails to resolve.
  const withAliases = cases().filter(
    (c) => c.type === 'application' && c.detail.custom_network_aliases,
  )

  it('has cases that actually carry aliases', () => {
    expect(withAliases.length).toBeGreaterThan(0)
  })

  it.each(withAliases.map((c) => [c.id, c] as const))(
    '%s keeps custom_network_aliases',
    (_id, c) => {
      expect(build(c).custom_network_aliases).toBe(c.detail.custom_network_aliases)
    },
  )
})
