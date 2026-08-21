/**
 * `EvidenceStore` (day-17 §2.2) — transactional, append-only evidence writer.
 *
 * A *claim* (a `verification_check_results` row) is only as trustworthy as the
 * *proof* behind it, so every check's full, untruncated output is first written
 * as an {@link import('@harness/db').evidence} row, then linked to one-or-more
 * subjects through {@link import('@harness/db').evidenceLinks}. The inline
 * `output` column stays capped; this table holds the whole thing.
 *
 * Like `SnapshotStore`, `record` takes the *executor* (the `DrizzleDB` in unit
 * tests, or the open transaction handed to it by `VerificationEngine.persist`) so
 * the evidence insert lands in the same atomic unit as the report — a crash can
 * never leave a check result pointing at an evidence row that was never
 * committed. Evidence is never deleted.
 */

import { createHash } from 'node:crypto';

import { newEvidenceID } from '@harness/domain';
import type { EvidenceID } from '@harness/domain';
import { evidence, evidenceLinks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

/** The query operations `record` needs: satisfied by `DrizzleDB` and its transaction. */
export type EvidenceExecutor = Pick<DrizzleDB, 'select' | 'insert'>;

/** The kind of content an evidence record holds (day-17 §2.1). */
export const EvidenceKind = {
  CheckOutput: 'CHECK_OUTPUT',
  TestResults: 'TEST_RESULTS',
  Snapshot: 'SNAPSHOT',
  LlmTranscript: 'LLM_TRANSCRIPT',
  Diff: 'DIFF',
  HumanNote: 'HUMAN_NOTE',
} as const;
/** An evidence kind. */
export type EvidenceKind = (typeof EvidenceKind)[keyof typeof EvidenceKind];

/** What an evidence record is linked *to* (day-17 §2.1). */
export const EvidenceSubjectKind = {
  CheckResult: 'check_result',
  Artifact: 'artifact',
  Report: 'report',
  AgentRun: 'agent_run',
} as const;
/** An evidence subject kind. */
export type EvidenceSubjectKind = (typeof EvidenceSubjectKind)[keyof typeof EvidenceSubjectKind];

/** One subject an evidence record proves. */
export interface EvidenceLink {
  readonly subjectKind: EvidenceSubjectKind;
  readonly subjectId: string;
}

/** Result of {@link EvidenceStore.record}: the evidence row's id. */
export interface EvidenceRecord {
  readonly id: EvidenceID;
}

/** SHA-256 of `body`, hex-encoded (dedup + tamper-evidence identity). */
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export class EvidenceStore {
  /**
   * Write one evidence record and link it to every subject in `links`, atomically
   * with the caller's transaction. The row id is a branded `EvidenceID` (UUIDv7).
   */
  async record<T extends EvidenceExecutor>(
    executor: T,
    kind: EvidenceKind,
    body: string,
    links: EvidenceLink[],
  ): Promise<EvidenceRecord> {
    const id = newEvidenceID();
    await executor.insert(evidence).values({
      id,
      content_hash: sha256(body),
      kind,
      body,
    });
    for (const link of links) {
      await executor.insert(evidenceLinks).values({
        id: newEvidenceID(),
        evidence_id: id,
        subject_kind: link.subjectKind,
        subject_id: link.subjectId,
      });
    }
    return { id };
  }

  /** The SHA-256 of a body, exposed so tests can assert tamper-evidence. */
  hash(body: string): string {
    return sha256(body);
  }
}
