# @harness/context-engine — Context Engine

## Hiểu nhanh

**Nhiệm vụ:** "người chọn tài liệu" — chọn lọc, xếp hạng, nén ngữ cảnh đúng cho agent, để agent có đủ thông tin mà không bị tràn context window.

Nói nôm na: trước khi thợ (agent) làm việc, gói này soạn cho thợ một bộ tài liệu gọn và đúng trọng tâm, chứ không vứt cả repo vào mặt thợ.

---

## Trạng thái hiện tại

Stubs: `src/index.ts` chỉ export string `'context-engine'`. Chưa có implementation.

---

## Mục đích

Chọn lọc, xếp hạng, nén và deliver context relevant cho Agent Runtime — đảm bảo agent nhận đúng thông tin mà không quá tải context window.

---

## Công việc cần làm

### Day 20 — FileCollector

```typescript
// src/collector.ts
export class FileCollector {
  async collect(request: ContextRequest): Promise<ContextSource[]> {
    // 1. Start with target files (explicitly mentioned)
    // 2. Tokenize taskDescription + requirements into keywords
    // 3. Scan repo files for keyword matches in path or content
    // 4. Exclude: node_modules, .git, dist, build, binaries, files > 256KB
    // 5. Return candidate set
  }
}
```

### Day 20 — RelevanceRanker

```typescript
// src/ranker.ts
// Phase-1 formula (Spec 4 §5):
// relevance_score = 0.7 * keyword_overlap + 0.3 * dependency_proximity

export function keywordOverlap(taskKeywords: Set<string>, sourceContent: string): number {
  const sourceTokens = tokenize(sourceContent);
  if (taskKeywords.size === 0) return 0;
  const hits = [...taskKeywords].filter(k => sourceTokens.has(k)).length;
  return hits / taskKeywords.size; // Jaccard-like
}

export function dependencyProximity(sourcePath: string, targetPaths: string[]): number {
  // Same directory = 1.0; imported by target = 0.8; otherwise = 0.2
  // Approximated by path heuristics until code index exists
}

export function computeRelevanceScore(source: ContextSource, request: ContextRequest): number {
  return 0.7 * keywordOverlap(request.keywords, source.content)
       + 0.3 * dependencyProximity(source.sourceId, request.targetFiles);
}
```

### Day 20 — Tokenizer & Budget Trimmer

```typescript
// src/tokenizer.ts
export interface Tokenizer { count(text: string): number; }

export class ApproxTokenizer implements Tokenizer {
  // Phase 1 estimate: chars / 4 (Spec 4 §8)
  count(text: string): number { return Math.ceil(text.length / 4); }
}

// src/compressor.ts
export function trimToBudget(sources: ContextSource[], maxTokens: number, tokenizer: Tokenizer): ContextSource[] {
  let total = 0;
  const kept: ContextSource[] = [];

  // ALWAYS keep target files first
  for (const s of sources) {
    if (request.targetFiles.includes(s.sourceId)) {
      kept.push(s);
      total += s.tokenCount;
    }
  }

  // Then add by relevance score until budget exceeded
  const nonTarget = sources.filter(s => !request.targetFiles.includes(s.sourceId))
                           .sort((a, b) => b.relevanceScore - a.relevanceScore);

  for (const s of nonTarget) {
    if (total + s.tokenCount <= maxTokens) {
      kept.push(s);
      total += s.tokenCount;
    } else {
      // Try to truncate instead of drop
      const truncated = truncateToTokens(s, maxTokens - total);
      if (truncated) { kept.push(truncated); total = maxTokens; }
      break;
    }
  }
  return kept;
}
```

### Day 21 — Freshness Check

```typescript
// src/freshness.ts
export type Freshness = 'FRESH' | 'STALE';

export async function checkFreshness(
  snapshot: ContextSnapshot,
  projectRoot: string,
): Promise<{ freshness: Freshness; staleSources: string[] }> {
  const stale: string[] = [];
  for (const s of snapshot.sources) {
    const currentHash = await sha256OfFile(join(projectRoot, s.sourceId));
    if (currentHash !== s.contentHash) stale.push(s.sourceId);
  }
  return { freshness: stale.length ? 'STALE' : 'FRESH', staleSources: stale };
}
```

**STALE policy**: re-resolve only stale sources; agent already running receives warning in trajectory.

### Day 21 — Packager

```typescript
// src/packager.ts
export function packContext(snapshot: ContextSnapshot, request: ContextRequest): string {
  return [
    `## Project Context`,
    `[architecture rules]`,
    ``,
    `## Task`,
    `${request.taskDescription}`,
    `${request.requirements}`,
    ``,
    `## Relevant Files (ranked)`,
    ...snapshot.sources.map(s => `### ${s.sourceId} (relevance: ${s.relevanceScore.toFixed(2)})`),
  ].join('\n');
}
```

---

## Priority rules (compression)

1. Never remove target files
2. Never remove architecture rules
3. Prefer removing git history and documentation before source code
4. If still over budget, truncate lower-ranked files first

---

## Dependency rule

```
packages/context-engine → import @harness/domain, @harness/db
                        → KHÔNG import các engine packages khác
```

---

## Files cần tạo

```
src/
├── index.ts
├── types.ts                # ContextRequest, ContextSnapshot, ContextSource, Tokenizer
├── collector.ts            # FileCollector
├── ranker.ts               # RelevanceRanker (keyword + dependency)
├── compressor.ts           # Budget trimmer
├── packager.ts             # Structured prompt renderer
├── freshness.ts            # STALE/FRESH detection
├── tokenizer.ts            # ApproxTokenizer (chars/4)
└── __tests__/
    ├── collector.test.ts
    ├── ranker.test.ts
    ├── compressor.test.ts
    └── freshness.test.ts
```
