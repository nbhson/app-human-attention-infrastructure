# @harness/attention-engine — Attention Engine

## Hiểu nhanh

**Nhiệm vụ:** "bộ lọc mức quan trọng" — chấm điểm mỗi thay đổi (rủi ro, ảnh hưởng, độ mới, độ phức tạp, độ tin cậy) để quyết định cái nào cần người xem, ưu tiên ra sao.

Nói nôm na: người review là nguồn lực có hạn, gói này giúp họ chỉ xem đúng thứ đáng xem, thay vì phải xem tất cả.

---

## Trạng thái hiện tại

Stubs: `src/index.ts` chỉ export string `'attention-engine'`. Chưa có implementation.

---

## Mục đích

Calculate risk/impact/novelty/complexity/confidence → priority score → routing decision. Quyết định change nào cần human review và ưu tiên thế nào.

---

## Công việc cần làm

### Day 18 — Scoring engine

```typescript
// src/scoring.ts
export const PRIORITY_WEIGHTS = {
  risk: 0.35,
  impact: 0.25,
  novelty: 0.15,
  complexity: 0.10,
  confidence: 0.15,
} as const;

export interface FactorScores {
  risk: number;
  impact: number;
  novelty: number;
  complexity: number;
  confidenceScore: number; // LOW confidence → HIGH priority
}

export function computePriority(f: FactorScores, unavailable: string[]): number {
  // If factor unavailable, use neutral 0.5 and redistribute weight
  const avail = {
    risk: unavailable.includes('risk') ? null : f.risk,
    impact: unavailable.includes('impact') ? null : f.impact,
    novelty: unavailable.includes('novelty') ? null : f.novelty,
    complexity: unavailable.includes('complexity') ? null : f.complexity,
    confidence: unavailable.includes('confidence') ? null : f.confidenceScore,
  };

  const weights = {
    risk: avail.risk !== null ? PRIORITY_WEIGHTS.risk : 0,
    impact: avail.impact !== null ? PRIORITY_WEIGHTS.impact : 0,
    novelty: avail.novelty !== null ? PRIORITY_WEIGHTS.novelty : 0,
    complexity: avail.complexity !== null ? PRIORITY_WEIGHTS.complexity : 0,
    confidence: avail.confidence !== null ? PRIORITY_WEIGHTS.confidence : 0,
  };

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  // Redistribute: normalize weights
  const normalized = Object.fromEntries(
    Object.entries(weights).map(([k, v]) => [k, v / totalWeight])
  );

  return (
    normalized.risk * (avail.risk ?? 0.5) +
    normalized.impact * (avail.impact ?? 0.5) +
    normalized.novelty * (avail.novelty ?? 0.5) +
    normalized.complexity * (avail.complexity ?? 0.5) +
    normalized.confidence * (1 - (avail.confidence ?? 0.5)) // inverted!
  );
}

export function priorityLabel(score: number): PriorityLabel {
  if (score >= 0.80) return 'CRITICAL';
  if (score >= 0.60) return 'HIGH';
  if (score >= 0.30) return 'MEDIUM';
  return 'LOW';
}
```

### Day 18 — Factor extractors

```typescript
// src/factor-extractors.ts
// Each returns number | null (null = unavailable)

export function extractRisk(verificationReport: VerificationReport, artifacts: Artifact[]): number | null {
  // verification FAILED=0.9, FLAKY=0.6, TIMED_OUT=0.7, PASSED=0.1
  // +0.1 if secrets-adjacent path touched
  if (!verificationReport) return null;
  const base = verificationReport.overall === 'FAILED' ? 0.9
             : verificationReport.overall === 'FLAKY' ? 0.6
             : verificationReport.overall === 'TIMED_OUT' ? 0.7
             : 0.1;
  const secretsAdj = artifacts.some(a => /env|credential|secret/i.test(a.filePath));
  return Math.min(1.0, base + (secretsAdj ? 0.1 : 0));
}

export function extractImpact(change: Change, diffEngine: DiffEngine): number | null {
  // min(1, files_touched / 10) blended 50/50 with path criticality
  const fileRatio = Math.min(1, change.filesAffected.length / 10);
  const criticalPaths = change.filesAffected.some(f =>
    f.path.includes('packages/domain') || f.path.includes('migrations')
  ) ? 1.0 : 0.5;
  return 0.5 * fileRatio + 0.5 * criticalPaths;
}

export function extractNovelty(taskType: string, assessmentHistory: Assessment[]): number | null {
  // 1.0 if new pattern; 0.2 if seen ≥3×
  const history = assessmentHistory.filter(a => a.taskType === taskType);
  if (history.length === 0) return 1.0;
  if (history.length >= 3) return 0.2;
  return 1.0 - (history.length * 0.3);
}

export function extractComplexity(diff: FileDiff, trajectorySteps: TrajectoryStep[]): number | null {
  // min(1, (added+removed)/500) blended with trajectory steps
  const lineRatio = Math.min(1, (diff.linesAdded + diff.linesRemoved) / 500);
  const stepRatio = Math.min(1, trajectorySteps.length / 20);
  return 0.5 * lineRatio + 0.5 * stepRatio;
}

export function extractConfidence(verificationReport: VerificationReport, retryCount: number): number | null {
  // Proxy: 1 - risk_proxy where risk_proxy from verification + retry count
  const riskFromVerify = verificationReport?.overall === 'FAILED' ? 0.9 : 0.1;
  const riskFromRetries = Math.min(0.5, retryCount * 0.15);
  return 1 - Math.min(1, riskFromVerify + riskFromRetries);
}
```

