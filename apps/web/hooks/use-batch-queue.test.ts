// @vitest-environment jsdom
//
// The Batch Queue is the one place the app fires destructive actions in bulk.
// Two properties carry the weight: selection order is execution order (Coolify
// queues actions server-side and parallel start/stop/restart against the same
// server race on ports and networks — the visible symptom is that only one
// resource of a batch actually transitions while the rest silently keep their
// old state despite every call returning 200), and the outcome of each item is
// established before the next one starts.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startFakeCoolify, type FakeCoolify } from '../test/fake-coolify'
import type {
  BatchItem,
  BatchQueueOptions,
  useBatchQueue as UseBatchQueue,
} from './use-coolify'

let fake: FakeCoolify
let useBatchQueue: typeof UseBatchQueue
/** Endpoints the queue hits, scripted per test. */
let failing: Set<string>

beforeEach(async () => {
  vi.resetModules()
  failing = new Set()
  fake = await startFakeCoolify((req) => {
    if (failing.has(req.pathname)) {
      return { status: 422, body: { message: 'Validation failed.' } }
    }
    if (req.pathname.endsWith('/start') || req.pathname.endsWith('/restart')) {
      return { body: { message: 'queued', deployment_uuid: 'dep-1' } }
    }
    return { body: { message: 'queued' } }
  })

  // useSettings snapshots localStorage at module load, so seed it before the
  // hook module is first imported.
  window.localStorage.setItem(
    'coolisimplify:settings',
    JSON.stringify({ coolifyUrl: fake.base, coolifyToken: 'test-token' }),
  )
  ;({ useBatchQueue } = await import('./use-coolify'))
})

afterEach(async () => {
  await fake.close()
  window.localStorage.clear()
})

/** Renders the queue with a waiter that records the order it saw. */
function renderQueue(options: BatchQueueOptions = {}) {
  return renderHook(() => useBatchQueue(options))
}

describe('execution order', () => {
  it('runs items in selection order, one at a time', async () => {
    const order: string[] = []
    let inFlight = 0
    let sawOverlap = false

    const { result } = renderQueue({
      waitForCompletion: async (item: BatchItem) => {
        inFlight += 1
        if (inFlight > 1) sawOverlap = true
        order.push(item.resourceName)
        await new Promise((r) => setTimeout(r, 5))
        inFlight -= 1
        return 'completed'
      },
    })

    act(() => {
      result.current.enqueue('u1', 'application', 'first', 'restart')
      result.current.enqueue('u2', 'service', 'second', 'restart')
      result.current.enqueue('u3', 'database', 'third', 'restart')
    })

    await waitFor(() => expect(result.current.stats.completed).toBe(3))
    expect(order).toEqual(['first', 'second', 'third'])
    expect(sawOverlap, 'two items ran concurrently').toBe(false)
  })

  it('does not queue a resource that is already waiting its turn', async () => {
    const { result } = renderQueue({
      waitForCompletion: async () => 'completed',
    })

    let second: boolean | undefined
    act(() => {
      result.current.enqueue('u1', 'application', 'app', 'restart')
      second = result.current.enqueue('u1', 'application', 'app', 'stop')
    })

    // A double-click must not dispatch the action twice.
    expect(second).toBe(false)
    await waitFor(() => expect(result.current.stats.total).toBe(1))
  })

  it('lets a resource be queued again once its previous run settled', async () => {
    const { result } = renderQueue({ waitForCompletion: async () => 'completed' })

    act(() => {
      result.current.enqueue('u1', 'application', 'app', 'restart')
    })
    await waitFor(() => expect(result.current.stats.completed).toBe(1))

    let again: boolean | undefined
    act(() => {
      again = result.current.enqueue('u1', 'application', 'app', 'stop')
    })
    expect(again).toBe(true)
  })
})

