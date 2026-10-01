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
  readonly stateKey: 'securityBlock' | 'performanceRegression' | 'schemaIntegrity' | 'autoReviewEnabled';
}

const RULES: readonly Rule[] = [
  {
    name: 'Critical security findings',
    description: 'Any CRITICAL finding in auth, secrets, or injection paths blocks approval until a human reviews it.',
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
  {
    name: 'Auto-review mode',
    description:
      'When enabled, the AI review agent returns ALL findings (including MINOR, NIT, INFO) — covering naming, style, architecture, and maintainability. When disabled (default), only high-signal findings (CRITICAL/MAJOR) are shown.',
    category: 'Review Mode',
    strictness: 'All severities',
    icon: Zap,
    stateKey: 'autoReviewEnabled',
  },
];

const FALLBACK_STATE: TriageRuleState = {
  securityBlock: true,
  performanceRegression: true,
  schemaIntegrity: true,
  autoReviewEnabled: false,
  includeInstructions: false,
  instructionsContent: '',
  reasoningEffort: 'default',
};

/** Clear an uploaded `.md` file's text content from a FileReader. */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Failed to read the file'));
    reader.readAsText(file);
  });
}

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
        error instanceof TriageRulesError || error instanceof Error ? error.message : 'Failed to update the rule',
      );
    },
  });

  const toggle = (
    ruleKey:
      'securityBlock' | 'performanceRegression' | 'schemaIntegrity' | 'autoReviewEnabled' | 'includeInstructions',
  ): void => {
    mutation.mutate({ [ruleKey]: !state[ruleKey] } as Partial<TriageRuleState>);
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const content = await readFileAsText(file);
      mutation.mutate({ instructionsContent: content });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to read the file');
    }
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
          <p style={{ color: 'var(--color-text-muted)', padding: '16px 0' }}>Loading triage rules…</p>
        ) : (
          <div className="rq-rules-list">{RULES.map((rule) => renderRule(rule, state[rule.stateKey]))}</div>
        )}

        {!isLoading && (
          <div
            className="rq-rule"
            style={{
              marginTop: '18px',
              flexDirection: 'column',
              alignItems: 'stretch',
              justifyContent: 'flex-start',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', width: '100%' }}>
              <span className="rq-rule-icon" style={{ marginTop: '2px' }}>
                <Zap />
              </span>
              <div style={{ flex: '1 1 auto', minWidth: '0' }}>
                <div className="rq-rule-head">
                  <span className="rq-rule-name">Model thinking (reasoning effort)</span>
                  <span className="rq-rule-cat">Model</span>
                </div>
                <p className="rq-rule-desc">
                  Caps how much a thinking model may reason before answering — its chain-of-thought shares the same
                  output budget as the review JSON, so unbounded thinking is what truncates large reviews. Applies to
                  every review from here on (in-flight reviews keep their old setting). Best-effort: some model/server
                  pairs ignore this on the OpenAI-compatible endpoint — if truncation persists, switch AI_MODEL to a
                  non-thinking model instead.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%', marginTop: '10px' }}>
              <label htmlFor="reasoning-effort" style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>
                Reasoning effort
              </label>
              <select
                id="reasoning-effort"
                aria-label="Model thinking budget"
                value={state.reasoningEffort ?? 'default'}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'low' || value === 'off' || value === 'default') {
                    mutation.mutate({ reasoningEffort: value });
                  }
                }}
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface-input)',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                }}
              >
                <option value="default">Default — model decides</option>
                <option value="low">Low — cap the thinking trace</option>
                <option value="off">Off — ask for no thinking</option>
              </select>
            </div>
          </div>
        )}

        {!isLoading && (
          <div
            className="rq-rule rq-instructions"
            style={{
              marginTop: '18px',
              flexDirection: 'column',
              alignItems: 'stretch',
              justifyContent: 'flex-start',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                width: '100%',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', minWidth: '0', flex: '1 1 auto' }}>
                <span className="rq-rule-icon" style={{ marginTop: '2px' }}>
                  <Sliders />
                </span>
                <div style={{ flex: '1 1 auto', minWidth: '0' }}>
                  <div className="rq-rule-head">
                    <span className="rq-rule-name">Review instructions (text.md)</span>
                    <span className="rq-rule-cat">PR + Jira + text.md + AI</span>
                  </div>
                  <p className="rq-rule-desc">
                    Upload a markdown skills/instructions file and enable the PR + Jira + text.md + AI flow.{' '}
                    {state.includeInstructions
                      ? 'Instructions are ON — this file is injected into every AI review prompt.'
                      : 'Toggle ON to inject this file into AI reviews alongside the PR diff and Jira requirement.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={state.includeInstructions}
                aria-label="Toggle Review instructions (text.md)"
                className={`rq-toggle ${state.includeInstructions ? 'rq-toggle--on' : 'rq-toggle--off'}`}
                onClick={() => toggle('includeInstructions')}
              >
                <span className="rq-toggle-knob" />
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%', marginTop: '10px' }}>
              <label
                className="rq-toggle-upload"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface-input)',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                  fontSize: '14px',
                  whiteSpace: 'nowrap',
                }}
              >
                Choose .md file
                <input type="file" accept=".md,.markdown,text/markdown" hidden onChange={handleFile} />
              </label>
              {state.instructionsContent.trim().length > 0 && (
                <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>
                  {state.instructionsContent.trim().split('\n').length} line(s),{' '}
                  {state.instructionsContent.length.toLocaleString()} chars
                </span>
              )}
            </div>

            <textarea
              aria-label="Review instructions (text.md)"
              value={state.instructionsContent}
              onChange={(event) => mutation.mutate({ instructionsContent: event.target.value })}
              placeholder="Paste your markdown skills / instructions here, or upload a .md file…"
              rows={10}
              style={{
                width: '100%',
                marginTop: '10px',
                padding: '10px',
                borderRadius: '8px',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface-input)',
                color: 'var(--color-text)',
                fontFamily: 'monospace',
                fontSize: '13px',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
