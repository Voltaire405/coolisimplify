'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@workspace/ui/lib/utils'
import type { EnvironmentVariable, ResourceType } from '@/lib/types'
import type { CoolifyClient } from '@/lib/coolify-client'
import {
  envSupportsPreview,
  envValue,
  filterEnvsByKey,
  isValueReadable,
} from '@/lib/envs'

type Draft = {
  /** null for an unsaved "add" row. */
  uuid: string | null
  key: string
  value: string
  is_literal: boolean
  is_multiline: boolean
  is_preview: boolean
}

function toDraft(env: EnvironmentVariable): Draft {
  return {
    uuid: env.uuid,
    key: env.key,
    value: isValueReadable(env) ? envValue(env) : '',
    is_literal: env.is_literal ?? false,
    is_multiline: env.is_multiline ?? false,
    is_preview: env.is_preview ?? false,
  }
}

function draftToPayload(d: Draft, type: ResourceType) {
  return {
    key: d.key,
    value: d.value,
    is_literal: d.is_literal,
    is_multiline: d.is_multiline,
    ...(envSupportsPreview(type) ? { is_preview: d.is_preview } : {}),
  }
}

interface EnvironmentVariableEditorProps {
  client: CoolifyClient
  type: ResourceType
  resourceUuid: string
  /** Fired on any successful create/update/delete so the page can toast. */
  onChanged?: (message: string) => void
  /** Fired when a save/delete fails, with the message (never the raw error). */
  onError?: (message: string) => void
}

/**
 * The always-visible env var editor embedded in Details. Owns the env list for
 * one resource: fetch on open, per-row inline edit/save/delete with a
 * per-row confirm for deletes, and an "add" row saved via POST. See ADR-0003:
 * each save is an isolated PATCH, never the bulk-replace endpoint.
 */
