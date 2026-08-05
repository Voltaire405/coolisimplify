'use client'

import Image from 'next/image'
import { Suspense, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useSettings } from '@/hooks/use-settings'
import {
  useProjects,
  useApplications,
  useServices,
  useDatabases,
  useAllEnvironments,
  useBatchQueue,
  useClient,
  isResourceActive,
} from '@/hooks/use-coolify'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ConfigButton } from '@/components/config-button'
import { Sidebar } from '@/components/sidebar'
import { EnvironmentSection } from '@/components/environment-section'
import { BatchQueue } from '@/components/batch-queue'
import { ResourceDrawer, type DrawerTab } from '@/components/resource-drawer'
import { Toolbar, type StatusFilter, type TypeFilter } from '@/components/toolbar'
import { CommandPalette, type PaletteItem } from '@/components/command-palette'
import {
  BatchDeleteConfirmDialog,
  DeleteConfirmDialog,
  StopConfirmDialog,
} from '@/components/confirm-dialog'
import { CloneDialog } from '@/components/clone-dialog'
import { LogsDialog } from '@/components/logs-dialog'
import { DEFAULT_LOG_LINES, type LogLineOption } from '@/lib/logs'
import { BatchConfigDialog } from '@/components/batch-config-dialog'
import type { BatchCloneResultItem } from '@/lib/clone'
import { isCloneable } from '@/lib/clone'
import {
  batchConfigTarget,
  sharedConfigValue,
  editableConfig,
  redeployClearedBy,
  type BatchConfigApp,
  type BatchConfigTarget,
} from '@/lib/app-detail'
import {
  Play,
  Square,
  RotateCcw,
  Rocket,
  Copy,
  GitBranch,
  Trash2,
  X,
  Loader2,
  AlertCircle,
  RefreshCw,
  Menu,
} from 'lucide-react'
import type { ResourceType, BatchAction, RowAction } from '@/hooks/use-coolify'
import type { DeleteOptions, Environment, Project } from '@/lib/types'
import { cn } from '@workspace/ui/lib/utils'
import {
  canRunAction,
  classifyResourceState,
  rollupFromStatus,
  worseRollup,
  type RollupState,
} from '@/lib/resource-state'
import {
  compareResources,
  decodeDrawerTarget,
  decodeNode,
  encodeDrawerTarget,
  encodeNode,
  TREE_EXPANDED_STORAGE_KEY,
  type ResourceWithType,
  type TreeNode,
} from '@/lib/tree'

interface Toast {
  id: string
  message: string
  type: 'success' | 'error'
}

interface Section {
  key: string
  title: string
  projectName: string
  environmentName: string
  resources: ResourceWithType[]
}

function findDrawerContext(
  envId: number | undefined,
  projects: Project[],
  environmentsByProject: Record<string, Environment[]>,
): { projectName: string; environmentName: string } {
  if (envId == null) return { projectName: '', environmentName: '' }
  for (const project of projects) {
    const env = (environmentsByProject[project.uuid] ?? []).find(
      (e) => e.id === envId,
    )
    if (env) return { projectName: project.name, environmentName: env.name }
  }
  return { projectName: '', environmentName: '' }
}

