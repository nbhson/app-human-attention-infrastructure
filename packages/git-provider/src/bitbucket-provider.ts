/**
 * `BitbucketDirectProvider` — direct Bitbucket REST fallback for the hybrid
 * Bitbucket path.
 *
 * Why this exists: the Bitbucket MCP server (`get_pull_request` + `get_diff`)
 * intermittently returns metadata without usable file content — e.g. an empty
 * `diffs` array, hunk-headers-only patches, or a payload shape the mapper
 * cannot parse. When that happens the review would silently see "no files
 * changed". This provider talks to the Bitbucket API directly (Cloud 2.0 or
 * Server/DC 1.0) so the hybrid wrapper can fail over to a second channel
 * instead of failing the review.
 *
 * - Cloud (`bitbucket.org`): `https://api.bitbucket.org/2.0/repositories/{owner}/{name}`
 * - Server/DC (self-hosted): `{BITBUCKET_URL}/rest/api/1.0/projects/{owner}/repos/{name}`
 *
 * Auth: `BITBUCKET_USERNAME` + `BITBUCKET_PASSWORD` (or `BITBUCKET_APP_PASSWORD`)
 * as Basic, else `BITBUCKET_TOKEN` as Bearer. Unauthenticated requests still
 * work for public repos.
 */

import { GitProviderType } from '@harness/domain';
import type {
  PullRequest,
  PullRequestCheckStatus,
  PullRequestCommit,
  PullRequestFile,
  PullRequestFileStatus,
} from '@harness/domain';

import { GitProviderError, parseRepoPath } from './git-provider.js';
import type { CloneInput, CloneResult, FetchPullRequestInput, GitProvider } from './git-provider.js';
import { cloneAndCheckout } from './clone.js';
import { parseUnifiedDiff } from './unified-diff.js';

export interface BitbucketDirectOptions {
  /** Bearer token (Cloud) or HTTP bearer (Server personal access token). */
  readonly token?: string;
  /** Basic auth username (Cloud app-password username or Server user). */
  readonly username?: string;
  /** Basic auth password / app password. */
  readonly password?: string;
  /** Server/DC base URL, e.g. `https://git.company.com` (no trailing `/rest/...`). */
  readonly serverBaseUrl?: string;
  /** Cloud API root (tests override). */
  readonly cloudBaseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  /** Injectable fetch (tests). */
  readonly fetchFn?: typeof fetch;
}

function readEnv(env: Record<string, string | undefined>): BitbucketDirectOptions {
  const token = env['BITBUCKET_TOKEN'];
  const username = env['BITBUCKET_USERNAME'];
  const password = env['BITBUCKET_PASSWORD'] ?? env['BITBUCKET_APP_PASSWORD'];
  const rawBase = env['BITBUCKET_URL'] ?? env['BITBUCKET_BASE_URL'];
  let serverBaseUrl: string | undefined;
  if (rawBase && rawBase.length > 0) {
    serverBaseUrl = rawBase.replace(/\/+$/, '').replace(/\/rest\/api\/.*$/, '');
  }
  return {
    ...(token ? { token } : {}),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(serverBaseUrl ? { serverBaseUrl } : {}),
  };
}

export function bitbucketDirectFromEnv(
  env: Record<string, string | undefined> = process.env,
): BitbucketDirectOptions | null {
  const opts = readEnv(env);
  if (!opts.token && !opts.username && !opts.serverBaseUrl) {
    return null;
  }
  return opts;
}

export function hasBitbucketDirectCredentials(env: Record<string, string | undefined> = process.env): boolean {
  return bitbucketDirectFromEnv(env) !== null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toStatus(token: string): PullRequestFileStatus {
  const t = token.toLowerCase();
  if (t === 'added' || t === 'created' || t === 'add') return 'CREATED';
  if (t === 'removed' || t === 'deleted' || t === 'remove' || t === 'delete') return 'DELETED';
  if (t === 'renamed' || t === 'rename' || t === 'moved') return 'RENAMED';
  return 'MODIFIED';
}

function countLines(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions };
}

