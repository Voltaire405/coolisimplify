'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  RotateCw,
  Terminal,
  X,
} from 'lucide-react'
import { cn } from '@workspace/ui/lib/utils'
import { ModalShell } from './confirm-dialog'
import { useClient } from '@/hooks/use-coolify'
import {
  filterLogLines,
  splitLogLines,
  tokenizeLogLine,
  LOG_LINE_OPTIONS,
  type LogLineOption,
  type LogLineParts,
  type LogSeverity,
} from '@/lib/logs'

// The pane is always dark regardless of the app theme, so these are fixed
// rather than theme tokens. Timestamps recede on purpose: they are for locating
// yourself between lines, not for reading.
const SEVERITY_CLASS: Record<LogSeverity, string> = {
  error: 'text-red-400',
  warn: 'text-amber-400',
  info: 'text-sky-400',
  debug: 'text-violet-400',
}

function LogLine({ parts }: { parts: LogLineParts }) {
  const { severity, segments } = parts
  return (
    <div
      className={cn(
        // Negative margin bleeds the tint through the pane's padding so an
        // error reads as a full-width band rather than a floating block.
        '-mx-3 whitespace-pre-wrap break-words px-3',
        severity === 'error' && 'bg-red-500/10',
      )}
    >
      {segments.length === 0
        ? ' '
        : segments.map((seg, i) => (
            <span
              key={i}
              className={
                seg.kind === 'timestamp'
                  ? 'text-white/40'
                  : seg.kind === 'level' && severity
                    ? SEVERITY_CLASS[severity]
                    : undefined
              }
            >
              {seg.text}
            </span>
          ))}
    </div>
  )
}

interface LogsDialogProps {
  uuid: string
  name: string
  /** Tail window; owned by the page so it survives between openings. */
  lines: LogLineOption
  showTimestamps: boolean
  onLinesChange: (lines: LogLineOption) => void
  onShowTimestampsChange: (show: boolean) => void
  onClose: () => void
}

/**
 * The last settled request, tagged with the parameters that produced it.
 * Loading is derived by comparing that tag with the current parameters rather
 * than stored, which keeps the effect free of synchronous setState and closes
 * the frame where the previous output would show under the new parameters.
 */
type Loaded =
  | { key: string; status: 'ready'; logs: string }
  | { key: string; status: 'error'; message: string }

function CopyLinesButton({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
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
      disabled={!lines.length}
      // The count is in the label on purpose: with a filter active this copies
      // what is on screen, not the whole tail, and the number says so upfront.
      title={copied ? 'Copied' : 'Copy the lines currently shown'}
      className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-foreground" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? 'Copied' : `Copy ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`}
    </button>
  )
}

export function LogsDialog({
  uuid,
  name,
  lines,
  showTimestamps,
  onLinesChange,
  onShowTimestampsChange,
  onClose,
}: LogsDialogProps) {
  const { client } = useClient()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [query, setQuery] = useState('')
  // Bumped by Refresh to re-run the fetch with otherwise unchanged parameters.
  const [reloadToken, setReloadToken] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const requestKey = `${uuid}|${lines}|${showTimestamps}|${reloadToken}`

  useEffect(() => {
    // Missing configuration is derived at render time, not stored: it is a
    // property of the settings, not the outcome of a request.
    if (!client) return
    let cancelled = false
    client
      .getApplicationLogs(uuid, { lines, show_timestamps: showTimestamps })
      .then((res) => {
        if (!cancelled)
          setLoaded({ key: requestKey, status: 'ready', logs: res?.logs ?? '' })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoaded({
          key: requestKey,
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to load logs',
        })
      })
    return () => {
      cancelled = true
    }
  }, [client, requestKey, uuid, lines, showTimestamps])

  const current = loaded?.key === requestKey ? loaded : null
  const notConfigured = !client
  const loading = !notConfigured && current === null

  // Newest output is at the bottom, so every settled load lands there.
  // Filtering never touches `current`, which is what keeps the view still
  // while exploring.
  useEffect(() => {
    if (current?.status !== 'ready') return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [current])

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const logs = current?.status === 'ready' ? current.logs : ''
  const total = useMemo(() => splitLogLines(logs).length, [logs])
  const visible = useMemo(() => filterLogLines(logs, query), [logs, query])
  // Tokenised once per visible set rather than per line component, so typing in
  // the filter does not re-parse lines that were already dropped.
  const parsed = useMemo(() => visible.map(tokenizeLogLine), [visible])

  const filtering = query.trim().length > 0
  // Nothing reachable to refetch from, so the server-side controls stay inert.
  const controlsDisabled = loading || notConfigured

  return (
    <ModalShell
      onCancel={onClose}
      labelledBy="logs-dialog-title"
      panelClassName="max-w-5xl"
    >
      <div className="flex h-[80vh] flex-col">
        <div className="flex items-start justify-between gap-3">
          <h2
            id="logs-dialog-title"
            className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground"
          >
            <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{name}</span>
            <span className="shrink-0 font-normal text-muted-foreground">· logs</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close logs"
            className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter lines…"
            aria-label="Filter log lines"
            className="h-7 w-48 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground"
          />
          <span className="text-xs tabular-nums text-muted-foreground">
            {filtering ? `${visible.length} of ${total}` : `${total} lines`}
          </span>

          {/* Everything past this divider costs a request; the search above does not. */}
          <div className="ml-auto flex items-center gap-2 border-l border-border pl-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Lines
              <select
                value={lines}
                onChange={(e) =>
                  onLinesChange(Number(e.target.value) as LogLineOption)
                }
                disabled={controlsDisabled}
                className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground disabled:opacity-40"
              >
                {LOG_LINE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showTimestamps}
                onChange={(e) => onShowTimestampsChange(e.target.checked)}
                disabled={controlsDisabled}
                className="h-3.5 w-3.5 rounded border-border disabled:opacity-40"
              />
              Timestamps
            </label>

            <button
              type="button"
              onClick={() => setReloadToken((n) => n + 1)}
              disabled={controlsDisabled}
              aria-label="Refresh logs"
              title="Refresh logs"
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
            >
              <RotateCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              Refresh
            </button>

            <CopyLinesButton lines={visible} />
          </div>
        </div>

        <div
          ref={scrollRef}
          aria-label={`Logs for ${name}`}
          aria-busy={loading}
          className="mt-3 flex-1 overflow-auto rounded-md border border-border bg-black p-3 font-mono text-xs leading-relaxed text-white"
        >
          {notConfigured ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-white/50">
              <p className="text-white/80">Coolify is not configured</p>
              <p>Add your instance URL and API token in Settings.</p>
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center text-white/50">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : current?.status === 'error' ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              <p className="max-w-md break-words text-white/80">{current.message}</p>
              <button
                type="button"
                onClick={() => setReloadToken((n) => n + 1)}
                className="flex items-center gap-1.5 rounded-md border border-white/30 px-2.5 py-1 text-white/80 hover:bg-white/10"
              >
                <RotateCw className="h-3.5 w-3.5" />
                Retry
              </button>
            </div>
          ) : total === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-white/50">
              <p className="text-white/80">No output recorded</p>
              <p>This container has not written anything yet.</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-white/50">
              No lines match “{query}”.
            </div>
          ) : (
            parsed.map((parts, i) => <LogLine key={i} parts={parts} />)
          )}
        </div>
      </div>
    </ModalShell>
  )
}
