import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DispatchLoop } from '../dispatch/dispatch-loop.js';
import type { DispatchLoopLogger } from '../dispatch/dispatch-loop.js';
import type { Dispatcher } from '../dispatch/dispatcher.js';

/** A stub Dispatcher — only `dispatchPending` matters to the loop. */
function stubDispatcher(dispatchPending = vi.fn()) {
  return { dispatchPending } as unknown as Dispatcher;
}

function stubLogger(): DispatchLoopLogger & {
  debug: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return { debug: vi.fn(), error: vi.fn() };
}

describe('DispatchLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() triggers dispatchPending on the first tick', async () => {
    const dispatchPending = vi.fn().mockResolvedValue({ dispatched: 0, skipped: 0, failed: 0 });
    const loop = new DispatchLoop(stubDispatcher(dispatchPending), stubLogger());

    loop.start(1000);
    expect(loop.running).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(dispatchPending).toHaveBeenCalledTimes(1);
  });

  it('stop() prevents further ticks', async () => {
    const dispatchPending = vi.fn().mockResolvedValue({ dispatched: 0, skipped: 0, failed: 0 });
    const loop = new DispatchLoop(stubDispatcher(dispatchPending), stubLogger());

    loop.start(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(dispatchPending).toHaveBeenCalledTimes(1);

    loop.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(dispatchPending).toHaveBeenCalledTimes(1);
  });

  it('an unexpected Dispatcher error does not stop the loop', async () => {
    const dispatchPending = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ dispatched: 0, skipped: 0, failed: 0 });
    const logger = stubLogger();
    const loop = new DispatchLoop(stubDispatcher(dispatchPending), logger);

    loop.start(1000);
    await vi.advanceTimersByTimeAsync(1000); // tick fails
    await vi.advanceTimersByTimeAsync(1000); // next tick still fires

    expect(dispatchPending).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.any(Error));
  });

  it('running is false after stop()', () => {
    const loop = new DispatchLoop(
      stubDispatcher(vi.fn().mockResolvedValue({ dispatched: 0, skipped: 0, failed: 0 })),
      stubLogger(),
    );

    expect(loop.running).toBe(false);
    loop.start(1000);
    expect(loop.running).toBe(true);
    loop.stop();
    expect(loop.running).toBe(false);
  });
});
