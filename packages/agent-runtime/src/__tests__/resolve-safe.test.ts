import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveSafe } from '../tools/resolve-safe.js';

const ROOT = resolve(process.cwd(), 'sandbox');

describe('resolveSafe', () => {
  it('resolves a valid relative path inside the root', () => {
    expect(resolveSafe(ROOT, 'src/index.ts')).toBe(resolve(ROOT, 'src/index.ts'));
  });

  it('resolves `.` to the root itself', () => {
    expect(resolveSafe(ROOT, '.')).toBe(resolve(ROOT));
  });

  it('rejects a `..` traversal that escapes the root', () => {
    expect(() => resolveSafe(ROOT, '../secret')).toThrow('PATH_TRAVERSAL_REJECTED: ../secret');
  });

  it('rejects an absolute path outside the root', () => {
    expect(() => resolveSafe(ROOT, '/etc/passwd')).toThrow('PATH_TRAVERSAL_REJECTED: /etc/passwd');
  });

  it('rejects a sibling directory that shares the root prefix', () => {
    const evil = `${ROOT}-evil/file.txt`;
    expect(() => resolveSafe(ROOT, evil)).toThrow('PATH_TRAVERSAL_REJECTED');
  });

  it('allows `..` that stays inside the root', () => {
    expect(resolveSafe(ROOT, 'a/../b')).toBe(resolve(ROOT, 'b'));
  });
});
