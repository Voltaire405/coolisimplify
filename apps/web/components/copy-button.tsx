'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface CopyButtonProps {
  value: string
  label?: string
  className?: string
}

export function CopyButton({ value, label = 'Copy', className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable (e.g. non-secure context); ignore.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      className={
        className ??
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted'
      }
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-foreground" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  )
}
