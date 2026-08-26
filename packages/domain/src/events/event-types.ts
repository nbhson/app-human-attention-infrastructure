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
  // Review-reorient (Phase 3): the human verdict on a review-slice report —
  // distinct from the Phase-1 `DecisionSubmitted` (which targets a `change` and a
  // Phase-1 reviewer). This one targets a `review_report` so the memory write-half
  // can ground it in `review_decisions` (not the retired `decisions` table).
  ReviewDecisionSubmitted: 'review.report_decision_submitted',
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
  // Review-reorient Phase 3 day-16: review memory. `memory.entry_created` proves
  // a curated entry was distilled and stored with its evidence links — the anchor
  // context/attention subscribe to for the next review.
  MemoryEntryCreated: 'memory.entry_created',
  // Review-reorient Phase 3 day-19: memory lifecycle. `memory.consolidated` marks
  // a version chain folded into one head; `memory.archived` marks an entry moved
  // to `ARCHIVED` (soft-delete, retained for audit) after dropping below the
  // utility threshold.
  MemoryConsolidated: 'memory.consolidated',
  MemoryArchived: 'memory.archived',
  // Review-reorient Phase 3 day-33: the closed learning loop. Each cycle stage
  // emits `learning.stage_completed` (per-stage audit), and the whole
  // Evaluate→Calibrate→Deploy→Observe cycle emits `learning.loop_completed` once
  // it reaches a terminal outcome — one `correlation_id` joins every stage event
  // to the candidate it fitted and the deployment it became.
  LearningStageCompleted: 'learning.stage_completed',
  LearningLoopCompleted: 'learning.loop_completed',
  // Runtime lifecycle (day-34 §4.5): the process itself as a first-class system.
  // `system.started` lands in `event_log` once the object graph is booted and the
  // subscribers are bound, so the audit timeline shows "application started" and
  // which components were wired; `system.stopped` marks a graceful shutdown.
  SystemStarted: 'system.started',
  SystemStopped: 'system.stopped',
} as const;
/** A domain event type string. */
export type EventType = (typeof EventType)[keyof typeof EventType];