describe('outcomes', () => {
  it('waits for the verdict instead of trusting the queued response', async () => {
    const waitForCompletion =
      vi.fn<NonNullable<BatchQueueOptions['waitForCompletion']>>(
        async () => 'completed',
      )
    const { result } = renderQueue({ waitForCompletion })

    act(() => {
      result.current.enqueue('u1', 'application', 'app', 'deploy')
    })
    await waitFor(() => expect(result.current.stats.completed).toBe(1))

    // The handle Coolify returned must reach the waiter — without it the
    // verdict falls back to container status and cannot see a failed build.
    expect(waitForCompletion).toHaveBeenCalledTimes(1)
    expect(waitForCompletion.mock.calls[0]![0]).toMatchObject({
      resourceUuid: 'u1',
      deploymentUuid: 'dep-1',
    })
  })

  it('reports a failed deployment as a failure', async () => {
    const onItemFailed = vi.fn()
    const { result } = renderQueue({
      waitForCompletion: async () => 'failed',
      onItemFailed,
    })

    act(() => {
      result.current.enqueue('u1', 'application', 'app', 'deploy')
    })
    await waitFor(() => expect(result.current.stats.failed).toBe(1))
    expect(result.current.items[0]!.error).toBe('deploy failed')
    expect(onItemFailed).toHaveBeenCalledTimes(1)
  })

  // `failed` is Coolify's own verdict; `timeout` is our own giving up, which is
  // not evidence either way. Reporting an unknown outcome as a clean failure is
  // the mirror of the bug this whole path exists to prevent.
  it('keeps a timeout distinguishable from a failure', async () => {
    const { result } = renderQueue({ waitForCompletion: async () => 'timeout' })

    act(() => {
      result.current.enqueue('u1', 'application', 'app', 'deploy')
    })
    await waitFor(() => expect(result.current.stats.failed).toBe(1))
    expect(result.current.items[0]!.error).toContain('outcome unknown')
    expect(result.current.items[0]!.error).not.toBe('deploy failed')
  })

  it('marks an item failed when the API itself rejects the call', async () => {
    const onItemFailed = vi.fn()
    failing.add('/applications/u1/start')
    const { result } = renderQueue({
      waitForCompletion: async () => 'completed',
      onItemFailed,
    })

    act(() => {
      result.current.enqueue('u1', 'application', 'app', 'deploy')
    })
    await waitFor(() => expect(result.current.stats.failed).toBe(1))
    expect(result.current.items[0]!.error).toContain('Validation failed.')
    expect(onItemFailed).toHaveBeenCalledTimes(1)
  })

  it('keeps going through the rest of the batch after one item fails', async () => {
    failing.add('/applications/u1/start')
    const { result } = renderQueue({ waitForCompletion: async () => 'completed' })

    act(() => {
      result.current.enqueue('u1', 'application', 'bad', 'deploy')
      result.current.enqueue('u2', 'service', 'good', 'start')
    })

    await waitFor(() => expect(result.current.stats.total).toBe(2))
    await waitFor(() => {
      expect(result.current.stats.failed).toBe(1)
      expect(result.current.stats.completed).toBe(1)
    })
  })

  it('does not consult the waiter for an item the API already rejected', async () => {
    const waitForCompletion =
      vi.fn<NonNullable<BatchQueueOptions['waitForCompletion']>>(
        async () => 'completed',
      )
    failing.add('/applications/u1/start')
    const { result } = renderQueue({ waitForCompletion })

    act(() => {
      result.current.enqueue('u1', 'application', 'app', 'deploy')
    })
    await waitFor(() => expect(result.current.stats.failed).toBe(1))
    expect(waitForCompletion).not.toHaveBeenCalled()
  })

  it('notifies that the listing changed so the UI can refetch', async () => {
    const onResourceChanged = vi.fn()
    const { result } = renderQueue({
      waitForCompletion: async () => 'completed',
      onResourceChanged,
    })

    act(() => {
      result.current.enqueue('u1', 'service', 'svc', 'stop')
    })
    await waitFor(() => expect(result.current.stats.completed).toBe(1))
    expect(onResourceChanged).toHaveBeenCalledWith('service')
  })

  // Without a waiter the queue only knows the request was accepted, which is
  // exactly the assumption that made a broken deploy look done.
  it('falls back to completing immediately when no waiter is supplied', async () => {
    const { result } = renderQueue()
    act(() => {
      result.current.enqueue('u1', 'service', 'svc', 'start')
    })
    await waitFor(() => expect(result.current.stats.completed).toBe(1))
  })
})

describe('queue contents', () => {
  it('counts each status separately', async () => {
    const { result } = renderQueue({
      waitForCompletion: async (item: BatchItem) =>
        item.resourceUuid === 'u2' ? 'failed' : 'completed',
    })

    act(() => {
      result.current.enqueue('u1', 'service', 'ok', 'start')
      result.current.enqueue('u2', 'service', 'bad', 'start')
    })

    await waitFor(() => {
      expect(result.current.stats).toMatchObject({
        total: 2,
        completed: 1,
        failed: 1,
        pending: 0,
        inProgress: 0,
      })
    })
  })

  it('removes a single item by id', async () => {
    const { result } = renderQueue({ waitForCompletion: async () => 'completed' })
    act(() => {
      result.current.enqueue('u1', 'service', 'a', 'start')
    })
    await waitFor(() => expect(result.current.stats.completed).toBe(1))

    const id = result.current.items[0]!.id
    act(() => result.current.remove(id))
    expect(result.current.items).toHaveLength(0)
  })

  it('clears settled items while leaving unsettled ones alone', async () => {
    let release: (() => void) | undefined
    const { result } = renderQueue({
      waitForCompletion: async (item: BatchItem) => {
        if (item.resourceUuid === 'u2') {
          await new Promise<void>((r) => {
            release = r
          })
        }
        return 'completed'
      },
    })

    act(() => {
      result.current.enqueue('u1', 'service', 'done', 'start')
      result.current.enqueue('u2', 'service', 'busy', 'start')
    })
    await waitFor(() => expect(result.current.stats.completed).toBe(1))
    await waitFor(() => expect(result.current.stats.inProgress).toBe(1))

    act(() => result.current.clearCompleted())
    // Dropping the in-flight chip would leave an action running with nothing
    // on screen to say so.
    expect(result.current.items.map((i) => i.resourceUuid)).toEqual(['u2'])

    await act(async () => {
      release?.()
    })
  })

  it('clears everything on demand', async () => {
    const { result } = renderQueue({ waitForCompletion: async () => 'completed' })
    act(() => {
      result.current.enqueue('u1', 'service', 'a', 'start')
    })
    await waitFor(() => expect(result.current.stats.completed).toBe(1))

    act(() => result.current.clearAll())
    expect(result.current.items).toHaveLength(0)
  })
})

describe('without a configured instance', () => {
  it('queues the item but dispatches nothing', async () => {
    window.localStorage.clear()
    vi.resetModules()
    const { useBatchQueue: unconfigured } = await import('./use-coolify')
    const { result } = renderHook(() => unconfigured({}))

    act(() => {
      result.current.enqueue('u1', 'service', 'svc', 'start')
    })

    // It stays pending rather than reporting a success nobody performed.
    expect(result.current.stats.total).toBe(1)
    expect(result.current.stats.completed).toBe(0)
    expect(fake.requests).toHaveLength(0)
  })
})
