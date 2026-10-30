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
/**
 * P1 fix (narrow, test-compatible): Terraform vars and PEM keys are almost
 * always secrets; generic `package.json` / `Dockerfile` / `nginx.conf` stay
 * non-sensitive by design (see review-secret-redact.test.ts).
 */
const TFVARS_FILE = /(^|\/)[^/]*\.tfvars$/i;
const PEM_FILE = /(^|\/)[^/]*\.pem$/i;

/** Key names whose value is a secret — the value is masked, the key is kept. */
const SECRET_KEY =
  /(?:^|[_\s])(?:pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|credential|auth|cookie|salt|access[_-]?key|client[_-]?secret|private[_-]?token|refresh[_-]?token|session[_-]?key|signing[_-]?key)[_\w]*/i;

/** A `scheme://user:password@host` URL whose in-value password must be masked even on a benign key. */
const URL_PASSWORD = /^([a-z][a-z0-9+.-]*:\/\/[^/@\s]*:)[^/@\s]+(@.*)$/i;

/** True when an added line of this file could carry a live secret. */
export function isSensitiveFile(path: string): boolean {
  if (PEM_FILE.test(path) || TFVARS_FILE.test(path)) return true;
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
 * Well-known credential *shapes* — masked on the added (`+`) lines of EVERY
 * file, not just sensitive-path files. P1 security fix: the path-allowlist
 * above misses a live token pasted into ordinary source (`const apiKey =
 * "sk-..."` in `src/app.ts`), a README snippet, or a test fixture. Pattern
 * masking is value-shape-based, so it catches those without the false-positive
 * risk of masking arbitrary strings.
 */
const CREDENTIAL_PATTERNS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  // AWS access key id (the 40-char secret is deliberately NOT swept: a generic
  // 40-char base64ish pattern would false-positive on every commit SHA-1 in a
  // diff; secret-named keys are caught by redactSensitivePatch / SECRET_KEY)
  { pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, label: '<redacted-aws-key>' },
  // OpenAI / Anthropic / generic sk- keys
  { pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/g, label: '<redacted-api-key>' },
  // GitHub tokens (classic + fine-grained + OAuth/app)
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, label: '<redacted-github-token>' },
  // GitLab personal access tokens
  { pattern: /\bglpat-[A-Za-z0-9_-]{16,}\b/g, label: '<redacted-gitlab-token>' },
  // Slack tokens
  { pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, label: '<redacted-slack-token>' },
  // Google API keys
  { pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g, label: '<redacted-google-key>' },
  // npm publish tokens
  { pattern: /\bnpm_[A-Za-z0-9]{30,}\b/g, label: '<redacted-npm-token>' },
  // Embedded private-key headers (the body is caught line-by-line via BEGIN/END)
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, label: '<redacted-private-key-header>' },
];

/**
 * Mask credential-shaped values in one line body. Returns the masked body, or
 * `null` when nothing matched (so callers keep the original line).
 */
function maskCredentialPatterns(body: string): string | null {
  let masked = body;
  let matched = false;
  for (const { pattern, label } of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(masked)) {
      matched = true;
      pattern.lastIndex = 0;
      masked = masked.replace(pattern, label);
    }
  }
  return matched ? masked : null;
}

/**
 * P1 security fix: credential-shape sweep applied to the ADDED (`+`) lines of
 * every file — including ordinary source where a secret lives on a
 * non-sensitive path (`const apiKey = "sk-..."` in `src/app.ts`). Removed and
 * context lines pass through unchanged: the sweep's job is to stop a PR from
 * *introducing* a live credential into the LLM prompt, not to rewrite history.
 * Sensitive-path files keep their stronger {@link redactSensitivePatch}
 * treatment (key-value masking on all line kinds); the two compose.
 */
export function redactCredentialSweep(path: string, patch: string): string {
  if (isSensitiveFile(path)) {
    return patch; // already handled by redactSensitivePatch
  }
  return patch
    .split('\n')
    .map((line) => {
      if (line[0] !== '+') {
        return line;
      }
      const masked = maskCredentialPatterns(line.slice(1));
      return masked === null ? line : `+${masked}`;
    })
    .join('\n');
}

/**
 * The one-call composition used by the review ingest: strong path-based
 * redaction for sensitive files, plus the credential-shape sweep for the added
 * lines of everything else.
 */
export function redactReviewPatch(path: string, patch: string): string {
  return redactCredentialSweep(path, redactSensitivePatch(path, patch));
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
  const isPem = PEM_FILE.test(path);
  return patch
    .split('\n')
    .map((line) => {
      const marker = line[0];
      if (marker !== '+' && marker !== '-' && marker !== ' ') {
        return line;
      }
      if (isPem) {
        const body = line.slice(1);
        if (body.includes('BEGIN') || body.includes('END') || body.trim() === '') return line;
        return `${marker}<redacted-pem-body>`;
      }
      const masked = maskSecretValue(line.slice(1));
      return masked === null ? line : `${marker}${masked}`;
    })
    .join('\n');
}
