/**
 * Audit API client (day-34 §4.5) — a read-only fetch of the global, unified
 * timeline from `GET /api/audit`, one entry per thing the system did.
 */

const BASE = '/api/audit';

/** The four append-only sources unified into the timeline. */
export type AuditKind = 'event' | 'llm' | 'tool' | 'run';

/** One timeline row from the server. */
export interface AuditEntry {
  readonly id: string;
  readonly kind: AuditKind;
  readonly occurredAt: string;
  readonly correlationId: string | null;
  readonly actor: string | null;
  readonly title: string;
  readonly summary: string;
  readonly detail: Record<string, unknown>;
}

/** A page of the timeline; `nextBefore` is the cursor for older rows. */
export interface AuditPage {
  readonly items: readonly AuditEntry[];
  readonly nextBefore: string | null;
}

export interface AuditFilters {
  readonly kind?: AuditKind;
  readonly eventType?: string;
  readonly correlationId?: string;
  readonly limit?: number;
  readonly before?: string;
}

async function json<T>(res: Promise<Response>): Promise<T> {
  const response = await res;
  const body = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `request failed (${response.status})`);
  }
  return body as T;
}

export const auditApi = {
  list(filters: AuditFilters): Promise<AuditPage> {
    const params = new URLSearchParams();
    if (filters.kind !== undefined) params.set('kind', filters.kind);
    if (filters.eventType !== undefined) params.set('eventType', filters.eventType);
    if (filters.correlationId !== undefined) params.set('correlationId', filters.correlationId);
    if (filters.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters.before !== undefined) params.set('before', filters.before);
    const qs = params.toString();
    return json<AuditPage>(fetch(`${BASE}${qs.length > 0 ? `?${qs}` : ''}`));
  },
};
