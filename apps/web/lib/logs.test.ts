// Verifies the application logs viewer against the two things that can break it
// silently: the API contract it queries, and the pure helpers it renders with.
//
// Background: the logs endpoint returns one `{ logs: string }` blob with no
// streaming, paging or time range, so `lines` and `show_timestamps` are the
// only server-side knobs — everything else the viewer offers (the grep filter,
// the copy selection) is client-side and lives in lib/logs.ts.
import { describe, expect, it } from 'vitest'
import { queryParams } from '../test/coolify-spec'
import { classifyResourceState, isNeverDeployed } from './resource-state'
import {
  DEFAULT_LOG_LINES,
  LOG_LINE_OPTIONS,
  filterLogLines,
  parseDeploymentLogs,
  splitLogLines,
  tokenizeLogLine,
  type LogSegmentKind,
} from './logs'

describe('API contract', () => {
  const params = queryParams('/applications/{uuid}/logs')

  it('still offers the lines knob with the documented default', () => {
    expect(params.lines, '`lines` query parameter disappeared').toBeDefined()
    expect(params.lines!.in).toBe('query')
    expect(params.lines!.type).toBe('integer')
    expect(params.lines!.default).toBe('100')
  })

  it('still offers the show_timestamps knob', () => {
    expect(
      params.show_timestamps,
      '`show_timestamps` query parameter disappeared',
    ).toBeDefined()
    expect(params.show_timestamps!.in).toBe('query')
    expect(params.show_timestamps!.type).toBe('boolean')
    expect(params.show_timestamps!.default).toBe('false')
  })

  it('opens the modal asking for what the server would have assumed anyway', () => {
    expect(String(DEFAULT_LOG_LINES)).toBe(params.lines!.default)
    expect(LOG_LINE_OPTIONS).toContain(DEFAULT_LOG_LINES)
  })

  // Locks the absence of follow/since/until: if the API ever grows one, this
  // fails loudly instead of the viewer quietly ignoring a new capability.
  it('has grown no new server-side knobs', () => {
    expect(Object.keys(params).sort()).toEqual([
      'lines',
      'show_timestamps',
      'uuid',
    ])
  })
})

describe('splitLogLines', () => {
  it('yields nothing for empty or blank-only output', () => {
    expect(splitLogLines('')).toEqual([])
    expect(splitLogLines('\n\n')).toEqual([])
  })

  // docker's trailing newline must not become a phantom blank line, which would
  // inflate every count shown next to the search box.
  it('drops the trailing newline instead of counting it as a line', () => {
    expect(splitLogLines('a\nb\n')).toEqual(['a', 'b'])
  })

  it('keeps interior blanks, which are real output', () => {
    expect(splitLogLines('a\n\nb')).toEqual(['a', '', 'b'])
  })
})

describe('grep filter', () => {
  const sample = [
    '12:04:00 GET /health 200',
    '12:04:01 ERROR conn refused',
    '12:04:05 retrying in 2s',
    '12:04:09 error retry 1 failed',
  ].join('\n')

  // Real logs mix ERROR and error in the same stream.
  it('matches case-insensitively', () => {
    expect(filterLogLines(sample, 'error')).toEqual([
      '12:04:01 ERROR conn refused',
      '12:04:09 error retry 1 failed',
    ])
    expect(filterLogLines(sample, 'ERROR')).toHaveLength(2)
  })

  it('treats a blank or whitespace-only query as no filter at all', () => {
    expect(filterLogLines(sample, '')).toHaveLength(4)
    expect(filterLogLines(sample, '   ')).toHaveLength(4)
  })

  // Interior whitespace is significant, which is what makes "GET " usable.
  it('keeps interior whitespace significant', () => {
    expect(filterLogLines(sample, 'GET ')).toEqual(['12:04:00 GET /health 200'])
  })

  // Literal, not regex: a metacharacter finds itself instead of throwing.
  it('matches literally, not as a regex', () => {
    expect(filterLogLines('a+b\nab', 'a+b')).toEqual(['a+b'])
    expect(filterLogLines('x.y\nxzy', '.')).toEqual(['x.y'])
  })

  // The viewer tells "no match" apart from "no output at all" by checking the
  // unfiltered total, so both must stay distinguishable.
  it('keeps no-match distinguishable from no-output', () => {
    expect(filterLogLines(sample, 'nope')).toEqual([])
    expect(splitLogLines(sample)).toHaveLength(4)
    expect(filterLogLines('', 'nope')).toEqual([])
    expect(splitLogLines('')).toHaveLength(0)
  })
})

