// Decides whether a dispatched action actually succeeded.
//
// Why this is a module and not a closure inside the page: the verdict used to
// be derived inline from the container `status` alone, which cannot tell a
// successful deployment from a failed one. While a build runs — and after it
// fails — Coolify leaves the *previous* container up and still reporting
// `running:healthy`, so both outcomes produce an identical status stream and
// every failed deploy was reported as done.
//
// The authoritative signal is the deployment record itself
// (`GET /deployments/{uuid}`, status `queued|in_progress|finished|failed|
// cancelled-by-user`), reachable via the `deployment_uuid` that start/restart
// already return. Container status stays as the fallback for Services and
// Databases, whose endpoints return no deployment handle.

import { classifyResourceState } from './resource-state'

export type DeploymentOutcome = 'pending' | 'succeeded' | 'failed' | 'cancelled'

// Terminal values are pinned by the API's own error text: "Deployment cannot be
// cancelled. Current status: finished" / "(already finished/failed/cancelled)".
const DEPLOYMENT_SUCCEEDED = ['finished']
const DEPLOYMENT_FAILED = ['failed', 'error']
const DEPLOYMENT_CANCELLED = ['cancelled-by-user', 'cancelled', 'canceled']

export function classifyDeploymentStatus(
  status?: string | null,
): DeploymentOutcome {
  if (!status) return 'pending'
  const s = status.toLowerCase().trim()
  if (DEPLOYMENT_SUCCEEDED.includes(s)) return 'succeeded'
  if (DEPLOYMENT_FAILED.includes(s)) return 'failed'
  if (DEPLOYMENT_CANCELLED.includes(s)) return 'cancelled'
  // queued / in_progress, and anything Coolify adds later: not terminal, so
  // keep waiting rather than guessing.
  return 'pending'
}

export function isTerminalOutcome(outcome: DeploymentOutcome): boolean {
  return outcome !== 'pending'
}

/**
 * Whether a deployment record says the job itself completed. Callers use this
 * to stamp the moment the build ended, which is where the container's grace
 * window starts — see `sinceFinishedMs`. Exported so the two call sites do not
 * each re-derive "is this `finished`?" from the raw string.
 */
export function isDeploymentFinished(status?: string | null): boolean {
  return classifyDeploymentStatus(status) === 'succeeded'
}

/**
 * A container that came up but whose healthcheck is failing. Coolify reports
 * this as `running (unhealthy)`, which `classifyResourceState` folds into
 * `running` — correct for the status LED, wrong as proof a deploy worked.
 */
export function isUnhealthy(status?: string | null): boolean {
  return !!status && status.toLowerCase().includes('unhealthy')
}

export type Verdict = 'waiting' | 'succeeded' | 'failed'

export interface VerdictInput {
  action: 'start' | 'stop' | 'restart' | 'deploy' | 'delete'
  /** Whether the resource is still in the listing (for `delete`). */
  resourcePresent: boolean
  /** `status` from the resource listing, i.e. the container. */
  containerStatus?: string | null
  /** `status` from `GET /deployments/{uuid}`, when a handle was returned. */
  deploymentStatus?: string | null
  elapsedMs: number
  /**
   * Milliseconds since the deployment was *first observed* `finished`. The
   * container's grace window is measured from here, not from `elapsedMs`:
   * the build is what took the time, and the new container only starts
   * existing when the build ends. Absent (or 0) means "just finished".
   */
  sinceFinishedMs?: number
}

/**
 * Grace period after a deployment reports `finished`, allowing the resource
 * listing to catch up before its container status is held against it. Also the
 * minimum age before a container-only verdict is trusted at all.
 */
export const CONVERGENCE_GRACE_MS = 8_000

/**
 * How long the new container may take to come up after the build reported
 * `finished` before its state is held against the deploy. Sized for a Docker
 * healthcheck `start_period`, which is commonly 30–60 s: 8 s is a refetch lag,
 * not a boot.
 */
export const POST_DEPLOY_GRACE_MS = 60_000

export function judgeAction(input: VerdictInput): Verdict {
  const { action, resourcePresent, containerStatus, elapsedMs } = input

  if (action === 'delete') {
    return resourcePresent ? 'waiting' : 'succeeded'
  }
  if (!resourcePresent) return 'waiting'

  const state = classifyResourceState(containerStatus)

  // --- authoritative path: we hold a deployment handle ---------------------
  const outcome = classifyDeploymentStatus(input.deploymentStatus)
  if (input.deploymentStatus != null) {
    if (outcome === 'failed' || outcome === 'cancelled') return 'failed'
    if (outcome === 'pending') return 'waiting'
    // `finished` means the job completed, not that the container survived it:
    // a container that exits or stays unhealthy right after is still a broken
    // deploy.
    if (state === 'running' && !isUnhealthy(containerStatus)) return 'succeeded'

    // The window runs from `finished`, not from dispatch. Measured from
    // dispatch it was already spent by the time any real build ended, so the
    // first poll that caught the new container mid-boot — `starting`, or
    // unhealthy inside its healthcheck's start period — called a working
    // deploy failed.
    if ((input.sinceFinishedMs ?? 0) < POST_DEPLOY_GRACE_MS) return 'waiting'

    // Past the window, the same rule as everywhere else: only positive
    // evidence counts. A dead container (`exited`, `error`) is a failure; one
    // still transitioning or still unhealthy is unresolved, so it keeps
    // waiting and the caller reports a timeout — an unknown outcome, not a
    // clean failure.
    if (state === 'stopped' || state === 'error') return 'failed'
    return 'waiting'
  }

  // --- fallback: container status only (Services, Databases) --------------
  if (action === 'stop') return state === 'stopped' ? 'succeeded' : 'waiting'
  if (action === 'start' || action === 'restart' || action === 'deploy') {
    // `starting`/`restarting` classify as transitioning: not there yet. The old
    // judge counted them as active and declared victory mid-flight.
    if (state !== 'running') return 'waiting'
    if (isUnhealthy(containerStatus)) return 'waiting'
    if (action !== 'start' && elapsedMs < CONVERGENCE_GRACE_MS) return 'waiting'
    return 'succeeded'
  }
  return 'waiting'
}

/** Message shown when an action is abandoned without a terminal verdict. */
export function timeoutMessage(action: string): string {
  return `Timed out waiting for ${action} to finish — outcome unknown`
}
