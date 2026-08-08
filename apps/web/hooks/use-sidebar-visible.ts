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

  return { sidebarVisible: visible, toggleSidebar }
}
