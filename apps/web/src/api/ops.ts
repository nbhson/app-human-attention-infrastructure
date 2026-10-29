/**
 * Ops + learning API client — thin typed wrapper over the read-only
 * operator endpoints (`GET /api/ops/*`, `GET /api/learning/cycles`).
 * The database is the dashboard: these are lightweight projections,
 * polled by the Ops page.
 */

import { getJson } from './http';

export interface OpsHealth {
  readonly ok: boolean;
  readonly now: string;
}

export interface OpsMetrics {
  readonly tasksByState: Record<string, number>;
  readonly reviewQueueDepth: number;
  readonly orphanedTasks: number;
}

/** Component checks from the readiness probe (`GET /api/ops/ready`). */
export interface OpsReadiness {
  readonly ok: boolean;
  readonly checks: { readonly db: boolean };
  readonly now: string;
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

export const opsApi = {
  health(): Promise<OpsHealth> {
    return getJson<OpsHealth>('/api/ops/health');
  },
  ready(): Promise<OpsReadiness> {
    return getJson<OpsReadiness>('/api/ops/ready');
  },
  metrics(): Promise<OpsMetrics> {
    return getJson<OpsMetrics>('/api/ops/metrics');
  },
  cycles(limit = 20): Promise<{ cycles: readonly LearningCycle[] }> {
    return getJson<{ cycles: readonly LearningCycle[] }>(`/api/learning/cycles?limit=${limit}`);
  },
};
