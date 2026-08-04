import type { Resource, ResourceType } from './types'

/** A selectable node in the Sidebar: the All Resources root, a Project, or an Environment. */
export type TreeNode =
  | { kind: 'all' }
  | { kind: 'project'; projectUuid: string }
  | { kind: 'env'; projectUuid: string; envUuid: string }

export const ALL_NODE: TreeNode = { kind: 'all' }

/** localStorage key for the Sidebar's expanded-project set. */
export const TREE_EXPANDED_STORAGE_KEY = 'coolisimplify.sidebar.expanded'

/** Encodes a node for the `?node=` URL param; the All Resources root encodes as null (no param). */
export function encodeNode(node: TreeNode): string | null {
  if (node.kind === 'project') return `project:${node.projectUuid}`
  if (node.kind === 'env') return `env:${node.projectUuid}:${node.envUuid}`
  return null
}

export function decodeNode(raw: string | null): TreeNode {
  if (!raw) return ALL_NODE
  const [kind, projectUuid, envUuid] = raw.split(':')
  if (kind === 'project' && projectUuid) return { kind: 'project', projectUuid }
  if (kind === 'env' && projectUuid && envUuid)
    return { kind: 'env', projectUuid, envUuid }
  return ALL_NODE
}

export function sameNode(a: TreeNode, b: TreeNode): boolean {
  return encodeNode(a) === encodeNode(b)
}

export interface ResourceWithType {
  type: ResourceType
  resource: Resource
}

const TYPE_ORDER: Record<ResourceType, number> = {
  application: 0,
  service: 1,
  database: 2,
}

// Fixed order everywhere: applications first, then services, then databases,
// each block alphabetical. Deliberately not configurable and never reshuffled
// by status, so rows keep a stable spatial anchor.
export function compareResources(a: ResourceWithType, b: ResourceWithType): number {
  const t = TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
  if (t !== 0) return t
  return (a.resource.name || '').localeCompare(b.resource.name || '')
}
