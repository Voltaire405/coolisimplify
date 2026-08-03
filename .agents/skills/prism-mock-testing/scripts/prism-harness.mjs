#!/usr/bin/env node
// Harness helper for the prism-mock-testing skill. Wraps globalThis.fetch so a
// client under test drives the Prism mock while this records the exact wire
// bodies of the requests the skill cares about. Spec-agnostic: the caller
// supplies the base URL, any auth the spec declares, and any URL rewriting.
//
//   import { harness } from './prism-harness.mjs'
//   const h = harness({
//     base: 'http://127.0.0.1:13000',
//     // Point the client's real base URL at the mock (any scheme, any path).
//     rewriteUrl: (url) => url.replace('https://api.example.com', base),
//     // Auth the spec's securitySchemes declares — Bearer, apiKey header/query, etc.
//     auth: (headers, url) => { headers.set('Authorization', `Bearer ${token}`) }, // url is a URL object for query keys
//     watch: ['/applications/private-github-app'],
//     transformBody: (body) => {            // optional: adjust the outgoing body
//       if (!body.environment_name) body.environment_name = 'prod' // satisfy a spec-required field
//       return body
//     },
//   })
//
//   await runTheThingUnderTest()
//   const last = h.route(h.seen, '/applications/private-github-app').at(-1)
//   if (last?.body?.custom_network_aliases !== 'api,backend') {
//     throw new Error('clone did not carry custom_network_aliases')
//   }
//   h.restore()

/**
 * Wrap globalThis.fetch so a client under test talks to a Prism mock instead
 * of the real API, recording the wire bodies of the requests we watch.
 *
 * Works with any OpenAPI spec: the caller supplies how to reach the mock
 * (`base` + `rewriteUrl`), how to authenticate (`auth`), and which bodies to
 * record (`watch` + `transformBody`).
 *
 * @param {object} opts
 * @param {string} [opts.base='http://127.0.0.1:13000'] Prism mock base URL.
 * @param {(url: string) => string} [opts.rewriteUrl] Map a client request URL to
 *   the mock. The default only prepends `base` to relative URLs. Clients that
 *   target a real API host need an explicit rewrite, e.g.
 *   `(url) => url.replace('https://api.example.com', base)`; clients that go
 *   through a proxy prefix need the prefix stripped, e.g.
 *   `(url) => url.replace('/api/coolify', '')`.
 * @param {(headers: Headers, url: URL) => void} [opts.auth] Apply the spec's
 *   security scheme to the outgoing request: set headers (Bearer, apiKey) or
 *   mutate the URL object (apiKey in query). No auth applied when omitted.
 * @param {string[]} [opts.watch=[]] Path fragments whose request bodies to record.
 * @param {(body: object) => object | string} [opts.transformBody] Mutate the
 *   outgoing body before it is sent (e.g. inject fields the spec marks required
 *   that the real API treats as optional). Return an object or a JSON string.
 * @returns {{ base: string, seen: Array<{url: string, body: object}>,
 *   route: (records, path) => Array, restore: () => void }}
 */
export function harness({
  base = 'http://127.0.0.1:13000',
  rewriteUrl = null,
  auth = null,
  watch = [],
  transformBody = null,
} = {}) {
  const seen = []
  const original = globalThis.fetch

  const defaultRewrite = (url) =>
    String(url).startsWith('http') ? url : `${base}${url}`

  globalThis.fetch = async (url, init) => {
    let target = (rewriteUrl ?? defaultRewrite)(String(url))
    // A rewrite that produces a relative path (e.g. a proxy prefix stripped
    // without prepending the base) is a caller slip — make it absolute so
    // fetch can parse it.
    if (!target.startsWith('http')) target = `${base}${target}`
    const parsedTarget = new URL(target)
    let body = init?.body
    if (watch.some((p) => target.includes(p)) && typeof body === 'string') {
      const parsed = JSON.parse(body)
      const next = transformBody ? transformBody(parsed) : parsed
      const out = typeof next === 'string' ? JSON.parse(next) : next
      body = JSON.stringify(out)
      seen.push({ url: target, body: out })
    }
    const headers = new Headers(init?.headers)
    if (auth) auth(headers, parsedTarget)
    return original(parsedTarget.toString(), { ...init, body, headers })
  }

  return {
    base,
    seen,
    /** Requests recorded for a watched path (in order). */
    route: (records, path) => records.filter((r) => r.url.includes(path)),
    /** Restore the original fetch. */
    restore() {
      globalThis.fetch = original
    },
  }
}
