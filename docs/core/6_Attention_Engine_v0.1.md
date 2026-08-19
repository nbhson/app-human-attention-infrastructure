# Attention Engine
## Specification v0.1 – Assessing Risk, Impact, and Review Priority

**Status:** Draft v0.1  
**Dependencies:** Architecture (`HAI_Harness_Architecture_v0.1.md`), Task Orchestrator (`Task_Work_Orchestrator_v0.1.md`)  
**Purpose:** Define how the Harness intelligently determines whether a change requires human attention, and if so, at what priority level — transforming human attention from a passive bottleneck into an optimized resource.

---

# 1. Purpose

The Attention Engine is the **core differentiator** of HAI Harness. It answers the critical question: **"Does this change need human eyes, and how urgently?"**

Its primary responsibilities:
1.  **Risk Assessment:** Evaluate the risk level of an AI-generated change based on code paths, dependencies, and historical patterns.
2.  **Impact Analysis:** Determine the blast radius of a change — which systems, modules, or users could be affected.
3.  **Confidence Estimation:** Assess the AI's confidence in the change based on trajectory quality, test coverage, and verification results.
4.  **Novelty Detection:** Identify if the change introduces new patterns, APIs, or approaches that need human judgment.
5.  **Complexity Scoring:** Measure the complexity of the change (lines changed, files touched, dependencies involved).
6.  **Priority Assignment:** Combine all signals into a single review priority score that determines human attention ordering.

> **Core Principle:** Human attention is the most expensive resource in the system. The Attention Engine must optimize its use — not every change needs a human, but every change that needs a human must be identified correctly.

---

# 2. Core Domain Objects

## 2.1 AttentionAssessment

```text
AttentionAssessment
├── id: AssessmentID
├── task_id: TaskID
├── change_id: ChangeID
├── created_at: timestamp
├── scores: AttentionScores
│   ├── risk_score: float (0.0 - 1.0)
│   ├── impact_score: float (0.0 - 1.0)
│   ├── confidence_score: float (0.0 - 1.0)
│   ├── novelty_score: float (0.0 - 1.0)
│   └── complexity_score: float (0.0 - 1.0)
├── combined_priority: float (0.0 - 1.0, computed from scores)
├── priority_label: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
├── review_required: boolean
├── review_reason: string (explanation of why review is needed)
├── recommended_reviewer: string (suggested reviewer based on expertise)
├── suggested_review_depth: "QUICK" | "NORMAL" | "DEEP"
├── factors: List[AttentionFactor]
│   ├── AttentionFactor
│   │   ├── name: string
│   │   ├── score: float
│   │   ├── weight: float
│   │   └── description: string
│   └── ...
└── metadata: Map[string, any]
```

## 2.2 AttentionPolicy

```text
AttentionPolicy
├── id: PolicyID
├── project_id: ProjectID
├── rules: List[AttentionRule]
│   ├── AttentionRule
│   │   ├── condition: string (e.g., "file_path matches 'src/auth/*'")
│   │   ├── action: "ALWAYS_REVIEW" | "NEVER_REVIEW" | "ADJUST_PRIORITY"
│   │   └── priority_modifier: float (e.g., 0.5 to increase priority)
│   └── ...
├── risk_threshold: float (above this, always require review)
├── confidence_threshold: float (below this, always require review)
├── auto_approve_enabled: boolean
├── auto_approve_max_risk: float (max risk for auto-approve)
└── require_review_for_paths: List[string] (glob patterns)
```

---

# 3. Attention Scoring Model

The Attention Engine combines multiple signals into a unified assessment:

```text
                  ┌─────────────────────┐
                  │  Attention Engine   │
                  └──────────┬──────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Risk Score  │    │ Impact Score │    │ Confidence   │
│              │    │              │    │    Score     │
│  • Code path │    │ • Blast      │    │              │
│  • Historical│    │   radius     │    │ • Trajectory │
│  • Dependency│    │ • User affect│    │   quality    │
│  • Security  │    │ • System     │    │ • Test       │
│  • Complexity│    │   criticality│    │   coverage   │
└──────────────┘    └──────────────┘    │ • Verification│
                                        │   results    │
                    ┌──────────────┐    └──────────────┘
                    │  Novelty     │
                    │   Score      │
                    │              │
                    │ • New        │
                    │   patterns   │
                    │ • New APIs   │
                    │ • New deps   │
                    └──────────────┘
```

> **All weights and thresholds in this section are initial placeholders.** They must be calibrated with real project data before being trusted in production. Treat them as starting defaults, not validated constants.

> **Data dependencies per phase:** Factors that require historical or learned data — *historical bug frequency*, *similar task success*, blast radius from a dependency graph — depend on the Memory/Evidence system and a code index (Phase 3). Until those exist (Phase 1–2), these factors use a neutral default of `0.5` and their weight is redistributed proportionally to the available factors. The scoring pipeline must treat "factor unavailable" as an explicit state, not silently as zero.

## 3.1 Risk Score Factors

| Factor | Weight | Description | Data dependency |
|--------|--------|-------------|-----------------|
| File risk level | 0.30 | Files in critical paths (auth, payment, security) score higher | Phase 1 (path rules) |
| Historical bug frequency | 0.15 | Files with many past bugs score higher | Phase 3 (Memory) |
| Dependency count | 0.10 | Files with many dependents score higher | Phase 3 (code index) |
| Security sensitivity | 0.25 | Changes touching security-related code score higher | Phase 1 (path rules) |
| Change size | 0.10 | Large changes score higher (more surface area for bugs) | Phase 1 |
| Data access | 0.10 | Changes touching PII, secrets, or data layer score higher | Phase 2 (scanners) |

## 3.2 Impact Score Factors

| Factor | Weight | Description |
|--------|--------|-------------|
| Blast radius | 0.35 | Number of modules/files affected transitively |
| User exposure | 0.25 | Percentage of users affected by the change |
| System criticality | 0.25 | Is the changed module part of core functionality? |
| Rollback difficulty | 0.15 | How hard is it to roll back if the change fails? |

## 3.3 Confidence Score Factors

| Factor | Weight | Description |
|--------|--------|-------------|
| Trajectory completeness | 0.25 | Did the agent explore enough before making changes? |
| Test coverage | 0.30 | Do tests cover the changed code? |
| Verification results | 0.30 | Did tests pass? Lint pass? Build pass? |
| Similar task success | 0.15 | How often have similar tasks succeeded in the past? |

## 3.4 Combined Priority Calculation

```text
combined_priority = w_risk * risk_score
                  + w_impact * impact_score
                  + w_novelty * novelty_score
                  + w_complexity * complexity_score
                  + w_confidence * (1 - confidence_score)

Note: low confidence must INCREASE priority, so we add the confidence
deficit (1 - confidence_score) rather than subtracting confidence.
With weights summing to 1.0 and all scores in [0,1], combined_priority
is guaranteed to stay within [0,1].

Where default weights:
  w_risk = 0.35
  w_impact = 0.25
  w_novelty = 0.15
  w_complexity = 0.10
  w_confidence = 0.15

Priority labels:
  Critical: ≥ 0.80
  HIGH:     ≥ 0.60
  MEDIUM:   ≥ 0.30
  LOW:      < 0.30
```

---

# 4. Review Decision Logic