### Day 19 — Policy rules + Routing

```typescript
// src/policy.ts
export type RoutingAction = 'REVIEW_REQUIRED' | 'REVIEW_RECOMMENDED' | 'AUTO_APPROVABLE' | 'ESCALATE';

export interface AttentionPolicyRule {
  id: string;
  when: { minPriority?: number; labels?: string[]; flaky?: boolean };
  action: RoutingAction;
}

export const ATTENTION_POLICY_V1 = {
  version: 1,
  rules: [
    { id: 'r1-critical', when: { labels: ['CRITICAL'] }, action: 'ESCALATE' },
    { id: 'r2-high',     when: { labels: ['HIGH'] },     action: 'REVIEW_REQUIRED' },
    { id: 'r3-flaky',    when: { flaky: true },          action: 'REVIEW_REQUIRED' },
    { id: 'r4-medium',   when: { labels: ['MEDIUM'] },   action: 'REVIEW_RECOMMENDED' },
    { id: 'r5-low',      when: { labels: ['LOW'] },      action: 'AUTO_APPROVABLE' },
  ],
  fatigue: { dailyReviewBudget: 20, inflationWindowDays: 7, inflationAlertRatio: 1.5 },
};
```

```typescript
// src/routing.ts
export class RoutingService {
  async route(assessment: AttentionAssessment): Promise<RoutingAction> {
    const policy = await this.loadPolicy(assessment.projectId);
    for (const rule of policy.rules) {
      if (this.matches(rule.when, assessment)) {
        return rule.action;
      }
    }
    return 'REVIEW_REQUIRED'; // default
  }
}
```

### Day 19 — Alert fatigue

```typescript
// src/alert-fatigue.ts
export class AlertFatigueMonitor {
  async reportAssessmentFeedback(assessmentId: AssessmentID, wasUseful: boolean, comment?: string): Promise<void> {
    // Record feedback for calibration
    await this.db.insert(assessment_feedback).values({ assessment_id: assessmentId, was_useful, comment, created_at: new Date() });
  }

  async isOverBudget(today: Date): Promise<boolean> {
    const count = await this.db.select({ count: count() })
      .from(assessment_feedback)
      .where(and(eq(assessment_feedback.created_at, today), eq(assessment_feedback.was_useful, false)));
    return count[0].count >= ATTENTION_POLICY_V1.fatigue.dailyReviewBudget;
  }
}
```

---

## Dependency rule

```
packages/attention-engine → import @harness/domain, @harness/event-bus, @harness/db
                          → KHÔNG import các engine packages khác
```

---

## Key design

- **Corrected formula**: `confidence` term là `(1 - confidenceScore)` — confidence THẤP làm TĂNG priority
- **Pure functions**: factor extractors là pure, unit-testable không cần DB
- **Weighted combination**: weights là constants, có thể tune trong Phase 2
- **Policy-driven routing**: rules là data (JSON), không hardcode
- **Alert fatigue controls**: prevent reviewer burnout

---

## Files cần tạo

```
src/
├── index.ts
├── types.ts                    # AttentionAssessment, FactorScores, PriorityLabel
├── scoring.ts                  # computePriority()
├── factor-extractors.ts        # Pure functions extracting each factor
├── policy.ts                   # AttentionPolicy rules
├── routing.ts                  # Route assessment → review_queue action
├── alert-fatigue.ts            # Daily budget, feedback, inflation monitor
└── __tests__/
    ├── scoring.test.ts
    ├── factor-extractors.test.ts
    └── policy.test.ts
```