export function EnvironmentVariableEditor({
  client,
  type,
  resourceUuid,
  onChanged,
  onError,
}: EnvironmentVariableEditorProps) {
  const [envs, setEnvs] = useState<EnvironmentVariable[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [adding, setAdding] = useState(false)
  const [addingDraft, setAddingDraft] = useState<Draft | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  // Row-scoped error: `{ uuid, message }` where uuid is the env uuid or the
  // reserved '__add__' for the add row. Rendered on the row it belongs to.
  const [rowError, setRowError] = useState<{ uuid: string; message: string } | null>(null)
  // List-level masking: every readable value is masked until "Reveal all".
  const [revealed, setRevealed] = useState(false)
  // Key-only search box; narrowed rows are filtered out of the list.
  const [searchKey, setSearchKey] = useState('')

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const result = await client.listEnvsFor(type, resourceUuid)
      setEnvs(result)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load variables')
    }
  }, [client, type, resourceUuid])

  useEffect(() => {
    void load()
  }, [load])

  // Re-targeting the drawer to another resource must start the Env Editor
  // fresh: drop the previous resource's search query and reveal state.
  useEffect(() => {
    setSearchKey('')
    setRevealed(false)
  }, [resourceUuid])

  const canAdd = useMemo(() => {
    if (!adding || !addingDraft) return false
    return validateKey(addingDraft.key, envs ?? [], null) === null
  }, [adding, addingDraft, envs])

  const visibleEnvs = useMemo(
    () => filterEnvsByKey(envs ?? [], searchKey),
    [envs, searchKey],
  )

  const isFiltering = searchKey.trim() !== ''

  function validateKey(
    key: string,
    list: EnvironmentVariable[],
    excludeUuid: string | null,
  ): string | null {
    const trimmed = key.trim()
    if (!trimmed) return 'Key is required'
    const dup = list.find(
      (e) =>
        e.uuid !== excludeUuid &&
        e.key.trim().toLowerCase() === trimmed.toLowerCase(),
    )
    if (dup) return `Duplicate key «${dup.key}»`
    return null
  }

  function startEdit(env: EnvironmentVariable) {
    if (savingKey) return
    setEditingKey(env.uuid)
    setDraft(toDraft(env))
    setRowError(null)
  }

  function cancelEdit() {
    if (savingKey) return
    setEditingKey(null)
    setDraft(null)
    setRowError(null)
  }

  function startAdd() {
    if (savingKey) return
    setAdding(true)
    setAddingDraft({
      uuid: null,
      key: '',
      value: '',
      is_literal: false,
      is_multiline: false,
      is_preview: false,
    })
    setRowError(null)
  }

  function cancelAdd() {
    if (savingKey) return
    setAdding(false)
    setAddingDraft(null)
    setRowError(null)
  }

  function startConfirmDelete(env: EnvironmentVariable) {
    if (savingKey) return
    setConfirmingDelete(env.uuid)
  }

  function cancelConfirmDelete() {
    if (savingKey) return
    setConfirmingDelete(null)
  }

  async function handleSaveEdit(env: EnvironmentVariable) {
    if (!draft || savingKey) return
    const keyError = validateKey(draft.key, envs ?? [], env.uuid)
    if (keyError) {
      setRowError({ uuid: env.uuid, message: keyError })
      return
    }
    const renamed = draft.key.trim() !== env.key
    // Coolify routes PATCH /{type}/{uuid}/envs by key — there is no
    // PATCH /envs/{env_uuid} (see ADR-0003). A rename is therefore
    // delete-then-create: PATCH first (value/flags on the old key), then, if
    // the key changed, delete the old row and create the new key. If the
    // create fails after the delete, the row is gone — surface that clearly.
    setSavingKey(env.uuid)
    setRowError(null)
    const payload = draftToPayload({ ...draft }, type)
    // Optimistic for value/flag edits: apply the draft immediately, then
    // reconcile with the PATCH response. A rename is multi-step, so it stays
    // pessimistic — the row only changes once every request has succeeded.
    if (!renamed) {
      setEnvs((prev) =>
        (prev ?? []).map((e) =>
          e.uuid === env.uuid
            ? {
                ...e,
                key: draft.key.trim(),
                value: draft.value,
                is_literal: draft.is_literal,
                is_multiline: draft.is_multiline,
                is_preview: draft.is_preview,
              }
            : e,
        ),
      )
    }
    try {
      const updated = await client.updateEnv(type, resourceUuid, { ...payload })
      if (renamed) {
        await client.deleteEnv(type, resourceUuid, env.uuid)
        const created = await client.createEnvFor(type, resourceUuid, {
          ...payload,
          key: draft.key.trim(),
        })
        const added: EnvironmentVariable = {
          id: env.id,
          uuid: created.uuid,
          key: draft.key.trim(),
          value: draft.value,
          is_literal: draft.is_literal,
          is_multiline: draft.is_multiline,
          is_preview: draft.is_preview,
          real_value: draft.value,
          is_shown_once: env.is_shown_once,
          is_runtime: env.is_runtime,
          is_buildtime: env.is_buildtime,
          is_shared: env.is_shared,
        }
        setEnvs((prev) =>
          (prev ?? []).map((e) => (e.uuid === env.uuid ? added : e)),
        )
      } else {
        // The PATCH response is the authoritative updated var (incl. the
        // decrypted real_value); reconcile over the optimistic write.
        setEnvs((prev) =>
          (prev ?? []).map((e) => (e.uuid === env.uuid ? { ...e, ...updated } : e)),
        )
      }
      setEditingKey(null)
      setDraft(null)
      onChanged?.(renamed ? `Renamed to ${draft.key.trim()}` : `Saved ${draft.key.trim()}`)
    } catch (err) {
      // Revert to the server's value on failure (the row still shows what we
      // tried to save as its draft — the error explains why it didn't stick).
      setEnvs((prev) =>
        (prev ?? []).map((e) => (e.uuid === env.uuid ? env : e)),
      )
      setRowError({
        uuid: env.uuid,
        message: err instanceof Error ? err.message : 'Save failed',
      })
      onError?.(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingKey(null)
    }
  }

  async function handleSaveAdd() {
    if (!addingDraft || savingKey) return
    const keyError = validateKey(addingDraft.key, envs ?? [], null)
    if (keyError) {
      setRowError({ uuid: '__add__', message: keyError })
      return
    }
    setSavingKey('__add__')
    setRowError(null)
    const payload = draftToPayload({ ...addingDraft }, type)
    try {
      const created = await client.createEnvFor(type, resourceUuid, payload)
      const added: EnvironmentVariable = {
        id: 0,
        uuid: created.uuid,
        key: addingDraft.key.trim(),
        value: addingDraft.value,
        is_literal: addingDraft.is_literal,
        is_multiline: addingDraft.is_multiline,
        is_preview: addingDraft.is_preview,
        real_value: addingDraft.value,
      }
      setEnvs((prev) => [...(prev ?? []), added])
      setAdding(false)
      setAddingDraft(null)
      onChanged?.(`Added ${addingDraft.key.trim()}`)
    } catch (err) {
      setRowError({
        uuid: '__add__',
        message: err instanceof Error ? err.message : 'Save failed',
      })
      onError?.(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingKey(null)
    }
  }

  async function handleDelete(env: EnvironmentVariable) {
    if (savingKey) return
    setSavingKey(env.uuid)
    setRowError(null)
    try {
      await client.deleteEnv(type, resourceUuid, env.uuid)
      setEnvs((prev) => (prev ?? []).filter((e) => e.uuid !== env.uuid))
      setConfirmingDelete(null)
      if (editingKey === env.uuid) {
        setEditingKey(null)
        setDraft(null)
      }
      onChanged?.(`Deleted ${env.key}`)
    } catch (err) {
      setRowError({
        uuid: env.uuid,
        message: err instanceof Error ? err.message : 'Delete failed',
      })
      onError?.(err instanceof Error ? err.message : 'Delete failed')
      setConfirmingDelete(null)
    } finally {
      setSavingKey(null)
    }
  }

  if (loadError) {
    return (
      <div className="text-xs text-destructive">
        Could not load environment variables: {loadError}
      </div>
    )
  }

  if (envs === null) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading environment variables&hellip;
      </div>
    )
  }

  const totalCount = envs.length

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">Environment variables</span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {isFiltering
              ? `${visibleEnvs.length} of ${totalCount} ${totalCount === 1 ? 'variable' : 'variables'}`
              : `${totalCount} ${totalCount === 1 ? 'variable' : 'variables'}`}
          </span>
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? 'Hide all values' : 'Reveal all values'}
            title={revealed ? 'Hide all values' : 'Reveal all values'}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            {revealed ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
        </span>
      </div>

      {envs.length > 0 && (
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchKey}
            onChange={(e) => setSearchKey(e.target.value)}
            placeholder="Search by key…"
            aria-label="Search variables by key"
            className="w-full rounded-md border border-border bg-background py-1 pl-7 pr-7 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40"
          />
          {searchKey && (
            <button
              type="button"
              onClick={() => setSearchKey('')}
              aria-label="Clear search"
              title="Clear search"
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {envs.length === 0 && !adding && (
        <p className="mt-2 text-xs text-muted-foreground">
          No environment variables yet.
        </p>
      )}

      {envs.length > 0 && visibleEnvs.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          No variables match &ldquo;{searchKey}&rdquo;.
        </p>
      )}

      <ul className="mt-2 space-y-1.5">
        {visibleEnvs.map((env) => {
          const editing = editingKey === env.uuid
          const saving = savingKey === env.uuid
          const confirming = confirmingDelete === env.uuid
          return (
            <li key={env.uuid} className="rounded-md border border-border bg-muted/30 px-2.5 py-2">
              {editing ? (
                <EnvRowForm
                  draft={draft ?? toDraft(env)}
                  type={type}
                  saving={saving}
                  onChange={setDraft}
                  onCancel={cancelEdit}
                  onSave={() => void handleSaveEdit(env)}
                />
              ) : confirming ? (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span>
                    Delete <span className="font-mono font-semibold">{env.key}</span>?
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={cancelConfirmDelete}
                      disabled={saving}
                      className="rounded-md border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(env)}
                      disabled={saving}
                      className="rounded-md bg-destructive px-2 py-0.5 font-medium text-white hover:bg-destructive/90 disabled:opacity-40"
                    >
                      {saving ? 'Deleting…' : 'Delete'}
                    </button>
                  </span>
                </div>
              ) : (
                <EnvRowDisplay
                  env={env}
                  revealed={revealed}
                  onEdit={() => startEdit(env)}
                  onDelete={() => startConfirmDelete(env)}
                  disabled={savingKey !== null}
                />
              )}
              {rowError && rowError.uuid === env.uuid && (
                <p className="mt-1.5 text-xs text-destructive">{rowError.message}</p>
              )}
            </li>
          )
        })}

        {adding && addingDraft && !isFiltering && (
          <li className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
            <EnvRowForm
              draft={addingDraft}
              type={type}
              saving={savingKey === '__add__'}
              onChange={setAddingDraft}
              onCancel={cancelAdd}
              onSave={() => void handleSaveAdd()}
              saveDisabled={!canAdd}
            />
            {rowError && rowError.uuid === '__add__' && (
              <p className="mt-1.5 text-xs text-destructive">{rowError.message}</p>
            )}
          </li>
        )}
      </ul>

      <div className="mt-2">
        {adding || isFiltering ? null : (
          <button
            type="button"
            onClick={startAdd}
            disabled={savingKey !== null}
            className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Add variable
          </button>
        )}
      </div>
    </div>
  )
}

function EnvRowDisplay({
  env,
  revealed,
  onEdit,
  onDelete,
  disabled,
}: {
  env: EnvironmentVariable
  /** Whether the list-level "Reveal all" is active. */
  revealed: boolean
  onEdit: () => void
  onDelete: () => void
  disabled: boolean
}) {
  const readable = isValueReadable(env)
  const shown = readable ? envValue(env) : ''

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 break-words whitespace-pre-wrap font-mono text-sm text-foreground">
          {env.key}
        </span>
        <EnvBadges env={env} />
        <span className="flex shrink-0 gap-0.5">
          <button
            type="button"
            onClick={onEdit}
            disabled={disabled}
            aria-label={`Edit ${env.key}`}
            title="Edit"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled}
            aria-label={`Delete ${env.key}`}
            title="Delete"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {readable ? (
        <div className="max-h-24 overflow-auto break-words whitespace-pre-wrap font-mono text-sm text-muted-foreground">
          {revealed ? shown : '••••••••••'}
        </div>
      ) : (
        <p className="text-xs italic text-muted-foreground">value not readable</p>
      )}
    </div>
  )
}

