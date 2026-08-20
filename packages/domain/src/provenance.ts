/**
 * Provenance chain read-model.
 *
 * The composited read-model the UI renders (and the Artifact/Change Tracker's
 * query API returns) to answer the full audit question: which task, which
 * context, which agent, which changes, which verification, which risk, and which
 * human decision. Source: `5_Artifact_Change_Tracker_v0.1.md` (§8).
 */

import type { AgentRunID, ContextID, TaskID } from './ids.js';
import type { FileChange } from './artifact.js';
import type { AgentType } from './agent-run.js';
import type { HumanDecisionType } from './review.js';

/**
 * The end-to-end provenance of a change (artifact-tracker spec §8).
 *
 * It links the task, context, agent run, trajectory metrics, file changes,
 * verification outcome, risk assessment, and optional human decision into one
 * queryable record.
 */
export interface ProvenanceChain {
  /** What the goal was. */
  readonly task: { readonly id: TaskID; readonly description: string };
  /** What information was used. */
  readonly context: { readonly id: ContextID; readonly summary: string };
  /** Who executed the work. */
  readonly agent: {
    readonly runId: AgentRunID;
    readonly agentType: AgentType;
    readonly model: string;
  };
  /** How the work was done. */
  readonly trajectory: { readonly steps: number; readonly toolCalls: number };
  /** What files were affected. */
  readonly changes: FileChange[];
  /** Whether and how the change was verified. */
  readonly verification: { readonly status: string; readonly details: string };
  /** What risk was assessed. */
  readonly riskAssessment: { readonly score: number; readonly level: string };
  /** Whether and how a human decided. */
  readonly humanDecision?: {
    readonly decision: HumanDecisionType;
    readonly by: string;
    readonly timestamp: Date;
  };
}
