// Sidebar selection and Drawer target are persisted in the URL, so these codecs
// are what makes a link shareable and a reload land where the user was. They
// also take input a user can type, so a malformed param must degrade to a
// sensible default rather than produce a node that points at nothing.
import { describe, expect, it } from 'vitest'
import type { Resource } from './types'
import {
  ALL_NODE,
  compareResources,
  decodeDrawerTarget,
  decodeNode,
  encodeDrawerTarget,
  encodeNode,
  sameNode,
  type ResourceWithType,
  type TreeNode,
} from './tree'

describe('node codec', () => {
  // All Resources is the default, so it encodes as no param at all rather than
  // as a value that would have to be kept in sync with the decoder.
  it('encodes the All Resources root as no param', () => {
    expect(encodeNode(ALL_NODE)).toBeNull()
  })

  it('round-trips a project and an environment', () => {
    const project: TreeNode = { kind: 'project', projectUuid: 'p1' }
    const env: TreeNode = { kind: 'env', projectUuid: 'p1', envUuid: 'e1' }
    expect(decodeNode(encodeNode(project))).toEqual(project)
    expect(decodeNode(encodeNode(env))).toEqual(env)
  })

  it('falls back to All Resources on a missing or malformed param', () => {
    expect(decodeNode(null)).toEqual(ALL_NODE)
    expect(decodeNode('')).toEqual(ALL_NODE)
    expect(decodeNode('garbage')).toEqual(ALL_NODE)
    // A kind it does not know.
    expect(decodeNode('server:s1')).toEqual(ALL_NODE)
    // Right kind, missing parts — an env node without its environment would
    // select a container that cannot be resolved.
    expect(decodeNode('project:')).toEqual(ALL_NODE)
    expect(decodeNode('env:p1')).toEqual(ALL_NODE)
    expect(decodeNode('env:p1:')).toEqual(ALL_NODE)
  })
})

describe('sameNode', () => {
  it('compares by identity, not by object reference', () => {
    expect(
      sameNode(
        { kind: 'env', projectUuid: 'p1', envUuid: 'e1' },
        { kind: 'env', projectUuid: 'p1', envUuid: 'e1' },
      ),
    ).toBe(true)
    expect(sameNode(ALL_NODE, { kind: 'all' })).toBe(true)
  })

  it('separates the same environment id under different projects', () => {
    expect(
      sameNode(
        { kind: 'env', projectUuid: 'p1', envUuid: 'e1' },
        { kind: 'env', projectUuid: 'p2', envUuid: 'e1' },
      ),
    ).toBe(false)
  })

  it('does not confuse a project with its environment', () => {
    expect(
      sameNode(
        { kind: 'project', projectUuid: 'p1' },
        { kind: 'env', projectUuid: 'p1', envUuid: 'e1' },
      ),
    ).toBe(false)
  })
})

describe('drawer target codec', () => {
  it('round-trips every resource type', () => {
    for (const type of ['application', 'service', 'database'] as const) {
      const target = { type, uuid: 'u1' }
      expect(decodeDrawerTarget(encodeDrawerTarget(target))).toEqual(target)
    }
  })

  // The Drawer is anchored to a Resource; a target that does not name a real
  // type would open a panel with nothing to show.
  it('refuses a target that names no known type', () => {
    expect(decodeDrawerTarget(null)).toBeNull()
    expect(decodeDrawerTarget('')).toBeNull()
    expect(decodeDrawerTarget('u1')).toBeNull()
    expect(decodeDrawerTarget('project:u1')).toBeNull()
    expect(decodeDrawerTarget('application:')).toBeNull()
  })
})

describe('compareResources', () => {
  const item = (type: ResourceWithType['type'], name: string): ResourceWithType => ({
    type,
    resource: { name } as Resource,
  })

  // Fixed order everywhere: applications first, then services, then databases,
  // each block alphabetical. Deliberately never reshuffled by status, so rows
  // keep a stable spatial anchor.
  it('groups by type before sorting by name', () => {
    const sorted = [
      item('database', 'a-db'),
      item('service', 'z-svc'),
      item('application', 'z-app'),
      item('application', 'a-app'),
      item('service', 'a-svc'),
    ]
      .sort(compareResources)
      .map((i) => `${i.type}:${i.resource.name}`)

    expect(sorted).toEqual([
      'application:a-app',
      'application:z-app',
      'service:a-svc',
      'service:z-svc',
      'database:a-db',
    ])
  })

  it('sorts names the way a reader expects, not by code point', () => {
    // A plain `<` comparison puts every uppercase name before every lowercase
    // one, which reads as randomly shuffled.
    const sorted = [item('application', 'beta'), item('application', 'Alpha')]
      .sort(compareResources)
      .map((i) => i.resource.name)
    expect(sorted).toEqual(['Alpha', 'beta'])
  })

  it('tolerates a resource with no name', () => {
    const sorted = [item('application', 'a'), item('application', '')]
      .sort(compareResources)
      .map((i) => i.resource.name)
    expect(sorted).toEqual(['', 'a'])
  })
})