/**
 * Extract the text of one Bitbucket Server diff line.
 *
 * Real Server/DC `/diff` returns `RestDiffLine` objects
 * (`{ source, destination, line, truncated, ... }`) — not bare strings.
 * Tests / older fixtures use bare strings, so accept both.
 */
function diffLineText(line: unknown): string | undefined {
  if (typeof line === 'string') {
    return line;
  }
  if (typeof line === 'object' && line !== null && !Array.isArray(line)) {
    const text = (line as Record<string, unknown>)['line'];
    if (typeof text === 'string') {
      return text;
    }
  }
  return undefined;
}

/** True when a patch carries at least one real +/- code line (not just headers). */
export function patchHasCodeLines(patch: string): boolean {
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++') && line.trim().length > 1) return true;
    if (line.startsWith('-') && !line.startsWith('---') && line.trim().length > 1) return true;
  }
  return false;
}

export class BitbucketDirectProvider implements GitProvider {
  readonly type = GitProviderType.Bitbucket;
  private readonly token: string;
  private readonly username: string | undefined;
  private readonly password: string | undefined;
  private readonly serverBaseUrl: string | undefined;
  private readonly cloudBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchFn: typeof fetch;
  /** Lower-cased host of the configured Server/DC base URL (hybrid routing). */
  readonly serverHost: string | undefined;

  constructor(opts: BitbucketDirectOptions = {}) {
    this.token = opts.token ?? '';
    this.username = opts.username;
    this.password = opts.password;
    this.serverBaseUrl = opts.serverBaseUrl?.replace(/\/+$/, '');
    this.cloudBaseUrl = (opts.cloudBaseUrl ?? 'https://api.bitbucket.org/2.0').replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.fetchFn = opts.fetchFn ?? fetch;
    let host: string | undefined;
    if (this.serverBaseUrl) {
      try {
        host = new URL(this.serverBaseUrl).host.toLowerCase();
      } catch {
        host = undefined;
      }
    }
    this.serverHost = host;
  }

  /** Cloud (`bitbucket.org`) vs Server/DC (any other host, or explicit base URL match). */
  isServerHost(host: string): boolean {
    if (this.serverBaseUrl) {
      try {
        if (new URL(this.serverBaseUrl).host.toLowerCase() === host.toLowerCase()) return true;
      } catch {
        // ignore malformed base URL — fall through to heuristic
      }
    }
    return host.toLowerCase() !== 'bitbucket.org' && host.toLowerCase() !== 'www.bitbucket.org';
  }

  async fetchPullRequest(input: FetchPullRequestInput): Promise<PullRequest> {
    const { host, owner, name } = parseRepoPath(input.repo);
    if (this.isServerHost(host)) {
      return this.fetchServer(input.repo, host, owner, name, input.number);
    }
    return this.fetchCloud(input.repo, owner, name, input.number);
  }

  // ─── Cloud 2.0 ──────────────────────────────────────────────────────────

