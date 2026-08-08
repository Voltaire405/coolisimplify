'use client'

import { useState, useRef, useEffect, useId, useMemo } from 'react'
import { cn } from '@workspace/ui/lib/utils'
import type { RowAction } from '@/hooks/use-coolify'

interface ContextMenuProps {
  children: React.ReactNode
  items: Array<{
    label: string
    action: RowAction
    disabled?: boolean
    dangerous?: boolean
  }>
  onSelect: (action: RowAction) => void
}

/**
 * Row-action menu: a trigger that opens a small menu of actions for a resource
 * row. Selecting one invokes `onSelect` with its action and closes the menu.
 * Follows the repo's canonical menu pattern (see DatabaseCopyMenu) and the
 * ARIA APG menu button pattern: a `relative` wrapper, an absolutely positioned
 * `right-0 top-full` panel, and click-outside-to-close.
 *
 * Accessibility contract: the trigger advertises `aria-haspopup="menu"`, so
 * this is a real ARIA menu widget. The panel is `role="menu"` with an
 * accessible name, it is focused on open, each item is `role="menuitem"` with
 * `aria-disabled` (never the native `disabled` attribute) when unavailable,
 * and ArrowUp/ArrowDown/Home/End move focus with a roving tabindex that skips
 * disabled items. Escape closes the menu first (stopping propagation so the
 * enclosing resource drawer's window-level Escape listener does not also fire)
 * and only falls through to close the drawer once the menu is closed.
 */
export function ContextMenu({ children, items, onSelect }: ContextMenuProps) {
  const [open, setOpen] = useState(false)
  // The item currently holding the roving tab stop. Reset to null when the menu
  // opens so the cursor lands on the first enabled item.
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  // Roving focus only lands on items that can actually be acted on.
  const enabledIndices = useMemo<number[]>(
    () =>
      items
        .map((item, index) => (item.disabled ? -1 : index))
        .filter((index) => index >= 0),
    [items],
  )

  // The item that is currently the roving tab stop: the last one focused, or
  // the first enabled item when the menu just opened.
  const activeIndexValue = activeIndex ?? enabledIndices[0] ?? null

  // Focus the panel (not the trigger) when the menu opens so keyboard users
  // land inside the widget and can arrow through it. The focus cursor is reset
  // in the trigger's onClick (an event handler) rather than here, so this effect
  // only touches the DOM.
  useEffect(() => {
    if (open) {
      panelRef.current?.focus()
    }
  }, [open])

  // Focus returns to the trigger whenever the menu closes, per the ARIA APG
  // menu button pattern. Track the previous open state so the initial mount
  // (open === false) does not steal focus into the trigger.
  const wasOpenRef = useRef(open)
  useEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = open
    if (wasOpen && !open) {
      triggerRef.current?.focus()
    }
  }, [open])

  // Escape closes just the menu. The menu is nested inside the resource drawer,
  // which installs a window-level Escape listener that closes the whole drawer;
  // stopping propagation here keeps that from firing while the menu is open.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      setOpen(false)
      e.stopPropagation()
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  function focusItem(index: number) {
    setActiveIndex(index)
    const item = panelRef.current?.querySelector(
      `[data-index="${index}"]`,
    ) as HTMLElement | null
    item?.focus()
  }

  // Roving focus for the menu: ArrowUp/ArrowDown move by one enabled item
  // (wrapping), Home/End jump to the first/last. Handled on the panel, which
  // holds focus when the menu opens.
  function handleMenuKeyDown(e: React.KeyboardEvent) {
    if (enabledIndices.length === 0) return
    // The panel (role="menu") holds focus until the first arrow lands on an
    // item. At that point activeIndex is null, but activeIndexValue already
    // defaults to the first enabled item, so a naive cursor would make the
    // first ArrowDown skip it (and the first ArrowUp skip the last). Treat the
    // just-opened state as sitting "before" the first choice: ArrowDown/Home
    // reach the first enabled item and ArrowUp/End reach the last one.
    if (activeIndex == null) {
      if (e.key === 'ArrowDown' || e.key === 'Home') {
        e.preventDefault()
        focusItem(enabledIndices[0]!)
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'End') {
        e.preventDefault()
        focusItem(enabledIndices[enabledIndices.length - 1]!)
        return
      }
    }
    const cursor = Math.max(enabledIndices.indexOf(activeIndexValue ?? -1), 0)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusItem(enabledIndices[(cursor + 1) % enabledIndices.length]!)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusItem(
          enabledIndices[
            (cursor - 1 + enabledIndices.length) % enabledIndices.length
          ]!,
        )
        break
      case 'Home':
        e.preventDefault()
        focusItem(enabledIndices[0]!)
        break
      case 'End':
        e.preventDefault()
        focusItem(enabledIndices[enabledIndices.length - 1]!)
        break
    }
  }

  return (
    <div ref={ref} className="relative" onKeyDown={handleKeyDown}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => {
          if (!open) setActiveIndex(null)
          setOpen((o) => !o)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted sm:h-auto sm:w-auto sm:p-1"
      >
        {children}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="menu"
          aria-label="Resource actions"
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full z-30 mt-1 w-44 rounded-md border border-border bg-popover shadow-sm"
        >
          <div className="py-1">
            {items.map((item, index) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                data-index={index}
                tabIndex={activeIndexValue === index ? 0 : -1}
                aria-disabled={item.disabled}
                onFocus={() => setActiveIndex(index)}
                onClick={() => {
                  if (!item.disabled) onSelect(item.action)
                  setOpen(false)
                }}
                className={cn(
                  'block w-full px-3 py-2 text-left text-sm transition-colors sm:py-1.5',
                  item.dangerous
                    ? 'text-destructive hover:bg-destructive/5'
                    : 'text-popover-foreground hover:bg-muted',
                  item.disabled && 'pointer-events-none opacity-40',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
