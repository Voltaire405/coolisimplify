// Coolify returns a free-form status string ("running", "running (healthy)",
// "exited (0)", "deploying", "stopped…"), and three separate decisions hang off
// it: the label on a Card, the Status Roll-up LED on a Sidebar node, and which
// actions the context menu enables. A misclassification here does not merely
// mislabel — it offers a destructive action against a resource in the wrong
// state, or hides a state that is genuinely broken.
import { describe, expect, it } from 'vitest'
import {
  RESOURCE_STATE_LABEL,
  canRunAction,
  classifyResourceState,
  isNeverDeployed,
  rollupFromStatus,
  worseRollup,
  type ResourceAction,
  type ResourceState,
} from './resource-state'

describe('classifyResourceState', () => {
  it('reads every running variant a real instance emits', () => {
    expect(classifyResourceState('running')).toBe('running')
    expect(classifyResourceState('running:healthy')).toBe('running')
    expect(classifyResourceState('running (healthy)')).toBe('running')
    expect(classifyResourceState('running:unknown')).toBe('running')
    expect(classifyResourceState('started')).toBe('running')
    expect(classifyResourceState('active')).toBe('running')
    expect(classifyResourceState('healthy')).toBe('running')
  })

  // `running (unhealthy)` still classifies as running — the container is up.
  // Whether that counts as a working deploy is the Verdict's call, not this
  // function's; see isUnhealthy in deploy-verdict.
  it('classifies an unhealthy but live container as running', () => {
    expect(classifyResourceState('running (unhealthy)')).toBe('running')
  })

  it('recognises the transitional states', () => {
    for (const s of [
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
    ]) {
      expect(classifyResourceState(s), s).toBe('transitioning')
    }
  })

  it('folds exited, stopped and never-deployed containers into stopped', () => {
    expect(classifyResourceState('exited (0)')).toBe('stopped')
    expect(classifyResourceState('exited (137)')).toBe('stopped')
    expect(classifyResourceState('stopped')).toBe('stopped')
    expect(classifyResourceState('finished')).toBe('stopped')
    expect(classifyResourceState('cancelled-by-user')).toBe('stopped')
    expect(classifyResourceState('never deployed')).toBe('stopped')
  })

  it('recognises the error states', () => {
    expect(classifyResourceState('error')).toBe('error')
    expect(classifyResourceState('failed')).toBe('error')
    expect(classifyResourceState('failure')).toBe('error')
    expect(classifyResourceState('unhealthy')).toBe('error')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(classifyResourceState('  RUNNING (healthy)  ')).toBe('running')
    expect(classifyResourceState('Exited (0)')).toBe('stopped')
  })

  // An absent or unrecognised status is explicitly `unknown`, never optimistically
  // `running` — the action gating below leans on that distinction.
  it('calls an absent or unrecognised status unknown', () => {
    expect(classifyResourceState(undefined)).toBe('unknown')
    expect(classifyResourceState(null)).toBe('unknown')
    expect(classifyResourceState('')).toBe('unknown')
    expect(classifyResourceState('something nobody has seen')).toBe('unknown')
  })

  it('has a label for every state it can return', () => {
    const states: ResourceState[] = [
      'running',
      'transitioning',
      'stopped',
      'error',
      'unknown',
    ]
    for (const s of states) expect(RESOURCE_STATE_LABEL[s]).toBeTruthy()
  })
})

describe('isNeverDeployed', () => {
  // Kept separate from `stopped` because for logs the two are opposites: an
  // exited container still holds the crash trace, a never-deployed one has
  // nothing to read at all.
  it('is true only for the never-deployed phrasings', () => {
    expect(isNeverDeployed('never deployed')).toBe(true)
    expect(isNeverDeployed('never-deployed')).toBe(true)
    expect(isNeverDeployed('not deployed')).toBe(true)
  })

  it('does not claim a stopped or exited container was never deployed', () => {
    expect(isNeverDeployed('exited (1)')).toBe(false)
    expect(isNeverDeployed('stopped')).toBe(false)
  })
})