  private async fetchCloud(repo: string, owner: string, name: string, number: number): Promise<PullRequest> {
    const base = `${this.cloudBaseUrl}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pullrequests/${number}`;
    const meta = (await this.requestJson(base, 'GET')) as Record<string, unknown>;

    const title = typeof meta['title'] === 'string' ? meta['title'] : `Pull request ${number}`;
    const description = typeof meta['description'] === 'string' ? meta['description'] : '';
    const author = cloudAuthor(meta['author']);
    const source = cloudBranch(meta['source']);
    const dest = cloudBranch(meta['destination']);
    const url = cloudUrl(meta) ?? `https://bitbucket.org/${owner}/${name}/pull-requests/${number}`;

    // diffstat (structured file list) + raw diff (per-file patches). Either may
    // fail independently — degrade to whichever succeeds.
    const [diffstat, rawDiff] = await Promise.all([
      this.fetchCloudDiffstat(base).catch(() => [] as CloudDiffstatEntry[]),
      this.fetchText(`${base}/diff`, 'GET').catch(() => ''),
    ]);

    let files: PullRequestFile[] = [];
    if (rawDiff.trim().length > 0) {
      try {
        const parsed = parseUnifiedDiff(rawDiff);
        const counts = new Map(diffstat.map((d) => [d.path, d]));
        files = parsed.map((f) => {
          const stat = counts.get(f.path);
          if (!stat) return f;
          return {
            ...f,
            status: stat.status,
            additions: stat.additions,
            deletions: stat.deletions,
          };
        });
      } catch {
        files = [];
      }
    }
    if (files.length === 0 && diffstat.length > 0) {
      // diffstat-only fallback: file list with empty patches (review can still
      // name the files; hybrid validation will flag "no content" honestly).
      files = diffstat.map((d) => ({
        path: d.path,
        status: d.status,
        additions: d.additions,
        deletions: d.deletions,
        patch: '',
      }));
    }
    if (files.length === 0) {
      throw new GitProviderError(
        `bitbucket direct: no files resolved for ${repo}#${number} (diff + diffstat both empty — check auth scope [pullrequest:read] and that the PR has changes)`,
      );
    }

    const commits = await this.fetchCloudCommits(base).catch((): PullRequestCommit[] => []);
    return {
      provider: GitProviderType.Bitbucket,
      number,
      title,
      description,
      author,
      sourceBranch: source.ref,
      targetBranch: dest.ref,
      base: { ref: dest.ref, sha: dest.sha, repo },
      head: { ref: source.ref, sha: source.sha, repo },
      url,
      repo,
      files,
      ...(commits.length > 0 ? { commits } : {}),
    };
  }

  private async fetchCloudDiffstat(base: string): Promise<CloudDiffstatEntry[]> {
    const out: CloudDiffstatEntry[] = [];
    let url: string | null = `${base}/diffstat?pagelen=100`;
    while (url) {
      const page = (await this.requestJson(url, 'GET')) as Record<string, unknown>;
      const values = Array.isArray(page['values']) ? page['values'] : [];
      for (const v of values) {
        const entry = toCloudEntry(v);
        if (entry) out.push(entry);
      }
      url = typeof page['next'] === 'string' ? page['next'] : null;
    }
    return out;
  }

  private async fetchCloudCommits(base: string): Promise<PullRequestCommit[]> {
    const page = (await this.requestJson(`${base}/commits?pagelen=50`, 'GET')) as Record<string, unknown>;
    const values = Array.isArray(page['values']) ? page['values'] : [];
    return values.flatMap((v): PullRequestCommit[] => {
      if (!isRecord(v) || typeof v['hash'] !== 'string') return [];
      const msg = isRecord(v['message']) && typeof v['message']['raw'] === 'string' ? v['message']['raw'] : '';
      const authorRaw = isRecord(v['author']) ? v['author'] : undefined;
      const author =
        authorRaw && typeof authorRaw['user'] === 'object' && authorRaw['user'] !== null
          ? ((): string => {
              const u = authorRaw['user'] as Record<string, unknown>;
              return typeof u['nickname'] === 'string'
                ? u['nickname']
                : typeof u['display_name'] === 'string'
                  ? u['display_name']
                  : 'unknown';
            })()
          : typeof authorRaw?.['raw'] === 'string'
            ? (authorRaw['raw'] as string)
            : 'unknown';
      const date =
        typeof authorRaw?.['date'] === 'string'
          ? (authorRaw['date'] as string)
          : typeof v['date'] === 'string'
            ? (v['date'] as string)
            : '';
      const link =
        isRecord(v['links']) && isRecord(v['links']['html']) && typeof v['links']['html']['href'] === 'string'
          ? (v['links']['html']['href'] as string)
          : '';
      return [{ sha: v['hash'], message: msg.split('\n')[0] ?? '', author, authorDate: date, url: link }];
    });
  }

  // ─── Server / DC 1.0 ────────────────────────────────────────────────────

