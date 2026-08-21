/**
 * A hand-rolled dependency injection container.
 *
 * Phase 1 deliberately avoids a DI library (tsyringe, inversify, …): those
 * require decorators or `reflect-metadata`, which conflict with the plain
 * interface-first domain style. The object graph is small enough to wire
 * explicitly in `apps/api/src/bootstrap.ts`, and a tiny container keeps the
 * wiring visible instead of hiding it behind reflection.
 */

import { ContainerError } from './errors.js';

/** Builds (or returns) the instance backing a single token. */
export type Factory<T> = (container: Container) => T;

/**
 * A minimal, lazy, singleton-per-token container.
 *
 * - Registration stores a factory; the factory is *not* run until first use.
 * - `resolve` runs the factory once and caches the result, so every later
 *   `resolve` of the same token returns the same instance.
 * - The factory receives the container, so a dependency may resolve its own
 *   dependencies at construction time.
 */
export class Container {
  private readonly factories = new Map<string, Factory<unknown>>();
  private readonly instances = new Map<string, unknown>();

  /** Register `factory` under `token`; it runs on first {@link resolve}. */
  register<T>(token: string, factory: Factory<T>): void {
    this.factories.set(token, factory as Factory<unknown>);
  }

  /** Resolve `token`, constructing and caching it on first use. */
  resolve<T>(token: string): T {
    const cached = this.instances.get(token);
    if (cached !== undefined) {
      return cached as T;
    }

    const factory = this.factories.get(token);
    if (factory === undefined) {
      throw new ContainerError(token);
    }

    const instance = factory(this);
    this.instances.set(token, instance);
    return instance as T;
  }

  /** Whether `token` has been registered (regardless of resolution). */
  has(token: string): boolean {
    return this.factories.has(token);
  }

  /**
   * Clear the instance cache (for tests). Registrations survive, so a later
   * `resolve` re-runs the factory and builds a fresh instance.
   */
  reset(): void {
    this.instances.clear();
  }
}
