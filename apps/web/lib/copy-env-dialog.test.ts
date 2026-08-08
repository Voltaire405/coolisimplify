// The dialog's pure core (issue #8): section defaults for the destination
// radio, the key combo's options, the create/replace verdict with refusals
// surfaced as errors, the success message, and the POST/PATCH routing of the
// confirmed copy through the existing client. The component itself stays thin
// and out of the test scope, per the repo's convention.
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { startFakeCoolify, type FakeCoolify } from "../test/fake-coolify"
import {
  computeCopyPlan,
  copySuccessMessage,
  defaultDestinationSection,
  destinationLocationLabel,
  destinationKeyOptions,
  executeEnvCopy,
  filterDestinationResources,
  withDestinationLocations,
} from "./copy-env-dialog"
import type { ResourceWithType } from "./tree"
import type { EnvironmentVariable } from "./types"

function env(
  overrides: Partial<EnvironmentVariable> = {}
): EnvironmentVariable {
  return {
    id: 0,
    uuid: "env-uuid",
    key: "SRC_KEY",
    value: "src-value",
    ...overrides,
  }
}

function copyInput(
  overrides: Partial<Parameters<typeof computeCopyPlan>[0]> = {}
): Parameters<typeof computeCopyPlan>[0] {
  return {
    source: {
      resource: { type: "application" as const, uuid: "src-res" },
      env: env(),
    },
    destination: { type: "application" as const, uuid: "dst-res" },
    destinationSection: "Production",
    destinationKey: "DST_KEY",
    destinationEnvs: [],
    ...overrides,
  }
}

describe("defaultDestinationSection", () => {
  it("defaults applications to the source's own section", () => {
    expect(defaultDestinationSection("application", false)).toBe("Production")
    expect(defaultDestinationSection("application", true)).toBe("Preview")
  })

  it("pins services and databases to Production regardless of the source", () => {
    expect(defaultDestinationSection("service", true)).toBe("Production")
    expect(defaultDestinationSection("database", true)).toBe("Production")
  })
})

describe("destinationKeyOptions", () => {
  it("offers only the existing keys of the chosen section", () => {
    const envs = [
      env({ key: "beta" }),
      env({ key: "ALPHA" }),
      env({ key: "zeta", is_preview: true }),
      env({ key: "Gamma", is_preview: true }),
    ]
    expect(destinationKeyOptions(envs, "Production")).toEqual(["ALPHA", "beta"])
    expect(destinationKeyOptions(envs, "Preview")).toEqual(["Gamma", "zeta"])
  })

  it("sorts case-insensitively A-Z within the section", () => {
    const envs = [env({ key: "z" }), env({ key: "A" }), env({ key: "m" })]
    expect(destinationKeyOptions(envs, "Production")).toEqual(["A", "m", "z"])
  })
})

describe("computeCopyPlan", () => {
  it("reports a create for a key absent from the destination section", () => {
    const result = computeCopyPlan(copyInput())
    expect(result).toHaveProperty("plan")
    if ("plan" in result) expect(result.plan.action).toBe("create")
  })

  it("reports a replace for a key present in the destination section", () => {
    const result = computeCopyPlan(
      copyInput({
        destinationEnvs: [env({ uuid: "dst-env", key: "DST_KEY" })],
      })
    )
    expect(result).toHaveProperty("plan")
    if ("plan" in result) expect(result.plan.action).toBe("replace")
  })

  it("surfaces refusals as errors instead of throwing", () => {
    const unreadable = computeCopyPlan(
      copyInput({
        source: {
          resource: { type: "application", uuid: "src-res" },
          env: env({ is_shown_once: true, real_value: null }),
        },
      })
    )
    expect("error" in unreadable && unreadable.error).toBe(
      "The value is not available to copy"
    )

    const emptyKey = computeCopyPlan(copyInput({ destinationKey: "  " }))
    expect("error" in emptyKey && emptyKey.error).toBe("Key is required")

    const dupSection = computeCopyPlan(
      copyInput({
        destinationKey: "DST_KEY",
        destinationEnvs: [
          env({ uuid: "e1", key: "DST_KEY" }),
          env({ uuid: "e2", key: "dst_key" }),
        ],
      })
    )
    expect("error" in dupSection && dupSection.error).toContain(
      "already exists more than once"
    )
  })
})

