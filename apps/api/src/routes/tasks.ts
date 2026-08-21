/**
 * Task HTTP routes — the thin Fastify surface over {@link TaskService}
 * (day-25 §3.2).
 *
 * Before Day 25 the API only exposed the review surface; tasks were created by
 * services and tests directly. The E2E vertical slice needs a real entry point,
 * so `POST /api/tasks` get-or-creates the owning project (by `repo_path`) and
 * enqueues a PENDING task through the service.
 */

import type { FastifyInstance } from 'fastify';

import { eq } from 'drizzle-orm';

import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import { projects } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { brand, newProjectID } from '@harness/domain';
import type { ProjectID } from '@harness/domain';
import type { TaskService } from '@harness/orchestrator';

interface CreateTaskBody {
  readonly title: string;
  readonly description?: string;
  readonly repoPath?: string;
}

/**
 * Get-or-create the project that owns `repoPath`. The E2E demo has no separate
 * provisioning endpoint, so idempotently reuse a project when its `repo_path`
 * already exists (day-25 §3.2).
 */
async function getOrCreateProject(
  db: DrizzleDB,
  name: string,
  repoPath: string,
): Promise<ProjectID> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.repo_path, repoPath))
    .limit(1);
  const existing = rows[0];
  if (existing) {
    return brand(existing.id, 'ProjectID');
  }

  const id = newProjectID();
  await db.insert(projects).values({ id, name, repo_path: repoPath });
  return id;
}

/** Register the task endpoints under `/api/tasks`. */
export function registerTaskRoutes(app: FastifyInstance, container: Container): void {
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  const taskService = container.resolve<TaskService>(TOKENS.TaskService);

  app.post<{ Body: CreateTaskBody }>('/api/tasks', async (request, reply) => {
    const title = request.body?.title;
    if (typeof title !== 'string' || title.trim().length === 0) {
      return reply.code(400).send({ error: 'title is required' });
    }

    const repoPath = request.body.repoPath ?? process.env.SANDBOX_ROOT ?? './sandbox';
    const description = request.body.description?.trim() || null;

    const projectId = await getOrCreateProject(db, 'e2e-happy-path', repoPath);
    const task = await taskService.createTask({
      projectId,
      title: title.trim(),
      ...(description ? { description } : {}),
    });

    return reply.code(201).send({
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      state: task.state,
    });
  });
}
