/**
 * Seed corpus (day-24 §3.4) — a small, hand-verified, *redacted* set of review
 * examples bundled with the benchmark so the judge-vs-gold evaluation and the
 * Day-39 regression have a reproducible ground truth to run against without a
 * live store.
 *
 * Every example is sourced (`source`) and redacted before inclusion: no secrets,
 * no org-proprietary code, no real repo paths — just the *shape* of a review
 * decision (day-24 §6). The seed file is a plain JSON array of judged artifacts
 * + gold labels; it never carries the judge's own scores (gold is human-derived,
 * never judge output).
 */

import { readFileSync } from 'node:fs';

import type { GoldLabel, JudgedArtifact, ReviewExample } from '../review-example.js';
import { LABEL_SET, SCALE_VERSION } from '../review-example.js';

/** The raw, on-disk seed shape (no `createdAt`/`scaleVersion` — loader stamps those). */
interface SeedExample {
  readonly id: string;
  readonly source: string;
  readonly prDiff: string;
  readonly requirement: string;
  readonly report: JudgedArtifact;
  readonly gold: GoldLabel;
}

function toExample(seed: SeedExample): ReviewExample {
  return {
    id: seed.id,
    scaleVersion: SCALE_VERSION,
    labelSet: LABEL_SET,
    source: seed.source,
    prDiff: seed.prDiff,
    requirement: seed.requirement,
    report: seed.report,
    gold: seed.gold,
    // The seed is versioned *data*, not an event — a fixed epoch keeps it reproducible.
    createdAt: new Date(0),
  };
}

/** Load and map the bundled seed examples (deterministic file order). */
export function loadSeedExamples(): ReviewExample[] {
  const raw = readFileSync(new URL('./examples.json', import.meta.url), 'utf8');
  const seeds = JSON.parse(raw) as SeedExample[];
  return seeds.map(toExample);
}
