// Every call the app makes goes through this client, so two things have to hold
// whatever endpoint is involved: the request must be shaped the way Coolify
// expects (path per resource type, options as query params, credentials in the
// proxy headers), and a non-2xx response must surface the reason rather than a
// bare status code. Coolify puts the useful part of a 422 in `errors`, one entry
// per offending field, and leaves `message` as a generic "Validation failed." —
// dropping that leaves the field name visible only in DevTools.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startFakeCoolify, type FakeCoolify, type FakeReply } from '../test/fake-coolify'

let fake: FakeCoolify
/** Set per test; the server answers with whatever this returns. */
let reply: (req: { method: string; pathname: string }) => FakeReply | undefined

beforeEach(async () => {
  reply = () => ({ body: {} })
  fake = await startFakeCoolify((req) => reply(req))
})
afterEach(async () => {
  await fake.close()
})

const lastRequest = () => fake.requests[fake.requests.length - 1]!

describe('request shape', () => {
  it('sends the instance URL and token as proxy headers, not in the path', async () => {
    await fake.client.listProjects()
    const req = lastRequest()
    expect(req.headers['x-coolify-url']).toBe(fake.base)
    expect(req.headers['x-coolify-token']).toBe('test-token')
    expect(req.headers['content-type']).toBe('application/json')
    // The token must never end up somewhere a proxy log would keep it.
    expect(req.pathname + req.search).not.toContain('test-token')
  })

  it('routes each resource type to its own env collection', async () => {
    reply = () => ({ body: [] })
    await fake.client.listEnvsFor('application', 'a1')
    expect(lastRequest().pathname).toBe('/applications/a1/envs')
    await fake.client.listEnvsFor('service', 's1')
    expect(lastRequest().pathname).toBe('/services/s1/envs')
    await fake.client.listEnvsFor('database', 'd1')
    expect(lastRequest().pathname).toBe('/databases/d1/envs')
  })

  // ADR-0003: Coolify has no PATCH on the item path; updates go to the
  // collection and are routed by `key`.
  it('updates an env var through the collection and deletes through the item', async () => {
    await fake.client.updateEnv('service', 's1', { key: 'K', value: 'v' })
    expect(lastRequest().method).toBe('PATCH')
    expect(lastRequest().pathname).toBe('/services/s1/envs')
    expect(JSON.parse(lastRequest().body)).toEqual({ key: 'K', value: 'v' })

    await fake.client.deleteEnv('service', 's1', 'e1')
    expect(lastRequest().method).toBe('DELETE')
    expect(lastRequest().pathname).toBe('/services/s1/envs/e1')
  })

  it('sends delete options as query params, omitting the ones not given', async () => {
    await fake.client.deleteApplication('a1', {
      delete_volumes: true,
      docker_cleanup: false,
    })
    const q = lastRequest().query
    expect(q.get('delete_volumes')).toBe('true')
    expect(q.get('docker_cleanup')).toBe('false')
    // An option the caller never set must not be sent as a guess — Coolify
    // would apply our default instead of its own.
    expect(q.has('delete_configurations')).toBe(false)
    expect(q.has('delete_connected_networks')).toBe(false)
  })

  it('sends no query string at all when there are no options', async () => {
    await fake.client.deleteApplication('a1')
    expect(lastRequest().search).toBe('')
  })

  it('passes the logs knobs through', async () => {
    reply = () => ({ body: { logs: '' } })
    await fake.client.getApplicationLogs('a1', { lines: 500, show_timestamps: true })
    expect(lastRequest().pathname).toBe('/applications/a1/logs')
    expect(lastRequest().query.get('lines')).toBe('500')
    expect(lastRequest().query.get('show_timestamps')).toBe('true')
  })

  it('escapes a tag rather than splicing it raw into the query', async () => {
    reply = () => ({ body: [] })
    await fake.client.listApplications('a tag&x=1')
    expect(lastRequest().query.get('tag')).toBe('a tag&x=1')
  })

  it('strips a trailing slash from the configured instance URL', async () => {
    const { CoolifyClient } = await import('./coolify-client')
    const client = new CoolifyClient({ baseUrl: `${fake.base}/`, token: 't' })
    await client.listProjects()
    expect(lastRequest().headers['x-coolify-url']).toBe(fake.base)
  })
})

