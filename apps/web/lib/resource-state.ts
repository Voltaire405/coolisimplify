// Classification of resource status strings (Coolify returns a free-form
// string, e.g. "running", "running (healthy)", "exited (0)", "deploying",
// "stopped..."), plus which actions make sense for each state.

export type ResourceState =
  | 'running'
  | 'transitioning'
  | 'stopped'
  | 'error'
  | 'unknown'

export type ResourceAction = 'start' | 'stop' | 'restart' | 'deploy' | 'delete'

export const RESOURCE_STATE_LABEL: Record<ResourceState, string> = {
  running: 'Running',
  transitioning: 'Transitioning',
  stopped: 'Stopped',
  error: 'Error',
  unknown: 'Unknown',
}

const TRANSITIONING = [
  'starting',
  'restarting',
  'stopping',
  'deploying',
  'building',
  'queued',
  'pending',
  'updating',
  'in progress',
  'deployment in progress',
]

// A resource that never got a container. Kept separate from the rest of
// STOPPED because for logs the two are opposites: an `exited` container still
// holds the crash trace, a never-deployed one has nothing to read at all.
const NEVER_DEPLOYED = ['never deployed', 'never-deployed', 'not deployed']

const STOPPED = [
  'exited',
  'stopped',
  'finished',
  'cancelled-by-user',
  ...NEVER_DEPLOYED,
]

const ERROR = ['error', 'failed', 'failure', 'unhealthy']

export function classifyResourceState(status?: string | null): ResourceState {
  if (!status) return 'unknown'
  const s = status.toLowerCase().trim()

  if (s.startsWith('running')) return 'running'
  if (s === 'started' || s === 'active' || s === 'healthy') return 'running'

  if (
    TRANSITIONING.some((t) => s.startsWith(t) || s.includes(t))
  ) {
    return 'transitioning'
  }
  if (STOPPED.some((t) => s.startsWith(t))) return 'stopped'
  if (ERROR.some((t) => s.startsWith(t))) return 'error'

  return 'unknown'
}

/**
 * True only when Coolify says the resource has never been deployed. Used to
 * gate the logs viewer: every other state — including `exited` and `stopped` —
 * may still have a container whose output is worth reading, and an unknown or
 * missing status is not evidence of absence, so it stays readable.
 */
export function isNeverDeployed(status?: string | null): boolean {
  if (!status) return false
  const s = status.toLowerCase().trim()
  return NEVER_DEPLOYED.some((t) => s.startsWith(t))
}

// Status Roll-up: the worst descendant state, shown as a LED on Sidebar
// nodes. Severity: problem (stopped/error) > transitioning > running > none.
export type RollupState = 'problem' | 'transitioning' | 'running' | 'none'

const ROLLUP_SEVERITY: Record<RollupState, number> = {
  problem: 3,
  transitioning: 2,
  running: 1,
  none: 0,
}

export function worseRollup(a: RollupState, b: RollupState): RollupState {
  return ROLLUP_SEVERITY[a] >= ROLLUP_SEVERITY[b] ? a : b
}

export function rollupFromStatus(status?: string | null): RollupState {
  const state = classifyResourceState(status)
  if (state === 'stopped' || state === 'error') return 'problem'
  if (state === 'transitioning') return 'transitioning'
  if (state === 'running') return 'running'
  return 'none'
}

export function canRunAction(
  action: ResourceAction,
  status?: string | null,
): boolean {
  switch (action) {
    case 'start':
      return ['stopped', 'unknown', 'error'].includes(
        classifyResourceState(status),
      )
    case 'stop':
      return ['running', 'unknown', 'error'].includes(
        classifyResourceState(status),
      )
    // restart / deploy need a resource that is up (or up enough to retry
    // after a failed deploy); pointless against a stopped or transitioning one.
    case 'restart':
    case 'deploy':
      return ['running', 'error'].includes(classifyResourceState(status))
    case 'delete':
      return true
  }
}
