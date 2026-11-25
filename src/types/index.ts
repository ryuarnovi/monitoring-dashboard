export type TargetStatus = 'online' | 'degraded' | 'offline';
/** "unknown" = no probe has been recorded yet. */
export type DisplayStatus = TargetStatus | 'unknown';

export interface Target {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  path: string;
  expected_status?: number;
  timeout_ms: number;
  is_active: number; // 1 or 0
  created_at: string;
  updated_at: string;
  // Computed runtime fields (null = no data yet, never a made-up value)
  current_status?: DisplayStatus;
  last_checked_at?: string | null;
  last_status_code?: number | null;
  last_latency_ms?: number | null;
  last_colo?: string | null;
  last_error?: string | null;
  uptime_24h?: number | null;
  uptime_7d?: number | null;
  uptime_30d?: number | null;
  avg_latency_24h?: number | null;
  min_latency_24h?: number | null;
  max_latency_24h?: number | null;
  checks_24h?: number;
}

export interface HealthCheckRecord {
  id: string;
  target_id: string;
  timestamp: string;
  status: TargetStatus;
  status_code: number | null;
  response_time_ms: number | null;
  colo: string | null;
  error_message: string | null;
}

export interface Incident {
  id: string;
  target_id: string;
  target_name?: string;
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  cause: string;
  status: 'ongoing' | 'resolved';
}

export interface LatencyPoint {
  timestamp: string;
  latency_ms: number | null;
  status: TargetStatus;
  status_code: number | null;
  colo?: string | null;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total_records: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface SystemSettings {
  app_title: string;
  latency_threshold_ms: number;
  github_url: string;
  is_setup_required: boolean;
  login_rate_limit_max: number;
  login_rate_limit_window: number;
  probe_rate_limit_max: number;
  api_rate_limit_max: number;
  max_targets: number;
  retention_days: number;
  custom_user_agent: string;
}

export interface DashboardOverview {
  total_targets: number;
  online_count: number;
  degraded_count: number;
  offline_count: number;
  unknown_count: number;
  overall_uptime_24h: number | null;
  avg_latency_ms: number | null;
  edge_location: {
    colo: string;
    country: string;
    city?: string;
  };
  last_scan_time: string | null;
  access_user?: string | null;
  auth_method?: string;
  latency_threshold_ms: number;
  app_title?: string;
}

export interface ProbeResult {
  target_id: string;
  url: string;
  status: TargetStatus;
  status_code: number | null;
  response_time_ms: number | null;
  colo: string;
  error_message: string | null;
  probe_method: 'fetch' | 'tcp';
}
