'use client'

import Image from 'next/image'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useSettings } from '@/hooks/use-settings'
import {
  useProjects,
  useApplications,
  useServices,
  useDatabases,
  useBatchQueue,
  useClient,
  isResourceActive,
} from '@/hooks/use-coolify'
import { ConfigButton } from '@/components/config-button'
import { ProjectCard } from '@/components/project-card'
import { BatchQueue } from '@/components/batch-queue'
import { ResourcePropertiesDialog } from '@/components/resource-properties-dialog'
import {
  BatchDeleteConfirmDialog,
  DeleteConfirmDialog,
  StopConfirmDialog,
} from '@/components/confirm-dialog'
import { CloneDialog } from '@/components/clone-dialog'
import type { BatchCloneResultItem } from '@/lib/clone'
import { isCloneable } from '@/lib/clone'
import {
  Play,
  Square,
  RotateCcw,
  Rocket,
  Copy,
  Trash2,
  X,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import type { ResourceType, BatchAction, RowAction } from '@/hooks/use-coolify'
import type { DeleteOptions } from '@/lib/types'
import { cn } from '@workspace/ui/lib/utils'
import { canRunAction } from '@/lib/resource-state'

interface Toast {
  id: string
  message: string
  type: 'success' | 'error'
}

export default function DashboardPage() {
  const { isConfigured } = useSettings()
  const { client } = useClient()
  const {
    data: projects,
    loading: projectsLoading,
    error: projectsError,
    refetch: refetchProjects,
  } = useProjects()
  const {
    data: applications,
    loading: appsLoading,
    refetch: refetchApplications,
  } = useApplications()
  const {
    data: services,
    loading: servicesLoading,
    refetch: refetchServices,
  } = useServices()
  const {
    data: databases,
    loading: dbsLoading,
    refetch: refetchDatabases,
  } = useDatabases()

  // Coolify queues the start/stop/restart and returns 200 immediately;
  // the container takes seconds to actually transition. Re-poll several
  // times over ~30s so the UI reflects the real state without waiting
  // for the slow background interval.
  const refetchTimersRef = useRef<Record<ResourceType, number[]>>({
    application: [],
    service: [],
    database: [],
  })
  useEffect(() => {
    const timers = refetchTimersRef.current
    return () => {
      for (const t of Object.values(timers)) {
        for (const id of t) window.clearTimeout(id)
      }
    }
  }, [])

  const refetchByType = useCallback(
    (type: ResourceType) => {
      const fn =
        type === 'application'
          ? refetchApplications
          : type === 'service'
            ? refetchServices
            : refetchDatabases
      const timers = refetchTimersRef.current[type]
      for (const id of timers) window.clearTimeout(id)
      timers.length = 0
      void fn()
      for (const delay of [2000, 5000, 10000, 20000, 30000]) {
        timers.push(window.setTimeout(() => void fn(), delay))
      }
    },
    [refetchApplications, refetchServices, refetchDatabases],
  )

  // Unified tracker of in-flight actions. The flag persists until the
  // resource's real status matches the expected state, the request fails,
  // or a hard timeout elapses (safety net). Both single and batch actions
  // register here so the row pill stays visible across the full lifecycle.
  type PendingAction = {
    type: ResourceType
    action: RowAction
    startedAt: number
  }
  const [pending, setPending] = useState<Map<string, PendingAction>>(
    () => new Map(),
  )

  const startPending = useCallback(
    (uuid: string, type: ResourceType, action: RowAction) => {
      setPending((prev) => {
        const next = new Map(prev)
        next.set(uuid, { type, action, startedAt: Date.now() })
        return next
      })
    },
    [],
  )

  const clearPending = useCallback((uuid: string) => {
    setPending((prev) => {
      if (!prev.has(uuid)) return prev
      const next = new Map(prev)
      next.delete(uuid)
      return next
    })
  }, [])

  const isResourceBusy = useCallback(
    (uuid: string) => pending.has(uuid),
    [pending],
  )
  const busyAction = useCallback(
    (uuid: string): RowAction | undefined => pending.get(uuid)?.action,
    [pending],
  )

  // Per-item completion waiter for the sequential batch queue. Polls the
  // appropriate list until the resource's status reflects the action, the
  // resource is gone (for `delete`), or a per-action timeout elapses.
  const refetchByTypeAndReturnRef = useRef<{
    application: () => Promise<unknown[] | undefined>
    service: () => Promise<unknown[] | undefined>
    database: () => Promise<unknown[] | undefined>
  }>({
    application: refetchApplications,
    service: refetchServices,
    database: refetchDatabases,
  })
  useEffect(() => {
    refetchByTypeAndReturnRef.current = {
      application: refetchApplications,
      service: refetchServices,
      database: refetchDatabases,
    }
  }, [refetchApplications, refetchServices, refetchDatabases])

  const waitForCompletion = useCallback(
    async (item: {
      resourceUuid: string
      resourceType: ResourceType
      action: RowAction
    }): Promise<'completed' | 'timeout'> => {
      const startedAt = Date.now()
      // App deploy runs a full build pipeline; app restart_only is faster but
      // both go through the deployment queue, so give them the long budget.
      const isAppRedeployLike =
        item.resourceType === 'application' &&
        (item.action === 'restart' || item.action === 'deploy')
      const timeoutMs = isAppRedeployLike
        ? 5 * 60_000
        : item.action === 'delete'
          ? 60_000
          : 2 * 60_000
      const minRestartAgeMs =
        item.action === 'restart' || item.action === 'deploy' ? 8_000 : 0
      const pollIntervalMs = 3000
      const deadline = startedAt + timeoutMs

      while (Date.now() < deadline) {
        const fn = refetchByTypeAndReturnRef.current[item.resourceType]
        let list: { uuid: string; status?: string }[] | undefined
        try {
          list = (await fn()) as { uuid: string; status?: string }[] | undefined
        } catch {
          list = undefined
        }
        const resource = list?.find((r) => r.uuid === item.resourceUuid)

        if (item.action === 'delete') {
          if (list && !resource) return 'completed'
        } else if (resource) {
          const active = isResourceActive(resource.status)
          const age = Date.now() - startedAt
          if (item.action === 'start' && active) return 'completed'
          if (item.action === 'stop' && !active) return 'completed'
          if (
            (item.action === 'restart' || item.action === 'deploy') &&
            active &&
            age >= minRestartAgeMs
          )
            return 'completed'
        }

        if (Date.now() + pollIntervalMs >= deadline) break
        await new Promise((r) => setTimeout(r, pollIntervalMs))
      }
      return 'timeout'
    },
    [],
  )

  const queue = useBatchQueue({
    onResourceChanged: refetchByType,
    onItemFailed: (item) => clearPending(item.resourceUuid),
    waitForCompletion,
  })

  const handleRefreshAll = useCallback(() => {
    void refetchProjects()
    void refetchApplications()
    void refetchServices()
    void refetchDatabases()
  }, [refetchProjects, refetchApplications, refetchServices, refetchDatabases])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [toasts, setToasts] = useState<Toast[]>([])

  // Confirmation targets. Delete and stop never execute directly: the click
  // opens a modal and only its confirm button runs the action.
  type DeleteTarget =
    | { kind: 'single'; uuid: string; type: ResourceType; name: string }
    | {
        kind: 'batch'
        resources: Array<{ uuid: string; type: ResourceType; name: string }>
        skipped: number
      }
  type StopTarget =
    | { kind: 'single'; uuid: string; type: ResourceType; name: string }
    | { kind: 'batch'; ids: string[]; names: string[] }
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [stopTarget, setStopTarget] = useState<StopTarget | null>(null)
  type CloneTarget = { uuid: string; type: ResourceType; name: string }
  const [cloneTarget, setCloneTarget] = useState<CloneTarget | null>(null)
  type BatchCloneTarget = { type: ResourceType; sources: Array<{ uuid: string; name: string }> }
  const [batchCloneTarget, setBatchCloneTarget] = useState<BatchCloneTarget | null>(null)
  const [propertiesTarget, setPropertiesTarget] = useState<{
    uuid: string
    type: ResourceType
    projectName: string
    environmentName: string
  } | null>(null)
  const [refreshSignal, setRefreshSignal] = useState(0)

  const findName = useCallback(
    (uuid: string) =>
      applications.find((a) => a.uuid === uuid)?.name ||
      services.find((s) => s.uuid === uuid)?.name ||
      databases.find((d) => d.uuid === uuid)?.name ||
      'Resource',
    [applications, services, databases],
  )

  // Resolve a `type:uuid` selection id back to the resource it refers to, so
  // batch logic can inspect the resource's real status before acting.
  const findResource = useCallback(
    (id: string) => {
      const [type, uuid] = id.split(':') as [ResourceType, string]
      const list =
        type === 'application'
          ? applications
          : type === 'service'
            ? services
            : databases
      return { type, resource: list.find((r) => r.uuid === uuid) }
    },
    [applications, services, databases],
  )

  const selectedDeleteTargets = useMemo(() => {
    const targets: Array<{
      uuid: string
      type: ResourceType
      name: string
    }> = []
    for (const id of selected) {
      const { type, resource } = findResource(id)
      if (!resource || isResourceBusy(resource.uuid)) continue
      targets.push({
        uuid: resource.uuid,
        type,
        name: resource.name || 'Resource',
      })
    }
    return targets
  }, [selected, findResource, isResourceBusy])

  const batchDisabledReason = useCallback(
    (action: BatchAction): string | undefined => {
      if (selected.size === 0) return 'No resources selected'
      let eligible = 0
      let skipped = 0
      for (const id of selected) {
        const { type, resource } = findResource(id)
        if (type === 'database' && action === 'deploy') continue
        if (resource && canRunAction(action, (resource as { status?: string }).status)) {
          eligible += 1
        } else {
          skipped += 1
        }
      }
      if (eligible > 0) return undefined
      if (skipped === 0) return 'No resources selected'
      return action === 'deploy'
        ? 'No selected resource can be redeployed (databases and stopped resources are skipped)'
        : `No selected resource can ${action} in its current state`
    },
    [selected, findResource],
  )

  const addToast = useCallback((message: string, type: Toast['type']) => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4000)
  }, [])

  const handleToggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const executeAction = useCallback(
    async (
      uuid: string,
      type: ResourceType,
      action: RowAction,
      deleteOpts?: DeleteOptions,
    ) => {
      if (!client) {
        addToast('Coolify is not configured', 'error')
        return
      }
      if (action === 'clone' || action === 'properties') return
      if (isResourceBusy(uuid)) {
        // Another request is in flight for this resource; ignore the click.
        return
      }
      if (type === 'database' && action === 'deploy') {
        addToast('Databases cannot be deployed', 'error')
        return
      }
      const status =
        type === 'application'
          ? applications.find((a) => a.uuid === uuid)?.status
          : type === 'service'
            ? services.find((s) => s.uuid === uuid)?.status
            : databases.find((d) => d.uuid === uuid)?.status
      if (action !== 'delete' && !canRunAction(action, status)) {
        addToast(
          `Cannot ${action}: resource is not in a valid state`,
          'error',
        )
        return
      }
      startPending(uuid, type, action)
      try {
        if (type === 'application') {
          if (action === 'start') await client.startApplication(uuid)
          else if (action === 'stop') await client.stopApplication(uuid)
          else if (action === 'restart') await client.restartApplication(uuid)
          // App deploy/redeploy = the start endpoint: queues a full
          // deployment (rolling update if possible).
          else if (action === 'deploy') await client.startApplication(uuid)
          else await client.deleteApplication(uuid, deleteOpts)
        } else if (type === 'service') {
          if (action === 'start') await client.startService(uuid)
          else if (action === 'stop') await client.stopService(uuid)
          else if (action === 'restart') await client.restartService(uuid)
          // Service redeploy equivalent: restart pulling latest images.
          else if (action === 'deploy')
            await client.restartService(uuid, { latest: true })
          else await client.deleteService(uuid, deleteOpts)
        } else {
          if (action === 'start') await client.startDatabase(uuid)
          else if (action === 'stop') await client.stopDatabase(uuid)
          else if (action === 'restart') await client.restartDatabase(uuid)
          else await client.deleteDatabase(uuid, deleteOpts)
        }
        addToast(
          `${action.charAt(0).toUpperCase() + action.slice(1)} ${type} queued`,
          'success',
        )
      } catch (err) {
        addToast(err instanceof Error ? err.message : 'Action failed', 'error')
        // API failed: nothing to wait for; release the flag immediately.
        clearPending(uuid)
      }
      // On success we leave `pending` in place — the resolver effect clears
      // it once the resource's real status reflects the expected outcome.
      refetchByType(type)
    },
    [client, addToast, refetchByType, isResourceBusy, startPending, clearPending, applications, services, databases],
  )

  const handleAction = useCallback(
    (
      uuid: string,
      type: ResourceType,
      action: RowAction,
      projectName?: string,
      environmentName?: string,
    ) => {
      if (isResourceBusy(uuid)) return
      if (action === 'properties') {
        setPropertiesTarget({ uuid, type, projectName: projectName ?? '', environmentName: environmentName ?? '' })
        return
      }
      if (action === 'clone') {
        setCloneTarget({ uuid, type, name: findName(uuid) })
        return
      }
      if (action === 'delete') {
        setDeleteTarget({ kind: 'single', uuid, type, name: findName(uuid) })
        return
      }
      if (action === 'stop') {
        setStopTarget({ kind: 'single', uuid, type, name: findName(uuid) })
        return
      }
      void executeAction(uuid, type, action)
    },
    [executeAction, findName, isResourceBusy],
  )

  const handleBatchAdd = useCallback(
    (
      uuid: string,
      type: ResourceType,
      action: BatchAction,
      deleteOptions?: DeleteOptions,
    ) => {
      if (isResourceBusy(uuid)) return
      if (type === 'database' && action === 'deploy') {
        addToast('Databases cannot be deployed', 'error')
        return
      }
      const enqueued = queue.enqueue(
        uuid,
        type,
        findName(uuid),
        action,
        deleteOptions,
      )
      if (enqueued) startPending(uuid, type, action)
    },
    [queue, findName, isResourceBusy, startPending, addToast],
  )

  const handleRename = useCallback(
    async (uuid: string, type: ResourceType, newName: string) => {
      if (!client) {
        addToast('Coolify is not configured', 'error')
        return false
      }
      if (isResourceBusy(uuid)) {
        addToast('Request in progress', 'error')
        return false
      }
      const trimmed = newName.trim()
      if (!trimmed) {
        addToast('Name cannot be empty', 'error')
        return false
      }
      try {
        if (type === 'application') {
          await client.updateApplication(uuid, { name: trimmed })
        } else if (type === 'service') {
          await client.updateService(uuid, { name: trimmed })
        } else {
          await client.updateDatabase(uuid, { name: trimmed })
        }
        addToast(`Renamed ${type} to «${trimmed}»`, 'success')
        refetchByType(type)
        return true
      } catch (err) {
        addToast(err instanceof Error ? err.message : 'Rename failed', 'error')
        return false
      }
    },
    [client, addToast, refetchByType, isResourceBusy],
  )

  const handleBatchAction = useCallback(
    (action: BatchAction) => {
      const entries = Array.from(selected)
      if (action === 'delete') {
        if (selectedDeleteTargets.length === 0) {
          addToast('No selected resource can be deleted', 'error')
          return
        }
        setDeleteTarget({
          kind: 'batch',
          resources: selectedDeleteTargets,
          skipped: entries.length - selectedDeleteTargets.length,
        })
        return
      }
      if (action === 'stop') {
        // Stop is disruptive: confirm before queuing anything.
        setStopTarget({
          kind: 'batch',
          ids: entries,
          names: entries.map((id) => findName(id.split(':')[1] as string)),
        })
        return
      }
      let skippedDatabases = 0
      let skippedByState = 0
      for (const id of entries) {
        const { type, resource } = findResource(id)
        if (type === 'database' && action === 'deploy') {
          skippedDatabases += 1
          continue
        }
        if (
          !resource ||
          !canRunAction(action, (resource as { status?: string }).status)
        ) {
          skippedByState += 1
          continue
        }
        handleBatchAdd(resource.uuid, type, action)
      }
      const skipped = skippedDatabases + skippedByState
      if (skipped > 0) {
        const parts: string[] = []
        if (skippedDatabases > 0)
          parts.push(
            `${skippedDatabases} database${skippedDatabases > 1 ? 's' : ''} (deploy not available)`,
          )
        if (skippedByState > 0)
          parts.push(
            `${skippedByState} resource${skippedByState > 1 ? 's' : ''} (not in a valid state)`,
          )
        addToast(
          `${parts.join(', ')} skipped from ${action}`,
          'error',
        )
      }
      setSelected(new Set())
    },
    [
      selected,
      selectedDeleteTargets,
      handleBatchAdd,
      findResource,
      findName,
      addToast,
    ],
  )

  const confirmStop = useCallback(() => {
    const target = stopTarget
    setStopTarget(null)
    if (!target) return
    if (target.kind === 'single') {
      void executeAction(target.uuid, target.type, 'stop')
      return
    }
    for (const id of target.ids) {
      const [type, uuid] = id.split(':') as [ResourceType, string]
      handleBatchAdd(uuid, type, 'stop')
    }
    setSelected(new Set())
  }, [stopTarget, executeAction, handleBatchAdd])

  const confirmDelete = useCallback(
    (opts: DeleteOptions) => {
      const target = deleteTarget
      setDeleteTarget(null)
      if (!target) return
      if (target.kind === 'single') {
        void executeAction(target.uuid, target.type, 'delete', opts)
        return
      }

      let skipped = target.skipped
      for (const resource of target.resources) {
        if (isResourceBusy(resource.uuid)) {
          skipped += 1
          continue
        }
        const enqueued = queue.enqueue(
          resource.uuid,
          resource.type,
          resource.name,
          'delete',
          opts,
        )
        if (enqueued) startPending(resource.uuid, resource.type, 'delete')
        else skipped += 1
      }
      if (skipped > 0) {
        addToast(
          `${skipped} resource${skipped === 1 ? '' : 's'} skipped from delete`,
          'error',
        )
      }
      setSelected(new Set())
    },
    [
      deleteTarget,
      executeAction,
      isResourceBusy,
      queue,
      startPending,
      addToast,
    ],
  )

  // Batch clone: only allowed when all selected resources share a type and
  // every one of them is cloneable.
  const handleBatchClone = useCallback(() => {
    const entries = Array.from(selected)
    if (entries.length === 0) return
    const first = findResource(entries[0]!)
    const sources = entries
      .map((id) => {
        const { type, resource } = findResource(id)
        if (type !== first.type) return null
        if (!resource || !isCloneable(resource, type)) return null
        return { uuid: resource.uuid, name: (resource as { name?: string }).name || 'Resource' }
      })
      .filter((s): s is { uuid: string; name: string } => s !== null)
    if (sources.length === 0) return
    setBatchCloneTarget({ type: first.type, sources })
    setSelected(new Set())
  }, [selected, findResource])

  // Disabled reason for the batch clone button.
  const batchCloneDisabledReason = useCallback((): string | undefined => {
    if (selected.size === 0) return 'No resources selected'
    const types = new Set<ResourceType>()
    for (const id of selected) {
      types.add(findResource(id).type)
    }
    if (types.size > 1) return 'Select resources of the same type'
    const [type] = types
    let eligible = 0
    let skipped = 0
    for (const id of selected) {
      const { resource } = findResource(id)
      if (resource && isCloneable(resource, type!)) eligible += 1
      else skipped += 1
    }
    if (eligible === 0) return 'No selected resource can be cloned'
    if (skipped > 0) {
      return `Clone available for ${eligible} of ${selected.size} selected`
    }
    return undefined
  }, [selected, findResource])


  const handleCloned = useCallback(
    (type: ResourceType, results: BatchCloneResultItem[]) => {
      setCloneTarget(null)
      setBatchCloneTarget(null)
      const ok = results.filter((r) => !r.error)
      const failed = results.filter((r) => r.error)
      const totalEnvCopied = ok.reduce((acc, r) => acc + r.envCopied, 0)
      const totalEnvSkipped = ok.reduce((acc, r) => acc + r.envSkipped, 0)
      const envPart =
        totalEnvSkipped > 0
          ? ` (${totalEnvCopied} env vars copied, ${totalEnvSkipped} skipped)`
          : ok.length > 0
            ? ` (${totalEnvCopied} env vars copied)`
            : ''
      if (ok.length > 0) {
        addToast(
          ok.length === 1
            ? `Clone ${type} created stopped${envPart}`
            : `Cloned ${ok.length} ${type}s stopped${envPart}`,
          'success',
        )
      }
      if (failed.length > 0) {
        addToast(
          `${failed.length} clone${failed.length > 1 ? 's' : ''} failed (${failed[0]?.error ?? 'unknown error'})`,
          'error',
        )
      }
      setRefreshSignal((n) => n + 1)
      refetchByType(type)
    },
    [addToast, refetchByType],
  )

  // Resolver: when the resource's status reflects the expected outcome of a
  // pending action, clear the flag. Also enforces a hard safety timeout so
  // a pill cannot get permanently stuck if Coolify never converges.
  const PENDING_TIMEOUT_MS = 120_000
  const RESTART_MIN_AGE_MS = 8_000
  useEffect(() => {
    if (pending.size === 0) return
    const now = Date.now()
    const toClear: string[] = []
    for (const [uuid, p] of pending) {
      const age = now - p.startedAt
      if (age > PENDING_TIMEOUT_MS) {
        toClear.push(uuid)
        continue
      }
      const list =
        p.type === 'application'
          ? applications
          : p.type === 'service'
            ? services
            : databases
      const resource = list.find((r) => r.uuid === uuid) as
        | { status?: string }
        | undefined
      if (p.action === 'delete') {
        if (!resource) toClear.push(uuid)
        continue
      }
      if (!resource) continue
      const active = isResourceActive(resource.status)
      if (p.action === 'start' && active) toClear.push(uuid)
      else if (p.action === 'stop' && !active) toClear.push(uuid)
      else if (
        (p.action === 'restart' || p.action === 'deploy') &&
        active &&
        age >= RESTART_MIN_AGE_MS
      )
        toClear.push(uuid)
    }
    if (toClear.length === 0) return
    // Cascading update is bounded: each entry resolves at most once per
    // data refetch, the resolver only fires while pending.size > 0, and
    // we early-return when nothing needs clearing.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending((prev) => {
      const next = new Map(prev)
      for (const uuid of toClear) next.delete(uuid)
      return next
    })
  }, [pending, applications, services, databases])

  // While any action is pending, poll the relevant lists every few seconds
  // so the pill clears soon after the container actually transitions.
  useEffect(() => {
    if (pending.size === 0) return
    const types = new Set<ResourceType>()
    for (const p of pending.values()) types.add(p.type)
    const tick = () => {
      for (const t of types) {
        if (t === 'application') void refetchApplications()
        else if (t === 'service') void refetchServices()
        else void refetchDatabases()
      }
    }
    const id = window.setInterval(tick, 3000)
    return () => window.clearInterval(id)
  }, [pending, refetchApplications, refetchServices, refetchDatabases])

  const allLoading = projectsLoading || appsLoading || servicesLoading || dbsLoading

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  )

  // Selection insertion order = batch execution order. Convert the Set
  // (which preserves insertion order) into a Map<id, 1-based index> so
  // each row knows its slot in the queue.
  const selectionOrder = useMemo(() => {
    const map = new Map<string, number>()
    let i = 1
    for (const id of selected) {
      map.set(id, i)
      i += 1
    }
    return map
  }, [selected])

  return (
    <main className="min-h-screen bg-background">
      <ConfigButton />

      {!isConfigured ? (
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
          <div className="text-center">
            <Image
              src="/logo.png"
              alt="Coolisimplify"
              width={56}
              height={56}
              priority
              className="mx-auto mb-3 rounded-md"
            />
            <h1 className="mb-2 text-2xl font-semibold tracking-tight">Coolisimplify</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Configure your Coolify instance to get started.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="border-b border-border">
            <div className="mx-auto max-w-5xl px-3 py-3 pl-14 sm:px-4 sm:py-4 sm:pl-16">
              <div className="flex items-start justify-between gap-3 sm:items-center">
                <div className="flex min-w-0 items-start gap-3 sm:items-center">
                  <Image
                    src="/logo.png"
                    alt="Coolisimplify"
                    width={32}
                    height={32}
                    priority
                    className="mt-0.5 shrink-0 rounded sm:mt-0"
                  />
                  <div className="min-w-0">
                    <h1 className="truncate text-lg font-semibold tracking-tight">
                      Coolisimplify
                    </h1>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {projects.length} projects &middot; {applications.length} apps &middot;{' '}
                      {services.length} services &middot; {databases.length} databases
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {allLoading && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  <button
                    onClick={handleRefreshAll}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted sm:h-7 sm:w-7"
                    title="Refresh now"
                    aria-label="Refresh now"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-6">
            {projectsError && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:items-center">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />
                {projectsError}
              </div>
            )}

            {sortedProjects.length === 0 && !allLoading ? (
              <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground">No projects found.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sortedProjects.map((project) => (
                  <ProjectCard
                    key={project.uuid}
                    project={project}
                    applications={applications}
                    services={services}
                    databases={databases}
                    selected={selected}
                    onToggleSelect={handleToggleSelect}
                    onAction={handleAction}
                    onBatchAdd={handleBatchAdd}
                    onRename={handleRename}
                    onOpenProperties={(uuid, type, projectName, environmentName) =>
                      setPropertiesTarget({ uuid, type, projectName, environmentName })
                    }
                    isBusy={isResourceBusy}
                    busyAction={busyAction}
                    selectionOrder={selectionOrder}
                    refreshSignal={refreshSignal}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-3 bottom-3 z-40 sm:left-1/2 sm:right-auto sm:bottom-4 sm:-translate-x-1/2">
          <div className="mx-auto flex w-full max-w-md flex-wrap items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-lg sm:w-auto sm:max-w-none sm:flex-nowrap sm:px-4">
            <span className="w-full text-center text-xs font-medium text-muted-foreground sm:mr-2 sm:w-auto">
              {selected.size} selected
            </span>
            <button
              onClick={() => handleBatchAction('start')}
              disabled={!!batchDisabledReason('start')}
              title={batchDisabledReason('start') ?? 'Start selected resources'}
              className="flex h-9 flex-1 items-center justify-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:pointer-events-none disabled:opacity-40 sm:h-auto sm:flex-none sm:py-1.5"
            >
              <Play className="h-3 w-3" />
              Start
            </button>
            <button
              onClick={() => handleBatchAction('stop')}
              disabled={!!batchDisabledReason('stop')}
              title={batchDisabledReason('stop') ?? 'Stop selected resources'}
              className="flex h-9 flex-1 items-center justify-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:pointer-events-none disabled:opacity-40 sm:h-auto sm:flex-none sm:py-1.5"
            >
              <Square className="h-3 w-3" />
              Stop
            </button>
            <button
              onClick={() => handleBatchAction('restart')}
              disabled={!!batchDisabledReason('restart')}
              title={batchDisabledReason('restart') ?? 'Restart selected resources'}
              className="flex h-9 flex-1 items-center justify-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:pointer-events-none disabled:opacity-40 sm:h-auto sm:flex-none sm:py-1.5"
            >
              <RotateCcw className="h-3 w-3" />
              Restart
            </button>
            <button
              onClick={() => handleBatchAction('deploy')}
              disabled={!!batchDisabledReason('deploy')}
              title={
                batchDisabledReason('deploy') ??
                'Redeploy selected (rolling update if possible); databases are skipped'
              }
              className="flex h-9 flex-1 items-center justify-center gap-1 rounded-md border border-black bg-black px-2.5 text-xs font-medium text-white hover:bg-black/80 disabled:pointer-events-none disabled:opacity-40 dark:border-white dark:bg-white dark:text-black dark:hover:bg-white/80 sm:h-auto sm:flex-none sm:py-1.5"
            >
              <Rocket className="h-3 w-3" />
              Redeploy
            </button>
            <button
              onClick={handleBatchClone}
              disabled={!!batchCloneDisabledReason()}
              title={batchCloneDisabledReason() ?? 'Clone selected resources'}
              className="flex h-9 flex-1 items-center justify-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:pointer-events-none disabled:opacity-40 sm:h-auto sm:flex-none sm:py-1.5"
            >
              <Copy className="h-3 w-3" />
              Clone
            </button>
            <button
              onClick={() => handleBatchAction('delete')}
              disabled={selectedDeleteTargets.length === 0}
              title={
                selectedDeleteTargets.length === 0
                  ? 'No selected resource can be deleted'
                  : 'Delete selected resources'
              }
              className="flex h-9 flex-1 items-center justify-center gap-1 rounded-md border border-destructive/40 px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-40 sm:h-auto sm:flex-none sm:py-1.5"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
            <div className="hidden h-4 w-px bg-border sm:mx-1 sm:block" />
            <button
              onClick={() => setSelected(new Set())}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted sm:h-auto sm:w-auto sm:p-1.5"
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <BatchQueue
        items={queue.items}
        onClearCompleted={queue.clearCompleted}
        onClearAll={queue.clearAll}
        elevated={selected.size > 0}
      />

      {deleteTarget?.kind === 'single' && (
        <DeleteConfirmDialog
          key={deleteTarget.uuid}
          resourceName={deleteTarget.name}
          resourceType={deleteTarget.type}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
      {deleteTarget?.kind === 'batch' && (
        <BatchDeleteConfirmDialog
          resources={deleteTarget.resources}
          skipped={deleteTarget.skipped}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
      {stopTarget && (
        <StopConfirmDialog
          names={
            stopTarget.kind === 'single' ? [stopTarget.name] : stopTarget.names
          }
          onCancel={() => setStopTarget(null)}
          onConfirm={confirmStop}
        />
      )}
      {cloneTarget && (() => {
        const { resource } = findResource(`${cloneTarget.type}:${cloneTarget.uuid}`)
        if (!resource) return null
        return (
          <CloneDialog
            sources={[{ uuid: resource.uuid, name: (resource as { name?: string }).name || 'Resource' }]}
            sourceType={cloneTarget.type}
            onCancel={() => setCloneTarget(null)}
            onCloned={handleCloned}
          />
        )
      })()}
      {batchCloneTarget && (
        <CloneDialog
          sources={batchCloneTarget.sources}
          sourceType={batchCloneTarget.type}
          onCancel={() => setBatchCloneTarget(null)}
          onCloned={handleCloned}
        />
      )}
      {propertiesTarget && (() => {
        const { resource } = findResource(
          `${propertiesTarget.type}:${propertiesTarget.uuid}`,
        )
        if (!resource) return null
        return (
          <ResourcePropertiesDialog
            resource={resource}
            type={propertiesTarget.type}
            projectName={propertiesTarget.projectName}
            environmentName={propertiesTarget.environmentName}
            onClose={() => setPropertiesTarget(null)}
            onNotify={addToast}
          />
        )
      })()}

      <div className="fixed inset-x-3 top-16 z-50 flex flex-col gap-2 sm:left-auto sm:right-4 sm:top-4 sm:w-80">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-sm sm:items-center',
              toast.type === 'error'
                ? 'border-destructive/20 bg-destructive/5 text-destructive'
                : 'border-black/10 bg-black/5 text-black dark:border-white/10 dark:bg-white/5 dark:text-white',
            )}
          >
            {toast.type === 'error' ? (
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 sm:mt-0" />
            ) : (
              <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0 sm:mt-0" />
            )}
            {toast.message}
          </div>
        ))}
      </div>
    </main>
  )
}