describe('Status Roll-up', () => {
  it('maps a status to its roll-up severity', () => {
    expect(rollupFromStatus('running:healthy')).toBe('running')
    expect(rollupFromStatus('deploying')).toBe('transitioning')
    expect(rollupFromStatus('exited (1)')).toBe('problem')
    expect(rollupFromStatus('failed')).toBe('problem')
    expect(rollupFromStatus(undefined)).toBe('none')
  })

  // The LED shows the *worst* descendant, so one broken resource must not be
  // hidden behind a hundred healthy ones.
  it('lets the worst state win', () => {
    expect(worseRollup('running', 'problem')).toBe('problem')
    expect(worseRollup('problem', 'running')).toBe('problem')
    expect(worseRollup('transitioning', 'running')).toBe('transitioning')
    expect(worseRollup('running', 'none')).toBe('running')
    expect(worseRollup('none', 'none')).toBe('none')
  })

  it('is order-independent, so the roll-up does not depend on traversal order', () => {
    const states = ['none', 'running', 'transitioning', 'problem'] as const
    for (const a of states) {
      for (const b of states) {
        expect(worseRollup(a, b)).toBe(worseRollup(b, a))
      }
    }
  })

  it('folds a whole subtree to its worst member', () => {
    const subtree = ['running:healthy', 'running:healthy', 'exited (1)']
    expect(subtree.map(rollupFromStatus).reduce(worseRollup, 'none')).toBe(
      'problem',
    )
  })

  it('reports an empty subtree as none rather than as healthy', () => {
    expect([].map(rollupFromStatus).reduce(worseRollup, 'none')).toBe('none')
  })
})

describe('canRunAction', () => {
  it('offers start only where starting means something', () => {
    expect(canRunAction('start', 'exited (0)')).toBe(true)
    expect(canRunAction('start', 'failed')).toBe(true)
    expect(canRunAction('start', undefined)).toBe(true)
    expect(canRunAction('start', 'running:healthy')).toBe(false)
    expect(canRunAction('start', 'deploying')).toBe(false)
  })

  it('offers stop only against something that may be up', () => {
    expect(canRunAction('stop', 'running:healthy')).toBe(true)
    expect(canRunAction('stop', 'failed')).toBe(true)
    expect(canRunAction('stop', undefined)).toBe(true)
    expect(canRunAction('stop', 'exited (0)')).toBe(false)
    expect(canRunAction('stop', 'deploying')).toBe(false)
  })

  // restart / deploy need a resource that is up, or up enough to retry after a
  // failed deploy; pointless against a stopped or transitioning one.
  it('offers restart and deploy only on a running or errored resource', () => {
    for (const action of ['restart', 'deploy'] as const) {
      expect(canRunAction(action, 'running:healthy')).toBe(true)
      expect(canRunAction(action, 'failed')).toBe(true)
      expect(canRunAction(action, 'exited (0)')).toBe(false)
      expect(canRunAction(action, 'deploying')).toBe(false)
      // An unknown status is not enough to justify re-running a build.
      expect(canRunAction(action, undefined)).toBe(false)
    }
  })

  it('always offers delete, whatever the state', () => {
    for (const status of [
      'running:healthy',
      'deploying',
      'exited (0)',
      'failed',
      undefined,
    ]) {
      expect(canRunAction('delete', status)).toBe(true)
    }
  })

  // Nothing but delete may fire while the resource is mid-flight; dispatching a
  // second action into a transition is how a queue ends up fighting itself.
  it('offers nothing but delete during a transition', () => {
    const actions: ResourceAction[] = ['start', 'stop', 'restart', 'deploy']
    for (const action of actions) {
      expect(canRunAction(action, 'deploying'), action).toBe(false)
      expect(canRunAction(action, 'restarting'), action).toBe(false)
    }
  })
})
