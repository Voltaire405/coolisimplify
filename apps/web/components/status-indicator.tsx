'use client'

import { cn } from '@workspace/ui/lib/utils'

interface StatusIndicatorProps {
  active: boolean
  className?: string
}

export function StatusIndicator({ active, className }: StatusIndicatorProps) {
  return (
    <span
      className={cn(
        'relative inline-flex h-2.5 w-2.5 rounded-full',
        active
          ? 'bg-black dark:bg-white'
          : 'border border-black/30 bg-transparent dark:border-white/30',
        className,
      )}
    >
      {active && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-black/40 dark:bg-white/40" />
      )}
    </span>
  )
}

export function LedCard({
  active,
  children,
  className,
}: {
  active: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border p-4 transition-all',
        active ? 'led-active bg-card' : 'led-inactive led-inactive-surface',
        className,
      )}
    >
      {children}
    </div>
  )
}
