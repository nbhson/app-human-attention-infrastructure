/**
 * Architecture tests: assert the dependency rules from Spec 1 §5 against the
 * *actual* `package.json` of each package — not a hardcoded list. If a future
 * engineer adds a cross-package import without updating the package manifest,
 * this test fails.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// This file lives at packages/di/src/__tests__/architecture.test.ts; four `..`
// steps climb back to the monorepo root, independent of the process cwd.
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Engine packages (Spec 1 §5 rules R4 — they must never import each other). */
const ENGINE_PACKAGES = [
  'orchestrator',
  'agent-runtime',
  'context-engine',
  'artifact-tracker',
  'attention-engine',
  'verification-engine',
] as const;

interface PackageJson {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
}

function readPackage(packageName: string): PackageJson {
  const path = resolve(ROOT, 'packages', packageName, 'package.json');
  return JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
}

/** The `@harness/*` runtime dependencies declared by `packageName`. */
function harnessDependencies(packageName: string): string[] {
  const { dependencies = {} } = readPackage(packageName);
  return Object.keys(dependencies).filter((dep) => dep.startsWith('@harness/'));
}

describe('dependency rules (Spec 1 §5)', () => {
  it('R1: @harness/domain depends on no @harness/* package', () => {
    expect(harnessDependencies('domain')).toEqual([]);
  });

  it('R2: @harness/event-bus depends only on @harness/domain', () => {
    expect(harnessDependencies('event-bus')).toEqual(['@harness/domain']);
  });

  it('R3: @harness/db depends only on @harness/domain and @harness/event-bus', () => {
    expect(harnessDependencies('db').sort()).toEqual(['@harness/domain', '@harness/event-bus'].sort());
  });

  it('R4: no engine package depends on another engine package', () => {
    const engineNames = new Set(ENGINE_PACKAGES.map((name) => `@harness/${name}`));

    for (const engine of ENGINE_PACKAGES) {
      const forbidden = harnessDependencies(engine).filter((dep) => engineNames.has(dep));
      expect(forbidden, `${engine} imports a sibling engine package directly`).toEqual([]);
    }
  });

  it('R7: @harness/auth depends only on @harness/domain, @harness/db, @harness/event-bus, @harness/di', () => {
    // Day-02: auth.requireRole emits `authz.decision_denied` on the bus, so the
    // package now peers with @harness/event-bus (it must never import a sibling
    // *engine*).
    expect(harnessDependencies('auth').sort()).toEqual(
      ['@harness/domain', '@harness/db', '@harness/event-bus', '@harness/di'].sort(),
    );
  });

  it('R8: @harness/observability depends only on domain, db, di — and every engine depends on observability', () => {
    // Sandboxed to the shared infra + the db schema needed by the trace
    // write-through. It must NOT pull in an engine.
    const onlyShared = ['@harness/domain', '@harness/db', '@harness/di'].sort();
    expect(harnessDependencies('observability').sort()).toEqual(onlyShared);

    // Every *telemetry-carrying* engine instruments through the single
    // observability package (their spans are what make a task traceable
    // end-to-end), so each must declare the dependency. `context-engine` and
    // `artifact-tracker` do not yet emit spans (day-03 scope), so they are not
    // on this list.
    const instrumenting = ['orchestrator', 'agent-runtime', 'attention-engine', 'verification-engine'] as const;
    for (const engine of instrumenting) {
      expect(harnessDependencies(engine)).toContain('@harness/observability');
    }
  });

  it('R9: @harness/evaluation depends only on domain, db, di, observability — never an engine', () => {
    // Offline pipeline scoring sits at the same depth as shared infra: it reads
    // types (domain), the append-only store (db), the logger (di), and pushes
    // gauges (observability). It must never pull in an engine.
    expect(harnessDependencies('evaluation').sort()).toEqual(
      ['@harness/domain', '@harness/db', '@harness/di', '@harness/observability'].sort(),
    );
  });

  it('R10: @harness/embeddings depends on domain, db, event-bus — never di, observability, or an engine', () => {
    // Day-16 §2.4: the `Embedder` provider seam itself reads only domain types
    // (today it imports no domain symbol — an empty subset of "domain at most").
    // Day-17 widens the package to host the semantic index: persisting vectors
    // (`db`) and subscribing to artifact events (`event-bus`). It still must not
    // reach for the logger token (`di`) — the indexer/listener take a structural
    // `IndexLogger` — nor observability or a sibling engine.
    expect(harnessDependencies('embeddings').sort()).toEqual(
      ['@harness/domain', '@harness/db', '@harness/event-bus'].sort(),
    );
  });

  it('R11: @harness/object-store depends on no @harness/* package', () => {
    // Day-21 §2.1: the object-store seam is a pure, content-addressed byte store
    // (its only runtime dependency is the S3 SDK, which is external). Keeping it
    // free of @harness deps means every other package — engines included — may
    // import the seam without creating a cycle or a new shared-infra boundary.
    expect(harnessDependencies('object-store')).toEqual([]);
  });

  it('R12: @harness/sandbox depends on no @harness/* package', () => {
    // Day-22 §2.1: the sandbox seam is a leaf like object-store — node built-ins
    // only, no @harness runtime dependency — so verification (Day 22) and agent
    // Code Mode (Day 23) can both import the `Sandbox` interface with no cycle.
    expect(harnessDependencies('sandbox')).toEqual([]);
  });

  it('R13: @harness/git-provider depends only on @harness/domain and @harness/mcp', () => {
    // Review-reorient Phase 3: the Git-host read seam returns a domain
    // `PullRequest` (its only domain need, like every provider seam), and it
    // fronts any Git host through MCP — so it reads the MCP protocol leaf for
    // the `McpServerRegistry`/`ToolResult` types. It needs no db (report
    // persistence lives in apps/api), no event-bus, no sibling engine.
    expect(harnessDependencies('git-provider').sort()).toEqual(['@harness/domain', '@harness/mcp'].sort());
  });

  it('R14: @harness/ticket-provider depends only on @harness/domain and @harness/mcp', () => {
    // Review-reorient Phase 3: the ticket read seam returns a domain `Issue`
    // (its only domain need, like every provider seam), and it fronts Jira
    // through MCP — so it reads the MCP protocol leaf for the
    // `McpServerRegistry`/`ToolResult` types — mirroring R13.
    expect(harnessDependencies('ticket-provider').sort()).toEqual(['@harness/domain', '@harness/mcp'].sort());
  });

  it('R15: @harness/writeback depends only on domain, mcp, git-provider, ticket-provider', () => {
    // Review-reorient Phase 3 day-06: the write-back seam reads the intent/result
    // contract (domain), rides the protocol leaf (mcp), and re-uses the two
    // provider seams' capability→tool-name tables (git-provider + ticket-provider)
    // so write + read stay on one transport. It needs no db (audit lands later),
    // no event-bus, no sibling engine.
    expect(harnessDependencies('writeback').sort()).toEqual(
      ['@harness/domain', '@harness/git-provider', '@harness/mcp', '@harness/ticket-provider'].sort(),
    );
  });

  it('R16: @harness/memory depends only on domain, db, event-bus, di', () => {
    // Review-reorient Phase 3 day-16 §2.4: review memory reads domain types,
    // persists through db, publishes on the event bus, and accepts the structural
    // logger (di) — never a sibling engine. Context/Attention subscribe to
    // `memory.entry_created` via the bus instead of importing the store.
    expect(harnessDependencies('memory').sort()).toEqual(
      ['@harness/domain', '@harness/db', '@harness/event-bus', '@harness/di'].sort(),
    );
  });
  it('R17: @harness/benchmark depends only on domain, db, judge', () => {
    // Review-reorient Phase 3 day-24: the read-only evaluator reads domain value
    // types + the `Judge` seam, and persists its gold-labelled corpus through db
    // (the `review_examples` table). It never reaches for di/observability, and
    // never a sibling engine — the judge runs through the scorer seam, not by
    // importing review/attention/context.
    expect(harnessDependencies('benchmark').sort()).toEqual(
      ['@harness/domain', '@harness/db', '@harness/judge'].sort(),
    );
  });
});

