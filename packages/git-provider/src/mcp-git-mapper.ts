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

import { GitProviderType } from '@harness/domain';
import type { PullRequest, PullRequestFile, PullRequestFileStatus } from '@harness/domain';
import type { ToolResult } from '@harness/mcp';

import { GitProviderError } from './git-provider.js';
import { parseUnifiedDiff } from './unified-diff.js';
/**
 * Count `+`/`-` lines in a unified-diff patch string. Used as a fallback when
 * the MCP tool omitted `additions`/`deletions` (e.g. GitLab raw diff has no
 * such fields; Bitbucket `get_diff` returns hunks without line counts). A
 * patch of only `@@` hunk headers carries no code lines, so the count stays 0 —
 * which is the honest signal that the host returned a summarised diff.
 */
function countDiffLines(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

/**
 * A host can return a *summarised* per-file patch: only the `@@ … @@` hunk
 * headers, no code lines (e.g. a GitLab `diff` string that dropped its body, or
 * a Bitbucket `get_diff` response whose segments arrived without `lines`).
 * Detect that shape and synthesise a full unified-diff block — file headers
 * plus one context-free hunk per header — so the review UI renders the
 * file's changed region instead of an empty box. Line counts come from the
 * hunk spans, never invented.
 *
 * NOTE (hybrid fix): this synthesis recovers *geometry* (file names + hunk
 * positions) but NOT file *content*. `HybridGitProvider.hasUsableFileContent`
 * treats a headers-only patch as unusable on purpose, so Bitbucket reads still
 * fail over to the direct REST channel (`BitbucketDirectProvider`) which
 * returns real `+`/`-` lines. Never weaken that check because the synthesised
 * block "looks non-empty" — the review would otherwise see file names
 * with zero reviewable lines.
 */
function synthesiseFromHunkHeaders(path: string, patch: string): string {
  const lines = patch.split('\n');
  const hunks = lines.filter((line) => line.startsWith('@@'));
  if (hunks.length === 0) {
    return patch; // Not the summarised shape — leave it untouched.
  }
  const oldRef = `a/${path}`;
  const newRef = `b/${path}`;
  const block = [`diff --git ${oldRef} ${newRef}`, `--- ${oldRef}`, `+++ ${newRef}`, ...lines];
  return block.join('\n');
}

/**
 * The canonical JSON the get-PR tool returns (transport-host-agnostic).
 */
interface McpPrPayload {
  readonly number: number;
  readonly title: string;
  readonly description?: string;
  readonly author: string;
  readonly head: { readonly ref: string; readonly sha: string | undefined };
  readonly base: { readonly ref: string; readonly sha: string | undefined };
  readonly url?: string;
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

/** Concatenate the text content blocks of a tool result (for non-JSON payloads). */
function toolTextContent(result: ToolResult): string {
  const parts: string[] = [];
  for (const block of result.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    } else if (block.type === 'resource' && typeof block.resource.text === 'string') {
      parts.push(block.resource.text);
    }
  }
  return parts.join('\n');
}

/** Narrow a Bitbucket branch ref ({displayId, latestCommit} on Server). */
function bitbucketRef(ref: unknown): { ref: string; sha: string | undefined } | undefined {
  if (!isRecord(ref)) {
    return undefined;
  }
  // Server: fromRef/toRef { displayId: "feature/x", latestCommit?: "<sha>" }.
  // latestCommit may be absent; sha will be filled from diff later.
  if (typeof ref['displayId'] === 'string') {
    const sha = typeof ref['latestCommit'] === 'string' ? ref['latestCommit'] : undefined;
    return { ref: ref['displayId'], sha };
  }
  // Cloud: source/destination { branch: { name }, commit: { hash } }.
  if (isRecord(ref['branch']) && typeof ref['branch']['name'] === 'string') {
    const commit = isRecord(ref['commit']) && typeof ref['commit']['hash'] === 'string' ? ref['commit']['hash'] : '';
    return { ref: ref['branch']['name'], sha: commit };
  }
  return undefined;
}

/** Narrow a Bitbucket author (Server nests it under author.user). */
function bitbucketAuthor(author: unknown): string | undefined {
  if (typeof author === 'string') {
    return author;
  }
  if (!isRecord(author)) {
    return undefined;
  }
  const user = isRecord(author['user']) ? author['user'] : author;
  if (!isRecord(user)) {
    return undefined;
  }
  for (const key of ['displayName', 'display_name', 'nickname', 'username', 'name']) {
    if (typeof user[key] === 'string') {
      return user[key] as string;
    }
  }
  return undefined;
}

/** Narrow a Bitbucket PR url (Server links.self[0].href, Cloud links.html.href). */
function bitbucketUrl(raw: Record<string, unknown>): string | undefined {
  if (!isRecord(raw['links'])) {
    return undefined;
  }
  const links = raw['links'];
  if (Array.isArray(links['self']) && links['self'].length > 0 && isRecord(links['self'][0])) {
    const href = links['self'][0]['href'];
    if (typeof href === 'string') {
      return href;
    }
  }
  if (isRecord(links['html']) && typeof links['html']['href'] === 'string') {
    return links['html']['href'];
  }
  return undefined;
}

/** Narrow the get-PR payload, throwing on every missing required field. */
function parsePr(result: ToolResult): McpPrPayload {
  const parsed = parseJsonContent(result, 'get-pr tool');
  if (!isRecord(parsed)) {
    throw new GitProviderError('get-pr tool: payload is not an object');
  }
  // Some MCP servers wrap the raw forge payload in a `data` envelope.
  const raw = isRecord(parsed['data']) ? (parsed['data'] as Record<string, unknown>) : parsed;
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
    // last resort: use id if iid missing (GitLab MRs, Bitbucket PRs)
    number = raw['id'];
  }
  if (typeof author === 'object' && author !== null) {
    // GitLab author is { username, name }
    const a = author as Record<string, unknown>;
    author = typeof a['username'] === 'string' ? a['username'] : typeof a['name'] === 'string' ? a['name'] : author;
  }
  // Bitbucket Cloud author { display_name/nickname }, Server author.user { displayName }
  const bbAuthor = bitbucketAuthor(author);
  if (typeof author !== 'string' && bbAuthor !== undefined) {
    author = bbAuthor;
  }
  if (typeof url !== 'string' && typeof raw['web_url'] === 'string') {
    url = raw['web_url'];
  }
  // Bitbucket Server links.self[0].href, Cloud links.html.href
  if (typeof url !== 'string') {
    const bbUrl = bitbucketUrl(raw);
    if (bbUrl !== undefined) {
      url = bbUrl;
    }
  }
  // url remains unknown if not found - handled as optional in McpPrPayload
  if (!isRecord(head) && typeof raw['source_branch'] === 'string') {
    const sha =
      typeof raw['sha'] === 'string'
        ? raw['sha']
        : isRecord(raw['diff_refs']) && typeof raw['diff_refs']['head_sha'] === 'string'
          ? (raw['diff_refs']['head_sha'] as string)
          : '';
    head = { ref: raw['source_branch'] as string, sha };
  }
  // Bitbucket Server fromRef/toRef, Cloud source/destination.
  if (!isRecord(head)) {
    const bbHead = bitbucketRef(raw['fromRef']) ?? bitbucketRef(raw['source']);
    if (bbHead !== undefined) {
      head = bbHead;
    }
  }
  if (!isRecord(base) && typeof raw['target_branch'] === 'string') {
    const sha =
      isRecord(raw['diff_refs']) && typeof raw['diff_refs']['base_sha'] === 'string'
        ? (raw['diff_refs']['base_sha'] as string)
        : '';
    base = { ref: raw['target_branch'] as string, sha };
  }
  // Bitbucket Server toRef, Cloud destination.
  if (!isRecord(base)) {
    const bbBase = bitbucketRef(raw['toRef']) ?? bitbucketRef(raw['destination']);
    if (bbBase !== undefined) {
      base = bbBase;
    }
  }
  // Bitbucket Server SHAs: fromRef.latestCommit / toRef.latestCommit (not nested in branch/commit)
  if (!isRecord(head) && isRecord(raw['fromRef'])) {
    const fromRef = raw['fromRef'] as Record<string, unknown>;
    if (typeof fromRef['latestCommit'] === 'string' && typeof fromRef['displayId'] === 'string') {
      head = { ref: fromRef['displayId'], sha: fromRef['latestCommit'] };
    }
  }
  if (!isRecord(base) && isRecord(raw['toRef'])) {
    const toRef = raw['toRef'] as Record<string, unknown>;
    if (typeof toRef['latestCommit'] === 'string' && typeof toRef['displayId'] === 'string') {
      base = { ref: toRef['displayId'], sha: toRef['latestCommit'] };
    }
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
  // url is optional - constructed in mapMcpGitPullRequest if missing
  if (!isRecord(head) || typeof head['ref'] !== 'string') {
    throw new GitProviderError('get-pr tool: missing "head.ref"');
  }
  if (!isRecord(base) || typeof base['ref'] !== 'string') {
    throw new GitProviderError('get-pr tool: missing "base.ref"');
  }
  const desc = typeof description === 'string' ? description : undefined;
  const headSha = (typeof head['sha'] === 'string' ? head['sha'] : undefined) as string | undefined;
  const baseSha = (typeof base['sha'] === 'string' ? base['sha'] : undefined) as string | undefined;
  const basePayload = {
    number,
    title,
    author,
    head: { ref: head['ref'] as string, sha: headSha },
    base: { ref: base['ref'] as string, sha: baseSha },
    ...(desc === undefined ? {} : { description: desc }),
  };
  return typeof url === 'string' ? { ...basePayload, url } : basePayload;
}

/** Normalise a host-agnostic file-status token into the domain status union. */
/**
 * Extract the text of one Bitbucket Server diff line.
 *
 * Real Server/DC `get_diff` returns `RestDiffLine` objects
 * (`{ source, destination, line, truncated, ... }`) — not bare strings.
 * The MCP stub + older fixtures use bare strings, so accept both.
 * Returns `undefined` when the entry carries no usable text.
 */
function diffLineText(line: unknown): string | undefined {
  if (typeof line === 'string') {
    return line;
  }
  if (isRecord(line) && typeof line['line'] === 'string') {
    return line['line'] as string;
  }
  return undefined;
}

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
  const rawPatch = typeof v['patch'] === 'string' ? v['patch'] : typeof v['diff'] === 'string' ? v['diff'] : '';
  // A summarised host diff (hunk headers only, no code lines) is synthesised into
  // a full unified-diff block so the UI renders the changed region. A patch that
  // already carries code lines (or is empty) is kept verbatim.
  const hasCodeLines = rawPatch
    .split('\n')
    .some(
      (line) => (line.startsWith('+') && !line.startsWith('+++')) || (line.startsWith('-') && !line.startsWith('---')),
    );
  const patch = rawPatch.length > 0 && !hasCodeLines ? synthesiseFromHunkHeaders(path, rawPatch) : rawPatch;
  // Fallback: tools that omit `additions`/`deletions` (GitLab raw diff,
  // Bitbucket get_diff) leave them 0 even when the patch carries real lines.
  // Derive the counts from the patch so `+N −N` and stats stay honest.
  const counts = patch.length > 0 ? countDiffLines(patch) : { additions: 0, deletions: 0 };
  const additions = typeof v['additions'] === 'number' ? v['additions'] : counts.additions;
  const deletions = typeof v['deletions'] === 'number' ? v['deletions'] : counts.deletions;
  return { path, status: mapFileStatus(status), additions, deletions, patch };
}

