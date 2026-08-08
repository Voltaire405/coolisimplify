// @vitest-environment jsdom
//
// CopyButton is the plain single-format copy affordance used for every
// non-postgres database URL row and for the FQDN/domain row. It must write via
// navigator.clipboard.writeText, flash a transient "Copied" check for
// COPY_FEEDBACK_MS then revert, and surface a clipboard write failure with a
// live-region announcement (role=status) instead of a false "Copied" flash.
// jsdom has no navigator.clipboard, so it is stubbed per test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { CopyButton, COPY_FAILURE_MS, COPY_FEEDBACK_MS } from "./copy-button"

const VALUE = "postgres://user:pass@example.com:5432/db"
const LABEL = "Copy connection URL"

/** Stub navigator.clipboard.writeText and return the stub for assertions. */
function stubClipboard({ reject = false }: { reject?: boolean } = {}) {
  const writeText = vi.fn(() =>
    reject ? Promise.reject(new Error("denied")) : Promise.resolve()
  )
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  })
  return writeText
}

/** Click the copy button and flush the pending clipboard promise. */
async function clickCopy() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: LABEL }))
    await Promise.resolve()
  })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.useFakeTimers()
})

describe("CopyButton", () => {
  it("writes the value and shows the Copied check for ~1500ms then reverts", async () => {
    const writeText = stubClipboard()
    render(<CopyButton value={VALUE} label={LABEL} />)
    const button = screen.getByRole("button", { name: LABEL })

    await clickCopy()

    // The value was written to the clipboard.
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(VALUE)

    // The trigger swaps to the brief Copied check (aria-label + title) and the
    // live-region failure affordance stays absent.
    expect(button.getAttribute("aria-label")).toBe("Copied")
    expect(button.getAttribute("title")).toBe("Copied")
    expect(screen.queryByRole("status")).toBeNull()

    // After ~1500ms it returns to the idle copy trigger.
    await act(async () => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS)
    })
    expect(button.getAttribute("aria-label")).toBe(LABEL)
    expect(button.getAttribute("title")).toBe(LABEL)
  })

  it("surfaces a write failure and does not flash 'Copied'", async () => {
    const writeText = stubClipboard({ reject: true })
    render(<CopyButton value={VALUE} label={LABEL} />)
    const button = screen.getByRole("button", { name: LABEL })

    await clickCopy()

    // The write was attempted but failed.
    expect(writeText).toHaveBeenCalledTimes(1)

    // No false "Copied" flash: the trigger never reports success.
    expect(button.getAttribute("aria-label")).toBe(
      "Copy failed. Please try again."
    )
    expect(button.getAttribute("title")).toBe("Copy failed. Please try again.")
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull()

    // The failure is surfaced through the live-region status affordance.
    const status = screen.getByRole("status")
    expect(status.textContent).toBe("Copy failed. Please try again.")

    // The failure state is transient: it resets after COPY_FAILURE_MS.
    await act(async () => {
      vi.advanceTimersByTime(COPY_FAILURE_MS)
    })
    expect(button.getAttribute("aria-label")).toBe(LABEL)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("reverts a previous failure when a later write succeeds", async () => {
    const writeText = stubClipboard({ reject: true })
    render(<CopyButton value={VALUE} label={LABEL} />)
    const button = screen.getByRole("button", { name: LABEL })

    await clickCopy()
    expect(screen.getByRole("status")).toBeTruthy()

    // A retry succeeds: the failure affordance clears and Copied appears.
    writeText.mockResolvedValueOnce(undefined)
    await act(async () => {
      fireEvent.click(button)
      await Promise.resolve()
    })
    expect(button.getAttribute("aria-label")).toBe("Copied")
    expect(screen.queryByRole("status")).toBeNull()
  })
})
