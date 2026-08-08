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

function renderDrawer(
  resource: Database,
  type: ResourceType = "database",
  onClose: () => void = () => {}
) {
  return render(
    <ResourceDrawer
      resource={resource}
      type={type}
      projectName="proj"
      environmentName="env"
      tab="details"
      onTabChange={() => {}}
      onClose={onClose}
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

  it("closes the menu when a mousedown lands outside the menu wrapper", () => {
    renderDrawer(database({}))
    fireEvent.click(menuTrigger())
    expect(screen.getByRole("button", { name: "JDBC" })).toBeTruthy()

    // The click-outside handler listens for mousedown on document (the panel is
    // only rendered while open), so a mousedown on document.body must close it.
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole("button", { name: "JDBC" })).toBeNull()
  })

  it("toggling the trigger while open closes the menu without copying", () => {
    renderDrawer(database({}))
    fireEvent.click(menuTrigger())
    expect(screen.getByRole("button", { name: "JDBC" })).toBeTruthy()

    // The trigger lives inside the menu's ref, so its mousedown does not hit the
    // click-outside handler; the click toggles the menu closed instead.
    fireEvent.click(menuTrigger())
    expect(screen.queryByRole("button", { name: "JDBC" })).toBeNull()
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it("renders a menu trigger for both internal and public URLs and opens each", () => {
    renderDrawer(
      database({
        external_db_url: "postgres://pub:secret@example.com:5432/postgres",
      })
    )

    // Two rows (internal + public) share the postgres SecretValue/menu path, so
    // there are two menu triggers and each offers the four formats.
    const triggers = screen.getAllByRole("button", { name: /copy connection url/i })
    expect(triggers).toHaveLength(2)
    for (const trigger of triggers) {
      expect(trigger.getAttribute("aria-haspopup")).toBe("menu")
    }

    for (const trigger of triggers) {
      fireEvent.click(trigger)
      for (const label of ["Original", "JDBC", "URI", "URI corta"]) {
        expect(screen.getByRole("button", { name: label })).toBeTruthy()
      }
      // Collapse the menu again so the next trigger starts from a closed state.
      fireEvent.click(trigger)
      expect(screen.queryByRole("button", { name: "JDBC" })).toBeNull()
    }
  })

  it("revealing the value with the eye toggles the mask and closes the open menu", () => {
    renderDrawer(database({}))
    fireEvent.click(menuTrigger())
    expect(screen.getByRole("button", { name: "JDBC" })).toBeTruthy()

    // The eye button is outside the menu's ref, so a mousedown on it triggers
    // click-outside-to-close; its own click then toggles the reveal. fireEvent
    // fires these as separate events, mirroring a real user gesture.
    const eye = screen.getByRole("button", { name: "Reveal value" })
    fireEvent.mouseDown(eye)
    fireEvent.click(eye)

    // Menu closed and the masked value was replaced by the real URL.
    expect(screen.queryByRole("button", { name: "JDBC" })).toBeNull()
    expect(screen.queryByText("••••••••")).toBeNull()
    expect(screen.getByText(POSTGRES_URL)).toBeTruthy()
    // The button now offers to hide the revealed value.
    expect(screen.getByRole("button", { name: "Hide value" })).toBeTruthy()
  })
})

describe("DatabaseCopyMenu Escape handling", () => {
  it("Escape closes the copy menu but keeps the drawer open", () => {
    const onClose = vi.fn()
    renderDrawer(database({}), "database", onClose)

    fireEvent.click(menuTrigger())
    expect(screen.getByRole("button", { name: "JDBC" })).toBeTruthy()

    // Escape while the menu is open dismisses only the menu, not the drawer.
    fireEvent.keyDown(menuTrigger(), { key: "Escape" })
    expect(screen.queryByRole("button", { name: "JDBC" })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("Escape closes the drawer when the copy menu is closed", () => {
    const onClose = vi.fn()
    renderDrawer(database({}), "database", onClose)

    fireEvent.keyDown(screen.getByRole("complementary"), { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
