import { describe, expect, it } from 'vitest';

import { reviewReports, reviewVerifications } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import type { Logger } from '@harness/di';
import type { ReviewReportID } from '@harness/domain';
import type { IEventBus } from '@harness/event-bus';
import type { GitProvider } from '@harness/git-provider';
import { CheckKind, CheckStatus } from '@harness/verification-engine';
import type { CloneVerifier } from '@harness/verification-engine';

import { ReviewVerificationService } from '../services/review-verification.js';

/**
 * Regression test for the orphaned-RUNNING incident (review `01a0f39e…`):
 * a Bitbucket-Server PR whose mapper stored an empty `head.sha` made
 * `cloneInputFromPullRequest` throw *outside* any try block, so `verify()`
 * rejected after inserting RUNNING and the row stayed "running" forever —
 * no workdir, no container, no further DB write. The guard must convert that
 * into an honest terminal SKIPPED instead.
 */

/** Minimal in-memory stand-in for the Drizzle chaining the service uses. */
function stubDb(reportRow: unknown): {
  db: DrizzleDB;
  verificationRows: Record<string, unknown>[];
} {
  const verificationRows: Record<string, unknown>[] = [];
  const db = {
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              return {
                limit(): Promise<unknown[]> {
                  if (table === reviewReports) {
                    return Promise.resolve([reportRow]);
                  }
                  return Promise.resolve([...verificationRows]);
                },
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(row: Record<string, unknown>): Promise<unknown[]> {
          if (table === reviewVerifications) {
            verificationRows.push({ ...row });
          }
          return Promise.resolve([]);
        },
      };
    },
    update(table: unknown) {
      return {
        set(patch: Record<string, unknown>) {
          return {
            where(): Promise<unknown[]> {
              const row = verificationRows[0];
              if (table === reviewVerifications && row !== undefined) {
                Object.assign(row, patch);
              }
              return Promise.resolve([]);
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as DrizzleDB, verificationRows };
}

function stubLogger(): Logger {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
}

/** The stored `pr_payload` shape from the incident: Bitbucket Server, empty SHAs. */
function payload(headSha: string): Record<string, unknown> {
  return {
    provider: 'bitbucket',
    number: 2854,
    repo: 'eu-gitp-a001.iconcr.com/SP0168/horizon2-ui',
    url: 'https://eu-gitp-a001.iconcr.com/projects/SP0168/repos/horizon2-ui/pull-requests/2854',
    files: [],
    title: 'incident shape',
    author: 'local',
    sourceBranch: 'SP0168-4018',
    targetBranch: 'develop',
    head: { ref: 'SP0168-4018', sha: headSha, repo: 'eu-gitp-a001.iconcr.com/SP0168/horizon2-ui' },
    base: { ref: 'develop', sha: '', repo: 'eu-gitp-a001.iconcr.com/SP0168/horizon2-ui' },
  };
}

function serviceFor(
  db: DrizzleDB,
  gitProvider: GitProvider | null,
  verifier: CloneVerifier | null,
): { service: ReviewVerificationService; cloneCalls: unknown[] } {
  const cloneCalls: unknown[] = [];
  const git =
    gitProvider ??
    ({
      cloneAndCheckout: async (input: unknown, workdir: unknown) => {
        cloneCalls.push({ input, workdir });
        return { workdir, headSha: 'a'.repeat(40), sourceBranch: 'b', targetBranch: 'main' };
      },
    } as unknown as GitProvider);
  const service = new ReviewVerificationService({
    db,
    bus: { subscribe: () => {} } as unknown as IEventBus,
    gitProvider: git,
    verifier:
      verifier ??
      ({
        verify: async () => {
          throw new Error('verifier must not run without a clone');
        },
      } as unknown as CloneVerifier),
    enabled: true,
    logger: stubLogger(),
  });
  return { service, cloneCalls };
}

describe('ReviewVerificationService.verify', () => {
  it('marks SKIPPED (never orphans RUNNING) when the stored head SHA is unusable', async () => {
    const reportId = 'report-empty-sha' as ReviewReportID;
    const { db, verificationRows } = stubDb({ id: reportId, pr_payload: payload('') });
    const explodingGit = {
      cloneAndCheckout: () => {
        throw new Error('clone must not be attempted without a SHA');
      },
    } as unknown as GitProvider;
    const { service } = serviceFor(db, explodingGit, null);

    await expect(service.verify(reportId)).resolves.toBeUndefined();

    expect(verificationRows).toHaveLength(1);
    expect(verificationRows[0]?.['status']).toBe('SKIPPED');
    expect(String(verificationRows[0]?.['error'])).toContain('head SHA is not usable');
  });

  it('still clones and verifies when the stored head SHA is usable', async () => {
    const sha = 'a'.repeat(40);
    const reportId = 'report-good-sha' as ReviewReportID;
    const { db, verificationRows } = stubDb({ id: reportId, pr_payload: payload(sha) });
    const verifier = {
      verify: async (clone: { workdir: string; headSha: string }) => ({
        workdir: clone.workdir,
        headSha: clone.headSha,
        contentHash: 'abc',
        overall: 'PASSED' as const,
        durationMs: 1,
        checks: [
          { checkKind: CheckKind.COMPILE, status: CheckStatus.PASSED, durationMs: 1, output: 'ok' },
          { checkKind: CheckKind.TEST, status: CheckStatus.PASSED, durationMs: 1, output: 'ok' },
        ],
        failedChecks: [],
      }),
    } as unknown as CloneVerifier;
    const { service, cloneCalls } = serviceFor(db, null, verifier);

    await expect(service.verify(reportId)).resolves.toBeUndefined();

    expect(cloneCalls).toHaveLength(1);
    expect(verificationRows).toHaveLength(1);
    expect(verificationRows[0]?.['status']).toBe('PASSED');
  });
});
