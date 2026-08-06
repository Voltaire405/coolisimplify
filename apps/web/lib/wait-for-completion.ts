import {
  isDeploymentFinished,
  judgeAction,
  type VerdictInput,
} from './deploy-verdict'
import type { ResourceType } from './types'

/**
 * Polls until a dispatched action reaches a **Verdict**, or the budget runs out.
 *
 * This is the only consumer of `judgeAction` — the loop that decides *when* the
 * judge has enough evidence. It lived inside the page component, which made the
 * integration untestable and left the previous check asserting on the page's
 * source text. Its dependencies are parameters rather than a captured client so
 * a spec can drive the clock and the API without a DOM.
 */

export type CompletionOutcome = 'completed' | 'failed' | 'timeout'

/** The subset of a resource listing the verdict actually reads. */
export interface ListedResource {
  uuid: string
  status?: string
}

export interface WaitItem {
  resourceUuid: string
  resourceType: ResourceType
  action: VerdictInput['action']
  /**
   * Handle to the queued Deployment, when Coolify returned one. Without it the
   * verdict falls back to container status, which cannot see a failed build.
   */
  deploymentUuid?: string
}

export interface WaitDeps {
  /**
   * Re-reads the listing for a resource type. Resolving to `undefined` (or
   * rejecting) means *unreadable*, which is not the same as *empty*.
   */
  listResources: (type: ResourceType) => Promise<ListedResource[] | undefined>
  /** Reads a Deployment record. Absent when no client is configured yet. */
  getDeployment?: (uuid: string) => Promise<{ status?: string }>
  /** Injectable clock, so specs need not spend real minutes. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export const POLL_INTERVAL_MS = 3000

/**
 * App deploy runs a full build pipeline; app restart_only is faster but both go
 * through the deployment queue, so give them the long budget.
 */
export function timeoutFor(
  item: Pick<WaitItem, 'resourceType' | 'action'>,
): number {
  const isAppRedeployLike =
    item.resourceType === 'application' &&
    (item.action === 'restart' || item.action === 'deploy')
  if (isAppRedeployLike) return 5 * 60_000
  if (item.action === 'delete') return 60_000
  return 2 * 60_000
}

export async function waitForCompletion(
  item: WaitItem,
  deps: WaitDeps,
): Promise<CompletionOutcome> {
  const now = deps.now ?? Date.now
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  const startedAt = now()
  const deadline = startedAt + timeoutFor(item)
  // When the build reported `finished`. The container gets its grace window
  // from here, because that is when the new container starts existing.
  let finishedAt: number | undefined

  while (now() < deadline) {
    let list: ListedResource[] | undefined
    try {
      list = await deps.listResources(item.resourceType)
    } catch {
      list = undefined
    }
    const resource = list?.find((r) => r.uuid === item.resourceUuid)

    // The deployment record is the only thing that knows whether the build
    // worked; the container keeps reporting the *previous* image until it is
    // replaced, so it looks identical on success and failure.
    let deploymentStatus: string | undefined
    if (item.deploymentUuid && deps.getDeployment) {
      try {
        deploymentStatus = (await deps.getDeployment(item.deploymentUuid)).status
        // Stamp the end of the build once. `finished` is terminal, so a later
        // poll can only re-read the same value — but re-stamping would slide
        // the window forward and it would never close.
        if (finishedAt == null && isDeploymentFinished(deploymentStatus)) {
          finishedAt = now()
        }
      } catch {
        // Transient: fall through and let the next poll retry rather than
        // inventing a verdict from a failed lookup.
      }
    }

    // A listing we could not read is not evidence the resource is gone.
    if (list) {
      const verdict = judgeAction({
        action: item.action,
        resourcePresent: !!resource,
        containerStatus: resource?.status,
        deploymentStatus,
        elapsedMs: now() - startedAt,
        sinceFinishedMs: finishedAt == null ? 0 : now() - finishedAt,
      })
      if (verdict === 'succeeded') return 'completed'
      if (verdict === 'failed') return 'failed'
    }

    if (now() + POLL_INTERVAL_MS >= deadline) break
    await sleep(POLL_INTERVAL_MS)
  }
  return 'timeout'
}
