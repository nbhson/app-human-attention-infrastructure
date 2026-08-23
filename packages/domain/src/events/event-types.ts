/**
 * Canonical event type constants.
 *
 * Every domain event is identified by a namespaced string of the form
 * `<domain>.<entity>_<verb_past_tense>`, e.g. `task.state_changed`. Keeping these
 * as a const-object union (rather than a TS enum) lets consumers exhaustively
 * switch over values. Source: orchestrator spec §8.
 */
export const EventType = {
  TaskCreated: 'task.created',
  TaskStateChanged: 'task.state_changed',
  TaskExecutionFinished: 'task.execution_finished',
  TaskFailed: 'task.failed',
  TaskOrphanRecovered: 'task.orphan_recovered',
  ArtifactChanged: 'artifact.changed',
  ArtifactCreated: 'artifact.created',
  ArtifactRollbackRequested: 'artifact.rollback_requested',
  ArtifactMerged: 'artifact.merged',
  VerificationCompleted: 'verification.completed',
  AssessmentCreated: 'attention.assessment_created',
  AttentionItemRouted: 'attention.item_routed',
  AttentionThresholdAdjusted: 'attention.threshold_adjusted',
  AttentionInflationDetected: 'attention.inflation_detected',
  AttentionItemDeferred: 'attention.item_deferred',
  DecisionSubmitted: 'review.decision_submitted',
  // Day-24 (Phase 2): the review-surface lifecycle (Spec 8), distinct from the
  // decision itself — `claimed` starts the dwell timer, `released` re-queues a
  // timed-out claim, `escalated` records the reviewer's higher-authority handoff.
  ReviewItemClaimed: 'review.item_claimed',
  ReviewItemReleased: 'review.item_released',
  ReviewItemEscalated: 'review.item_escalated',
  AuthzDecisionDenied: 'authz.decision_denied',
  // Day-14 (Phase 2): a sampled auto-approve was rejected by the human control
  // reviewer — the "auto-approvable-but-rejected" signal (Spec 11 §4.1).
  EscalationLeakage: 'evaluation.escalation_leakage',
  // Review-reorient (Phase 3): the external-PR review slice. Ingestion events
  // prove a provider seam was actually read; the report/suggestion events prove
  // the AI reviewer produced output; writeback proves an external write happened
  // (all append-only, correlation-joined).
  IntegrationPrFetched: 'integration.pr_fetched',
  IntegrationTicketFetched: 'integration.ticket_fetched',
  ReviewReportCreated: 'review.report_created',
  ReviewFixSuggestionCreated: 'review.fix_suggestion_created',
  IntegrationWritebackCompleted: 'integration.writeback_completed',
} as const;
/** A domain event type string. */
export type EventType = (typeof EventType)[keyof typeof EventType];