  private async fetchServer(
    repo: string,
    host: string,
    owner: string,
    name: string,
    number: number,
  ): Promise<PullRequest> {
    const api = `${this.serverBaseUrl ?? `https://${host}`}/rest/api/1.0`;
    const prBase = `${api}/projects/${encodeURIComponent(owner)}/repos/${encodeURIComponent(name)}/pull-requests/${number}`;
    const meta = (await this.requestJson(prBase, 'GET')) as Record<string, unknown>;

    const title = typeof meta['title'] === 'string' ? meta['title'] : `Pull request ${number}`;
    const description = typeof meta['description'] === 'string' ? meta['description'] : '';
    const author = serverAuthor(meta['author']);
    const from = serverRef(meta['fromRef']);
    const to = serverRef(meta['toRef']);
    const url = serverUrl(meta) ?? `https://${host}/projects/${owner}/repos/${name}/pull-requests/${number}`;

    // Strategy: /diff?withComments=false (JSON {diffs} or raw text) first, then
    // /changes (file list) as a name-level fallback. Patches reconstructed from
    // hunks carry real +/- lines — the exact signal the MCP path was missing.
    let files: PullRequestFile[] = [];
    try {
      const diffRaw = await this.requestDiff(`${prBase}/diff?withComments=false`);
      if (diffRaw) files = diffRaw;
    } catch {
      files = [];
    }
    if (files.length === 0 || !files.some((f) => patchHasCodeLines(f.patch))) {
      const changed = await this.fetchServerChanges(prBase).catch((): ServerChangeEntry[] => []);
      if (changed.length > 0) {
        // Merge: keep diff patches where they have content, fill names from changes.
        const byPath = new Map(files.map((f) => [f.path, f]));
        const merged: PullRequestFile[] = changed.map((c) => {
          const existing = byPath.get(c.path);
          if (existing && existing.patch.trim().length > 0) return existing;
          return { path: c.path, status: c.status, additions: 0, deletions: 0, patch: '' };
        });
        // Keep any diff-only files not in changes (shouldn't happen, but cheap).
        for (const f of files) {
          if (!merged.some((m) => m.path === f.path)) merged.push(f);
        }
        files = merged;
      }
    }
    if (files.length === 0) {
      throw new GitProviderError(
        `bitbucket direct: no files resolved for ${repo}#${number} (Server /diff + /changes both empty — check BITBUCKET_URL, token scope [PROJECT_READ/REPO_READ], and that the PR has changes)`,
      );
    }

    const commits = await this.fetchServerCommits(prBase).catch((): PullRequestCommit[] => []);
    return {
      provider: GitProviderType.Bitbucket,
      number: typeof meta['id'] === 'number' ? meta['id'] : number,
      title,
      description,
      author,
      sourceBranch: from.ref,
      targetBranch: to.ref,
      base: { ref: to.ref, sha: to.sha, repo },
      head: { ref: from.ref, sha: from.sha, repo },
      url,
      repo,
      files,
      ...(commits.length > 0 ? { commits } : {}),
    };
  }

  /** GET a Server diff endpoint that may return JSON {diffs} or raw text. */
  private async requestDiff(path: string): Promise<PullRequestFile[]> {
    const res = await this.requestRaw(path, 'GET');
    const contentType = res.headers.get('content-type') ?? '';
    const body = await res.text();
    if (body.trim().length === 0) return [];
    if (contentType.includes('json') || body.trimStart().startsWith('{')) {
      try {
        const parsed = JSON.parse(body) as unknown;
        if (isRecord(parsed) && Array.isArray(parsed['diffs'])) {
          return serverDiffsToFiles(parsed as { diffs: unknown[] });
        }
      } catch {
        // fall through to unified-diff attempt
      }
    }
    try {
      return parseUnifiedDiff(body);
    } catch {
      return [];
    }
  }

