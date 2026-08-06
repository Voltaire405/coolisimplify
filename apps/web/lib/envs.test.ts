// Verifies the env var editing layer without touching a live Coolify instance:
// URL mapping, value readability semantics, and that every payload the editor
// can send conforms to the env-var request schemas in coolify-openapi-v4.x.yaml.
import { describe, expect, it } from "vitest"
import { specLines } from "../test/coolify-spec"
import type { EnvironmentVariable, ResourceType } from "./types"
import {
  envBasePath,
  envItemPath,
  envSupportsPreview,
  envUpdateIncludesPreview,
  envValue,
  filterEnvsByKey,
  isValueReadable,
  partitionEnvsByPreview,
  sortEnvsByKey,
} from "./envs"

const ALL_TYPES: ResourceType[] = ["application", "service", "database"]

describe("URL mapping", () => {
  it("maps every resource type to its env collection", () => {
    expect(envBasePath("application", "a1")).toBe("/applications/a1/envs")
    expect(envBasePath("service", "s1")).toBe("/services/s1/envs")
    expect(envBasePath("database", "d1")).toBe("/databases/d1/envs")
  })

  it("maps every resource type to a single env item", () => {
    expect(envItemPath("application", "a1", "e1")).toBe(
      "/applications/a1/envs/e1"
    )
    expect(envItemPath("service", "s1", "e1")).toBe("/services/s1/envs/e1")
    expect(envItemPath("database", "d1", "e1")).toBe("/databases/d1/envs/e1")
  })
})

describe("value readability", () => {
  it("prefers real_value and falls back to value", () => {
    expect(envValue({ real_value: "secret", value: "" })).toBe("secret")
    expect(envValue({ real_value: null, value: "raw" })).toBe("raw")
    expect(envValue({ real_value: undefined, value: "" })).toBe("")
  })

  it("treats a normal var as readable", () => {
    expect(isValueReadable({ is_shown_once: false, real_value: "x" })).toBe(
      true
    )
  })

  it("treats a shown-once var whose value was never read back as unreadable", () => {
    expect(isValueReadable({ is_shown_once: true, real_value: null })).toBe(
      false
    )
  })

  it("keeps a shown-once var readable when real_value is present", () => {
    expect(isValueReadable({ is_shown_once: true, real_value: "x" })).toBe(true)
  })
})

describe("preview support", () => {
  it("offers preview only on applications, not services or databases", () => {
    expect(envSupportsPreview("application")).toBe(true)
    expect(envSupportsPreview("service")).toBe(false)
    expect(envSupportsPreview("database")).toBe(false)
  })
})

describe("envUpdateIncludesPreview", () => {
  it("sends is_preview on applications and services but never databases", () => {
    expect(envUpdateIncludesPreview("application")).toBe(true)
    expect(envUpdateIncludesPreview("service")).toBe(true)
    expect(envUpdateIncludesPreview("database")).toBe(false)
  })
})

describe("filterEnvsByKey", () => {
  const env = (key: string): EnvironmentVariable => ({
    id: 0,
    uuid: key,
    key,
    value: "",
  })

  it("keeps every variable for an empty query", () => {
    const list = [env("A"), env("B")]
    expect(filterEnvsByKey(list, "")).toEqual(list)
    expect(filterEnvsByKey(list, "   ")).toEqual(list)
  })

  it("matches by substring, case-insensitive", () => {
    const list = [env("DATABASE_URL"), env("REDIS_URL"), env("PORT")]
    expect(filterEnvsByKey(list, "url")).toEqual([
      env("DATABASE_URL"),
      env("REDIS_URL"),
    ])
    expect(filterEnvsByKey(list, "DATABASE")).toEqual([env("DATABASE_URL")])
    expect(filterEnvsByKey(list, "port")).toEqual([env("PORT")])
  })

  it("returns an empty array when nothing matches", () => {
    const list = [env("DATABASE_URL")]
    expect(filterEnvsByKey(list, "nope")).toEqual([])
  })

  it("does not match against values, only keys", () => {
    const list = [env("API_KEY")]
    expect(filterEnvsByKey(list, "secret")).toEqual([])
  })
})

describe("partitionEnvsByPreview", () => {
  const env = (key: string, is_preview: boolean): EnvironmentVariable => ({
    id: 0,
    uuid: `${key}-${is_preview ? "p" : "n"}`,
    key,
    value: "",
    is_preview,
  })

  it("splits production and preview variables into two lists", () => {
    const prod = env("DATABASE_URL", false)
    const prev = env("DATABASE_URL", true)
    expect(partitionEnvsByPreview([prod, prev, env("PORT", false)])).toEqual({
      production: [prod, env("PORT", false)],
      preview: [prev],
    })
  })

  it("keeps each list stable when one side is empty", () => {
    const prod = env("A", false)
    expect(partitionEnvsByPreview([prod])).toEqual({
      production: [prod],
      preview: [],
    })
  })

  it("treats a missing is_preview as production", () => {
    const noFlag: EnvironmentVariable = {
      id: 0,
      uuid: "x",
      key: "X",
      value: "",
    }
    expect(partitionEnvsByPreview([noFlag])).toEqual({
      production: [noFlag],
      preview: [],
    })
  })

  it("preserves the original order within each side", () => {
    const a = env("A", false)
    const b = env("B", true)
    const c = env("C", false)
    expect(partitionEnvsByPreview([c, b, a])).toEqual({
      production: [c, a],
      preview: [b],
    })
  })
})

