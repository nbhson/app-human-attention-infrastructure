/**
 * The transport seam the MCP client speaks over.
 *
 * MCP is transport-agnostic; two transports ship here:
 * - {@link StdioTransport} — spawn a server subprocess, speak newline-delimited
 *   JSON-RPC over stdin/stdout, capture stderr.
 * - {@link SseTransport} — open an SSE stream, read the `endpoint` event, POST
 *   JSON-RPC messages to that endpoint (the "HTTP with SSE" spec shape).
 *
 * Neither transport caches or logs credentials (Day 01 §6: tokens never enter
 * the client — they are env vars for the *server subprocess*, or request headers
 * the caller injects for SSE).
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { get as httpGet, request as httpRequest } from 'node:http';
import { get as httpsGet, request as httpsRequest } from 'node:https';
import type { ClientRequest } from 'node:http';

import { McpClientError } from './errors.js';

/** The minimal transport all MCP traffic flows through. */
export interface McpTransport {
  /** Connect / spawn / open the stream. */
  start(): Promise<void>;
  /** Deliver one JSON-RPC message (request). */
  send(message: unknown): Promise<void>;
  /** Register a handler for inbound (server → client) messages. */
  onMessage(handler: (m: unknown) => void): void;
  /** Register a handler for an unexpected (or requested) close. */
  onClose(handler: (err?: Error) => void): void;
  /** Tear down the connection / subprocess. Idempotent. */
  stop(): Promise<void>;
}

// --- stdio ----------------------------------------------------------------

export interface StdioTransportOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Record<string, string | undefined>;
  readonly cwd?: string;
}

/**
 * Spawn the MCP server as a subprocess and speak JSON-lines: one JSON-RPC
 * message per line on stdin, one on stdout. stderr is captured (so a server
 * crash surfaces as a diagnosable error, not a silent hang) and the last lines
 * are attached to the close error.
 */
export class StdioTransport implements McpTransport {
  private child?: ChildProcess;
  private messageHandler?: (m: unknown) => void;
  private closeHandler?: (err?: Error) => void;
  private stdoutBuffer = '';
  private stderrTail: string[] = [];
  private started = false;
  private stopped = false;

  constructor(private readonly options: StdioTransportOptions) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    const child = spawn(this.options.command, this.options.args ?? [], {
      env: { ...process.env, ...this.options.env },
      cwd: this.options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.consumeStdout(chunk));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => this.captureStderr(chunk));
    child.on('error', (err) => this.handleClose(err));
    child.on('close', (code) => {
      if (this.stopped) {
        return;
      }
      const tail = this.stderrTail.length > 0 ? ` (stderr: ${this.stderrTail.join('')})` : '';
      this.handleClose(new McpClientError(`server exited (code ${code ?? 'unknown'})${tail}`));
    });
  }

  async send(message: unknown): Promise<void> {
    const child = this.child;
    if (!child || !child.stdin || child.stdin.destroyed || this.stopped) {
      throw new McpClientError('transport not started or already closed');
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  onMessage(handler: (m: unknown) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (err?: Error) => void): void {
    this.closeHandler = handler;
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    const child = this.child;
    if (child && !child.killed) {
      child.kill();
    }
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let nl = this.stdoutBuffer.indexOf('\n');
    while (nl >= 0) {
      const line = this.stdoutBuffer.slice(0, nl).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      if (line.length > 0) {
        this.emitLine(line);
      }
      nl = this.stdoutBuffer.indexOf('\n');
    }
  }

  private emitLine(line: string): void {
    if (!this.messageHandler) {
      return;
    }
    try {
      this.messageHandler(JSON.parse(line));
    } catch {
      // A non-JSON line is dropped (a warning, not a crash). The caller is
      // protected by the per-request timeout — a server that only emits garbage
      // yields a typed `McpClientError('timed out')`, never a hang.
    }
  }

  private captureStderr(chunk: string): void {
    this.stderrTail.push(chunk);
    if (this.stderrTail.length > 20) {
      this.stderrTail.shift();
    }
  }

  private handleClose(err?: Error): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.closeHandler?.(err);
  }
}

// --- SSE / HTTP -----------------------------------------------------------

export interface SseTransportOptions {
  readonly url: string;
  readonly headers?: Record<string, string>;
}

/**
 * The "HTTP with SSE" transport: open an SSE stream to {@link SseTransportOptions.url},
 * read the single `endpoint` event (the relative path to POST messages to), then
 * deliver each JSON-RPC message as a POST. Responses may arrive either as the
 * POST's own HTTP body (the common synchronous shape) or as `message` events on
 * the SSE stream (the 202-accepted shape) — both are routed to the message
 * handler.
 */
export class SseTransport implements McpTransport {
  private messageHandler?: (m: unknown) => void;
  private closeHandler?: (err?: Error) => void;
  private streamRequest?: ClientRequest;
  private endpoint?: string;
  private endpointResolve?: (endpoint: string) => void;
  private endpointPromise?: Promise<string>;
  private buffer = '';
  private started = false;
  private stopped = false;

  constructor(private readonly options: SseTransportOptions) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    await new Promise<void>((resolve, reject) => {
      const get = this.options.url.startsWith('https:') ? httpsGet : httpGet;
      const req = get(
        this.options.url,
        { headers: { accept: 'text/event-stream', ...this.options.headers } },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status !== 200) {
            res.resume();
            reject(new McpClientError(`SSE connect failed: HTTP ${status}`));
            return;
          }
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => this.feedSse(chunk));
          res.on('error', (err) => this.handleClose(err));
          res.on('end', () => this.handleClose(new McpClientError('SSE stream ended')));
          resolve();
        },
      );
      this.streamRequest = req;
      req.on('error', (err) => reject(err));
    });
  }

  async send(message: unknown): Promise<void> {
    const endpoint = await this.endpointReady();
    const url = new URL(endpoint, this.options.url).toString();
    await this.post(url, message);
  }

  onMessage(handler: (m: unknown) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (err?: Error) => void): void {
    this.closeHandler = handler;
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.streamRequest?.destroy();
  }

  private endpointReady(): Promise<string> {
    if (this.endpoint) {
      return Promise.resolve(this.endpoint);
    }
    if (!this.endpointPromise) {
      this.endpointPromise = new Promise<string>((resolve) => {
        this.endpointResolve = resolve;
      });
    }
    return this.endpointPromise;
  }

  private feedSse(chunk: string): void {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    let idx = this.buffer.indexOf('\n\n');
    while (idx >= 0) {
      const frame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      this.dispatchFrame(frame);
      idx = this.buffer.indexOf('\n\n');
    }
  }

  private dispatchFrame(frame: string): void {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (dataLines.length === 0) {
      return;
    }
    const data = dataLines.join('\n');
    if (event === 'endpoint') {
      this.endpoint = data;
      this.endpointResolve?.(data);
      return;
    }
    if (data.trim().length === 0) {
      return;
    }
    try {
      this.messageHandler?.(JSON.parse(data));
    } catch {
      // malformed server frame — drop, same posture as stdio.
    }
  }

  private post(urlStr: string, body: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = new URL(urlStr);
      const mod = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = mod(
        url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...this.options.headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const contentType = res.headers['content-type'] ?? '';
            const text = Buffer.concat(chunks).toString('utf8').trim();
            if (contentType.includes('text/event-stream')) {
              this.feedSse(text);
            } else if (text.length > 0) {
              try {
                this.messageHandler?.(JSON.parse(text));
              } catch {
                // non-JSON body — ignore.
              }
            }
            resolve();
          });
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  }

  private handleClose(err?: Error): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.closeHandler?.(err);
  }
}
