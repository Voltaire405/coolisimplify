export interface Project {
  id: number
  uuid: string
  name: string
  description?: string
}

export interface Environment {
  id: number
  uuid: string
  name: string
  project_id: number
  description?: string
  created_at?: string
  updated_at?: string
}

export interface Application {
  id: number
  uuid: string
  name: string
  description?: string | null
  status?: string
  fqdn?: string | null
  git_repository?: string
  git_branch?: string
  git_commit_sha?: string
  build_pack?: 'nixpacks' | 'static' | 'dockerfile' | 'dockercompose'
  ports_exposes?: string
  ports_mappings?: string | null
  base_directory?: string
  publish_directory?: string
  health_check_enabled?: boolean
  health_check_path?: string
  health_check_port?: string | null
  health_check_host?: string | null
  health_check_method?: string
  health_check_return_code?: number
  health_check_scheme?: string
  health_check_response_text?: string | null
  health_check_interval?: number
  health_check_timeout?: number
  health_check_retries?: number
  health_check_start_period?: number
  health_check_type?: 'http' | 'cmd'
  health_check_command?: string | null
  limits_memory?: string
  limits_memory_swap?: string
  limits_memory_swappiness?: number
  limits_memory_reservation?: string
  limits_cpus?: string
  limits_cpuset?: string | null
  limits_cpu_shares?: number
  docker_registry_image_name?: string | null
  docker_registry_image_tag?: string | null
  environment_id?: number
  server_id?: number
  destination_type?: string
  destination_id?: number
  created_at?: string
  updated_at?: string
  deleted_at?: string | null
}

export interface Service {
  id: number
  uuid: string
  name: string
  description?: string
  status?: string
  environment_id?: number
  server_id?: number
  destination_type?: string
  destination_id?: number
  docker_compose_raw?: string
  docker_compose?: string
  service_type?: string
  connect_to_docker_network?: boolean
  is_container_label_escape_enabled?: boolean
  is_container_label_readonly_enabled?: boolean
  config_hash?: string
  created_at?: string
  updated_at?: string
  deleted_at?: string | null
}

export interface Database {
  id: number
  uuid: string
  name: string
  description?: string
  status?: string
  image?: string
  is_public?: boolean
  public_port?: number
  public_port_timeout?: number
  environment_id?: number
  server_id?: number
  destination_type?: string
  destination_id?: number
  limits_memory?: string
  limits_memory_swap?: string
  limits_memory_swappiness?: number
  limits_memory_reservation?: string
  limits_cpus?: string
  limits_cpuset?: string
  limits_cpu_shares?: number
  created_at?: string
  updated_at?: string
  deleted_at?: string | null
}

export interface Server {
  id: number
  uuid: string
  name: string
  description?: string
  ip?: string
  user?: string
  port?: number
  proxy_type?: 'traefik' | 'caddy' | 'none'
  settings?: ServerSetting
  created_at?: string
  updated_at?: string
}

export interface ServerSetting {
  id: number
  concurrent_builds?: number
  deployment_queue_limit?: number
  dynamic_timeout?: number
  force_disabled?: boolean
  force_server_cleanup?: boolean
  is_build_server?: boolean
  is_cloudflare_tunnel?: boolean
  is_jump_server?: boolean
  is_logdrain_axiom_enabled?: boolean
  is_logdrain_custom_enabled?: boolean
  is_logdrain_highlight_enabled?: boolean
  is_logdrain_newrelic_enabled?: boolean
  is_metrics_enabled?: boolean
  is_reachable?: boolean
  is_sentinel_enabled?: boolean
  is_swarm_manager?: boolean
  is_swarm_worker?: boolean
  is_terminal_enabled?: boolean
  is_usable?: boolean
  sentinel_metrics_history_days?: number
  sentinel_metrics_refresh_rate_seconds?: number
  docker_cleanup_frequency?: string
  docker_cleanup_threshold?: number
  server_id?: number
  wildcard_domain?: string
  created_at?: string
  updated_at?: string
  delete_unused_volumes?: boolean
  delete_unused_networks?: boolean
}

export interface EnvironmentVariable {
  id: number
  uuid: string
  resourceable_type?: string
  resourceable_id?: number
  is_literal?: boolean
  is_multiline?: boolean
  is_preview?: boolean
  is_runtime?: boolean
  is_buildtime?: boolean
  is_shared?: boolean
  is_shown_once?: boolean
  key: string
  value: string
  real_value?: string
  comment?: string | null
  version?: string
  created_at?: string
  updated_at?: string
}

export type Resource = Application | Service | Database

export type ResourceType = 'application' | 'service' | 'database'

export interface ApiError {
  message: string
}

export interface ValidationError {
  message: string
  errors?: Record<string, string[]>
}

export interface ConflictError {
  message: string
  warning?: string
  conflicts?: Array<{
    domain: string
    resource_name: string
    resource_uuid?: string | null
    resource_type: 'application' | 'service' | 'instance'
    message: string
  }>
}

export interface StartResponse {
  message: string
  deployment_uuid?: string
}

export interface StopResponse {
  message: string
}

export interface RestartResponse {
  message: string
  deployment_uuid?: string
}

export interface CreateResponse {
  uuid: string
}

export interface DeleteResponse {
  message: string
}
