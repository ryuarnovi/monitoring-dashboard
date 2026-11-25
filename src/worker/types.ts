export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Latency (ms) above which a reachable target is marked "degraded". Default 1000. */
  LATENCY_DEGRADED_THRESHOLD_MS?: string;
  /** Days of raw health-check history to keep. Default 31. */
  RETENTION_DAYS?: string;
  /** Cloudflare Zero Trust team domain, e.g. "myteam.cloudflareaccess.com". */
  CF_ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag of the Access application. */
  CF_ACCESS_AUD?: string;
  /** Set to "true" ONLY for temporary testing without Cloudflare Access. */
  ALLOW_UNAUTHENTICATED?: string;
}
