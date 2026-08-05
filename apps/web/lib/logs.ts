// Pure helpers for the application logs viewer. Kept React-free so
// scripts/check-logs.mjs can lock the behaviour without a DOM.
//
// The API hands back the whole tail as one `{ logs: string }` blob — no
// streaming, no paging, no time range (see coolify-openapi-v4.x.yaml, path
// /applications/{uuid}/logs). Everything below therefore works on that blob.

/**
 * Tail windows offered in the viewer. 100 is the API's own default; the ceiling
 * is what renders without virtualisation rather than an API limit (the spec
 * documents no maximum for `lines`).
 */
export const LOG_LINE_OPTIONS = [100, 500, 1000, 5000] as const

export type LogLineOption = (typeof LOG_LINE_OPTIONS)[number]

export const DEFAULT_LOG_LINES: LogLineOption = 100

export function splitLogLines(logs: string): string[] {
  // docker logs ends with a newline; splitting naively would append a phantom
  // blank line to every response.
  const trimmed = logs.replace(/\n+$/, '')
  if (!trimmed) return []
  return trimmed.split('\n')
}

/**
 * grep-style filter: keeps whole matching lines, drops the rest. Matching is
 * case-insensitive and literal — logs mix `ERROR` and `error`, and a stray
 * regex metacharacter in a search box should find itself, not throw.
 *
 * A blank (or whitespace-only) query is not a filter, so every line survives.
 * Interior whitespace is significant, which makes `"GET "` a usable query.
 */
export function filterLogLines(logs: string, query: string): string[] {
  const lines = splitLogLines(logs)
  if (!query.trim()) return lines
  const needle = query.toLowerCase()
  return lines.filter((line) => line.toLowerCase().includes(needle))
}

// --- syntax highlighting -----------------------------------------------------
// Container output has no schema, so this recognises the shapes that show up in
// practice rather than parsing a format. Anything unrecognised stays plain,
// which is the safe failure: a missed highlight costs nothing, a wrong one
// misleads.

export type LogSeverity = 'error' | 'warn' | 'info' | 'debug'

export type LogSegmentKind = 'timestamp' | 'level' | 'text'

export interface LogSegment {
  text: string
  kind: LogSegmentKind
}

export interface LogLineParts {
  /** Severity of the line as a whole; drives the row tint. */
  severity: LogSeverity | null
  segments: LogSegment[]
}

const SEVERITY_WORDS: Record<LogSeverity, string[]> = {
  // Longest first so alternation cannot stop at a prefix (CRITICAL vs CRIT).
  error: ['FATAL', 'CRITICAL', 'CRIT', 'PANIC', 'SEVERE', 'ERROR', 'ERR'],
  warn: ['WARNING', 'WARN'],
  info: ['NOTICE', 'INFO'],
  debug: ['DEBUG', 'TRACE', 'VERBOSE'],
}

const SEVERITY_BY_WORD = new Map<string, LogSeverity>(
  (Object.entries(SEVERITY_WORDS) as Array<[LogSeverity, string[]]>).flatMap(
    ([severity, words]) => words.map((w) => [w, severity] as const),
  ),
)

const LEVEL_ALT = Object.values(SEVERITY_WORDS).flat().join('|')

// Delimited (`[ERROR]`, `(warn)`) and bare (`ERROR`) forms. Mismatched
// delimiters would widen the highlight by a character; not worth guarding.
const DELIMITED_LEVEL = new RegExp(`[[(<](${LEVEL_ALT})[\\])>]`, 'i')
const BARE_LEVEL = new RegExp(`\\b(${LEVEL_ALT})\\b`, 'i')

// ISO-8601 (what docker's --timestamps emits), `YYYY-MM-DD HH:MM:SS`, and a
// bare clock, each optionally wrapped in brackets.
const CLOCK = String.raw`(?:\d{4}-\d{2}-\d{2}[T ])?\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?`
const LEADING_TIMESTAMP = new RegExp(`^(?:\\[${CLOCK}\\]|${CLOCK})`)

function matchLevel(text: string) {
  const delimited = DELIMITED_LEVEL.exec(text)
  const bare = BARE_LEVEL.exec(text)
  // Whichever appears first wins, so `ERROR … [INFO]` reads as an error.
  const hit =
    !delimited ? bare : !bare ? delimited : delimited.index <= bare.index ? delimited : bare
  if (!hit) return null
  const severity = SEVERITY_BY_WORD.get(hit[1]!.toUpperCase())
  if (!severity) return null
  return { index: hit.index, length: hit[0].length, severity }
}

/**
 * Splits a line into coloured spans. The concatenation of every segment's text
 * always reproduces the input exactly — highlighting must never alter what the
 * container actually wrote.
 */
export function tokenizeLogLine(line: string): LogLineParts {
  const segments: LogSegment[] = []

  // Only a leading timestamp counts: further down the line, digits in that
  // shape are far more likely to be data than a clock.
  const stamp = LEADING_TIMESTAMP.exec(line)
  const offset = stamp ? stamp[0].length : 0
  if (stamp) segments.push({ text: stamp[0], kind: 'timestamp' })

  const rest = line.slice(offset)
  const level = matchLevel(rest)
  if (!level) {
    if (rest) segments.push({ text: rest, kind: 'text' })
    return { severity: null, segments }
  }

  const before = rest.slice(0, level.index)
  const after = rest.slice(level.index + level.length)
  if (before) segments.push({ text: before, kind: 'text' })
  segments.push({
    text: rest.slice(level.index, level.index + level.length),
    kind: 'level',
  })
  if (after) segments.push({ text: after, kind: 'text' })

  return { severity: level.severity, segments }
}
