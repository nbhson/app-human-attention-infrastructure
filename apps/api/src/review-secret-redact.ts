/**
 * Secret redaction for the review diff.
 *
 * `buildDiff` now hands the AI every hand-written file in a PR, which includes
 * `.env` and Docker Compose files. Those can carry real secrets, and the review
 * prompt leaves the machine for an external LLM provider — so a live credential
 * must never enter the prompt in the first place. This module masks secret
 * *values* on the added (`+`) lines of sensitive files while keeping the key
 * name and the fact that a value changed, so the reviewer can still see that
 * `API_KEY` was turned on without reading the key itself.
 */

/** Paths whose added lines can carry live credentials and are redacted. */
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/;
const COMPOSE_FILE = /(^|\/)(docker-)?compose[^/]*\.ya?ml$/i;

/** Key names whose value is a secret — the value is masked, the key is kept. */
const SECRET_KEY =
  /(pass(word)?|secret|token|api[_-]?key|private[_-]?key|credential|auth|cookie|salt|access[_-]?key)/i;

/** A `scheme://user:password@host` URL whose in-value password must be masked even on a benign key. */
const URL_PASSWORD = /^([a-z][a-z0-9+.-]*:\/\/[^/@\s]*:)[^/@\s]+(@.*)$/i;

/** True when an added line of this file could carry a live secret. */
export function isSensitiveFile(path: string): boolean {
  return ENV_FILE.test(path) || COMPOSE_FILE.test(path);
}

/**
 * Rewrite a line body so a secret-looking value is masked. Returns the masked
 * body (without the diff marker), or `null` when the line holds no secret to
 * mask. Two flavours are caught: a secret-named key (`API_KEY=…`,
 * `password: …`), and a URL with an embedded password
 * (`DATABASE_URL=postgres://user:pass@host/db`). Handles env (`KEY=value`,
 * `export KEY=value`, `- KEY=value`) and YAML map (`password: hunter2`) shapes.
 */
function maskSecretValue(body: string): string | null {
  const env = body.match(/^(\s*(?:-\s+)?(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (env) {
    const prefix = env[1]!;
    const key = env[2]!;
    const value = env[3]!;
    if (SECRET_KEY.test(key)) {
      return `${prefix}${key}=<redacted>`;
    }
    const url = value.match(URL_PASSWORD);
    if (url) {
      return `${prefix}${key}=${url[1]}<redacted>${url[2]}`;
    }
    return null;
  }
  const yaml = body.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
  if (yaml) {
    const prefix = yaml[1]!;
    const key = yaml[2]!;
    const value = yaml[3]!;
    if (SECRET_KEY.test(key)) {
      return `${prefix}${key}: <redacted>`;
    }
    const url = value.match(URL_PASSWORD);
    if (url) {
      return `${prefix}${key}: ${url[1]}<redacted>${url[2]}`;
    }
    return null;
  }
  return null;
}

/**
 * Mask secret values on the lines of a sensitive file's patch. Added, removed
 * and context lines are all redacted — a live credential is a secret whether the
 * PR introduces, deletes, or merely shows it as unchanged context. Only line
 * markers ` `  / `+` / `-` are rewritten; `@@` hunk headers and `+++` / `---`
 * file headers pass through, as does every line of a non-sensitive file.
 */
export function redactSensitivePatch(path: string, patch: string): string {
  if (!isSensitiveFile(path)) {
    return patch;
  }
  return patch
    .split('\n')
    .map((line) => {
      const marker = line[0];
      if (marker !== '+' && marker !== '-' && marker !== ' ') {
        return line;
      }
      const masked = maskSecretValue(line.slice(1));
      return masked === null ? line : `${marker}${masked}`;
    })
    .join('\n');
}