  private async fetchServerChanges(prBase: string): Promise<ServerChangeEntry[]> {
    const out: ServerChangeEntry[] = [];
    let start = 0;
    for (let page = 0; page < 20; page++) {
      const data = (await this.requestJson(`${prBase}/changes?start=${start}&limit=100`, 'GET')) as Record<
        string,
        unknown
      >;
      const values = Array.isArray(data['values']) ? data['values'] : [];
      for (const v of values) {
        const entry = toServerChange(v);
        if (entry) out.push(entry);
      }
      const isLast = data['isLastPage'] !== false;
      if (isLast) break;
      start = typeof data['nextPageStart'] === 'number' ? data['nextPageStart'] : start + values.length;
      if (values.length === 0) break;
    }
    return out;
  }

  private async fetchServerCommits(prBase: string): Promise<PullRequestCommit[]> {
    const data = (await this.requestJson(`${prBase}/commits?limit=50`, 'GET')) as Record<string, unknown>;
    const values = Array.isArray(data['values']) ? data['values'] : [];
    return values.flatMap((v): PullRequestCommit[] => {
      if (!isRecord(v) || typeof v['id'] !== 'string') return [];
      const msg = typeof v['message'] === 'string' ? v['message'] : '';
      const author =
        isRecord(v['author']) && typeof v['author']['displayName'] === 'string'
          ? (v['author']['displayName'] as string)
          : 'unknown';
      const date = typeof v['authorTimestamp'] === 'number' ? new Date(v['authorTimestamp']).toISOString() : '';
      return [{ sha: v['id'], message: msg.split('\n')[0] ?? '', author, authorDate: date, url: '' }];
    });
  }

  // ─── write / clone (delegate-compatible) ────────────────────────────────

  async postComment(input: FetchPullRequestInput, body: string): Promise<void> {
    const { host, owner, name } = parseRepoPath(input.repo);
    if (this.isServerHost(host)) {
      const api = `${this.serverBaseUrl ?? `https://${host}`}/rest/api/1.0`;
      await this.requestJson(
        `${api}/projects/${encodeURIComponent(owner)}/repos/${encodeURIComponent(name)}/pull-requests/${input.number}/comments`,
        'POST',
        { text: body },
      );
      return;
    }
    await this.requestJson(
      `${this.cloudBaseUrl}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pullrequests/${input.number}/comments`,
      'POST',
      { content: { raw: body } },
    );
  }

  async setStatus(
    input: FetchPullRequestInput,
    state: 'pending' | 'success' | 'failure',
    description: string,
  ): Promise<void> {
    void input;
    void state;
    void description;
    // Bitbucket commit-status APIs differ per edition; the MCP write-back path
    // owns status. Fail loudly rather than posting to the wrong endpoint.
    throw new GitProviderError('bitbucket direct: setStatus is not implemented — use the MCP write-back path');
  }

  async cloneAndCheckout(input: CloneInput, workdir: string): Promise<CloneResult> {
    return cloneAndCheckout(input, workdir);
  }

