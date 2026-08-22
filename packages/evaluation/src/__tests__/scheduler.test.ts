/**
 * Tests for `ReportScheduler` (day-07 §2.4).
 *
 * The cron dependency is injected via {@link CronLike}, so these tests assert the
 * expression/tick wiring with a fake adapter — no real `node-cron` thread is ever
 * started, and the process exits cleanly.
 */

import { describe, expect, it, vi } from 'vitest';

import { ReportScheduler, type CronLike } from '../scheduler.js';

/** Records what `schedule` was called with and returns a controllable handle. */
function fakeCron() {
  const calls: Array<{ expression: string; task: () => void }> = [];
  const handles = new Array<{ stop: ReturnType<typeof vi.fn> }>();
  const adapter: CronLike = {
    schedule(expression, task) {
      const stop = vi.fn();
      calls.push({ expression, task });
      handles.push({ stop });
      return { stop };
    },
  };
  return { adapter, calls, handles };
}

describe('ReportScheduler', () => {
  it('is inert until start() — no cron schedule on construction', () => {
    const { adapter, calls } = fakeCron();
    const ignore = new ReportScheduler(adapter, '0 6 * * 1', async () => {});
    void ignore;
    expect(calls).toHaveLength(0);
  });

  it('schedules the tick on the given expression once started', () => {
    const { adapter, calls } = fakeCron();
    const tick = vi.fn(async () => {});
    const scheduler = new ReportScheduler(adapter, '0 6 * * 1', tick);

    scheduler.start();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.expression).toBe('0 6 * * 1');
    // Invoking the wrapped task runs the tick (fire-and-forget).
    calls[0]?.task();
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('delegates stop() to the cron handle once started', () => {
    const { adapter, handles } = fakeCron();
    const scheduler = new ReportScheduler(adapter, '0 6 * * 1', async () => {});

    scheduler.start();
    scheduler.stop();

    expect(handles).toHaveLength(1);
    expect(handles[0]?.stop).toHaveBeenCalledTimes(1);

    // stop() on an already-stopped scheduler is a no-op (never double-stops).
    scheduler.stop();
    expect(handles[0]?.stop).toHaveBeenCalledTimes(1);
  });
});
