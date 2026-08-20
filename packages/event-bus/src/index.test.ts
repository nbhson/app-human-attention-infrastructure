import { describe, expect, it } from 'vitest';

import { InProcessEventBus, createEvent } from './index.js';

describe('@harness/event-bus barrel', () => {
  it('exposes the bus and envelope factory', () => {
    const bus = new InProcessEventBus();
    expect(bus).toBeInstanceOf(InProcessEventBus);
    expect(typeof createEvent).toBe('function');
  });
});
