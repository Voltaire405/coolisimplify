---
name: prism-mock-testing
description: Test a client against a Prism mock server built from an OpenAPI spec. Use when the user wants to test against a mock API, drive a client or harness through an OpenAPI spec, verify request payloads or 422 behavior against a spec, or when a task needs a local fake of a REST API for fast, deterministic testing.
---

# Prism Mock Testing

Test a client or harness against a Prism mock server built from an OpenAPI spec — no real backend needed. Prism validates requests against the spec's schemas and returns example responses, so it is a fast, deterministic stand-in for the real API. The process and the `scripts/prism-harness.mjs` helper work against any OpenAPI spec; the caller supplies the spec-specific parts (base URL, auth, URL rewriting, which bodies to watch).

## 1. Boot the mock

Find the spec file (commonly `*.yaml` or `*.json` at the repo root or `docs/`). Pick a free port.

```sh
prism mock <spec> --port 13000 --cors --multiprocess=false
```

- `--multiprocess=false` avoids a `createMultiProcessPrism` crash on some machines (the default forks).
- Prism listens on `http://127.0.0.1:13000`. The spec's `servers` may point elsewhere; hit the `127.0.0.1` base directly.

**Done when:** Prism prints a route list ending in `Prism is listening on http://127.0.0.1:<port>`. A crash means add `--multiprocess=false`; a taken port means pick another.

## 2. Drive the client at it

Point the client under test at the mock base URL, and give it the auth the spec declares — check `securitySchemes`:

- `http` + `bearer` → `Authorization: Bearer <anything>` (Prism accepts any token when the body is valid).
- `apiKey` → send the key in the header or query parameter the spec names.
- `oauth2`/`openIdConnect` → Prism accepts a token in `Authorization: Bearer` when present.

Use the harness's `auth(headers, url)` seam so any scheme works — set the header, or mutate the URL for query keys. Use `rewriteUrl` to point a client that targets a real API host (or a proxy prefix) at the mock base.

## 3. Make it red-capable

Assert on the **request** the client sends, not just the response. Use the harness's fetch spy to capture outgoing bodies, or an HTTP proxy. Assert the exact fields the bug or feature cares about — e.g. `payload.some_field === 'expected'` — and that the mock returned the expected status.

Prism with default `--errors=false` does **not** reject unknown fields or missing-optional fields — it validates only the spec's `required` and returns example responses. So:

- A request that violates `required` → Prism returns 400/422 with a validation error. This is a real signal.
- A request with an **unknown** field → Prism still returns 201. To catch unknown-field leaks, pair Prism with a schema check (build the payload, validate against the create schema + a manual allowlist).

**Done when:** one command goes red on the bug and green once fixed, and you have run it at least once red. If Prism can't produce that signal alone (e.g. it doesn't 422 on unknown fields), the harness asserts the wire body directly.

## 4. Stop the mock

Stop the mock server when tests finish — leave no port occupied.

```sh
kill <prism-pid>   # or the background-task stop of your shell
```

**Done when:** no listener remains on the port (`lsof -i :<port>` shows nothing).

## The harness

`scripts/prism-harness.mjs` wraps `globalThis.fetch`, rewrites URLs onto the mock base, applies the spec's auth, and records watched request bodies. It is spec-agnostic; supply the spec-specific parts as options:

```js
import { harness } from './scripts/prism-harness.mjs'
const h = harness({
  base: 'http://127.0.0.1:13000',
  rewriteUrl: (url) => url.replace('https://api.example.com', base), // point a real-API client at the mock (keep it absolute)
  auth: (headers) => headers.set('Authorization', `Bearer ${token}`), // any securityScheme
  watch: ['/path/to/endpoint'],
  transformBody: (body) => body, // optional: inject fields the spec marks required that the real API treats as optional
})
await runTheThingUnderTest()
const last = h.route(h.seen, '/path/to/endpoint').at(-1)
if (last?.body?.field !== 'expected') throw new Error('field not sent')
h.restore()
```

## Worked example

A full, runnable example against this repo's Coolify spec (the clone flow
carrying `custom_network_aliases`) is in
[references/coolisimplify-example.md](references/coolisimplify-example.md).
Read it when the task touches this repo's clone/API flows. For any other spec,
apply the same four steps with the spec's own base URL, auth, and endpoints.
