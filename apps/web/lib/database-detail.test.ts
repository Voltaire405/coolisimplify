import { describe, it, expect } from "vitest"
import { databaseConnectionUrls } from "./database-detail"

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
