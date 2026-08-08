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
