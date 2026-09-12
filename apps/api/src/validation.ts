/**
 * Declarative request validation for the review slice.
 *
 * Single-source Zod schemas give both runtime validation and static
 * `z.infer<>` types — "parse, don't validate" (Alexis King) + Fastify
 * best practice: every write route has a schema.
 */

import { z } from 'zod';

export const CreateReviewBodySchema = z
  .object({
    prUrl: z.string().trim().min(1, 'prUrl is required'),
    jiraTicket: z.string().trim().min(1).optional(),
  })
  .strict();

export type CreateReviewBody = z.infer<typeof CreateReviewBodySchema>;

export const ReviewDecideBodySchema = z
  .object({
    decision: z.enum(['APPROVE', 'REQUEST_CHANGES', 'REJECT'], {
      message: 'decision must be one of APPROVE, REQUEST_CHANGES, REJECT',
    }),
    rationale: z.string().trim().min(1).optional(),
    writeback: z.boolean().optional(),
    comment: z.string().trim().optional(),
  })
  .strict();

export type ReviewDecideBodyValidated = z.infer<typeof ReviewDecideBodySchema>;

/**
 * Format a ZodError into a single human-readable message for 400 responses.
 */
export function formatZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'invalid request body';
  const path = first.path.length > 0 ? `${String(first.path[0])}: ` : '';
  return `${path}${first.message}`;
}
