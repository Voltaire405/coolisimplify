// Verifies single-clone name resolution and destination filtering without
// contacting a live Coolify instance.
//
// Run with: pnpm check:clone-names
import assert from 'node:assert/strict'
import {
  listTargetResourceNames,
  resolveCloneName,
} from '../apps/web/lib/clone.ts'

assert.equal(resolveCloneName('Resource', []), 'Resource')
assert.equal(resolveCloneName('Resource', ['Other']), 'Resource')
assert.equal(resolveCloneName('Resource', ['Resource']), 'Resource-copy')
assert.equal(
  resolveCloneName('Resource', ['Resource', 'Resource-copy']),
  'Resource-copy-1',
)
assert.equal(
  resolveCloneName('Resource', [
    'Resource',
    'Resource-copy',
    'Resource-copy-1',
    'Resource-copy-2',
  ]),
  'Resource-copy-3',
)
assert.equal(resolveCloneName('  Resource  ', ['Resource']), 'Resource-copy')
assert.throws(() => resolveCloneName('   ', []), /cannot be empty/)

const client = {
  listApplications: async () => [
    { name: 'App', environment_id: 7 },
    { name: 'Other environment', environment_id: 8 },
  ],
  listServices: async () => [{ name: 'Service', environment_id: 7 }],
  listDatabases: async () => [{ name: 'Database', environment_id: 7 }],
}
const names = await listTargetResourceNames(client, 7)
assert.deepEqual([...names], ['App', 'Service', 'Database'])
assert.equal(resolveCloneName('App', names), 'App-copy')

await assert.rejects(
  () =>
    listTargetResourceNames(
      { ...client, listServices: async () => Promise.reject(new Error('offline')) },
      7,
    ),
  /offline/,
)

console.log('PASS — single-clone names resolve and destination filtering works')
