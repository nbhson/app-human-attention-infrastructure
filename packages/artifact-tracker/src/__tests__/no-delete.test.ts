import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// This file lives at packages/artifact-tracker/src/__tests__/no-delete.test.ts;
// one `..` climbs into `src/`.
const SRC = fileURLToPath(new URL('..', import.meta.url));

/**
 * Provenance metadata is append-only (day-14 §2.3): the Artifact Tracker must
 * never issue a `DELETE`/`TRUNCATE`. Test fixtures are allowed to (they tear down
 * their own isolated schemas), so this scan skips every `__tests__` directory.
 */
const FORBIDDEN: readonly RegExp[] = [
  /\.delete\s*\(/, // Drizzle `.delete(...)`
  /delete\s+from\b/i, // raw SQL
  /truncate\b/i, // raw SQL
];

function productionSources(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .filter((file) => !file.includes('__tests__'));
}

describe('no-delete rule (day-14 §2.3)', () => {
  it('no production source issues a DELETE or TRUNCATE', () => {
    const files = productionSources();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = readFileSync(join(SRC, file), 'utf8');
      for (const pattern of FORBIDDEN) {
        expect(content, `${file} matches ${pattern} — provenance must be append-only`).not.toMatch(
          pattern,
        );
      }
    }
  });
});
