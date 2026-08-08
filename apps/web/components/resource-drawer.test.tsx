// @vitest-environment jsdom
//
// First component test in the repo. The database URL copy interaction in the
// Details tab is a postgres-only menu (DatabaseCopyMenu) that renders a plain
// CopyButton for every other engine. These specs exercise the gating and the
// menu behaviour by rendering the real ResourceDrawer (DatabaseCopyMenu is not
// exported). jsdom has no navigator.clipboard, so it is mocked per test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ResourceDrawer } from "./resource-drawer"
import type { Database, ResourceType } from "@/lib/types"

const POSTGRES_URL = "postgres://user:pass@abc123:5432/postgres"

function database(overrides: Partial<Database>): Database {
  return {
    id: 1,
    uuid: "db-1",
    name: "my-db",
    status: "running",
    image: "postgres:16-alpine",
    internal_db_url: POSTGRES_URL,
    external_db_url: null,
    tags: [],
    ...overrides,
  }
}

function renderDrawer(resource: Database, type: ResourceType = "database") {
  return render(
    <ResourceDrawer
      resource={resource}
      type={type}
      projectName="proj"
      environmentName="env"
      tab="details"
      onTabChange={() => {}}
      onClose={() => {}}
    />
  )
}

/** The DatabaseCopyMenu trigger is the only button in the row with a menu. */
function menuTrigger() {
  return screen.getByRole("button", { name: /copy connection url/i })
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("DatabaseCopyMenu gating in the resource drawer", () => {
  it("renders the menu trigger for postgres rows and a plain CopyButton otherwise", () => {
    // Postgres row -> menu trigger (has aria-haspopup="menu").
    renderDrawer(database({ image: "postgres:16-alpine" }))
    expect(
      screen
        .getByRole("button", { name: /copy connection url/i })
        .getAttribute("aria-haspopup")
    ).toBe("menu")
    cleanup()

    // Non-postgres row -> plain CopyButton, no menu semantics.
    renderDrawer(
      database({
        image: "redis:7",
        internal_db_url: "redis://srv:6379/0",
      })
    )
    const copy = screen.getByRole("button", { name: /copy connection url/i })
    expect(copy.getAttribute("aria-haspopup")).toBeNull()
  })

  it("opens the menu with Original/JDBC/URI/URI corta in that order", () => {
    renderDrawer(database({}))
    fireEvent.click(menuTrigger())

    const labels = ["Original", "JDBC", "URI", "URI corta"]
    const buttons = labels.map((label) =>
      screen.getByRole("button", { name: label })
    )
    expect(buttons.map((b) => b.textContent)).toEqual(labels)
  })

  it("copies the selected format, closes the menu, and shows the Copied check for 1500ms", async () => {
    renderDrawer(database({}))
    fireEvent.click(menuTrigger())

    const trigger = menuTrigger()
    const jdbc = screen.getByRole("button", { name: "JDBC" })
    await act(async () => {
      fireEvent.click(jdbc)
      await Promise.resolve()
    })

    // Menu closed and the JDBC rendering was written to the clipboard.
    expect(screen.queryByRole("button", { name: "JDBC" })).toBeNull()
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "jdbc:postgresql://abc123:5432/postgres?user=user&password=pass"
    )

    // Trigger swaps to a brief Copied check.
    expect(trigger.getAttribute("aria-label")).toBe("Copied")

    // After 1500ms it returns to the idle copy trigger.
    await act(async () => {
      vi.advanceTimersByTime(1500)
    })
    expect(trigger.getAttribute("aria-label")).toBe("Copy connection URL")
  })

  it("copies the expected string for each offered format", async () => {
    renderDrawer(database({}))
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>

    const expectations: Array<[string, string]> = [
      ["Original", POSTGRES_URL],
      ["URI", "postgresql://user:pass@abc123:5432/postgres"],
      ["URI corta", POSTGRES_URL],
      [
        "JDBC",
        "jdbc:postgresql://abc123:5432/postgres?user=user&password=pass",
      ],
    ]
    for (const [label, expected] of expectations) {
      fireEvent.click(menuTrigger())
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: label }))
        await Promise.resolve()
      })
      expect(writeText).toHaveBeenLastCalledWith(expected)
      // Menu closes after every selection.
      expect(screen.queryByRole("button", { name: label })).toBeNull()
      // Reset the Copied check so the next loop sees an idle trigger.
      await act(async () => {
        vi.advanceTimersByTime(1500)
      })
    }
  })

  it("renders derived formats disabled when they could not be computed", () => {
    // A postgres image gates the menu on, but an unparseable URL leaves every
    // derived format null: only Original (the raw input) is enabled.
    renderDrawer(database({ internal_db_url: "not a url : : //" }))
    fireEvent.click(menuTrigger())

    for (const label of ["JDBC", "URI", "URI corta"]) {
      const button = screen.getByRole<HTMLButtonElement>("button", {
        name: label,
      })
      expect(button.disabled).toBe(true)
      expect(button.className).toContain("opacity-40")
    }
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Original" })
        .disabled
    ).toBe(false)
  })
})