describe("sortEnvsByKey", () => {
  const env = (key: string): EnvironmentVariable => ({
    id: 0,
    uuid: key,
    key,
    value: "",
  })

  it("sorts case-insensitively by key, A-Z", () => {
    const list = [env("z"), env("A"), env("b")]
    expect(sortEnvsByKey(list).map((e) => e.key)).toEqual(["A", "b", "z"])
  })

  it("is stable for equal keys (same key can exist twice, one per list)", () => {
    const first = env("A")
    const second = env("A")
    expect(sortEnvsByKey([second, first])).toEqual([first, second])
  })

  it("does not mutate the input array", () => {
    const list = [env("B"), env("A")]
    sortEnvsByKey(list)
    expect(list.map((e) => e.key)).toEqual(["B", "A"])
  })
})

// The env-var endpoint paths are quoted in the YAML (e.g.
// `'/applications/{uuid}/envs':`), which the shared coolify-spec helper does
// not parse, so read the request-body properties directly here.
function pluralOf(type: ResourceType): string {
  return type === "application"
    ? "applications"
    : type === "service"
      ? "services"
      : "databases"
}

function envProps(type: ResourceType): Set<string> {
  const path = `'/${pluralOf(type)}/{uuid}/envs':`
  const start = specLines.findIndex(
    (l) => l.trim().replace(/^"|"$/g, "") === path
  )
  expect(start, `env path not found: ${path}`).toBeGreaterThanOrEqual(0)
  // The POST request body is the authoritative create schema. Anchor on the
  // `post:` block (the GET response's `properties:` would otherwise match
  // first), then take the first `properties:` after its `requestBody:`.
  const post = specLines.findIndex((l, i) => i > start && l.trim() === "post:")
  expect(post, `no post block for ${path}`).toBeGreaterThan(start)
  const requestBody = specLines.findIndex(
    (l, i) => i > post && l.trim() === "requestBody:"
  )
  expect(requestBody, `no requestBody for ${path}`).toBeGreaterThan(post)
  const propsStart = specLines.findIndex(
    (l, i) =>
      i > requestBody && l.includes("properties:") && !l.trim().startsWith("#")
  )
  expect(propsStart, `no properties block for ${path}`).toBeGreaterThan(
    requestBody
  )

  const props = new Set<string>()
  for (
    let i = propsStart + 1;
    i < Math.min(propsStart + 40, specLines.length);
    i++
  ) {
    const l = specLines[i]!
    const ind = l.length - l.trimStart().length
    const m = l.trim().match(/^([a-z_][a-z0-9_]*):/)
    if (!m) continue
    if (ind <= 14) break // left the properties block
    props.add(m[1]!)
  }
  return props
}

describe("payload conformance to the OpenAPI spec", () => {
  const EDITABLE = ["key", "value", "is_preview", "is_literal", "is_multiline"]

  // The check is on the EDITABLE set itself, not on a payload pre-filtered by
  // `allowed` (which would be tautological). The one permitted mismatch is
  // `is_preview` for databases, which the editor deliberately never sends.
  it.each(ALL_TYPES)(
    "accepts every field the editor can send on a %s",
    (type) => {
      const allowed = envProps(type)
      for (const k of EDITABLE) {
        if (k === "is_preview" && type === "database") continue
        expect(
          allowed,
          `${type}: editor field ${k} not allowed by the spec`
        ).toContain(k)
      }
    }
  )

  it("does not let databases send is_preview even though the model carries it", () => {
    expect(envProps("database").has("is_preview")).toBe(false)
    expect(envProps("application").has("is_preview")).toBe(true)
    expect(envProps("service").has("is_preview")).toBe(true)
  })
})

// Coolify has no PATCH /{type}/{uuid}/envs/{env_uuid}: updates go to
// PATCH /{type}/{uuid}/envs (routed by key) and only DELETE exists on the item
// path. This fails loudly if a future spec sync adds a patch that should change
// the client back to per-env PATCH.
function envItemMethods(type: ResourceType): string[] {
  const path = `'/${pluralOf(type)}/{uuid}/envs/{env_uuid}':`
  const start = specLines.findIndex(
    (l) => l.trim().replace(/^"|"$/g, "") === path
  )
  expect(start, `env item path not found: ${path}`).toBeGreaterThanOrEqual(0)
  const methods: string[] = []
  for (let i = start + 1; i < Math.min(start + 40, specLines.length); i++) {
    const t = specLines[i]!.trim()
    if (/^(get|post|patch|delete|put):/.test(t))
      methods.push(t.replace(":", ""))
    if (t.startsWith("'") && t.endsWith("':")) break
  }
  return methods
}

describe("endpoint structure (ADR-0003 guard)", () => {
  it.each(ALL_TYPES)("exposes only delete on a %s env item", (type) => {
    expect(envItemMethods(type)).toEqual(["delete"])
  })
})
