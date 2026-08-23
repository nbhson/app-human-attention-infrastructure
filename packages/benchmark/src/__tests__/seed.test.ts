import { describe, expect, it } from 'vitest';

import { loadSeedExamples } from '../seed/seed-data.js';

/**
 * Content-guard tokens (day-24 §6): the corpus is *review* ground truth — an
 * external PR diff + requirement + report, never a code-synthesis task. These
 * tokens are the machinery of the retired "AI writes code" path; any of them in
 * seed text means a coding task leaked in.
 */
const FORBIDDEN_CODE_GEN = [
  'write_file',
  'read_file',
  'applyAndCommit',
  'MergeService',
  'ReworkService',
  'code_mode_sessions',
  'AgentRunner',
];

/** Redaction guards: no live secret/credential material may ship in the seed. */
const SECRET_HINTS = ['AKIA', 'BEGIN ', 'PRIVATE KEY', 'Bearer ', 'api_key', 'password='];

describe('loadSeedExamples', () => {
  const examples = loadSeedExamples();

  it('loads a non-trivial seed set (>= 5 examples)', () => {
    expect(examples.length).toBeGreaterThanOrEqual(5);
  });

  it('stamps every example with the current scale version and label set', () => {
    for (const example of examples) {
      expect(example.scaleVersion).toBe('v1');
      expect(example.labelSet).toBe('severity-routing-useful');
    }
  });

  it('uses unique ids, all seed-prefixed', () => {
    const ids = examples.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith('seed-')).toBe(true);
    }
  });

  it('keeps every gold label within [0,1]', () => {
    for (const example of examples) {
      expect(example.gold.severity).toBeGreaterThanOrEqual(0);
      expect(example.gold.severity).toBeLessThanOrEqual(1);
      expect(example.gold.routing).toBeGreaterThanOrEqual(0);
      expect(example.gold.routing).toBeLessThanOrEqual(1);
      expect(typeof example.gold.useful).toBe('boolean');
    }
  });

  it('carries no code-generation task content', () => {
    for (const example of examples) {
      const text = [example.prDiff, example.requirement, example.report.summary]
        .concat(example.report.findings.map((f) => `${f.message} ${f.suggestion ?? ''}`))
        .join('\n');
      for (const token of FORBIDDEN_CODE_GEN) {
        expect(text, `${example.id} leaks code-gen token "${token}"`).not.toContain(token);
      }
    }
  });

  it('carries no secret or credential material', () => {
    for (const example of examples) {
      const text = JSON.stringify(example);
      for (const hint of SECRET_HINTS) {
        expect(text, `${example.id} may leak a secret ("${hint}")`).not.toContain(hint);
      }
    }
  });

  it('gives every example a non-empty diff, requirement, and report summary', () => {
    for (const example of examples) {
      expect(example.prDiff.length).toBeGreaterThan(0);
      expect(example.requirement.length).toBeGreaterThan(0);
      expect(example.report.summary.length).toBeGreaterThan(0);
    }
  });
});
