import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'coolisimplify:sidebar-visible'

function readStored(): boolean {
  if (typeof window === 'undefined') return true
  try {
    // Anything other than an explicit "false" means visible, so the default
    // holds even for corrupt or partial storage.
    return window.localStorage.getItem(STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function useSidebarVisible() {
  const [visible, setVisible] = useState(readStored)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(visible))
    } catch {
      // Storage unavailable: keep the preference in memory only.
    }
  }, [visible])

  const toggleSidebar = useCallback(() => {
    setVisible((prev) => !prev)
  }, [])

  // Cmd/Ctrl+B toggles the projects panel, except while typing in a field:
  // the shortcut must not hijack the inline rename or env-var editors.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() !== 'b') return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      e.preventDefault()
      toggleSidebar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

  return { sidebarVisible: visible, toggleSidebar }
}
