# Day 22 — Review UI: queue + diff view + AI report & fix-suggestions panels

| | |
|---|---|
| **Week** | W4 — Human loop + E2E |
| **Spec refs** | Spec 8 §1–2 (Human Review Interface), Spec 1 §4 (attention layer) |
| **Estimated effort** | 8h |
| **Prerequisites** | Days 13/21 (routes + trust pipeline + decision API) |

---

## 1. Objectives

- Build the React review interface in `apps/web`: a review **queue**, a **diff view**, and the **AI report + fix-suggestions panels**.
- Render the full `ReviewReport` (summary, verdict badge, findings with severity, suggestions with proposed hunks) next to the source diff.
- Surface the trust signals — evidence status, attention label, `STALE` flag — so the human sees more than the AI's opinion.
- Wire the decision controls (Approve / Request changes / Reject) to the Day 13 decision route.

## 2. Design Decisions

- The UI is a **viewer + decision collector**, not an editor: it displays the AI's proposals as copyable text; it has no code-writing surface.

```text
queue (left)  →  diff view (center)  →  report + findings + suggestions (right)
                                      →  evidence / attention / freshness strip
```

- Findings render "what I found" (`message` + line) separately from suggestions "what I'd change" (`proposed` + `rationale`), matching the domain split.
- State is minimal (React + `fetch`); no write-back, no live code editing, no auth until Phase 2 (identity is stubbed for the demo).

## 3. Tasks

### 3.1 Queue + report panels (180 min)
- [ ] `apps/web/src/pages/queue.tsx` — recent reviews feed (from `GET /api/reviews`)
- [ ] `report/*` — verdict badge, summary, findings list (severity-tagged)

### 3.2 Diff view + suggestions (180 min)
- [ ] `diff/*` — unified diff renderer (read-only)
- [ ] `suggestions/*` — proposed hunk/rationale cards

### 3.3 Decision wiring + polish (120 min)
- [ ] Decide controls hitting `POST /api/reviews/:id/decision`; trust strip (evidence label, `STALE`)

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/web/src/pages/queue.tsx` | Review queue |
| `apps/web/src/components/report.tsx` | Report/findings panels |
| `apps/web/src/components/diff-view.tsx` | Read-only diff viewer |
| `apps/web/src/components/suggestions.tsx` | Fix-suggestion cards |
| `apps/web/src/api/client.ts` | API client |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/web build` passes and dev-server renders the queue
- [ ] A report loads and shows summary, verdict, ordered findings, and suggestions
- [ ] Decision controls POST to the decision route and show the recorded result
- [ ] Evidence/attention/`STALE` status is visible on the review

## 6. Notes & Pitfalls

- Keep suggestions rendered as *proposals* — no "apply" button, no write path. The reviewer copies them out; the harness never touches the repo.
- Wire against the frozen Day 13 DTOs; don't invent new field names.

---

*Next: [Day 23 — E2E vertical slice — happy path (PR → report → decision)](day-23.md)*