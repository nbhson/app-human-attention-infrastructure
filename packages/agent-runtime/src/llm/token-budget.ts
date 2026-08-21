/**
 * `TokenBudget` (day-11 §2.4) — tracks token spend per agent run.
 *
 * When the running total exceeds the limit it throws
 * {@link TokenBudgetExceededError}, whose message (`TOKEN_BUDGET_EXCEEDED`) is
 * classified `RESOURCE` by `classifyError` (day-10) — so the WorkflowRunner
 * retries after a cooldown rather than escalating immediately.
 */

/** Thrown when a run spends more tokens than its budget permits. */
export class TokenBudgetExceededError extends Error {
  constructor(used: number, limit: number) {
    super(`TOKEN_BUDGET_EXCEEDED: used=${used} limit=${limit}`);
    this.name = 'TokenBudgetExceededError';
  }
}

export class TokenBudget {
  private used = 0;

  constructor(private readonly limit: number) {}

  /** Add a call's combined token count, throwing if it exceeds the limit. */
  consume(usage: { inputTokens: number; outputTokens: number }): void {
    this.used += usage.inputTokens + usage.outputTokens;
    if (this.used > this.limit) {
      throw new TokenBudgetExceededError(this.used, this.limit);
    }
  }

  get remaining(): number {
    return this.limit - this.used;
  }
}
