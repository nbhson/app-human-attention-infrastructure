import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { providerKindCheck } from './enums.js';

/**
 * A human-configured external provider (review-reorient Phase 3).
 *
 * One row per configured Git host / ticket system / AI vendor. Secrets are
 * **never** stored here in the clear: `token_redacted` is a short, non-reversible
 * fingerprint (or a trailing-4 handle) for display only; the real token lives in
 * the host credential store or `process.env`, referenced by this row's presence.
 */
export const providerConfigs = pgTable(
  'provider_configs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    // One of GitProviderType / TicketProviderType / AiProviderType, depending on
    // `kind`. Left check-free because the valid set is a function of `kind`.
    provider_type: text('provider_type').notNull(),
    base_url: text('base_url'),
    model: text('model'),
    token_redacted: text('token_redacted'),
    enabled: boolean('enabled').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [providerKindCheck],
);