```text
                ┌──────────────────────────────┐
                │  Change arrives for review    │
                └──────────────┬───────────────┘
                               │
                               ▼
                ┌──────────────────────────────┐
                │  Compute AttentionAssessment  │
                └──────────────┬───────────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
                    ▼                     ▼
           ┌────────────────┐   ┌──────────────────┐
           │ combined_      │   │ combined_         │
           │ priority >=    │   │ priority <        │
           │ threshold      │   │ threshold         │
           └────────┬───────┘   └────────┬─────────┘
                    │                     │
                    ▼                     ▼
           ┌────────────────┐   ┌──────────────────┐
           │ REVIEW REQUIRED│   │ Check policy     │
           │                 │   │ rules            │
           └────────┬───────┘   └────────┬─────────┘
                    │                     │
                    │           ┌─────────┴─────────┐
                    │           │                   │
                    │           ▼                   ▼
                    │   ┌──────────────┐  ┌──────────────────┐
                    │   │ Policy says  │  │ Policy says      │
                    │   │ ALWAYS_REVIEW│  │ NEVER_REVIEW or  │
                    │   │              │  │ matches auto-    │
                    │   │              │  │ approve criteria │
                    │   └──────┬───────┘  └────────┬─────────┘
                    │          │                    │
                    │          ▼                    ▼
                    │   ┌──────────────┐  ┌──────────────────┐
                    └──►│ REVIEW       │  │ AUTO-APPROVE     │
                        │ REQUIRED     │  │ (Skip human)     │
                        └──────────────┘  └──────────────────┘
```

## 4.1 Alert Fatigue Management

An attention system that cries wolf destroys its own purpose. The Attention Engine must actively manage review load:

1. **Daily review budget:** Each project configures a maximum number of human reviews per day (e.g., 20). When the budget is exhausted, remaining MEDIUM/LOW items are queued for the next day (CRITICAL/HIGH always go through).
2. **Adaptive thresholds:** If the approval rate for a priority band exceeds ~95% over a rolling window, the band's threshold is raised (fewer items promoted). If rejection/rework rates rise, thresholds are lowered. All adaptations are logged and reversible.
3. **Priority inflation monitoring:** Track the distribution of priority labels over time. If CRITICAL/HIGH share grows beyond a configured ceiling (e.g., 30% of all assessments), emit a governance alert — either the scoring model is miscalibrated or the codebase risk profile genuinely changed.
4. **Feedback loop:** Every human decision (approve/reject/rework) is reported back via `reportAssessmentFeedback` and stored by Memory/Evidence to recalibrate factor weights in Phase 3.

---

# 5. Interaction with Other Subsystems

```text
                    ┌──────────────────┐
                    │  Attention Engine │
                    └────────┬─────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐  ┌──────────────┐  ┌──────────────────┐
│  Task Orchestrator│  │ Artifact/   │  │ Human Review     │
│  (Triggers        │  │ Change      │  │ Interface        │
│   assessment)     │  │ Tracker     │  │ (Provides        │
│                   │  │ (Reads      │  │  assessment to   │
│                   │  │  changes)   │  │  reviewers)      │
└─────────────────┘  └──────────────┘  └──────────────────┘
         │
         ▼
┌─────────────────┐
│  Memory/Evidence│
│  (Stores         │
│   assessments    │
│   for learning)  │
└─────────────────┘
```

**With Task Orchestrator:** After verification passes, the Orchestrator calls the Attention Engine to determine if the change needs human review. If review is required, the task is parked in AWAITING_REVIEW state.

**With Artifact/Change Tracker:** The Attention Engine reads the change details and provenance chain to assess risk and impact.

**With Human Review Interface:** The assessment is passed to the review interface to guide the reviewer (e.g., "This change is HIGH risk because it modifies auth code").

**With Memory/Evidence:** Assessment results are stored for learning — over time, the engine can improve its scoring based on past human decisions.

---

# 6. Internal Architecture

