'use client'

import { useEffect, useMemo, useState } from 'react'
import { Copy, Loader2 } from 'lucide-react'
import { ModalShell } from './confirm-dialog'
import { useClient, useProjects, useServers, useEnvironments } from '@/hooks/use-coolify'
import type { CoolifyClient } from '@/lib/coolify-client'
import type { GithubApp, Resource, ResourceType, EnvironmentVariable } from '@/lib/types'
import {
  cloneResource,
  detectApplicationKind,
  detectDatabaseType,
  DATABASE_CREDENTIAL_FIELDS,
  type CloneResult,
} from '@/lib/clone'

interface CloneDialogProps {
  source: Resource
  sourceType: ResourceType
  onCancel: () => void
  onCloned: (type: ResourceType, result: CloneResult) => void
}

interface CloneDetails {
  detail: Resource | null
  envs: EnvironmentVariable[]
  loading: boolean
  error: string | null
}

export function CloneDialog({
  source,
  sourceType,
  onCancel,
  onCloned,
}: CloneDialogProps) {
  const { client } = useClient()
  const {
    data: servers,
    loading: serversLoading,
  } = useServers()
  const {
    data: projects,
    loading: projectsLoading,
  } = useProjects()

  const [details, setDetails] = useState<CloneDetails>({
    detail: null,
    envs: [],
    loading: true,
    error: null,
  })
  const [targetServerUuid, setTargetServerUuid] = useState('')
  const [targetProjectUuid, setTargetProjectUuid] = useState('')
  const [targetEnvironmentUuid, setTargetEnvironmentUuid] = useState('')
  const [name, setName] = useState(`${source.name || 'Resource'} copy`)
  const [domains, setDomains] = useState('')
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [githubApps, setGithubApps] = useState<GithubApp[]>([])
  const [githubAppsError, setGithubAppsError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the registered GitHub Apps so the clone can automatically reuse the
  // source application's GitHub App (no manual re-selection).
  useEffect(() => {
    if (!client || sourceType !== 'application') return
    let cancelled = false
    setGithubAppsError(null)
    client
      .listGithubApps()
      .then((apps) => {
        if (!cancelled) setGithubApps(apps)
      })
      .catch((err) => {
        if (!cancelled) {
          setGithubAppsError(
            err instanceof Error ? err.message : 'Failed to load GitHub Apps',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [client, sourceType])

  useEffect(() => {
    if (!client) {
      setDetails((d) => ({
        ...d,
        loading: false,
        error: 'Coolify is not configured',
      }))
      return
    }
    const c: CoolifyClient = client
    let cancelled = false
    async function load() {
      try {
        const [detail, envs] =
          sourceType === 'application'
            ? await Promise.all([
                c.getApplication(source.uuid),
                c.listEnvs(source.uuid),
              ])
            : sourceType === 'service'
              ? await Promise.all([
                  c.getService(source.uuid),
                  c.listServiceEnvs(source.uuid),
                ])
              : await Promise.all([
                  c.getDatabase(source.uuid),
                  c.listDatabaseEnvs(source.uuid),
                ])
        if (cancelled) return
        setDetails({ detail, envs, loading: false, error: null })
        // Domains are intentionally left empty by default: reusing the source
        // domain when cloning into the same server would conflict (409/422).
        setDomains('')
      } catch (err) {
        if (cancelled) return
        setDetails((d) => ({
          ...d,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load source details',
        }))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [client, source.uuid, sourceType])

  const { data: environments, loading: envsLoading } = useEnvironments(
    targetProjectUuid || null,
  )

  const kind = useMemo(() => {
    if (sourceType !== 'application' || !details.detail) return null
    return detectApplicationKind(details.detail as Parameters<typeof detectApplicationKind>[0])
  }, [sourceType, details.detail])

  const dbType = useMemo(() => {
    if (sourceType !== 'database' || !details.detail) return null
    return detectDatabaseType((details.detail as { image?: string | null }).image)
  }, [sourceType, details.detail])

  const credentialFields = dbType ? DATABASE_CREDENTIAL_FIELDS[dbType].fields : []

  const missingRequiredSecrets = credentialFields.some(
    (f) => f.required && !(secrets[f.key] ?? '').trim(),
  )

  const canSubmit =
    !!client &&
    !!details.detail &&
    !!targetServerUuid &&
    !!targetProjectUuid &&
    !!targetEnvironmentUuid &&
    name.trim().length > 0 &&
    !missingRequiredSecrets

  async function handleSubmit() {
    if (!client || !details.detail || !canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await cloneResource(
        client,
        sourceType,
        details.detail,
        details.envs,
        {
          projectUuid: targetProjectUuid,
          serverUuid: targetServerUuid,
          environmentUuid: targetEnvironmentUuid,
          name: name.trim(),
          domains: sourceType === 'application' ? domains : undefined,
        },
        secrets,
        githubApps,
      )
      onCloned(sourceType, result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clone failed')
      setSubmitting(false)
    }
  }

  const sourceSummary = (() => {
    if (sourceType === 'application') {
      const app = details.detail as { build_pack?: string; git_repository?: string } | null
      if (kind === 'private-github-app') {
        return `Private GitHub repo${app?.git_repository ? ` (${app.git_repository})` : ''}`
      }
      if (kind === 'dockerfile') return 'Dockerfile application'
      return 'Not cloneable'
    }
    if (sourceType === 'service') return 'Docker Compose service'
    return dbType ? `${dbType.charAt(0).toUpperCase()}${dbType.slice(1)} database` : 'Database'
  })()

  return (
    <ModalShell onCancel={onCancel} labelledBy="clone-dialog-title">
      <h2
        id="clone-dialog-title"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <Copy className="h-4 w-4" />
        Clone {sourceType} &laquo;{source.name || 'Unnamed'}&raquo;
      </h2>

      {details.loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading source details&hellip;
        </div>
      ) : details.error ? (
        <div className="py-4 text-sm text-destructive">{details.error}</div>
      ) : (
        <>
          <div className="mt-3 space-y-3 text-sm">
            <label className="block">
              <span className="text-xs text-muted-foreground">Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                spellCheck={false}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40"
              />
            </label>

            <label className="block">
              <span className="text-xs text-muted-foreground">Target server</span>
              <select
                value={targetServerUuid}
                onChange={(e) => setTargetServerUuid(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40"
              >
                <option value="">Select a server&hellip;</option>
                {servers.map((s) => (
                  <option key={s.uuid} value={s.uuid}>
                    {s.name}
                  </option>
                ))}
              </select>
              {serversLoading && (
                <span className="ml-1 text-xs text-muted-foreground">Loading&hellip;</span>
              )}
            </label>

            <label className="block">
              <span className="text-xs text-muted-foreground">Target project</span>
              <select
                value={targetProjectUuid}
                onChange={(e) => {
                  setTargetProjectUuid(e.target.value)
                  setTargetEnvironmentUuid('')
                }}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40"
              >
                <option value="">Select a project&hellip;</option>
                {projects.map((p) => (
                  <option key={p.uuid} value={p.uuid}>
                    {p.name}
                  </option>
                ))}
              </select>
              {projectsLoading && (
                <span className="ml-1 text-xs text-muted-foreground">Loading&hellip;</span>
              )}
            </label>

            <label className="block">
              <span className="text-xs text-muted-foreground">Target environment</span>
              <select
                value={targetEnvironmentUuid}
                onChange={(e) => setTargetEnvironmentUuid(e.target.value)}
                disabled={!targetProjectUuid}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <option value="">
                  {targetProjectUuid ? 'Select an environment…' : 'Select a project first'}
                </option>
                {environments.map((env) => (
                  <option key={env.uuid} value={env.uuid}>
                    {env.name}
                  </option>
                ))}
              </select>
              {envsLoading && (
                <span className="ml-1 text-xs text-muted-foreground">Loading&hellip;</span>
              )}
            </label>

            {sourceType === 'application' && (
              <label className="block">
                <span className="text-xs text-muted-foreground">
                  Domains (comma-separated)
                </span>
                <input
                  type="text"
                  value={domains}
                  onChange={(e) => setDomains(e.target.value)}
                  spellCheck={false}
                  placeholder="https://example.com"
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40"
                />
              </label>
            )}

            {kind === 'private-github-app' && githubAppsError && (
              <p className="text-xs text-destructive">
                Could not load the registered GitHub Apps: {githubAppsError}. The
                source app&rsquo;s GitHub App will be reused automatically when
                possible.
              </p>
            )}

            {credentialFields.map((field) => {
              const value =
                secrets[field.key] ??
                (field.default !== undefined ? field.default : '')
              return (
                <label key={field.key} className="block">
                  <span className="text-xs text-muted-foreground">
                    {field.label}
                    {field.required ? ' *' : ''}
                  </span>
                  <input
                    type="password"
                    value={value}
                    onChange={(e) =>
                      setSecrets((s) => ({ ...s, [field.key]: e.target.value }))
                    }
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40"
                  />
                </label>
              )
            })}
          </div>

          <div className="mt-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <p>
              <strong className="text-foreground">Source:</strong> {sourceSummary} &middot;{' '}
              {details.envs.length} environment variable
              {details.envs.length === 1 ? '' : 's'}
            </p>
            <p className="mt-1">
              Copies the full configuration and all environment variables. The
              clone is created <strong className="text-foreground">stopped</strong>; no
              deployments, logs, volumes or data are copied.
            </p>
            {kind === 'private-github-app' && (
              <p className="mt-1">
                Uses the same GitHub App as the source (no re-selection needed).
              </p>
            )}
            {sourceType === 'database' && (
              <p className="mt-1">
                Database credentials are not stored in Coolify&rsquo;s API and must be
                re-entered above.
              </p>
            )}
          </div>

          {error && (
            <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={onCancel}
              disabled={submitting}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {submitting ? 'Cloning&hellip;' : 'Clone'}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  )
}
