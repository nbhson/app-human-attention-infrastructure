/**
 * The one error type the whole MCP layer raises to callers. Any failure —
 * transport connect, protocol violation, malformed server payload, timeout,
 * server exit mid-call — surfaces as an {@link McpClientError}, never as a raw
 * child-process error or a half-parsed blob. Callers match on this one name.
 */
export class McpClientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'McpClientError';
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
