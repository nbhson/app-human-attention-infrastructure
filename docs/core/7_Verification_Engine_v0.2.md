# Verification Engine
## Specification v0.2 – Independently Validating AI-Generated Changes

**Status:** Draft v0.2  
**Dependencies:** Architecture (`HAI_Harness_Architecture_v0.2.md`), Task Orchestrator (`Task_Work_Orchestrator_v0.2.md`)  
**Purpose:** Define how the Harness independently validates AI-generated outputs — running compilation, tests, static analysis, and security scans — ensuring that verification is separated from generation to prevent bias and false confidence.

---

# 1. Purpose

The Verification Engine is the **independent validator** of the system. It ensures that every AI-generated change passes objective quality gates before being assessed for human attention.

Its primary responsibilities:
1.  **Compilation Check:** Ensure the project still compiles/builds after the AI's changes.
2.  **Test Execution:** Run unit tests, integration tests, and other test suites.
3.  **Static Analysis:** Perform linting, type checking, and code quality analysis.
4.  **Security Scanning:** Detect common vulnerabilities, secrets, and unsafe patterns.
5.  **Test Coverage Analysis:** Measure which lines of code are covered by tests.
6.  **Result Aggregation:** Collect all verification results into a structured evidence package.

> **Core Principle:** Verification must be independent from generation. The AI that writes the code must not be the same system that verifies it. This separation ensures objective quality assessment.

---

# 2. Core Domain Objects

## 2.1 VerificationRequest

```text
VerificationRequest
├── id: VerificationRequestID
├── task_id: TaskID
├── change_id: ChangeID
├── created_at: timestamp
├── checks: List[VerificationCheck]
│   ├── VerificationCheck
│   │   ├── type: "COMPILE" | "TEST" | "LINT" | "TYPE_CHECK" | "SECURITY_SCAN" | "COVERAGE" | "CUSTOM"
│   │   ├── tool: string (e.g., "tsc", "jest", "eslint", "semgrep")
│   │   ├── enabled: boolean
│   │   └── config: Map[string, any]
│   └── ...
├── timeout_seconds: int
└── priority: "LOW" | "MEDIUM" | "HIGH"
```

## 2.2 VerificationResult

```text
VerificationResult
├── id: VerificationResultID
├── request_id: VerificationRequestID
├── task_id: TaskID
├── status: "RUNNING" | "PASSED" | "FAILED" | "ERROR" | "TIMEOUT" | "SKIPPED"
├── checks: List[VerificationCheckResult]
│   ├── VerificationCheckResult
│   │   ├── type: string
│   │   ├── tool: string
│   │   ├── status: "PASSED" | "FAILED" | "ERROR" | "SKIPPED"
│   │   ├── duration_ms: int
│   │   ├── output: string (stdout/stderr)
│   │   ├── errors: List[VerificationError]
│   │   │   ├── VerificationError
│   │   │   │   ├── file: string
│   │   │   │   ├── line: int
│   │   │   │   ├── column: int
│   │   │   │   ├── severity: "ERROR" | "WARNING" | "INFO"
│   │   │   │   ├── message: string
│   │   │   │   └── code: string (error code from tool)
│   │   │   └── ...
│   │   └── metrics: Map[string, any]
│   └── ...
├── summary: string
├── started_at: timestamp
├── completed_at: timestamp
├── total_duration_ms: int
└── evidence_ref: EvidenceID (link to stored evidence)
```

## 2.3 VerificationPolicy

```text
VerificationPolicy
├── id: PolicyID
├── project_id: ProjectID
├── required_checks: List[string] (checks that must pass for approval)
├── optional_checks: List[string] (checks that are advisory)
├── fail_fast: boolean (stop on first failure)
├── timeout_seconds: int
├── max_retries: int
├── coverage_threshold: float (minimum coverage percentage)
└── allowed_tools: List[string] (permitted verification tools)
```

---

# 3. Verification Pipeline

