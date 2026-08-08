import type { DatabaseType } from "./types"
import { detectDatabaseType } from "./clone"

/**
 * Display name used to build the connection-URL row labels in the Details tab
 * (e.g. "Postgres URL (internal)"). Mirrors how Coolify presents each type.
 */
export const DATABASE_TYPE_LABEL: Record<DatabaseType, string> = {
  postgresql: "Postgres",
  mysql: "MySQL",
  mariadb: "MariaDB",
  redis: "Redis",
  keydb: "KeyDB",
  dragonfly: "Dragonfly",
  clickhouse: "ClickHouse",
  mongodb: "MongoDB",
}

/**
 * The copy formats offered for a Postgres connection URL. `uri` uses the long
 * `postgresql://` scheme, `short-uri` the short `postgres://` scheme, `jdbc`
 * moves credentials into `user`/`password` query params, and `original` is the
 * URL byte-for-byte as Coolify provided it.
 */
export type PostgresUrlFormat = "original" | "jdbc" | "uri" | "short-uri"

/** Every copyable rendering of a Postgres URL for one input string. */
export interface PostgresUrlFormats {
  original: string
  jdbc: string | null
  uri: string | null
  shortUri: string | null
}

/** Schemes recognised as Postgres so other database URLs pass through untouched. */
const POSTGRES_SCHEMES = new Set(["postgres:", "postgresql:"])

/** RFC 3986 percent-encoding, matching PHP `rawurlencode` (also encodes `!'()*`). */
function rawurlencode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

/**
 * Parses a Postgres URL, or null when the input is blank, unparseable, or uses
 * a non-Postgres scheme. The URL API keeps the userinfo percent-encoded and the
 * query verbatim, so those survive every transformation below.
 */
function parsePostgresUrl(url: string): URL | null {
  if (!url.trim()) return null
  try {
    const parsed = new URL(url)
    return POSTGRES_SCHEMES.has(parsed.protocol) ? parsed : null
  } catch {
    return null
  }
}

/** Re-renders the URL with a different scheme, keeping credentials and query. */
function buildUri(url: URL, scheme: string): string {
  const userinfo = url.username
    ? `${url.username}${url.password ? `:${url.password}` : ""}@`
    : ""
  return `${scheme}://${userinfo}${url.host}${url.pathname}${url.search}`
}

/**
 * Renders the JDBC form: `jdbc:postgresql://`, credentials moved from the
 * userinfo into `user`/`password` query params (decoded then re-encoded so the
 * output is always a valid URI), and the remaining query params preserved
 * verbatim. When there are no credentials, no `user`/`password` params are
 * emitted and an existing `user`/`password` param is dropped in favour of none.
 */
function buildJdbc(url: URL): string {
  const head: string[] = []
  if (url.username) {
    head.push(`user=${rawurlencode(decodeURIComponent(url.username))}`)
    if (url.password) {
      head.push(`password=${rawurlencode(decodeURIComponent(url.password))}`)
    }
  }
  // Keep the raw search verbatim except for user/password, which the userinfo
  // overrides (dropping them when there are no credentials).
  const tail = (url.search ? url.search.slice(1).split("&") : []).filter(
    (pair) => {
      const key = pair.split("=")[0]
      return key !== "user" && key !== "password"
    }
  )
  const all = [...head, ...tail]
  return `jdbc:postgresql://${url.host}${url.pathname}${all.length ? `?${all.join("&")}` : ""}`
}

/**
 * Renders every supported copy format for a Postgres connection URL. For blank,
 * unparseable, or non-Postgres input only `original` is available and every
 * derived format is null.
 */
export function postgresUrlFormats(url: string): PostgresUrlFormats {
  const parsed = parsePostgresUrl(url)
  if (!parsed) {
    return { original: url, jdbc: null, uri: null, shortUri: null }
  }
  return {
    original: url,
    uri: buildUri(parsed, "postgresql"),
    shortUri: buildUri(parsed, "postgres"),
    jdbc: buildJdbc(parsed),
  }
}

export interface DatabaseConnectionUrls {
  /** Type label, null when the image does not map to a known database type. */
  label: string | null
  /**
   * Detected engine type, null when the image does not map to a known
   * database type. Used to gate postgres-only copy formats in the UI.
   */
  type: DatabaseType | null
  internalUrl: string | null
  /** The public URL; null when the database is not exposed to the internet. */
  publicUrl: string | null
}

/**
 * The connection URLs Coolify provides for a database, labelled by type. Both
 * come from the API (model accessors), so the scheme, ports, credentials and
 * SSL flags are exactly what Coolify computed. `external_db_url` is null when
 * the database is not public, which is what "public only if available" means.
 */
export function databaseConnectionUrls(db: {
  image?: string | null
  internal_db_url?: string | null
  external_db_url?: string | null
}): DatabaseConnectionUrls {
  const type = detectDatabaseType(db.image)
  return {
    label: type ? DATABASE_TYPE_LABEL[type] : null,
    type,
    internalUrl: db.internal_db_url?.trim() || null,
    publicUrl: db.external_db_url?.trim() || null,
  }
}
