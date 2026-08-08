// Verifies the pure copy decision + payload builder (issue #7) without a live
// Coolify instance: create-vs-replace by exact, case-insensitive, trimmed key
// match within the chosen destination section, faithful payload building
// (source value + flags, `is_preview` per section, destination flags
// overwritten on replace), destination key validation, unreadable-value and
// self-copy refusal, and that every payload the module can produce conforms to
// the env-var request schemas in coolify-openapi-v4.x.yaml.
import { describe, expect, it } from "vitest"
import { envRequestProps } from "../test/coolify-spec"
import { buildEnvCopy, type EnvCopyInput } from "./copy-env"
import type { EnvironmentVariable, ResourceType } from "./types"

const ALL_TYPES: ResourceType[] = ["application", "service", "database"]

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

function source(
  resource: { type: ResourceType; uuid: string } = {
    type: "application",
    uuid: "src-res",
  },
  envOverrides: Partial<EnvironmentVariable> = {}
) {
  return { resource, env: env(envOverrides) }
}

function input(overrides: Partial<EnvCopyInput> = {}): EnvCopyInput {
  return {
    source: source(),
    destination: { type: "application", uuid: "dst-res" },
    destinationSection: "Production",
    destinationKey: "DST_KEY",
    destinationEnvs: [],
    ...overrides,
  }
}

describe("create vs replace decision", () => {
  it("creates when the key does not exist in the destination section", () => {
    expect(buildEnvCopy(input())).toMatchObject({ action: "create" })
  })

  it("replaces on an exact key match within the section", () => {
    const target = env({ uuid: "dst-env", key: "DST_KEY", value: "old" })
    const plan = buildEnvCopy(
      input({ destinationEnvs: [target], destinationKey: "DST_KEY" })
    )
    expect(plan.action).toBe("replace")
    expect(plan.target).toEqual(target)
  })

  it("matches case-insensitively", () => {
    const plan = buildEnvCopy(
      input({
        destinationEnvs: [env({ uuid: "dst-env", key: "dst_key" })],
        destinationKey: "DST_KEY",
      })
    )
    expect(plan.action).toBe("replace")
  })

  it("matches ignoring surrounding whitespace", () => {
    const plan = buildEnvCopy(
      input({
        destinationEnvs: [env({ uuid: "dst-env", key: "DST_KEY" })],
        destinationKey: "  DST_KEY  ",
      })
    )
    expect(plan.action).toBe("replace")
    expect(plan.payload.key).toBe("DST_KEY")
  })

  it("refuses when the section already holds two matches of the chosen key", () => {
    expect(() =>
      buildEnvCopy(
        input({
          destinationSection: "Production",
          destinationKey: "KEY",
          destinationEnvs: [
            env({ uuid: "e1", key: "KEY" }),
            env({ uuid: "e2", key: "key" }),
          ],
        })
      )
    ).toThrow(/already exists more than once in Production/)
  })

  it("only matches within the chosen destination section", () => {
    const productionMatch = env({ uuid: "dst-env", key: "SHARED" })
    const previewMatch = env({
      uuid: "dst-preview-env",
      key: "SHARED",
      is_preview: true,
    })
    // A Production row does not trigger a replace for a Preview copy, and a
    // Preview row does not trigger one for a Production copy (ADR-0008: the
    // two lists hold separate records that may share a key).
    expect(
      buildEnvCopy(
        input({
          destinationSection: "Preview",
          destinationKey: "SHARED",
          destinationEnvs: [productionMatch],
        })
      ).action
    ).toBe("create")
    expect(
      buildEnvCopy(
        input({
          destinationSection: "Production",
          destinationKey: "SHARED",
          destinationEnvs: [previewMatch],
        })
      ).action
    ).toBe("create")
    // The same key within the chosen section still replaces.
    expect(
      buildEnvCopy(
        input({
          destinationSection: "Preview",
          destinationKey: "SHARED",
          destinationEnvs: [productionMatch, previewMatch],
        })
      ).action
    ).toBe("replace")
  })
})