```text
┌──────────────────────────────────────────────────────┐
│               ATTENTION ENGINE MODULE                 │
├──────────────────────────────────────────────────────┤
│                                                       │
│ 1. Assessment Trigger                                │
│    - Listens for VerificationCompleted events        │
│    - Initiates attention assessment                  │
│    - Applies AttentionPolicy                         │
│                                                       │
│ 2. Risk Analyzer                                     │
│    - Analyzes code paths and dependencies            │
│    - Checks security sensitivity                     │
│    - Evaluates historical bug density                │
│                                                       │
│ 3. Impact Analyzer                                   │
│    - Computes blast radius via dependency graph      │
│    - Evaluates user/system exposure                  │
│    - Assesses rollback difficulty                    │
│                                                       │
│ 4. Confidence Evaluator                              │
│    - Analyzes agent trajectory quality               │
│    - Checks test coverage of changed code            │
│    - Reviews verification results                    │
│                                                       │
│ 5. Novelty Detector                                  │
│    - Compares changes against codebase patterns      │
│    - Detects new APIs, new dependencies              │
│    - Flags unusual approaches                        │
│                                                       │
│ 6. Priority Calculator                               │
│    - Combines all scores with weights                │
│    - Applies policy rules                            │
│    - Determines final review decision                │
└──────────────────────────────────────────────────────┘
```

---

# 7. API Surface

```typescript
interface IAttentionEngine {
  // Assess a change and determine if human review is needed
  assessChange(changeId: ChangeID): Promise<AttentionAssessment>;

  // Get assessment for a specific task
  getAssessment(taskId: TaskID): Promise<AttentionAssessment>;

  // Update attention policy for a project
  setAttentionPolicy(projectId: ProjectID, policy: AttentionPolicy): Promise<void>;

  // Provide feedback on assessment accuracy (for learning)
  reportAssessmentFeedback(
    assessmentId: AssessmentID,
    actualDecision: string,
    feedback: string
  ): Promise<void>;

  // Recalculate priority based on new information
  recalculatePriority(assessmentId: AssessmentID): Promise<AttentionAssessment>;
}

interface AttentionScores {
  riskScore: number;
  impactScore: number;
  confidenceScore: number;
  noveltyScore: number;
  complexityScore: number;
}

interface AttentionFactor {
  name: string;
  score: number;
  weight: number;
  description: string;
}

interface AttentionPolicy {
  rules: AttentionRule[];
  riskThreshold: number;
  confidenceThreshold: number;
  autoApproveEnabled: boolean;
  autoApproveMaxRisk: number;
  requireReviewForPaths: string[];
}
```

---

# 8. Phase 1 Implementation Plan

**Phase 1: "Rule-Based Assessment"**
- Implement simple rule-based risk assessment (file path matching, change size)
- No impact analysis (use static blast radius based on file count)
- No confidence scoring (assume medium confidence)
- No novelty detection
- Manual attention policy configuration
- **Goal:** Prove that the engine can correctly identify high-risk changes

**Phase 2: "Statistical Assessment"**
- Add impact analysis based on dependency graph
- Add confidence scoring based on verification results
- Add basic novelty detection (new file creation, new dependency imports)
- Implement policy-based auto-approve for low-risk changes

**Phase 3: "Learning Assessment"**
- Add historical learning from past human decisions
- Implement semantic novelty detection
- Add trajectory quality analysis
- Continuously tune weights based on feedback

---

# 9. Success Criteria

The Attention Engine is Phase 1 complete when:

- Given a change to `src/auth/login.ts`, the engine correctly assigns HIGH risk
- Given a change to `src/utils/format.ts`, the engine correctly assigns LOW risk
- The engine correctly applies policy rules (e.g., ALWAYS_REVIEW for `src/payment/*`)
- The engine can process an assessment in under 200ms
- The engine correctly identifies at least 80% of changes that ultimately require human intervention

---

# 10. Concrete Next Steps

- [ ] Step 1: Define TypeScript interfaces for AttentionAssessment, AttentionScores, AttentionPolicy
- [ ] Step 2: Implement RiskAnalyzer with file path pattern matching and change size analysis
- [ ] Step 3: Implement PriorityCalculator with configurable weights
- [ ] Step 4: Write unit tests for risk assessment scenarios
- [ ] Step 5: Integrate with Task Orchestrator (trigger assessment after verification)