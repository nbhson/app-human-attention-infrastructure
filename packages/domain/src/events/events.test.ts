import { describe, expect, it } from 'vitest';

import { newCorrelationID, uuidv7 } from '../ids.js';
import { EventType } from './event-types.js';

describe('EventType constants', () => {
  it('exposes the canonical namespaced values', () => {
    expect(EventType.TaskCreated).toBe('task.created');
    expect(EventType.TaskStateChanged).toBe('task.state_changed');
    expect(EventType.TaskExecutionFinished).toBe('task.execution_finished');
    expect(EventType.ArtifactChanged).toBe('artifact.changed');
    expect(EventType.VerificationCompleted).toBe('verification.completed');
    expect(EventType.AssessmentCreated).toBe('attention.assessment_created');
    expect(EventType.DecisionSubmitted).toBe('review.decision_submitted');
  });
});

describe('CorrelationID', () => {
  it('mints unique, UUIDv7-valid values', () => {
    const a = newCorrelationID();
    const b = newCorrelationID();
    expect(a).not.toBe(b);
    expect(uuidv7(1)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
