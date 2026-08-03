'use client'

import { useRef, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'

interface InlineRenameProps {
  name: string
  busy?: boolean
  className?: string
  /** Persist the new name. Resolve true to close the editor, false to stay open. */
  onSubmit: (newName: string) => Promise<boolean>
}

export function InlineRename({
  name,
  busy = false,
  className,
  onSubmit,
}: InlineRenameProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const start = () => {
    if (busy) return
    setValue(name)
    setEditing(true)
  }

  const cancel = () => {
    if (saving) return
    setEditing(false)
  }

  const commit = async () => {
    if (saving) return
    const next = value.trim()
    if (!next) return
    if (next === name) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      const saved = await onSubmit(next)
      if (saved) setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        disabled={busy}
        title={busy ? undefined : 'Click to rename'}
        className={`truncate text-sm font-medium text-left ${
          busy ? '' : 'cursor-pointer rounded-sm hover:bg-muted'
        } ${className ?? ''}`}
      >
        {name}
      </button>
    )
  }

  return (
    <span className={`flex min-w-0 items-center gap-1 ${className ?? ''}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
        onBlur={cancel}
        disabled={saving}
        spellCheck={false}
        aria-label="Resource name"
        className="w-40 rounded-md border border-border bg-background px-2 py-0.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40 disabled:opacity-50 sm:w-56"
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void commit()}
        disabled={saving || !value.trim()}
        aria-label="Confirm rename"
        title="Confirm"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-black hover:bg-muted disabled:opacity-40 dark:text-white"
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={cancel}
        disabled={saving}
        aria-label="Cancel rename"
        title="Cancel"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-destructive hover:bg-muted disabled:opacity-40"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  )
}
