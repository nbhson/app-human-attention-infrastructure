/**
 * Ops + learning API client — thin typed wrapper over the read-only
 * operator endpoints (`GET /api/ops/*`, `GET /api/learning/cycles`).
 * The database is the dashboard: these are lightweight projections,
 * polled by the Ops page.
 */

export interface OpsHealth {
  readonly ok: boolean;
  readonly now: string;
}

export interface OpsMetrics {
  readonly tasksByState: Record<string, number>;
  readonly reviewQueueDepth: number;
  readonly orphanedTasks: number;
}

export interface LearningCycle {
  readonly cycle_id: string;
  readonly outcome: string;
  readonly promoted: boolean;
  readonly candidate_proposed: boolean;
  readonly sample_count: number;
  readonly next_since: string | null;
  readonly occurred_at: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const opsApi = {
  health(): Promise<OpsHealth> {
    return get<OpsHealth>('/api/ops/health');
  },
  metrics(): Promise<OpsMetrics> {
    return get<OpsMetrics>('/api/ops/metrics');
  },
  cycles(limit = 20): Promise<{ cycles: readonly LearningCycle[] }> {
    return get<{ cycles: readonly LearningCycle[] }>(`/api/learning/cycles?limit=${limit}`);
  },
};
