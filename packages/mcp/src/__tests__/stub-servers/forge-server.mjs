// In-repo stubbed MCP servers for the Week-1 connectivity checkpoint (day-05).
//
// A single stdio subprocess stands in for all four hosts — github / gitlab /
// bitbucket / jira — because the *tool name* (not the process) is what
// discriminates the host. `mcp.config.json` can point all four server names at
// this one file; each `tools/call` is answered from a tool→payload table with
// fixture JSON that survives the real mappers of Days 03–04 verbatim.
//
// A `get_merge_request` tool name carries a GitLab payload, `get_pull_request`
// a GitHub one, `get_pullrequest` a Bitbucket one, `get_issue` a Jira issue —
// so resolving any host URL and fetching through it returns the same-shaped
// data a real MCP server would. Unknown tools (the Day-06 write-back surface)
// succeed quietly rather than fail the checkpoint.
//
// Test/demo-only — never a real server, never holds a token.

import { createInterface } from 'node:readline';

// --- Fixture payloads (canonical MCP JSON shapes from Days 03–04) -----------

const GITHUB_PR = {
  number: 1,
  title: 'Fix: dedupe the actor backfill query',
  description: 'A GitHub pull request fixture.',
  author: 'alice',
  head: { ref: 'feature/dedupe', sha: 'gh-head-0000000000000000000000001' },
  base: { ref: 'main', sha: 'gh-base-0000000000000000000000001' },
  url: 'https://github.com/acme/widget/pull/1',
};

const GITHUB_FILES = [
  {
    path: 'src/actors/backfill.ts',
    status: 'modified',
    additions: 12,
    deletions: 4,
    patch: '@@ -10,4 +10,12 @@\n-const seen = []\n+const seen = new Set()',
  },
  { path: 'src/actors/new.ts', status: 'added', additions: 20, deletions: 0 },
];

const GITLAB_MR = {
  number: 7,
  title: 'Chore: bump the sandbox image tag',
  description: 'A GitLab merge request fixture.',
  author: 'bob',
  head: { ref: 'feature/bump', sha: 'gl-head-0000000000000000000000007' },
  base: { ref: 'main', sha: 'gl-base-0000000000000000000000007' },
  url: 'https://gitlab.com/acme/widget/-/merge_requests/7',
};

const GITLAB_FILES = [
  {
    path: 'docker-compose.yml',
    status: 'modified',
    additions: 1,
    deletions: 1,
    patch: '@@ -3,1 +3,1 @@\n-image: sandbox:1.2\n+image: sandbox:1.3',
  },
  { path: 'README.md', status: 'modified', additions: 3, deletions: 0 },
];

const BITBUCKET_PR = {
  number: 3,
  title: 'Refactor: extract the review queue writer',
  description: 'A Bitbucket pull request fixture.',
  author: 'carol',
  head: { ref: 'feature/extract', sha: 'bb-head-0000000000000000000000003' },
  base: { ref: 'main', sha: 'bb-base-0000000000000000000000003' },
  url: 'https://bitbucket.org/acme/widget/pull-requests/3',
};

const BITBUCKET_FILES = [
  { path: 'src/review/writer.ts', status: 'removed', additions: 0, deletions: 41 },
  { path: 'src/review/queue.ts', status: 'modified', additions: 6, deletions: 2 },
];

const JIRA_ISSUE = {
  key: 'ACME-42',
  fields: {
    summary: 'Fix the thing',
    description: {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It is broken.' }] }],
    },
    issuetype: { name: 'Bug' },
  },
};

/** tool name → the single JSON document returned as `types/text` content. */
const TOOL_RESULTS = {
  // github
  get_pull_request: GITHUB_PR,
  list_pull_request_files: GITHUB_FILES,
  // gitlab
  get_merge_request: GITLAB_MR,
  list_merge_request_diffs: GITLAB_FILES,
  // bitbucket
  get_pullrequest: BITBUCKET_PR,
  list_pullrequest_files: BITBUCKET_FILES,
  // jira
  get_issue: JIRA_ISSUE,
};

const rl = createInterface({ input: process.stdin });

function reply(id, result, error) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) })}\n`);
}

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === 'initialize') {
    reply(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: {},
      serverInfo: { name: 'forge-stub', version: '0.3.0' },
    });
  } else if (msg.method === 'tools/list') {
    reply(msg.id, {
      tools: Object.keys(TOOL_RESULTS).map((name) => ({
        name,
        description: `stubbed ${name}`,
        inputSchema: { type: 'object' },
      })),
    });
  } else if (msg.method === 'tools/call') {
    const payload = TOOL_RESULTS[msg.params.name];
    if (payload === undefined) {
      // Unknown tool — the Day-06 write-back surface. Succeed quietly so the
      // checkpoint never trips over a tool it doesn't read.
      reply(msg.id, { isError: false, content: [] });
      return;
    }
    reply(msg.id, {
      isError: false,
      content: [{ type: 'text', text: JSON.stringify(payload) }],
    });
  } else {
    reply(msg.id, undefined, { code: -32601, message: 'method not found' });
  }
});
