/** Label → badge colour (day-23 §2.2). Colours are theme tokens, not raw hex. */
const LABEL_COLORS: Record<string, string> = {
  CRITICAL: 'var(--prio-critical)',
  HIGH: 'var(--prio-high)',
  MEDIUM: 'var(--prio-medium)',
  LOW: 'var(--prio-low)',
};

export function LabelBadge({ label }: { readonly label: string }): JSX.Element {
  return (
    <span
      style={{
        backgroundColor: LABEL_COLORS[label] ?? 'var(--prio-low)',
        color: 'var(--color-on-accent)',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
