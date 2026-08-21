/**
 * Attention domain types.
 *
 * The Attention Engine assesses whether an AI-generated change needs human eyes
 * and at what priority. Source: `6_Attention_Engine_v0.1.md` (§2, §3.4).
 */

import type { AssessmentID, ChangeID, PolicyID, ProjectID, TaskID } from './ids.js';

/** The review priority label (attention spec §2.1, §3.4). */
export const PriorityLabel = {
  Low: 'LOW',
  Medium: 'MEDIUM',
  High: 'HIGH',
  Critical: 'CRITICAL',
} as const;
/** A review priority label. */
export type PriorityLabel = (typeof PriorityLabel)[keyof typeof PriorityLabel];

/**
 * What should *happen* to an assessment once priority is known (attention spec
 * §4 policy & routing). The scoring engine (Day 18) says *how urgent*; the policy
 * rules map that to a *routing decision*.
 */
export const RoutingAction = {
  ReviewRequired: 'REVIEW_REQUIRED',
  ReviewRecommended: 'REVIEW_RECOMMENDED',
  AutoApprovable: 'AUTO_APPROVABLE',
  Escalate: 'ESCALATE',
} as const;
/** A routing decision produced by the attention policy. */
export type RoutingAction = (typeof RoutingAction)[keyof typeof RoutingAction];

/** The suggested depth of human review (attention spec §2.1). */
export const SuggestReviewDepth = {
  Quick: 'QUICK',
  Normal: 'NORMAL',
  Deep: 'DEEP',
} as const;
/** A suggested review depth. */
export type SuggestReviewDepth = (typeof SuggestReviewDepth)[keyof typeof SuggestReviewDepth];

/** The action an attention rule takes (attention spec §2.2). */
export const AttentionRuleAction = {
  AlwaysReview: 'ALWAYS_REVIEW',
  NeverReview: 'NEVER_REVIEW',
  AdjustPriority: 'ADJUST_PRIORITY',
} as const;
/** An attention rule action. */
export type AttentionRuleAction = (typeof AttentionRuleAction)[keyof typeof AttentionRuleAction];

/**
 * The component scores produced by the Attention Engine (attention spec §2.1).
 * All values are in `[0, 1]`.
 */
export interface AttentionScores {
  /** Risk of the change introducing a defect. */
  readonly riskScore: number;
  /** Blast radius / impact of the change. */
  readonly impactScore: number;
  /** Confidence the change is correct. */
  readonly confidenceScore: number;
  /** Novelty of the changed pattern. */
  readonly noveltyScore: number;
  /** Complexity of the change. */
  readonly complexityScore: number;
}

/**
 * A single weighted factor contributing to the assessment (attention spec §2.1).
 */
export interface AttentionFactor {
  /** A stable factor name, e.g. `"file_risk_level"`. */
  readonly name: string;
  /** The factor's score in `[0, 1]`. */
  readonly score: number;
  /** The factor's weight in the combined priority. */
  readonly weight: number;
  /** Human-readable explanation. */
  readonly description: string;
}

/**
 * A single attention policy rule (attention spec §2.2).
 */
export interface AttentionRule {
  /** A condition expression, e.g. `"file_path matches 'src/auth/*'"`. */
  readonly condition: string;
  /** The action taken when the condition matches. */
  readonly action: AttentionRuleAction;
  /** Priority delta for `ADJUST_PRIORITY`, e.g. `0.5`. */
  readonly priorityModifier?: number;
}

/**
 * The policy governing attention (attention spec §2.2).
 */
export interface AttentionPolicy {
  /** Policy id. */
  readonly id: PolicyID;
  /** The project this policy applies to. */
  readonly projectId: ProjectID;
  /** Ordered rules. */
  readonly rules: AttentionRule[];
  /** Above this risk, always require review. */
  readonly riskThreshold: number;
  /** Below this confidence, always require review. */
  readonly confidenceThreshold: number;
  /** Whether auto-approve is enabled. */
  readonly autoApproveEnabled: boolean;
  /** Max risk for auto-approve. */
  readonly autoApproveMaxRisk: number;
  /** Glob patterns that always require review. */
  readonly requireReviewForPaths: string[];
}

/**
 * The result of assessing a change (attention spec §2.1).
 */
export interface AttentionAssessment {
  /** Unique assessment id. */
  readonly id: AssessmentID;
  /** The task assessed. */
  readonly taskId: TaskID;
  /** The change assessed. */
  readonly changeId: ChangeID;
  /** Creation time. */
  readonly createdAt: Date;
  /** Component scores. */
  readonly scores: AttentionScores;
  /** Combined priority in `[0, 1]`. */
  readonly combinedPriority: number;
  /** The derived priority label. */
  readonly priorityLabel: PriorityLabel;
  /** Whether human review is required. */
  readonly reviewRequired: boolean;
  /** Explanation of why review is (or is not) required. */
  readonly reviewReason: string;
  /** Suggested reviewer based on expertise. */
  readonly recommendedReviewer?: string;
  /** Suggested review depth. */
  readonly suggestedReviewDepth: SuggestReviewDepth;
  /** The weighted factors used. */
  readonly factors: AttentionFactor[];
  /** Free-form extension metadata. */
  readonly metadata: Record<string, unknown>;
}

/** Input for {@link createAttentionAssessment}. */
export type CreateAttentionAssessmentInput = Omit<AttentionAssessment, 'createdAt' | 'metadata'> &
  Partial<Pick<AttentionAssessment, 'createdAt' | 'metadata' | 'recommendedReviewer'>>;

/**
 * Build an {@link AttentionAssessment} defaulting `createdAt` to now and
 * `metadata` to empty.
 */
export function createAttentionAssessment(
  input: CreateAttentionAssessmentInput,
): AttentionAssessment {
  return { createdAt: new Date(), metadata: {}, ...input };
}

/**
 * Build an {@link AttentionScores} value object.
 */
export function createAttentionScores(input: AttentionScores): AttentionScores {
  return input;
}
