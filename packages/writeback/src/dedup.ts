/**
 * Idempotency fingerprint for write-back (day-08 §2.2).
 *
 * A retry of the same intent must never double-post, so the dedup key folds the
 * *target identity* and the *payload* into one stable hash. The target identity
 * is the concrete provider + external id + action; the payload is the effective
 * text the write sends (comment body / status summary / label / target status),
 * normalised so a merely-reformatted retry (extra whitespace) collapses to the
 * same key. The stored `body` keeps the caller's original text — only this
 * fingerprint is normalised (day-08 §6).
 */

import { createHash } from 'node:crypto';

import { WritebackAction } from '@harness/domain';
import type { WriteBackIntent } from '@harness/domain';

/** Trim and collapse runs of whitespace to a single space. */
export function normalizeBody(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The payload a write actually sends, expressed as a single string for the
 * fingerprint. Mirrors how `MCPWriteBack` maps each action to a tool's argument.
 */
export function effectiveBody(intent: WriteBackIntent): string {
  switch (intent.action) {
    case WritebackAction.Comment:
      return intent.body ?? '';
    case WritebackAction.Status:
      return `${intent.state ?? 'pending'} ${intent.body ?? ''}`.trim();
    case WritebackAction.Label:
      return intent.label ?? intent.body ?? '';
    case WritebackAction.Transition:
      return intent.toState ?? intent.label ?? '';
  }
}

/**
 * `sha256(provider | externalId | action | normalized payload)`.
 *
 * Two intents dedup as the same write iff they target the same provider + item
 * with the same action and the same (normalised) content.
 */
export function dedupKey(intent: WriteBackIntent): string {
  const joined = [
    intent.provider,
    intent.externalId,
    String(intent.action),
    normalizeBody(effectiveBody(intent)),
  ].join('|');
  return createHash('sha256').update(joined).digest('hex');
}