function EnvBadges({ env }: { env: EnvironmentVariable }) {
  const badges: Array<{ label: string; title: string }> = []
  if (env.is_runtime) badges.push({ label: 'runtime', title: 'Runtime variable' })
  if (env.is_buildtime) badges.push({ label: 'buildtime', title: 'Build-time variable' })
  if (env.is_shared) badges.push({ label: 'shared', title: 'Shared variable' })
  if (env.is_shown_once) badges.push({ label: 'once', title: 'Shown once' })
  if (badges.length === 0) return null
  return (
    <span className="shrink-0 gap-1">
      {badges.map((b) => (
        <span
          key={b.label}
          title={b.title}
          className="rounded border border-border px-1 py-0 text-[9px] uppercase tracking-wider text-muted-foreground"
        >
          {b.label}
        </span>
      ))}
    </span>
  )
}

function EnvRowForm({
  draft,
  type,
  saving,
  onChange,
  onCancel,
  onSave,
  saveDisabled = false,
}: {
  draft: Draft
  type: ResourceType
  saving: boolean
  onChange: (d: Draft) => void
  onCancel: () => void
  onSave: () => void
  saveDisabled?: boolean
}) {
  const supportsPreview = envSupportsPreview(type)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <input
          ref={(el) => {
            if (el) el.focus()
          }}
          type="text"
          value={draft.key}
          onChange={(e) => onChange({ ...draft, key: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSave()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
          spellCheck={false}
          aria-label="Variable key"
          placeholder="KEY"
          disabled={saving}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={saving || saveDisabled || !draft.key.trim()}
          aria-label="Save variable"
          title="Save"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted disabled:opacity-40"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          aria-label="Cancel editing"
          title="Cancel"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-destructive hover:bg-muted disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <AutoGrowTextarea
        value={draft.value}
        onChange={(value) => onChange({ ...draft, value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onSave()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        ariaLabel="Variable value"
        placeholder="value"
        disabled={saving}
      />
      <div className="flex items-center gap-3 pl-1">
        <EnvCheckbox
          label="Literal"
          checked={draft.is_literal}
          onChange={(v) => onChange({ ...draft, is_literal: v })}
          disabled={saving}
        />
        <EnvCheckbox
          label="Multiline"
          checked={draft.is_multiline}
          onChange={(v) => onChange({ ...draft, is_multiline: v })}
          disabled={saving}
        />
        {supportsPreview && (
          <EnvCheckbox
            label="Preview"
            checked={draft.is_preview}
            onChange={(v) => onChange({ ...draft, is_preview: v })}
            disabled={saving}
          />
        )}
      </div>
    </div>
  )
}

/**
 * A `<textarea>` that grows with its content (auto-grow, no cap). Used for the
 * env value so multiline values (PEM, JSON, compose) edit naturally; Enter
 * inserts a newline and saving is Cmd/Ctrl+Enter or the Save button (see
 * EnvRowForm).
 */
function AutoGrowTextarea({
  value,
  onChange,
  onKeyDown,
  ariaLabel,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      spellCheck={false}
      aria-label={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
      className="min-h-[2.125rem] w-full resize-none rounded-md border border-border bg-background px-2 py-1 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/40 disabled:opacity-50"
    />
  )
}

function EnvCheckbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      className={cn(
        'flex items-center gap-1.5 text-xs text-muted-foreground',
        disabled && 'opacity-40',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-3.5 w-3.5 rounded border-border"
      />
      {label}
    </label>
  )
}
