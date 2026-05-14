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
        className="fixed left-4 top-4 z-40 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted"
        title="Settings"
      >
        <Settings className="h-4 w-4" />
      </button>
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
