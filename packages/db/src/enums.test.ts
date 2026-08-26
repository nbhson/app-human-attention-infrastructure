import { describe, expect, it } from 'vitest';

import {
  AgentRunStatus,
  AiProviderType,
  ArtifactStatus,
  ChangeStatus,
  ContextSourceType,
  FileChangeType,
  FindingKind,
  HumanDecisionType,
  MemoryKind,
  MemoryStatus,
  PriorityLabel,
  ProviderKind,
  ReviewDecisionType,
  ReviewQueueStatus,
  ReviewSeverity,
  ReviewVerdict,
  RoutingAction,
  TaskStatus,
  ThresholdBand,
  VerificationStatus,
  WritebackAction,
  WritebackStatus,
} from '@harness/domain';

import {
  agentRunStatuses,
  aiProviderTypes,
  artifactStatuses,
  changeStatuses,
  contextSourceTypes,
  fileChangeTypes,
  findingKinds,
  humanDecisionTypes,
  memoryKinds,
  memoryStatuses,
  priorityLabels,
  providerKinds,
  reviewDecisionTypes,
  reviewQueueStatuses,
  reviewSeverities,
  reviewVerdicts,
  routingActions,
  taskStates,
  thresholdBands,
  verificationStatuses,
  writebackActions,
  writebackStatuses,
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

  it('aiProviderTypes match AiProviderType', () => {
    expect(aiProviderTypes).toEqual(Object.values(AiProviderType));
  });

  it('reviewVerdicts match ReviewVerdict', () => {
    expect(reviewVerdicts).toEqual(Object.values(ReviewVerdict));
  });

  it('reviewSeverities match ReviewSeverity', () => {
    expect(reviewSeverities).toEqual(Object.values(ReviewSeverity));
  });

  it('findingKinds match FindingKind (fix vs remove)', () => {
    expect(findingKinds).toEqual(Object.values(FindingKind));
  });

  it('providerKinds match ProviderKind', () => {
    expect(providerKinds).toEqual(Object.values(ProviderKind));
  });

  it('writebackActions match WritebackAction', () => {
    expect(writebackActions).toEqual(Object.values(WritebackAction));
  });

  it('writebackStatuses match WritebackStatus', () => {
    expect(writebackStatuses).toEqual(Object.values(WritebackStatus));
  });

  it('reviewDecisionTypes match ReviewDecisionType', () => {
    expect(reviewDecisionTypes).toEqual(Object.values(ReviewDecisionType));
  });

  it('memoryKinds match MemoryKind (exactly four review-shaped tiers)', () => {
    expect(memoryKinds).toEqual(Object.values(MemoryKind));
    expect(memoryKinds).toHaveLength(4);
  });

  it('memoryStatuses match MemoryStatus (active/archived lifecycle)', () => {
    expect(memoryStatuses).toEqual(Object.values(MemoryStatus));
  });
});
