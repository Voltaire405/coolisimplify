'use client'

import { cn } from '@workspace/ui/lib/utils'
import { Check, Loader2, X, Trash2 } from 'lucide-react'
import type { BatchItem } from '@/hooks/use-coolify'

interface BatchQueueProps {
  items: BatchItem[]
  onClearCompleted: () => void
  onClearAll: () => void
}

export function BatchQueue({ items, onClearCompleted, onClearAll }: BatchQueueProps) {
  if (items.length === 0) return null

  const completed = items.filter((i) => i.status === 'completed').length
  const failed = items.filter((i) => i.status === 'failed').length
  const total = items.length

  const progress = total > 0 ? ((completed + failed) / total) * 100 : 0

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-border bg-card shadow-lg">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Batch Queue
        </span>
        <div className="flex gap-1">
          {(completed > 0 || failed > 0) && (
            <button
              onClick={onClearCompleted}
              className="rounded px-1.5 py-0.5 text-xs hover:bg-muted"
              title="Clear completed"
            >
              Clear done
            </button>
          )}
          <button
            onClick={onClearAll}
            className="rounded px-1.5 py-0.5 text-xs hover:bg-muted"
            title="Clear all"
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

      <div className="max-h-48 overflow-y-auto border-t border-border">
        {items.map((item) => {
          const hint = item.error || item.message
          return (
            <div
              key={item.id}
              className="flex items-center gap-2 px-3 py-1.5 text-xs"
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
                <span className="shrink-0 max-w-[12rem] truncate text-muted-foreground">
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