describe('logs gating', () => {
  // The reason isNeverDeployed exists at all: classifyResourceState folds an
  // exited container in with never-deployed ones, but only the latter has
  // nothing to read. Hiding logs on a crash is the failure this prevents.
  it('does not treat a crashed container as never deployed', () => {
    expect(classifyResourceState('exited (1)')).toBe('stopped')
    expect(isNeverDeployed('exited (1)')).toBe(false)
    expect(isNeverDeployed('stopped')).toBe(false)
    expect(isNeverDeployed('running')).toBe(false)
    expect(isNeverDeployed('deploying')).toBe(false)
  })

  it('recognises the phrasings Coolify uses for never deployed', () => {
    expect(isNeverDeployed('never deployed')).toBe(true)
    expect(isNeverDeployed('never-deployed')).toBe(true)
    expect(isNeverDeployed('not deployed')).toBe(true)
    expect(isNeverDeployed('Never Deployed')).toBe(true)
  })

  // An unknown or absent status is not evidence of absence: stay readable.
  it('stays readable on an unknown or absent status', () => {
    expect(isNeverDeployed(undefined)).toBe(false)
    expect(isNeverDeployed(null)).toBe(false)
    expect(isNeverDeployed('')).toBe(false)
  })
})

describe('deployment logs', () => {
  // Unlike the container endpoint's flat blob, a deployment's `logs` is a JSON
  // array of build steps. This is the stream that says *why* a deploy failed —
  // the container one cannot, because a failed build never replaces the
  // container it reads from.
  //
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

  it('renders commands and output, and drops hidden bookkeeping', () => {
    expect(splitLogLines(parseDeploymentLogs(buildLog))).toEqual([
      '2026-08-05T12:00:00Z Starting deployment',
      'docker build .',
      'ERROR: failed to solve',
    ])
  })

  // Sorting on a key the records do not carry would silently scramble output.
  it('preserves the array order it was given', () => {
    expect(
      splitLogLines(
        parseDeploymentLogs(
          JSON.stringify([{ output: 'first' }, { output: 'second' }]),
        ),
      ),
    ).toEqual(['first', 'second'])
  })

  // The rest of a multi-line entry did not happen at that instant.
  it('stamps a timestamp on the first line of an entry only', () => {
    expect(
      splitLogLines(
        parseDeploymentLogs(
          JSON.stringify([{ output: 'line one\nline two', timestamp: '12:00:00' }]),
        ),
      ),
    ).toEqual(['12:00:00 line one', 'line two'])
  })

  // A build that died early may hold a bare error string, and showing it beats
  // showing nothing.
  it('shows unparseable input rather than swallowing it', () => {
    expect(parseDeploymentLogs('boom: not json')).toBe('boom: not json')
    expect(parseDeploymentLogs('{"not":"an array"}')).toBe('{"not":"an array"}')
  })

  it('keeps nothing-to-show empty instead of inventing a phantom line', () => {
    expect(parseDeploymentLogs('')).toBe('')
    expect(parseDeploymentLogs(null)).toBe('')
    expect(parseDeploymentLogs(undefined)).toBe('')
    expect(parseDeploymentLogs('[]')).toBe('')
  })

  it('feeds the filter and highlighter like any other log text', () => {
    expect(filterLogLines(parseDeploymentLogs(buildLog), 'error')).toEqual([
      'ERROR: failed to solve',
    ])
    expect(tokenizeLogLine('ERROR: failed to solve').severity).toBe('error')
  })
})

