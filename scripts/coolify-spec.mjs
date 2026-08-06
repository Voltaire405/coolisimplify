// Minimal extractor for the two YAML blocks the payload check needs, so the
// repo does not take a YAML parser dependency just for this.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
// Based on Coolify's v4.x openapi.yaml, but NOT a verbatim copy: where the
// upstream document disagreed with a live instance, the file follows the
// instance. Those spots are marked `[verified]`; see the header of the YAML.
// https://github.com/coollabsio/coolify/blob/v4.x/openapi.yaml
const YAML = join(HERE, '..', 'coolify-openapi-v4.x.yaml')
const lines = readFileSync(YAML, 'utf8').split('\n')

function indentOf(line) {
  return line.length - line.trimStart().length
}

/** Collect `key:` entries at exactly `indent`, plus their nested type/enum. */
function propsAt(startLine, endLine, indent) {
  const out = {}
  let current = null
  for (let i = startLine; i < endLine; i++) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) continue
    const ind = indentOf(line)
    const m = line.trim().match(/^([a-z_][a-z0-9_]*):(.*)$/)
    if (ind === indent && m) {
      current = m[1]
      out[current] = { type: null, nullable: false, enum: null }
      const it = m[2].trim().match(/type:\s*([a-z]+)/)
      if (it) out[current].type = it[1]
      continue
    }
    if (current && ind > indent) {
      const t = line.trim().match(/^type:\s*(\S+)/)
      if (t && out[current].type === null) out[current].type = t[1]
      const n = line.trim().match(/^nullable:\s*(true|false)/)
      if (n) out[current].nullable = n[1] === 'true'
      const e = line.trim().match(/^enum:\s*\[(.*)\]/)
      if (e) {
        out[current].enum = e[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
      }
    }
  }
  return out
}

function findLine(re, from = 0) {
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i
  return -1
}

/** Request schema (allowed properties + required) for a given path. */
export function createSchema(path) {
  const start = findLine(new RegExp(`^  ${path.replace(/\//g, '\\/')}:\\s*$`))
  if (start < 0) throw new Error(`path not found: ${path}`)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (indentOf(lines[i]) === 2 && lines[i].trim().endsWith(':')) {
      end = i
      break
    }
  }
  const reqLine = findLine(/^\s{14}required:\s*$/, start)
  const required = []
  if (reqLine > start && reqLine < end) {
    for (let i = reqLine + 1; i < end; i++) {
      const m = lines[i].match(/^\s{16}- (\S+)\s*$/)
      if (!m) break
      required.push(m[1])
    }
  }
  const propsLine = findLine(/^\s{14}properties:\s*$/, start)
  return { required, props: propsAt(propsLine + 1, end, 16) }
}

/**
 * Parameters of a path's GET operation: name -> { in, required, type, default }.
 * Values stay as the raw YAML strings; callers compare against what they send.
 */
export function queryParams(path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const start = findLine(new RegExp(`^  '?${escaped}'?:\\s*$`))
  if (start < 0) throw new Error(`path not found: ${path}`)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (indentOf(lines[i]) === 2 && lines[i].trim().endsWith(':')) {
      end = i
      break
    }
  }
  // Bound the scan to the parameters block, so `type:` keys under responses
  // cannot leak into the last parameter read.
  const from = findLine(/^\s{6}parameters:\s*$/, start)
  if (from < 0 || from >= end) throw new Error(`no parameters block: ${path}`)
  const resp = findLine(/^\s{6}responses:\s*$/, from)
  const to = resp > from && resp < end ? resp : end

  const out = {}
  let current = null
  for (let i = from + 1; i < to; i++) {
    const t = lines[i].trim()
    const name = t.match(/^name:\s*(\S+)$/)
    if (name) {
      current = { in: null, required: false, type: null, default: undefined }
      out[name[1]] = current
      continue
    }
    if (!current) continue
    const where = t.match(/^in:\s*(\S+)$/)
    if (where) current.in = where[1]
    const req = t.match(/^required:\s*(true|false)$/)
    if (req) current.required = req[1] === 'true'
    const type = t.match(/^type:\s*(\S+)$/)
    if (type && current.type === null) current.type = type[1]
    const def = t.match(/^default:\s*(\S+)$/)
    if (def && current.default === undefined) current.default = def[1]
  }
  return out
}

/** Component schema properties, e.g. the Application GET response. */
export function componentSchema(name) {
  const start = findLine(new RegExp(`^    ${name}:\\s*$`))
  if (start < 0) throw new Error(`component not found: ${name}`)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (indentOf(lines[i]) === 4 && lines[i].trim().endsWith(':')) {
      end = i
      break
    }
  }
  const propsLine = findLine(/^\s{6}properties:\s*$/, start)
  return propsAt(propsLine + 1, end, 8)
}
