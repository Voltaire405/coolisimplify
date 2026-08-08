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
import type { Application, Database, ResourceType } from "@/lib/types"

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

function application(overrides: Partial<Application>): Application {
  return {
    id: 1,
    uuid: "app-1",
    name: "my-app",
    status: "running",
    build_pack: "nixpacks",
    git_repository: "org/repo",
    git_branch: "main",
    custom_network_aliases: "web.alias",
    tags: [],
    ...overrides,
  }
}

function renderDrawer(
  resource: Database | Application,
  type: ResourceType = "database",
  onClose: () => void = () => {},
  onConfigEdit?: (
    uuid: string,
    payload: Record<string, unknown>,
    markRedeployNeeded?: boolean
  ) => Promise<boolean>
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
      onConfigEdit={onConfigEdit}
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

  it("opens the menu with Original/JDBC/URI/Short URI in that order", () => {
    renderDrawer(database({}))
    fireEvent.click(menuTrigger())

    const labels = ["Original", "JDBC", "URI", "Short URI"]
    const buttons = labels.map((label) =>
      screen.getByRole("menuitem", { name: label })
    )
    expect(buttons.map((b) => b.textContent)).toEqual(labels)
  })

  it("copies the selected format, closes the menu, and shows the Copied check for 1500ms", async () => {
    renderDrawer(database({}))
    fireEvent.click(menuTrigger())

    const trigger = menuTrigger()
    const jdbc = screen.getByRole("menuitem", { name: "JDBC" })
    await act(async () => {
      fireEvent.click(jdbc)
      await Promise.resolve()
    })

    // Menu closed and the JDBC rendering was written to the clipboard.
    expect(screen.queryByRole("menuitem", { name: "JDBC" })).toBeNull()
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
      ["Short URI", POSTGRES_URL],
      [
        "JDBC",
        "jdbc:postgresql://abc123:5432/postgres?user=user&password=pass",
      ],
    ]
    for (const [label, expected] of expectations) {
      fireEvent.click(menuTrigger())
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: label }))
        await Promise.resolve()
      })
      expect(writeText).toHaveBeenLastCalledWith(expected)
      // Menu closes after every selection.
      expect(screen.queryByRole("menuitem", { name: label })).toBeNull()
      // Reset the Copied check so the next loop sees an idle trigger.
      await act(async () => {
        vi.advanceTimersByTime(1500)
      })
    }
  })

  it("keeps the menu open and surfaces the failure when the clipboard write rejects", async () => {
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>
    writeText.mockRejectedValueOnce(new Error("denied"))

    renderDrawer(database({}))
    fireEvent.click(menuTrigger())
    const jdbc = screen.getByRole("menuitem", { name: "JDBC" })

    await act(async () => {
      fireEvent.click(jdbc)
      await Promise.resolve()
    })

    // The write was attempted but failed.
    expect(writeText).toHaveBeenCalledTimes(1)

    // The menu stays open so the user can retry (no Copied flash, no close).
    expect(screen.queryByRole("menuitem", { name: "JDBC" })).not.toBeNull()
    expect(menuTrigger().getAttribute("aria-label")).toBe("Copy connection URL")

    // The failure is surfaced inside the panel.
    expect(screen.getByText(/copy failed/i)).toBeTruthy()

    // A retry from the same open menu succeeds and closes it.
    writeText.mockResolvedValueOnce(undefined)
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "JDBC" }))
      await Promise.resolve()
    })
    expect(screen.queryByRole("menuitem", { name: "JDBC" })).toBeNull()
    expect(screen.queryByText(/copy failed/i)).toBeNull()
  })

  it("renders derived formats disabled when they could not be computed", () => {
    // A postgres image gates the menu on, but an unparseable URL leaves every
    // derived format null: only Original (the raw input) is enabled.
    renderDrawer(database({ internal_db_url: "not a url : : //" }))
    fireEvent.click(menuTrigger())

    for (const label of ["JDBC", "URI", "Short URI"]) {
      const item = screen.getByRole<HTMLButtonElement>("menuitem", {
        name: label,
      })
      expect(item.getAttribute("aria-disabled")).toBe("true")
      expect(item.className).toContain("opacity-40")
    }
    expect(
      screen
        .getByRole<HTMLButtonElement>("menuitem", { name: "Original" })
        .getAttribute("aria-disabled")
    ).toBe("false")
  })

  it("closes the menu when a mousedown lands outside the menu wrapper", () => {
    renderDrawer(database({}))
    fireEvent.click(menuTrigger())
    expect(screen.getByRole("menuitem", { name: "JDBC" })).toBeTruthy()

    // The click-outside handler listens for mousedown on document (the panel is
    // only rendered while open), so a mousedown on document.body must close it.
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole("menuitem", { name: "JDBC" })).toBeNull()
  })

  it("toggling the trigger while open closes the menu without copying", () => {
    renderDrawer(database({}))
    fireEvent.click(menuTrigger())
    expect(screen.getByRole("menuitem", { name: "JDBC" })).toBeTruthy()

    // The trigger lives inside the menu's ref, so its mousedown does not hit the
    // click-outside handler; the click toggles the menu closed instead.
    fireEvent.click(menuTrigger())
    expect(screen.queryByRole("menuitem", { name: "JDBC" })).toBeNull()
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
    const triggers = screen.getAllByRole("button", {
      name: /copy connection url/i,
    })
    expect(triggers).toHaveLength(2)
    for (const trigger of triggers) {
      expect(trigger.getAttribute("aria-haspopup")).toBe("menu")
    }

    for (const trigger of triggers) {
      fireEvent.click(trigger)
      for (const label of ["Original", "JDBC", "URI", "Short URI"]) {
        expect(screen.getByRole("menuitem", { name: label })).toBeTruthy()
      }
      // Collapse the menu again so the next trigger starts from a closed state.
      fireEvent.click(trigger)
      expect(screen.queryByRole("menuitem", { name: "JDBC" })).toBeNull()
    }
  })

  it("revealing the value with the eye toggles the mask and closes the open menu", () => {
    renderDrawer(database({}))
    fireEvent.click(menuTrigger())
    expect(screen.getByRole("menuitem", { name: "JDBC" })).toBeTruthy()

    // The eye button is outside the menu's ref, so a mousedown on it triggers
    // click-outside-to-close; its own click then toggles the reveal. fireEvent
    // fires these as separate events, mirroring a real user gesture.
    const eye = screen.getByRole("button", { name: "Reveal value" })
    fireEvent.mouseDown(eye)
    fireEvent.click(eye)

    // Menu closed and the masked value was replaced by the real URL.
    expect(screen.queryByRole("menuitem", { name: "JDBC" })).toBeNull()
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
    expect(screen.getByRole("menuitem", { name: "JDBC" })).toBeTruthy()

    // Escape while the menu is open dismisses only the menu, not the drawer.
    fireEvent.keyDown(menuTrigger(), { key: "Escape" })
    expect(screen.queryByRole("menuitem", { name: "JDBC" })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("Escape closes the drawer when the copy menu is closed", () => {
    const onClose = vi.fn()
    renderDrawer(database({}), "database", onClose)

    fireEvent.keyDown(screen.getByRole("complementary"), { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe("DatabaseCopyMenu ARIA menu widget", () => {
  it("exposes the panel as role=menu and each choice as role=menuitem when open", () => {
    renderDrawer(database({}))
    fireEvent.click(menuTrigger())

    const panel = screen.getByRole("menu")
    expect(panel).toBeTruthy()
    expect(panel.getAttribute("aria-label")).toBe("Copy connection URL formats")

    const items = screen.getAllByRole("menuitem")
    expect(items.map((i) => i.textContent)).toEqual([
      "Original",
      "JDBC",
      "URI",
      "Short URI",
    ])

    // The trigger points aria-controls at the panel it actually opens, so the
    // advertised menu is the widget that is rendered.
    expect(menuTrigger().getAttribute("aria-controls")).toBe(
      panel.getAttribute("id")
    )
  })

  it("focuses the panel on open", () => {
    renderDrawer(database({}))
    fireEvent.click(menuTrigger())
    expect(screen.getByRole("menu")).toBe(document.activeElement)
  })

  it("moves focus with ArrowDown/ArrowUp/Home/End using a roving tabindex", () => {
    renderDrawer(database({}))
    fireEvent.click(menuTrigger())
    const panel = screen.getByRole("menu")

    // The first ArrowDown from the focused panel lands on the first choice
    // (it must not skip "Original").
    fireEvent.keyDown(panel, { key: "ArrowDown" })
    expect(screen.getByRole("menuitem", { name: "Original" })).toBe(
      document.activeElement
    )

    // ArrowDown moves to the next.
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Original" }), {
      key: "ArrowDown",
    })
    expect(screen.getByRole("menuitem", { name: "JDBC" })).toBe(
      document.activeElement
    )

    // ArrowUp wraps back to the first choice.
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "JDBC" }), {
      key: "ArrowUp",
    })
    expect(screen.getByRole("menuitem", { name: "Original" })).toBe(
      document.activeElement
    )

    // End jumps to the last choice.
    fireEvent.keyDown(panel, { key: "End" })
    expect(screen.getByRole("menuitem", { name: "Short URI" })).toBe(
      document.activeElement
    )

    // Home jumps back to the first choice.
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Short URI" }), {
      key: "Home",
    })
    expect(screen.getByRole("menuitem", { name: "Original" })).toBe(
      document.activeElement
    )

    // Only the current choice is in the tab order (roving tabindex).
    expect(screen.getByRole("menuitem", { name: "Original" }).tabIndex).toBe(0)
    for (const name of ["JDBC", "URI", "Short URI"]) {
      expect(screen.getByRole("menuitem", { name }).tabIndex).toBe(-1)
    }
  })

  it("skips disabled choices during arrow navigation", () => {
    // Only Original is enabled (the derived formats are null); arrows stay put.
    renderDrawer(database({ internal_db_url: "not a url : //" }))
    fireEvent.click(menuTrigger())
    const panel = screen.getByRole("menu")

    fireEvent.keyDown(panel, { key: "ArrowDown" })
    expect(screen.getByRole("menuitem", { name: "Original" })).toBe(
      document.activeElement
    )
  })

  it("returns focus to the trigger when Escape closes the menu", () => {
    renderDrawer(database({}))
    fireEvent.click(menuTrigger())
    expect(screen.getByRole("menu")).toBe(document.activeElement)

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    expect(screen.queryByRole("menuitem", { name: "JDBC" })).toBeNull()
    expect(menuTrigger()).toBe(document.activeElement)
  })

  it("returns focus to the trigger when a format is selected", async () => {
    renderDrawer(database({}))
    const trigger = menuTrigger()
    fireEvent.click(trigger)

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "JDBC" }))
      await Promise.resolve()
    })
    expect(screen.queryByRole("menuitem", { name: "JDBC" })).toBeNull()
    // The trigger swaps to a "Copied" label but stays the same DOM node.
    expect(trigger).toBe(document.activeElement)
  })

  it("returns focus to the trigger when a click outside closes the menu", () => {
    renderDrawer(database({}))
    fireEvent.click(menuTrigger())
    expect(screen.getByRole("menu")).toBe(document.activeElement)

    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole("menuitem", { name: "JDBC" })).toBeNull()
    expect(menuTrigger()).toBe(document.activeElement)
  })
})

