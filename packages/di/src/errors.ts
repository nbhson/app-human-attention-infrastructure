/** Error thrown by the DI container when a token has no registration. */

export class ContainerError extends Error {
  /** The token that could not be resolved. */
  readonly token: string;

  constructor(token: string) {
    super(`[di] no registration found for token "${token}"`);
    this.name = 'ContainerError';
    this.token = token;
  }
}
