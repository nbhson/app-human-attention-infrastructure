import { describe, expect, it } from 'vitest';

import { classifyError } from '../retry/classify-error.js';

describe('classifyError', () => {
  it('classifies network errors and timeouts as TRANSIENT', () => {
    expect(classifyError(new Error('connect ECONNRESET')).class).toBe('TRANSIENT');
    expect(classifyError(new Error('socket ETIMEDOUT')).class).toBe('TRANSIENT');
    expect(classifyError(new Error('ECONNREFUSED')).class).toBe('TRANSIENT');
    expect(classifyError(new Error('STEP_TIMEOUT')).class).toBe('TRANSIENT');
  });

  it('classifies rate-limit and quota errors as RESOURCE', () => {
    expect(classifyError(new Error('LLM_RATE_LIMIT: slow down')).class).toBe('RESOURCE');
    expect(classifyError(new Error('TOKEN_BUDGET_EXCEEDED')).class).toBe('RESOURCE');
  });

  it('defaults anything unrecognised to PERMANENT and preserves the message', () => {
    const result = classifyError(new Error('column "foo" does not exist'));
    expect(result.class).toBe('PERMANENT');
    expect(result.message).toBe('column "foo" does not exist');
    expect(result.raw).toBe('column "foo" does not exist');
  });

  it('classifies non-Error values too', () => {
    expect(classifyError('ETIMEDOUT: connection lost').class).toBe('TRANSIENT');
    expect(classifyError('something else').class).toBe('PERMANENT');
  });
});
