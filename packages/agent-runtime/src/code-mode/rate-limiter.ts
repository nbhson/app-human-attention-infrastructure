/**
 * Per-tool, per-task rate limiting for sandboxed Code-Mode execution
 * (day-23 §2.3 / Spec 3 §14.2).
 *
 * The limiter bounds both the *count* and the *concurrency* of sandboxed tool
 * calls so a runaway generated loop (`while(true) write_file`) cannot spin up
 * unbounded containers or write storms. Exceeding `maxCallsPerTask` throws
 * {@link ToolRateLimitError}, which the orchestrator surfaces as a catchable
 * error — never as model input.
 *
 * The limiter is generic over the run's result type so it can sit under the
 * `SandboxedToolExecutor` (which maps a {@link SandboxResult} to a `ToolResult`)
 * without importing the sandbox types itself.
 */

/** Per-tool budget: how many calls a task may make, and how many run at once. */
export interface RateLimitConfig {
  readonly maxCallsPerTask: number;
  readonly maxConcurrent: number;
}

/** Thrown when a tool has exhausted its per-task call budget. */
export class ToolRateLimitError extends Error {
  override readonly name = 'ToolRateLimitError';

  constructor(
    readonly tool: string,
    readonly maxCallsPerTask: number,
  ) {
    super(`${tool} exceeded its ${maxCallsPerTask} call-per-task limit`);
  }
}

/** Bounds sandboxed execution by tool. */
export interface RateLimiter {
  throttle<T>(tool: string, run: () => Promise<T>): Promise<T>;
}

/**
 * A per-task, per-tool limiter: a hard ceiling on total calls plus a concurrency
 * semaphore that queues callers when `maxConcurrent` is reached. Tools with no
 * configured limit run through untouched.
 */
export class PerToolRateLimiter implements RateLimiter {
  private readonly started = new Map<string, number>();
  private readonly inFlight = new Map<string, number>();
  private readonly waiters = new Map<string, Array<() => void>>();

  constructor(private readonly configs: Readonly<Record<string, RateLimitConfig>>) {}

  async throttle<T>(tool: string, run: () => Promise<T>): Promise<T> {
    const cfg = this.configs[tool];
    if (!cfg) {
      return run();
    }

    // Count is admitted up front so a full slot — even one queued behind the
    // concurrency gate — is rejected before it can allocate a container.
    const used = this.started.get(tool) ?? 0;
    if (used >= cfg.maxCallsPerTask) {
      throw new ToolRateLimitError(tool, cfg.maxCallsPerTask);
    }
    this.started.set(tool, used + 1);

    while ((this.inFlight.get(tool) ?? 0) >= cfg.maxConcurrent) {
      await new Promise<void>((resolve) => this.waitersFor(tool).push(resolve));
    }

    this.inFlight.set(tool, (this.inFlight.get(tool) ?? 0) + 1);
    try {
      return await run();
    } finally {
      this.inFlight.set(tool, (this.inFlight.get(tool) ?? 1) - 1);
      const next = this.waitersFor(tool).shift();
      next?.();
    }
  }

  private waitersFor(tool: string): Array<() => void> {
    const existing = this.waiters.get(tool);
    if (existing) {
      return existing;
    }
    const created: Array<() => void> = [];
    this.waiters.set(tool, created);
    return created;
  }
}
