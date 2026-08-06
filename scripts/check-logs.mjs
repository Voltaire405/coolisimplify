// Verifies the application logs viewer against the two things that can break it
// silently: the API contract it queries, and the pure helpers it renders with.
//
// Background: the logs endpoint returns one `{ logs: string }` blob with no
// streaming, paging or time range, so `lines` and `show_timestamps` are the
// only server-side knobs — everything else the viewer offers (the grep filter,
// the copy selection) is client-side and lives in apps/web/lib/logs.ts.
//
// Run with: pnpm check:logs
import assert from 'node:assert/strict'
import { queryParams } from './coolify-spec.mjs'
import {
  filterLogLines,
  splitLogLines,
  tokenizeLogLine,
  parseDeploymentLogs,
  LOG_LINE_OPTIONS,
  DEFAULT_LOG_LINES,
} from '../apps/web/lib/logs.ts'
import {
  isNeverDeployed,
  classifyResourceState,
} from '../apps/web/lib/resource-state.ts'

// --- API contract ------------------------------------------------------------
const params = queryParams('/applications/{uuid}/logs')

assert.ok(params.lines, '`lines` query parameter disappeared from the spec')
assert.equal(params.lines.in, 'query')
assert.equal(params.lines.type, 'integer')
assert.equal(params.lines.default, '100')

assert.ok(
  params.show_timestamps,
  '`show_timestamps` query parameter disappeared from the spec',
)
assert.equal(params.show_timestamps.in, 'query')
assert.equal(params.show_timestamps.type, 'boolean')
assert.equal(params.show_timestamps.default, 'false')

// Opening the modal must send what the server would have assumed anyway.
assert.equal(String(DEFAULT_LOG_LINES), params.lines.default)
assert.ok(LOG_LINE_OPTIONS.includes(DEFAULT_LOG_LINES))

// Locks the absence of follow/since/until: if the API ever grows one, this
// fails loudly instead of the viewer quietly ignoring a new capability.
assert.deepEqual(Object.keys(params).sort(), ['lines', 'show_timestamps', 'uuid'])

// --- splitting ---------------------------------------------------------------
assert.deepEqual(splitLogLines(''), [])
assert.deepEqual(splitLogLines('\n\n'), [])
// docker's trailing newline must not become a phantom blank line, which would
// inflate every count shown next to the search box.
assert.deepEqual(splitLogLines('a\nb\n'), ['a', 'b'])
// Interior blanks are real output and survive.
assert.deepEqual(splitLogLines('a\n\nb'), ['a', '', 'b'])

// --- grep filter -------------------------------------------------------------
const sample = [
  '12:04:00 GET /health 200',
  '12:04:01 ERROR conn refused',
  '12:04:05 retrying in 2s',
  '12:04:09 error retry 1 failed',
].join('\n')

// Case-insensitive: real logs mix ERROR and error in the same stream.
assert.deepEqual(filterLogLines(sample, 'error'), [
  '12:04:01 ERROR conn refused',
  '12:04:09 error retry 1 failed',
])
assert.equal(filterLogLines(sample, 'ERROR').length, 2)

// A blank or whitespace-only query is not a filter.
assert.equal(filterLogLines(sample, '').length, 4)
assert.equal(filterLogLines(sample, '   ').length, 4)

// Interior whitespace is significant, which is what makes "GET " usable.
assert.deepEqual(filterLogLines(sample, 'GET '), ['12:04:00 GET /health 200'])

// Literal, not regex: a metacharacter finds itself instead of throwing.
assert.deepEqual(filterLogLines('a+b\nab', 'a+b'), ['a+b'])
assert.deepEqual(filterLogLines('x.y\nxzy', '.'), ['x.y'])

// No match is an empty list — the viewer tells that apart from "no output at
// all" by checking the unfiltered total, so both must stay distinguishable.
assert.deepEqual(filterLogLines(sample, 'nope'), [])
assert.equal(splitLogLines(sample).length, 4)
assert.deepEqual(filterLogLines('', 'nope'), [])
assert.equal(splitLogLines('').length, 0)

// --- logs gating -------------------------------------------------------------
// The reason isNeverDeployed exists at all: classifyResourceState folds an
// exited container in with never-deployed ones, but only the latter has
// nothing to read. Hiding logs on a crash is the failure this prevents.
assert.equal(classifyResourceState('exited (1)'), 'stopped')
assert.equal(isNeverDeployed('exited (1)'), false)
assert.equal(isNeverDeployed('stopped'), false)
assert.equal(isNeverDeployed('running'), false)
assert.equal(isNeverDeployed('deploying'), false)

assert.equal(isNeverDeployed('never deployed'), true)
assert.equal(isNeverDeployed('never-deployed'), true)
assert.equal(isNeverDeployed('not deployed'), true)
assert.equal(isNeverDeployed('Never Deployed'), true)

// An unknown or absent status is not evidence of absence: stay readable.
assert.equal(isNeverDeployed(undefined), false)
assert.equal(isNeverDeployed(null), false)
assert.equal(isNeverDeployed(''), false)

// --- deployment logs ---------------------------------------------------------
// Unlike the container endpoint's flat blob, a deployment's `logs` is a JSON
// array of build steps. This is the stream that says *why* a deploy failed —
// the container one cannot, because a failed build never replaces the
// container it reads from.
// Entry shape verified against a live v4 instance: command/output/type/
// timestamp/hidden/batch, `command` frequently null, and no sequence field —
// the array arrives in execution order and must be kept that way.
const buildLog = JSON.stringify([
  {
    command: null,
    output: 'Starting deployment',
    type: 'stdout',
    timestamp: '2026-08-05T12:00:00Z',
    batch: 1,
  },
  { command: 'docker build .', output: null, type: 'stdout', batch: 1 },
  { command: null, output: 'ERROR: failed to solve', type: 'stderr', batch: 1 },
  { command: null, output: 'internal bookkeeping', hidden: true, batch: 1 },
])
assert.deepEqual(splitLogLines(parseDeploymentLogs(buildLog)), [
  '2026-08-05T12:00:00Z Starting deployment',
  'docker build .',
  'ERROR: failed to solve',
])

