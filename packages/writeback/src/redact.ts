/**
 * Error redaction for the write-back audit log (day-08 §2.3, §6).
 *
 * The `error` column of `writeback_log` is append-only and consumer-visible, so
 * it must never carry a secret. A caught tool-error can embed an `Authorization`
 * header, a bearer token, a `ghp_`/`xox*` personal token, or an arbitrary
 * `token=`/`api_key=` field. `redactSensitive` scrubs the common shapes and any
 * caller-supplied secret values by their literal bytes.
 */

const MASK = '[redacted]';

/**
 * Scrub common secret-bearing patterns and any explicit secret strings from a
 * message. The patterns are deliberately conservative — they match *shapes*
 * rather than exact provider tokens, so a novel token still gets masked by the
 * `secrets` list (which the service fills from the process env it read the real
 * credentials from).
 */
export function redactSensitive(message: string, secrets: readonly string[] = []): string {
  let out = message;
  for (const secret of secrets) {
    if (secret.length > 0) {
      // Split on the literal secret, so it never survives even when embedded in
      // a larger string (e.g. inside a thrown header echo).
      out = out.split(secret).join(MASK);
    }
  }
  return out
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=\-\s]+/gi, `Bearer ${MASK}`)
    .replace(/\bBasic\s+[A-Za-z0-9+/=\s]+/gi, `Basic ${MASK}`)
    .replace(/Authorization\s*:\s*[^\r\n]+/gi, `Authorization: ${MASK}`)
    .replace(/\b(token|api[_-]?key|secret|password|passwd)\s*[:=]\s*[^\s,;]+/gi, `$1=${MASK}`)
    .replace(/\bgh[pousr]_[A-Za-z0-9]{10,}\b/g, MASK)
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, MASK)
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, MASK);
}

/** The env values that could be live credentials (for the `secrets` scrub list). */
export function credentialEnvValues(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value && value.length > 4 && /token|key|secret|password|credential/i.test(key)) {
      out.push(value);
    }
  }
  return out;
}
