import { describe, expect, it } from 'vitest';

import {
  AgentRunStatus,
  ArtifactStatus,
  ChangeStatus,
  ContextSourceType,
  HumanDecisionType,
  Priority,
  TaskStatus,
  VerificationStatus,
  createArtifact,
  createAttentionAssessment,
  createTask,
  newArtifactID,
  newAssessmentID,
  newChangeID,
  newTaskID,
  newWorkflowID,
  ok,
  uuidv7,
} from './index.js';

describe('@harness/domain barrel', () => {
  it('exposes the core value symbols', () => {
    expect(TaskStatus.Pending).toBe('PENDING');
    expect(TaskStatus.AwaitingHumanIntervention).toBe('AWAITING_HUMAN_INTERVENTION');
    expect(Priority.Critical).toBe('CRITICAL');
    expect(ArtifactStatus.Merged).toBe('MERGED');
    expect(ChangeStatus.Verified).toBe('VERIFIED');
    expect(ContextSourceType.GitHistory).toBe('GIT_HISTORY');
    expect(AgentRunStatus.ToolCalling).toBe('TOOL_CALLING');
    expect(VerificationStatus.Passed).toBe('PASSED');
    expect(HumanDecisionType.RequestChanges).toBe('REQUEST_CHANGES');
  });

  it('exposes factories and helpers', () => {
    const task = createTask({
      id: newTaskID(),
      workflowId: newWorkflowID(),
      name: 't',
      description: 'd',
      requirements: 'r',
    });
    expect(task.status).toBe(TaskStatus.Pending);
    expect(task.priority).toBe(Priority.Medium);

    const artifact = createArtifact({
      id: newArtifactID(),
      type: 'FILE',
      name: 'a',
      path: 'src/a.ts',
      content: 'export {}',
      contentHash: 'sha256',
    });
    expect(artifact.status).toBe(ArtifactStatus.Draft);
    expect(artifact.sizeBytes).toBe(9);

    const assessment = createAttentionAssessment({
      id: newAssessmentID(),
      taskId: newTaskID(),
      changeId: newChangeID(),
      scores: {
        riskScore: 0.5,
        impactScore: 0.5,
        confidenceScore: 0.5,
        noveltyScore: 0.5,
        complexityScore: 0.5,
      },
      combinedPriority: 0.5,
      priorityLabel: 'MEDIUM',
      reviewRequired: false,
      reviewReason: 'low risk',
      suggestedReviewDepth: 'QUICK',
      factors: [],
    });
    expect(assessment.reviewRequired).toBe(false);
  });

  it('constructs results and UUIDs', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(uuidv7(1)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
