import { describe, expect, it } from 'vitest';

import {
  AgentRunStatus,
  ArtifactStatus,
  ChangeStatus,
  ContextSourceType,
  FileChangeType,
  HumanDecisionType,
  PriorityLabel,
  ReviewQueueStatus,
  RoutingAction,
  TaskStatus,
  ThresholdBand,
  VerificationStatus,
} from '@harness/domain';

import {
  agentRunStatuses,
  artifactStatuses,
  changeStatuses,
  contextSourceTypes,
  fileChangeTypes,
  humanDecisionTypes,
  priorityLabels,
  reviewQueueStatuses,
  routingActions,
  taskStates,
  thresholdBands,
  verificationStatuses,
} from './schema/enums.js';

/**
 * Drift guards: `@harness/domain` is the source of truth for every status /
 * type value. The schema keeps plain-text copies (so drizzle-kit can evaluate
 * it without an ESM workspace import); these tests fail any time they diverge.
 */
describe('schema enum drift guards', () => {
  it('taskStates match TaskStatus', () => {
    expect(taskStates).toEqual(Object.values(TaskStatus));
  });

  it('agentRunStatuses match AgentRunStatus', () => {
    expect(agentRunStatuses).toEqual(Object.values(AgentRunStatus));
  });

  it('artifactStatuses match ArtifactStatus', () => {
    expect(artifactStatuses).toEqual(Object.values(ArtifactStatus));
  });

  it('changeStatuses match ChangeStatus', () => {
    expect(changeStatuses).toEqual(Object.values(ChangeStatus));
  });

  it('fileChangeTypes match FileChangeType', () => {
    expect(fileChangeTypes).toEqual(Object.values(FileChangeType));
  });

  it('verificationStatuses match VerificationStatus', () => {
    expect(verificationStatuses).toEqual(Object.values(VerificationStatus));
  });

  it('priorityLabels match PriorityLabel', () => {
    expect(priorityLabels).toEqual(Object.values(PriorityLabel));
  });

  it('thresholdBands match ThresholdBand', () => {
    expect(thresholdBands).toEqual(Object.values(ThresholdBand));
  });

  it('humanDecisionTypes match HumanDecisionType', () => {
    expect(humanDecisionTypes).toEqual(Object.values(HumanDecisionType));
  });

  it('routingActions match RoutingAction', () => {
    expect(routingActions).toEqual(Object.values(RoutingAction));
  });

  it('reviewQueueStatuses match ReviewQueueStatus', () => {
    expect(reviewQueueStatuses).toEqual(Object.values(ReviewQueueStatus));
  });

  it('contextSourceTypes match ContextSourceType', () => {
    expect(contextSourceTypes).toEqual(Object.values(ContextSourceType));
  });
});
