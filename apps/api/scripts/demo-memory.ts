/**
 * Week-4 review-memory checkpoint demo (Phase 3 day-20 §3.1) — `pnpm demo:memory`.
 *
 * Proves the Week-4 milestone end to end: **write a review outcome into memory and
 * read it back, relevance-scored, into the next review's context** — through the
 * *real* pipeline, never a sidestepped store. One completed review is emitted as
 * its domain event; the ingestor distills and persists it with evidence provenance;
 * the retriever ranks it for a new review touching the same subject; the resolver
 * injects the top-K as a `memory` section on an assembled context snapshot; and the
 * three lifecycle stages (consolidate / decay / archive) are demonstrated live on
 * that data.
 *
 * It runs hermetically: `createTestDb('harness_demo_memory')` builds an isolated
 * Postgres schema, applies migrations, and is dropped at the end — no live API
 * key, no network, no shared database mutation. The only external dependency is a
 * reachable Postgres (`postgres://harness:harness@localhost:5432/harness` default).
 *
 * What is *stubbed*, and why, is stated on the line: the `MemoryDistiller` is the
 * deterministic extractor (day-17) — no LLM, so a demo that asserts "the memory
 * changed" does so over reproducible evidence, not a model's opinion.
 */

import { eq } from 'drizzle-orm';

import { memoryEntries, memoryEntryEvidence, evidence, reviewFindings, reviewReports } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import {
  EventType,
  MemoryKind,
  ReviewSeverity,
  ReviewVerdict,
  createContextSnapshot,
  newContextID,
  newCorrelationID,
  newEvidenceID,
  newMemoryID,
  newReviewFindingID,
  newReviewReportID,
  newTaskID,
} from '@harness/domain';
import type { MemoryEntry, MemoryID, TaskID, ReviewReportID } from '@harness/domain';
import { InProcessEventBus, createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { MemoryContextResolver } from '@harness/context-engine';
import type { ContextMemorySectionEntry } from '@harness/context-engine';
import {
  MemoryDistiller,
  MemoryIngestor,
  MemoryRetriever,
  MemoryStore,
  applyDecay,
  archiveBelowThreshold,
  consolidateChains,
} from '@harness/memory';

const SCHEMA = 'harness_demo_memory';
const PR_URL = 'https://github.com/acme/api/pull/42';
/** The next review's query — same subject, so past memory should surface. */
const QUERY_TEXT = 'the widget endpoint payload needs a null guard before persisting';

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`[demo:memory] assertion failed: ${label}`);
  }
}

function section(step: string, title: string): void {
  console.log();
  console.log(`=== ${step} — ${title} ===`);
}

/** Lowercase alphanumeric tokens — the same shape the retriever's lexical term uses. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** How many of the query's tokens appear in `content` (the retriever's "match" signal). */
function lexicalHits(queryText: string, content: string): { hits: number; total: number } {
  const query = tokenize(queryText);
  const contentTokens = new Set(tokenize(content));
  let hits = 0;
  for (const token of query) {
    if (contentTokens.has(token)) {
      hits += 1;
    }
  }
  return { hits, total: query.length };
}

let testDb!: TestDb;
let db!: DrizzleDB;
let bus!: IEventBus;
let store!: MemoryStore;

