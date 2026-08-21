import { describe, expect, it, vi } from 'vitest';

import { Container } from './container.js';
import { ContainerError } from './errors.js';

describe('Container', () => {
  it('does not run a factory until its token is resolved', () => {
    const container = new Container();
    const factory = vi.fn(() => ({ value: 1 }));

    container.register('Thing', factory);

    expect(factory).not.toHaveBeenCalled();
    expect(container.resolve('Thing')).toEqual({ value: 1 });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('caches the instance: the factory runs exactly once', () => {
    const container = new Container();
    const factory = vi.fn(() => ({ value: Math.random() }));

    container.register('Thing', factory);
    const first = container.resolve<{ value: number }>('Thing');
    const second = container.resolve<{ value: number }>('Thing');

    expect(factory).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('passes the container into the factory so dependencies resolve in order', () => {
    const container = new Container();
    container.register('Db', () => ({ connected: true }));
    container.register('Repo', (c) => ({ db: c.resolve('Db') }));

    const repo = container.resolve<{ db: { connected: boolean } }>('Repo');

    expect(repo.db).toEqual({ connected: true });
  });

  it('throws ContainerError with the token name on an unknown token', () => {
    const container = new Container();

    expect(() => container.resolve('Missing')).toThrowError(ContainerError);
    try {
      container.resolve('Missing');
    } catch (error) {
      expect(error).toBeInstanceOf(ContainerError);
      expect((error as ContainerError).token).toBe('Missing');
      expect((error as Error).message).toContain('Missing');
    }
  });

  it('reset clears the cache but keeps registrations', () => {
    const container = new Container();
    const factory = vi.fn(() => ({ value: 1 }));

    container.register('Thing', factory);
    container.resolve('Thing');
    expect(factory).toHaveBeenCalledTimes(1);

    container.reset();
    container.resolve('Thing');

    // Registration survived; a fresh instance was built.
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('has reports registration regardless of resolution', () => {
    const container = new Container();

    expect(container.has('Thing')).toBe(false);
    container.register('Thing', () => ({}));
    expect(container.has('Thing')).toBe(true);
  });
});
