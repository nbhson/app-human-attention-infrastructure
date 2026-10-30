/**
 * Failure reporting for the async review path: classify the error, log the
 * diagnostics, and persist a human-readable failure message onto the report
 * row (`review_status: 'error'`).
 */

import { eq } from 'drizzle-orm';

import { OpenAICompatibleError, ReviewParseError } from '@harness/agent-runtime';
import { reviewReports } from '@harness/db';

import { retryTransient } from './retry.js';

import type { Logger } from '@harness/di';
import type { DrizzleDB } from '@harness/db';
import type { ReviewReportID } from '@harness/domain';

/**
 * Handle an async review failure: log the classified diagnostics, then mark
 * the report errored with a user-facing summary. Swallows DB errors on the
 * error-path so a failing status write never masks the original failure.
 */
export async function handleReviewProcessingFailure(
  db: DrizzleDB,
  logger: Logger,
  reportId: ReviewReportID,
  error: unknown,
): Promise<void> {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const isTruncated = errorMsg.includes('truncated');
  const isParseError = error instanceof ReviewParseError || errorMsg.includes('not valid JSON');
  const isRateLimited = /\b429\b|rate limit/i.test(errorMsg);
  const isTimeout = error instanceof OpenAICompatibleError ? error.kind === 'timeout' : /\btimed out\b/i.test(errorMsg);
  const isNetwork =
    error instanceof OpenAICompatibleError
      ? error.kind === 'network'
      : /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(errorMsg);
  const isAuth = /\b401\b|unauthorized|invalid api key/i.test(errorMsg);
  const isModelNotFound = /\b404\b|model .* not found/i.test(errorMsg);
  const isBadStructured = /\b400\b.*(response_format|json_schema|strict)/i.test(errorMsg);
  let rawOutput: string | undefined;
  if (error instanceof ReviewParseError && error.cause instanceof Error) {
    rawOutput = error.cause.message;
  }
  logger.error('review processing failed', {
    report_id: reportId,
    error: errorMsg,
    error_kind: error instanceof OpenAICompatibleError ? error.kind : undefined,
    is_truncated: isTruncated,
    is_parse_error: isParseError,
    is_rate_limited: isRateLimited,
    is_timeout: isTimeout,
    is_network: isNetwork,
    ...(rawOutput !== undefined ? { raw_output: rawOutput.slice(0, 3000) } : {}),
  });
  const userMessage = isTruncated
    ? '❌ Review failed: AI output was truncated — try with a smaller PR or increase AI_MAX_TOKENS'
    : isRateLimited
      ? '❌ Review failed: the AI provider is rate-limited (HTTP 429) — wait a moment and hit Retry, or reduce REVIEW_MAX_CONCURRENCY, or upgrade the provider plan'
      : isParseError
        ? '❌ Review failed: AI review output was not valid JSON — try again'
        : isNetwork
          ? `❌ Review failed: cannot reach the AI endpoint (${errorMsg}) — check 'ollama serve' + 'ollama list', try AI_BASE_URL=http://127.0.0.1:11434/v1 instead of localhost, or http://host.docker.internal:11434/v1 when the API runs in Docker`
          : isTimeout
            ? `❌ Review failed: AI request timed out (${errorMsg}) — raise AI_TIMEOUT_MS (and AI_MAX_TOKENS for large PRs) or use a faster endpoint`
            : isAuth
              ? `❌ Review failed: AI provider rejected the credentials (${errorMsg}) — check AI_API_KEY / ANTHROPIC_API_KEY`
              : isModelNotFound
                ? `❌ Review failed: AI model not found (${errorMsg}) — run 'ollama list' / 'ollama pull <model>' and check AI_MODEL`
                : isBadStructured
                  ? `❌ Review failed: AI endpoint rejected structured output (${errorMsg}) — set AI_STRUCTURED_OUTPUT=0 and retry`
                  : `❌ Review failed: ${errorMsg}`;
  await retryTransient(
    'status error fallback',
    () =>
      db
        .update(reviewReports)
        .set({
          review_status: 'error',
          summary: userMessage,
          overall_verdict: 'COMMENT' as const,
          completed_at: new Date(),
        })
        .where(eq(reviewReports.id, reportId)),
    logger,
    reportId,
  ).catch(() => {}); // Swallow DB error on the error-path.
}
