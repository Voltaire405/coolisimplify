import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { CoolifyClient } from '@/lib/coolify-client'
import { useSettings } from './use-settings'
import type {
  Application,
  Service,
  Database,
  Project,
  Environment,
  Server,
  DeleteOptions,
} from '@/lib/types'

const REFRESH_INTERVAL = 30000

export function useClient() {
  const { coolifyUrl, coolifyToken, isConfigured } = useSettings()
  const client = useMemo(
    () =>
      isConfigured ? new CoolifyClient({ baseUrl: coolifyUrl, token: coolifyToken }) : null,
    [coolifyUrl, coolifyToken, isConfigured],
  )
  return { client, isConfigured }
}

function usePolled<T>(
  loader: ((client: CoolifyClient) => Promise<T>) | null,
  empty: T,
): {
  data: T
  loading: boolean
  error: string | null
  refetch: () => Promise<T | undefined>
} {
  const { client, isConfigured } = useClient()
  const [data, setData] = useState<T>(empty)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  const refetch = useCallback(async (): Promise<T | undefined> => {
    const fn = loaderRef.current
    if (!client || !fn) return undefined
    setLoading(true)
    setError(null)
    try {
      const result = await fn(client)
      setData(result)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
      return undefined
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    if (!isConfigured) {
      setData(empty)
      return
    }
    refetch()
    const id = setInterval(refetch, REFRESH_INTERVAL)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, isConfigured])

  return { data, loading, error, refetch }
}

export function useProjects() {
  return usePolled<Project[]>((c) => c.listProjects(), [])
}

export function useApplications() {
  return usePolled<Application[]>((c) => c.listApplications(), [])
}

export function useServices() {
  return usePolled<Service[]>((c) => c.listServices(), [])
}

export function useDatabases() {
  return usePolled<Database[]>((c) => c.listDatabases(), [])
}

export function useServers() {
  return usePolled<Server[]>((c) => c.listServers(), [])
}

export function useEnvironments(projectUuid: string | null) {
  const { client, isConfigured } = useClient()
  const [data, setData] = useState<Environment[]>([])
  const [loading, setLoading] = useState(false)

  const refetch = useCallback(async () => {
    if (!client || !projectUuid) return
    setLoading(true)
    try {
      const envs = await client.listEnvironments(projectUuid)
      setData(envs)
    } catch {
      setData([])
    } finally {
      setLoading(false)
    }
  }, [client, projectUuid])

  useEffect(() => {
    if (!isConfigured || !projectUuid) {
      setData([])
      return
    }
    refetch()
  }, [refetch, isConfigured, projectUuid])

  return { data, loading, refetch }
}

export type BatchAction = 'start' | 'stop' | 'restart' | 'deploy' | 'delete'
export type RowAction = BatchAction | 'clone'
export type ResourceType = 'application' | 'service' | 'database'

export interface BatchItem {
  id: string
  resourceUuid: string
  resourceType: ResourceType
  resourceName: string
  action: BatchAction
  deleteOptions?: DeleteOptions
  status: 'pending' | 'in-progress' | 'completed' | 'failed'
  message?: string
  error?: string
}

async function runAction(
  client: CoolifyClient,
  type: ResourceType,
  action: BatchAction,
  uuid: string,
  deleteOptions?: DeleteOptions,
): Promise<string | undefined> {
  if (type === 'application') {
    if (action === 'start') return (await client.startApplication(uuid)).message
    if (action === 'stop') return (await client.stopApplication(uuid)).message
    // Coolify's "deploy/redeploy" for apps is the start endpoint: it queues a
    // full deployment (rolling update if possible). restart is restart_only.
    if (action === 'deploy') return (await client.startApplication(uuid)).message
    if (action === 'delete')
      return (await client.deleteApplication(uuid, deleteOptions)).message
    return (await client.restartApplication(uuid)).message
  }
  if (type === 'service') {
    if (action === 'start') return (await client.startService(uuid)).message
    if (action === 'stop') return (await client.stopService(uuid)).message
    // Service "redeploy" equivalent: restart pulling the latest images.
    if (action === 'deploy')
      return (await client.restartService(uuid, { latest: true })).message
    if (action === 'delete')
      return (await client.deleteService(uuid, deleteOptions)).message
    return (await client.restartService(uuid)).message
  }
  if (action === 'deploy') throw new Error('Databases cannot be deployed')
  if (action === 'start') return (await client.startDatabase(uuid)).message
  if (action === 'stop') return (await client.stopDatabase(uuid)).message
  if (action === 'delete')
    return (await client.deleteDatabase(uuid, deleteOptions)).message
  return (await client.restartDatabase(uuid)).message
}

export type CompletionOutcome = 'completed' | 'timeout'

export interface BatchQueueOptions {
  onResourceChanged?: (type: ResourceType) => void
  onItemFailed?: (item: BatchItem) => void
  /**
   * Optional waiter invoked AFTER the API call returns and BEFORE the queue
   * moves on to the next item. Should resolve when the resource has actually
   * transitioned to the expected state (or when a sensible timeout elapses).
   * When omitted, the queue moves on immediately after the API response.
   */
  waitForCompletion?: (item: BatchItem) => Promise<CompletionOutcome>
}

export function useBatchQueue(options: BatchQueueOptions = {}) {
  const { client } = useClient()
  const clientRef = useRef(client)
  clientRef.current = client
  const onResourceChangedRef = useRef(options.onResourceChanged)
  onResourceChangedRef.current = options.onResourceChanged
  const onItemFailedRef = useRef(options.onItemFailed)
  onItemFailedRef.current = options.onItemFailed
  const waitForCompletionRef = useRef(options.waitForCompletion)
  waitForCompletionRef.current = options.waitForCompletion

  const [items, setItems] = useState<BatchItem[]>([])
  const itemsRef = useRef<BatchItem[]>([])
  const processingRef = useRef(false)

  const commit = useCallback((next: BatchItem[]) => {
    itemsRef.current = next
    setItems(next)
  }, [])

  const patchItem = useCallback(
    (id: string, patch: Partial<BatchItem>) => {
      commit(
        itemsRef.current.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      )
    },
    [commit],
  )

  const process = useCallback(async () => {
    if (processingRef.current) return
    const c = clientRef.current
    if (!c) return
    const pending = itemsRef.current.filter((i) => i.status === 'pending')
    if (pending.length === 0) return

    processingRef.current = true
    try {
      const ids = new Set(pending.map((p) => p.id))
      commit(
        itemsRef.current.map((i) =>
          ids.has(i.id) ? { ...i, status: 'in-progress' as const } : i,
        ),
      )

      // Sequential processing: each task runs to completion before the next
      // begins. Coolify queues actions server-side and parallel start/stop/
      // restart against the same server can race on ports/networks — most
      // visible symptom: only one resource of a batch actually transitions
      // while the rest silently stay in their old state despite the API
      // returning 200 for all. Waiting for the real status to converge
      // before launching the next action makes the batch deterministic.
      for (let idx = 0; idx < pending.length; idx++) {
        const item = pending[idx]!
        let apiOk = true
        try {
          const message = await runAction(
            c,
            item.resourceType,
            item.action,
            item.resourceUuid,
            item.deleteOptions,
          )
          patchItem(item.id, { message })
          onResourceChangedRef.current?.(item.resourceType)
        } catch (err) {
          apiOk = false
          const failedItem: BatchItem = {
            ...item,
            status: 'failed',
            error: err instanceof Error ? err.message : 'Failed',
          }
          patchItem(item.id, {
            status: 'failed',
            error: failedItem.error,
          })
          onItemFailedRef.current?.(failedItem)
          onResourceChangedRef.current?.(item.resourceType)
        }

        if (apiOk) {
          const waiter = waitForCompletionRef.current
          const outcome = waiter ? await waiter(item) : 'completed'
          if (outcome === 'completed') {
            patchItem(item.id, { status: 'completed' })
          } else {
            const timeoutMsg = 'Timed out waiting for status to settle'
            patchItem(item.id, {
              status: 'failed',
              error: timeoutMsg,
            })
            onItemFailedRef.current?.({
              ...item,
              status: 'failed',
              error: timeoutMsg,
            })
          }
        }
      }
    } finally {
      processingRef.current = false
    }

    if (itemsRef.current.some((i) => i.status === 'pending')) {
      void process()
    }
  }, [commit, patchItem])

  const enqueue = useCallback(
    (
      resourceUuid: string,
      resourceType: ResourceType,
      resourceName: string,
      action: BatchAction,
      deleteOptions?: DeleteOptions,
    ): boolean => {
      // Skip duplicates: a resource already pending or in-progress gets no extra request.
      const alreadyQueued = itemsRef.current.some(
        (i) =>
          i.resourceUuid === resourceUuid &&
          (i.status === 'pending' || i.status === 'in-progress'),
      )
      if (alreadyQueued) return false

      const id = `${resourceUuid}:${action}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      commit([
        ...itemsRef.current,
        {
          id,
          resourceUuid,
          resourceType,
          resourceName,
          action,
          ...(deleteOptions ? { deleteOptions } : {}),
          status: 'pending' as const,
        },
      ])
      void process()
      return true
    },
    [commit, process],
  )

  const remove = useCallback(
    (id: string) => {
      commit(itemsRef.current.filter((i) => i.id !== id))
    },
    [commit],
  )

  const clearCompleted = useCallback(() => {
    commit(
      itemsRef.current.filter(
        (i) => i.status === 'pending' || i.status === 'in-progress',
      ),
    )
  }, [commit])

  const clearAll = useCallback(() => {
    commit([])
  }, [commit])

  const stats = useMemo(
    () => ({
      pending: items.filter((i) => i.status === 'pending').length,
      inProgress: items.filter((i) => i.status === 'in-progress').length,
      completed: items.filter((i) => i.status === 'completed').length,
      failed: items.filter((i) => i.status === 'failed').length,
      total: items.length,
    }),
    [items],
  )

  return {
    items,
    enqueue,
    remove,
    process,
    clearCompleted,
    clearAll,
    stats,
  }
}

export function isResourceActive(status?: string | null): boolean {
  if (!status) return false
  const s = status.toLowerCase()
  if (s.startsWith('running')) return true
  return (
    s === 'started' ||
    s === 'active' ||
    s === 'healthy' ||
    s === 'starting' ||
    s === 'restarting'
  )
}
