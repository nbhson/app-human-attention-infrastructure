import { describe, expect, it } from 'vitest';
import { formatRejectWritebackBody } from '../format-review-writeback.js';

describe('formatRejectWritebackBody', () => {
  it('formats full markdown with reviewer rationale, summary, findings and suggestions', () => {
    const markdown = formatRejectWritebackBody({
      decision: 'REJECT',
      rationale: 'Security concerns in auth flow',
      userComment: 'Please fix all critical issues before requesting re-review.',
      summary: 'The PR introduces a major vulnerability in auth token validation.',
      findings: [
        {
          severity: 'CRITICAL',
          file: 'src/auth.ts',
          line: 42,
          message: 'Hardcoded secret token in auth header check',
          suggestion: 'Read secret from environment variable',
          kind: 'correctness',
        },
        {
          severity: 'MAJOR',
          file: 'src/config.ts',
          line: 10,
          message: 'Missing fallback when JWT_SECRET is unset',
          suggestion: undefined,
          kind: 'correctness',
        },
      ],
      suggestions: [
        {
          file: 'src/auth.ts',
          hunk: '@@ -40,3 +40,3 @@\n- const secret = "default";\n+ const secret = process.env.SECRET;',
          proposed: 'const secret = process.env.SECRET;',
          rationale: 'Prevent hardcoded secrets from leaking',
        },
      ],
    });

    expect(markdown).toContain('## ❌ PR Review: REJECTED');
    expect(markdown).toContain('Please fix all critical issues');
    expect(markdown).toContain('### 🤖 AI Review Summary');
    expect(markdown).toContain('The PR introduces a major vulnerability');
    expect(markdown).toContain('### ⚠️ Findings & Issues (2)');
    expect(markdown).toContain('**[CRITICAL]** `src/auth.ts:42`');
    expect(markdown).toContain('Hardcoded secret token');
    expect(markdown).toContain('*Recommendation:* Read secret from environment variable');
    expect(markdown).toContain('### 💡 Suggested Fixes (1)');
    expect(markdown).toContain('#### 1. `src/auth.ts`');
    expect(markdown).toContain('Prevent hardcoded secrets from leaking');
    expect(markdown).toContain('```suggestion\nconst secret = process.env.SECRET;\n```');
  });

  it('handles empty findings and suggestions gracefully', () => {
    const markdown = formatRejectWritebackBody({
      decision: 'REJECT',
      rationale: 'Bad architectural approach',
      summary: '',
      findings: [],
      suggestions: [],
    });

    expect(markdown).toContain('## ❌ PR Review: REJECTED');
    expect(markdown).toContain('Bad architectural approach');
    expect(markdown).not.toContain('### ⚠️ Findings');
    expect(markdown).not.toContain('### 💡 Suggested Fixes');
  });
});