describe('syntax highlighting', () => {
  const kinds = (line: string): LogSegmentKind[] =>
    tokenizeLogLine(line).segments.map((s) => s.kind)
  const textOf = (line: string, kind: LogSegmentKind): string[] =>
    tokenizeLogLine(line)
      .segments.filter((s) => s.kind === kind)
      .map((s) => s.text)

  // The invariant that matters most: colouring must never alter what the
  // container actually wrote.
  it.each([
    '2026-08-05T12:04:01.123456789Z [ERROR] conn refused',
    '12:04:00 INFO  server started',
    '[2026-08-05 12:04:02] WARN slow query 2.1s',
    'plain output with no markers at all',
    '  leading spaces preserved  ',
    '',
    'ERROR',
  ])('reassembles %j exactly from its segments', (line) => {
    expect(
      tokenizeLogLine(line)
        .segments.map((s) => s.text)
        .join(''),
    ).toBe(line)
  })

  // docker's --timestamps output, plus the shapes apps print themselves.
  it('recognises the timestamp shapes that actually appear', () => {
    expect(textOf('2026-08-05T12:04:01.123456789Z boot', 'timestamp')).toEqual([
      '2026-08-05T12:04:01.123456789Z',
    ])
    expect(textOf('2026-08-05T12:04:01+02:00 boot', 'timestamp')).toEqual([
      '2026-08-05T12:04:01+02:00',
    ])
    expect(textOf('2026-08-05 12:04:01,123 boot', 'timestamp')).toEqual([
      '2026-08-05 12:04:01,123',
    ])
    expect(textOf('[12:04:01] boot', 'timestamp')).toEqual(['[12:04:01]'])
    expect(textOf('12:04:01 boot', 'timestamp')).toEqual(['12:04:01'])
  })

  it('does not mistake mid-line digits for a clock', () => {
    expect(textOf('took 12:04:01 to finish', 'timestamp')).toEqual([])
    // Three digits before the colon is not an hour.
    expect(textOf('404:12:33 not found', 'timestamp')).toEqual([])
  })

  it('recognises levels delimited or bare, in either case', () => {
    expect(textOf('[ERROR] boom', 'level')).toEqual(['[ERROR]'])
    expect(textOf('(warn) slow', 'level')).toEqual(['(warn)'])
    expect(textOf('level=error boom', 'level')).toEqual(['error'])
    expect(tokenizeLogLine('[ERROR] boom').severity).toBe('error')
    expect(tokenizeLogLine('FATAL disk full').severity).toBe('error')
    expect(tokenizeLogLine('[WARNING] slow').severity).toBe('warn')
    expect(tokenizeLogLine('INFO ready').severity).toBe('info')
    expect(tokenizeLogLine('[TRACE] enter').severity).toBe('debug')
  })

  // A trailing tag cannot downgrade a line that already announced itself.
  it('lets whichever marker appears first win', () => {
    expect(tokenizeLogLine('ERROR failed to parse [INFO]').severity).toBe('error')
    expect(textOf('ERROR failed to parse [INFO]', 'level')).toEqual(['ERROR'])
    expect(tokenizeLogLine('[INFO] retrying after error').severity).toBe('info')
  })

  it('does not let a highlight bleed into a longer word', () => {
    expect(tokenizeLogLine('no errors found').severity).toBeNull()
    expect(tokenizeLogLine('terrible outcome').severity).toBeNull()
    expect(tokenizeLogLine('informational note').severity).toBeNull()
    expect(kinds('plain output')).toEqual(['text'])
  })

  it('emits all three kinds in reading order for a timestamped error', () => {
    expect(kinds('12:04:01 [ERROR] conn refused')).toEqual([
      'timestamp',
      'text',
      'level',
      'text',
    ])
  })

  it('gives an empty line no segments, so the viewer renders a blank row', () => {
    expect(tokenizeLogLine('').segments).toEqual([])
    expect(tokenizeLogLine('').severity).toBeNull()
  })
})
