// @vitest-environment jsdom
//
// The row-action ContextMenu is a real ARIA menu widget: the trigger advertises
// aria-haspopup="menu", the panel is role="menu" and focused on open, items are
// role="menuitem" with aria-disabled, and ArrowUp/Down/Home/End move a roving
// tab stop that skips disabled items. Escape closes the menu first, shielded
// from the enclosing resource drawer's window-level Escape listener via
// stopPropagation, and only falls through to the drawer once the menu is
// closed. The harness wraps ContextMenu in a drawer-like complementary region
// that installs that same window-level listener so the interplay is observable.
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ContextMenu } from './context-menu'
import type { RowAction } from '@/hooks/use-coolify'

type MenuItem = {
  label: string
  action: RowAction
  disabled?: boolean
  dangerous?: boolean
}

const DEFAULT_ITEMS: MenuItem[] = [
  { label: 'Start', action: 'start' },
  { label: 'Stop', action: 'stop', disabled: true },
  { label: 'Delete', action: 'delete', dangerous: true },
]

function renderMenu({
  items = DEFAULT_ITEMS,
  onSelect = () => {},
  onDrawerClose = vi.fn(),
  triggerLabel,
}: {
  items?: MenuItem[]
  onSelect?: (action: RowAction) => void
  onDrawerClose?: () => void
  triggerLabel?: string
} = {}) {
  // Mirrors the resource drawer: a window-level Escape listener that closes the
  // whole drawer, which an open menu must shield via stopPropagation. It lives
  // in its own component so the callback is a legitimate effect dependency.
  function Harness({ onDrawerClose }: { onDrawerClose: () => void }) {
    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onDrawerClose()
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }, [onDrawerClose])
    return (
      <div role="complementary" aria-label="Resource drawer">
        <ContextMenu
          items={items}
          onSelect={onSelect}
          aria-label={triggerLabel}
        >
          <span>Open actions</span>
        </ContextMenu>
      </div>
    )
  }
  render(<Harness onDrawerClose={onDrawerClose} />)
  return { onDrawerClose }
}

/** The ContextMenu trigger is the only button rendered. */
function trigger() {
  return screen.getByRole('button', { name: /open actions/i })
}

afterEach(() => {
  cleanup()
})

describe('ContextMenu ARIA menu widget', () => {
  it('exposes the panel as role=menu and each item as role=menuitem when open', () => {
    renderMenu()
    fireEvent.click(trigger())

    const panel = screen.getByRole('menu')
    expect(panel.getAttribute('aria-label')).toBe('Resource actions')

    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['Start', 'Stop', 'Delete'])

    // The trigger points aria-controls at the panel it actually opens, so the
    // advertised menu is the widget that is rendered.
    expect(trigger().getAttribute('aria-controls')).toBe(panel.getAttribute('id'))
  })

  it('gives the trigger an accessible name from aria-label when supplied', () => {
    renderMenu({ triggerLabel: 'Resource actions' })
    expect(
      screen.getByRole('button', { name: /resource actions/i }),
    ).toBeTruthy()
  })

  it('renders disabled items with aria-disabled, never the disabled attribute', () => {
    renderMenu()
    fireEvent.click(trigger())

    const stop = screen.getByRole('menuitem', { name: 'Stop' })
    expect(stop.getAttribute('aria-disabled')).toBe('true')
    expect(stop.hasAttribute('disabled')).toBe(false)

    // Enabled items carry no aria-disabled.
    expect(
      screen.getByRole('menuitem', { name: 'Start' }).getAttribute('aria-disabled'),
    ).toBeNull()
  })

  it('focuses the panel on open', () => {
    renderMenu()
    fireEvent.click(trigger())
    expect(screen.getByRole('menu')).toBe(document.activeElement)
  })

  it('moves focus with ArrowDown/ArrowUp/Home/End using a roving tabindex that skips disabled', () => {
    renderMenu()
    fireEvent.click(trigger())
    const panel = screen.getByRole('menu')

    // The menu just opened, so it sits "before" the first choice: the first
    // ArrowDown lands on the first enabled item (Start), not skipping to the
    // second.
    fireEvent.keyDown(panel, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Start' })).toBe(
      document.activeElement,
    )

    // ArrowDown again advances one enabled item, skipping the disabled Stop to
    // land on Delete.
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Start' }), {
      key: 'ArrowDown',
    })
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBe(
      document.activeElement,
    )

    // ArrowUp wraps back to the first enabled item, again skipping the disabled
    // Stop.
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Delete' }), {
      key: 'ArrowUp',
    })
    expect(screen.getByRole('menuitem', { name: 'Start' })).toBe(
      document.activeElement,
    )

    // End jumps to the last enabled item (Delete).
    fireEvent.keyDown(panel, { key: 'End' })
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBe(
      document.activeElement,
    )

    // Home jumps back to the first enabled item (Start).
    fireEvent.keyDown(panel, { key: 'Home' })
    expect(screen.getByRole('menuitem', { name: 'Start' })).toBe(
      document.activeElement,
    )

    // Only the current item is in the tab order (roving tabindex).
    expect(screen.getByRole('menuitem', { name: 'Start' }).tabIndex).toBe(0)
    for (const name of ['Stop', 'Delete']) {
      expect(screen.getByRole('menuitem', { name }).tabIndex).toBe(-1)
    }
  })

  it('invokes onSelect and closes the menu when an enabled item is chosen, focusing the trigger', () => {
    const onSelect = vi.fn()
    renderMenu({ onSelect })
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start' }))

    expect(onSelect).toHaveBeenCalledWith('start')
    expect(screen.queryByRole('menuitem', { name: 'Start' })).toBeNull()
    expect(trigger()).toBe(document.activeElement)
  })

  it('does not select a disabled item on click', () => {
    const onSelect = vi.fn()
    renderMenu({ onSelect })
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop' }))

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('preserves dangerous item styling', () => {
    renderMenu()
    fireEvent.click(trigger())
    const del = screen.getByRole('menuitem', { name: 'Delete' })
    expect(del.className).toContain('text-destructive')
  })

  it('returns focus to the trigger when Escape closes the menu', () => {
    renderMenu()
    fireEvent.click(trigger())
    expect(screen.getByRole('menu')).toBe(document.activeElement)

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menuitem', { name: 'Start' })).toBeNull()
    expect(trigger()).toBe(document.activeElement)
  })

  it('closes on a mousedown outside and returns focus to the trigger', () => {
    renderMenu()
    fireEvent.click(trigger())
    expect(screen.getByRole('menu')).toBe(document.activeElement)

    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Start' })).toBeNull()
    expect(trigger()).toBe(document.activeElement)
  })
})

describe('ContextMenu Escape handling', () => {
  it('Escape closes the menu but keeps the drawer open', () => {
    const { onDrawerClose } = renderMenu()
    fireEvent.click(trigger())
    expect(screen.getByRole('menu')).toBe(document.activeElement)

    // Escape while the menu is open dismisses only the menu, not the drawer.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menuitem', { name: 'Start' })).toBeNull()
    expect(onDrawerClose).not.toHaveBeenCalled()
  })

  it('Escape closes the drawer when the menu is closed', () => {
    const { onDrawerClose } = renderMenu()

    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' })
    expect(onDrawerClose).toHaveBeenCalledTimes(1)
  })
})