// Order comes from the array itself. Sorting on a key the records do not carry
// would silently scramble build output.
assert.deepEqual(
  splitLogLines(
    parseDeploymentLogs(
      JSON.stringify([{ output: 'first' }, { output: 'second' }]),
    ),
  ),
  ['first', 'second'],
)

// A timestamp stamps the first line only — the rest of a multi-line entry did
// not happen at that instant.
assert.deepEqual(
  splitLogLines(
    parseDeploymentLogs(
      JSON.stringify([{ output: 'line one\nline two', timestamp: '12:00:00' }]),
    ),
  ),
  ['12:00:00 line one', 'line two'],
)

// Unparseable input is shown rather than swallowed: a build that died early may
// hold a bare error string, and showing it beats showing nothing.
assert.equal(parseDeploymentLogs('boom: not json'), 'boom: not json')
assert.equal(parseDeploymentLogs('{"not":"an array"}'), '{"not":"an array"}')
// Nothing to show stays empty rather than becoming a phantom line.
assert.equal(parseDeploymentLogs(''), '')
assert.equal(parseDeploymentLogs(null), '')
assert.equal(parseDeploymentLogs(undefined), '')
assert.equal(parseDeploymentLogs('[]'), '')
// The filter and highlighter work on the result like any other log text.
assert.deepEqual(filterLogLines(parseDeploymentLogs(buildLog), 'error'), [
  'ERROR: failed to solve',
])
assert.equal(tokenizeLogLine('ERROR: failed to solve').severity, 'error')

// --- syntax highlighting -----------------------------------------------------
const kinds = (line) => tokenizeLogLine(line).segments.map((s) => s.kind)
const textOf = (line, kind) =>
  tokenizeLogLine(line)
    .segments.filter((s) => s.kind === kind)
    .map((s) => s.text)

// The invariant that matters most: colouring must never alter what the
// container actually wrote.
for (const line of [
  '2026-08-05T12:04:01.123456789Z [ERROR] conn refused',
  '12:04:00 INFO  server started',
  '[2026-08-05 12:04:02] WARN slow query 2.1s',
  'plain output with no markers at all',
  '  leading spaces preserved  ',
  '',
  'ERROR',
]) {
  assert.equal(
    tokenizeLogLine(line)
      .segments.map((s) => s.text)
      .join(''),
    line,
    `segments must reassemble exactly: ${JSON.stringify(line)}`,
  )
}

// Timestamps: docker's --timestamps output, plus the shapes apps print
// themselves. Only a leading one counts.
assert.deepEqual(textOf('2026-08-05T12:04:01.123456789Z boot', 'timestamp'), [
  '2026-08-05T12:04:01.123456789Z',
])
assert.deepEqual(textOf('2026-08-05T12:04:01+02:00 boot', 'timestamp'), [
  '2026-08-05T12:04:01+02:00',
])
assert.deepEqual(textOf('2026-08-05 12:04:01,123 boot', 'timestamp'), [
  '2026-08-05 12:04:01,123',
])
assert.deepEqual(textOf('[12:04:01] boot', 'timestamp'), ['[12:04:01]'])
assert.deepEqual(textOf('12:04:01 boot', 'timestamp'), ['12:04:01'])
// Mid-line digits in that shape are data, not a clock.
assert.deepEqual(textOf('took 12:04:01 to finish', 'timestamp'), [])
// Three digits before the colon is not an hour.
assert.deepEqual(textOf('404:12:33 not found', 'timestamp'), [])

// Levels, delimited and bare, in either case.
assert.deepEqual(textOf('[ERROR] boom', 'level'), ['[ERROR]'])
assert.deepEqual(textOf('(warn) slow', 'level'), ['(warn)'])
assert.deepEqual(textOf('level=error boom', 'level'), ['error'])
assert.equal(tokenizeLogLine('[ERROR] boom').severity, 'error')
assert.equal(tokenizeLogLine('FATAL disk full').severity, 'error')
assert.equal(tokenizeLogLine('[WARNING] slow').severity, 'warn')
assert.equal(tokenizeLogLine('INFO ready').severity, 'info')
assert.equal(tokenizeLogLine('[TRACE] enter').severity, 'debug')

// Whichever marker appears first wins, so a trailing tag cannot downgrade a
// line that already announced itself as an error.
assert.equal(tokenizeLogLine('ERROR failed to parse [INFO]').severity, 'error')
assert.deepEqual(textOf('ERROR failed to parse [INFO]', 'level'), ['ERROR'])
// A delimited marker still wins when it comes first.
assert.equal(tokenizeLogLine('[INFO] retrying after error').severity, 'info')

// Word boundaries: no highlight bleeding into longer words.
assert.equal(tokenizeLogLine('no errors found').severity, null)
assert.equal(tokenizeLogLine('terrible outcome').severity, null)
assert.equal(tokenizeLogLine('informational note').severity, null)
assert.deepEqual(kinds('plain output'), ['text'])

// A timestamped error yields all three kinds, in reading order.
assert.deepEqual(kinds('12:04:01 [ERROR] conn refused'), [
  'timestamp',
  'text',
  'level',
  'text',
])

// An empty line has no segments; the viewer renders a blank row for it.
assert.deepEqual(tokenizeLogLine('').segments, [])
assert.equal(tokenizeLogLine('').severity, null)

console.log('PASS — logs viewer matches the API contract and its gating holds')
