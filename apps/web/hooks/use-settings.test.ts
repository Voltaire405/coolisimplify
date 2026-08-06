// @vitest-environment jsdom
//
// Settings hold the Coolify instance URL and API token. Everything else in the
// app is gated on `isConfigured`, and the token is the credential the proxy
// forwards, so a bad read here either locks the user out of their own instance
// or sends requests with half a credential.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { useSettings as UseSettings } from './use-settings'

const STORAGE_KEY = 'coolisimplify:settings'

/** The module snapshots storage at import time, so each test loads it fresh. */
async function loadSettings(seed?: string) {
  window.localStorage.clear()
  if (seed !== undefined) window.localStorage.setItem(STORAGE_KEY, seed)
  vi.resetModules()
  const mod = (await import('./use-settings')) as { useSettings: typeof UseSettings }
  return renderHook(() => mod.useSettings())
}

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  window.localStorage.clear()
})

describe('reading', () => {
  it('starts empty and unconfigured when nothing was stored', async () => {
    const { result } = await loadSettings()
    expect(result.current.coolifyUrl).toBe('')
    expect(result.current.coolifyToken).toBe('')
    expect(result.current.isConfigured).toBe(false)
  })

  it('restores what was stored', async () => {
    const { result } = await loadSettings(
      JSON.stringify({ coolifyUrl: 'https://coolify.example', coolifyToken: 't' }),
    )
    expect(result.current.coolifyUrl).toBe('https://coolify.example')
    expect(result.current.coolifyToken).toBe('t')
    expect(result.current.isConfigured).toBe(true)
  })

  // A half-written blob must not become `undefined` flowing into a fetch header.
  it('fills a missing field with an empty string', async () => {
    const { result } = await loadSettings(
      JSON.stringify({ coolifyUrl: 'https://coolify.example' }),
    )
    expect(result.current.coolifyToken).toBe('')
    expect(result.current.isConfigured).toBe(false)
  })

  // Corrupt storage is recoverable by reconfiguring; a throw at module load is
  // not — it would take the whole app down on boot.
  it('degrades to empty on unparseable storage instead of throwing', async () => {
    const { result } = await loadSettings('not json at all')
    expect(result.current.coolifyUrl).toBe('')
    expect(result.current.isConfigured).toBe(false)
  })
})

describe('isConfigured', () => {
  it('requires both the URL and the token', async () => {
    const { result } = await loadSettings()

    act(() => result.current.setUrl('https://coolify.example'))
    expect(result.current.isConfigured).toBe(false)

    act(() => result.current.setToken('t'))
    expect(result.current.isConfigured).toBe(true)
  })

  it('goes back to unconfigured when either is cleared', async () => {
    const { result } = await loadSettings(
      JSON.stringify({ coolifyUrl: 'https://coolify.example', coolifyToken: 't' }),
    )
    act(() => result.current.setToken(''))
    expect(result.current.isConfigured).toBe(false)
  })
})

describe('writing', () => {
  it('persists a change so it survives a reload', async () => {
    const { result } = await loadSettings()
    act(() => result.current.setUrl('https://coolify.example'))
    act(() => result.current.setToken('t'))

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual({
      coolifyUrl: 'https://coolify.example',
      coolifyToken: 't',
    })
  })

  it('replaces both fields at once', async () => {
    const { result } = await loadSettings(
      JSON.stringify({ coolifyUrl: 'old', coolifyToken: 'old' }),
    )
    act(() =>
      result.current.setSettings({ coolifyUrl: 'new', coolifyToken: 'new-token' }),
    )
    expect(result.current.coolifyUrl).toBe('new')
    expect(result.current.coolifyToken).toBe('new-token')
  })

  // Re-rendering every consumer on a no-op write would restart the polling
  // clients for nothing.
  it('does not write when the value is unchanged', async () => {
    const { result } = await loadSettings(
      JSON.stringify({ coolifyUrl: 'https://coolify.example', coolifyToken: 't' }),
    )
    window.localStorage.removeItem(STORAGE_KEY)
    act(() => result.current.setUrl('https://coolify.example'))
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('other tabs', () => {
  // Two windows on the same instance: reconfiguring in one must not leave the
  // other issuing requests with the old token.
  it('picks up a change made in another tab', async () => {
    const { result } = await loadSettings(
      JSON.stringify({ coolifyUrl: 'https://old.example', coolifyToken: 'old' }),
    )

    act(() => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ coolifyUrl: 'https://new.example', coolifyToken: 'new' }),
      )
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    })

    expect(result.current.coolifyUrl).toBe('https://new.example')
    expect(result.current.coolifyToken).toBe('new')
  })

  it('ignores a storage event for an unrelated key', async () => {
    const { result } = await loadSettings(
      JSON.stringify({ coolifyUrl: 'https://old.example', coolifyToken: 'old' }),
    )
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }))
    })
    expect(result.current.coolifyUrl).toBe('https://old.example')
  })
})
