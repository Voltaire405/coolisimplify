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

const STOPPED = [
  'exited',
  'stopped',
  'finished',
  'cancelled-by-user',
  'never deployed',
  'never-deployed',
  'not deployed',
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
