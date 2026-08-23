/**
 * Branded identifiers and UUIDv7 generation for the HAI domain.
 *
 * Every entity in the system is keyed by a *branded string ID* rather than a
 * plain `string`. This turns accidental cross-entity assignment — e.g. passing an
 * `ArtifactID` where a `TaskID` is expected — into a compile-time error, which is
 * the #1 class of cross-module bug in a monolith this size.
 *
 * IDs are UUIDv7 (RFC 9562): the first 48 bits encode the Unix timestamp in
 * milliseconds, so freshly generated IDs are time-sortable and Postgres-index
 * friendly. See `packages/domain/README.md` for the UUIDv7 vs UUIDv4 / ULID
 * rationale.
 */

import { randomBytes } from 'node:crypto';

/**
 * A nominal type tag applied to a primitive `string` to distinguish one kind of
 * ID from another at compile time.
 *
 * @typeParam T - the underlying primitive (always `string` today).
 * @typeParam BrandName - a unique literal naming the entity the ID belongs to.
 */
export type Brand<T, BrandName extends string> = T & { readonly __brand: BrandName };

/**
 * Cast a value into a branded type at an explicit trust boundary.
 *
 * The brand name is a compile-time marker only; this function is an identity at
 * runtime. Callers are responsible for supplying a value the brand accurately
 * describes (the factories in this module always do).
 *
 * @typeParam BrandName - the literal brand name.
 * @param value - the underlying string value.
 * @returns the value typed with the requested brand.
 */
export function brand<BrandName extends string>(
  value: string,
  _brandName: BrandName,
): Brand<string, BrandName> {
  void _brandName; // the brand name exists only to infer `BrandName` at the call site
  return value as Brand<string, BrandName>;
}

// --- Branded ID types -----------------------------------------------------

/** Identifies a single unit of work (orchestrator spec §2.2). */
export type TaskID = Brand<string, 'TaskID'>;
/** Identifies a workflow container of tasks (orchestrator spec §2.1). */
export type WorkflowID = Brand<string, 'WorkflowID'>;
/** Identifies one AI Agent execution of a task (agent-runtime spec §3). */
export type AgentRunID = Brand<string, 'AgentRunID'>;
/** Identifies an AI-generated artifact (artifact-tracker spec §2.1). */
export type ArtifactID = Brand<string, 'ArtifactID'>;
/** Identifies a change — a set of file modifications (artifact-tracker §2.2). */
export type ChangeID = Brand<string, 'ChangeID'>;
/** Identifies a point-in-time artifact snapshot (artifact-tracker §2.3). */
export type SnapshotID = Brand<string, 'SnapshotID'>;
/** Identifies a context snapshot (context-engine spec §2.2). */
export type ContextID = Brand<string, 'ContextID'>;
/** Identifies an attention assessment (attention spec §2.1). */
export type AssessmentID = Brand<string, 'AssessmentID'>;
/** Identifies a verification request (verification spec §2.1). */
export type VerificationRequestID = Brand<string, 'VerificationRequestID'>;
/** Identifies a verification result (verification spec §2.2). */
export type VerificationResultID = Brand<string, 'VerificationResultID'>;
/** Identifies an immutable evidence record (memory/evidence spec §3.1). */
export type EvidenceID = Brand<string, 'EvidenceID'>;
/** Identifies a project (architecture spec §7.1). */
export type ProjectID = Brand<string, 'ProjectID'>;
/** Identifies a human review decision (architecture spec §13). */
export type DecisionID = Brand<string, 'DecisionID'>;
/** Identifies a domain event on the internal bus (orchestrator spec §8). */
export type EventID = Brand<string, 'EventID'>;
/** Identifies a reusable policy (attention/verification/context specs). */
export type PolicyID = Brand<string, 'PolicyID'>;
/** Identifies an evidence-backed claim (memory/evidence spec §3.1). */
export type ClaimID = Brand<string, 'ClaimID'>;
/** Identifies a human reviewer (memory/evidence spec §3.1). */
export type ReviewerID = Brand<string, 'ReviewerID'>;
/** Identifies a causal event chain traceable to one origin (orchestrator spec §8). */
export type CorrelationID = Brand<string, 'CorrelationID'>;
/** Identifies a review-queue entry (attention spec §4 policy & routing). */
export type ReviewQueueItemID = Brand<string, 'ReviewQueueItemID'>;
/** Identifies a reviewer's usefulness feedback on an assessment (attention spec §4.1). */
export type AssessmentFeedbackID = Brand<string, 'AssessmentFeedbackID'>;
/** Identifies a registered user (identity model, Phase 2 day-01 §2.1). */
export type UserID = Brand<string, 'UserID'>;
/** Identifies a session row (identity model, Phase 2 day-01 §2.2). */
export type SessionID = Brand<string, 'SessionID'>;
/** Identifies an AI review report (review-reorient Phase 3). */
export type ReviewReportID = Brand<string, 'ReviewReportID'>;
/** Identifies a single finding inside a review report (review-reorient Phase 3). */
export type ReviewFindingID = Brand<string, 'ReviewFindingID'>;
/** Identifies a proposed fix inside a review report (review-reorient Phase 3). */
export type FixSuggestionID = Brand<string, 'FixSuggestionID'>;
/** Identifies a provider configuration row (git/jira/ai, review-reorient Phase 3). */
export type ProviderConfigID = Brand<string, 'ProviderConfigID'>;
/** Identifies a write-back attempt to a PR/Jira (review-reorient Phase 3). */
export type WritebackID = Brand<string, 'WritebackID'>;
/** Identifies a review-memory entry (review-reorient Phase 3, day-16). */
export type MemoryID = Brand<string, 'MemoryID'>;

