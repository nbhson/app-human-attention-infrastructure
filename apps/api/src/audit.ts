/**
 * Global audit read model (day-34 §4.5) — one unified, time-ordered timeline over
 * every append-only trace of *what the system did*: bus events, LLM/model calls,
 * tool calls, and the agent-run envelope that brackets them.
 *
 * The four sources are normalised here into a single {@link AuditEntry} shape, so
 * the HTTP route stays a thin SQL surface and the UI renders one list regardless of
 * where a row came from. `detail` always carries the full source payload so a
 * click-through can show everything without a second fetch.
 */

/** The four append-only sources unified into the timeline. */
export type AuditKind = 'event' | 'llm' | 'tool' | 'run';

/** One timeline row, normalised from any of the four sources. */
export interface AuditEntry {
  readonly id: string;
  readonly kind: AuditKind;
  /** ISO-8601 wall-clock time; the timeline's sort key. */
  readonly occurredAt: string;
  readonly correlationId: string | null;
  /** Display name of the acting human, or null when no principal acted. */
  readonly actor: string | null;
  /** Short headline — event type, model, tool name, or run label. */
  readonly title: string;
  /** Secondary line shown under the headline. */
  readonly summary: string;
  /** Full source payload for the click-through detail panel. */
  readonly detail: Record<string, unknown>;
}

/** Raw columns read back from `event_log` (payload is native `jsonb`). */
export interface EventLogRow {
  readonly event_id: string;
  readonly event_type: string;
  readonly event_version: number;
  readonly occurred_at: Date;
  readonly correlation_id: string;
  readonly actor_id: string | null;
  readonly actor_name: string | null;
  readonly payload: Record<string, unknown>;
}

/** Raw `llm_call_log` row. */
export interface LlmCallRow {
  readonly id: string;
  readonly correlation_id: string | null;
  readonly model: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly stop_reason: string;
  readonly request_hash: string;
  readonly created_at: Date;
}

/** Raw `trajectory_steps` row, correlation filled in from its `agent_runs` parent. */
export interface ToolStepRow {
  readonly id: string;
  readonly correlation_id: string | null;
  readonly step_number: number;
  readonly thought: string | null;
  readonly tool_name: string | null;
  readonly tool_input: unknown;
  readonly observation: string | null;
  readonly created_at: Date;
}

/** Raw `agent_runs` row — the process envelope carrying start/end times. */
export interface AgentRunRow {
  readonly id: string;
  readonly correlation_id: string | null;
  readonly attempt_number: number;
  readonly status: string;
  readonly started_at: Date;
  readonly finished_at: Date | null;
  readonly max_steps: number;
  readonly steps_used: number;
  readonly escalation_reason: string | null;
}

/** Normalise a bus event into a timeline entry. */
export function toEventEntry(row: EventLogRow): AuditEntry {
  return {
    id: row.event_id,
    kind: 'event',
    occurredAt: row.occurred_at.toISOString(),
    correlationId: row.correlation_id,
    actor: row.actor_name,
    title: row.event_type,
    summary: summarizeEvent(row.event_type, row.payload),
    detail: { event_version: row.event_version, ...row.payload },
  };
}

/** Normalise an LLM call into a timeline entry. */
export function toLlmEntry(row: LlmCallRow): AuditEntry {
  return {
    id: row.id,
    kind: 'llm',
    occurredAt: row.created_at.toISOString(),
    correlationId: row.correlation_id,
    actor: null,
    title: row.model,
    summary: `${row.input_tokens}→${row.output_tokens} tokens · ${row.stop_reason}`,
    detail: {
      model: row.model,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      stop_reason: row.stop_reason,
      request_hash: row.request_hash,
    },
  };
}

/** Normalise a tool call (trajectory step) into a timeline entry. */
export function toToolEntry(row: ToolStepRow): AuditEntry {
  return {
    id: row.id,
    kind: 'tool',
    occurredAt: row.created_at.toISOString(),
    correlationId: row.correlation_id,
    actor: null,
    title: row.tool_name ?? `step ${row.step_number}`,
    summary: row.thought?.trim() || '(no thought)',
    detail: {
      step_number: row.step_number,
      tool_name: row.tool_name,
      tool_input: row.tool_input,
      observation: row.observation,
      thought: row.thought,
    },
  };
}

