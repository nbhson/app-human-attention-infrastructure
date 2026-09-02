---
name: feedback-background-worker-first
description: The user expects background-job workers as the primary fix for long-running AI tasks, not just batching/tuning
metadata:
  type: feedback
---

When the user reported timeout issues with the review pipeline (AI calls taking too long), I proposed a 4-phase plan with batch review, two-pass, memory recall, and context budgeting. The user pointed out I should have proposed a **background job worker** first — making the `POST /api/reviews` endpoint return `202 Accepted` immediately and process the AI call asynchronously in a worker.

**Why:** A background worker solves the HTTP timeout problem at the architectural level, regardless of how long the AI call takes. Batching and two-pass only reduce the probability of timeout, but don't eliminate it — a single slow model call can still timeout. The worker approach is the fundamental fix.

**How to apply:** When facing timeout/performance issues with long-running operations, propose the async/background-worker pattern first, then optimizations (batch, two-pass, etc.) as additional layers on top. Don't start with tuning knobs when the architecture itself is synchronous.