import { describe, expect, it } from 'vitest';

import {
  MissingRationaleError,
  QueueConflictError,
  QueueItemNotFoundError,
  QueueStateError,
  ReviewError,
  ReviewService,
} from './index.js';

describe('@harness/review public surface', () => {
  it('exports the service and its error hierarchy', () => {
    expect(ReviewService).toBeTypeOf('function');

    expect(QueueConflictError.prototype).toBeInstanceOf(ReviewError);
    expect(QueueStateError.prototype).toBeInstanceOf(ReviewError);
    expect(QueueItemNotFoundError.prototype).toBeInstanceOf(ReviewError);
    expect(MissingRationaleError.prototype).toBeInstanceOf(ReviewError);
  });
});