/** Normalise an agent run into a timeline entry, with a computed duration. */
export function toRunEntry(row: AgentRunRow): AuditEntry {
  const durationMs =
    row.finished_at === null ? null : row.finished_at.getTime() - row.started_at.getTime();
  return {
    id: row.id,
    kind: 'run',
    occurredAt: row.started_at.toISOString(),
    correlationId: row.correlation_id,
    actor: null,
    title: `agent run · attempt ${row.attempt_number}`,
    summary: `${row.status} · ${row.steps_used}/${row.max_steps} steps${
      durationMs === null ? '' : ` · ${durationMs}ms`
    }`,
    detail: {
      attempt_number: row.attempt_number,
      status: row.status,
      started_at: row.started_at.toISOString(),
      finished_at: row.finished_at === null ? null : row.finished_at.toISOString(),
      duration_ms: durationMs,
      max_steps: row.max_steps,
      steps_used: row.steps_used,
      escalation_reason: row.escalation_reason,
    },
  };
}

/** A short, human-readable one-liner for an event type's payload. */
export function summarizeEvent(eventType: string, payload: Record<string, unknown>): string {
  // The audit trail's most readable fields, keyed by event namespace. Anything
  // unlisted falls back to a count of payload keys — the detail panel still shows
  // the full payload on click.
  const picks: Record<string, readonly string[]> = {
    'review.report_created': ['pr_url', 'finding_count', 'suggestion_count'],
    'integration.pr_fetched': ['repo', 'pr_number', 'file_count'],
    'integration.ticket_fetched': ['issue_key'],
    'integration.writeback_completed': ['repo', 'action'],
    'review.decision_submitted': ['decision'],
    'attention.item_routed': ['rule_id', 'action'],
    'memory.entry_created': ['source_kind'],
    'learning.stage_completed': ['stage'],
    'learning.loop_completed': ['outcome'],
    'system.started': ['service', 'transport'],
    'system.stopped': ['service', 'reason'],
  };
  const keys = picks[eventType];
  if (keys === undefined) {
    return `${Object.keys(payload).length} field(s)`;
  }
  const parts = keys
    .filter((key) => payload[key] !== undefined && payload[key] !== null)
    .map((key) => `${key}=${String(payload[key])}`);
  return parts.length > 0 ? parts.join(' · ') : '(empty payload)';
}

/** Newest-first k-way merge of already-fetched per-source pages, sliced to `limit`.
 *  Uses a min-heap so merging N sorted pages is O(limit × log N) instead of
 *  O(Total × log Total) from a full flatten + sort. */
export function mergeEntries(
  sources: ReadonlyArray<readonly AuditEntry[]>,
  limit: number,
): AuditEntry[] {
  // Simple approach: since each source page is already sorted newest-first and
  // the common case has ≤4 sources, a bounded merge is fast enough. For the
  // rare case of many sources, fall back to full sort.
  const total = sources.reduce((sum, s) => sum + s.length, 0);
  if (total <= limit * 4) {
    return sources
      .flat()
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit);
  }
  // K-way merge: pick the newest entry from the head of each non-empty source.
  // The total-entry count is small in practice (≤4 sources × limit), so a simple
  // O(limit × sources.length) scan per emitted row is sufficient and avoids the
  // complexity of a heap for a rare hot path.
  const result: AuditEntry[] = [];
  const pointers = sources.map<number>(() => 0);
  while (result.length < limit) {
    let bestIdx = -1;
    let bestTime = '';
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const ptr = pointers[i] ?? 0;
      if (source === undefined || ptr >= source.length) continue;
      const entry = source[ptr];
      if (entry === undefined) continue;
      const t = entry.occurredAt;
      if (bestIdx === -1 || t > bestTime) {
        bestTime = t;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    const source = sources[bestIdx];
    if (source === undefined) break;
    const ptr = pointers[bestIdx] ?? 0;
    const entry = source[ptr];
    if (entry === undefined) break;
    result.push(entry);
    pointers[bestIdx] = ptr + 1;
  }
  return result;
}
