/**
 * Shared in-process rate-limit buckets — the single source of truth.
 *
 * Single-process only: multi-replica deployments must front with Redis/nginx
 * (see docs/deploy.md). Keys are client IPs as seen by Fastify (`request.ip`);
 * behind a proxy set `trustProxy: true` so `request.ip` reflects
 * `X-Forwarded-For` instead of the proxy address.
 */

const WINDOW_MS = 60_000;
const buckets = new Map<string, Map<string, { count: number; resetAt: number }>>();

function check(bucket: string, ip: string, limitPerMin: number): boolean {
  let table = buckets.get(bucket);
  if (!table) {
    table = new Map();
    buckets.set(bucket, table);
  }
  const now = Date.now();
  const entry = table.get(ip);
  if (entry === undefined || now > entry.resetAt) {
    table.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= limitPerMin;
}

/** AI-backed ingest bucket (10 req/min) — protects provider quota. */
export function checkReviewRateLimit(ip: string, limitPerMin = 10): boolean {
  return check('review-ingest', ip, limitPerMin);
}

/** Abuse-sensitive writes: login / decide / retry (30 req/min). */
export function checkSensitiveRateLimit(ip: string, limitPerMin = 30): boolean {
  return check('sensitive', ip, limitPerMin);
}

export function pruneRateLimits(): void {
  const now = Date.now();
  for (const table of buckets.values()) {
    for (const [ip, entry] of table) {
      if (now > entry.resetAt) table.delete(ip);
    }
  }
}

/** Test-only: reset all buckets between cases. */
export function clearRateLimits(): void {
  buckets.clear();
}
