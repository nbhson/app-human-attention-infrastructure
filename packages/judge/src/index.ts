/**
 * `@harness/judge` — the LLM-as-judge that scores a review report against a
 * versioned rubric (review-reorient Phase 3 day-21).
 *
 * The judged artifact is the **report**, never the PR's code or its author. The
 * judge calls the {@link import('@harness/domain').LLMProvider} seam with a
 * versioned rubric prompt, parses the numeric `JudgeScores`, and records the run
 * through the {@link import('@harness/domain').JudgeRunStore} seam so every score
 * is auditable — shadow-only today: nothing consumes the scores yet (day-22 wires
 * inter-judge agreement, day-23 feeds weight fitting).
 */

export * from './rubric.js';
export * from './judge.js';
