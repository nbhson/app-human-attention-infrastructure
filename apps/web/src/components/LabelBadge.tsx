/** Label → badge colour (day-23 §2.2). */
const LABEL_COLORS: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH: '#ea580c',
  MEDIUM: '#ca8a04',
  LOW: '#6b7280',
};

export function LabelBadge({ label }: { readonly label: string }): JSX.Element {
  return (
    <span
      style={{
        backgroundColor: LABEL_COLORS[label] ?? '#6b7280',
        color: '#ffffff',
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
