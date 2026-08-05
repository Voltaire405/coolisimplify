'use client'

import { ChevronDown, ChevronRight, Folder, Layers } from 'lucide-react'
import { cn } from '@workspace/ui/lib/utils'
import type { Environment, Project } from '@/lib/types'
import { worseRollup, type RollupState } from '@/lib/resource-state'
import { sameNode, type TreeNode } from '@/lib/tree'

interface SidebarProps {
  projects: Project[]
  environmentsByProject: Record<string, Environment[]>
  countsByEnvId: Map<number, number>
  /** Status Roll-up per Environment; Project and root roll-ups derive from it. */
  rollupByEnvId: Map<number, RollupState>
  totalCount: number
  node: TreeNode
  expanded: Set<string>
  onSelect: (node: TreeNode) => void
  onToggleExpand: (projectUuid: string) => void
}

function Count({ value }: { value: number }) {
  return (
    <span className="ml-auto shrink-0 px-1 text-[10px] leading-4 tabular-nums text-muted-foreground">
      {value}
    </span>
  )
}

const ROLLUP_LABEL: Record<Exclude<RollupState, 'none'>, string> = {
  problem: 'Something is stopped or failing',
  transitioning: 'Something is transitioning',
  running: 'All running',
}

function RollupLed({ state }: { state: RollupState }) {
  if (state === 'none') return null
  return (
    <span
      title={ROLLUP_LABEL[state]}
      className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        state === 'problem' && 'bg-red-500',
        state === 'transitioning' && 'bg-amber-500',
        state === 'running' && 'bg-emerald-500',
      )}
    />
  )
}

export function Sidebar({
  projects,
  environmentsByProject,
  countsByEnvId,
  rollupByEnvId,
  totalCount,
  node,
  expanded,
  onSelect,
  onToggleExpand,
}: SidebarProps) {
  const allSelected = node.kind === 'all'
  const rollupOfEnvs = (envs: Environment[]): RollupState =>
    envs.reduce<RollupState>(
      (acc, env) => worseRollup(acc, rollupByEnvId.get(env.id) ?? 'none'),
      'none',
    )
  const rootRollup = projects.reduce<RollupState>(
    (acc, project) =>
      worseRollup(acc, rollupOfEnvs(environmentsByProject[project.uuid] ?? [])),
    'none',
  )
  return (
    <nav aria-label="Projects" className="flex flex-col gap-0.5 text-sm">
      <button
        onClick={() => onSelect({ kind: 'all' })}
        aria-current={allSelected ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/60',
          allSelected && 'bg-muted font-medium',
        )}
      >
        <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">All resources</span>
        <RollupLed state={rootRollup} />
        <Count value={totalCount} />
      </button>

      {projects.map((project) => {
        const envs = [...(environmentsByProject[project.uuid] ?? [])].sort(
          (a, b) => a.name.localeCompare(b.name),
        )
        const isExpanded = expanded.has(project.uuid)
        const projectNode: TreeNode = {
          kind: 'project',
          projectUuid: project.uuid,
        }
        const projectSelected = sameNode(node, projectNode)
        const count = envs.reduce(
          (acc, env) => acc + (countsByEnvId.get(env.id) ?? 0),
          0,
        )
        return (
          <div key={project.uuid}>
            <div
              className={cn(
                'flex items-center rounded-md hover:bg-muted/60',
                projectSelected && 'bg-muted',
              )}
            >
              <button
                onClick={() => onToggleExpand(project.uuid)}
                aria-label={
                  isExpanded
                    ? `Collapse ${project.name}`
                    : `Expand ${project.name}`
                }
                aria-expanded={isExpanded}
                className="flex h-7 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                onClick={() => onSelect(projectNode)}
                aria-current={projectSelected ? 'page' : undefined}
                title={project.description || project.name}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left',
                  projectSelected && 'font-medium',
                )}
              >
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <RollupLed state={rollupOfEnvs(envs)} />
                <Count value={count} />
              </button>
            </div>
            {isExpanded && (
              <div className="flex flex-col gap-0.5">
                {envs.length === 0 ? (
                  <span className="py-1 pl-12 pr-2 text-xs text-muted-foreground">
                    No environments
                  </span>
                ) : (
                  envs.map((env) => {
                    const envNode: TreeNode = {
                      kind: 'env',
                      projectUuid: project.uuid,
                      envUuid: env.uuid,
                    }
                    const envSelected = sameNode(node, envNode)
                    return (
                      <button
                        key={env.uuid}
                        onClick={() => onSelect(envNode)}
                        aria-current={envSelected ? 'page' : undefined}
                        className={cn(
                          'flex min-w-0 items-center gap-2 rounded-md py-1 pl-12 pr-2 text-left hover:bg-muted/60',
                          envSelected && 'bg-muted font-medium',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          {env.name}
                        </span>
                        <RollupLed state={rollupByEnvId.get(env.id) ?? 'none'} />
                        <Count value={countsByEnvId.get(env.id) ?? 0} />
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}
