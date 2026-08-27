import type { AuditKind } from '../api/audit';

/**
 * Shared presentation helpers for the System Activity surfaces (full page +
 * right-hand telemetry panel). Both render the same four audit kinds and derive
 * the same "repo" and "time ago" fields, so the mapping lives here once.
 */

export const KIND_LABEL: Record<AuditKind, string> = {
  event: 'Event',
  llm: 'LLM',
  tool: 'Tool',
  run: 'Run',
};

/** CSS tone suffix for the per-kind badge colour (mirrors `.sa-log-type--*`). */
export function kindClass(kind: AuditKind): string {
  return `sa-log-type--${kind}`;
}

/** The badge/filter order used by both filter bars. */
export const KIND_FILTERS: readonly AuditKind[] = ['event', 'llm', 'tool', 'run'];

/** A short "N m/h/d ago" label for an ISO timestamp. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const minutes = Math.floor(secs / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The repo an entry concerns, when its payload carries one (integration events
 * record `repo`); GitHub's `github.com/` prefix is stripped for compactness.
 * Returns null when the entry has no repo — nothing is invented.
 */
export function repoFromEntry(detail: Record<string, unknown>): string | null {
  const raw = detail.repo;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw.replace(/^github\.com\//, '');
}
