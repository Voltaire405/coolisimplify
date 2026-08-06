// The proxy is the only place the Coolify token is handled server-side: the
// browser sends it as a header, the route turns it into an Authorization bearer
// and forwards the call. A mistake here either breaks every request at once or
// leaks the credential, so this exercises the real handlers against a real
// upstream rather than asserting on the source.
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DELETE, GET, PATCH, POST, PUT } from './route'

interface Seen {
  method: string
  url: string
  authorization?: string
  accept?: string
  body: string
}

let upstream: ReturnType<typeof createServer>
let upstreamUrl: string
let seen: Seen[] = []
/** Overridden per test to script the upstream's answer. */
let respond: (req: IncomingMessage) => {
  status: number
  body: string
  contentType?: string
}

beforeAll(async () => {
  respond = () => ({ status: 200, body: '{"ok":true}' })
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: req.headers.authorization,
        accept: req.headers.accept,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      const out = respond(req)
      res.writeHead(out.status, {
        'Content-Type': out.contentType ?? 'application/json',
      })
      res.end(out.body)
    })
  })
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    upstream.close((err) => (err ? reject(err) : resolve())),
  )
})

const TOKEN = 'super-secret-token'

function request(
  path: string,
  init: { method?: string; body?: string; url?: string; token?: string } = {},
) {
  const headers = new Headers()
  if (init.url !== null) headers.set('x-coolify-url', init.url ?? upstreamUrl)
  if (init.token !== null) headers.set('x-coolify-token', init.token ?? TOKEN)
  return new NextRequest(`http://localhost/api/coolify${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body,
  })
}

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) })

describe('credentials', () => {
  it('refuses without an instance URL', async () => {
    const headers = new Headers({ 'x-coolify-token': TOKEN })
    const res = await GET(
      new NextRequest('http://localhost/api/coolify/projects', { headers }),
      ctx(['projects']),
    )
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      message: expect.stringContaining('Configure in settings'),
    })
  })

  it('refuses without a token', async () => {
    const headers = new Headers({ 'x-coolify-url': upstreamUrl })
    const res = await GET(
      new NextRequest('http://localhost/api/coolify/projects', { headers }),
      ctx(['projects']),
    )
    expect(res.status).toBe(401)
  })

  it('does not reach the instance when credentials are missing', async () => {
    seen = []
    const headers = new Headers()
    await GET(
      new NextRequest('http://localhost/api/coolify/projects', { headers }),
      ctx(['projects']),
    )
    expect(seen).toHaveLength(0)
  })

  it('forwards the token as a bearer, never echoing it back to the browser', async () => {
    seen = []
    const res = await GET(request('/projects'), ctx(['projects']))
    expect(seen[0]!.authorization).toBe(`Bearer ${TOKEN}`)
    // Whatever the instance says, the credential must not travel back out.
    expect(await res.text()).not.toContain(TOKEN)
    expect(JSON.stringify([...res.headers])).not.toContain(TOKEN)
  })
})

describe('forwarding', () => {
  it('rebuilds the path under the instance API prefix', async () => {
    seen = []
    await GET(
      request('/applications/a1/envs'),
      ctx(['applications', 'a1', 'envs']),
    )
    expect(seen[0]!.url).toBe('/api/v1/applications/a1/envs')
  })

  it('carries the query string through untouched', async () => {
    seen = []
    await GET(
      request('/applications/a1/logs?lines=500&show_timestamps=true'),
      ctx(['applications', 'a1', 'logs']),
    )
    expect(seen[0]!.url).toBe(
      '/api/v1/applications/a1/logs?lines=500&show_timestamps=true',
    )
  })

  it('tolerates a trailing slash on the configured instance URL', async () => {
    seen = []
    await GET(
      request('/projects', { url: `${upstreamUrl}/` }),
      ctx(['projects']),
    )
    // Without the strip this would request `//api/v1/projects`.
    expect(seen[0]!.url).toBe('/api/v1/projects')
  })

  it('forwards a body on the methods that carry one', async () => {
    for (const [handler, method] of [
      [POST, 'POST'],
      [PATCH, 'PATCH'],
      [PUT, 'PUT'],
    ] as const) {
      seen = []
      await handler(
        request('/projects', { method, body: '{"name":"x"}' }),
        ctx(['projects']),
      )
      expect(seen[0]!.method).toBe(method)
      expect(seen[0]!.body).toBe('{"name":"x"}')
    }
  })

  it('sends DELETE through without a body', async () => {
    seen = []
    await DELETE(
      request('/projects/p1', { method: 'DELETE' }),
      ctx(['projects', 'p1']),
    )
    expect(seen[0]!.method).toBe('DELETE')
    expect(seen[0]!.body).toBe('')
  })
})

describe('responses', () => {
  it('passes the instance status and body straight back', async () => {
    respond = () => ({ status: 422, body: '{"message":"Validation failed."}' })
    const res = await POST(
      request('/projects', { method: 'POST', body: '{}' }),
      ctx(['projects']),
    )
    // Collapsing an upstream error into a 200 would make the client treat a
    // rejected write as applied.
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ message: 'Validation failed.' })
    respond = () => ({ status: 200, body: '{"ok":true}' })
  })

  // The dashboard polls status; a cached answer would show a resource as
  // running long after it stopped.
  it('marks every answer as uncacheable', async () => {
    const res = await GET(request('/projects'), ctx(['projects']))
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('pragma')).toBe('no-cache')
  })

  it('preserves the upstream content type', async () => {
    respond = () => ({ status: 200, body: 'plain', contentType: 'text/plain' })
    const res = await GET(request('/projects'), ctx(['projects']))
    expect(res.headers.get('content-type')).toBe('text/plain')
    respond = () => ({ status: 200, body: '{"ok":true}' })
  })

  it('answers 502 with the reason when the instance is unreachable', async () => {
    const res = await GET(
      // Port 1 on localhost: refused immediately, no waiting on a timeout.
      request('/projects', { url: 'http://127.0.0.1:1' }),
      ctx(['projects']),
    )
    expect(res.status).toBe(502)
    const body = (await res.json()) as { message: string }
    expect(body.message).toBeTruthy()
    expect(body.message).not.toContain(TOKEN)
  })
})
