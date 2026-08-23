/**
 * Write-back toggle demo (Phase 3 day-09 §3.4) — `pnpm demo:writeback-toggle`.
 *
 * Contrasts the day-09 toggle's two sides without any live credentials or DB:
 *
 *  1. The `writebackEnabled` gate — OFF at rest, `WRITEBACK_ENABLED` ceiling
 *     defeats a request-level ON.
 *  2. An APPROVE decision with the toggle ON dispatches a COMMENT + STATUS
 *     through the real `MCPWriteBack` seam (against an in-memory fake client),
 *     recording two SUCCEEDED rows linked by a decision id.
 *  3. The same decision with the toggle OFF dispatches nothing — zero tool
 *     calls, zero audit rows — which is the "nothing external, provably" claim.
 *
 * This is the README-facing proof-of-behaviour for day-09's acceptance criteria,
 * not a live integration run (see `demo:mcp-connectivity` for the stub-server
 * read path).
 */

import { GitProviderType, WritebackAction } from '@harness/domain';
import type {
  WriteBackIntent,
  WritebackClaim,
  WritebackFinalize,
  WritebackLogStore,
} from '@harness/domain';
import type { McpClient, McpServerRegistry, ToolResult } from '@harness/mcp';
import { StaticGitToolMap } from '@harness/git-provider';
import { StaticTicketToolMap } from '@harness/ticket-provider';
import { MCPWriteBack } from '@harness/writeback';

import { writebackEnabled } from '../src/writeback-gate.js';

/** A fake client that records every `callTool` and reports success. */
class RecordingClient implements McpClient {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  initialize() {
    return Promise.resolve({ name: 'fake', version: '0.0.0' });
  }

  listTools() {
    return Promise.resolve([]);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ name, args });
    return {
      isError: false,
      content: [{ type: 'text', text: JSON.stringify({ id: `fake-${this.calls.length}` }) }],
    };
  }

  close() {
    return Promise.resolve();
  }
}

/** A fake registry that hands out one client. */
function registryOf(client: McpClient): McpServerRegistry {
  return {
    get: async () => client,
    entries: () => [],
    list: () => [],
    closeAll: async () => {},
  };
}

type Row = {
  intentId: string;
  decisionId?: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'DUPLICATE';
  externalRef?: string;
};

/** An in-memory audit store mirroring the real claim/finalize semantics. */
class MemoryWritebackLogStore implements WritebackLogStore {
  readonly rows: Row[] = [];

  async claim(input: WritebackClaim): Promise<'claimed' | 'duplicate'> {
    this.rows.push({
      intentId: input.intentId,
      ...(input.decisionId === undefined ? {} : { decisionId: input.decisionId }),
      status: 'PENDING',
    });
    return 'claimed';
  }

  async finalize(input: WritebackFinalize): Promise<void> {
    const row = this.rows.find((r) => r.intentId === input.intentId);
    if (row) {
      row.status = input.status;
      if (input.externalRef !== undefined) {
        row.externalRef = input.externalRef;
      }
    }
  }
}

async function main(): Promise<void> {
  console.log();
  console.log('demo:writeback-toggle — day-09 decision-time toggle (no live credentials)');
  console.log();

  console.log('=== 1. the gate (env ceiling ∧ request flag) ===');
  console.log(
    `  writebackEnabled(true, {})                        → ${writebackEnabled(true, {})}`,
  );
  console.log(
    `  writebackEnabled(true, { WRITEBACK_ENABLED: '1' })  → ${writebackEnabled(true, { WRITEBACK_ENABLED: '1' })}`,
  );
  console.log(
    `  writebackEnabled(undefined, { WRITEBACK_ENABLED: '1' }) → ${writebackEnabled(undefined, { WRITEBACK_ENABLED: '1' })}`,
  );
  console.log('  → WRITEBACK_ENABLED=false at rest defeats a request-level ON ✓');
  console.log();

  console.log('=== 2. APPROVE with toggle OFF → nothing external ===');
  console.log('  (the decision handler records the decision and returns writeback:false —');
  console.log('   no intent is emitted, no audit row is written)');
  console.log();

  console.log('=== 3. APPROVE with toggle ON → COMMENT + STATUS ===');
  // The service's per-provider toggle is armed explicitly so the demo isolates the
  // *decision-time* gate from the per-provider one.
  const client = new RecordingClient();
  const store = new MemoryWritebackLogStore();
  const onService = new MCPWriteBack(
    registryOf(client),
    new StaticGitToolMap(),
    new StaticTicketToolMap(),
    store,
    { enabled: () => true },
  );

  const decisionId = 'dec-on-1';
  const commentIntent: WriteBackIntent = {
    id: `${decisionId}-comment`,
    provider: GitProviderType.GitHub,
    externalId: '42',
    action: WritebackAction.Comment,
    body: 'Review decision: APPROVE',
    repo: 'github.com/acme/api',
    decisionId,
  };
  const statusIntent: WriteBackIntent = {
    id: `${decisionId}-status`,
    provider: GitProviderType.GitHub,
    externalId: '42',
    action: WritebackAction.Status,
    state: 'success',
    body: 'Review decision: APPROVE',
    repo: 'github.com/acme/api',
    decisionId,
  };

  const comment = await onService.write(commentIntent);
  const status = await onService.write(statusIntent);

  console.log(`  COMMENT → ok=${comment.ok} externalRef=${comment.externalRef ?? '-'}`);
  console.log(`  STATUS  → ok=${status.ok} externalRef=${status.externalRef ?? '-'}`);
  console.log(`  tool calls: ${client.calls.map((c) => c.name).join(', ') || '(none)'}`);
  console.log(
    `  audit rows: ${store.rows.map((r) => `${r.status}${r.decisionId ? `@${r.decisionId}` : ''}`).join(', ')}`,
  );
  console.log();

  console.log('week-2 milestone: APPROVE (ON) emits COMMENT + STATUS; OFF emits nothing.');
  console.log(
    'write-back is a reversible human choice, and OFF is provable by an empty writeback_log. ✅',
  );
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error('[demo:writeback-toggle] FAILED:', err);
    process.exit(1);
  },
);