describe("payload building", () => {
  it("carries the source's readable value and flags on create", () => {
    const plan = buildEnvCopy(
      input({
        source: source(
          { type: "application", uuid: "src-res" },
          {
            key: "SRC_KEY",
            value: "raw",
            real_value: "secret",
            is_literal: true,
            is_multiline: true,
            is_shown_once: true,
          }
        ),
        destinationSection: "Production",
        destinationKey: "  NEW_KEY  ",
      })
    )
    expect(plan.action).toBe("create")
    expect(plan.payload).toEqual({
      key: "NEW_KEY",
      value: "secret",
      is_literal: true,
      is_multiline: true,
      is_shown_once: true,
      is_preview: false,
    })
  })

  it("defaults missing flags to false", () => {
    const plan = buildEnvCopy(
      input({
        source: source(
          { type: "application", uuid: "src-res" },
          { value: "v" }
        ),
        destinationKey: "NEW_KEY",
      })
    )
    expect(plan.payload).toEqual({
      key: "NEW_KEY",
      value: "v",
      is_literal: false,
      is_multiline: false,
      is_shown_once: false,
      is_preview: false,
    })
  })

  it("dictates is_preview from the chosen section, not the source's", () => {
    // A Preview source copied into Production lands as a production var.
    const plan = buildEnvCopy(
      input({
        source: source(
          { type: "application", uuid: "src-res" },
          { is_preview: true, value: "v" }
        ),
        destinationSection: "Production",
        destinationKey: "NEW_KEY",
      })
    )
    expect(plan.payload.is_preview).toBe(false)
    // A Production source copied into Preview lands as a preview var.
    const toPreview = buildEnvCopy(
      input({
        destinationSection: "Preview",
        destinationKey: "NEW_KEY",
      })
    )
    expect(toPreview.payload.is_preview).toBe(true)
  })

  it("overwrites the destination's flags with the source's on replace", () => {
    const plan = buildEnvCopy(
      input({
        source: source(
          { type: "application", uuid: "src-res" },
          {
            value: "new",
            is_literal: false,
            is_multiline: false,
            is_shown_once: false,
          }
        ),
        destinationKey: "KEY",
        destinationEnvs: [
          env({
            uuid: "dst-env",
            key: "KEY",
            value: "old",
            is_literal: true,
            is_multiline: true,
            is_shown_once: true,
          }),
        ],
      })
    )
    expect(plan.action).toBe("replace")
    expect(plan.target?.uuid).toBe("dst-env")
    expect(plan.payload).toEqual({
      key: "KEY",
      value: "new",
      is_literal: false,
      is_multiline: false,
      is_shown_once: false,
      is_preview: false,
    })
  })

  it("never sends is_preview for a database destination", () => {
    const plan = buildEnvCopy(
      input({
        destination: { type: "database", uuid: "dst-db" },
        destinationKey: "NEW_KEY",
      })
    )
    expect(plan.payload).not.toHaveProperty("is_preview")
  })

  it("sends is_preview for a service destination", () => {
    const plan = buildEnvCopy(
      input({
        destination: { type: "service", uuid: "dst-svc" },
        destinationSection: "Preview",
        destinationKey: "NEW_KEY",
      })
    )
    expect(plan.payload.is_preview).toBe(true)
  })
})

describe("destination key validation", () => {
  it("refuses an empty key", () => {
    expect(() => buildEnvCopy(input({ destinationKey: "" }))).toThrow(
      /Key is required/
    )
  })

  it("refuses a whitespace-only key", () => {
    expect(() => buildEnvCopy(input({ destinationKey: "   " }))).toThrow(
      /Key is required/
    )
  })

  it("trims the key before using it", () => {
    const plan = buildEnvCopy(
      input({
        destinationKey: "  KEY  ",
        destinationEnvs: [env({ uuid: "dst-env", key: "KEY" })],
      })
    )
    expect(plan.action).toBe("replace")
    expect(plan.payload.key).toBe("KEY")
  })
})