describe('response handling', () => {
  it('returns undefined for a 204 instead of trying to parse a body', async () => {
    reply = () => ({ status: 204, raw: '' })
    await expect(fake.client.deleteProject('p1')).resolves.toBeUndefined()
  })

  // The spec documents a bare array; the instance returns `{ count, deployments }`.
  // Trusting the document would leave the build-log view permanently empty.
  it('unwraps the deployment-history envelope the instance really returns', async () => {
    reply = () => ({
      body: {
        count: 2,
        deployments: [
          { deployment_uuid: 'dep-1', status: 'failed' },
          { deployment_uuid: 'dep-0', status: 'finished' },
        ],
      },
    })
    const history = await fake.client.listApplicationDeployments('a1', { take: 2 })
    expect(Array.isArray(history)).toBe(true)
    expect(history).toHaveLength(2)
    // Newest first, as the instance returns them.
    expect(history[0]!.deployment_uuid).toBe('dep-1')
  })

  it('still accepts the bare array the spec documents', async () => {
    reply = () => ({ body: [{ deployment_uuid: 'dep-1' }] })
    await expect(
      fake.client.listApplicationDeployments('a1'),
    ).resolves.toHaveLength(1)
  })

  it('reports an empty history rather than throwing on an unexpected shape', async () => {
    reply = () => ({ body: { count: 0 } })
    await expect(fake.client.listApplicationDeployments('a1')).resolves.toEqual([])
  })
})

describe('error surfacing', () => {
  it('surfaces the API message on a 404', async () => {
    reply = () => ({ status: 404, body: { message: 'Application not found.' } })
    await expect(fake.client.getApplication('nope')).rejects.toThrow(
      'Application not found.',
    )
  })

  it('surfaces the API message on a 409 conflict', async () => {
    reply = () => ({
      status: 409,
      body: { message: 'Resource name already taken.' },
    })
    await expect(
      fake.client.createProject({ name: 'dup' }),
    ).rejects.toThrow('Resource name already taken.')
  })

  // Without this the user sees "Validation failed." and has no idea which field.
  it('names the offending fields on a 422', async () => {
    reply = () => ({
      status: 422,
      body: {
        message: 'Validation failed.',
        errors: {
          ports_exposes: ['The ports exposes field is required.'],
          name: ['Already taken.', 'Too long.'],
        },
      },
    })
    const err = await fake.client
      .createProject({ name: '' })
      .catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('Validation failed.')
    expect((err as Error).message).toContain(
      'ports_exposes: The ports exposes field is required.',
    )
    // Several complaints about one field are joined, not truncated to the first.
    expect((err as Error).message).toContain('name: Already taken. Too long.')
  })

  it('handles a non-array detail without printing [object Object]', async () => {
    reply = () => ({
      status: 422,
      body: { message: 'Validation failed.', errors: { name: 'Already taken.' } },
    })
    await expect(fake.client.createProject({ name: '' })).rejects.toThrow(
      'name: Already taken.',
    )
  })

  it('falls back to the status when the body carries no message', async () => {
    reply = () => ({ status: 500, body: {} })
    await expect(fake.client.listProjects()).rejects.toThrow('HTTP 500')
  })

  // A gateway returning an HTML error page must not crash the parse and hide
  // the failure behind a TypeError.
  it('does not blow up on an error body that is not JSON', async () => {
    reply = () => ({
      status: 502,
      raw: '<html>Bad Gateway</html>',
      contentType: 'text/html',
    })
    await expect(fake.client.listProjects()).rejects.toThrow(Error)
  })

  it('does not swallow a failed 422 into a resolved promise', async () => {
    reply = () => ({ status: 422, body: { message: 'nope' } })
    // A rejected create that resolved would report a clone as done.
    await expect(fake.client.createProject({ name: 'x' })).rejects.toThrow()
  })
})
