// A stand-in Coolify instance: a real HTTP server on an ephemeral port, driven
// by a per-test handler.
//
// It is a real server, not a stubbed `fetch`, so what runs is CoolifyClient's
// own request building and response handling — URL shape, query strings, headers
// and the way a non-2xx body becomes an Error message. Stubbing fetch would
// assert our own beliefs about the client instead of exercising it.
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { CoolifyClient } from '@/lib/coolify-client'

export interface FakeRequest {
  method: string
  pathname: string
  search: string
  query: URLSearchParams
  headers: IncomingMessage['headers']
  body: string
}

export interface FakeReply {
  status?: number
  body?: unknown
  /** Raw text, for asserting behaviour on bodies that are not valid JSON. */
  raw?: string
  contentType?: string
}

export type FakeHandler = (req: FakeRequest) => FakeReply | undefined

export interface FakeCoolify {
  base: string
  client: CoolifyClient
  /** Every request the server saw, in order. */
  requests: FakeRequest[]
  close(): Promise<void>
}

const NOT_FOUND: FakeReply = { status: 404, body: { message: 'Not found' } }

export async function startFakeCoolify(
  handler: FakeHandler,
): Promise<FakeCoolify> {
  const requests: FakeRequest[] = []

  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const received: FakeRequest = {
        method: req.method ?? 'GET',
        pathname: url.pathname,
        search: url.search,
        query: url.searchParams,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      requests.push(received)

      const reply = handler(received) ?? NOT_FOUND
      res.writeHead(reply.status ?? 200, {
        'Content-Type': reply.contentType ?? 'application/json',
      })
      res.end(reply.raw ?? JSON.stringify(reply.body ?? null))
    })
  })

  // Port 0: the OS picks a free one, so specs can run in parallel workers
  // without colliding on a fixed port.
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const base = `http://127.0.0.1:${port}`

  // The client fetches `/api/coolify${path}` through the Next proxy route — a
  // relative URL with no origin to resolve against outside a browser. Point
  // that prefix at the fake instance so the client's own request and error
  // handling is what runs here.
  const realFetch = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api\/coolify/, '')
    return realFetch(`${base}${path}`, init)
  }) as typeof fetch

  return {
    base,
    client: new CoolifyClient({ baseUrl: base, token: 'test-token' }),
    requests,
    async close() {
      globalThis.fetch = realFetch
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      )
    },
  }
}
