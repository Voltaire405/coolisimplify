import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'coolisimplify:settings'

export interface Settings {
  coolifyUrl: string
  coolifyToken: string
}

const EMPTY: Settings = { coolifyUrl: '', coolifyToken: '' }

function readStorage(): Settings {
  if (typeof window === 'undefined') return EMPTY
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      coolifyUrl: parsed.coolifyUrl ?? '',
      coolifyToken: parsed.coolifyToken ?? '',
    }
  } catch {
    return EMPTY
  }
}

let snapshot: Settings = readStorage()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (typeof window !== 'undefined') {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        snapshot = readStorage()
        emit()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(listener)
      window.removeEventListener('storage', onStorage)
    }
  }
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): Settings {
  return snapshot
}

function getServerSnapshot(): Settings {
  return EMPTY
}

function writeStorage(next: Settings) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

function setSnapshot(next: Settings) {
  if (
    snapshot.coolifyUrl === next.coolifyUrl &&
    snapshot.coolifyToken === next.coolifyToken
  ) {
    return
  }
  snapshot = next
  writeStorage(next)
  emit()
}

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const isConfigured = !!settings.coolifyUrl && !!settings.coolifyToken

  const setUrl = useCallback((url: string) => {
    setSnapshot({ ...snapshot, coolifyUrl: url })
  }, [])

  const setToken = useCallback((token: string) => {
    setSnapshot({ ...snapshot, coolifyToken: token })
  }, [])

  const setSettings = useCallback((next: Settings) => {
    setSnapshot(next)
  }, [])

  return {
    ...settings,
    isConfigured,
    setUrl,
    setToken,
    setSettings,
  }
}
