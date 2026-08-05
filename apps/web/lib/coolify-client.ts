import type {
  Application,
  Service,
  Database,
  Project,
  Environment,
  Server,
  GithubApp,
  EnvironmentVariable,
  CreateResponse,
  DeleteResponse,
  StartResponse,
  StopResponse,
  RestartResponse,
  DatabaseType,
  EnvVarCreate,
  EnvVarUpdate,
  PrivateGithubAppCreate,
  DockerfileAppCreate,
  ServiceCreate,
  DatabaseCreate,
  DeleteOptions,
  LogsResponse,
} from './types'
import type { ResourceType } from './types'
import { envBasePath, envItemPath } from './envs.ts'

export interface CoolifyClientOptions {
  baseUrl: string
  token: string
}

export class CoolifyClient {
  private baseUrl: string
  private token: string

  constructor({ baseUrl, token }: CoolifyClientOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.token = token
  }

  /**
   * Coolify puts the useful part of a 422 in `errors` (one entry per offending
   * field) and leaves `message` as a generic "Validation failed." — surface
   * both, otherwise the field name is only visible in DevTools.
   */
  private static formatError(err: unknown, status: number): string {
    const body = (err ?? {}) as { message?: string; errors?: unknown }
    const message = body.message || `HTTP ${status}`
    const errors = body.errors
    if (!errors || typeof errors !== 'object') return message
    const parts = Object.entries(errors as Record<string, unknown>).map(
      ([field, detail]) =>
        `${field}: ${Array.isArray(detail) ? detail.join(' ') : String(detail)}`,
    )
    return parts.length ? `${message} ${parts.join('; ')}` : message
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const proxyUrl = `/api/coolify${path}`
    const res = await fetch(proxyUrl, {
      ...options,
      cache: 'no-store',
      headers: {
        'x-coolify-url': this.baseUrl,
        'x-coolify-token': this.token,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error(CoolifyClient.formatError(err, res.status))
    }

    if (res.status === 204) {
      return undefined as T
    }

    return res.json() as Promise<T>
  }

  // Projects
  listProjects(): Promise<Project[]> {
    return this.request<Project[]>('/projects')
  }

  getProject(uuid: string): Promise<Project> {
    return this.request<Project>(`/projects/${uuid}`)
  }

  createProject(data: { name: string; description?: string }): Promise<CreateResponse> {
    return this.request<CreateResponse>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  updateProject(
    uuid: string,
    data: { name?: string; description?: string },
  ): Promise<CreateResponse> {
    return this.request<CreateResponse>(`/projects/${uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  deleteProject(uuid: string): Promise<DeleteResponse> {
    return this.request<DeleteResponse>(`/projects/${uuid}`, {
      method: 'DELETE',
    })
  }

  listEnvironments(projectUuid: string): Promise<Environment[]> {
    return this.request<Environment[]>(`/projects/${projectUuid}/environments`)
  }

  getEnvironment(
    projectUuid: string,
    environmentNameOrUuid: string,
  ): Promise<Environment> {
    return this.request<Environment>(
      `/projects/${projectUuid}/${environmentNameOrUuid}`,
    )
  }

  createEnvironment(projectUuid: string, name: string): Promise<CreateResponse> {
    return this.request<CreateResponse>(`/projects/${projectUuid}/environments`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  }

  // Applications
  listApplications(tag?: string): Promise<Application[]> {
    const qs = tag ? `?tag=${encodeURIComponent(tag)}` : ''
    return this.request<Application[]>(`/applications${qs}`)
  }

  getApplication(uuid: string): Promise<Application> {
    return this.request<Application>(`/applications/${uuid}`)
  }

  createApplicationFromGithubApp(
    data: PrivateGithubAppCreate,
  ): Promise<CreateResponse> {
    return this.request<CreateResponse>('/applications/private-github-app', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  createApplicationFromDockerfile(
    data: DockerfileAppCreate,
  ): Promise<CreateResponse> {
    return this.request<CreateResponse>('/applications/dockerfile', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  updateApplication(
    uuid: string,
    data: Record<string, unknown>,
  ): Promise<{ uuid: string }> {
    return this.request<{ uuid: string }>(`/applications/${uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  deleteApplication(
    uuid: string,
    opts?: Partial<DeleteOptions>,
  ): Promise<DeleteResponse> {
    const params = new URLSearchParams()
    if (opts?.delete_configurations !== undefined)
      params.set('delete_configurations', String(opts.delete_configurations))
    if (opts?.delete_volumes !== undefined)
      params.set('delete_volumes', String(opts.delete_volumes))
    if (opts?.docker_cleanup !== undefined)
      params.set('docker_cleanup', String(opts.docker_cleanup))
    if (opts?.delete_connected_networks !== undefined)
      params.set('delete_connected_networks', String(opts.delete_connected_networks))
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<DeleteResponse>(`/applications/${uuid}${qs}`, {
      method: 'DELETE',
    })
  }

  startApplication(
    uuid: string,
    opts?: { force?: boolean; instant_deploy?: boolean },
  ): Promise<StartResponse> {
    const params = new URLSearchParams()
    if (opts?.force !== undefined) params.set('force', String(opts.force))
    if (opts?.instant_deploy !== undefined)
      params.set('instant_deploy', String(opts.instant_deploy))
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<StartResponse>(`/applications/${uuid}/start${qs}`, {
      method: 'POST',
    })
  }

  stopApplication(
    uuid: string,
    opts?: { docker_cleanup?: boolean },
  ): Promise<StopResponse> {
    const params = new URLSearchParams()
    if (opts?.docker_cleanup !== undefined)
      params.set('docker_cleanup', String(opts.docker_cleanup))
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<StopResponse>(`/applications/${uuid}/stop${qs}`, {
      method: 'POST',
    })
  }

  restartApplication(uuid: string): Promise<RestartResponse> {
    return this.request<RestartResponse>(`/applications/${uuid}/restart`, {
      method: 'POST',
    })
  }

  /**
   * `lines` (tail window, API default 100) and `show_timestamps` are the only
   * knobs the endpoint accepts — no follow, no since/until, no severity filter.
   * Anything else the viewer offers is applied client-side.
   */
  getApplicationLogs(
    uuid: string,
    opts?: { lines?: number; show_timestamps?: boolean },
  ): Promise<LogsResponse> {
    const params = new URLSearchParams()
    if (opts?.lines !== undefined) params.set('lines', String(opts.lines))
    if (opts?.show_timestamps !== undefined)
      params.set('show_timestamps', String(opts.show_timestamps))
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<LogsResponse>(`/applications/${uuid}/logs${qs}`)
  }

  // Services
  listServices(): Promise<Service[]> {
    return this.request<Service[]>('/services')
  }

  getService(uuid: string): Promise<Service> {
    return this.request<Service>(`/services/${uuid}`)
  }

  createService(data: ServiceCreate): Promise<CreateResponse> {
    return this.request<CreateResponse>('/services', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  updateService(
    uuid: string,
    data: Record<string, unknown>,
  ): Promise<{ uuid: string; domains?: string[] }> {
    return this.request<{ uuid: string; domains?: string[] }>(`/services/${uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  deleteService(
    uuid: string,
    opts?: Partial<DeleteOptions>,
  ): Promise<DeleteResponse> {
    const params = new URLSearchParams()
    if (opts?.delete_configurations !== undefined)
      params.set('delete_configurations', String(opts.delete_configurations))
    if (opts?.delete_volumes !== undefined)
      params.set('delete_volumes', String(opts.delete_volumes))
    if (opts?.docker_cleanup !== undefined)
      params.set('docker_cleanup', String(opts.docker_cleanup))
    if (opts?.delete_connected_networks !== undefined)
      params.set('delete_connected_networks', String(opts.delete_connected_networks))
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<DeleteResponse>(`/services/${uuid}${qs}`, {
      method: 'DELETE',
    })
  }

  startService(uuid: string): Promise<StartResponse> {
    return this.request<StartResponse>(`/services/${uuid}/start`, {
      method: 'POST',
    })
  }

  stopService(uuid: string): Promise<StopResponse> {
    return this.request<StopResponse>(`/services/${uuid}/stop`, {
      method: 'POST',
    })
  }

  restartService(
    uuid: string,
    opts?: { latest?: boolean },
  ): Promise<RestartResponse> {
    const params = new URLSearchParams()
    if (opts?.latest !== undefined) params.set('latest', String(opts.latest))
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<RestartResponse>(`/services/${uuid}/restart${qs}`, {
      method: 'POST',
    })
  }

  // Databases
  listDatabases(): Promise<Database[]> {
    return this.request<Database[]>('/databases')
  }

  getDatabase(uuid: string): Promise<Database> {
    return this.request<Database>(`/databases/${uuid}`)
  }

  createDatabase(
    type: DatabaseType,
    data: DatabaseCreate,
  ): Promise<CreateResponse> {
    return this.request<CreateResponse>(`/databases/${type}`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  updateDatabase(
    uuid: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request<unknown>(`/databases/${uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  deleteDatabase(
    uuid: string,
    opts?: Partial<DeleteOptions>,
  ): Promise<DeleteResponse> {
    const params = new URLSearchParams()
    if (opts?.delete_configurations !== undefined)
      params.set('delete_configurations', String(opts.delete_configurations))
    if (opts?.delete_volumes !== undefined)
      params.set('delete_volumes', String(opts.delete_volumes))
    if (opts?.docker_cleanup !== undefined)
      params.set('docker_cleanup', String(opts.docker_cleanup))
    if (opts?.delete_connected_networks !== undefined)
      params.set('delete_connected_networks', String(opts.delete_connected_networks))
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<DeleteResponse>(`/databases/${uuid}${qs}`, {
      method: 'DELETE',
    })
  }

  startDatabase(uuid: string): Promise<StartResponse> {
    return this.request<StartResponse>(`/databases/${uuid}/start`, {
      method: 'POST',
    })
  }

  stopDatabase(uuid: string): Promise<StopResponse> {
    return this.request<StopResponse>(`/databases/${uuid}/stop`, {
      method: 'POST',
    })
  }

  restartDatabase(uuid: string): Promise<RestartResponse> {
    return this.request<RestartResponse>(`/databases/${uuid}/restart`, {
      method: 'POST',
    })
  }

  // Servers
  listServers(): Promise<Server[]> {
    return this.request<Server[]>('/servers')
  }

  getServer(uuid: string): Promise<Server> {
    return this.request<Server>(`/servers/${uuid}`)
  }

  // GitHub Apps
  listGithubApps(): Promise<GithubApp[]> {
    return this.request<GithubApp[]>('/github-apps')
  }

  // Environment variables
  listEnvs(uuid: string): Promise<EnvironmentVariable[]> {
    return this.request<EnvironmentVariable[]>(`/applications/${uuid}/envs`)
  }

  createEnv(
    uuid: string,
    data: EnvVarCreate,
  ): Promise<CreateResponse> {
    return this.request<CreateResponse>(`/applications/${uuid}/envs`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  listServiceEnvs(uuid: string): Promise<EnvironmentVariable[]> {
    return this.request<EnvironmentVariable[]>(`/services/${uuid}/envs`)
  }

  createServiceEnv(
    uuid: string,
    data: EnvVarCreate,
  ): Promise<CreateResponse> {
    return this.request<CreateResponse>(`/services/${uuid}/envs`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  listDatabaseEnvs(uuid: string): Promise<EnvironmentVariable[]> {
    return this.request<EnvironmentVariable[]>(`/databases/${uuid}/envs`)
  }

  createDatabaseEnv(
    uuid: string,
    data: EnvVarCreate,
  ): Promise<CreateResponse> {
    return this.request<CreateResponse>(`/databases/${uuid}/envs`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /** List env vars for any resource type. */
  listEnvsFor(type: ResourceType, uuid: string): Promise<EnvironmentVariable[]> {
    return this.request<EnvironmentVariable[]>(envBasePath(type, uuid))
  }

  /** Create an env var on any resource type. */
  createEnvFor(
    type: ResourceType,
    uuid: string,
    data: EnvVarCreate,
  ): Promise<CreateResponse> {
    return this.request<CreateResponse>(envBasePath(type, uuid), {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /**
   * Update a single env var on any resource type. Coolify has no
   * `PATCH /envs/{env_uuid}` — updates go to `PATCH /{type}/{uuid}/envs` and
   * are routed by `key` (see ADR-0003). Returns the updated EnvironmentVariable.
   * Renaming a key is not possible here; callers must delete-then-create.
   */
  updateEnv(
    type: ResourceType,
    uuid: string,
    data: EnvVarUpdate,
  ): Promise<EnvironmentVariable> {
    return this.request<EnvironmentVariable>(envBasePath(type, uuid), {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  /** Delete a single env var on any resource type. */
  deleteEnv(
    type: ResourceType,
    uuid: string,
    envUuid: string,
  ): Promise<DeleteResponse> {
    return this.request<DeleteResponse>(envItemPath(type, uuid, envUuid), {
      method: 'DELETE',
    })
  }
}
