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

export interface DatabaseConnectionUrls {
  /** Type label, null when the image does not map to a known database type. */
  label: string | null
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
    internalUrl: db.internal_db_url?.trim() || null,
    publicUrl: db.external_db_url?.trim() || null,
  }
}
