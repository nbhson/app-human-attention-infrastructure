/**
 * Sandbox path safety (day-13 §2.1 / §3.2).
 *
 * Every file tool resolves its path *through* this function, so a model-supplied
 * path can never escape {@link sandboxRoot}. The two rejected shapes are the
 * `..` traversal (`../secret`) and an absolute path outside the root
 * (`/etc/passwd`). Both resolve to a location that does not live under the root
 * and throw `PATH_TRAVERSAL_REJECTED`, the string the ReAct loop logs as the
 * tool's observation so the agent can see *why* its call was refused.
 */

import { resolve, sep } from 'node:path';

/**
 * Resolve `rel` against `root`, guaranteeing the result stays inside `root`.
 *
 * The check is separator-aware (`root + sep` prefix, or an exact match to the
 * root itself), so a sibling directory that merely *shares* the root's prefix
 * (`/sandbox` vs `/sandbox-evil`) is correctly rejected.
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
