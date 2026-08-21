/**
 * Sandbox path safety (day-20 §2.2 / §6) — a local duplicate of the Day-13
 * `resolveSafe` in `@harness/agent-runtime`/tools. Context Engine is a sibling
 * engine (boundary R4): it may not import the agent-runtime, so this copy lives
 * here. The logic is identical — a separator-aware `root + sep` prefix check that
 * rejects both `..` traversal and absolute paths outside the root.
 */

import { resolve, sep } from 'node:path';

/**
 * Resolve `rel` against `root`, guaranteeing the result stays inside `root`.
 *
 * @throws `PATH_TRAVERSAL_REJECTED: <rel>` when the result escapes `root`.
 */
export function resolveSafe(root: string, rel: string): string {
  const resolved = resolve(root, rel);
  const resolvedRoot = resolve(root);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + sep)) {
    throw new Error(`PATH_TRAVERSAL_REJECTED: ${rel}`);
  }
  return resolved;
}
