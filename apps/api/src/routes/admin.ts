/**
 * Admin endpoints (day-14 §2.2, §3.3) — the runtime controls behind auto-approve.
 *
 * Two ADMIN-guarded mutations, both one-shot and immediately effective:
 *
 *  - `POST /api/admin/auto-approve/enabled` — flip the feature flag
 *    (`auto_approve_enabled` on the singleton kill-switch row). The flag is the
 *    *last* gate, never the only one: turning it on while calibration is red is
 *    still refused by the executor's gate (day-14 §6).
 *  - `POST /api/admin/auto-approve/kill` — trip the kill-switch: disable
 *    auto-approve *and* requeue every in-flight `AUTO_APPROVABLE` item to human
 *    review in one UPDATE + one UPDATE (§2.2).
 *
 * Authorization is exactly the Day-02 guard: `requireRole(Role.Admin)` admits
 * only an admin principal, everything else gets 403 (logged via `authz.decision_denied`).
 */

import type { FastifyInstance } from 'fastify';

import { Role } from '@harness/domain';
import { requireRole } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import type { AutoApproveKillSwitch } from '@harness/attention-engine';

interface EnabledBody {
  readonly enabled: boolean;
}

interface KillBody {
  readonly reason: string;
}

/** Register the `/api/admin/*` endpoints over the already-wired container. */
export function registerAdminRoutes(app: FastifyInstance, container: Container): void {
  const canAdmin = requireRole(container, Role.Admin);

  app.post<{ Body: EnabledBody }>(
    '/api/admin/auto-approve/enabled',
    { preHandler: canAdmin },
    async (request) => {
      const killSwitch = container.resolve<AutoApproveKillSwitch>(TOKENS.AutoApproveKillSwitch);
      await killSwitch.setFlagEnabled(request.body.enabled);
      return { autoApproveEnabled: request.body.enabled };
    },
  );

  app.post<{ Body: KillBody }>(
    '/api/admin/auto-approve/kill',
    { preHandler: canAdmin },
    async (request) => {
      const killSwitch = container.resolve<AutoApproveKillSwitch>(TOKENS.AutoApproveKillSwitch);
      const actorId = request.auth!.user.id;
      await killSwitch.kill(actorId, request.body.reason);
      return { ok: true, killed: true };
    },
  );
}
