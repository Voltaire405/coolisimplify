import { describe, it, expect } from "vitest"
import { databaseConnectionUrls, postgresUrlFormats } from "./database-detail"

describe("databaseConnectionUrls", () => {
  it("labels the type from the image and exposes both URLs", () => {
    const urls = databaseConnectionUrls({
      image: "postgres:16-alpine",
      internal_db_url: "postgres://postgres:secret@abc123:5432/postgres",
      external_db_url: "postgres://postgres:secret@203.0.113.5:5432/postgres",
    })
    expect(urls).toEqual({
      label: "Postgres",
      internalUrl: "postgres://postgres:secret@abc123:5432/postgres",
      publicUrl: "postgres://postgres:secret@203.0.113.5:5432/postgres",
    })
  })

  it("returns null publicUrl when the database is not exposed", () => {
    const urls = databaseConnectionUrls({
      image: "postgres:16-alpine",
      internal_db_url: "postgres://postgres:secret@abc123:5432/postgres",
      external_db_url: null,
    })
    expect(urls.publicUrl).toBeNull()
    expect(urls.label).toBe("Postgres")
  })

  it("treats blank URLs as absent", () => {
    const urls = databaseConnectionUrls({
      image: "redis:7",
      internal_db_url: "   ",
      external_db_url: null,
    })
    expect(urls.internalUrl).toBeNull()
    expect(urls.label).toBe("Redis")
  })

  it("returns a null label for an unknown image", () => {
    const urls = databaseConnectionUrls({ image: "some-custom-thing" })
    expect(urls.label).toBeNull()
    expect(urls.internalUrl).toBeNull()
    expect(urls.publicUrl).toBeNull()
  })

  it("labels every supported database type", () => {
    const cases: Array<[string, string]> = [
      ["mysql:8", "MySQL"],
      ["mariadb:11", "MariaDB"],
      ["redis:7", "Redis"],
      ["keydb:latest", "KeyDB"],
      ["dragonfly:latest", "Dragonfly"],
      ["clickhouse:24", "ClickHouse"],
      ["mongo:7", "MongoDB"],
    ]
    for (const [image, label] of cases) {
      expect(databaseConnectionUrls({ image }).label).toBe(label)
    }
  })
})

describe("postgresUrlFormats", () => {
  const base = "postgres://user:pass@abc123:5432/postgres"

  it("converts a short postgres:// URL into the long postgresql:// uri", () => {
    const formats = postgresUrlFormats(base)
    expect(formats.original).toBe(base)
    expect(formats.uri).toBe("postgresql://user:pass@abc123:5432/postgres")
    expect(formats.shortUri).toBe(base)
  })

  it("converts a long postgresql:// URL into the short postgres:// shortUri", () => {
    const long = "postgresql://user:pass@abc123:5432/postgres"
    const formats = postgresUrlFormats(long)
    expect(formats.uri).toBe(long)
    expect(formats.shortUri).toBe("postgres://user:pass@abc123:5432/postgres")
    expect(formats.original).toBe(long)
  })

  it("builds a jdbc URL moving credentials into user/password params", () => {
    const formats = postgresUrlFormats(base)
    expect(formats.jdbc).toBe(
      "jdbc:postgresql://abc123:5432/postgres?user=user&password=pass"
    )
  })

  it("emits no user/password jdbc params when the URL has no credentials", () => {
    const formats = postgresUrlFormats("postgres://abc123:5432/postgres")
    expect(formats.jdbc).toBe("jdbc:postgresql://abc123:5432/postgres")
  })

  it("preserves the sslmode (and sslrootcert) query params in every format", () => {
    const url =
      "postgres://user:pass@abc123:5432/postgres?sslmode=verify-full&sslrootcert=/etc/ssl/certs/coolify-ca.crt"
    const formats = postgresUrlFormats(url)
    expect(formats.uri).toBe(
      "postgresql://user:pass@abc123:5432/postgres?sslmode=verify-full&sslrootcert=/etc/ssl/certs/coolify-ca.crt"
    )
    expect(formats.shortUri).toBe(
      "postgres://user:pass@abc123:5432/postgres?sslmode=verify-full&sslrootcert=/etc/ssl/certs/coolify-ca.crt"
    )
    expect(formats.jdbc).toBe(
      "jdbc:postgresql://abc123:5432/postgres?user=user&password=pass&sslmode=verify-full&sslrootcert=/etc/ssl/certs/coolify-ca.crt"
    )
  })

  it("decodes then re-encodes percent-encoded credentials", () => {
    const url = "postgres://my%40user:p%40ss%2Fword@abc123:5432/postgres"
    const formats = postgresUrlFormats(url)
    expect(formats.uri).toBe(
      "postgresql://my%40user:p%40ss%2Fword@abc123:5432/postgres"
    )
    expect(formats.jdbc).toBe(
      "jdbc:postgresql://abc123:5432/postgres?user=my%40user&password=p%40ss%2Fword"
    )
  })

  it("keeps userinfo over an existing user/password query param in jdbc", () => {
    const formats = postgresUrlFormats(
      "postgres://user:pass@abc123:5432/postgres?user=other&password=otherpw"
    )
    expect(formats.jdbc).toBe(
      "jdbc:postgresql://abc123:5432/postgres?user=user&password=pass"
    )
  })

  it("returns only original for an unparseable URL", () => {
    const formats = postgresUrlFormats("not a url : : //")
    expect(formats).toEqual({
      original: "not a url : : //",
      jdbc: null,
      uri: null,
      shortUri: null,
    })
  })

  it("returns only original for a non-postgres scheme", () => {
    const formats = postgresUrlFormats("mysql://user:pass@db:3306/things")
    expect(formats).toEqual({
      original: "mysql://user:pass@db:3306/things",
      jdbc: null,
      uri: null,
      shortUri: null,
    })
  })

  it("returns only original for a blank input", () => {
    const formats = postgresUrlFormats("")
    expect(formats.original).toBe("")
    expect(formats.jdbc).toBeNull()
    expect(formats.uri).toBeNull()
    expect(formats.shortUri).toBeNull()
  })
})
