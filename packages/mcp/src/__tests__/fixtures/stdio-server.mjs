// Minimal MCP server fixture for the StdioTransport tests. Spawned as a
// subprocess (`node fixtures/stdio-server.mjs`); reads JSON-lines from stdin
// and answers initialize / tools/list / tools/call. Test-only — never a real
// server, never holds a token.
//
// Flags:
//   --garbage             emit a non-JSON line before every response
//   --exit-on-initialize  exit(3) instead of answering initialize

import { createInterface } from 'node:readline';

const garbage = process.argv.includes('--garbage');
const exitOnInitialize = process.argv.includes('--exit-on-initialize');

const rl = createInterface({ input: process.stdin });

function reply(id, result, error) {
  if (garbage) {
    process.stdout.write('this-is-not-json\n');
  }
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) })}\n`,
  );
}

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === 'initialize') {
    if (exitOnInitialize) {
      process.exit(3);
      return;
    }
    reply(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: {},
      serverInfo: { name: 'fixture', version: '1.0.0' },
    });
  } else if (msg.method === 'tools/list') {
    reply(msg.id, {
      tools: [{ name: 'echo', description: 'echo back', inputSchema: { type: 'object' } }],
    });
  } else if (msg.method === 'tools/call') {
    reply(msg.id, {
      isError: false,
      content: [{ type: 'text', text: `echo:${JSON.stringify(msg.params.arguments)}` }],
    });
  } else {
    reply(msg.id, undefined, { code: -32601, message: 'method not found' });
  }
});
