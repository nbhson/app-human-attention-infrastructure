import type { ProvenanceEvent } from '../api/provenance';

/**
 * Relative timestamp for one event in the timeline: elapsed ms since the first
 * (earliest) event in the chain, so the causal ordering reads at a glance.
 */
function offsetMs(event: ProvenanceEvent, first: ProvenanceEvent): string {
  const delta = new Date(event.occurredAt).getTime() - new Date(first.occurredAt).getTime();
  return `${Math.max(0, delta)}ms`;
}

/**
 * Event timeline (day-26 §2.2) — renders `event_log` rows for a task's
 * correlation id, oldest first, each labelled by its offset from the first event.
 */
export function Timeline({ events }: { readonly events: readonly ProvenanceEvent[] }): JSX.Element {
  if (events.length === 0) {
    return <p>No events recorded.</p>;
  }
  const first = events[0] as ProvenanceEvent;

  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {events.map((event) => (
        <li
          key={event.eventId}
          style={{
            display: 'flex',
            gap: 12,
            padding: '6px 0',
            borderBottom: '1px solid var(--color-border)',
            fontSize: '0.85rem',
          }}
        >
          <span
            style={{
              color: 'var(--color-text-faint)',
              minWidth: 88,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            +{offsetMs(event, first)}
          </span>
          <code data-testid="event-type">{event.eventType}</code>
        </li>
      ))}
    </ol>
  );
}
