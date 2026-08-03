// Verifies the env var editing layer without touching a live Coolify
// instance: URL mapping, value readability semantics, and that every payload
// the editor can send conforms to the env-var request schemas in
// coolify-openapi-v4.x.yaml.
//
// Run with: pnpm check:envs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  envBasePath,
  envItemPath,
  envSupportsPreview,
  envValue,
  isValueReadable,
} from '../apps/web/lib/envs.ts'

// --- URL mapping -----------------------------------------------------------

assert.equal(envBasePath('application', 'a1'), '/applications/a1/envs')
assert.equal(envBasePath('service', 's1'), '/services/s1/envs')
assert.equal(envBasePath('database', 'd1'), '/databases/d1/envs')
assert.equal(envItemPath('application', 'a1', 'e1'), '/applications/a1/envs/e1')
assert.equal(envItemPath('service', 's1', 'e1'), '/services/s1/envs/e1')
assert.equal(envItemPath('database', 'd1', 'e1'), '/databases/d1/envs/e1')

// --- Value readability -----------------------------------------------------

assert.equal(envValue({ real_value: 'secret', value: '' }), 'secret')
assert.equal(envValue({ real_value: null, value: 'raw' }), 'raw')
assert.equal(envValue({ real_value: undefined, value: '' }), '')

// A normal var is readable.
assert.equal(isValueReadable({ is_shown_once: false, real_value: 'x' }), true)
// A shown-once var whose value was never read back is not readable.
assert.equal(isValueReadable({ is_shown_once: true, real_value: null }), false)
// A shown-once var that IS readable (real_value present) remains readable.
assert.equal(isValueReadable({ is_shown_once: true, real_value: 'x' }), true)

// --- Preview support -------------------------------------------------------

assert.equal(envSupportsPreview('application'), true)
assert.equal(envSupportsPreview('service'), true)
assert.equal(envSupportsPreview('database'), false)

// --- Payload conformance to the OpenAPI spec -------------------------------

// The env-var endpoint paths are quoted in the YAML (e.g.
// `'/applications/{uuid}/envs':`), which the shared coolify-spec.mjs helper
// does not parse, so read the request-body properties directly here.
const HERE = dirname(fileURLToPath(import.meta.url))
const lines = readFileSync(join(HERE, '..', 'coolify-openapi-v4.x.yaml'), 'utf8').split('\n')

function envProps(type) {
  const plural = type === 'application' ? 'applications' : type === 'service' ? 'services' : 'databases'
  const path = `'/${plural}/{uuid}/envs':`
  const start = lines.findIndex((l) => l.trim().replace(/^"|"$/g, '') === path)
  assert.ok(start >= 0, `env path not found: ${path}`)
  // The POST request body is the authoritative create schema. Anchor on the
  // `post:` block (the GET response's `properties:` would otherwise match
  // first), then take the first `properties:` after its `requestBody:`.
  const post = lines.findIndex(
    (l, i) => i > start && l.trim() === 'post:',
  )
  assert.ok(post > start, `no post block for ${path}`)
  const requestBody = lines.findIndex(
    (l, i) => i > post && l.trim() === 'requestBody:',
  )
  assert.ok(requestBody > post, `no requestBody for ${path}`)
  const propsStart = lines.findIndex(
    (l, i) => i > requestBody && l.includes('properties:') && !l.trim().startsWith('#'),
  )
  assert.ok(propsStart > requestBody, `no properties block for ${path}`)
  const props = new Set()
  for (let i = propsStart + 1; i < Math.min(propsStart + 40, lines.length); i++) {
    const l = lines[i]
    const ind = l.length - l.trimStart().length
    const m = l.trim().match(/^([a-z_][a-z0-9_]*):/)
    if (!m) continue
    if (ind <= 14) break // left the properties block
    props.add(m[1])
  }
  return props
}

const EDITABLE = ['key', 'value', 'is_preview', 'is_literal', 'is_multiline']
const ALL_TYPES = ['application', 'service', 'database']

for (const type of ALL_TYPES) {
  const allowed = envProps(type)
  // Every field the editor can send must be accepted by the endpoint. The
  // check is on the EDITABLE set itself, not on a payload pre-filtered by
  // `allowed` (which would be tautological). The one permitted mismatch is
  // `is_preview` for databases, which the editor deliberately never sends.
  for (const k of EDITABLE) {
    if (k === 'is_preview' && type === 'database') continue
    assert.ok(allowed.has(k), `${type}: editor field ${k} not allowed by the spec`)
  }
}

// Databases must not send is_preview even though the model carries it.
assert.ok(!envProps('database').has('is_preview'))
assert.ok(envProps('application').has('is_preview'))
assert.ok(envProps('service').has('is_preview'))

// --- Endpoint structure (ADR-0003 guard) ------------------------------------
// Coolify has no PATCH /{type}/{uuid}/envs/{env_uuid}: updates go to
// PATCH /{type}/{uuid}/envs (routed by key) and only DELETE exists on the
// item path. This assertion fails loudly if a future spec sync adds a patch
// that should change the client back to per-env PATCH.
function envItemMethods(type) {
  const plural = type === 'application' ? 'applications' : type === 'service' ? 'services' : 'databases'
  const path = `'/${plural}/{uuid}/envs/{env_uuid}':`
  const start = lines.findIndex((l) => l.trim().replace(/^"|"$/g, '') === path)
  assert.ok(start >= 0, `env item path not found: ${path}`)
  const methods = []
  for (let i = start + 1; i < Math.min(start + 40, lines.length); i++) {
    const t = lines[i].trim()
    if (/^(get|post|patch|delete|put):/.test(t)) methods.push(t.replace(':', ''))
    if (t.startsWith("'") && t.endsWith("':")) break
  }
  return methods
}

for (const type of ALL_TYPES) {
  const methods = envItemMethods(type)
  assert.deepEqual(
    methods,
    ['delete'],
    `${type}: expected only delete on /envs/{env_uuid}, got ${methods.join(', ')}`,
  )
}

console.log('PASS — env URL mapping, value semantics, and payloads conform to the spec')