```text
Change arrives
      │
      ▼
┌──────────────────────────────────────────────────────────┐
│              1. VERIFICATION REQUEST CREATION             │
│                                                           │
│  - Create VerificationRequest with required checks       │
│  - Apply VerificationPolicy                              │
│  - Set timeout and priority                              │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│              2. CHECK EXECUTION (Parallel where possible)│
│                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │COMPILE   │  │ TEST     │  │ LINT     │  │SECURITY  │ │
│  │(tsc)     │  │(jest)    │  │(eslint)  │  │(semgrep) │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
│                                                           │
│  ┌──────────┐  ┌──────────┐                              │
│  │TYPE CHECK│  │COVERAGE  │                              │
│  │(tsc)     │  │(istanbul)│                              │
│  └──────────┘  └──────────┘                              │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│              3. RESULT AGGREGATION                        │
│                                                           │
│  - Collect all check results                             │
│  - Determine overall status (PASSED/FAILED)              │
│  - Generate structured summary                           │
│  - Link to evidence system                               │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│              4. RESULT DELIVERY                           │
│                                                           │
│  - Return result to Task Orchestrator                    │
│  - Emit VerificationCompleted event                      │
│  - Store in Evidence/Memory system                       │
└──────────────────────────────────────────────────────────┘
```

---

# 4. Verification Checks

## 4.1 Compilation Check

| Detail | Description |
|--------|-------------|
| Tool | TypeScript compiler (`tsc`), or language equivalent |
| Action | Compile the project with the AI's changes applied |
| Failure | Type errors, syntax errors, missing imports |
| Output | List of errors with file, line, column, and message |

## 4.2 Test Execution

| Detail | Description |
|--------|-------------|
| Tool | Jest, Mocha, or test framework equivalent |
| Action | Run all tests (or relevant subset) |
| Failure | Test failures, assertion errors, timeouts |
| Output | Test results summary (passed/failed/skipped counts) |

## 4.3 Static Analysis

| Detail | Description |
|--------|-------------|
| Tool | ESLint, Prettier, or language equivalent |
| Action | Run linting and formatting checks |
| Failure | Lint errors, formatting violations |
| Output | List of violations with severity, file, and message |

## 4.4 Security Scan

| Detail | Description |
|--------|-------------|
| Tool | Semgrep, CodeQL, or security scanner |
| Action | Scan for known vulnerability patterns |
| Failure | Security findings detected |
| Output | List of findings with severity, location, and description |

## 4.5 Coverage Analysis

| Detail | Description |
|--------|-------------|
| Tool | Istanbul, c8, or coverage tool |
| Action | Measure test coverage of changed lines |
| Failure | Coverage below threshold |
| Output | Coverage report with line-by-line details |

---

# 5. Verification Strategies

> **Phase availability:** Targeted (5.2) and Incremental (5.3) strategies require a code index / dependency graph and result caching infrastructure — both are **Phase 3**. Phase 1–2 use **Full (5.1)** or simple file-scoped verification only, plus Parallel (5.4) where checks are independent.

## 5.1 Full Verification
Run all checks on the entire project. Use for critical changes or when full confidence is needed.

## 5.2 Targeted Verification
Run checks only on changed files and their direct dependencies. Use for routine changes to reduce verification time. **(Phase 3 — requires dependency graph)**

## 5.3 Incremental Verification
Cache previous verification results and only re-run checks on files that changed. Use for rapid iteration. **(Phase 3 — requires code index + result cache)**

## 5.4 Parallel Verification
Run independent checks in parallel (e.g., lint + security scan + compile simultaneously). Use to minimize verification time.

---

# 5.5 Execution Environment

Verification must run against an **isolated, reproducible copy** of the code — never against the developer's live working directory:

- **Phase 1:** Run in-process against the agent's dedicated branch/worktree created by the Agent Runtime for its execution. Each agent run gets its own checkout, so concurrent verifications do not interfere.
- **Phase 2+:** Run in an isolated git worktree or container per verification request, with the Change's file set applied. This enables sandboxing of untrusted code execution and deterministic environments (locked tool versions).
- **Reference model (Phase 2+, from the reference skills framework):** the container/worktree isolation above is the same pattern as the framework's "Code Mode" vm sandbox and its **Minimal Benchmark Harness** (a container with only `bash` + a file-editor tool, so an untrusted run can do nothing outside its declared surface). Adoption rule: the sandbox exposes a *minimal, explicit* tool surface — verification runs a command and reads output, nothing more — which is what keeps a verification result attributable and tamper-evident.
- **Rule:** A verification result is only meaningful if the exact content verified is identified by content hash and recorded in the VerificationResult (link to Change via `change_id`).