/** Narrow the get-files payload (a bare array, or an object wrapping `files`/`changes`). */
function mapFiles(result: ToolResult): PullRequestFile[] {
  let raw: unknown;
  try {
    raw = parseJsonContent(result, 'get-files tool');
  } catch (error) {
    // The Bitbucket get-files tool returns raw unified diff text, not JSON.
    if (result.isError || !(error instanceof GitProviderError) || !/no JSON payload/.test(error.message)) {
      throw error;
    }
    return parseUnifiedDiff(toolTextContent(result));
  }
  // Bitbucket Server get_diff returns a JSON string that contains another JSON string (double-encoded).
  // First parse gives a string, second parse gives the actual { diffs: [...] } object.
  while (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (isRecord(parsed) && Array.isArray(parsed['diffs'])) {
        return parseBitbucketServerDiff(parsed);
      }
      // If it's a string but not the diff object, might be unified diff text
      if (!isRecord(parsed)) {
        return parseUnifiedDiff(raw as string);
      }
      raw = parsed;
    } catch {
      // Not valid JSON, treat as unified diff text
      return parseUnifiedDiff(raw as string);
    }
  }
  if (isRecord(raw)) {
    if (Array.isArray(raw['files'])) {
      raw = raw['files'];
    } else if (Array.isArray(raw['changes'])) {
      raw = raw['changes'];
    } else if (Array.isArray(raw['diffs'])) {
      // Bitbucket Server get_diff returns { diffs: [...] }
      return parseBitbucketServerDiff(raw);
    } else {
      throw new GitProviderError('get-files tool: payload is not an array or a { files } object');
    }
  }
  if (!Array.isArray(raw)) {
    // Bitbucket Server get_diff returns { diffs: [...] } with hunks
    if (isRecord(raw) && Array.isArray(raw['diffs'])) {
      return parseBitbucketServerDiff(raw);
    }
    throw new GitProviderError('get-files tool: payload is not an array');
  }
  return raw.map(mapFile);
}

