import { describe, expect, it } from 'vitest';

import { writebackEnabled } from './writeback-gate.js';

describe('writebackEnabled (day-09)', () => {
  it('is OFF when the request flag is missing or falsy', () => {
    expect(writebackEnabled(undefined, { WRITEBACK_ENABLED: '1' })).toBe(false);
    expect(writebackEnabled(false, { WRITEBACK_ENABLED: '1' })).toBe(false);
    expect(writebackEnabled('true', { WRITEBACK_ENABLED: '1' })).toBe(false); // not a boolean true
  });

  it('is OFF at rest — an unset WRITEBACK_ENABLED defeats a request-level ON', () => {
    expect(writebackEnabled(true, {})).toBe(false);
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: '0' })).toBe(false);
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: 'false' })).toBe(false);
  });

  it('is ON only when both the flag and the env ceiling are armed', () => {
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: '1' })).toBe(true);
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: 'true' })).toBe(true);
  });
});
