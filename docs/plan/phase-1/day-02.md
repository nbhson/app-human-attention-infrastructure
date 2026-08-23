# Day 02 — @harness/domain — core types, branded IDs, review-report types

| | |
|---|---|
| **Week** | W1 — Foundation |
| **Spec refs** | Spec 1 §4 (layers), Spec 3 §1 (Review Agent), Spec 2 §2 (Task) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 01 workspace (packages skeletal) |

---

## 1. Objectives

- Define the shared vocabulary every other package compiles against: branded IDs, `Task`, `TaskStatus`, `HumanDecisionType`, and the review-report value objects.
- Introduce **branded IDs** (`TaskID`, `ReviewReportID`, `ReviewFindingID`, `FixSuggestionID`, …) so identifiers can't be accidentally mixed across entities.
- Land the review-first domain types: `ReviewReport`, `ReviewFinding`, `FixSuggestion`, plus the `ReviewSeverity` and `ReviewVerdict` enums.
- Ship factories (`createTask`, `createReviewReport`, `createReviewFinding`, `createFixSuggestion`) with sane defaults, and unit tests for defaults + ID uniqueness.

## 2. Design Decisions

- Every ID is a branded string (e.g. `type TaskID = string & { readonly __task: unique symbol }`) built with UUIDv7 — sortable, collision-safe, and opaque at the type level.
- The AI review is the pivot output, so its types are defined **first** and read-only: the AI produces *findings* and *suggestions*; the system assigns identity and `createdAt` when persisting.

```ts
export const ReviewSeverity = { Critical: 'CRITICAL', Major: 'MAJOR', Minor: 'MINOR', Nit: 'NIT', Info: 'INFO' } as const;
export const ReviewVerdict = { Approve: 'APPROVE', RequestChanges: 'REQUEST_CHANGES', Comment: 'COMMENT' } as const;

export interface ReviewFinding {
  readonly id: ReviewFindingID;
  readonly severity: ReviewSeverity;
  readonly file: string;        // repo-relative
  readonly line?: number;       // 1-based
  readonly message: string;
  readonly suggestion?: string; // pointer, never code
}
export interface FixSuggestion {
  readonly id: FixSuggestionID;
  readonly file: string;
  readonly hunk?: string;       // @@ -.. +.. @@ context
  readonly proposed: string;    // proposed replacement
  readonly rationale: string;
  readonly orderIndex: number;
}
export interface ReviewReport {
  readonly id: ReviewReportID;
  readonly prUrl: string;
  readonly prTitle: string;
  readonly aiProvider: AiProviderType;
  readonly model: string;
  readonly summary: string;
  readonly overallVerdict: ReviewVerdict;
  readonly findings: ReviewFinding[];
  readonly suggestions: FixSuggestion[];
  readonly createdAt: Date;
}
```

- `HumanDecisionType` stays a **closed set** (7 values, incl. `AUTO_APPROVED`). `TaskStatus` mirrors the 13 state-machine values (enforced in code on Day 06), keeping a single source of truth.

## 3. Tasks

### 3.1 IDs + primitives (90 min)
- [ ] `ids.ts` — branded ID helpers + `new*ID()` factories (UUIDv7)
- [ ] `result.ts` — result/error types shared across packages

### 3.2 Review-report types (120 min)
- [ ] `review-report.ts` — `ReviewSeverity`, `ReviewVerdict`, `ReviewFinding`, `FixSuggestion`, `ReviewReport` + factories
- [ ] `review.ts` — `HumanDecisionType`, `createHumanDecision`

### 3.3 Task + integration types (90 min)
- [ ] `task.ts` — `TaskStatus` (13 values), `Priority`, `Task`, `createTask`
- [ ] `integration.ts` — `GitProviderType` (GitHub now), `AiProviderType`, `TicketProviderType` (Jira now)

### 3.4 Tests (60 min)
- [ ] `*.test.ts` covering factory defaults, ID uniqueness, and the closed enums

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/domain/src/ids.ts` | Branded ID vocabulary + UUIDv7 factories |
| `packages/domain/src/review-report.ts` | Review report/finding/suggestion types |
| `packages/domain/src/review.ts` | Human decision types |
| `packages/domain/src/task.ts` | Task + `TaskStatus` (13-state mirror) |
| `packages/domain/src/integration.ts` | Provider type enums (GitHub/Jira now) |
| `packages/domain/src/index.ts` | Barrel export |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/domain test` passes
- [ ] `pnpm --filter @harness/domain build` emits types with no `any`
- [ ] `Object.values(TaskStatus)` has exactly 13 values; `ReviewVerdict` and `ReviewSeverity` are exhaustive

## 6. Notes & Pitfalls

- Keep `ReviewFinding.suggestion` a descriptive pointer, not a code patch — that copyable patch lives in `FixSuggestion.proposed` so the UI can render "what I found" next to "what I'd change".
- GitLab/Bitbucket provider enums are **not** added here (Phase 3); only the `GitHub`/`Jira` values exist today.

---

*Next: [Day 03 — Event model + IEventBus](day-03.md)*