/**
 * Pure mapper from MCP Git tool results to a normalised {@link PullRequest}
 * (Phase 3 day-03). Kept separate from {@link MCPGitProvider} so the mapping is
 * unit-testable against fixture {@link ToolResult}s with no live MCP server —
 * the same split as the Phase-1 `github-mapper.ts`.
 *
 * The mapper flattens a `ToolResult.content` array into a single JSON document
 * and then defensively narrows it into the `PullRequest` fields. It is *not* a
 * per-host mapper: it consumes one canonical MCP payload shape (the same shape
 * the Phase-1 REST mapper produced, but transported as JSON-in-text). A missing
 * or incompatible field raises {@link GitProviderError} — a review that sees "no
 * files changed" must never be a silently-mangled mapping (day-03 §6).
 */

import type { GitProviderType, PullRequest, PullRequestFile, PullRequestFileStatus } from '@harness/domain';
import type { ToolResult } from '@harness/mcp';

import { GitProviderError } from './git-provider.js';

/** The canonical JSON the get-PR tool returns (transport-host-agnostic). */
interface McpPrPayload {
  readonly number: number;
  readonly title: string;
  readonly description?: string;
  readonly author: string;
  readonly head: { readonly ref: string; readonly sha: string };
  readonly base: { readonly ref: string; readonly sha: string };
  readonly url: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse the single JSON document out of a tool result's content blocks. Accepts
 * the common MCP encodings: a `text` block whose payload is a JSON string, or a
 * `resource` block carrying JSON in `resource.text`. A `ToolResult.isError` or a
 * content array with no parseable JSON is a loud {@link GitProviderError}.
 */
function parseJsonContent(result: ToolResult, context: string): unknown {
  if (result.isError) {
    throw new GitProviderError(`${context}: MCP tool returned an error`);
  }
  for (const block of result.content) {
    if (block.type === 'text') {
      try {
        return JSON.parse(block.text);
      } catch {
        // not a JSON document here — keep scanning the remaining blocks
      }
    } else if (block.type === 'resource' && typeof block.resource.text === 'string') {
      try {
        return JSON.parse(block.resource.text);
      } catch {
        // keep scanning
      }
    }
  }
  throw new GitProviderError(`${context}: tool content has no JSON payload`);
}

/** Narrow the get-PR payload, throwing on every missing required field. */
function parsePr(result: ToolResult): McpPrPayload {
  const raw = parseJsonContent(result, 'get-pr tool');
  if (!isRecord(raw)) {
    throw new GitProviderError('get-pr tool: payload is not an object');
  }
  // Canonical stub shape (forge-server.mjs) vs raw GitLab API shape
  // (@zereight/mcp-gitlab returns iid/web_url/source_branch/etc).
  let number: unknown = raw['number'];
  const title: unknown = raw['title'];
  let author: unknown = raw['author'];
  let url: unknown = raw['url'];
  let head: unknown = raw['head'];
  let base: unknown = raw['base'];
  let description: unknown = raw['description'];

  // Fallback to GitLab raw shape if canonical fields are missing
  if (typeof number !== 'number' && (typeof raw['iid'] === 'string' || typeof raw['iid'] === 'number')) {
    number = Number(raw['iid']);
  }
  if (typeof number !== 'number' && typeof raw['id'] === 'number') {
    // last resort: use id if iid missing (should not happen for MR)
    number = raw['id'];
  }
  if (typeof author === 'object' && author !== null) {
    // GitLab author is { username, name }
    const a = author as Record<string, unknown>;
    author = typeof a['username'] === 'string' ? a['username'] : typeof a['name'] === 'string' ? a['name'] : author;
  }
  if (typeof url !== 'string' && typeof raw['web_url'] === 'string') {
    url = raw['web_url'];
  }
  if (!isRecord(head) && typeof raw['source_branch'] === 'string') {
    const sha =
      typeof raw['sha'] === 'string'
        ? raw['sha']
        : isRecord(raw['diff_refs']) && typeof raw['diff_refs']['head_sha'] === 'string'
          ? (raw['diff_refs']['head_sha'] as string)
          : '';
    head = { ref: raw['source_branch'] as string, sha };
  }
  if (!isRecord(base) && typeof raw['target_branch'] === 'string') {
    const sha =
      isRecord(raw['diff_refs']) && typeof raw['diff_refs']['base_sha'] === 'string'
        ? (raw['diff_refs']['base_sha'] as string)
        : '';
    base = { ref: raw['target_branch'] as string, sha };
  }
  if (typeof description !== 'string' && typeof raw['description'] === 'string') {
    description = raw['description'];
  }

  if (typeof number !== 'number' || Number.isNaN(number)) {
    throw new GitProviderError('get-pr tool: missing "number"');
  }
  if (typeof title !== 'string') {
    throw new GitProviderError('get-pr tool: missing "title"');
  }
  if (typeof author !== 'string') {
    throw new GitProviderError('get-pr tool: missing "author"');
  }
  if (typeof url !== 'string') {
    throw new GitProviderError('get-pr tool: missing "url"');
  }
  if (!isRecord(head) || typeof head['ref'] !== 'string' || typeof head['sha'] !== 'string') {
    throw new GitProviderError('get-pr tool: missing "head.ref"/"head.sha"');
  }
  if (!isRecord(base) || typeof base['ref'] !== 'string' || typeof base['sha'] !== 'string') {
    throw new GitProviderError('get-pr tool: missing "base.ref"/"base.sha"');
  }
  const desc = typeof description === 'string' ? description : undefined;
  return {
    number,
    title,
    author,
    url,
    head: { ref: head['ref'], sha: head['sha'] },
    base: { ref: base['ref'], sha: base['sha'] },
    ...(desc === undefined ? {} : { description: desc }),
  };
}

/** Normalise a host-agnostic file-status token into the domain status union. */
function mapFileStatus(token: string): PullRequestFileStatus {
  const statusByToken: Record<string, PullRequestFileStatus> = {
    added: 'CREATED',
    created: 'CREATED',
    new: 'CREATED',
    modified: 'MODIFIED',
    changed: 'MODIFIED',
    updated: 'MODIFIED',
    removed: 'DELETED',
    deleted: 'DELETED',
    renamed: 'RENAMED',
    moved: 'RENAMED',
    CREATED: 'CREATED',
    MODIFIED: 'MODIFIED',
    DELETED: 'DELETED',
    RENAMED: 'RENAMED',
  };
  const mapped = statusByToken[token.toLowerCase()];
  if (mapped === undefined) {
    throw new GitProviderError(`get-files tool: unknown file status "${token}"`);
  }
  return mapped;
}

function mapFile(v: unknown): PullRequestFile {
  if (!isRecord(v)) {
    throw new GitProviderError('get-files tool: file entry is not an object');
  }
  // Canonical shape (stub) uses `path`/`filename`, GitLab raw uses new_path/old_path + diff
  const path =
    typeof v['path'] === 'string'
      ? v['path']
      : typeof v['filename'] === 'string'
        ? v['filename']
        : typeof v['new_path'] === 'string'
          ? v['new_path']
          : typeof v['old_path'] === 'string'
            ? v['old_path']
            : undefined;
  if (typeof path !== 'string') {
    throw new GitProviderError('get-files tool: file entry missing "path"');
  }
  // GitLab raw diff has booleans new_file/renamed_file/deleted_file, stub has status string
  let status: unknown = v['status'];
  if (typeof status !== 'string') {
    if (v['new_file'] === true) status = 'added';
    else if (v['renamed_file'] === true) status = 'renamed';
    else if (v['deleted_file'] === true) status = 'deleted';
    else status = 'modified';
  }
  if (typeof status !== 'string') {
    throw new GitProviderError('get-files tool: file entry missing "status"');
  }
  const additions = typeof v['additions'] === 'number' ? v['additions'] : 0;
  const deletions = typeof v['deletions'] === 'number' ? v['deletions'] : 0;
  const patch = typeof v['patch'] === 'string' ? v['patch'] : typeof v['diff'] === 'string' ? v['diff'] : '';
  return { path, status: mapFileStatus(status), additions, deletions, patch };
}

/** Narrow the get-files payload (a bare array, or an object wrapping `files`/`changes`). */
function mapFiles(result: ToolResult): PullRequestFile[] {
  let raw = parseJsonContent(result, 'get-files tool');
  if (isRecord(raw)) {
    if (Array.isArray(raw['files'])) {
      raw = raw['files'];
    } else if (Array.isArray(raw['changes'])) {
      raw = raw['changes'];
    } else {
      throw new GitProviderError('get-files tool: payload is not an array or a { files } object');
    }
  }
  if (!Array.isArray(raw)) {
    throw new GitProviderError('get-files tool: payload is not an array');
  }
  return raw.map(mapFile);
}

/**
 * Map a get-PR + get-files tool result pair into a {@link PullRequest}
 * structurally identical to `mapGithubPullRequest` output. `provider` is the
 * host resolved from the repo slug; `repo` is the `host/owner/name` slug.
 */
export function mapMcpGitPullRequest(
  provider: GitProviderType,
  repo: string,
  prResult: ToolResult,
  filesResult: ToolResult,
): PullRequest {
  const pr = parsePr(prResult);
  const files = mapFiles(filesResult);
  return {
    provider,
    number: pr.number,
    title: pr.title,
    description: pr.description ?? '',
    author: pr.author,
    sourceBranch: pr.head.ref,
    targetBranch: pr.base.ref,
    base: { ref: pr.base.ref, sha: pr.base.sha, repo },
    head: { ref: pr.head.ref, sha: pr.head.sha, repo },
    url: pr.url,
    repo,
    files,
  };
}
