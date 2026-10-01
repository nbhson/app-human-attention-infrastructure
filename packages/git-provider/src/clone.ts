/**
 * Shallow clone + head-SHA checkout (Phase 3 day-11 §3.3).
 *
 * Turns a resolved {@link CloneInput} into a populated worktree at the PR's
 * **head SHA** — the merge candidate — on a detached, throwaway ref. The harness
 * reads and runs this checkout; it never authors or patches a commit. Three
 * bounded `git` steps:
 *
 *   1. `git clone --depth 1 --no-tags --branch <sourceBranch> <url> <workdir>`
 *      — a shallow, single-branch clone (no full history, no tags), seeded at the
 *      source branch tip.
 *   2. `git -C <workdir> fetch --depth 1 origin <headSha>` — guarantees the exact
 *      head SHA is present even when the PR head is a merge commit or behind its
 *      target, which a `--depth 1` clone alone can miss (day-11 §6).
 *   3. `git -C <workdir> checkout --detach <headSha>` — a detached checkout at
 *      the SHA, **never** `main`/the target branch, so the tested bytes are the
 *      candidate change and nothing else.
 *
 * The `git` runner is injectable (`RunGit`) so tests assert the exact command
 * sequence without a real binary; the default spawns the system `git` under a
 * wall-clock timeout and maps a non-zero exit to a loud {@link CloneError}.
 */

import { execFile } from 'node:child_process';

import { GitProviderError, parseRepoPath } from './git-provider.js';
import type { CloneInput, CloneResult } from './git-provider.js';

/** Default wall-clock budget for a shallow clone + fetch + checkout. */
const CLONE_TIMEOUT_MS = 120_000;

/** The outcome of one `git` invocation (the runner reports, never throws). */
export interface GitRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A `git` subprocess runner. `args` are passed verbatim after `git`. */
export type RunGit = (args: ReadonlyArray<string>, opts?: { readonly cwd?: string }) => Promise<GitRunResult>;

/** A clone/checkout failed — network, missing SHA, disk, or a timeout. */
export class CloneError extends GitProviderError {
  constructor(
    message: string,
    readonly command?: string,
  ) {
    super(message);
    this.name = 'CloneError';
  }
}

/** Injectable knobs for {@link cloneAndCheckout}. */
export interface CloneOptions {
  /** Wall-clock budget in ms for the whole clone (default {@link CLONE_TIMEOUT_MS}). */
  readonly timeoutMs?: number;
  /** Override the git runner (tests); defaults to spawning the system `git`. */
  readonly run?: RunGit;
  /**
   * Full `Authorization` header value for private repos, e.g. `Bearer <token>`
   * or `Basic <base64>`. Sent via `git -c http.extraHeader=...` so the token
   * never lands in the clone URL (no leak into `ps` output or error text).
   * When absent the clone is anonymous (public repos).
   */
  readonly authHeader?: string;
  /**
   * Explicit clone URL override (e.g. Bitbucket Server `/scm/PROJ/repo.git`
   * shape). Defaults to {@link cloneUrlFor} when absent.
   */
  readonly cloneUrl?: string;
}

/**
 * `https://<host>/<owner>/<name>.git` — identical across all three forges.
 *
 * Bitbucket Server/DC uses `https://<host>/scm/<project>/<repo>.git` instead.
 * When `serverBaseUrl` points at the same host as `repo`, build the `/scm/`
 * shape against it so self-hosted clones resolve instead of hanging/404ing.
 */
export function cloneUrlFor(repo: string, serverBaseUrl?: string): string {
  const { host, owner, name } = parseRepoPath(repo);
  if (serverBaseUrl) {
    try {
      const base = new URL(serverBaseUrl.replace(/\/+$/, ''));
      if (base.host.toLowerCase() === host.toLowerCase()) {
        return `${base.origin}/scm/${owner}/${name}.git`;
      }
    } catch {
      // Malformed base URL — fall through to the default shape.
    }
  }
  return `https://${host}/${owner}/${name}.git`;
}

/** Strip credentials from git stderr before it reaches logs/DB. */
function redactSecrets(text: string): string {
  return text
    .replace(/Authorization:\s*(Bearer|Basic)\s+\S+/gi, 'Authorization: <redacted>')
    .replace(/https?:\/\/[^/\s]*:[^@/\s]*@/g, 'https://<redacted>@')
    .replace(/(x-access-token:|oauth2:)\S+/gi, '$1<redacted>');
}

/**
 * Best-effort `Authorization` header for `repo` from the process env, so
 * providers without their own credentials (e.g. `MCPGitProvider`) can still
 * clone private repos instead of hanging anonymously to exit 124.
 *
 * - GitHub (`github.com` + GHES): `GITHUB_TOKEN` → `Bearer`.
 * - GitLab (any `*gitlab*` host): `GITLAB_TOKEN` (fallback
 *   `GITLAB_PERSONAL_ACCESS_TOKEN`) → `Bearer`.
 * - Bitbucket: `BITBUCKET_USERNAME`+`BITBUCKET_PASSWORD` → `Basic`, else
 *   `BITBUCKET_TOKEN` → `Bearer` — on Cloud (`*bitbucket*`) or on the
 *   self-hosted host matching `BITBUCKET_URL` (which has no "bitbucket"
 *   keyword, e.g. `git.company.com`).
 *
 * Returns `undefined` when no usable credentials exist (public repo path —
 * the clone stays anonymous but still fails fast via `GIT_TERMINAL_PROMPT=0`).
 */
