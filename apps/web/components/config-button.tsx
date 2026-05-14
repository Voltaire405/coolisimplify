'use client'

import { useState } from 'react'
import { SettingsDialog } from './settings-dialog'
import { Settings } from 'lucide-react'

export function ConfigButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-40 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted sm:left-4 sm:top-4 sm:h-9 sm:w-9"
        title="Settings"
        aria-label="Open settings"
      >
        <Settings className="h-4 w-4" />
      </button>
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