describe("filterDestinationResources", () => {
  // The search reads name, type, fqdn and destination.server.name only, so the
  // fixtures carry just those fields (the full Resource types demand more).
  const resources = [
    {
      type: "application",
      resource: {
        uuid: "a1",
        name: "API",
        fqdn: "api.example.com",
        destination: { server: { name: "prod-1" } },
      },
    },
    {
      type: "service",
      resource: {
        uuid: "s1",
        name: "Postgres",
        fqdn: null,
        destination: { server: { name: "prod-2" } },
      },
    },
    {
      type: "database",
      resource: { uuid: "d1", name: "Redis" },
    },
  ] as unknown as ResourceWithType[]

  it("keeps the whole list for an empty query", () => {
    expect(filterDestinationResources(resources, "")).toHaveLength(3)
    expect(filterDestinationResources(resources, "  ")).toHaveLength(3)
  })

  it("matches the resource name case-insensitively", () => {
    expect(filterDestinationResources(resources, "api")).toHaveLength(1)
    expect(filterDestinationResources(resources, "post")).toHaveLength(1)
  })

  it("matches the resource type", () => {
    expect(filterDestinationResources(resources, "database")).toHaveLength(1)
  })

  it("matches the domain (fqdn)", () => {
    expect(filterDestinationResources(resources, "example.com")).toHaveLength(1)
  })

  it("matches the server name", () => {
    expect(filterDestinationResources(resources, "prod-2")).toHaveLength(1)
  })

  it("finds nothing when no field matches", () => {
    expect(filterDestinationResources(resources, "nomatch")).toHaveLength(0)
  })

  it("matches the project and the environment the resource lives in", () => {
    const located = withDestinationLocations(
      resources,
      [{ id: 1, uuid: "p1", name: "Billing" }],
      { p1: [{ id: 10, uuid: "e1", name: "staging", project_id: 1 }] }
    )
    // Only the first fixture is placed in that environment.
    located[0]!.projectName = "Billing"
    located[0]!.environmentName = "staging"
    expect(filterDestinationResources(located, "billing")).toHaveLength(1)
    expect(filterDestinationResources(located, "staging")).toHaveLength(1)
    expect(
      filterDestinationResources(located, "Billing / staging")
    ).toHaveLength(1)
  })
})

describe("withDestinationLocations", () => {
  const projects = [
    { id: 1, uuid: "p1", name: "Billing" },
    { id: 2, uuid: "p2", name: "Shop" },
  ]
  const environmentsByProject = {
    p1: [
      { id: 10, uuid: "e1", name: "production", project_id: 1 },
      { id: 11, uuid: "e2", name: "staging", project_id: 1 },
    ],
    p2: [{ id: 20, uuid: "e3", name: "production", project_id: 2 }],
  }
  const resources = [
    {
      type: "application",
      resource: { uuid: "a1", name: "API", environment_id: 10 },
    },
    {
      type: "application",
      resource: { uuid: "a2", name: "API", environment_id: 11 },
    },
    {
      type: "service",
      resource: { uuid: "s1", name: "API", environment_id: 20 },
    },
    { type: "database", resource: { uuid: "d1", name: "Orphan" } },
  ] as unknown as ResourceWithType[]

  it("tells same-named resources apart by project and environment", () => {
    const located = withDestinationLocations(
      resources,
      projects,
      environmentsByProject
    )
    expect(located.map(destinationLocationLabel)).toEqual([
      "Billing / production",
      "Billing / staging",
      "Shop / production",
      "",
    ])
  })

  it("keeps a resource whose environment is unknown", () => {
    const located = withDestinationLocations(resources, projects, {})
    expect(located).toHaveLength(4)
    expect(located.every((r) => destinationLocationLabel(r) === "")).toBe(true)
  })
})

describe("copySuccessMessage", () => {
  it("names the key, destination and section", () => {
    expect(copySuccessMessage("FOO", "API", "Production")).toBe(
      "Copied FOO to API (Production)"
    )
  })

  it("names the destination's location when it is known", () => {
    expect(
      copySuccessMessage("FOO", "API", "Production", "Billing / staging")
    ).toBe("Copied FOO to API · Billing / staging (Production)")
  })
})

describe("executeEnvCopy", () => {
  let fake: FakeCoolify

  beforeEach(async () => {
    fake = await startFakeCoolify(() => ({ body: {} }))
  })
  afterEach(async () => {
    await fake.close()
  })

  const lastRequest = () => fake.requests[fake.requests.length - 1]!

  it("creates via POST on the destination's env collection", async () => {
    const result = computeCopyPlan(
      copyInput({ destination: { type: "service", uuid: "svc-1" } })
    )
    expect(result).toHaveProperty("plan")
    if (!("plan" in result)) return
    await executeEnvCopy(
      fake.client,
      { type: "service", uuid: "svc-1" },
      result.plan
    )
    const req = lastRequest()
    expect(req.method).toBe("POST")
    expect(req.pathname).toBe("/services/svc-1/envs")
    expect(JSON.parse(req.body)).toEqual(result.plan.payload)
  })

  it("replaces via PATCH on the destination's env collection", async () => {
    const result = computeCopyPlan(
      copyInput({
        destination: { type: "database", uuid: "db-1" },
        destinationKey: "DST_KEY",
        destinationEnvs: [env({ uuid: "dst-env", key: "DST_KEY" })],
      })
    )
    expect(result).toHaveProperty("plan")
    if (!("plan" in result)) return
    await executeEnvCopy(
      fake.client,
      { type: "database", uuid: "db-1" },
      result.plan
    )
    const req = lastRequest()
    expect(req.method).toBe("PATCH")
    expect(req.pathname).toBe("/databases/db-1/envs")
    expect(JSON.parse(req.body)).toEqual(result.plan.payload)
  })
})
