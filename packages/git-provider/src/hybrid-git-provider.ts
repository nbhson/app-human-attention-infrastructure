/**
 * `HybridGitProvider` — MCP-first, direct-API fallback for Bitbucket.
 *
 * The Bitbucket MCP path intermittently returns PR metadata with unusable file
 * content (empty `diffs`, hunk-headers-only patches, or an unparsable shape).
 * This wrapper keeps MCP as the primary channel (single seam, same mapper) but
 * validates the result and fails over to {@link BitbucketDirectProvider} when:
 *
 *   - MCP throws (tool error, timeout, unknown host entry), or
 *   - MCP succeeds but no file carries real code lines (`hasUsableFileContent`
 *     is false — the "không get được content bên trong file" issue).
 *
 * Non-Bitbucket hosts delegate straight to the primary provider — GitHub/GitLab
 * behavior is unchanged.
 */

import { GitProviderType } from '@harness/domain';
import type { PullRequest } from '@harness/domain';

import { BitbucketDirectProvider, bitbucketDirectFromEnv, patchHasCodeLines } from './bitbucket-provider.js';
import { GitProviderError, parseRepoPath } from './git-provider.js';
import type { CloneInput, CloneResult, FetchPullRequestInput, GitProvider } from './git-provider.js';
import type { GitToolMap } from './git-tool-map.js';
import { MCPGitProvider } from './mcp-git-provider.js';
import type { McpServerRegistry } from '@harness/mcp';

export interface FileContentStats {
  readonly totalFiles: number;
  readonly filesWithPatch: number;
  readonly filesWithCodeLines: number;
  readonly totalCodeLines: number;
}

export function fileContentStats(pr: PullRequest): FileContentStats {
  let filesWithPatch = 0;
  let filesWithCodeLines = 0;
  let totalCodeLines = 0;
  for (const f of pr.files) {
    if (f.patch.trim().length > 0) filesWithPatch += 1;
    if (patchHasCodeLines(f.patch)) {
      filesWithCodeLines += 1;
      for (const line of f.patch.split('\n')) {
        if ((line.startsWith('+') && !line.startsWith('+++')) || (line.startsWith('-') && !line.startsWith('---'))) {
          totalCodeLines += 1;
        }
      }
    }
  }
  return { totalFiles: pr.files.length, filesWithPatch, filesWithCodeLines, totalCodeLines };
}

/**
 * Usable means: at least one file, and at least one file with a real +/- code
 * line. Hunk-headers-only (`@@ ... @@` with no `+`/`-` body) and empty patches
 * are NOT usable — they are the exact failure mode this hybrid guards.
 */
export function hasUsableFileContent(pr: PullRequest): boolean {
  if (pr.files.length === 0) return false;
  return pr.files.some((f) => patchHasCodeLines(f.patch));
}

export function contentQualityReason(pr: PullRequest): string {
  const s = fileContentStats(pr);
  if (s.totalFiles === 0) return 'MCP returned zero files';
  if (s.filesWithCodeLines === 0) {
    return (
      `MCP returned ${s.totalFiles} file(s) but none carries code lines ` +
      `(${s.filesWithPatch} with non-empty patch, 0 with +/- lines — likely hunk-headers-only or empty diff)`
    );
  }
  return 'ok';
}

export interface HybridGitProviderOptions {
  /** When false, never fall back (tests / strict-MCP mode). Default true. */
  readonly enableFallback?: boolean;
  /** Logger hook for fallback events (defaults to no-op). */
  readonly onFallback?: (info: { repo: string; number: number; reason: string }) => void;
}

export class HybridGitProvider implements GitProvider {
  constructor(
    private readonly primary: GitProvider,
    private readonly bitbucketDirect: BitbucketDirectProvider | null,
    private readonly toolMap?: GitToolMap,
    private readonly options: HybridGitProviderOptions = {},
  ) {}

  private isBitbucketRepo(repo: string): boolean {
    try {
      const { host } = parseRepoPath(repo);
      const h = host.toLowerCase();
      // Self-hosted Bitbucket Server/DC often lives on a bare domain
      // (e.g. git.company.com) with no "bitbucket" keyword — the toolMap
      // (StaticGitToolMap.fromEnv, incl. BITBUCKET_URL/BITBUCKET_DOMAINS) is
      // the source of truth there. Only consult it first; the keyword
      // heuristic is a fallback for maps that lack the entry.
      if (this.toolMap) {
        try {
          if (this.toolMap.resolveHost(host) === GitProviderType.Bitbucket) return true;
        } catch {
          // fall through to heuristic
        }
      }
      // Direct-provider fallback: when hybrid wraps a BitbucketDirectProvider
      // and the repo host matches its configured Server base URL, treat it as
      // Bitbucket even if the toolMap has no entry (e.g. a minimal map in a
      // worker that still has BITBUCKET_URL creds).
      const directHost = this.bitbucketDirect?.serverHost;
      if (directHost && h === directHost) return true;
      return h.includes('bitbucket') || h === 'bitbucket.org';
    } catch {
      return false;
    }
  }

