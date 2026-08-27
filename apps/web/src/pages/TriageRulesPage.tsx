import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { triageRulesApi, TriageRulesError, type TriageRuleState } from '../api/triageRules';
import { ShieldAlert, Sliders, Zap } from '../components/Icons';

/**
 * Triage Rules — the live control plane for the three wired rules. Each rule
 * maps to one boolean on the `triage_rules` singleton row, read and written
 * through `GET/PUT /api/triage-rules` (optimistic toggle).
 */

interface Rule {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly strictness: string;
  readonly icon: typeof ShieldAlert;
  /** Which backend toggle this rule maps to. */
  readonly stateKey: keyof TriageRuleState;
}

const RULES: readonly Rule[] = [
  {
    name: 'Critical security findings',
    description:
      'Any CRITICAL finding in auth, secrets, or injection paths blocks approval until a human reviews it.',
    category: 'Security',
    strictness: 'High strict',
    icon: ShieldAlert,
    stateKey: 'securityBlock',
  },
  {
    name: 'High-risk performance regressions',
    description: 'Findings on hot-path changes that the shadow judge flags as a likely regression.',
    category: 'Performance',
    strictness: 'Medium strict',
    icon: Zap,
    stateKey: 'performanceRegression',
  },
  {
    name: 'Schema & data integrity',
    description: 'Migrations and data-shape changes require an explicit APPROVE before write-back.',
    category: 'Database',
    strictness: 'High strict',
    icon: Sliders,
    stateKey: 'schemaIntegrity',
  },
];

const FALLBACK_STATE: TriageRuleState = {
  securityBlock: true,
  performanceRegression: true,
  schemaIntegrity: true,
};

export default function TriageRulesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState<string | null>(null);

  const {
    data: state = FALLBACK_STATE,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['triageRules'],
    queryFn: () => triageRulesApi.get(),
  });

  const mutation = useMutation({
    mutationFn: (patch: Partial<TriageRuleState>) => triageRulesApi.update(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ['triageRules'] });
      const previous = queryClient.getQueryData<TriageRuleState>(['triageRules']);
      queryClient.setQueryData<TriageRuleState>(['triageRules'], (old) => ({
        ...(old ?? FALLBACK_STATE),
        ...patch,
      }));
      setSaveError(null);
      return { previous };
    },
    onError: (error: unknown, _patch, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['triageRules'], context.previous);
      }
      setSaveError(
        error instanceof TriageRulesError || error instanceof Error
          ? error.message
          : 'Failed to update the rule',
      );
    },
  });

  const toggle = (ruleKey: keyof TriageRuleState): void => {
    mutation.mutate({ [ruleKey]: !state[ruleKey] } as Partial<TriageRuleState>);
  };

  const renderRule = (rule: Rule, checked: boolean): JSX.Element => {
    const Icon = rule.icon;
    return (
      <div className="rq-rule" key={rule.name}>
        <div className="rq-rule-left">
          <span className="rq-rule-icon">
            <Icon />
          </span>
          <div className="rq-rule-body">
            <div className="rq-rule-head">
              <span className="rq-rule-name">{rule.name}</span>
              <span className="rq-rule-cat">{rule.category}</span>
              <span className="rq-rule-strict">{rule.strictness}</span>
            </div>
            <p className="rq-rule-desc">{rule.description}</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={`Toggle ${rule.name}`}
          className={`rq-toggle ${checked ? 'rq-toggle--on' : 'rq-toggle--off'}`}
          onClick={() => toggle(rule.stateKey)}
        >
          <span className="rq-toggle-knob" />
        </button>
      </div>
    );
  };

  return (
    <div className="rq-content">
      <div className="rq-rules">
        <div className="rq-rules-header">
          <h1 className="rq-rules-title">
            <Sliders /> AI Triage &amp; Decision Rules
          </h1>
          <p className="rq-rules-sub">
            {isError
              ? "Couldn't load the triage rules — toggles are showing defaults and may not persist."
              : 'The security, performance, and schema rules are live and persist to the backend.'}
          </p>
          {saveError !== null && (
            <p className="rq-rules-sub" role="alert" style={{ color: 'var(--color-danger)' }}>
              {saveError}
            </p>
          )}
        </div>

        {isLoading ? (
          <p style={{ color: 'var(--color-text-muted)', padding: '16px 0' }}>
            Loading triage rules…
          </p>
        ) : (
          <div className="rq-rules-list">
            {RULES.map((rule) => renderRule(rule, state[rule.stateKey]))}
          </div>
        )}
      </div>
    </div>
  );
}
