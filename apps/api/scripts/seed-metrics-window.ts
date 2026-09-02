/**
 * Day-10 §3.2 — metrics checkpoint seed (`pnpm seed:metrics-checkpoint`).
 *
 * Primes a small but *decidable* window of real review decisions so the offline
 * metrics have genuine ground truth to compute — not zeros, not `undefined`. The
 * pipeline's own E2E driver truncates between scenarios and its happy path
 * auto-approves a single `LOW` change, so it leaves no human decision behind;
 * this script seeds the four rows a proper routing-precision story needs:
 *
 *   A  HIGH    → REVIEW_REQUIRED (human)    → REJECTED          (warranted)
 *   B  MEDIUM  → REVIEW_RECOMMENDED (human) → APPROVED, 120s     (accepted)
 *   C  LOW     → AUTO_APPROVABLE (fly)       → later REWORK      (missed defect)
 *   D  HIGH    → REVIEW_REQUIRED (human)    → APPROVED, 180s     (accepted)
 *
 * Every decision carries a real `actor_id` (the seed REVIEWER principal) and a
 * `was_useful` feedback row; dwell is derived from `claim at` vs `decide at`. The
 * resulting window yields non-trivial precision / recall / leakage / minutes.
 *
 * Run via `pnpm seed:metrics-checkpoint` (needs `DATABASE_URL`) *after*
 * `pnpm --filter @harness/db migrate`, then `pnpm eval:metrics` /
 * `pnpm eval:report` over the window printed by this script.
 */

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

import { uuidv7, EventType } from '@harness/domain';