/** Poll `listByKind` until `count` entries exist — the ingest handler is fire-and-forget. */
async function waitForEntries(kind: MemoryEntry['kind'], count: number): Promise<MemoryEntry[]> {
  const deadline = Date.now() + 4_000;
  for (;;) {
    const entries = await store.listByKind(kind);
    if (entries.length >= count) {
      return entries;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${count} ${kind} entries`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Seed one review report + two findings (task_id null — the review slice runs without a task). */
async function seedReport(): Promise<{ reportId: ReviewReportID; taskId: TaskID }> {
  const reportId = newReviewReportID();
  await db.insert(reviewReports).values({
    id: reportId,
    pr_url: PR_URL,
    pr_number: 42,
    repo: 'acme/api',
    pr_title: 'Add widget endpoint',
    ai_provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    summary: 'Adds the /widget endpoint; the payload dereference needs a guard.',
    overall_verdict: ReviewVerdict.RequestChanges,
    pr_payload: { files: [] },
  });
  await db.insert(reviewFindings).values([
    {
      id: newReviewFindingID(),
      report_id: reportId,
      severity: ReviewSeverity.Critical,
      file: 'src/widget.ts',
      line: 42,
      message: 'Missing null check on user input',
      suggestion: 'Guard against null before dereferencing the payload',
      order_index: 0,
    },
    {
      id: newReviewFindingID(),
      report_id: reportId,
      severity: ReviewSeverity.Major,
      file: 'src/widget.ts',
      message: 'Unvalidated request body flows to the store',
      suggestion: 'Validate the DTO before persisting',
      order_index: 1,
    },
  ]);
  return { reportId, taskId: newTaskID() };
}

/** Emit the completed-review event that the ingestor subscribes to. */
function publishReportCreated(reportId: ReviewReportID, taskId: TaskID): void {
  bus.publish(
    createEvent(EventType.ReviewReportCreated, newCorrelationID(), {
      task_id: taskId,
      review_report_id: reportId,
      pr_url: PR_URL,
      finding_count: 2,
      suggestion_count: 0,
    }),
  );
}

/** Insert a REVIEW entry directly (with one evidence link) for the lifecycle legs. */
async function seedEntry(
  content: string,
  overrides: {
    confidence: number;
    createdAt?: Date;
  },
): Promise<MemoryID> {
  const id = newMemoryID();
  const evidenceId = newEvidenceID();
  await db.insert(evidence).values({
    id: evidenceId,
    content_hash: `sha256:${id}`,
    kind: 'DIFF',
    body: 'recorded diff',
  });
  await db.insert(memoryEntries).values({
    id,
    kind: MemoryKind.REVIEW,
    content,
    confidence: overrides.confidence,
    confidence_floor: 10,
    status: 'ACTIVE',
    supersedes: null,
    ...(overrides.createdAt !== undefined ? { created_at: overrides.createdAt } : {}),
    metadata: {},
  });
  await db.insert(memoryEntryEvidence).values({
    id: newMemoryID(),
    memory_entry_id: id,
    evidence_id: evidenceId,
  });
  return id;
}

/** Raw `memory_entries` row by id (for confidence/status assertion). */
async function entryRow(id: MemoryID): Promise<typeof memoryEntries.$inferSelect> {
  const rows = await db.select().from(memoryEntries).where(eq(memoryEntries.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`no entry ${id}`);
  }
  return row;
}

async function main(): Promise<void> {
  console.log();
  console.log('demo:memory — day-20 Week-4 checkpoint (write → read → lifecycle, all real)');
  console.log();

  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
  // The composition root wires these from the container in the server; the demo
  // binds them directly against the isolated schema (the app host owns both).
  bus = new InProcessEventBus();
  store = new MemoryStore(db, bus);
  const ingestor = new MemoryIngestor(db, bus, store, new MemoryDistiller());
  ingestor.subscribe();

  // --- 1. Write: event → ingest → grounded memory --------------------------------
  section('1', 'write — emit review.report_created, ingest into grounded memory');
  const { reportId, taskId } = await seedReport();
  publishReportCreated(reportId, taskId);

  const reviews = await waitForEntries(MemoryKind.REVIEW, 1);
  const findings = await waitForEntries(MemoryKind.FINDING, 2);
  const reviewV1Id = reviews[0]?.id;
  if (reviewV1Id === undefined) {
    throw new Error('[demo:memory] assertion failed: one REVIEW entry written');
  }

  console.log(`  ingested ${reviews.length} REVIEW + ${findings.length} FINDING entries:`);
  for (const entry of [...reviews, ...findings]) {
    const evidenceCount = entry.sourceEvidence.length;
    assert(evidenceCount >= 1, `every entry cites ≥1 evidence (got ${evidenceCount})`);
    console.log(`    [${entry.kind}] ${entry.content.split('\n')[0] ?? ''}`);
    console.log(`      confidence=${entry.confidence}  evidence=${entry.sourceEvidence.length}`);
  }
  console.log();
  console.log('  → every ingested entry cites ≥1 evidence row (the ≥1 provenance invariant).');

  // --- 2. Read: retrieve → relevance-scored top-K into the next review's context ---
  section('2', 'read — retrieve top-K for a new review touching the same subject');
  const retriever = new MemoryRetriever(store, () => new Date());
  const resolver = new MemoryContextResolver(retriever);

  const results = await retriever.retrieve({ text: QUERY_TEXT, limit: 10 });
  assert(results.length > 0, 'retrieval returns at least one entry');
  assert(results[0]!.relevance > 0, 'the top entry has non-zero relevance');

  console.log('  query:', QUERY_TEXT);
  console.log('  top-K by relevance (signals: match / confidence / recency / popularity):');
  console.log('  kind       confidence  lexical      age(d)  retrieved  relevance  content');
  for (const { entry, relevance } of results) {
    const { hits, total } = lexicalHits(QUERY_TEXT, entry.content);
    const ageDays = (Date.now() - entry.createdAt.getTime()) / 86_400_000;
    console.log(
      `  ${entry.kind.padEnd(10)} ${String(entry.confidence).padStart(6)}      ` +
        `${hits}/${total}`.padEnd(11) +
        `${ageDays.toFixed(3).padStart(7)}  ${String(entry.retrievedCount).padStart(8)}   ` +
        `${relevance.toFixed(3).padStart(8)}  ${(entry.content.split('\n')[0] ?? '').slice(0, 48)}`,
    );
  }
  console.log();
  console.log('  → relevance is auditable: the score + the signals behind it, not vibes.');

  // Resolver injects the same top-K as a `memory` section on an assembled snapshot.
  const snapshot = createContextSnapshot({
    id: newContextID(),
    taskId,
    sources: [],
    totalTokens: 0,
    rankMethod: 'keyword',
  });
  const assembled = await resolver.inject(snapshot, { text: QUERY_TEXT });
  const memorySection = assembled.metadata.memory as readonly ContextMemorySectionEntry[] | undefined;
  if (!Array.isArray(memorySection) || memorySection.length === 0) {
    throw new Error('[demo:memory] assertion failed: memory section is non-empty');
  }
  console.log();
  console.log(`  assembled context: ${memorySection.length} memory entry/ies injected as \`metadata.memory\` —`);
  console.log("  the next review's context is changed, not just the store.");
  for (const m of memorySection) {
    console.log(
      `    [${m.kind}] conf=${m.confidence} rel=${m.relevance.toFixed(3)}  ${m.content.split('\n')[0] ?? ''}`,
    );
  }

  // --- 3. Lifecycle: consolidate -------------------------------------------------
  section('3', 'lifecycle·consolidate — re-ingest the same review, fold the chain');
  publishReportCreated(reportId, taskId); // same report again → versions onto itself
  await waitForEntries(MemoryKind.REVIEW, 2);
  await waitForEntries(MemoryKind.FINDING, 4);

  const consolid = await consolidateChains(db, bus);
  assert(consolid.mergedChains >= 3, `≥3 chains merged (got ${consolid.mergedChains})`);
  assert(consolid.archived >= 3, `superseded versions archived (got ${consolid.archived})`);
  assert((await entryRow(reviewV1Id)).status === 'ARCHIVED', 'superseded REVIEW archived');
  const activeReviews = await store.listByKind(MemoryKind.REVIEW);
  assert(
    !activeReviews.some((entry) => entry.id === reviewV1Id),
    'superseded REVIEW excluded from retrieval (head of chain only)',
  );
  console.log(
    `  re-ingest chained ${consolid.mergedChains} version-chains; consolidate archived ` +
      `${consolid.archived} superseded rows, folded ${consolid.foldedLinks} evidence links.`,
  );
  console.log('  → retrieval now surfaces only the chain head; the superseded row is audit-retained.');

  // --- 4. Lifecycle: decay --------------------------------------------------------
  section('4', 'lifecycle·decay — an untouched entry fades to its confidence floor');
  const staleId = await seedEntry('stale: unguarded widget-endpoint dereference', {
    confidence: 100,
    createdAt: new Date(Date.now() - 30 * 86_400_000),
  });
  const before = (await entryRow(staleId)).confidence;
  const decayed = await applyDecay(db, { now: new Date(), factorPerDay: 0.9, graceDays: 7 });
  const after = (await entryRow(staleId)).confidence;
  assert(decayed.decayed === 1, `exactly one entry decayed (got ${decayed.decayed})`);
  assert(after < before && after === 10, `decay tapers to the floor (${before} → ${after})`);
  console.log(
    `  decay(now, factor 0.9/day): ${before} → ${after} (floor 10) after 30 days untouched; ` +
      `${decayed.skipped} fresh entries skipped (grace window).`,
  );

  // --- 5. Lifecycle: archive ------------------------------------------------------
  section('5', 'lifecycle·archive — a below-threshold entry is soft-deleted, audit-retained');
  const forgottenId = await seedEntry('forgotten: one-off noise finding', { confidence: 2 });
  const archived = await archiveBelowThreshold(db, bus);
  assert(archived.archived === 1, `exactly one entry archived (got ${archived.archived})`);
  assert((await entryRow(forgottenId)).status === 'ARCHIVED', 'below-threshold entry archived');
  const listedIds = (await store.listByKind(MemoryKind.REVIEW)).map((entry) => entry.id);
  assert(!listedIds.includes(forgottenId), 'archived entry excluded from retrieval');
  assert((await store.getById(forgottenId))?.status === 'ARCHIVED', 'archived entry retained for audit');
  console.log(`  archive: confidence 2 < threshold 5 → ARCHIVED; excluded from retrieval, reachable by id.`);

  // --- 6. Teardown + summary -------------------------------------------------------
  section('6', 'week-4 milestone — memory is closed (write + read + lifecycle)');
  const finalReviews = await store.listByKind(MemoryKind.REVIEW);
  console.log(
    `  final active REVIEW entries: ${finalReviews.length} (head + decayed-still-useful; superseded + forgotten archived).`,
  );
  console.log();
  console.log('  write ✓   event → ingest → 3 grounded entries, each ≥1 evidence.');
  console.log('  read  ✓   retrieve → top-K relevance-scored → memory section in context.');
  console.log('  life  ✓   consolidate + decay + archive all demonstrated live.');
  console.log();
  console.log('week-4 milestone: review memory is demonstrably closed. ✅');
}

void (async () => {
  try {
    await main();
  } catch (err) {
    console.error('[demo:memory] FAILED:', err);
    if (testDb) {
      await destroyTestDb(testDb, SCHEMA).catch(() => undefined);
    }
    process.exit(1);
  }
  if (testDb) {
    await destroyTestDb(testDb, SCHEMA);
  }
  process.exit(0);
})();