// --- UUIDv7 generation ----------------------------------------------------

/**
 * Generate a UUIDv7 (RFC 9562) string.
 *
 * The first 48 bits encode the current Unix timestamp in milliseconds, making
 * freshly generated IDs approximately time-ordered and index-friendly. The
 * remaining 74 bits are cryptographically random.
 *
 * @param nowMs - the Unix timestamp in milliseconds (defaults to `Date.now()`).
 * @returns a canonical lowercase UUIDv7 string.
 */
export function uuidv7(nowMs: number = Date.now()): string {
  const ms = BigInt(nowMs);
  if (ms < 0n || ms > 0xffffffffffffn) {
    throw new RangeError(`UUIDv7 timestamp out of range: ${nowMs}`);
  }
  const rand = randomBytes(10);
  const bytes = new Uint8Array(16);
  // 48-bit unix-ms timestamp, big-endian, in bytes 0..5.
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  // Bytes 6..15 are random.
  bytes.set(rand, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7 (high nibble of byte 6)
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant "10" (high bits of byte 8)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** @internal Shared implementation for all ID factories. */
function newBrandedId<BrandName extends string>(brandName: BrandName): Brand<string, BrandName> {
  return brand(uuidv7(), brandName);
}

/** Generate a new {@link TaskID}. */
export const newTaskID = (): TaskID => newBrandedId('TaskID');
/** Generate a new {@link WorkflowID}. */
export const newWorkflowID = (): WorkflowID => newBrandedId('WorkflowID');
/** Generate a new {@link AgentRunID}. */
export const newAgentRunID = (): AgentRunID => newBrandedId('AgentRunID');
/** Generate a new {@link ArtifactID}. */
export const newArtifactID = (): ArtifactID => newBrandedId('ArtifactID');
/** Generate a new {@link ChangeID}. */
export const newChangeID = (): ChangeID => newBrandedId('ChangeID');
/** Generate a new {@link SnapshotID}. */
export const newSnapshotID = (): SnapshotID => newBrandedId('SnapshotID');
/** Generate a new {@link ContextID}. */
export const newContextID = (): ContextID => newBrandedId('ContextID');
/** Generate a new {@link AssessmentID}. */
export const newAssessmentID = (): AssessmentID => newBrandedId('AssessmentID');
/** Generate a new {@link VerificationRequestID}. */
export const newVerificationRequestID = (): VerificationRequestID =>
  newBrandedId('VerificationRequestID');
/** Generate a new {@link VerificationResultID}. */
export const newVerificationResultID = (): VerificationResultID =>
  newBrandedId('VerificationResultID');
/** Generate a new {@link EvidenceID}. */
export const newEvidenceID = (): EvidenceID => newBrandedId('EvidenceID');
/** Generate a new {@link ProjectID}. */
export const newProjectID = (): ProjectID => newBrandedId('ProjectID');
/** Generate a new {@link DecisionID}. */
export const newDecisionID = (): DecisionID => newBrandedId('DecisionID');
/** Generate a new {@link EventID}. */
export const newEventID = (): EventID => newBrandedId('EventID');
/** Generate a new {@link PolicyID}. */
export const newPolicyID = (): PolicyID => newBrandedId('PolicyID');
/** Generate a new {@link ClaimID}. */
export const newClaimID = (): ClaimID => newBrandedId('ClaimID');
/** Generate a new {@link ReviewerID}. */
export const newReviewerID = (): ReviewerID => newBrandedId('ReviewerID');
/** Generate a new {@link CorrelationID}. */
export const newCorrelationID = (): CorrelationID => newBrandedId('CorrelationID');
/** Generate a new {@link ReviewQueueItemID}. */
export const newReviewQueueItemID = (): ReviewQueueItemID => newBrandedId('ReviewQueueItemID');
/** Generate a new {@link AssessmentFeedbackID}. */
export const newAssessmentFeedbackID = (): AssessmentFeedbackID =>
  newBrandedId('AssessmentFeedbackID');
/** Generate a new {@link UserID}. */
export const newUserID = (): UserID => newBrandedId('UserID');
/** Generate a new {@link SessionID}. */
export const newSessionID = (): SessionID => newBrandedId('SessionID');
/** Generate a new {@link ReviewReportID}. */
export const newReviewReportID = (): ReviewReportID => newBrandedId('ReviewReportID');
/** Generate a new {@link ReviewFindingID}. */
export const newReviewFindingID = (): ReviewFindingID => newBrandedId('ReviewFindingID');
/** Generate a new {@link FixSuggestionID}. */
export const newFixSuggestionID = (): FixSuggestionID => newBrandedId('FixSuggestionID');
/** Generate a new {@link ProviderConfigID}. */
export const newProviderConfigID = (): ProviderConfigID => newBrandedId('ProviderConfigID');
/** Generate a new {@link WritebackID}. */
export const newWritebackID = (): WritebackID => newBrandedId('WritebackID');
/** Generate a new {@link MemoryID}. */
export const newMemoryID = (): MemoryID => newBrandedId('MemoryID');
