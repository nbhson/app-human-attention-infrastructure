/**
 * Triage-rules route (review-reorient Phase 3) — the human-facing surface over
 * the `triage_rules` singleton row: three booleans, one per wired rule.
 *
 *  - `GET /api/triage-rules` — the current rule state (readable by any review
 *    principal, so the rules page can render without elevating).
 *  - `PUT /api/triage-rules` — upsert a partial `{ securityBlock?,
 *    performanceRegression?, schemaIntegrity? }` patch. Absent keys are left
 *    unchanged; only booleans are accepted. Guarded by `Reviewer`/`Admin` (the
 *    same guard as the review decision route — reviewers may tune their own
 *    triage), matching the "operator-mutable at runtime" intent, not a
 *    secret-bearing ADMIN-only control.
 */

import type { FastifyInstance } from 'fastify';

import { requireRole } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import { Role } from '@harness/domain';
import type { DrizzleDB } from '@harness/db';

import { loadTriageRuleState, saveTriageRuleState } from '../triage-rules-store.js';

/** `PUT` body: the three wired toggles, all optional (absent = leave unchanged). */
interface TriageRulesBody {
  readonly securityBlock?: unknown;
  readonly performanceRegression?: unknown;
  readonly schemaIntegrity?: unknown;
}

function pickBooleans(body: TriageRulesBody | undefined): Partial<{
  securityBlock: boolean;
  performanceRegression: boolean;
  schemaIntegrity: boolean;
}> {
  if (body === undefined) {
    return {};
  }
  const patch: {
    securityBlock?: boolean;
    performanceRegression?: boolean;
    schemaIntegrity?: boolean;
  } = {};
  if (typeof body.securityBlock === 'boolean') patch.securityBlock = body.securityBlock;
  if (typeof body.performanceRegression === 'boolean') {
    patch.performanceRegression = body.performanceRegression;
  }
  if (typeof body.schemaIntegrity === 'boolean') patch.schemaIntegrity = body.schemaIntegrity;
  return patch;
}

/** Register `GET`/`PUT /api/triage-rules` over the wired container. */
export function registerTriageRulesRoutes(app: FastifyInstance, container: Container): void {
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  const canRead = requireRole(container, Role.Operate, Role.Reviewer, Role.Admin);
  const canWrite = requireRole(container, Role.Reviewer, Role.Admin);

  app.get('/api/triage-rules', { preHandler: canRead }, () => loadTriageRuleState(db));

  app.put<{ Body: TriageRulesBody }>('/api/triage-rules', { preHandler: canWrite }, async (request, reply) => {
    const patch = pickBooleans(request.body);
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: 'provide at least one boolean toggle to update' });
    }
    return saveTriageRuleState(db, patch);
  });
}