function DashboardPage() {
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
  const {
    byProject: environmentsByProject,
    loaded: environmentsLoaded,
    refetch: refetchAllEnvironments,
  } = useAllEnvironments(projects)

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
    void refetchAllEnvironments()
    void refetchApplications()
    void refetchServices()
    void refetchDatabases()
  }, [
    refetchProjects,
    refetchAllEnvironments,
    refetchApplications,
    refetchServices,
    refetchDatabases,
  ])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [toasts, setToasts] = useState<Toast[]>([])

  // Redeploy-needed markers (ADR-0005): uuids of Applications whose config was
  // edited but not yet applied. Client-derived, not persisted — cleared when a
  // converging action clears it (see the pending resolver below).
  const [redeployNeeded, setRedeployNeeded] = useState<Set<string>>(new Set())

  // Sidebar navigation. The selected node lives in the URL (?node=…) so
  // back/forward and deep links work; the expanded-project set is UI noise
  // and goes to localStorage instead.
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const node = useMemo(() => decodeNode(searchParams.get('node')), [searchParams])
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [treeHydrated, setTreeHydrated] = useState(false)
  useEffect(() => {
    let stored: Set<string> | null = null
    try {
      const raw = window.localStorage.getItem(TREE_EXPANDED_STORAGE_KEY)
      if (raw) stored = new Set(JSON.parse(raw) as string[])
    } catch {
      // Unreadable storage: start with everything collapsed.
    }
    // One-shot hydration from localStorage before the tree is interacted with.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedProjects((prev) => stored ?? prev)
    setTreeHydrated(true)
  }, [])
  useEffect(() => {
    if (!treeHydrated) return
    window.localStorage.setItem(
      TREE_EXPANDED_STORAGE_KEY,
      JSON.stringify([...expandedProjects]),
    )
  }, [expandedProjects, treeHydrated])

  // Deep links land with the tree in whatever state localStorage had; make
  // sure the selected node's project is revealed.
  useEffect(() => {
    if (!treeHydrated || node.kind === 'all') return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedProjects((prev) =>
      prev.has(node.projectUuid) ? prev : new Set(prev).add(node.projectUuid),
    )
  }, [node, treeHydrated])

  const selectNode = useCallback(
    (next: TreeNode) => {
      // Selecting inside a project also reveals it in the tree.
      if (next.kind !== 'all') {
        setExpandedProjects((prev) =>
          prev.has(next.projectUuid) ? prev : new Set(prev).add(next.projectUuid),
        )
      }
      const params = new URLSearchParams(searchParams.toString())
      const encoded = encodeNode(next)
      if (encoded) params.set('node', encoded)
      else params.delete('node')
      const query = params.toString()
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false })
      setMobileNavOpen(false)
    },
    [searchParams, router, pathname],
  )

  const toggleProjectExpanded = useCallback((uuid: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(uuid)) next.delete(uuid)
      else next.add(uuid)
      return next
    })
  }, [])

  // Drawer state also lives in the URL: ?drawer=type:uuid&tab=details|vars.
  const drawerTarget = useMemo(
    () => decodeDrawerTarget(searchParams.get('drawer')),
    [searchParams],
  )
  const drawerTab: DrawerTab = searchParams.get('tab') === 'vars' ? 'vars' : 'details'

  const openDrawer = useCallback(
    (type: ResourceType, uuid: string, tab: DrawerTab) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('drawer', encodeDrawerTarget({ type, uuid }))
      params.set('tab', tab)
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [searchParams, router, pathname],
  )

  const closeDrawer = useCallback(
    (opts?: { replace?: boolean }) => {
      const params = new URLSearchParams(searchParams.toString())
      params.delete('drawer')
      params.delete('tab')
      const query = params.toString()
      const url = query ? `${pathname}?${query}` : pathname
      if (opts?.replace) router.replace(url, { scroll: false })
      else router.push(url, { scroll: false })
    },
    [searchParams, router, pathname],
  )

  const setDrawerTab = useCallback(
    (tab: DrawerTab) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('tab', tab)
      // Tab switches replace instead of push so back still closes the drawer.
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [searchParams, router, pathname],
  )

  // Toolbar filters are view state, not navigation state: they stay local
  // and reset on reload (only node/drawer live in the URL).
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [problemsOnly, setProblemsOnly] = useState(false)
  const filtersActive =
    query.trim() !== '' ||
    typeFilter !== 'all' ||
    statusFilter !== 'all' ||
    problemsOnly

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  useEffect(() => {
    if (!highlightId) return
    const id = window.setTimeout(() => setHighlightId(null), 2500)
    return () => window.clearTimeout(id)
  }, [highlightId])

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
  // Batch "Edit config": the composed apps + shared target for the dialog.
  type BatchConfigTargetState = {
    apps: BatchConfigApp[]
    target: BatchConfigTarget
    sharedValue: string
  }
  const [batchConfigTargetState, setBatchConfigTargetState] =
    useState<BatchConfigTargetState | null>(null)
  type LogsTarget = { uuid: string; name: string }
  const [logsTarget, setLogsTarget] = useState<LogsTarget | null>(null)
  // Viewer settings live here rather than inside the dialog so they carry over
  // to the next resource you open. Deliberately not persisted: a 5000-line
  // window should not outlive the tab that asked for it.
  const [logLines, setLogLines] = useState<LogLineOption>(DEFAULT_LOG_LINES)
  const [logTimestamps, setLogTimestamps] = useState(false)

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
      // Only the mutating actions reach here; the read-only ones (properties,
      // variables, clone, logs) are handled by handleAction and never dispatch.
      action: BatchAction,
      deleteOpts?: DeleteOptions,
    ) => {
      if (!client) {
        addToast('Coolify is not configured', 'error')
        return
      }
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
    (uuid: string, type: ResourceType, action: RowAction) => {
      // Ahead of the busy guard: reading logs mutates nothing, and a deploy in
      // flight is exactly when they matter.
      if (action === 'logs') {
        setLogsTarget({ uuid, name: findName(uuid) })
        return
      }
      if (isResourceBusy(uuid)) return
      if (action === 'properties') {
        openDrawer(type, uuid, 'details')
        return
      }
      if (action === 'variables') {
        openDrawer(type, uuid, 'vars')
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
    [executeAction, findName, isResourceBusy, openDrawer],
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

  // Persist an edited Docker image tag or git branch (ADR-0005). The drawer
  // passes the current resource value; the no-op guard lives in the editor.
  const handleConfigEdit = useCallback(
    async (uuid: string, payload: Record<string, unknown>): Promise<boolean> => {
      if (!client) {
        addToast('Coolify is not configured', 'error')
        return false
      }
      if (isResourceBusy(uuid)) {
        addToast('Request in progress', 'error')
        return false
      }
      try {
        await client.updateApplication(uuid, payload)
        addToast('Configuration saved', 'success')
        setRedeployNeeded((prev) => new Set(prev).add(uuid))
        refetchByType('application')
        return true
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : 'Save failed',
          'error',
        )
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

  // Compose the batch "Edit config" dialog state from the current selection:
  // only Applications, all of the same kind (git or dockerimage). The shared
  // value is pre-filled when every app already uses it.
  const handleOpenBatchConfig = useCallback(() => {
    const entries = Array.from(selected)
    const built: BatchConfigApp[] = []
    const appResources: Parameters<typeof batchConfigTarget>[0] = []
    for (const id of entries) {
      const { type, resource } = findResource(id)
      if (type !== 'application' || !resource) continue
      const app = resource as { name?: string; status?: string } & Parameters<typeof editableConfig>[0]
      const editable = editableConfig(app)
      if (!editable) continue
      built.push({
        uuid: resource.uuid,
        name: app.name || 'Unnamed',
        target: editable.kind,
        current: editable.value,
        assigned: editable.value,
        overridden: false,
        canDeploy: canRunAction('deploy', app.status),
      })
      appResources.push(resource as Parameters<typeof batchConfigTarget>[0][number])
    }
    const target = batchConfigTarget(appResources)
    if (built.length === 0 || !target) {
      addToast('Select only git or docker-image applications', 'error')
      return
    }
    setBatchConfigTargetState({
      apps: built,
      target,
      sharedValue: sharedConfigValue(built),
    })
  }, [selected, findResource, addToast])

  // Disabled reason for the batch "Edit config" button.
  const batchConfigDisabledReason = useCallback((): string | undefined => {
    if (selected.size === 0) return 'No resources selected'
    const entries = Array.from(selected)
    let apps = 0
    let nonApps = 0
    for (const id of entries) {
      const { type, resource } = findResource(id)
      if (type !== 'application' || !resource) {
        nonApps += 1
        continue
      }
      const editable = editableConfig(resource as Parameters<typeof editableConfig>[0])
      if (!editable) {
        nonApps += 1
        continue
      }
      apps += 1
    }
    if (apps === 0) return 'No selectable application in the selection'
    if (nonApps > 0) return 'Only git and docker-image applications can be edited'
    const appList = entries
      .map((id) => {
        const { resource } = findResource(id)
        return (resource ?? {}) as Parameters<typeof batchConfigTarget>[0][number]
      })
      .filter(Boolean)
    const target = batchConfigTarget(appList)
    if (!target) return 'Select only git or only docker-image applications'
    return undefined
  }, [selected, findResource])

  // Confirm handler for the batch config dialog: PATCH changed apps in
  // parallel, then queue redeploys for the deployable ones (ADR-0005: marker
  // only for changed-but-not-redeployed apps).
  const handleBatchConfigConfirm = useCallback(
    async (
      changed: Array<{ app: BatchConfigApp; value: string }>,
      redeploy: boolean,
    ) => {
      if (!client) {
        addToast('Coolify is not configured', 'error')
        return
      }
      const deployable = changed.filter((c) => c.app.canDeploy)
      const skippedApps = changed.filter((c) => !c.app.canDeploy)

      // 1. Save all changes in parallel; a failure on one app does not abort
      //    the rest.
      const results = await Promise.all(
        changed.map(async (c) => {
          try {
            await client.updateApplication(
              c.app.uuid,
              c.app.target === 'tag'
                ? { docker_registry_image_tag: c.value }
                : { git_branch: c.value },
            )
            return { ok: true as const, app: c.app }
          } catch (err) {
            return {
              ok: false as const,
              app: c.app,
              error: err instanceof Error ? err.message : 'Save failed',
            }
          }
        }),
      )
      const saved = results.filter((r) => r.ok).map((r) => r.app)
      const failed = results.filter((r) => !r.ok)

      // 2. Raise the marker for changed apps that were saved but cannot be
      //    redeployed (stopped) — their change is genuinely un-applied. Only
      //    for apps whose PATCH actually succeeded.
      const savedSkipped = skippedApps.filter((c) =>
        results.some((r) => r.ok && r.app.uuid === c.app.uuid),
      )
      if (savedSkipped.length > 0) {
        setRedeployNeeded((prev) => {
          const next = new Set(prev)
          for (const c of savedSkipped) next.add(c.app.uuid)
          return next
        })
      }

      // 3. Queue redeploys for the deployable, saved apps via the existing
      //    sequential batch queue.
      if (redeploy) {
        for (const c of deployable) {
          if (!results.find((r) => r.ok && r.app.uuid === c.app.uuid)) continue
          handleBatchAdd(c.app.uuid, 'application', 'deploy')
        }
      }

      setBatchConfigTargetState(null)
      refetchByType('application')

      const savedDeployable = deployable.filter((c) =>
        results.some((r) => r.ok && r.app.uuid === c.app.uuid),
      )
      const parts: string[] = []
      if (saved.length > 0)
        parts.push(`${saved.length} saved`)
      if (redeploy && savedDeployable.length > 0)
        parts.push(`${savedDeployable.length} redeploying`)
      if (savedSkipped.length > 0)
        parts.push(`${savedSkipped.length} skipped (not running)`)
      if (failed.length > 0) {
        addToast(
          `${failed.length} failed to save (${failed[0]?.error ?? 'unknown error'})`,
          'error',
        )
      }
      if (parts.length > 0) addToast(parts.join(', '), 'success')
    },
    [client, addToast, handleBatchAdd, refetchByType],
  )

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
      void refetchAllEnvironments()
      refetchByType(type)
    },
    [addToast, refetchAllEnvironments, refetchByType],
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
    const toClearRedeploy: string[] = []
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
        | { status?: string; build_pack?: string }
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
      ) {
        toClear.push(uuid)
        // A converging deploy clears the marker for all apps; a converging
        // restart only for dockerimage apps (ADR-0005).
        if (redeployClearedBy(resource.build_pack, p.action)) {
          toClearRedeploy.push(uuid)
        }
      }
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
    if (toClearRedeploy.length > 0) {
      setRedeployNeeded((prev) => {
        const next = new Set(prev)
        for (const uuid of toClearRedeploy) next.delete(uuid)
        return next
      })
    }
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

  const allResources = useMemo<ResourceWithType[]>(
    () => [
      ...applications.map((r) => ({ type: 'application' as const, resource: r })),
      ...services.map((r) => ({ type: 'service' as const, resource: r })),
      ...databases.map((r) => ({ type: 'database' as const, resource: r })),
    ],
    [applications, services, databases],
  )

  const resourcesByEnvId = useMemo(() => {
    const map = new Map<number, ResourceWithType[]>()
    for (const item of allResources) {
      const envId = item.resource.environment_id
      if (envId == null) continue
      const group = map.get(envId)
      if (group) group.push(item)
      else map.set(envId, [item])
    }
    for (const group of map.values()) group.sort(compareResources)
    return map
  }, [allResources])

  const countsByEnvId = useMemo(() => {
    const map = new Map<number, number>()
    for (const [envId, group] of resourcesByEnvId) map.set(envId, group.length)
    return map
  }, [resourcesByEnvId])

  const rollupByEnvId = useMemo(() => {
    const map = new Map<number, RollupState>()
    for (const [envId, group] of resourcesByEnvId) {
      let rollup: RollupState = 'none'
      for (const { resource } of group) {
        rollup = worseRollup(
          rollup,
          rollupFromStatus((resource as { status?: string }).status),
        )
      }
      map.set(envId, rollup)
    }
    return map
  }, [resourcesByEnvId])

  const sections = useMemo<Section[]>(() => {
    const forProject = (project: Project, withProjectPrefix: boolean): Section[] => {
      const envs = [...(environmentsByProject[project.uuid] ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name),
      )
      return envs.map((env) => ({
        key: `${project.uuid}:${env.uuid}`,
        title: withProjectPrefix ? `${project.name} / ${env.name}` : env.name,
        projectName: project.name,
        environmentName: env.name,
        resources: resourcesByEnvId.get(env.id) ?? [],
      }))
    }
    if (node.kind === 'all') {
      // Empty environments are visible in the Sidebar; repeating them all as
      // empty headers would drown the global view.
      return sortedProjects
        .flatMap((p) => forProject(p, true))
        .filter((s) => s.resources.length > 0)
    }
    const project = sortedProjects.find((p) => p.uuid === node.projectUuid)
    if (!project) return []
    const projectSections = forProject(project, false)
    if (node.kind === 'project') return projectSections
    return projectSections.filter(
      (s) => s.key === `${project.uuid}:${node.envUuid}`,
    )
  }, [node, sortedProjects, environmentsByProject, resourcesByEnvId])

  const selectedProject = useMemo(
    () =>
      node.kind === 'all'
        ? null
        : (sortedProjects.find((p) => p.uuid === node.projectUuid) ?? null),
    [node, sortedProjects],
  )

  const mainTitle = useMemo(() => {
    if (node.kind === 'all') return 'All resources'
    if (!selectedProject) return 'Not found'
    if (node.kind === 'project') return selectedProject.name
    const envName = (environmentsByProject[selectedProject.uuid] ?? []).find(
      (e) => e.uuid === node.envUuid,
    )?.name
    return envName ? `${selectedProject.name} / ${envName}` : selectedProject.name
  }, [node, selectedProject, environmentsByProject])

  const emptyMessage =
    node.kind === 'all'
      ? sortedProjects.length === 0
        ? 'No projects found.'
        : 'No resources found.'
      : !selectedProject
        ? 'This project no longer exists.'
        : node.kind === 'project'
          ? 'No environments in this project.'
          : 'This environment no longer exists.'

  const visibleSections = useMemo<Section[]>(() => {
    if (!filtersActive) return sections
    const q = query.trim().toLowerCase()
    const matches = ({ type, resource }: ResourceWithType) => {
      if (typeFilter !== 'all' && type !== typeFilter) return false
      const status = (resource as { status?: string }).status
      if (statusFilter === 'running' && !isResourceActive(status)) return false
      if (statusFilter === 'stopped' && isResourceActive(status)) return false
      if (problemsOnly) {
        const state = classifyResourceState(status)
        if (state !== 'stopped' && state !== 'error') return false
      }
      if (q) {
        const name = (resource.name || '').toLowerCase()
        const domain = (
          (resource as { fqdn?: string | null }).fqdn || ''
        ).toLowerCase()
        const server = (
          (resource as { destination?: { server?: { name?: string } } })
            .destination?.server?.name || ''
        ).toLowerCase()
        if (!name.includes(q) && !domain.includes(q) && !server.includes(q))
          return false
      }
      return true
    }
    return sections
      .map((s) => ({ ...s, resources: s.resources.filter(matches) }))
      .filter((s) => s.resources.length > 0)
  }, [sections, filtersActive, query, typeFilter, statusFilter, problemsOnly])

  const envById = useMemo(() => {
    const map = new Map<number, { project: Project; env: Environment }>()
    for (const project of sortedProjects) {
      for (const env of environmentsByProject[project.uuid] ?? []) {
        map.set(env.id, { project, env })
      }
    }
    return map
  }, [sortedProjects, environmentsByProject])

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = []
    for (const project of sortedProjects) {
      items.push({
        id: `project:${project.uuid}`,
        kind: 'project',
        label: project.name,
        node: { kind: 'project', projectUuid: project.uuid },
      })
      for (const env of environmentsByProject[project.uuid] ?? []) {
        items.push({
          id: `env:${env.uuid}`,
          kind: 'environment',
          label: env.name,
          sublabel: project.name,
          node: { kind: 'env', projectUuid: project.uuid, envUuid: env.uuid },
        })
      }
    }
    for (const { type, resource } of allResources) {
      const ctx =
        resource.environment_id != null
          ? envById.get(resource.environment_id)
          : undefined
      const domain = (resource as { fqdn?: string | null }).fqdn || ''
      const server =
        (resource as { destination?: { server?: { name?: string } } })
          .destination?.server?.name || ''
      items.push({
        id: `${type}:${resource.uuid}`,
        kind: 'resource',
        label: resource.name || 'Unnamed',
        sublabel: ctx ? `${ctx.project.name} / ${ctx.env.name}` : undefined,
        keywords: `${domain} ${server}`,
        node: ctx
          ? { kind: 'env', projectUuid: ctx.project.uuid, envUuid: ctx.env.uuid }
          : { kind: 'all' },
        resource: { type, uuid: resource.uuid },
      })
    }
    return items
  }, [sortedProjects, environmentsByProject, allResources, envById])

  const makePaletteHref = useCallback(
    (item: PaletteItem) => {
      const params = new URLSearchParams()
      const encoded = encodeNode(item.node)
      if (encoded) params.set('node', encoded)
      if (item.resource) {
        params.set('drawer', encodeDrawerTarget(item.resource))
        params.set('tab', 'details')
      }
      const q = params.toString()
      return q ? `${pathname}?${q}` : pathname
    },
    [pathname],
  )

  const handlePaletteNavigate = useCallback(
    (item: PaletteItem, opts: { withDrawer: boolean }) => {
      if (item.node.kind !== 'all') {
        const projectUuid = item.node.projectUuid
        setExpandedProjects((prev) =>
          prev.has(projectUuid) ? prev : new Set(prev).add(projectUuid),
        )
      }
      // Single push: node and (optionally) drawer change together.
      const params = new URLSearchParams(searchParams.toString())
      const encoded = encodeNode(item.node)
      if (encoded) params.set('node', encoded)
      else params.delete('node')
      if (item.resource && opts.withDrawer) {
        params.set('drawer', encodeDrawerTarget(item.resource))
        params.set('tab', 'details')
      }
      const q = params.toString()
      router.push(q ? `${pathname}?${q}` : pathname, { scroll: false })
      // A palette jump is an explicit "go to X": active toolbar filters must
      // not hide the destination.
      setQuery('')
      setTypeFilter('all')
      setStatusFilter('all')
      setProblemsOnly(false)
      if (item.resource) {
        setHighlightId(`${item.resource.type}:${item.resource.uuid}`)
      }
      setMobileNavOpen(false)
    },
    [searchParams, router, pathname],
  )

  const drawerResource = useMemo(() => {
    if (!drawerTarget) return null
    const list =
      drawerTarget.type === 'application'
        ? applications
        : drawerTarget.type === 'service'
          ? services
          : databases
    const resource = list.find((r) => r.uuid === drawerTarget.uuid)
    return resource ? { type: drawerTarget.type, resource } : null
  }, [drawerTarget, applications, services, databases])

  // The breadcrumb is derived, not passed through: the drawer can be opened
  // from a deep link where no click ever supplied the names.
  const drawerContext = findDrawerContext(
    drawerResource?.resource.environment_id,
    sortedProjects,
    environmentsByProject,
  )

  // A deleted resource leaves a dangling drawer param; drop it once the
  // lists have loaded and the target is confirmed gone. The loading flags
  // start false before the first fetch, so an empty resource list means
  // "not loaded yet", not "gone" — never clean on it.
  useEffect(() => {
    if (!drawerTarget || drawerResource || allLoading) return
    if (allResources.length === 0) return
    closeDrawer({ replace: true })
  }, [drawerTarget, drawerResource, allLoading, allResources.length, closeDrawer])

  const sidebar = (
    <Sidebar
      projects={sortedProjects}
      environmentsByProject={environmentsByProject}
      countsByEnvId={countsByEnvId}
      rollupByEnvId={rollupByEnvId}
      totalCount={allResources.length}
      node={node}
      expanded={expandedProjects}
      onSelect={selectNode}
      onToggleExpand={toggleProjectExpanded}
    />
  )

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
            <div className="mx-auto max-w-7xl px-3 py-3 pl-14 sm:px-4 sm:py-4 sm:pl-16">
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
                    onClick={() => setMobileNavOpen(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted sm:hidden"
                    title="Browse projects"
                    aria-label="Browse projects"
                  >
                    <Menu className="h-4 w-4" />
                  </button>
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

          <div className="mx-auto flex w-full max-w-7xl">
            <aside className="hidden w-64 shrink-0 border-r border-border sm:block">
              <div className="sticky top-0 max-h-screen overflow-y-auto p-3">
                {sidebar}
              </div>
            </aside>

            <section className="min-w-0 flex-1 px-3 py-4 sm:px-6 sm:py-6">
              {projectsError && (
                <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:items-center">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />
                  {projectsError}
                </div>
              )}

              <div className="mb-4 min-w-0">
                <h2 className="truncate text-sm font-semibold tracking-tight">
                  {mainTitle}
                </h2>
                {node.kind === 'project' && selectedProject?.description && (
                  <p className="truncate text-xs text-muted-foreground">
                    {selectedProject.description}
                  </p>
                )}
              </div>

              <Toolbar
                query={query}
                onQueryChange={setQuery}
                typeFilter={typeFilter}
                onTypeFilterChange={setTypeFilter}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                problemsOnly={problemsOnly}
                onProblemsOnlyChange={setProblemsOnly}
                onOpenPalette={() => setPaletteOpen(true)}
              />

              {(node.kind !== 'all' && !environmentsLoaded) ||
              (sections.length === 0 && allLoading) ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : visibleSections.length > 0 ? (
                <div className="space-y-5">
                  {visibleSections.map((section) => (
                    <EnvironmentSection
                      key={section.key}
                      title={section.title}
                      projectName={section.projectName}
                      environmentName={section.environmentName}
                      resources={section.resources}
                      selected={selected}
                      onToggleSelect={handleToggleSelect}
                      onAction={handleAction}
                      onBatchAdd={handleBatchAdd}
                      onRename={handleRename}
                      redeployNeeded={redeployNeeded}
                      onOpenProperties={(uuid, type) =>
                        openDrawer(type, uuid, 'details')
                      }
                      isBusy={isResourceBusy}
                      busyAction={busyAction}
                      selectionOrder={selectionOrder}
                      highlightId={highlightId}
                    />
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    {filtersActive && sections.length > 0
                      ? 'No resources match the current filters.'
                      : emptyMessage}
                  </p>
                </div>
              )}
            </section>

            {drawerResource && (
              <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l border-border bg-background shadow-xl lg:sticky lg:top-0 lg:z-auto lg:max-h-screen lg:w-[26rem] lg:max-w-none lg:shrink-0 lg:shadow-none">
                <ResourceDrawer
                  resource={drawerResource.resource}
                  type={drawerResource.type}
                  projectName={drawerContext.projectName}
                  environmentName={drawerContext.environmentName}
                  tab={drawerTab}
                  onTabChange={setDrawerTab}
                  onClose={() => closeDrawer()}
                  onNotify={addToast}
                  onConfigEdit={handleConfigEdit}
                />
              </aside>
            )}
          </div>

          {mobileNavOpen && (
            <div className="fixed inset-0 z-40 sm:hidden">
              <div
                className="absolute inset-0 bg-black/40"
                onClick={() => setMobileNavOpen(false)}
                aria-hidden
              />
              <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-border bg-background p-3 shadow-lg">
                {sidebar}
              </div>
            </div>
          )}
        </>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-3 bottom-3 z-40 sm:left-1/2 sm:right-auto sm:bottom-4 sm:-translate-x-1/2">
          <div className="mx-auto w-full max-w-md rounded-lg border border-border bg-card px-3 py-2 shadow-lg sm:w-auto sm:max-w-2xl sm:px-4">
            <div className="mb-2 flex max-h-24 flex-wrap items-center gap-1 overflow-y-auto">
              <span className="mr-1 text-xs font-medium text-muted-foreground">
                {selected.size} in queue
              </span>
              {Array.from(selected).map((id, index) => {
                const uuid = id.split(':')[1] as string
                const name = findName(uuid)
                return (
                  <span
                    key={id}
                    className="inline-flex max-w-44 items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-1.5 pr-0.5 text-xs"
                  >
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 truncate">{name}</span>
                    <button
                      type="button"
                      onClick={() => handleToggleSelect(id)}
                      aria-label={`Remove ${name} from the batch queue`}
                      title="Remove from queue"
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )
              })}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 sm:flex-nowrap">
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
              onClick={handleOpenBatchConfig}
              disabled={!!batchConfigDisabledReason()}
              title={
                batchConfigDisabledReason() ??
                'Edit branch/tag of selected applications'
              }
              className="flex h-9 flex-1 items-center justify-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:pointer-events-none disabled:opacity-40 sm:h-auto sm:flex-none sm:py-1.5"
            >
              <GitBranch className="h-3 w-3" />
              Edit config
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
        </div>
      )}

      <BatchQueue
        items={queue.items}
        onClearCompleted={queue.clearCompleted}
        onClearAll={queue.clearAll}
        elevated={selected.size > 0}
      />

      {isConfigured && (
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          items={paletteItems}
          onNavigate={handlePaletteNavigate}
          makeHref={makePaletteHref}
        />
      )}

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
      {batchConfigTargetState && (
        <BatchConfigDialog
          apps={batchConfigTargetState.apps}
          target={batchConfigTargetState.target}
          sharedValue={batchConfigTargetState.sharedValue}
          onCancel={() => setBatchConfigTargetState(null)}
          onConfirm={handleBatchConfigConfirm}
        />
      )}
      {logsTarget && (
        <LogsDialog
          uuid={logsTarget.uuid}
          name={logsTarget.name}
          lines={logLines}
          showTimestamps={logTimestamps}
          onLinesChange={setLogLines}
          onShowTimestampsChange={setLogTimestamps}
          onClose={() => setLogsTarget(null)}
        />
      )}

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

export default function Page() {
  // useSearchParams requires a Suspense boundary during prerender.
  return (
    <Suspense fallback={null}>
      <DashboardPage />
    </Suspense>
  )
}
