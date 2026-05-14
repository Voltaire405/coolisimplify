import type {
  Application,
  Service,
  Database,
  Project,
  Environment,
  Server,
  EnvironmentVariable,
  CreateResponse,
  DeleteResponse,
  StartResponse,
  StopResponse,
  RestartResponse,
} from './types'

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
      throw new Error(err.message || `HTTP ${res.status}`)
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
    opts?: {
      delete_configurations?: boolean
      delete_volumes?: boolean
      docker_cleanup?: boolean
      delete_connected_networks?: boolean
    },
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
      method: 'GET',
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
      method: 'GET',
    })
  }

  restartApplication(uuid: string): Promise<RestartResponse> {
    return this.request<RestartResponse>(`/applications/${uuid}/restart`, {
      method: 'GET',
    })
  }

  // Services
  listServices(): Promise<Service[]> {
    return this.request<Service[]>('/services')
  }

  getService(uuid: string): Promise<Service> {
    return this.request<Service>(`/services/${uuid}`)
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
    opts?: {
      delete_configurations?: boolean
      delete_volumes?: boolean
      docker_cleanup?: boolean
      delete_connected_networks?: boolean
    },
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
      method: 'GET',
    })
  }

  stopService(uuid: string): Promise<StopResponse> {
    return this.request<StopResponse>(`/services/${uuid}/stop`, {
      method: 'GET',
    })
  }

  restartService(uuid: string): Promise<RestartResponse> {
    return this.request<RestartResponse>(`/services/${uuid}/restart`, {
      method: 'GET',
    })
  }

  // Databases
  listDatabases(): Promise<Database[]> {
    return this.request<Database[]>('/databases')
  }

  getDatabase(uuid: string): Promise<Database> {
    return this.request<Database>(`/databases/${uuid}`)
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
    opts?: {
      delete_configurations?: boolean
      delete_volumes?: boolean
      docker_cleanup?: boolean
      delete_connected_networks?: boolean
    },
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
      method: 'GET',
    })
  }

  stopDatabase(uuid: string): Promise<StopResponse> {
    return this.request<StopResponse>(`/databases/${uuid}/stop`, {
      method: 'GET',
    })
  }

  restartDatabase(uuid: string): Promise<RestartResponse> {
    return this.request<RestartResponse>(`/databases/${uuid}/restart`, {
      method: 'GET',
    })
  }

  // Servers
  listServers(): Promise<Server[]> {
    return this.request<Server[]>('/servers')
  }

  getServer(uuid: string): Promise<Server> {
    return this.request<Server>(`/servers/${uuid}`)
  }

  // Environment variables
  listEnvs(uuid: string): Promise<EnvironmentVariable[]> {
    return this.request<EnvironmentVariable[]>(`/applications/${uuid}/envs`)
  }

  createEnv(
    uuid: string,
    data: {
      key: string
      value: string
      is_preview?: boolean
      is_literal?: boolean
      is_multiline?: boolean
      is_shown_once?: boolean
    },
  ): Promise<CreateResponse> {
    return this.request<CreateResponse>(`/applications/${uuid}/envs`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }
}
