/**
 * `@harness/writeback` — the commentary/status write-back seam (review-reorient
 * Phase 3 day-06).
 *
 * Public surface:
 * - `writeback-service` — the `WriteBackService` interface + `WriteBackError`.
 * - `mcp-writeback` — `MCPWriteBack` (write via the Week-1 MCP transport) and its
 *   `MCPWriteBackOptions` (the injected `enabled` toggle).
 *
 * The seam can only express commentary/status — `COMMENT | STATUS | LABEL |
 * TRANSITION` — never code; the intent type enforces that at compile time.
 */

export * from './writeback-service.js';
export * from './mcp-writeback.js';
export * from './dedup.js';
export * from './redact.js';
