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
  git_full_url?: string | null
  build_pack?:
    | "nixpacks"
    | "railpack"
    | "static"
    | "dockerfile"
    | "dockercompose"
    | "dockerimage"
  ports_exposes?: string
  ports_mappings?: string | null
  base_directory?: string
  publish_directory?: string
  dockerfile?: string | null
  dockerfile_location?: string | null
  dockerfile_target_build?: string | null
  is_static?: boolean
  is_spa?: boolean
  source_id?: string | number | null
  private_key_id?: string | number | null
  static_image?: string
  install_command?: string
  build_command?: string
  start_command?: string
  custom_labels?: string | null
  custom_network_aliases?: string | null
  custom_docker_run_options?: string | null
  pre_deployment_command?: string | null
  post_deployment_command?: string | null
  pre_deployment_command_container?: string | null
  post_deployment_command_container?: string | null
  redirect?: string | null
  connect_to_docker_network?: boolean
  is_http_basic_auth_enabled?: boolean
  http_basic_auth_username?: string | null
  http_basic_auth_password?: string | null
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
  health_check_type?: "http" | "cmd"
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
  tags?: Tag[] | null
  environment_id?: number
  server_id?: number
  destination_type?: string
  destination_id?: number
  destination?: Destination
  /**
   * Only present on `GET /applications/{uuid}` — the list endpoint does not
   * return it (verified against coolify-openapi-v4.x.yaml).
   */
  settings?: ApplicationSetting
  created_at?: string
  updated_at?: string
  deleted_at?: string | null
}

/**
 * Application settings, embedded in the single-application detail response.
 * `is_preview_deployments_enabled` gates whether the Env Editor shows the
 * Preview section (see ADR-0008).
 */
export interface ApplicationSetting {
  id?: number
  is_static?: boolean
  is_git_submodules_enabled?: boolean
  is_git_lfs_enabled?: boolean
  is_auto_deploy_enabled?: boolean
  is_force_https_enabled?: boolean
  is_debug_enabled?: boolean
  is_preview_deployments_enabled?: boolean
  is_log_drain_enabled?: boolean
  is_gpu_enabled?: boolean
  application_id?: number
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
  destination?: Destination
  docker_compose_raw?: string
  docker_compose?: string
  service_type?: string
  connect_to_docker_network?: boolean
  is_container_label_escape_enabled?: boolean
  is_container_label_readonly_enabled?: boolean
  config_hash?: string
  tags?: Tag[] | null
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
  destination?: Destination
  limits_memory?: string
  limits_memory_swap?: string
  limits_memory_swappiness?: number
  limits_memory_reservation?: string
  limits_cpus?: string
  limits_cpuset?: string
  limits_cpu_shares?: number
  tags?: Tag[] | null
  created_at?: string
  updated_at?: string
  deleted_at?: string | null
}

export interface Destination {
  id: number
  uuid: string
  name: string
  network: string
  server_id: number
  server?: Server
}

export interface Server {
  id: number
  uuid: string
  name: string
  description?: string
  ip?: string
  user?: string
  port?: number
  proxy_type?: "traefik" | "caddy" | "none"
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

export interface GithubApp {
  id: number
  uuid: string
  name: string
  organization?: string | null
  api_url?: string
  html_url?: string
  custom_user?: string
  custom_port?: number
  app_id?: number
  installation_id?: number
  client_id?: string
  private_key_id?: number
  is_system_wide?: boolean
  is_public?: boolean
  team_id?: number
  type?: string
}

export interface Tag {
  uuid: string
  name: string
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
  /** Null for `is_shown_once` secrets: stored once and never exposed again. */
  real_value?: string | null
  comment?: string | null
  version?: string
  created_at?: string
  updated_at?: string
}

export type Resource = Application | Service | Database

export type ResourceType = "application" | "service" | "database"

export interface DeleteOptions {
  delete_volumes: boolean
  delete_configurations: boolean
  delete_connected_networks: boolean
  docker_cleanup: boolean
}

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
    resource_type: "application" | "service" | "instance"
    message: string
  }>
}

export interface StartResponse {
  message: string
  deployment_uuid?: string
}

/**
 * A deployment record — the only place Coolify says whether a deploy actually
 * worked. `status` is `queued | in_progress | finished | failed |
 * cancelled-by-user`; the container status in the resource listing says nothing
 * about it, since a failed build leaves the previous container running.
 */