  // ─── HTTP ───────────────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    if (this.username && this.password) {
      return { Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}` };
    }
    if (this.token.length > 0) {
      return { Authorization: `Bearer ${this.token}` };
    }
    return {};
  }

  private async requestRaw(path: string, method: string, body?: unknown): Promise<Response> {
    return this.withRetry(`${method} ${path}`, async () => {
      const headers: Record<string, string> = { Accept: 'application/json', ...this.authHeaders() };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await this.fetchFn(path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new GitProviderError(
          `${method} ${path} failed: ${response.status} ${response.statusText}`,
          response.status,
        );
      }
      return response;
    });
  }

  private async requestJson(path: string, method: string, body?: unknown): Promise<unknown> {
    const res = await this.requestRaw(path, method, body);
    return res.json() as Promise<unknown>;
  }

  private async fetchText(path: string, method: string): Promise<string> {
    const res = await this.requestRaw(path, method);
    return res.text();
  }

  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const transient =
          error instanceof GitProviderError
            ? error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504
            : error instanceof Error &&
              (error.name === 'AbortError' ||
                error.name === 'TimeoutError' ||
                /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(error.message));
        if (!transient || attempt === this.maxRetries) throw error;
        const backoff = Math.min(500 * 2 ** attempt, 4000) + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`${label} retry exhausted`);
  }

  /** Build-commit-status helper kept for parity with GitHubProvider (unused by reviews). */
  voidCheck(_s: PullRequestCheckStatus): void {
    void _s;
  }
}

// ─── Cloud helpers ────────────────────────────────────────────────────────

interface CloudDiffstatEntry {
  readonly path: string;
  readonly status: PullRequestFileStatus;
  readonly additions: number;
  readonly deletions: number;
}

function toCloudEntry(v: unknown): CloudDiffstatEntry | null {
  if (!isRecord(v)) return null;
  const path =
    typeof v['new'] === 'object' &&
    v['new'] !== null &&
    typeof (v['new'] as Record<string, unknown>)['path'] === 'string'
      ? ((v['new'] as Record<string, unknown>)['path'] as string)
      : typeof v['old'] === 'object' &&
          v['old'] !== null &&
          typeof (v['old'] as Record<string, unknown>)['path'] === 'string'
        ? ((v['old'] as Record<string, unknown>)['path'] as string)
        : typeof v['path'] === 'string'
          ? (v['path'] as string)
          : null;
  if (!path) return null;
  return {
    path,
    status: toStatus(typeof v['status'] === 'string' ? (v['status'] as string) : 'modified'),
    additions: typeof v['lines_added'] === 'number' ? v['lines_added'] : 0,
    deletions: typeof v['lines_removed'] === 'number' ? v['lines_removed'] : 0,
  };
}

function cloudAuthor(author: unknown): string {
  if (typeof author === 'string') return author;
  if (!isRecord(author)) return 'unknown';
  const user = isRecord(author['user']) ? (author['user'] as Record<string, unknown>) : author;
  for (const k of ['nickname', 'display_name', 'username']) {
    if (typeof user[k] === 'string') return user[k] as string;
  }
  return 'unknown';
}

function cloudBranch(ref: unknown): { ref: string; sha: string } {
  if (!isRecord(ref)) return { ref: 'unknown', sha: '' };
  const branch = isRecord(ref['branch']) ? (ref['branch'] as Record<string, unknown>) : undefined;
  const commit = isRecord(ref['commit']) ? (ref['commit'] as Record<string, unknown>) : undefined;
  return {
    ref: branch && typeof branch['name'] === 'string' ? (branch['name'] as string) : 'unknown',
    sha: commit && typeof commit['hash'] === 'string' ? (commit['hash'] as string) : '',
  };
}

function cloudUrl(meta: Record<string, unknown>): string | undefined {
  if (!isRecord(meta['links'])) return undefined;
  const links = meta['links'] as Record<string, unknown>;
  if (isRecord(links['html']) && typeof links['html']['href'] === 'string') return links['html']['href'] as string;
  return undefined;
}

// ─── Server helpers ───────────────────────────────────────────────────────

interface ServerChangeEntry {
  readonly path: string;
  readonly status: PullRequestFileStatus;
}

function toServerChange(v: unknown): ServerChangeEntry | null {
  if (!isRecord(v)) return null;
  const pathObj = isRecord(v['path']) ? (v['path'] as Record<string, unknown>) : undefined;
  const path = pathObj && typeof pathObj['toString'] === 'string' ? (pathObj['toString'] as string) : null;
  if (!path) return null;
  // Server change types: ADD, MODIFY, DELETE, MOVE, COPY.
  const type = typeof v['type'] === 'string' ? (v['type'] as string) : 'MODIFY';
  const map: Record<string, PullRequestFileStatus> = {
    ADD: 'CREATED',
    MODIFY: 'MODIFIED',
    DELETE: 'DELETED',
    MOVE: 'RENAMED',
    COPY: 'RENAMED',
  };
  return { path, status: map[type] ?? 'MODIFIED' };
}

function serverAuthor(author: unknown): string {
  if (typeof author === 'string') return author;
  if (!isRecord(author)) return 'unknown';
  const user = isRecord(author['user']) ? (author['user'] as Record<string, unknown>) : author;
  for (const k of ['displayName', 'name', 'slug']) {
    if (typeof user[k] === 'string') return user[k] as string;
  }
  return 'unknown';
}

function serverRef(ref: unknown): { ref: string; sha: string } {
  if (!isRecord(ref)) return { ref: 'unknown', sha: '' };
  return {
    ref: typeof ref['displayId'] === 'string' ? (ref['displayId'] as string) : 'unknown',
    sha: typeof ref['latestCommit'] === 'string' ? (ref['latestCommit'] as string) : '',
  };
}

function serverUrl(meta: Record<string, unknown>): string | undefined {
  if (!isRecord(meta['links'])) return undefined;
  const links = meta['links'] as Record<string, unknown>;
  const self = links['self'];
  if (Array.isArray(self) && self.length > 0 && isRecord(self[0]) && typeof self[0]['href'] === 'string') {
    return self[0]['href'] as string;
  }
  return undefined;
}

/** Reconstruct per-file unified diffs from Server `{diffs:[{source,destination,hunks}]}`. */
function serverDiffsToFiles(raw: { diffs: unknown[] }): PullRequestFile[] {
  const files: PullRequestFile[] = [];
  for (const diff of raw.diffs) {
    if (!isRecord(diff)) continue;
    const dest = isRecord(diff['destination']) ? (diff['destination'] as Record<string, unknown>) : undefined;
    const src = isRecord(diff['source']) ? (diff['source'] as Record<string, unknown>) : undefined;
    const path =
      dest && typeof dest['toString'] === 'string'
        ? (dest['toString'] as string)
        : src && typeof src['toString'] === 'string'
          ? (src['toString'] as string)
          : undefined;
    if (!path) continue;
    const isNew = !src || Object.keys(src).length === 0;
    const isDeleted = !dest || Object.keys(dest).length === 0;
    const status: PullRequestFileStatus = isNew ? 'CREATED' : isDeleted ? 'DELETED' : 'MODIFIED';
    const hunks = Array.isArray(diff['hunks']) ? (diff['hunks'] as unknown[]) : [];
    const patchLines: string[] = [];
    let additions = 0;
    let deletions = 0;
    for (const hunk of hunks) {
      if (!isRecord(hunk)) continue;
      const sl = typeof hunk['sourceLine'] === 'number' ? hunk['sourceLine'] : 0;
      const ss = typeof hunk['sourceSpan'] === 'number' ? hunk['sourceSpan'] : 0;
      const dl = typeof hunk['destinationLine'] === 'number' ? hunk['destinationLine'] : 0;
      const ds = typeof hunk['destinationSpan'] === 'number' ? hunk['destinationSpan'] : 0;
      patchLines.push(`@@ -${sl},${ss} +${dl},${ds} @@`);
      const segments = Array.isArray(hunk['segments']) ? (hunk['segments'] as unknown[]) : [];
      for (const seg of segments) {
        if (!isRecord(seg)) continue;
        const type = typeof seg['type'] === 'string' ? seg['type'] : '';
        const kind = type.toUpperCase();
        const lines = Array.isArray(seg['lines']) ? (seg['lines'] as unknown[]) : [];
        for (const line of lines) {
          const text = diffLineText(line);
          if (text === undefined) continue;
          const prefix = kind === 'ADDED' ? '+' : kind === 'REMOVED' ? '-' : ' ';
          patchLines.push(`${prefix}${text}`);
          if (kind === 'ADDED') additions += 1;
          else if (kind === 'REMOVED') deletions += 1;
        }
      }
    }
    // Fall back to counted lines when the host omits segment types.
    if (additions === 0 && deletions === 0 && patchLines.length > 0) {
      const c = countLines(patchLines.join('\n'));
      additions = c.additions;
      deletions = c.deletions;
    }
    files.push({ path, status, additions, deletions, patch: patchLines.join('\n') });
  }
  return files;
}
