/**
 * Barrel for all Drizzle table definitions. Keep this table-only — the barrel
 * doubles as the relational schema registry passed to `drizzle(client, { schema })`.
 */
export * from './agent-runs.js';
export * from './artifacts.js';
export * from './assessments.js';
export * from './changes.js';
export * from './contexts.js';
export * from './decisions.js';
export * from './dispatch-log.js';
export * from './event-log.js';
export * from './projects.js';
export * from './retry-log.js';
export * from './snapshots.js';
export * from './task-state-history.js';
export * from './task-step-log.js';
export * from './tasks.js';
export * from './verification-requests.js';
export * from './verification-results.js';
