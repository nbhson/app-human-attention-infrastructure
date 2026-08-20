import { describe, expect, it } from 'vitest';

import { newArtifactID, newTaskID } from './ids.js';
import type { ArtifactID, TaskID } from './ids.js';

/** Accepts only a branded {@link TaskID}. */
function takeTaskId(id: TaskID): TaskID {
  return id;
}

describe('branded ID nominal typing (compile-time)', () => {
  it('accepts a genuine TaskID', () => {
    expect(takeTaskId(newTaskID())).toBeTruthy();
  });

  it('rejects a plain string', () => {
    // @ts-expect-error — a plain string is not a branded TaskID
    takeTaskId('plain-string');
  });

  it('rejects a foreign branded ID', () => {
    const artifactId: ArtifactID = newArtifactID();
    // @ts-expect-error — an ArtifactID is not a TaskID
    takeTaskId(artifactId);
  });
});
