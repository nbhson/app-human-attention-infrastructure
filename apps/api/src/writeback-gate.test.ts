import { describe, expect, it } from 'vitest';

import { writebackEnabled } from './writeback-gate.js';

describe('writebackEnabled (day-09, default-deny ceiling)', () => {
  it('is OFF when the request flag is missing or falsy', () => {
    expect(writebackEnabled(undefined, { WRITEBACK_ENABLED: '1' })).toBe(false);
    expect(writebackEnabled(false, { WRITEBACK_ENABLED: '1' })).toBe(false);
    expect(writebackEnabled('true', { WRITEBACK_ENABLED: '1' })).toBe(false); // not a boolean true
  });

  it('is OFF at rest — an unset WRITEBACK_ENABLED leaves the ceiling DISARMED (fail-safe default)', () => {
    expect(writebackEnabled(true, {})).toBe(false);
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: undefined })).toBe(false);
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: '' })).toBe(false);
  });

  it('is ON only when the ceiling is explicitly armed', () => {
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: '1' })).toBe(true);
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: 'true' })).toBe(true);
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: 'TRUE' })).toBe(true); // case-insensitive
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: 'True' })).toBe(true);
  });

  it('is OFF when the ceiling is explicitly disabled or set to anything else', () => {
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: '0' })).toBe(false);
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: 'false' })).toBe(false);
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: 'yes' })).toBe(false); // not an armed value
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: 'on' })).toBe(false);
  });
});