import {
  agentRuns,
  artifacts,
  assessmentFeedback,
  assessments,
  changes,
  createDb,
  decisions,
  eventLog,
  projects,
  reviewQueue,
  tasks,
  taskStateHistory,
  users,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
config({ path: join(REPO_ROOT, '.env') });

const NOW = new Date();
const MINUTE = 60_000;

/** A single seedable review item and its eventual human/flythrough outcome. */
interface SeedItem {
  readonly id: string;
  readonly title: string;
  readonly label: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly action: 'REVIEW_REQUIRED' | 'REVIEW_RECOMMENDED' | 'AUTO_APPROVABLE';
  readonly outcome: 'APPROVED' | 'REJECTED' | 'FLYTHROUGH_DEFECT';
  /** Claim→decide dwell in seconds for APPROVED items (else unused). */
  readonly dwellSeconds: number;
}

const SEED: readonly SeedItem[] = [
  {
    id: 'ckpt-a',
    title: 'Checkpoint A — HIGH rejected',
    label: 'HIGH',
    action: 'REVIEW_REQUIRED',
    outcome: 'REJECTED',
    dwellSeconds: 0,
  },
  {
    id: 'ckpt-b',
    title: 'Checkpoint B — MEDIUM approved',
    label: 'MEDIUM',
    action: 'REVIEW_RECOMMENDED',
    outcome: 'APPROVED',
    dwellSeconds: 120,
  },
  {
    id: 'ckpt-c',
    title: 'Checkpoint C — LOW flythrough then rework',
    label: 'LOW',
    action: 'AUTO_APPROVABLE',
    outcome: 'FLYTHROUGH_DEFECT',
    dwellSeconds: 0,
  },
  {
    id: 'ckpt-d',
    title: 'Checkpoint D — HIGH approved',
    label: 'HIGH',
    action: 'REVIEW_REQUIRED',
    outcome: 'APPROVED',
    dwellSeconds: 180,
  },
];

/** The reviewer principal every decision is attributed to. */
const REVIEWER = {
  id: uuidv7(),
  oidc_sub: 'mock|checkpoint-reviewer',
  email: 'reviewer@example.com',
};

function seedReviewer(db: DrizzleDB): Promise<void> {
  return db
    .insert(users)
    .values({
      id: REVIEWER.id,
      oidc_sub: REVIEWER.oidc_sub,
      email: REVIEWER.email,
      display_name: 'Checkpoint Reviewer',
      roles: ['REVIEWER'],
    })
    .onConflictDoNothing()
    .then(() => undefined);
}

async function seedItem(db: DrizzleDB, item: SeedItem, index: number): Promise<void> {
  const occurredAt = new Date(NOW.getTime() - (SEED.length - index) * MINUTE);
  const decidedAt = new Date(occurredAt.getTime() + 6 * MINUTE);
  const claimedAt = new Date(decidedAt.getTime() - item.dwellSeconds * 1000);

  const projectId = uuidv7();
  const taskId = uuidv7();
  const agentRunId = uuidv7();
  const artifactId = uuidv7();
  const changeId = uuidv7();
  const assessmentId = uuidv7();
  const queueId = uuidv7();

  await db.insert(projects).values({ id: projectId, name: `ckpt-${index}`, repo_path: '/tmp/ckpt' });
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: item.title,
    state: 'AWAITING_REVIEW',
    idempotency_key: `ckpt-ik-${item.id}`,
  });
  await db.insert(agentRuns).values({ id: agentRunId, task_id: taskId, status: 'COMPLETED', max_steps: 10 });
  await db.insert(artifacts).values({
    id: artifactId,
    project_id: projectId,
    file_path: 'src/index.ts',
    status: 'PENDING_REVIEW',
  });
  await db.insert(changes).values({
    id: changeId,
    artifact_id: artifactId,
    agent_run_id: agentRunId,
    change_type: 'CREATED',
    status: 'VERIFIED',
    content_hash: `hash-${item.id}`,
    diff_summary: 'seeded checkpoint change',
  });
  await db.insert(assessments).values({
    id: assessmentId,
    artifact_id: artifactId,
    change_id: changeId,
    risk_score: 0.5,
    impact_score: 0.5,
    novelty_score: 0.5,
    complexity_score: 0.5,
    confidence_score: 0.5,
    combined_priority: 0.6,
    label: item.label,
    factors_unavailable: [],
  });
  await db.insert(reviewQueue).values({
    id: queueId,
    task_id: taskId,
    assessment_id: assessmentId,
    action: item.action,
    policy_version: 1,
    rule_id: `r-${item.id}`,
    position: index + 1,
    status: 'QUEUED',
    ...(item.outcome === 'APPROVED' ? { claimed_by: REVIEWER.id, claimed_at: claimedAt } : {}),
  });

  // The route event the offline loader reads. `action` is the routing decision;
  // anything that is not AUTO_APPROVABLE counts as a human route (labels.ts).
  await db.insert(eventLog).values({
    event_id: uuidv7(),
    event_type: EventType.AttentionItemRouted,
    event_version: 1,
    occurred_at: occurredAt,
    correlation_id: taskId,
    actor_id: null,
    payload: {
      queue_id: queueId,
      assessment_id: assessmentId,
      task_id: taskId,
      action: item.action,
      policy_version: 1,
      rule_id: `r-${item.id}`,
      deferred: false,
    },
  });

  if (item.outcome === 'FLYTHROUGH_DEFECT') {
    // The auto-approved change later needed attention we failed to route it to.
    await db.insert(taskStateHistory).values({
      id: uuidv7(),
      task_id: taskId,
      from_state: 'AWAITING_REVIEW',
      to_state: 'REWORK',
      triggered_by: 'verification',
      attempt_number: 1,
      occurred_at: new Date(occurredAt.getTime() + 2 * MINUTE),
    });
    return;
  }

  const decision = item.outcome as 'APPROVED' | 'REJECTED';
  const decisionId = uuidv7();
  await db.insert(decisions).values({
    id: decisionId,
    correlation_id: taskId,
    change_id: changeId,
    assessment_id: assessmentId,
    decision,
    reviewer_id: REVIEWER.id,
    actor_id: REVIEWER.id,
    actor_email: REVIEWER.email,
    rationale: `seeded ${decision} (day-10 checkpoint)`,
    created_at: decidedAt,
  });
  await db.insert(assessmentFeedback).values({
    id: uuidv7(),
    assessment_id: assessmentId,
    was_useful: decision === 'REJECTED',
    created_at: decidedAt,
  });
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env (repo root).');
  }
  const db = createDb(connectionString);
  try {
    await seedReviewer(db);
    let i = 0;
    for (const item of SEED) {
      await seedItem(db, item, i);
      i += 1;
    }
    // Latest row is a decision at route+6min, so a +10min headroom covers it.
    const from = new Date(NOW.getTime() - (SEED.length + 1) * MINUTE);
    const to = new Date(NOW.getTime() + 10 * MINUTE);
    console.log(
      `[seed:metrics-checkpoint] seeded ${SEED.length} decidable items ` +
        `(actor=${REVIEWER.email}). Window: ${from.toISOString()} .. ${to.toISOString()}`,
    );
  } finally {
    await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error('[seed:metrics-checkpoint] FAILED:', err);
    process.exit(1);
  },
);
