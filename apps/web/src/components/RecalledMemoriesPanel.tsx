import type { RecalledMemory } from '../api/reviews';

function MemoryKindBadge({ kind }: { readonly kind: string }): JSX.Element {
  const colors: Record<string, { bg: string; text: string }> = {
    REVIEW: { bg: 'var(--color-info-bg)', text: 'var(--color-info)' },
    FINDING: { bg: 'var(--color-warning-bg)', text: 'var(--color-warning)' },
    DECISION: { bg: 'var(--color-success-bg)', text: 'var(--color-success)' },
    PROJECT: { bg: 'var(--color-purple-bg)', text: 'var(--color-purple)' },
  };
  const style = colors[kind] ?? { bg: 'var(--color-bg)', text: 'var(--color-text-muted)' };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '0.65rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.02em',
        background: style.bg,
        color: style.text,
      }}
    >
      {kind}
    </span>
  );
}

function ConfidenceBar({ confidence }: { readonly confidence: number }): JSX.Element {
  const pct = Math.min(100, Math.max(0, confidence));
  const color = pct >= 80 ? 'var(--color-success)' : pct >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--color-bg)', overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 2,
            background: color,
            transition: 'width 0.3s ease-out',
          }}
        />
      </div>
      <span style={{ fontSize: '0.7rem', fontWeight: 600, color, minWidth: 36, fontVariantNumeric: 'tabular-nums' }}>
        {pct}%
      </span>
    </div>
  );
}

export function RecalledMemoriesPanel({ memories }: { readonly memories: readonly RecalledMemory[] }): JSX.Element {
  if (memories.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--color-text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
        No past review context was recalled for this PR.
      </div>
    );
  }

  return (
    <section style={{ marginTop: 16 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', fontWeight: 600 }}>
        Recalled Context ({memories.length} {memories.length === 1 ? 'entry' : 'entries'})
      </h3>
      <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
        These are relevant past reviews, findings, decisions, and project context retrieved from memory to inform this
        review. Relevance scores indicate semantic similarity to the current PR.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {memories.map((memory, index) => (
          <div
            key={index}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              padding: '12px 16px',
              background: 'var(--color-surface)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <MemoryKindBadge kind={memory.kind} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <ConfidenceBar confidence={memory.confidence} />
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                Relevance: {Math.round(memory.relevance * 100)}%
              </div>
            </div>
            <p style={{ margin: '0 0 8px', fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--color-text)' }}>
              {memory.content}
            </p>
            {Object.keys(memory.metadata).length > 0 && (
              <details style={{ fontSize: '0.7rem', color: 'var(--color-text-faint)' }}>
                <summary style={{ cursor: 'pointer', marginBottom: 4 }}>Metadata</summary>
                <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {JSON.stringify(memory.metadata, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
