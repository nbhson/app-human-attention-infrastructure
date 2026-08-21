# @harness/verification-engine — Verification Engine

## Hiểu nhanh

**Nhiệm vụ:** "người kiểm tra độc lập" — chạy compile/test/lint để kiểm chứng lời AI nói là đúng hay sai (Claim ≠ Evidence).

Nói nôm na: AI bảo "xong rồi" thì chưa tính; gói này chạy test & build thật để xác nhận. Mọi claim của AI phải có evidence từ đây.

---

## Trạng thái hiện tại

**Day 15 hoàn thành:**

- `src/types.ts` — `CheckKind`, `CheckStatus`, `CheckResult`, `CheckContext`, `VerificationCheck`, `VerificationReport`.
- `src/checks/compile-check.ts` — `CompileCheck` chạy `tsc --noEmit -p <worktree>` in-process, under `sanitizedEnv`, cap 64 KB output.
- `src/verification-engine.ts` — `verify(changeId)`: full/parallel strategy, hai mức timeout (per-check + request), persist `verification_reports` + `verification_check_results`, publish `verification.completed`.
- `src/timeout.ts` — `withTimeout`, `CheckTimeoutError`, `RequestTimeoutError`.
- `src/env.ts` — `sanitizedEnv`, `readInt`, `truncateOutput`.

**Còn lại:** Day 16 (`TestCheck` + flaky), Day 17 (evidence storage), Day 22+ (human review hand-off).

---

## Mục đích

Independent validator — chạy compile, test, lint độc lập với AI agent. Đảm bảo "Claim ≠ Evidence": mọi claim của AI phải có evidence từ verification.

---

## Công việc cần làm

### Day 15 — Check abstraction + CompileCheck

```typescript
// src/types.ts
export const CheckKind = { COMPILE: 'COMPILE', TEST: 'TEST', LINT: 'LINT' } as const;
export type CheckKind = typeof CheckKind[keyof typeof CheckKind];

export const CheckStatus = {
  PASSED: 'PASSED', FAILED: 'FAILED', FLAKY: 'FLAKY', TIMED_OUT: 'TIMED_OUT', SKIPPED: 'SKIPPED'
} as const;
export type CheckStatus = typeof CheckStatus[keyof typeof CheckStatus];

export interface VerificationCheck {
  readonly kind: CheckKind;
  readonly timeoutMs: number;  // per-check timeout (level 1)
  run(ctx: CheckContext): Promise<CheckResult>;
}

export interface CheckContext {
  changeId: string;
  worktreePath: string;        // agent's dedicated branch/worktree
  sandboxRoot: string;
}

export interface CheckResult {
  checkKind: CheckKind;
  status: CheckStatus;
  durationMs: number;
  output: string;              // truncated stdout/stderr (cap 64KB)
  evidenceId?: string;
}
```

```typescript
// src/checks/compile-check.ts
export class CompileCheck implements VerificationCheck {
  readonly kind = CheckKind.COMPILE;
  readonly timeoutMs = 60_000;

  async run(ctx: CheckContext): Promise<CheckResult> {
    const { stdout, stderr, exitCode } = await exec(
      'npx tsc --noEmit',
      { cwd: ctx.worktreePath, timeout: this.timeoutMs, env: sanitizedEnv() }
    );
    return {
      checkKind: this.kind,
      status: exitCode === 0 ? CheckStatus.PASSED : CheckStatus.FAILED,
      durationMs: /* measure */,
      output: truncate(stdout + stderr, 64 * 1024),
    };
  }
}
```

### Day 15 — Engine entry point

```typescript
// src/verification-engine.ts
export class VerificationEngine {
  private checks: VerificationCheck[] = [new CompileCheck()]; // Phase 1
  private readonly requestTimeoutMs = 120_000; // level 2

  async verify(changeId: string): Promise<VerificationReport> {
    const ctx = await this.buildContext(changeId);
    const started = Date.now();

    const results = await withTimeout(
      Promise.all(this.checks.map(c => this.runCheck(c, ctx))),
      this.requestTimeoutMs
    ).catch(err => this.timeoutReport(changeId, err));

    const report = buildReport(changeId, results, Date.now() - started);
    await this.persist(report);
    this.bus.publish({ type: 'verification.completed', payload: { changeId, taskId: report.taskId, result: report.overall } });
    return report;
  }
}
```

### Day 16 — TestCheck + Flaky handler

```typescript
// src/checks/test-check.ts
export class TestCheck implements VerificationCheck {
  async run(ctx: CheckContext): Promise<CheckResult> {
    // Run vitest/jest, detect flaky tests
  }
}

// src/flaky-handler.ts
export async function handleFlaky(result: CheckResult, previousResult?: CheckResult): Promise<CheckResult> {
  // If previous was FAILED and this is PASSED → FLAKY
  if (previousResult?.status === CheckStatus.FAILED && result.status === CheckStatus.PASSED) {
    return { ...result, status: CheckStatus.FLAKY };
  }
  return result;
}
```

### Day 17 — Evidence storage

```typescript
// Persist verification results + link to artifacts
// Tables: verification_requests, verification_results, verification_check_results, evidence_links
```

---

## Dependency rule

```
packages/verification-engine → import @harness/domain, @harness/event-bus, @harness/db
                             → KHÔNG import các engine packages khác
```

---

## Key design

- **Two timeout levels**: per-check timeout (level 1) + request-level timeout (level 2, default 120s)
- **In-process execution Phase 1**: chạy trong worktree của agent, không dùng container
- **Environment sanitization**: `sanitizedEnv()` loại secrets trước khi spawn
- **Output capping**: 64KB per check
- **Overall PASSED ⟺ mọi check ∈ {PASSED, FLAKY}**
- **FAILED → task REWORK** qua event `verification.completed`

---

## Files cần tạo

```
src/
├── index.ts
├── types.ts                    # VerificationRequest, VerificationResult, CheckKind, CheckStatus
├── verification-engine.ts      # Main verify() entry point
├── checks/
│   ├── base-check.ts           # VerificationCheck interface
│   ├── compile-check.ts        # tsc --noEmit
│   └── test-check.ts           # vitest/jest
├── flaky-handler.ts            # Retry-once logic
├── timeout.ts                  # Two-level timeout wrapper
└── __tests__/
    ├── verification-engine.test.ts
    ├── compile-check.test.ts
    └── flaky-handler.test.ts
```
