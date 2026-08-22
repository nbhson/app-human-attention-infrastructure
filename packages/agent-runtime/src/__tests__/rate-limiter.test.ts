/**
 * day-23 §2.3 — per-tool, per-task rate limiting.
 *
 * Two properties matter for the "runaway generated loop" threat model: a hard
 * ceiling on total calls (count), and a concurrency semaphore so calls queue
 * rather than fan out unbounded containers at once. This file locks both.
 */

import { describe, expect, it } from 'vitest';

import { PerToolRateLimiter, ToolRateLimitError } from '../code-mode/rate-limiter.js';

describe('PerToolRateLimiter', () => {
  it('passes tools with no configured limit through untouched', async () => {
    const limiter = new PerToolRateLimiter({
      write_file: { maxCallsPerTask: 2, maxConcurrent: 4 },
    });

    await expect(limiter.throttle('grep', async () => 'ok')).resolves.toBe('ok');
  });

  it('admits up to maxCallsPerTask then throws ToolRateLimitError', async () => {
    const limiter = new PerToolRateLimiter({
      write_file: { maxCallsPerTask: 2, maxConcurrent: 4 },
    });

    await limiter.throttle('write_file', async () => 1);
    await limiter.throttle('write_file', async () => 2);

    await expect(limiter.throttle('write_file', async () => 3)).rejects.toBeInstanceOf(
      ToolRateLimitError,
    );
  });

  it('counts a rejected slot before the run executes (no container allocated)', async () => {
    const limiter = new PerToolRateLimiter({
      write_file: { maxCallsPerTask: 1, maxConcurrent: 4 },
    });

    let ran = false;
    await limiter.throttle('write_file', async () => {
      ran = true;
    });
    expect(ran).toBe(true);

    await expect(
      limiter.throttle('write_file', async () => {
        ran = false;
      }),
    ).rejects.toBeInstanceOf(ToolRateLimitError);
    expect(ran).toBe(true); // the rejected call never touched its run()
  });

  it('reports the tool and ceiling on the error', async () => {
    const limiter = new PerToolRateLimiter({ git_push: { maxCallsPerTask: 5, maxConcurrent: 1 } });
    for (let i = 0; i < 5; i += 1) {
      await limiter.throttle('git_push', async () => undefined);
    }

    try {
      await limiter.throttle('git_push', async () => undefined);
      throw new Error('expected ToolRateLimitError');
    } catch (err) {
      expect(err).toBeInstanceOf(ToolRateLimitError);
      const typed = err as ToolRateLimitError;
      expect(typed.tool).toBe('git_push');
      expect(typed.maxCallsPerTask).toBe(5);
    }
  });

  it('serializes runs when maxConcurrent is 1', async () => {
    const limiter = new PerToolRateLimiter({
      write_file: { maxCallsPerTask: 10, maxConcurrent: 1 },
    });

    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = limiter.throttle('write_file', async () => {
      order.push('first-start');
      await gate;
      order.push('first-end');
      return 'a';
    });
    // `run` executes synchronously up to the gate, so "first-start" is recorded
    // before the first `throttle` promise yields.
    expect(order).toEqual(['first-start']);

    const second = limiter.throttle('write_file', async () => {
      order.push('second-start');
      return 'b';
    });
    // The second call is queued behind the concurrency gate — nothing ran.
    expect(order).toEqual(['first-start']);

    release();
    await Promise.all([first, second]);

    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
  });
});
