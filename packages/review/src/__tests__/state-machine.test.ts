/**
 * Spec 8 §2.2 state-machine tests (day-24 §3.5) — the finite transition graph
 * is the normative contract; these prove illegal transitions throw and only
 * the legal ones pass.
 */

import { describe, expect, it } from 'vitest';

import { ReviewQueueStatus } from '@harness/domain';
import { ALLOWED_FROM, IllegalTransitionError, assertTransition, canTransition } from '../state-machine.js';

describe('review state machine (Spec 8 §2.2)', () => {
  describe('canTransition / assertTransition', () => {
    it('allows claim from queued', () => {
      expect(canTransition(ReviewQueueStatus.Queued, 'claim')).toBe(true);
      expect(() => assertTransition(ReviewQueueStatus.Queued, 'claim')).not.toThrow();
    });

    it('allows decide from claimed', () => {
      expect(canTransition(ReviewQueueStatus.Claimed, 'decide')).toBe(true);
    });

    it('allows release from claimed', () => {
      expect(canTransition(ReviewQueueStatus.Claimed, 'release')).toBe(true);
    });

    it('allows escalate from claimed', () => {
      expect(canTransition(ReviewQueueStatus.Claimed, 'escalate')).toBe(true);
    });

    it('allows drop from queued and claimed', () => {
      expect(canTransition(ReviewQueueStatus.Queued, 'drop')).toBe(true);
      expect(canTransition(ReviewQueueStatus.Claimed, 'drop')).toBe(true);
    });

    it('rejects claim on an already-claimed item', () => {
      expect(canTransition(ReviewQueueStatus.Claimed, 'claim')).toBe(false);
    });

    it('rejects decide on a submitted (decided) item', () => {
      expect(canTransition(ReviewQueueStatus.Decided, 'decide')).toBe(false);
    });

    it('rejects decide on an unclaimed (queued) item', () => {
      expect(canTransition(ReviewQueueStatus.Queued, 'decide')).toBe(false);
    });

    it('rejects release on a queued item (nothing held)', () => {
      expect(canTransition(ReviewQueueStatus.Queued, 'release')).toBe(false);
    });

    it('rejects escalate on a submitted item', () => {
      expect(canTransition(ReviewQueueStatus.Decided, 'escalate')).toBe(false);
    });

    it('rejects release on an escalated item', () => {
      expect(canTransition(ReviewQueueStatus.Escalated, 'release')).toBe(false);
    });

    it('rejects drop on a submitted item', () => {
      expect(canTransition(ReviewQueueStatus.Decided, 'drop')).toBe(false);
    });
  });

  describe('assertTransition failure shape', () => {
    it('throws IllegalTransitionError with from + action', () => {
      try {
        assertTransition(ReviewQueueStatus.Decided, 'decide');
        throw new Error('expected assertTransition to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(IllegalTransitionError);
        const typed = error as IllegalTransitionError;
        expect(typed.name).toBe('IllegalTransitionError');
        expect(typed.from).toBe(ReviewQueueStatus.Decided);
        expect(typed.action).toBe('decide');
        expect(typed.message).toContain('decide');
      }
    });
  });

  describe('legal-edge closure', () => {
    it('every status has a well-defined claim answer', () => {
      const statuses = Object.values(ReviewQueueStatus);
      // claim is only ever legal from QUEUED; the rest must be false.
      const claimable = statuses.filter((s) => canTransition(s, 'claim'));
      expect(claimable).toEqual([ReviewQueueStatus.Queued]);
    });

    it('ALLOWED_FROM exactly records the Spec 8 §2.2 graph', () => {
      expect(ALLOWED_FROM).toEqual({
        claim: new Set([ReviewQueueStatus.Queued]),
        decide: new Set([ReviewQueueStatus.Claimed]),
        release: new Set([ReviewQueueStatus.Claimed]),
        escalate: new Set([ReviewQueueStatus.Claimed]),
        drop: new Set([ReviewQueueStatus.Queued, ReviewQueueStatus.Claimed]),
      });
    });
  });
});