/**
 * Parse Bitbucket Server / Data Center get_diff response.
 * The response has a `diffs` array where each entry has:
 * - source/destination: { components, parent, name, extension, toString }
 * - hunks: array of { context, sourceLine, sourceSpan, destinationLine, destinationSpan, segments }
 * We reconstruct a unified diff per file.
 */
function parseBitbucketServerDiff(raw: Record<string, unknown>): PullRequestFile[] {
  const diffs = raw['diffs'];
  if (!Array.isArray(diffs)) {
    throw new GitProviderError('get-files tool: bitbucket server diff missing "diffs" array');
  }
  const files: PullRequestFile[] = [];
  for (const diff of diffs) {
    if (!isRecord(diff)) {
      continue;
    }
    const dest = isRecord(diff['destination']) ? diff['destination'] : undefined;
    const src = isRecord(diff['source']) ? diff['source'] : undefined;
    // Path: prefer destination.toString, fallback to source.toString
    const path =
      dest && typeof dest['toString'] === 'string'
        ? dest['toString']
        : src && typeof src['toString'] === 'string'
          ? src['toString']
          : undefined;
    if (typeof path !== 'string' || path.length === 0) {
      continue;
    }
    // Status: infer from source/destination existence
    const isNew = src === undefined || Object.keys(src).length === 0;
    const isDeleted = dest === undefined || Object.keys(dest).length === 0;
    const status = isNew ? 'CREATED' : isDeleted ? 'DELETED' : 'MODIFIED';
    // Reconstruct unified diff from hunks
    const hunks = Array.isArray(diff['hunks']) ? diff['hunks'] : [];
    let additions = 0;
    let deletions = 0;
    const patchLines: string[] = [];
    for (const hunk of hunks) {
      if (!isRecord(hunk)) {
        continue;
      }
      const srcLine = typeof hunk['sourceLine'] === 'number' ? hunk['sourceLine'] : 0;
      const dstLine = typeof hunk['destinationLine'] === 'number' ? hunk['destinationLine'] : 0;
      const srcSpan = typeof hunk['sourceSpan'] === 'number' ? hunk['sourceSpan'] : 0;
      const dstSpan = typeof hunk['destinationSpan'] === 'number' ? hunk['destinationSpan'] : 0;
      patchLines.push(`@@ -${srcLine},${srcSpan} +${dstLine},${dstSpan} @@`);
      const segments = Array.isArray(hunk['segments']) ? hunk['segments'] : [];
      for (const seg of segments) {
        if (!isRecord(seg)) {
          continue;
        }
        const type = typeof seg['type'] === 'string' ? seg['type'] : '';
        const kind = type.toUpperCase();
        const lines = Array.isArray(seg['lines']) ? seg['lines'] : [];
        for (const line of lines) {
          const text = diffLineText(line);
          if (text === undefined) {
            continue;
          }
          const prefix = kind === 'ADDED' ? '+' : kind === 'REMOVED' ? '-' : ' ';
          patchLines.push(`${prefix}${text}`);
          if (kind === 'ADDED') additions += 1;
          else if (kind === 'REMOVED') deletions += 1;
        }
      }
    }
    files.push({
      path,
      status,
      additions,
      deletions,
      patch: patchLines.join('\n'),
    });
  }
  if (files.length === 0) {
    throw new GitProviderError('get-files tool: no files parsed from bitbucket server diff');
  }
  return files;
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
  // Construct URL if missing (Bitbucket Server doesn't always provide links)
  let url = pr.url;
  if (!url && provider === GitProviderType.Bitbucket) {
    const parts = repo.split('/');
    if (parts.length >= 3) {
      const host = parts[0];
      const project = parts[1];
      const repoSlug = parts.slice(2).join('/');
      url = `https://${host}/projects/${project}/repos/${repoSlug}/pull-requests/${pr.number}`;
    }
  }
  return {
    provider,
    number: pr.number,
    title: pr.title,
    description: pr.description ?? '',
    author: pr.author,
    sourceBranch: pr.head.ref,
    targetBranch: pr.base.ref,
    base: { ref: pr.base.ref, sha: pr.base.sha ?? '', repo },
    head: { ref: pr.head.ref, sha: pr.head.sha ?? '', repo },
    url: url!,
    repo,
    files,
  };
}
