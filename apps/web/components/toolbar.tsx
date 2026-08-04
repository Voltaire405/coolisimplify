'use client'

import { Search, AlertCircle } from 'lucide-react'
import { cn } from '@workspace/ui/lib/utils'
import type { ResourceType } from '@/lib/types'

export type TypeFilter = 'all' | ResourceType
export type StatusFilter = 'all' | 'running' | 'stopped'

interface ToolbarProps {
  query: string
  onQueryChange: (query: string) => void
  typeFilter: TypeFilter
  onTypeFilterChange: (filter: TypeFilter) => void
  statusFilter: StatusFilter
  onStatusFilterChange: (filter: StatusFilter) => void
  problemsOnly: boolean
  onProblemsOnlyChange: (value: boolean) => void
  onOpenPalette: () => void
}

function Pill({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs leading-none',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

const TYPE_FILTERS: Array<{ value: TypeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'application', label: 'Apps' },
  { value: 'service', label: 'Services' },
  { value: 'database', label: 'Databases' },
]

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Any state' },
  { value: 'running', label: 'Running' },
  { value: 'stopped', label: 'Stopped' },
]

export function Toolbar({
  query,
  onQueryChange,
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
  problemsOnly,
  onProblemsOnlyChange,
  onOpenPalette,
}: ToolbarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative min-w-44 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Filter by name, domain, server…"
          aria-label="Filter resources"
          className="h-8 w-full rounded-md border border-border bg-transparent pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/40"
        />
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Filter by type">
        {TYPE_FILTERS.map((f) => (
          <Pill
            key={f.value}
            active={typeFilter === f.value}
            onClick={() => onTypeFilterChange(f.value)}
          >
            {f.label}
          </Pill>
        ))}
      </div>

      <div className="hidden h-4 w-px bg-border sm:block" />

      <div className="flex items-center gap-1" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map((f) => (
          <Pill
            key={f.value}
            active={statusFilter === f.value}
            onClick={() => onStatusFilterChange(f.value)}
          >
            {f.label}
          </Pill>
        ))}
        <Pill
          active={problemsOnly}
          onClick={() => onProblemsOnlyChange(!problemsOnly)}
          title="Only resources that are stopped or in error"
        >
          <span className="inline-flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Problems
          </span>
        </Pill>
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        title="Search everything (⌘K / Ctrl+K)"
        className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted"
      >
        <Search className="h-3 w-3" />
        <kbd className="rounded border border-border px-1 font-mono text-[10px]">⌘K</kbd>
      </button>
    </div>
  )
}
