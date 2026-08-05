'use client'

import {
  ChevronDown,
  ChevronRight,
  Folder,
  Layers,
  Plus,
  Trash2,
} from 'lucide-react'
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
  onCreateProject: () => void
  onCreateEnvironment: (projectUuid: string) => void
  onDeleteProject: (projectUuid: string) => void
  onDeleteEnvironment: (projectUuid: string, envUuid: string) => void
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
  onCreateProject,
  onCreateEnvironment,
  onDeleteProject,
  onDeleteEnvironment,
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
      <div
        className={cn(
          'group flex items-center rounded-md hover:bg-muted/60',
          allSelected && 'bg-muted',
        )}
      >
        <button
          onClick={() => onSelect({ kind: 'all' })}
          aria-current={allSelected ? 'page' : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left',
            allSelected && 'font-medium',
          )}
        >
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">All resources</span>
          <RollupLed state={rootRollup} />
          <Count value={totalCount} />
        </button>
        <button
          type="button"
          onClick={onCreateProject}
          title="Create project"
          aria-label="Create project"
          className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:opacity-100"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

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
                'group flex items-center rounded-md hover:bg-muted/60',
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
              <button
                type="button"
                onClick={() => onCreateEnvironment(project.uuid)}
                title={`Create environment in ${project.name}`}
                aria-label={`Create environment in ${project.name}`}
                className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:opacity-100"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onDeleteProject(project.uuid)}
                title={`Delete project ${project.name}`}
                aria-label={`Delete project ${project.name}`}
                className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {isExpanded && (
              <div className="flex flex-col gap-0.5">
                {envs.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => onCreateEnvironment(project.uuid)}
                    className="flex w-full items-center gap-1 py-1 pl-12 pr-2 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    title={`Create environment in ${project.name}`}
                  >
                    <Plus className="h-3 w-3 shrink-0" />
                    Create environment
                  </button>
                ) : (
                  envs.map((env) => {
                    const envNode: TreeNode = {
                      kind: 'env',
                      projectUuid: project.uuid,
                      envUuid: env.uuid,
                    }
                    const envSelected = sameNode(node, envNode)
                    return (
                      <div
                        key={env.uuid}
                        className={cn(
                          'group flex items-center rounded-md hover:bg-muted/60',
                          envSelected && 'bg-muted',
                        )}
                      >
                        <button
                          onClick={() => onSelect(envNode)}
                          aria-current={envSelected ? 'page' : undefined}
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pl-12 pr-2 text-left',
                            envSelected && 'font-medium',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate text-[13px]">
                            {env.name}
                          </span>
                          <RollupLed state={rollupByEnvId.get(env.id) ?? 'none'} />
                          <Count value={countsByEnvId.get(env.id) ?? 0} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteEnvironment(project.uuid, env.uuid)}
                          title={`Delete environment ${env.name}`}
                          aria-label={`Delete environment ${env.name}`}
                          className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
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
