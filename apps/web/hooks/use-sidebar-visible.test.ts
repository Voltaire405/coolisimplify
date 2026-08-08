// @vitest-environment jsdom
//
// The projects panel starts visible and stays that way unless the user hides
// it; the preference survives reloads, and a corrupt value must not change the
// default.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useSidebarVisible } from './use-sidebar-visible'

const STORAGE_KEY = 'coolisimplify:sidebar-visible'

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  window.localStorage.clear()
})

describe('reading', () => {
  it('defaults to visible when nothing is stored', () => {
    const { result } = renderHook(() => useSidebarVisible())
    expect(result.current.sidebarVisible).toBe(true)
  })

  it('restores a stored hidden state', () => {
    window.localStorage.setItem(STORAGE_KEY, 'false')
    const { result } = renderHook(() => useSidebarVisible())
    expect(result.current.sidebarVisible).toBe(false)
  })

  it('treats any value other than "false" as visible', () => {
    window.localStorage.setItem(STORAGE_KEY, 'garbage')
    const { result } = renderHook(() => useSidebarVisible())
    expect(result.current.sidebarVisible).toBe(true)
  })
})

describe('keyboard shortcut', () => {
  it('toggles with Cmd+B', () => {
    const { result } = renderHook(() => useSidebarVisible())

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true }),
      )
    })
    expect(result.current.sidebarVisible).toBe(false)
  })

  it('toggles with Ctrl+B', () => {
    const { result } = renderHook(() => useSidebarVisible())

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'B', ctrlKey: true, bubbles: true }),
      )
    })
    expect(result.current.sidebarVisible).toBe(false)
  })

  it('ignores the shortcut while typing in an input', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const { result } = renderHook(() => useSidebarVisible())

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true }),
      )
    })
    expect(result.current.sidebarVisible).toBe(true)
    input.remove()
  })

  it('ignores the shortcut without Cmd or Ctrl', () => {
    const { result } = renderHook(() => useSidebarVisible())

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }))
    })
    expect(result.current.sidebarVisible).toBe(true)
  })

  it('stops listening after unmount', () => {
    const { result, unmount } = renderHook(() => useSidebarVisible())
    unmount()

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true }),
      )
    })
    expect(result.current.sidebarVisible).toBe(true)
  })
})

describe('writing', () => {
  it('toggles and persists so the choice survives a reload', () => {
    const { result } = renderHook(() => useSidebarVisible())

    act(() => result.current.toggleSidebar())
    expect(result.current.sidebarVisible).toBe(false)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false')

    act(() => result.current.toggleSidebar())
    expect(result.current.sidebarVisible).toBe(true)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true')
  })
})
