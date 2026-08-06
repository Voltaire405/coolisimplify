// Verifies single-clone name resolution and destination filtering without
// contacting a live Coolify instance.
import { describe, expect, it } from 'vitest'
import type { CoolifyClient } from './coolify-client'
import { listTargetResourceNames, resolveCloneName } from './clone'

describe('resolveCloneName', () => {
  it('leaves an available name alone', () => {
    expect(resolveCloneName('Resource', [])).toBe('Resource')
    expect(resolveCloneName('Resource', ['Other'])).toBe('Resource')
  })

  it('follows the documented copy sequence once the name is taken', () => {
    expect(resolveCloneName('Resource', ['Resource'])).toBe('Resource-copy')
    expect(resolveCloneName('Resource', ['Resource', 'Resource-copy'])).toBe(
      'Resource-copy-1',
    )
    expect(
      resolveCloneName('Resource', [
        'Resource',
        'Resource-copy',
        'Resource-copy-1',
        'Resource-copy-2',
      ]),
    ).toBe('Resource-copy-3')
  })

  it('trims the requested name before comparing', () => {
    expect(resolveCloneName('  Resource  ', ['Resource'])).toBe('Resource-copy')
  })

  it('refuses a blank name', () => {
    expect(() => resolveCloneName('   ', [])).toThrow(/cannot be empty/)
  })
})

describe('listTargetResourceNames', () => {
  const client = {
    listApplications: async () => [
      { name: 'App', environment_id: 7 },
      { name: 'Other environment', environment_id: 8 },
    ],
    listServices: async () => [{ name: 'Service', environment_id: 7 }],
    listDatabases: async () => [{ name: 'Database', environment_id: 7 }],
  } as unknown as CoolifyClient

  it('collects every resource type in the destination environment only', () => {
    // A name taken in another environment is not a collision here.
    return expect(listTargetResourceNames(client, 7)).resolves.toEqual(
      new Set(['App', 'Service', 'Database']),
    )
  })

  it('feeds the collision check for the destination', async () => {
    const names = await listTargetResourceNames(client, 7)
    expect(resolveCloneName('App', names)).toBe('App-copy')
  })

  // Silently treating an unreadable listing as empty would let the clone reuse
  // a name that is already taken, which Coolify then rejects.
  it('propagates a failure instead of reporting an empty environment', async () => {
    await expect(
      listTargetResourceNames(
        {
          ...client,
          listServices: async () => Promise.reject(new Error('offline')),
        } as unknown as CoolifyClient,
        7,
      ),
    ).rejects.toThrow(/offline/)
  })
})
