import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventType, newAgentRunID } from '@harness/domain';
import type { EventEnvelope } from '@harness/domain';
import type { EventHandler, IEventBus, UnsubscribeFn } from '@harness/event-bus';

import { makeListDirectoryTool, makeReadFileTool, makeWriteFileTool } from '../tools/file-tools.js';
import type { ToolExecutionContext } from '../tools/tool-registry.js';

/** A bus that records every published envelope, for spy assertions. */
class RecordingBus implements IEventBus {
  readonly published: EventEnvelope[] = [];

  publish<T>(event: EventEnvelope<T>): void {
    this.published.push(event);
  }

  subscribe<T>(_eventType: EventType, _handler: EventHandler<T>): UnsubscribeFn {
    void _eventType;
    void _handler;
    return () => {};
  }
}

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'hai-tools-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const noContext: ToolExecutionContext = {};

describe('sandbox file tools', () => {
  it('write_file creates a file with the correct content and emits artifact.created', async () => {
    const bus = new RecordingBus();
    const agentRunId = newAgentRunID();
    const write = makeWriteFileTool(root);

    const output = await write.execute({ path: 'a.txt', content: 'hello' }, { agentRunId, bus });

    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('hello');
    expect(output).toContain('a.txt');
    expect(bus.published).toHaveLength(1);
    expect(bus.published[0]?.event_type).toBe(EventType.ArtifactCreated);
  });

  it('read_file returns the written content', async () => {
    const write = makeWriteFileTool(root);
    await write.execute({ path: 'b.txt', content: 'world' }, noContext);

    const read = makeReadFileTool(root);
    await expect(read.execute({ path: 'b.txt' }, noContext)).resolves.toBe('world');
  });

  it('write_file creates nested parent directories', async () => {
    const write = makeWriteFileTool(root);
    await write.execute({ path: 'nested/deep/file.txt', content: 'x' }, noContext);

    expect(await readFile(join(root, 'nested', 'deep', 'file.txt'), 'utf8')).toBe('x');
  });

  it('list_directory lists files (not directories) relative to the sandbox root', async () => {
    const write = makeWriteFileTool(root);
    await write.execute({ path: 'listing/f1.txt', content: '1' }, noContext);
    await write.execute({ path: 'listing/f2.txt', content: '2' }, noContext);
    await write.execute({ path: 'listing/sub/f3.txt', content: '3' }, noContext);

    const list = makeListDirectoryTool(root);
    const listingFiles = (await list.execute({ path: 'listing' }, noContext)).split('\n').sort();
    expect(listingFiles).toEqual(['listing/f1.txt', 'listing/f2.txt']);

    const subFiles = (await list.execute({ path: 'listing/sub' }, noContext)).split('\n');
    expect(subFiles).toEqual(['listing/sub/f3.txt']);
  });
});
