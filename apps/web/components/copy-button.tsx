"use client"

import { useState } from "react"
import { Copy, Check } from "lucide-react"

interface CopyButtonProps {
  value: string
  label?: string
  className?: string
}

/** How long the Copied check stays before reverting to idle. */
export const COPY_FEEDBACK_MS = 1500
/** How long the clipboard-failure affordance stays before resetting. */
export const COPY_FAILURE_MS = 3000

export function CopyButton({
  value,
  label = "Copy",
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopyFailed(false)
      setCopied(true)
      setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
    } catch {
      // Clipboard may be unavailable (e.g. non-secure context, denied
      // permission, sandboxed iframe). Never flash a false "Copied": surface
      // the failure instead so the user knows the write did not land and can
      // retry. The failure is transient so a later click starts clean.
      setCopied(false)
      setCopyFailed(true)
      setTimeout(() => setCopyFailed(false), COPY_FAILURE_MS)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={
        copied
          ? "Copied"
          : copyFailed
            ? "Copy failed. Please try again."
            : label
      }
      title={
        copied
          ? "Copied"
          : copyFailed
            ? "Copy failed. Please try again."
            : label
      }
      className={
        className ??
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
      }
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-foreground" />
      ) : (
        <Copy
          className={
            copyFailed ? "h-3.5 w-3.5 text-destructive" : "h-3.5 w-3.5"
          }
        />
      )}
      {/* Live region: announces a clipboard failure to assistive tech. The
          transient text is the same wording the DatabaseCopyMenu surfaces, so
          every copy affordance reports failures consistently. */}
      {copyFailed && (
        <span role="status" aria-live="polite" className="sr-only">
          Copy failed. Please try again.
        </span>
      )}
    </button>
  )
}