export function defaultAuthHeaderForRepo(
  repo: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  let host: string;
  try {
    host = parseRepoPath(repo).host.toLowerCase();
  } catch {
    return undefined;
  }
  const nonEmpty = (v: string | undefined): string | undefined => {
    const t = v?.trim();
    return t && t.length > 0 ? t : undefined;
  };
  if (host.includes('github')) {
    const token = nonEmpty(env['GITHUB_TOKEN']);
    if (token) return `Bearer ${token}`;
    return undefined;
  }
  if (host.includes('gitlab')) {
    const token = nonEmpty(env['GITLAB_TOKEN']) ?? nonEmpty(env['GITLAB_PERSONAL_ACCESS_TOKEN']);
    if (token) return `Bearer ${token}`;
    return undefined;
  }
  const bitbucketUser = nonEmpty(env['BITBUCKET_USERNAME']);
  const bitbucketPass = nonEmpty(env['BITBUCKET_PASSWORD']) ?? nonEmpty(env['BITBUCKET_APP_PASSWORD']);
  const bitbucketToken = nonEmpty(env['BITBUCKET_TOKEN']);
  const isBitbucketHost =
    host.includes('bitbucket') ||
    (() => {
      try {
        const raw = env['BITBUCKET_URL'] ?? env['BITBUCKET_BASE_URL'];
        if (!raw) return false;
        return new URL(raw.replace(/\/+$/, '').replace(/\/rest\/api\/.*$/, '')).host.toLowerCase() === host;
      } catch {
        return false;
      }
    })();
  if (isBitbucketHost) {
    if (bitbucketUser && bitbucketPass) {
      return `Basic ${Buffer.from(`${bitbucketUser}:${bitbucketPass}`).toString('base64')}`;
    }
    if (bitbucketToken) return `Bearer ${bitbucketToken}`;
  }
  return undefined;
}

/** The first non-empty line of a git error, for a compact failure message. */
function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.trim().length > 0 ? line.trim() : text.trim();
}

/** Spawn the system `git` under a timeout; report exit code instead of throwing. */
function defaultRunGit(timeoutMs: number): RunGit {
  return (args, opts) =>
    new Promise<GitRunResult>((resolve) => {
      execFile(
        'git',
        args,
        {
          ...(opts?.cwd === undefined ? {} : { cwd: opts.cwd }),
          timeout: timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
          encoding: 'utf8',
          // Never prompt for credentials on a headless server: without this a
          // private repo hangs until the wall-clock timeout (exit 124) instead
          // of failing fast with "terminal prompts disabled".
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        },
        (error, stdout, stderr) => {
          const out = String(stdout);
          const err = String(stderr);
          if (error === null) {
            resolve({ exitCode: 0, stdout: out, stderr: err });
            return;
          }
          const killed =
            (error as { killed?: boolean }).killed === true || (error as { signal?: string }).signal !== undefined;
          const code =
            typeof (error as { code?: unknown }).code === 'number' ? ((error as { code?: unknown }).code as number) : 1;
          // 124 is the conventional "timed out" exit so the caller can branch.
          resolve({ exitCode: killed ? 124 : code, stdout: out, stderr: err });
        },
      );
    });
}

/**
 * Shallow-clone `input`'s repo into `workdir` and check out its head SHA, on a
 * detached throwaway ref. Throws {@link CloneError} on any non-zero git exit so
 * a failed clone is never a silently-empty worktree.
 */
export async function cloneAndCheckout(
  input: CloneInput,
  workdir: string,
  options: CloneOptions = {},
): Promise<CloneResult> {
  const run = options.run ?? defaultRunGit(options.timeoutMs ?? CLONE_TIMEOUT_MS);
  const cloneUrl = options.cloneUrl ?? cloneUrlFor(input.repo);
  // Auth rides on `http.extraHeader`, never in the URL — so `ps`, shell
  // history, and CloneError text never carry the token.
  const authPrefix: string[] =
    options.authHeader && options.authHeader.trim().length > 0
      ? ['-c', `http.extraHeader=Authorization: ${options.authHeader.trim()}`]
      : [];

  const steps: ReadonlyArray<{
    readonly label: string;
    readonly args: string[];
    readonly cwd?: string;
  }> = [
    {
      label: 'clone',
      args: [...authPrefix, 'clone', '--depth', '1', '--no-tags', '--branch', input.sourceBranch, cloneUrl, workdir],
    },
    {
      label: 'fetch',
      args: [...authPrefix, 'fetch', '--depth', '1', 'origin', input.headSha],
      cwd: workdir,
    },
    {
      label: 'checkout',
      args: ['checkout', '--detach', input.headSha],
      cwd: workdir,
    },
  ];

  for (const step of steps) {
    const result = await run(step.args, step.cwd === undefined ? undefined : { cwd: step.cwd });
    if (result.exitCode !== 0) {
      throw new CloneError(
        `git ${step.label} failed (exit ${result.exitCode}): ${firstLine(redactSecrets(result.stderr))}`,
        step.label,
      );
    }
  }

  return {
    workdir,
    headSha: input.headSha,
    sourceBranch: input.sourceBranch,
    targetBranch: input.targetBranch,
  };
}
