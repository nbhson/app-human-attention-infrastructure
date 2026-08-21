/**
 * A tiny greeting helper with a deliberate bug (day-25 E2E fixture).
 *
 * `toLowercase` is not a function, so both the failing test and the compile check
 * catch this file. The happy-path agent rewrites it to `toLowerCase` (`src/…`
 * target from the task description) and the verification checks turn green.
 */
export function greeting(name: string): string {
  return `Hello, ${name.toLowercase()}!`;
}
