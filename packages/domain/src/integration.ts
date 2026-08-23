/**
 * Integration provider domain types (review-reorient Phase 3).
 *
 * The pivot reconceives the Harness's inputs: instead of an internal task the AI
 * authors against, the unit of work is an *external* pull request plus a *ticket*
 * requirement. These types name the provider seams (Git host, ticket system, AI
 * vendor) and the value objects each adapter produces.
 */

import type { ProviderConfigID, WritebackID } from './ids.js';

// --- Provider names --------------------------------------------------------

/** The Git hosts a human can configure (token + baseUrl). */
export const GitProviderType = {
  GitHub: 'github',
  GitLab: 'gitlab',
  Bitbucket: 'bitbucket',
} as const;
/** A configured Git host. */
export type GitProviderType = (typeof GitProviderType)[keyof typeof GitProviderType];

/** The ticket systems a human can configure (token + baseUrl). */
export const TicketProviderType = {
  Jira: 'jira',
} as const;
/** A configured ticket system. */
export type TicketProviderType = (typeof TicketProviderType)[keyof typeof TicketProviderType];

/**
 * The AI vendors a human can configure. Every one but `anthropic` and `opencode`
 * resolves through an OpenAI-compatible `key + baseUrl + model` triple; `custom`
 * is the "any provider" escape hatch for self-hosted / proxied endpoints.
 */
export const AiProviderType = {
  OpenAI: 'openai',
  Anthropic: 'anthropic',
  Gemini: 'gemini',
  OpenCode: 'opencode',
  Custom: 'custom',
} as const;
/** A configured AI vendor (or the generic `custom` endpoint). */
export type AiProviderType = (typeof AiProviderType)[keyof typeof AiProviderType];

// --- Pull request model ----------------------------------------------------

/** The two ends of a PR: the target branch (`base`) and the source (`head`). */
export interface PullRequestRef {
  /** Branch ref name (e.g. `main`), no `refs/heads/` prefix. */
  readonly ref: string;
  /** The commit SHA. */
  readonly sha: string;
  /** The repo host path, e.g. `github.com/acme/api`. */
  readonly repo: string;
}

/** One file in a PR, with its per-file diff. */
export const PullRequestFileStatus = {
  Created: 'CREATED',
  Modified: 'MODIFIED',
  Deleted: 'DELETED',
  Renamed: 'RENAMED',
} as const;
/** A per-file change kind. */
export type PullRequestFileStatus =
  (typeof PullRequestFileStatus)[keyof typeof PullRequestFileStatus];

/** A single file's contribution to a PR. */
export interface PullRequestFile {
  /** Repo-relative file path. */
  readonly path: string;
  /** Change kind. */
  readonly status: PullRequestFileStatus;
  /** Lines added. */
  readonly additions: number;
  /** Lines removed. */
  readonly deletions: number;
  /** The unified diff for this file (may be truncated by the host). */
  readonly patch: string;
}

/**
 * A fully-resolved pull request: metadata plus the diff. This is the value the
 * `GitProvider.fetchPullRequest` seam returns, and the primary input the AI
 * reviewer reads.
 */
export interface PullRequest {
  readonly provider: GitProviderType;
  /** PR / MR number on the host. */
  readonly number: number;
  readonly title: string;
  readonly description: string;
  /** Author's host username. */
  readonly author: string;
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly base: PullRequestRef;
  readonly head: PullRequestRef;
  /** Canonical web URL (also the human's entry point). */
  readonly url: string;
  /** The repo host path, e.g. `github.com/acme/api`. */
  readonly repo: string;
  readonly files: PullRequestFile[];
}

// --- Ticket model ----------------------------------------------------------

/**
 * A resolved requirement ticket. The ticket text becomes the "requirements"
 * input the AI reviewer weighs the diff against.
 */
export interface Issue {
  readonly provider: TicketProviderType;
  /** Host key, e.g. `ACME-1234`. */
  readonly key: string;
  readonly summary: string;
  readonly description: string;
  /** Host issue type, e.g. `Bug`, `Story`. */
  readonly issueType: string;
  readonly url: string;
}

// --- Provider configuration model ------------------------------------------

/** What kind of provider a {@link ProviderConfig} configures. */
export const ProviderKind = {
  Git: 'git',
  Ticket: 'ticket',
  Ai: 'ai',
} as const;
/** A provider configuration kind. */
export type ProviderKind = (typeof ProviderKind)[keyof typeof ProviderKind];

/**
 * A stored provider configuration. Secrets are *never* held here in the clear —
 * `tokenRedacted` is a short, non-reversible fingerprint (and only the last-4
 * style tail is ever surfaced); the real token lives in the host credential
 * store / env, referenced by this row.
 */
export interface ProviderConfig {
  readonly id: ProviderConfigID;
  readonly kind: ProviderKind;
  /** One of {@link GitProviderType} / {@link TicketProviderType} / {@link AiProviderType}. */
  readonly providerType: string;
  /** Optional host base URL (GitLab self-hosted, Jira cloud, custom LLM). */
  readonly baseUrl?: string;
  /** AI-only: the model id, e.g. `gpt-5` / `claude-sonnet-5`. */
  readonly model?: string;
  /** A redacted credential handle — never the secret itself. */
  readonly tokenRedacted?: string;
  readonly enabled: boolean;
  readonly createdAt: Date;
}

// --- Write-back model ------------------------------------------------------

/** The external action a write-back performs. */
export const WritebackAction = {
  Comment: 'comment',
  Status: 'status',
  Label: 'label',
  Transition: 'transition',
} as const;
/** A write-back action. */
export type WritebackAction = (typeof WritebackAction)[keyof typeof WritebackAction];

/**
 * The lifecycle state of a write-back attempt (day-08 §2.1). `DUPLICATE` marks
 * an attempt that was skipped because an identical write had already succeeded —
 * it never reached the external host.
 */
export const WritebackStatus = {
  Pending: 'PENDING',
  Succeeded: 'SUCCEEDED',
  Failed: 'FAILED',
  Duplicate: 'DUPLICATE',
} as const;
/** A write-back status. */
export type WritebackStatus = (typeof WritebackStatus)[keyof typeof WritebackStatus];

/**
 * One attempt to push an outcome back to the PR or the ticket (day-08). The
 * audit row is keyed by the *intent* — concrete provider, external target, and
 * dedup fingerprint — and is written behind a per-provider toggle; when toggled
 * off, no row is created and nothing external happens.
 */
export interface WritebackEntry {
  readonly id: WritebackID;
  /** Concrete host/ticket-system slug the write targeted. */
  readonly provider: GitProviderType | TicketProviderType;
  /** The PR/MR number or ticket key the write targeted. */
  readonly externalId: string;
  readonly action: WritebackAction;
  /** The external payload written (comment text / status summary / label / target status). */
  readonly body: string;
  /** Idempotency fingerprint (day-08 §2.2). */
  readonly dedupKey: string;
  readonly status: WritebackStatus;
  /** Host handle for the written thing (present once SUCCEEDED). */
  readonly externalRef?: string;
  /** Redacted error (present on FAILED). */
  readonly error?: string;
  /** The review decision that emitted this write, if any (day-09 §3.2). */
  readonly decisionId?: string;
  readonly createdAt: Date;
}