describe("network alias editing in the resource drawer", () => {
  it("lets an application's network alias be edited in place", async () => {
    const onConfigEdit = vi.fn().mockResolvedValue(true)
    renderDrawer(application({}), "application", () => {}, onConfigEdit)

    // The current value renders as a click-to-edit button.
    fireEvent.click(screen.getByText("web.alias"))
    const input = screen.getByRole("textbox", { name: "Network aliases" })
    await act(async () => {
      fireEvent.change(input, { target: { value: "api.alias" } })
      fireEvent.keyDown(input, { key: "Enter" })
      await Promise.resolve()
    })

    expect(onConfigEdit).toHaveBeenCalledWith(
      "app-1",
      { custom_network_aliases: "api.alias" },
      // Network-alias edits must not raise the Redeploy-needed marker.
      false
    )
  })

  it("shows the network alias row even when the application has none yet", () => {
    renderDrawer(application({ custom_network_aliases: null }), "application")
    // The "—" placeholder is a button that starts editing, so aliases can be
    // added from scratch.
    expect(screen.getByTitle("Click to edit Network aliases")).toBeTruthy()
  })

  it("offers no network alias editing for non-applications", () => {
    renderDrawer(database({}))
    expect(screen.queryByText("Network aliases")).toBeNull()
  })
})
