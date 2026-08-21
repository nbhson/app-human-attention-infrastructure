/**
 * Small env + output helpers shared by the engine and its checks.
 */

/** Read an integer env var, falling back to `fallback`. */
export function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.length === 0) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Secret-bearing env keys that must never reach a spawned check process. */
const SECRET_KEY_PATTERN = /(secret|token|password|api[_-]?key|credential)/i;

/** Explicitly blocked keys that the pattern alone does not catch. */
const BLOCKED_KEYS = new Set(['DATABASE_URL', 'DATABASE_URL_UNPOOLED']);

/** Keys the child process needs to find `pnpm`/`tsc` regardless of the pattern. */
const PRESERVE_KEYS = new Set(['PATH', 'HOME', 'PWD', 'NODE_ENV', 'npm_config_user_agent']);

/**
 * Return a copy of `env` with secrets removed (§2.3). A check's child process
 * must never see `ANTHROPIC_API_KEY`, `DATABASE_URL`, or any other credential.
 */
export function sanitizedEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }
    if (BLOCKED_KEYS.has(key)) {
      continue;
    }
    if (!PRESERVE_KEYS.has(key) && SECRET_KEY_PATTERN.test(key)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Mark a string that had its tail cut off at `cap` bytes. */
export function truncateOutput(output: string, cap = 64 * 1024): string {
  if (output.length <= cap) {
    return output;
  }
  const marker = '\n...[truncated]';
  return output.slice(0, cap - marker.length) + marker;
}
