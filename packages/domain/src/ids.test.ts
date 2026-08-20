import { describe, expect, it } from 'vitest';

import { brand, newTaskID, uuidv7 } from './ids.js';

const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('produces a canonical UUIDv7 string', () => {
    expect(uuidv7(1)).toMatch(UUIDV7_RE);
    expect(uuidv7(Date.now())).toMatch(UUIDV7_RE);
  });

  it('is time-sortable by embedded millisecond timestamp', () => {
    const earlier = uuidv7(1_000);
    const later = uuidv7(2_000);
    expect(earlier < later).toBe(true);
  });

  it('is unique for repeated generation', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });

  it('rejects out-of-range timestamps', () => {
    expect(() => uuidv7(-1)).toThrow(RangeError);
    expect(() => uuidv7(2 ** 48)).toThrow(RangeError);
  });
});

describe('branded ID factories', () => {
  it('produce distinct, branded string values', () => {
    const a = newTaskID();
    const b = newTaskID();
    expect(typeof a).toBe('string');
    expect(a).not.toBe(b);
    expect(a).toMatch(UUIDV7_RE);
  });
});

describe('brand', () => {
  it('returns the input at runtime', () => {
    expect(brand('hello', 'TaskID')).toBe('hello');
  });
});
