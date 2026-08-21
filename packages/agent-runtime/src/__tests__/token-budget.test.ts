import { describe, expect, it } from 'vitest';

import { TokenBudget, TokenBudgetExceededError } from '../llm/token-budget.js';

describe('TokenBudget', () => {
  it('does not throw when within budget', () => {
    const budget = new TokenBudget(100);

    expect(() => budget.consume({ inputTokens: 40, outputTokens: 50 })).not.toThrow();
    expect(budget.remaining).toBe(10);
  });

  it('throws TokenBudgetExceededError when the limit is exceeded', () => {
    const budget = new TokenBudget(100);

    expect(() => budget.consume({ inputTokens: 60, outputTokens: 50 })).toThrow(
      TokenBudgetExceededError,
    );
  });

  it('message carries TOKEN_BUDGET_EXCEEDED with used and limit', () => {
    const budget = new TokenBudget(100);

    try {
      budget.consume({ inputTokens: 70, outputTokens: 40 });
      throw new Error('expected consume to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(TokenBudgetExceededError);
      expect((error as Error).message).toBe('TOKEN_BUDGET_EXCEEDED: used=110 limit=100');
    }
  });

  it('remaining decreases across multiple consumes', () => {
    const budget = new TokenBudget(100);

    budget.consume({ inputTokens: 10, outputTokens: 5 });
    budget.consume({ inputTokens: 20, outputTokens: 10 });

    expect(budget.remaining).toBe(55);
  });
});
