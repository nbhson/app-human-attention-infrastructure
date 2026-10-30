import type { TriageRuleId } from '../../api/reviews';
import { ShieldAlert, Sliders, Zap } from '../Icons';

/** Per-rule copy for the triage banner; `{verdict}` is filled with the raw AI verdict. */
const TRIAGE_META: Record<TriageRuleId, { icon: typeof ShieldAlert; color: string; message: string }> = {
  'security-block': {
    icon: ShieldAlert,
    color: 'var(--color-danger)',
    message:
      'Security rule fired — a CRITICAL finding in an auth/secrets path downgrades the ' +
      'recommendation to Request changes (the AI’s own verdict was {verdict}).',
  },
  'performance-regression': {
    icon: Zap,
    color: 'var(--color-warning)',
    message:
      'Performance rule fired — possible regression risk: MAJOR+ findings in production code ' +
      'with a low-confidence shadow-judge run.',
  },
  'schema-integrity': {
    icon: Sliders,
    color: 'var(--color-info)',
    message:
      'Schema rule fired — this PR touches migration/schema files; write-back will post only on ' +
      'an explicit APPROVE.',
  },
};

interface TriageBannerProps {
  rules: readonly TriageRuleId[];
  /** The raw AI verdict, substituted into rule copy where `{verdict}` appears. */
  verdict: string;
}

/** Triage rule flags, if any fired. */
export function TriageBanner({ rules, verdict }: TriageBannerProps): JSX.Element | null {
  if (rules.length === 0) {
    return null;
  }
  return (
    <section
      role="note"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        margin: '0 0 12px',
        padding: '10px 14px',
        borderRadius: 10,
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
      }}
    >
      {rules.map((rule) => {
        const meta = TRIAGE_META[rule];
        const Icon = meta.icon;
        return (
          <div
            key={rule}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              color: 'var(--color-text-muted)',
              fontSize: '0.82rem',
              lineHeight: 1.4,
            }}
          >
            <span style={{ color: meta.color, display: 'inline-flex', marginTop: 1 }}>
              <Icon size={15} />
            </span>
            <span>{meta.message.replace('{verdict}', verdict)}</span>
          </div>
        );
      })}
    </section>
  );
}
