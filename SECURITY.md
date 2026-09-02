# Security Policy

The harness handles provider tokens (Git / Jira / AI), human review decisions, and
third-party pull-request content. A report of a security problem in _that handling_
is taken seriously, and we fix the latest release rather than every old tag.

## Reporting a vulnerability

**Do not open a public issue** for a security problem. Report it privately so the
fix lands before the detail is public:

- **Preferred — GitHub private reporting.** Use the repo's _Report a vulnerability_
  flow (Security → Advisories → _New draft security advisory_). The report stays
  private until we publish an advisory.
- **No public channel** (issue, discussion, PR comment) — treat "disclose the bug"
  as "release the exploit".

We aim to **acknowledge within 3 business days** and to keep you in the loop through
triage → fix → advisory. You're credited in the advisory (or kept anonymous — your
call).

## Supported versions

Security fixes are applied to the **latest tagged release** (`v0.4.0-harness` at
time of writing). Older tags are **not** back-ported; upgrade first, then re-test.

## What we want to hear about

Anything that could:

- leak or exfiltrate a provider token, an AI `/chat/completions` key, or an
  embedding / object-store credential;
- escape the **review-only invariant** (turn the reviewer into a code author) or
  escape the **sandbox** that runs untrusted verification code;
- fire an external **write-back** without the full toggle chain being armed, or
  bypass the `writeback_log` audit;
- corrupt the append-only `event_log` / audit trail, or spoof provenance
  (`correlation_id`, review/judge `report_hash`, run ids);
- let an untrusted PR's diff, test output, or prompt reach a machine _outside_ the
  sandbox, or inject an instruction that changes a decision.

## Out of scope

- Missing features / "it would be nice if" — open a regular issue.
- Vulnerabilities in a dependency's _unused_ code path — report upstream.
- Vulnerabilities in a third-party Git / Jira / AI provider outside our code.

## The security model we ship (so you can verify the claim)

Before reporting, it's worth knowing what's already in place:

- **No live keys in the repo.** `.env.example` carries placeholders only; `.env` is
  gitignored; the real Anthropic/OpenAI path is compile-tested, never exercised
  in-repo. CI uses throwaway credentials against an ephemeral Postgres.
- **Token redaction.** Provider tokens are never logged; the settings UI surfaces
  only the last-4 hint.
- **Sandboxed untrusted execution.** Verification (clone → build/test) runs in the
  Docker sandbox (`@harness/sandbox`); untrusted PR content never runs inside the
  API process itself.
- **Fail-safe write-back.** An external write fires only when all three layers are
  armed — global ceiling + per-provider flag + the human's `writeback: true` on the
  decision. OFF is the default; every write lands in `writeback_log`.
- **Append-only audit.** Every state change, LLM call, and decision is in the
  append-only `event_log`, joined by one `correlation_id`.

## Process

1. Private report (above).
2. Acknowledge within 3 business days.
3. Reproduce on `main`; confirm the affected route / code path.
4. Fix behind a normal PR on `main`, with a regression test.
5. Publish a GitHub Security Advisory + credit; tag the fixed release.

---

This policy covers this repository and the `@harness/*` packages published from it.
