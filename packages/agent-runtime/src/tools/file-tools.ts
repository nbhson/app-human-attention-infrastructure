/**
 * The three real sandbox tools (day-13 §2.1 / §3.3): `read_file`,
 * `write_file`, and `list_directory`.
 *
 * Every tool resolves its path through {@link resolveSafe}, so the model can
 * never touch the host filesystem outside `SANDBOX_ROOT`. `write_file` is the
 * one side-effecting tool: on success it publishes `artifact.created` (for the
 * Artifact Tracker) via the bus handed to it in the execution context — the
 * publish is fire-and-forget and only happens when a bus *and* an agent-run id
 * are present, so the tools stay usable in isolation and in unit tests.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import { brand, EventType } from '@harness/domain';
import type { ArtifactCreatedPayload } from '@harness/domain';
import { createEvent } from '@harness/event-bus';

import { resolveSafe } from './resolve-safe.js';
import type { Tool } from './tool-registry.js';

/** SHA-256 of `content`, hex-encoded (dedup + integrity identity). */
function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function makeReadFileTool(sandboxRoot: string): Tool {
  return {
    name: 'read_file',
    description: 'Read the contents of a file relative to the sandbox root.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    async execute(input) {
      const safe = resolveSafe(sandboxRoot, String(input.path));
      return readFile(safe, 'utf8');
    },
  };
}

export function makeWriteFileTool(sandboxRoot: string): Tool {
  return {
    name: 'write_file',
    description:
      'Write content to a file relative to the sandbox root, creating parent directories as needed.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    async execute(input, ctx) {
      const relPath = String(input.path);
      const content = String(input.content ?? '');
      const safe = resolveSafe(sandboxRoot, relPath);
      await mkdir(dirname(safe), { recursive: true });
      await writeFile(safe, content, 'utf8');

      if (ctx.bus && ctx.agentRunId) {
        const payload: ArtifactCreatedPayload = {
          agent_run_id: ctx.agentRunId,
          file_path: relPath,
          content_hash: sha256(content),
          size_bytes: Buffer.byteLength(content, 'utf8'),
        };
        ctx.bus.publish(
          createEvent(EventType.ArtifactCreated, brand(ctx.agentRunId, 'CorrelationID'), payload),
        );
      }

      return `wrote ${relPath} (${Buffer.byteLength(content, 'utf8')} bytes)`;
    },
  };
}

export function makeListDirectoryTool(sandboxRoot: string): Tool {
  return {
    name: 'list_directory',
    description:
      'List files (not directories) under a directory relative to the sandbox root. Paths are returned relative to the sandbox root.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
    },
    async execute(input) {
      const dirArg = input.path !== undefined ? String(input.path) : '.';
      const safeDir = resolveSafe(sandboxRoot, dirArg);
      const relDir = relative(resolve(sandboxRoot), safeDir);
      const entries = await readdir(safeDir, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) => (relDir ? join(relDir, entry.name) : entry.name));
      return files.join('\n');
    },
  };
}
