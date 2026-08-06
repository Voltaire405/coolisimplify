// The end-to-end half of the deploy-verdict check: same application, same
// action, same container status at every poll — the ONLY difference is how the
// deployment itself ended. Anything judging by container status alone reports
// both as a success, which is exactly what shipped once.
//
// This used to be unreachable: the loop lived inside `app/page.tsx`, so the old
// check could only assert that the file's *source text* mentioned `judgeAction`.
// Now the loop is a module and the scenario runs for real.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startFakeCoolify, type FakeCoolify } from '../test/fake-coolify'
import { POST_DEPLOY_GRACE_MS } from './deploy-verdict'
import {
  POLL_INTERVAL_MS,
  timeoutFor,
  waitForCompletion,
  type ListedResource,
} from './wait-for-completion'

const APP_UUID = 'app-uuid-1'
const DEPLOYMENT_UUID = 'dep-abc123'

/** A clock the spec owns, so a five-minute budget costs no real time. */
function virtualClock() {
  let t = 0
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    },
  }
}

let fake: FakeCoolify | undefined
afterEach(async () => {
  await fake?.close()
  fake = undefined
})

/** Boots a fake instance whose deployment ends the given way. */
async function bootInstance(deploymentStatus: string) {
  fake = await startFakeCoolify((req) => {
    if (req.method === 'POST' && req.pathname === `/applications/${APP_UUID}/start`) {
      // What Coolify actually answers: the request was *queued*. Nothing here
      // says anything about the outcome.
      return {
        body: {
          message: 'Deployment request queued.',
          deployment_uuid: DEPLOYMENT_UUID,
        },
      }
    }
    if (req.method === 'GET' && req.pathname === '/applications') {
      // Identical in both scenarios: the old container never stops being
      // healthy, because Coolify leaves it untouched while the build runs and
      // after it explodes.
      return {
        body: [
          {
            uuid: APP_UUID,
            name: 'api',
            status: 'running:healthy',
            build_pack: 'nixpacks',
          },
        ],
      }
    }
    if (req.method === 'GET' && req.pathname === `/deployments/${DEPLOYMENT_UUID}`) {
      return {
        body: {
          deployment_uuid: DEPLOYMENT_UUID,
          status: deploymentStatus,
          logs: '[]',
        },
      }
    }
    return undefined
  })
  return fake
}

/** Dispatches a deploy and polls it out, exactly as the page does. */
async function runDeploy(instance: FakeCoolify) {
  const start = await instance.client.startApplication(APP_UUID)
  const clock = virtualClock()
  return waitForCompletion(
    {
      resourceUuid: APP_UUID,
      resourceType: 'application',
      action: 'deploy',
      deploymentUuid: start.deployment_uuid,
    },
    {
      listResources: () =>
        instance.client.listApplications() as Promise<ListedResource[]>,
      getDeployment: (uuid) => instance.client.getDeployment(uuid),
      ...clock,
    },
  )
}

describe('a deploy driven against a fake instance', () => {
  it('reports a failed deployment as failed', async () => {
    // Build explodes at ~40s (bad Dockerfile, failing test, registry auth).
    const instance = await bootInstance('failed')
    await expect(runDeploy(instance)).resolves.toBe('failed')
  })

  it('reports a successful deployment as completed', async () => {
    const instance = await bootInstance('finished')
    await expect(runDeploy(instance)).resolves.toBe('completed')
  })

  it('does not give a broken deploy and a working one the same answer', async () => {
    // If these ever agree, the app clears the pending pill and drops the
    // Redeploy-needed chip (ADR-0005) for a change that was never applied.
    const failed = await runDeploy(await bootInstance('failed'))
    await fake?.close()
    fake = undefined
    const succeeded = await runDeploy(await bootInstance('finished'))
    expect(failed).not.toBe(succeeded)
  })

  it('actually consults the deployment record', async () => {
    const instance = await bootInstance('failed')
    await runDeploy(instance)
    const queries = instance.requests.filter((r) =>
      r.pathname.startsWith('/deployments/'),
    )
    expect(queries.length).toBeGreaterThan(0)
  })
})

