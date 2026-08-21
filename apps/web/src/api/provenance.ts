/**
 * Provenance API client (day-26 §2.2) — a read-only fetch of a task's seven
 * provenance sections from `GET /api/tasks/:id/provenance`.
 */

const BASE = '/api/tasks';

/** One event in the causal timeline; `occurredAt` is the ISO wall-clock time. */
export interface ProvenanceEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
}

/** The seven-section chain returned by the Day-17 read model. */
export interface ProvenanceChain {
  readonly task: { readonly id: string; readonly title: string; readonly state: string } | null;
  readonly agentRun: {
    readonly id: string;
    readonly status: string;
    readonly attemptNumber: number;
  } | null;
  readonly llmCalls: readonly { readonly id: string; readonly model: string }[];
  readonly trajectory: readonly {
    readonly id: string;
    readonly stepNumber: number;
    readonly toolName: string | null;
  }[];
  readonly artifacts: readonly {
    readonly id: string;
    readonly filePath: string;
    readonly contentHash: string;
  }[];
  readonly verification: {
    readonly reports: readonly { readonly id: string; readonly overall: string }[];
    readonly checkResults: readonly {
      readonly id: string;
      readonly checkKind: string;
      readonly status: string;
    }[];
    readonly evidenceIds: readonly string[];
  };
  readonly events: readonly ProvenanceEvent[];
}

async function json<T>(res: Promise<Response>): Promise<T> {
  const response = await res;
  const body = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `request failed (${response.status})`);
  }
  return body as T;
}

export const provenanceApi = {
  getChain(taskId: string): Promise<ProvenanceChain> {
    return json<ProvenanceChain>(fetch(`${BASE}/${taskId}/provenance`));
  },
};
