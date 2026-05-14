'use client'

import { cn } from '@workspace/ui/lib/utils'
import { Check, Loader2, X, Trash2 } from 'lucide-react'
import type { BatchItem } from '@/hooks/use-coolify'

interface BatchQueueProps {
  items: BatchItem[]
  onClearCompleted: () => void
  onClearAll: () => void
  elevated?: boolean
}

export function BatchQueue({
  items,
  onClearCompleted,
  onClearAll,
  elevated = false,
}: BatchQueueProps) {
  if (items.length === 0) return null

  const completed = items.filter((i) => i.status === 'completed').length
  const failed = items.filter((i) => i.status === 'failed').length
  const total = items.length

  const progress = total > 0 ? ((completed + failed) / total) * 100 : 0

  return (
    <div
      className={cn(
        'fixed inset-x-3 z-50 rounded-lg border border-border bg-card shadow-lg sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-80',
        elevated ? 'bottom-24' : 'bottom-3',
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Batch Queue
        </span>
        <div className="flex shrink-0 gap-1">
          {(completed > 0 || failed > 0) && (
            <button
              onClick={onClearCompleted}
              className="rounded px-2 py-1 text-xs hover:bg-muted sm:px-1.5 sm:py-0.5"
              title="Clear completed"
            >
              Clear done
            </button>
          )}
          <button
            onClick={onClearAll}
            className="flex h-7 w-7 items-center justify-center rounded text-xs hover:bg-muted sm:h-auto sm:w-auto sm:px-1.5 sm:py-0.5"
            title="Clear all"
            aria-label="Clear all"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {completed}/{total} done
          </span>
          {failed > 0 && <span className="text-destructive">{failed} failed</span>}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              failed > 0 ? 'bg-black dark:bg-white' : 'bg-black dark:bg-white',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto border-t border-border sm:max-h-48">
        {items.map((item) => {
          const hint = item.error || item.message
          return (
            <div
              key={item.id}
              className="flex items-start gap-2 px-3 py-2 text-xs sm:items-center sm:py-1.5"
              title={hint}
            >
              {item.status === 'pending' && (
                <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30" />
              )}
              {item.status === 'in-progress' && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              {item.status === 'completed' && (
                <Check className="h-3.5 w-3.5 text-black dark:text-white" />
              )}
              {item.status === 'failed' && (
                <X className="h-3.5 w-3.5 text-destructive" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {item.resourceName}
                <span className="ml-1 text-muted-foreground">{item.action}</span>
              </span>
              {item.error ? (
                <span className="shrink-0 text-destructive">{item.error}</span>
              ) : item.message ? (
                <span className="max-w-[9rem] shrink-0 truncate text-muted-foreground sm:max-w-[12rem]">
                  {item.message}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