> **Output cap & environment sanitization (as built, Day 29):**
> - Each check result's inline `output` (stdout/stderr) is truncated at **64 KB**
>   (`truncateOutput`, appends a `...[truncated]` marker) — `tsc` can dump megabytes
>   on a broken tree; the cap keeps evidence rows bounded.
> - Every spawned check process receives a **sanitized environment** (`sanitizedEnv`):
>   `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are always removed; any key matching
>   `/(secret|token|password|api[_-]?key|credential)/i` is removed; only
>   `PATH`, `HOME`, `PWD`, `NODE_ENV`, and `npm_config_user_agent` are preserved
>   unconditionally. A parent-process `ANTHROPIC_API_KEY` can therefore never leak
>   into a `tsc`/`vitest` child.

# 5.6 Flaky Test Handling

Test flakiness must not silently fail or pass a verification:

1. If a test fails, retry it **once** (same environment).
2. If it passes on retry, mark that check result as `FLAKY` (recorded in `metrics` and surfaced in the summary) — the check does NOT fail, but the flakiness is stored as evidence.
3. If it fails on retry, the check is `FAILED`.
4. Recurring flaky tests (same test flagged FLAKY repeatedly across runs) are reported to the Attention Engine as a confidence-lowering signal and to the project as a maintenance issue.

# 5.7 Timeout Levels

There are two distinct timeout levels, and both must be configured:

- **Per-check timeout:** maximum duration of a single tool run (e.g., `tsc` gets 120s). On expiry, that check is marked `TIMEOUT` (treated as FAILED for required checks).
- **Request-level timeout** (`VerificationRequest.timeout_seconds`): maximum duration of the entire request. It must be **≥ the sum of sequential checks, or ≥ the max of parallel checks**; the Execution Orchestrator validates this at request creation and rejects inconsistent configurations.

---

# 6. Interaction with Other Subsystems

```text
                    ┌──────────────────────┐
                    │  Verification Engine  │
                    └──────────┬───────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Task Orchestrator│  │  Artifact/Change │  │  Attention       │
│  (Triggers        │  │  Tracker         │  │  Engine          │
│   verification)   │  │  (Records        │  │  (Uses results   │
│                   │  │   results)       │  │   for confidence)│
└─────────────────┘  └──────────────────┘  └──────────────────┘
         │
         ▼
┌─────────────────┐
│  Memory/Evidence│
│  (Stores results │
│   for audit)     │
└─────────────────┘
```

**With Task Orchestrator:** After the Agent Runtime completes execution, the Orchestrator triggers the Verification Engine. The Orchestrator waits for the result before proceeding to the next state.

**With Artifact/Change Tracker:** Verification results are linked to the corresponding changes in the provenance chain.

**With Attention Engine:** The Attention Engine uses verification results as a signal for confidence scoring. Failed verification increases scrutiny; passed verification increases confidence.

**With Memory/Evidence:** All verification results are stored as evidence for long-term audit and learning.

---

# 7. Internal Architecture

```text
┌──────────────────────────────────────────────────────────┐
│              VERIFICATION ENGINE MODULE                   │
├──────────────────────────────────────────────────────────┤
│                                                           │
│ 1. Request Handler                                       │
│    - Creates VerificationRequest                         │
│    - Applies VerificationPolicy                          │
│    - Determines execution strategy                       │
│                                                           │
│ 2. Check Executors                                       │
│    - CompileExecutor: Runs compiler                      │
│    - TestExecutor: Runs test suites                      │
│    - LintExecutor: Runs static analysis                  │
│    - SecurityExecutor: Runs security scans                │
│    - CoverageExecutor: Runs coverage analysis             │
│                                                           │
│ 3. Execution Orchestrator                                │
│    - Manages parallel execution of independent checks    │
│    - Handles timeouts and retries                        │
│    - Implements fail-fast if configured                  │
│                                                           │
│ 4. Result Aggregator                                     │
│    - Collects results from all check executors           │
│    - Determines overall status                           │
│    - Generates structured summary                        │
│                                                           │
│ 5. Evidence Collector                                    │
│    - Formats verification results as evidence            │
│    - Stores in Memory/Evidence system                    │
│    - Emits VerificationCompleted event                   │
└──────────────────────────────────────────────────────────┘
```

---

# 8. API Surface

```typescript
interface IVerificationEngine {
  // Start verification for a change
  verify(changeId: ChangeID): Promise<VerificationRequest>;

