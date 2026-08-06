// Verifies that the app can tell a *successful* deployment from a *failed* one.
//
// Background: Coolify has no "deploy" endpoint — the app calls start/restart,
// which answer "queued" and nothing else. The verdict used to be inferred by
// polling `GET /applications` and reading the container `status`. But that
// status describes the *running container*, not the deployment: while a build
// runs (and after it fails) the previous container is still up and still says
// `running:healthy`. So a failed deploy and a successful one emit an identical
// container status stream, and anything judging by container status alone must
// call both a success — which is exactly what shipped.
//
// The end-to-end version of that scenario lives in `wait-for-completion.test.ts`,
// which drives the poll loop against a fake instance. This file pins the judge's
// own rules.
import { describe, expect, it } from 'vitest'
import { componentSchema } from '../test/coolify-spec'
import { CoolifyClient } from './coolify-client'
import {
  CONVERGENCE_GRACE_MS,
  classifyDeploymentStatus,
  isTerminalOutcome,
  isUnhealthy,
  judgeAction,
  timeoutMessage,
  type VerdictInput,
} from './deploy-verdict'

describe('classifyDeploymentStatus', () => {
  // These three are the only terminal values a live v4 instance produced across
  // 194 real deployment records (157 finished, 35 failed, 2 cancelled-by-user).
  it('maps the three terminal statuses a live instance produces', () => {
    expect(classifyDeploymentStatus('finished')).toBe('succeeded')
    expect(classifyDeploymentStatus('failed')).toBe('failed')
    expect(classifyDeploymentStatus('cancelled-by-user')).toBe('cancelled')
  })

  it('does not mistake a non-terminal state for an outcome', () => {
    expect(classifyDeploymentStatus('queued')).toBe('pending')
    expect(classifyDeploymentStatus('in_progress')).toBe('pending')
  })

  // An unknown future status is not evidence of success.
  it('treats an unknown or missing status as pending, never as success', () => {
    expect(classifyDeploymentStatus('rolling-back')).toBe('pending')
    expect(classifyDeploymentStatus(undefined)).toBe('pending')
    expect(classifyDeploymentStatus(null)).toBe('pending')
  })

  it('marks only the settled outcomes as terminal', () => {
    expect(isTerminalOutcome('succeeded')).toBe(true)
    expect(isTerminalOutcome('failed')).toBe(true)
    expect(isTerminalOutcome('cancelled')).toBe(true)
    expect(isTerminalOutcome('pending')).toBe(false)
  })
})

describe('judgeAction, holding a deployment handle', () => {
  const judge = (over: Partial<VerdictInput>) =>
    judgeAction({
      action: 'deploy',
      resourcePresent: true,
      containerStatus: 'running:healthy',
      elapsedMs: 60_000,
      ...over,
    })

  it('calls a finished deployment on a healthy container a success', () => {
    expect(judge({ deploymentStatus: 'finished' })).toBe('succeeded')
  })

  it('calls a failed deployment a failure, however healthy the container', () => {
    // The old container never stopped being healthy — that is the whole trap.
    expect(judge({ deploymentStatus: 'failed' })).toBe('failed')
  })

  it('does not count a cancelled deployment as a success', () => {
    expect(judge({ deploymentStatus: 'cancelled-by-user' })).toBe('failed')
  })

  it('keeps waiting while the build runs', () => {
    expect(judge({ deploymentStatus: 'in_progress' })).toBe('waiting')
  })

  // `finished` means the job completed, not that the container survived it: a
  // crash-loop is a failed deploy, not a done one.
  it('fails a finished deployment whose container died right after', () => {
    expect(
      judge({ deploymentStatus: 'finished', containerStatus: 'exited (1)' }),
    ).toBe('failed')
  })

  it('gives the listing its convergence grace window before holding the container against it', () => {
    expect(
      judge({
        deploymentStatus: 'finished',
        containerStatus: 'exited (1)',
        elapsedMs: CONVERGENCE_GRACE_MS - 1,
      }),
    ).toBe('waiting')
  })

  it('does not call a failing healthcheck a working deploy', () => {
    expect(isUnhealthy('running (unhealthy)')).toBe(true)
    expect(
      judge({
        deploymentStatus: 'finished',
        containerStatus: 'running (unhealthy)',
      }),
    ).toBe('failed')
  })

  // `running:unknown` is a container with no healthcheck defined — roughly half
  // of a real instance's applications. Absent a healthcheck there is nothing to
  // fail, so a finished deployment on one is a success, not a suspicion.
  it('accepts a container with no healthcheck defined', () => {
    expect(isUnhealthy('running:unknown')).toBe(false)
    expect(
      judge({ deploymentStatus: 'finished', containerStatus: 'running:unknown' }),
    ).toBe('succeeded')
  })

  it('keeps waiting while the resource is missing from the listing', () => {
    expect(judge({ deploymentStatus: 'finished', resourcePresent: false })).toBe(
      'waiting',
    )
  })
})