/**
 * Phase-2 seam guards (day-27 §2.4 / §3.4).
 *
 * The six modular-monolith seams — `IEventBus`, `Retriever`, `Ranker`,
 * `Embedder`, `ContentStore`, `LLMProvider` (+ `Sandbox`) — must be resolved
 * through DI, never by an engine `new`-ing a concrete class. R4 already rules
 * out engines importing *each other*; the risk these guards close is subtler: an
 * engine importing the seam's shared interface package (which it is entitled to)
 * and then bypassing the seam by constructing the concrete. A module that talks
 * to S3 directly, or builds its own `InProcessEventBus`, passes every functional
 * test and breaks the modular monolith (plan §6).
 */

/** Concrete implementations of each cross-package seam, and the owning package. */
const SEAM_CONCRETES: ReadonlyArray<{ seam: string; className: string; owner: string }> = [
  { seam: 'IEventBus', className: 'InProcessEventBus', owner: 'event-bus' },
  { seam: 'Embedder', className: 'OpenAICompatibleEmbedder', owner: 'embeddings' },
  { seam: 'Retriever', className: 'SemanticRetriever', owner: 'context-engine' },
  { seam: 'Ranker', className: 'KeywordDependencyRanker', owner: 'context-engine' },
  { seam: 'Ranker', className: 'SemanticRanker', owner: 'context-engine' },
  { seam: 'ContentStore', className: 'ObjectStoreContentStore', owner: 'object-store' },
  { seam: 'ContentStore', className: 'RoutingContentStore', owner: 'object-store' },
  { seam: 'ContentStore', className: 'InMemoryContentStore', owner: 'object-store' },
  { seam: 'Sandbox', className: 'DockerSandbox', owner: 'sandbox' },
  { seam: 'LLMProvider', className: 'AnthropicProvider', owner: 'agent-runtime' },
  { seam: 'LLMProvider', className: 'MockLLM', owner: 'agent-runtime' },
  { seam: 'LLMProvider', className: 'LoggingLLMProvider', owner: 'agent-runtime' },
];

/** Recursively collect non-test `.ts` source files under a directory. */
function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'dist' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkSource(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every `new <Class>(` site for one concrete class across the engine packages,
 * *excluding* the owning package (the owner may construct its own concrete in a
 * convenience default or factory — that is not a modular-monolith bypass).
 */
function engineNewSites(className: string, owner: string): Array<{ packageName: string; file: string }> {
  const sites: Array<{ packageName: string; file: string }> = [];
  for (const engine of ENGINE_PACKAGES) {
    if (engine === owner) continue;
    const srcDir = resolve(ROOT, 'packages', engine, 'src');
    for (const file of walkSource(srcDir)) {
      if (readFileSync(file, 'utf8').includes(`new ${className}(`)) {
        sites.push({ packageName: engine, file: relative(srcDir, file) });
      }
    }
  }
  return sites;
}

describe('seam guards (day-27 §2.4 / §3.4)', () => {
  for (const { seam, className, owner } of SEAM_CONCRETES) {
    it(`${seam}: no engine instantiates its concrete (${className}) — DI only`, () => {
      const sites = engineNewSites(className, owner);
      expect(sites, `${className} bypasses the ${seam} seam via a direct \`new\``).toEqual([]);
    });
  }
});