  // Get verification status
  getStatus(requestId: VerificationRequestID): Promise<VerificationStatus>;

  // Get verification results
  getResults(requestId: VerificationRequestID): Promise<VerificationResult>;

  // Cancel a running verification
  cancelVerification(requestId: VerificationRequestID): Promise<void>;

  // Update verification policy
  setVerificationPolicy(projectId: ProjectID, policy: VerificationPolicy): Promise<void>;

  // Rerun verification for a previous change
  rerunVerification(changeId: ChangeID): Promise<VerificationRequest>;
}

type VerificationStatus = "PENDING" | "RUNNING" | "COMPLETED" | "CANCELLED" | "TIMEOUT";

interface VerificationCheckResult {
  type: string;
  tool: string;
  status: "PASSED" | "FAILED" | "ERROR" | "SKIPPED";
  durationMs: number;
  output: string;
  errors: VerificationError[];
  metrics: Record<string, unknown>;
}

interface VerificationError {
  file: string;
  line: number;
  column: number;
  severity: "ERROR" | "WARNING" | "INFO";
  message: string;
  code: string;
}
```

---

# 9. Phase 1 Implementation Plan

**Phase 1: "Compilation Only"**
- Implement only the CompileExecutor (run `tsc` or equivalent)
- No parallel execution
- No test execution or static analysis
- Simple pass/fail result
- **Goal:** Prove that the verification pipeline works end-to-end

**Phase 2: "Test Execution"**
- Add TestExecutor (run jest or equivalent)
- Add parallel execution for independent checks
- Add result aggregation and structured output
- Add basic timeout handling

**Phase 3: "Full Verification Suite"**
- Add LintExecutor, SecurityExecutor, CoverageExecutor
- Implement targeted and incremental verification strategies
- Add verification policies and configuration
- Integrate with Attention Engine for confidence scoring

---

# 10. Success Criteria

The Verification Engine is Phase 1 complete when:

- Given a valid change, the engine compiles the project and returns PASSED
- Given a change with a syntax error, the engine returns FAILED with the error location
- The engine respects the timeout configuration and does not hang indefinitely
- The engine can process a verification request in under 30 seconds for a typical project
- Verification results are correctly stored in the Evidence system

---

# 11. Concrete Next Steps

- [ ] Step 1: Define TypeScript interfaces for VerificationRequest, VerificationResult, VerificationCheckResult
- [ ] Step 2: Implement CompileExecutor that runs the project's build command
- [ ] Step 3: Implement RequestHandler and ResultAggregator
- [ ] Step 4: Write unit tests for compilation verification scenarios
- [ ] Step 5: Integrate with Task Orchestrator (trigger verification after agent execution)

---

## Changelog

### v0.2 (Day 29)
- §5.5 — documented the built 64 KB inline-output cap (`truncateOutput`) and the
  `sanitizedEnv()` allowlist/blocklist (secret-pattern key removal; always-block
  `DATABASE_URL*`; always-preserve `PATH`/`HOME`/`PWD`/`NODE_ENV`/`npm_config_user_agent`).
- §5.6 — confirmed the flaky retry-once rule as built: exactly one retry on a
  non-passing first run; pass-on-retry → `FLAKY` (stored, not a failure), fail-again →
  `FAILED`; the `was_retried` flag is persisted per test row. No divergence from v0.1.
- No code divergences found.