export interface Deployment {
  deployment_uuid: string
  status: string
  application_name?: string
  commit?: string
  commit_message?: string
  logs?: string
  deployment_url?: string
  created_at?: string
  updated_at?: string
  finished_at?: string
}

/**
 * What `/deployments/applications/{uuid}` actually returns — an envelope, not
 * the bare array the spec documents. `count` is the full history size, while
 * `deployments` holds only the requested page, newest first.
 */
export interface DeploymentListResponse {
  count: number
  deployments: Deployment[]
}

export interface StopResponse {
  message: string
}

export interface RestartResponse {
  message: string
  deployment_uuid?: string
}

/**
 * Container output as a single blob. The API exposes no streaming, paging or
 * time range — the whole tail arrives at once and is replaced wholesale on
 * every refetch.
 */
export interface LogsResponse {
  logs: string
}

export interface CreateResponse {
  uuid: string
}

export interface DeleteResponse {
  message: string
}

export type DatabaseType =
  | "postgresql"
  | "mysql"
  | "mariadb"
  | "redis"
  | "keydb"
  | "dragonfly"
  | "clickhouse"
  | "mongodb"

export interface EnvVarCreate {
  key: string
  value: string
  is_preview?: boolean
  is_literal?: boolean
  is_multiline?: boolean
  is_shown_once?: boolean
}

/**
 * Payload for updating an env var (`PATCH /{type}/{uuid}/envs`). Same shape as
 * the create payload; `key` and `value` are required by Coolify, and the update
 * is routed by `key` (see ADR-0003).
 */
export type EnvVarUpdate = EnvVarCreate

export interface ApplicationCreateBase {
  project_uuid: string
  server_uuid: string
  environment_uuid: string
  name?: string
  description?: string
  domains?: string
  build_pack?:
    | "nixpacks"
    | "railpack"
    | "static"
    | "dockerfile"
    | "dockercompose"
  ports_exposes?: string
  ports_mappings?: string
  base_directory?: string
  publish_directory?: string
  is_static?: boolean
  is_spa?: boolean
  static_image?: string
  install_command?: string
  build_command?: string
  start_command?: string
  health_check_enabled?: boolean
  health_check_path?: string
  health_check_port?: string
  health_check_host?: string
  health_check_method?: string
  health_check_return_code?: number
  health_check_scheme?: string
  health_check_response_text?: string
  health_check_interval?: number
  health_check_timeout?: number
  health_check_retries?: number
  health_check_start_period?: number
  limits_memory?: string
  limits_memory_swap?: string
  limits_memory_swappiness?: number
  limits_memory_reservation?: string
  limits_cpus?: string
  limits_cpuset?: string
  limits_cpu_shares?: number
  custom_labels?: string
  custom_network_aliases?: string
  custom_docker_run_options?: string
  post_deployment_command?: string
  post_deployment_command_container?: string
  pre_deployment_command?: string
  pre_deployment_command_container?: string
  redirect?: string
  connect_to_docker_network?: boolean
  is_http_basic_auth_enabled?: boolean
  http_basic_auth_username?: string
  http_basic_auth_password?: string
  instant_deploy?: boolean
  [key: string]: unknown
}

export interface PrivateGithubAppCreate extends ApplicationCreateBase {
  github_app_uuid: string
  git_repository: string
  git_branch: string
}

export interface DockerfileAppCreate extends ApplicationCreateBase {
  dockerfile: string
  dockerfile_location?: string
}

export interface ServiceCreate {
  server_uuid: string
  project_uuid: string
  environment_uuid: string
  name?: string
  description?: string
  type?: string
  docker_compose_raw?: string
  instant_deploy?: boolean
}

export interface DatabaseCreate {
  server_uuid: string
  project_uuid: string
  environment_uuid: string
  name?: string
  description?: string
  image?: string
  is_public?: boolean
  public_port?: number
  public_port_timeout?: number
  limits_memory?: string
  limits_memory_swap?: string
  limits_memory_swappiness?: number
  limits_memory_reservation?: string
  limits_cpus?: string
  limits_cpuset?: string
  limits_cpu_shares?: number
  instant_deploy?: boolean
  [key: string]: unknown
}
