/**
 * Shared fixtures for the Artifact Tracker tests.
 *
 * Building a `change` row forces the full FK chain `projects → tasks →
 * agent_runs → artifacts → changes` (and `snapshots` hangs off `changes`), so
 * these helpers seed that chain once and return the ids the tests need. Each
 * test still owns its own isolated schema via `createTestDb`.
 *
 * This file is deliberately *not* a `*.test.ts`, so vitest never collects it and
 * the no-delete lint test ignores it.
 */

import {
  ArtifactStatus,
  ChangeStatus,
  FileChangeType,
  newAgentRunID,
  newArtifactID,
  newChangeID,
  newProjectID,
  newTaskID,
  TaskStatus,
} from '@harness/domain';
import type { AgentRunID, ArtifactID, ChangeID, ProjectID, TaskID } from '@harness/domain';
import { agentRuns, artifacts, changes, projects, tasks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

export interface SeedRun {
  readonly projectId: ProjectID;
  readonly taskId: TaskID;
  readonly runId: AgentRunID;
}

/** Insert a project + task + agent run, returning their ids. */
export async function seedRun(db: DrizzleDB, title = 'seed'): Promise<SeedRun> {
  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: title, repo_path: `/tmp/${title}` });

  const taskId = newTaskID();
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title,
    state: TaskStatus.Executing,
    attempt_number: 0,
    idempotency_key: `${taskId}:0`,
  });

  const runId = newAgentRunID();
  await db.insert(agentRuns).values({
    id: runId,
    task_id: taskId,
    attempt_number: 0,
    status: 'EXECUTING',
    max_steps: 10,
  });

  return { projectId, taskId, runId };
}

/** Insert an artifact + its first `PENDING` change, returning both ids. */
export async function insertChange(
  db: DrizzleDB,
  seed: SeedRun,
): Promise<{
  artifactId: ArtifactID;
  changeId: ChangeID;
}> {
  const artifactId = newArtifactID();
  await db.insert(artifacts).values({
    id: artifactId,
    project_id: seed.projectId,
    file_path: 'src/app.ts',
    status: ArtifactStatus.Draft,
  });

  const changeId = newChangeID();
  await db.insert(changes).values({
    id: changeId,
    artifact_id: artifactId,
    agent_run_id: seed.runId,
    change_type: FileChangeType.Created,
    status: ChangeStatus.Pending,
    content_hash: 'seed-hash',
    diff_summary: 'created src/app.ts',
  });

  return { artifactId, changeId };
}
