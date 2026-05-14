'use client'

import { useState } from 'react'
import { useSettings } from '@/hooks/use-settings'
import { X, TestTube, Trash2 } from 'lucide-react'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { coolifyUrl, coolifyToken, setSettings } = useSettings()
  const [url, setUrl] = useState(coolifyUrl)
  const [token, setToken] = useState(coolifyToken)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  const handleSave = () => {
    setSettings({ coolifyUrl: url.replace(/\/$/, ''), coolifyToken: token })
    onOpenChange(false)
  }

  const handleClear = () => {
    setSettings({ coolifyUrl: '', coolifyToken: '' })
    setUrl('')
    setToken('')
    setTestResult(null)
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/coolify/projects', {
        headers: {
          'x-coolify-url': url.replace(/\/$/, ''),
          'x-coolify-token': token,
        },
      })
      if (res.ok) {
        setTestResult({ ok: true, message: 'Connection successful.' })
      } else {
        const body = await res.json().catch(() => ({}))
        const msg = body.message || `HTTP ${res.status}`
        if (res.status === 401 || res.status === 403) {
          setTestResult({
            ok: false,
            message: `Authentication failed: ${msg}. Check your API token.`,
          })
        } else {
          setTestResult({ ok: false, message: msg })
        }
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Connection failed',
      })
    } finally {
      setTesting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-10 max-h-[calc(100dvh-1.5rem)] w-full overflow-y-auto rounded-lg border border-border bg-card p-4 shadow-sm sm:max-w-md sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted sm:h-auto sm:w-auto sm:p-1"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">
              Coolify Instance URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://coolify.example.com"
              className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-ring sm:py-2"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">
              API Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Your Coolify API token"
              className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-ring sm:py-2"
            />
          </div>

          {testResult && (
            <div
              className={`rounded-md px-3 py-2 text-sm ${
                testResult.ok
                  ? 'border border-black/10 bg-black/5 text-black'
                  : 'border border-destructive/20 bg-destructive/5 text-destructive'
              }`}
            >
              {testResult.message}
            </div>
          )}

          <div className="flex flex-col gap-2 pt-2 sm:flex-row">
            <button
              onClick={handleTest}
              disabled={testing || !url || !token}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50 sm:h-auto sm:py-2"
            >
              <TestTube className="h-3.5 w-3.5" />
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            <button
              onClick={handleSave}
              disabled={!url || !token}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-md border border-black bg-black px-3 text-sm font-medium text-white hover:bg-black/80 disabled:opacity-50 sm:h-auto sm:py-2"
            >
              Save
            </button>
          </div>

          {(coolifyUrl || coolifyToken) && (
            <button
              onClick={handleClear}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md border border-destructive/20 px-3 text-sm font-medium text-destructive hover:bg-destructive/5 sm:h-auto sm:py-2"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear Configuration
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
