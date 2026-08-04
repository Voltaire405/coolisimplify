'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Workflow,
  Database,
  Folder,
  Layers,
  Link as LinkIcon,
  Search,
} from 'lucide-react'
import { cn } from '@workspace/ui/lib/utils'
import type { ResourceType } from '@/lib/types'
import type { TreeNode } from '@/lib/tree'

export interface PaletteItem {
  id: string
  kind: 'project' | 'environment' | 'resource'
  label: string
  sublabel?: string
  /** Extra searchable text (domain, server name). */
  keywords?: string
  /** Sidebar node to select when the item is chosen. */
  node: TreeNode
  resource?: { type: ResourceType; uuid: string }
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: PaletteItem[]
  onNavigate: (item: PaletteItem, opts: { withDrawer: boolean }) => void
  /** Relative URL for an item, used by the per-row copy-link button. */
  makeHref: (item: PaletteItem) => string
}

const kindIcons = {
  project: Folder,
  environment: Layers,
  resource: Box,
} as const

const resourceIcons: Record<ResourceType, typeof Box> = {
  application: Box,
  service: Workflow,
  database: Database,
}

const MAX_RESULTS = 15

/** 0 = no match; higher ranks earlier. Every whitespace-separated token must match. */
function scoreItem(item: PaletteItem, query: string): number {
  const label = item.label.toLowerCase()
  const hay = `${label} ${item.sublabel ?? ''} ${item.keywords ?? ''}`.toLowerCase()
  const tokens = query.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 1
  let score = 0
  for (const token of tokens) {
    if (!hay.includes(token)) return 0
    if (label.startsWith(token)) score += 3
    else if (label.includes(token)) score += 2
    else score += 1
  }
  // Resources are the most common jump target; break ties in their favor.
  if (item.kind === 'resource') score += 0.5
  return score
}

export function CommandPalette({
  open,
  onOpenChange,
  items,
  onNavigate,
  makeHref,
}: CommandPaletteProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  // The panel mounts fresh on every open, so query/selection reset naturally.
  if (!open) return null
  return (
    <PalettePanel
      onOpenChange={onOpenChange}
      items={items}
      onNavigate={onNavigate}
      makeHref={makeHref}
    />
  )
}

function PalettePanel({
  onOpenChange,
  items,
  onNavigate,
  makeHref,
}: Omit<CommandPaletteProps, 'open'>) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .map((item) => ({ item, score: scoreItem(item, q) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((r) => r.item)
  }, [items, query])

  const choose = useCallback(
    (item: PaletteItem, withDrawer: boolean) => {
      onOpenChange(false)
      onNavigate(item, { withDrawer })
    },
    [onNavigate, onOpenChange],
  )

  const copyLink = useCallback(
    (item: PaletteItem) => {
      void navigator.clipboard.writeText(window.location.origin + makeHref(item))
    },
    [makeHref],
  )

  const clampedIndex = Math.min(activeIndex, Math.max(results.length - 1, 0))

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 p-3"
      onClick={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
        className="mx-auto mt-[12vh] w-full max-w-lg overflow-hidden rounded-lg border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onOpenChange(false)
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActiveIndex((i) => Math.min(i + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActiveIndex((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter' && results[clampedIndex]) {
                e.preventDefault()
                choose(results[clampedIndex], e.metaKey || e.ctrlKey)
              }
            }}
            placeholder="Jump to a project, environment, or resource…"
            aria-label="Search projects, environments, and resources"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <ul role="listbox" className="max-h-[50vh] overflow-y-auto p-1">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matches.
            </li>
          ) : (
            results.map((item, index) => {
              const Icon = item.resource
                ? resourceIcons[item.resource.type]
                : kindIcons[item.kind]
              return (
                <li key={item.id} role="option" aria-selected={index === clampedIndex}>
                  <div
                    className={cn(
                      'group flex w-full items-center gap-2 rounded-md px-2 py-1.5',
                      index === clampedIndex && 'bg-muted',
                    )}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <button
                      type="button"
                      onClick={(e) => choose(item, e.metaKey || e.ctrlKey)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                      {item.sublabel && (
                        <span className="shrink-0 truncate text-xs text-muted-foreground">
                          {item.sublabel}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyLink(item)}
                      aria-label={`Copy link to ${item.label}`}
                      title="Copy link"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted-foreground/10 focus:opacity-100 group-hover:opacity-100"
                    >
                      <LinkIcon className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              )
            })
          )}
        </ul>

        <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          ↑↓ navigate · ⏎ go · ⌘⏎ open details · esc close
        </div>
      </div>
    </div>
  )
}
