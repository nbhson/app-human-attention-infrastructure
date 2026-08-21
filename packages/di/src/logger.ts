/**
 * Structured logging (day-27 §2.1) — one logger, one shape, everywhere.
 *
 * `@harness/di` owns the logger so every engine and the API share the same
 * JSON-serialisable discipline: a `message` plus an optional {@link LogFields}
 * object. The concrete sink is `pino`, but the {@link Logger} interface is a
 * minimal structural shape so low-level packages (`db`, `event-bus`) that may not
 * import `@harness/di` (boundary R4) can still accept one and be given the real
 * thing at the composition root.
 *
 * Rules (day-27 §2.1):
 * - Every line should carry `correlation_id` when one is in scope
 *   ({@link withCorrelation}); only process bootstrap may omit it.
 * - Log events, not prose: caller passes `{ event_type, attempt, … }`.
 * - Never log secrets, file contents, or LLM bodies — hashes and ids only.
 */

import pino from 'pino';

/** Structured fields attached to a line as JSON (no PII/secrets). */
export type LogFields = Record<string, unknown>;

/** The four levels plus child proliferation (pino-compatible, structurally). */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A child logger carrying the given fields on every subsequent line. */
  child(fields: LogFields): Logger;
}

/** The correlation context a subsystem carries for a task's lifecycle. */
export interface CorrelationContext {
  readonly correlationId: string;
  readonly taskId?: string;
  readonly agentRunId?: string;
}

/** pino's object-first `log.debug({…}, msg)` behind our `debug(msg, fields)` shape. */
function wrapPino(log: pino.Logger): Logger {
  return {
    debug: (message, fields) => log.debug(fields ?? {}, message),
    info: (message, fields) => log.info(fields ?? {}, message),
    warn: (message, fields) => log.warn(fields ?? {}, message),
    error: (message, fields) => log.error(fields ?? {}, message),
    child: (fields) => wrapPino(log.child(fields)),
  };
}

/**
 * The process-wide root logger. `service` is baked into `base` so every line is
 * attributable even before any correlation context exists (day-27 §2.1).
 */
export function createRootLogger(level: string = process.env.LOG_LEVEL ?? 'info'): Logger {
  return wrapPino(
    pino({
      level,
      base: { service: 'harness' },
      timestamp: pino.stdTimeFunctions.isoTime,
    }),
  );
}

/**
 * Bind a line to the task lifecycle. Correlation id is required; task/agent-run
 * ids are included when known so downstream queries can join a line to its row.
 */
export function withCorrelation(logger: Logger, ctx: CorrelationContext): Logger {
  return logger.child({
    correlation_id: ctx.correlationId,
    ...(ctx.taskId === undefined ? {} : { task_id: ctx.taskId }),
    ...(ctx.agentRunId === undefined ? {} : { agent_run_id: ctx.agentRunId }),
  });
}
