import { describe, expect, it } from 'vitest';

import { writebackEnabled } from './writeback-gate.js';

describe('writebackEnabled (day-09)', () => {
  it('is OFF when the request flag is missing or falsy', () => {
    expect(writebackEnabled(undefined, { WRITEBACK_ENABLED: '1' })).toBe(false);
    expect(writebackEnabled(false, { WRITEBACK_ENABLED: '1' })).toBe(false);
    expect(writebackEnabled('true', { WRITEBACK_ENABLED: '1' })).toBe(false); // not a boolean true
  });

  it('is ON at rest — an unset WRITEBACK_ENABLED leaves the ceiling armed', () => {
    expect(writebackEnabled(true, {})).toBe(true);
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: '1' })).toBe(true);
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: 'true' })).toBe(true);
  });

  it('is OFF when the env ceiling is explicitly disabled', () => {
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: '0' })).toBe(false);
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: 'false' })).toBe(false);
  });
});