  async fetchPullRequest(input: FetchPullRequestInput): Promise<PullRequest> {
    if (!this.isBitbucketRepo(input.repo)) {
      return this.primary.fetchPullRequest(input);
    }
    const enableFallback = this.options.enableFallback ?? true;

    let primaryResult: PullRequest | null = null;
    let primaryError: unknown = null;
    try {
      primaryResult = await this.primary.fetchPullRequest(input);
    } catch (error) {
      primaryError = error;
    }

    if (primaryResult && hasUsableFileContent(primaryResult)) {
      return primaryResult;
    }

    if (!enableFallback || !this.bitbucketDirect) {
      if (primaryError) throw primaryError;
      const reason = primaryResult ? contentQualityReason(primaryResult) : 'MCP returned nothing';
      throw new GitProviderError(
        `bitbucket fetch has no usable file content (${reason}). ` +
          `Set BITBUCKET_TOKEN (Cloud) or BITBUCKET_URL + BITBUCKET_TOKEN/BITBUCKET_USERNAME+BITBUCKET_PASSWORD (Server/DC) to enable the direct-API fallback.`,
      );
    }

    const reason =
      primaryError instanceof Error
        ? `MCP failed (${primaryError.message})`
        : contentQualityReason(primaryResult!);
    this.options.onFallback?.({ repo: input.repo, number: input.number, reason });

    try {
      const direct = await this.bitbucketDirect.fetchPullRequest(input);
      if (!hasUsableFileContent(direct)) {
        // Direct also empty — prefer the more informative error. If MCP gave
        // files (even without code lines), return them rather than nothing so
        // the review still names the changed files.
        if (primaryResult && primaryResult.files.length > 0) return primaryResult;
        throw new GitProviderError(
          `bitbucket direct fallback also has no usable content (${contentQualityReason(direct)}; MCP: ${reason}). ` +
            `Verify the PR has changes and the token has pullrequest:read (Cloud) / PROJECT_READ+REPO_READ (Server).`,
        );
      }
      return direct;
    } catch (error) {
      if (primaryResult && primaryResult.files.length > 0 && !(error instanceof GitProviderError)) {
        return primaryResult;
      }
      // Surface the direct error with MCP context so operators see both channels.
      if (error instanceof GitProviderError) {
        throw new GitProviderError(`bitbucket hybrid failed — direct: ${error.message} | MCP: ${reason}`, error.status, error.cause);
      }
      throw error;
    }
  }

  async postComment(input: FetchPullRequestInput, body: string): Promise<void> {
    return this.primary.postComment(input, body);
  }

  async setStatus(
    input: FetchPullRequestInput,
    state: 'pending' | 'success' | 'failure',
    description: string,
  ): Promise<void> {
    return this.primary.setStatus(input, state, description);
  }

  async cloneAndCheckout(input: CloneInput, workdir: string): Promise<CloneResult> {
    return this.primary.cloneAndCheckout(input, workdir);
  }
}

/**
 * Build the production Git provider: MCP-first, Bitbucket-direct fallback when
 * credentials are present. Returns `null` when nothing is configured (caller
 * fails with a clear 503, as before).
 */
export function createHybridGitProvider(
  registry: McpServerRegistry,
  toolMap: GitToolMap,
  env: Record<string, string | undefined> = process.env,
  opts: HybridGitProviderOptions = {},
): GitProvider | null {
  const directOpts = bitbucketDirectFromEnv(env);
  const direct = directOpts ? new BitbucketDirectProvider(directOpts) : null;

  // Detect MCP availability without throwing: registry.get is lazy, so probe
  // the config shape the same way bootstrap does.
  let hasMcp = false;
  try {
    const servers = (registry as unknown as { config?: { servers?: unknown[] } })?.config?.servers;
    hasMcp = Array.isArray(servers) && servers.length > 0;
  } catch {
    hasMcp = false;
  }
  if (hasMcp) {
    return new HybridGitProvider(new MCPGitProvider(registry, toolMap), direct, toolMap, opts);
  }
  if (direct) return direct;
  const token = env['GITHUB_TOKEN'];
  if (token) {
    // Lazy import avoided (cycle): GitHubProvider lives in this package.
    // Caller (bootstrap) handles the legacy fallback; returning null here
    // keeps this factory MCP/Bitbucket-scoped.
    return null;
  }
  return null;
}