// The mirror image of the bug above, and the one that shipped after it: a
// deploy that WORKED, reported as failed. What the specs above never exercise
// is a build slow enough to matter — they hold the container at
// `running:healthy` for the whole run, so the container is never observed
// mid-boot. In reality Coolify replaces the container the moment the build
// ends, and the replacement spends its first seconds `starting` or failing its
// healthcheck. The grace window used to run from dispatch, so a 90-second
// build had already spent it, and the first poll after `finished` saw a
// booting container and called the deploy failed.
describe('a slow but successful deploy', () => {
  /**
   *   t <  90s  build running   → `in_progress`, OLD container still healthy
   *   t >= 90s  build finished  → `finished`, NEW container coming up
   *   t >= 102s new container passes its healthcheck
   */
  function slowDeploy(bootingStatus: string) {
    const clock = virtualClock()
    return {
      clock,
      deps: {
        listResources: async (): Promise<ListedResource[]> => {
          const t = clock.now()
          const status =
            t < 90_000
              ? 'running:healthy'
              : t < 102_000
                ? bootingStatus
                : 'running:healthy'
          return [{ uuid: APP_UUID, status }]
        },
        getDeployment: async () => ({
          status: clock.now() < 90_000 ? 'in_progress' : 'finished',
        }),
        ...clock,
      },
    }
  }

  const deploy = (bootingStatus: string) => {
    const { clock, deps } = slowDeploy(bootingStatus)
    return {
      clock,
      outcome: waitForCompletion(
        {
          resourceUuid: APP_UUID,
          resourceType: 'application',
          action: 'deploy',
          deploymentUuid: DEPLOYMENT_UUID,
        },
        deps,
      ),
    }
  }

  it('is not called a failure because the new container is still starting', async () => {
    await expect(deploy('starting').outcome).resolves.toBe('completed')
  })

  it('is not called a failure because the healthcheck has not passed yet', async () => {
    await expect(deploy('running:unhealthy').outcome).resolves.toBe('completed')
  })

  it('still fails a build that finished onto a container that then died', async () => {
    // The window must not swallow a real failure: it delays the verdict, it
    // does not waive it. A container that exits after the build is the
    // crash-on-boot case (bad migration, port taken) — a broken deploy.
    const clock = virtualClock()
    const outcome = await waitForCompletion(
      {
        resourceUuid: APP_UUID,
        resourceType: 'application',
        action: 'deploy',
        deploymentUuid: DEPLOYMENT_UUID,
      },
      {
        listResources: async () => [
          {
            uuid: APP_UUID,
            status: clock.now() < 90_000 ? 'running:healthy' : 'exited (1)',
          },
        ],
        getDeployment: async () => ({
          status: clock.now() < 90_000 ? 'in_progress' : 'finished',
        }),
        ...clock,
      },
    )
    expect(outcome).toBe('failed')
  })

  it('resolves as soon as the container is up, without waiting out the window', async () => {
    // The window bounds how long a *failure* may take to establish; positive
    // evidence still resolves immediately, so a healthy container at t=102s
    // ends the poll there rather than at finished+60s.
    const { clock, outcome } = deploy('starting')
    await outcome
    expect(clock.now()).toBeLessThan(90_000 + POST_DEPLOY_GRACE_MS)
  })
})

