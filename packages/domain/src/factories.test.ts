import { describe, expect, it } from 'vitest';

import {
  ArtifactStatus,
  ChangeStatus,
  HumanDecisionType,
  Priority,
  ReviewQueueItemStatus,
  TaskStatus,
  VerificationPriority,
  createArtifact,
  createChange,
  createContextSnapshot,
  createHumanDecision,
  createReviewQueueItem,
  createTask,
  createVerificationRequest,
  newAgentRunID,
  newArtifactID,
  newAssessmentID,
  newChangeID,
  newContextID,
  newDecisionID,
  newReviewerID,
  newTaskID,
  newVerificationRequestID,
  newWorkflowID,
} from './index.js';

describe('createTask', () => {
  it('applies default status, owner, priority, and counters', () => {
    const task = createTask({
      id: newTaskID(),
      workflowId: newWorkflowID(),
      name: 'Fix login',
      description: 'Fix the login flow',
      requirements: 'Address the reported bug',
    });
    expect(task.status).toBe(TaskStatus.Pending);
    expect(task.owner).toBe('system');
    expect(task.priority).toBe(Priority.Medium);
    expect(task.retryCount).toBe(0);
    expect(task.maxRetries).toBe(3);
    expect(task.agents).toEqual([]);
    expect(task.createdAt).toBeInstanceOf(Date);
  });

  it('preserves overrides', () => {
    const task = createTask({
      id: newTaskID(),
      workflowId: newWorkflowID(),
      name: 'x',
      description: 'x',
      requirements: 'x',
      status: TaskStatus.Executing,
      priority: Priority.Critical,
    });
    expect(task.status).toBe(TaskStatus.Executing);
    expect(task.priority).toBe(Priority.Critical);
  });
});

describe('createArtifact', () => {
  it('defaults status to DRAFT and computes size', () => {
    const content = 'const a = 1;';
    const artifact = createArtifact({
      id: newArtifactID(),
      type: 'FILE',
      name: 'a.ts',
      path: 'src/a.ts',
      content,
      contentHash: 'abc',
    });
    expect(artifact.status).toBe(ArtifactStatus.Draft);
    expect(artifact.sizeBytes).toBe(content.length);
  });
});

describe('createChange', () => {
  it('defaults status to PENDING', () => {
    const change = createChange({
      id: newChangeID(),
      taskId: newTaskID(),
      agentRunId: newAgentRunID(),
      modelUsed: 'claude-sonnet-5',
      filesAffected: [],
      reason: 'test',
    });
    expect(change.status).toBe(ChangeStatus.Pending);
    expect(change.timestamp).toBeInstanceOf(Date);
  });
});

describe('createContextSnapshot', () => {
  it('defaults createdAt and metadata', () => {
    const snapshot = createContextSnapshot({
      id: newContextID(),
      taskId: newTaskID(),
      sources: [],
      totalTokens: 0,
      rankMethod: 'keyword',
    });
    expect(snapshot.createdAt).toBeInstanceOf(Date);
    expect(snapshot.metadata).toEqual({});
  });
});

describe('createVerificationRequest', () => {
  it('defaults priority to MEDIUM', () => {
    const request = createVerificationRequest({
      id: newVerificationRequestID(),
      taskId: newTaskID(),
      changeId: newChangeID(),
      checks: [],
      timeoutSeconds: 300,
    });
    expect(request.priority).toBe(VerificationPriority.Medium);
  });
});

describe('createHumanDecision', () => {
  it('defaults timestamp, evidenceViewed, and metadata', () => {
    const decision = createHumanDecision({
      id: newDecisionID(),
      reviewerId: newReviewerID(),
      targetTaskId: newTaskID(),
      decision: HumanDecisionType.Approved,
      reason: 'Looks good',
    });
    expect(decision.timestamp).toBeInstanceOf(Date);
    expect(decision.evidenceViewed).toEqual([]);
    expect(decision.metadata).toEqual({});
  });
});

describe('createReviewQueueItem', () => {
  it('defaults status to PENDING', () => {
    const item = createReviewQueueItem({
      taskId: newTaskID(),
      changeId: newChangeID(),
      assessmentId: newAssessmentID(),
      priorityLabel: 'HIGH',
      suggestedReviewDepth: 'NORMAL',
      requestedAt: new Date(),
    });
    expect(item.status).toBe(ReviewQueueItemStatus.Pending);
  });
});
