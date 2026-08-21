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
  ArtifactChanged: 'artifact.changed',
  ArtifactCreated: 'artifact.created',
  ArtifactRollbackRequested: 'artifact.rollback_requested',
  VerificationCompleted: 'verification.completed',
  AssessmentCreated: 'attention.assessment_created',
  DecisionSubmitted: 'review.decision_submitted',
} as const;
/** A domain event type string. */
export type EventType = (typeof EventType)[keyof typeof EventType];
