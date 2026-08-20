import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { newProjectID, newTaskID, TaskStatus } from '@harness/domain';

import { requireConnectionString } from './env.js';
import { projects, tasks } from './schema/index.js';

const client = postgres(requireConnectionString(), { max: 1 });
const db = drizzle(client);

const seeds = [
  {
    title: 'Scaffold a new package with build config',
    description: 'Create the package skeleton, tsconfig and build script.',
    state: TaskStatus.Pending,
  },
  {
    title: 'Implement the event log writer',
    description: 'Persist every bus event to the append-only event_log table.',
    state: TaskStatus.Executing,
  },
  {
    title: 'Wire the verification engine',
    description: 'Run checks against a change and record results.',
    state: TaskStatus.AwaitingReview,
  },
] as const;

try {
  const projectId = newProjectID();

  await db
    .insert(projects)
    .values({ id: projectId, name: 'sample-repo', repo_path: 'fixtures/sample-repo' })
    .onConflictDoNothing();

  for (let i = 0; i < seeds.length; i += 1) {
    const seed = seeds[i]!;
    await db
      .insert(tasks)
      .values({
        id: newTaskID(),
        project_id: projectId,
        title: seed.title,
        description: seed.description,
        state: seed.state,
        idempotency_key: `seed-task-${i}`,
      })
      .onConflictDoNothing();
  }

  console.log(`[seed] done (1 project, ${seeds.length} tasks).`);
} finally {
  await client.end();
}