describe('evidence handling', () => {
  it('does not treat an unreadable listing as proof the resource is gone', async () => {
    // A delete that resolves on a failed fetch would report success for a
    // resource that is still very much there.
    const clock = virtualClock()
    const outcome = await waitForCompletion(
      { resourceUuid: 'r1', resourceType: 'service', action: 'delete' },
      {
        listResources: () => Promise.reject(new Error('network down')),
        ...clock,
      },
    )
    expect(outcome).toBe('timeout')
  })

  it('treats a listing that resolves to undefined the same way', async () => {
    const clock = virtualClock()
    const outcome = await waitForCompletion(
      { resourceUuid: 'r1', resourceType: 'service', action: 'delete' },
      { listResources: async () => undefined, ...clock },
    )
    expect(outcome).toBe('timeout')
  })

  it('retries on the next poll instead of inventing a verdict from a failed deployment lookup', async () => {
    const clock = virtualClock()
    const getDeployment = vi
      .fn<(uuid: string) => Promise<{ status?: string }>>()
      .mockRejectedValueOnce(new Error('transient 502'))
      .mockResolvedValue({ status: 'failed' })

    const outcome = await waitForCompletion(
      {
        resourceUuid: APP_UUID,
        resourceType: 'application',
        action: 'deploy',
        deploymentUuid: DEPLOYMENT_UUID,
      },
      {
        listResources: async () => [
          { uuid: APP_UUID, status: 'running:healthy' },
        ],
        getDeployment,
        ...clock,
      },
    )

    // The first lookup blew up; had it been read as "no failure", the healthy
    // container would have carried the poll to a false success.
    expect(getDeployment).toHaveBeenCalledTimes(2)
    expect(outcome).toBe('failed')
  })

  it('skips the deployment lookup entirely when there is no handle', async () => {
    const getDeployment = vi.fn()
    const clock = virtualClock()
    await waitForCompletion(
      { resourceUuid: 'db1', resourceType: 'database', action: 'restart' },
      {
        listResources: async () => [{ uuid: 'db1', status: 'running:healthy' }],
        getDeployment,
        ...clock,
      },
    )
    expect(getDeployment).not.toHaveBeenCalled()
  })
})

describe('time budgets', () => {
  it('gives an application deploy or restart the long build budget', () => {
    expect(timeoutFor({ resourceType: 'application', action: 'deploy' })).toBe(
      5 * 60_000,
    )
    expect(timeoutFor({ resourceType: 'application', action: 'restart' })).toBe(
      5 * 60_000,
    )
  })

  it('does not extend the build budget to a plain start or to other types', () => {
    expect(timeoutFor({ resourceType: 'application', action: 'start' })).toBe(
      2 * 60_000,
    )
    expect(timeoutFor({ resourceType: 'service', action: 'deploy' })).toBe(
      2 * 60_000,
    )
  })

  it('gives delete the short budget', () => {
    expect(timeoutFor({ resourceType: 'application', action: 'delete' })).toBe(
      60_000,
    )
  })

  it('gives up with `timeout` rather than guessing when nothing ever converges', async () => {
    const clock = virtualClock()
    const outcome = await waitForCompletion(
      { resourceUuid: 'svc1', resourceType: 'service', action: 'restart' },
      {
        // Forever transitioning: never a verdict either way.
        listResources: async () => [{ uuid: 'svc1', status: 'restarting' }],
        ...clock,
      },
    )
    expect(outcome).toBe('timeout')
    // It polled the whole budget rather than bailing after the first look.
    expect(clock.now()).toBeGreaterThanOrEqual(2 * 60_000 - POLL_INTERVAL_MS)
  })

  it('holds a converged restart until the grace window has passed, then stops', async () => {
    const clock = virtualClock()
    const listResources = vi
      .fn<() => Promise<ListedResource[]>>()
      .mockResolvedValueOnce([{ uuid: 'svc1', status: 'restarting' }])
      .mockResolvedValue([{ uuid: 'svc1', status: 'running:healthy' }])

    const outcome = await waitForCompletion(
      { resourceUuid: 'svc1', resourceType: 'service', action: 'restart' },
      { listResources, ...clock },
    )

    expect(outcome).toBe('completed')
    // The container reads healthy from the second poll (t=3s), but a restart
    // must not resolve against the container it is replacing: the loop keeps
    // going until elapsed clears CONVERGENCE_GRACE_MS at t=9s.
    expect(clock.now()).toBe(9_000)
    expect(listResources).toHaveBeenCalledTimes(4)
    // …and then it stops, instead of burning the remaining budget.
    expect(clock.now()).toBeLessThan(2 * 60_000)
  })
})
