'use client'

import { useState, useRef, useEffect } from 'react'
import { cn } from '@workspace/ui/lib/utils'
import type { BatchAction } from '@/hooks/use-coolify'

interface ContextMenuProps {
  children: React.ReactNode
  items: Array<{
    label: string
    action: BatchAction | 'delete'
    disabled?: boolean
    dangerous?: boolean
  }>
  onSelect: (action: BatchAction | 'delete') => void
}

export function ContextMenu({ children, items, onSelect }: ContextMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-md p-1 hover:bg-muted"
      >
        {children}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-40 rounded-md border border-border bg-popover shadow-sm">
          <div className="py-1">
            {items.map((item) => (
              <button
                key={item.label}
                disabled={item.disabled}
                onClick={() => {
                  onSelect(item.action)
                  setOpen(false)
                }}
                className={cn(
                  'block w-full px-3 py-1.5 text-left text-sm transition-colors',
                  item.dangerous
                    ? 'text-destructive hover:bg-destructive/5'
                    : 'text-popover-foreground hover:bg-muted',
                  item.disabled && 'pointer-events-none opacity-40',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