describe("source value readability gate", () => {
  it("refuses a shown-once secret whose real value was never returned", () => {
    expect(() =>
      buildEnvCopy(
        input({
          source: source(
            { type: "application", uuid: "src-res" },
            { is_shown_once: true, real_value: null }
          ),
        })
      )
    ).toThrow(/The value is not available to copy/)
  })

  it("allows an empty-but-readable value", () => {
    const plan = buildEnvCopy(
      input({
        source: source(
          { type: "application", uuid: "src-res" },
          { value: "", real_value: "" }
        ),
        destinationKey: "EMPTY_KEY",
      })
    )
    expect(plan.action).toBe("create")
    expect(plan.payload.value).toBe("")
  })

  it("allows a shown-once secret whose real value is present", () => {
    const plan = buildEnvCopy(
      input({
        source: source(
          { type: "application", uuid: "src-res" },
          { is_shown_once: true, real_value: "secret" }
        ),
        destinationKey: "NEW_KEY",
      })
    )
    expect(plan.payload.value).toBe("secret")
    expect(plan.payload.is_shown_once).toBe(true)
  })
})

describe("self-copy refusal", () => {
  it("refuses the same Resource, same key, same section", () => {
    expect(() =>
      buildEnvCopy(
        input({
          source: source({ type: "application", uuid: "res" }, { key: "KEY" }),
          destination: { type: "application", uuid: "res" },
          destinationSection: "Production",
          destinationKey: "KEY",
        })
      )
    ).toThrow(/Cannot copy a variable onto itself/)
  })

  it("refuses case-insensitively and ignoring whitespace", () => {
    expect(() =>
      buildEnvCopy(
        input({
          source: source({ type: "application", uuid: "res" }, { key: "KEY" }),
          destination: { type: "application", uuid: "res" },
          destinationSection: "Production",
          destinationKey: "  key  ",
        })
      )
    ).toThrow(/Cannot copy a variable onto itself/)
  })

  it("allows a different section on the same Resource", () => {
    const plan = buildEnvCopy(
      input({
        source: source({ type: "application", uuid: "res" }, { key: "KEY" }),
        destination: { type: "application", uuid: "res" },
        destinationSection: "Preview",
        destinationKey: "KEY",
      })
    )
    expect(plan.action).toBe("create")
  })

  it("allows a different key on the same Resource", () => {
    const plan = buildEnvCopy(
      input({
        source: source({ type: "application", uuid: "res" }, { key: "KEY" }),
        destination: { type: "application", uuid: "res" },
        destinationSection: "Production",
        destinationKey: "OTHER_KEY",
      })
    )
    expect(plan.action).toBe("create")
  })

  it("allows the same key and section on a different Resource", () => {
    const plan = buildEnvCopy(
      input({
        source: source({ type: "application", uuid: "src" }, { key: "KEY" }),
        destination: { type: "application", uuid: "dst" },
        destinationSection: "Production",
        destinationKey: "KEY",
        destinationEnvs: [env({ uuid: "dst-env", key: "KEY", value: "old" })],
      })
    )
    expect(plan.action).toBe("replace")
  })
})

describe("payload conformance to the OpenAPI spec", () => {
  it.each(ALL_TYPES)(
    "every payload the module can produce conforms for a %s destination",
    (type) => {
      const sections = ["Production", "Preview"] as const
      for (const section of sections) {
        for (const action of ["create", "replace"] as const) {
          const plan = buildEnvCopy(
            input({
              destination: { type, uuid: "dst-res" },
              destinationSection: section,
              destinationKey: action === "replace" ? "EXISTING" : "NEW_KEY",
              destinationEnvs:
                action === "replace"
                  ? [
                      env({
                        uuid: "dst-env",
                        key: "EXISTING",
                        value: "old",
                        is_literal: true,
                        is_multiline: true,
                        is_shown_once: true,
                        ...(section === "Preview" ? { is_preview: true } : {}),
                      }),
                    ]
                  : [],
            })
          )
          expect(plan.action).toBe(action)
          // A create goes to POST, a replace to PATCH: validate each payload
          // against the request schema of the endpoint that will receive it.
          const allowed = envRequestProps(
            type,
            action === "replace" ? "patch" : "post"
          )
          for (const k of Object.keys(plan.payload)) {
            expect(
              allowed,
              `${type}/${section}/${action}: field ${k} not allowed by the spec`
            ).toContain(k)
          }
          if (type === "database") {
            expect(plan.payload).not.toHaveProperty("is_preview")
          } else {
            expect(plan.payload.is_preview).toBe(section === "Preview")
          }
        }
      }
    }
  )
})
