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
});