describe('judgeAction, falling back to container status', () => {
  // Services and Databases have no Deployment, so the container is all there is.
  const svc = (over: Partial<VerdictInput>) =>
    judgeAction({
      action: 'restart',
      resourcePresent: true,
      elapsedMs: 60_000,
      ...over,
    })

  it('accepts a healthy or healthcheck-less running container', () => {
    expect(svc({ containerStatus: 'running:healthy' })).toBe('succeeded')
    expect(svc({ containerStatus: 'running:unknown' })).toBe('succeeded')
  })

  // `starting`/`restarting` are transitioning, not arrived. Counting them as
  // active is what let the old judge declare victory mid-flight.
  it('does not mistake a transitioning container for an arrived one', () => {
    expect(svc({ containerStatus: 'restarting' })).toBe('waiting')
    expect(svc({ containerStatus: 'starting' })).toBe('waiting')
    expect(svc({ containerStatus: 'running (unhealthy)' })).toBe('waiting')
  })

  // The elapsed-age gate still applies, so a restart cannot resolve against the
  // status of the container it is about to replace.
  it('will not resolve a restart against the container it is replacing', () => {
    expect(
      svc({
        containerStatus: 'running:healthy',
        elapsedMs: CONVERGENCE_GRACE_MS - 1,
      }),
    ).toBe('waiting')
  })

  it('lets a plain start resolve without waiting out the grace window', () => {
    // `start` has no previous container to be confused with.
    expect(
      judgeAction({
        action: 'start',
        resourcePresent: true,
        containerStatus: 'running:healthy',
        elapsedMs: 100,
      }),
    ).toBe('succeeded')
  })

  it('requires stop to see a genuinely stopped container, not merely "not active"', () => {
    expect(
      judgeAction({
        action: 'stop',
        resourcePresent: true,
        containerStatus: 'exited (0)',
        elapsedMs: 10_000,
      }),
    ).toBe('succeeded')
    expect(
      judgeAction({
        action: 'stop',
        resourcePresent: true,
        containerStatus: 'stopping',
        elapsedMs: 10_000,
      }),
    ).toBe('waiting')
  })

  it('converges delete on disappearance', () => {
    expect(
      judgeAction({ action: 'delete', resourcePresent: false, elapsedMs: 1000 }),
    ).toBe('succeeded')
    expect(
      judgeAction({ action: 'delete', resourcePresent: true, elapsedMs: 1000 }),
    ).toBe('waiting')
  })
})

describe('the contract the verdict depends on', () => {
  it('still finds status and deployment_uuid on the deployment schema', () => {
    const deployment = componentSchema('ApplicationDeploymentQueue')
    expect(deployment.status).toBeDefined()
    expect(deployment.deployment_uuid).toBeDefined()
  })

  it('still lets the client query a deployment', () => {
    expect(Object.getOwnPropertyNames(CoolifyClient.prototype)).toContain(
      'getDeployment',
    )
  })
})

describe('timeoutMessage', () => {
  // Giving up is not evidence of success *or* failure; the wording has to say so.
  it('reports an abandoned action as unknown, not as done', () => {
    expect(timeoutMessage('deploy')).toBe(
      'Timed out waiting for deploy to finish — outcome unknown',
    )
  })
})
