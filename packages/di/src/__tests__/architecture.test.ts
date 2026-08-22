/**
 * Architecture tests: assert the dependency rules from Spec 1 §5 against the
 * *actual* `package.json` of each package — not a hardcoded list. If a future
 * engineer adds a cross-package import without updating the package manifest,
 * this test fails.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    expect(harnessDependencies('db').sort()).toEqual(
      ['@harness/domain', '@harness/event-bus'].sort(),
    );
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
    const instrumenting = [
      'orchestrator',
      'agent-runtime',
      'attention-engine',
      'verification-engine',
    ] as const;
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
});
