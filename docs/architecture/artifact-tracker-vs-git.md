# ADR — Artifact Tracker vs Git Boundary

**Status:** Accepted — _partly superseded by `review-reorient`_ (see below)
**Date:** 2026-08-21 (Day 14)
**Deciders:** HAI Harness build
**Spec ref:** `packages/artifact-tracker/README.md` (as-built home; the former `5_Artifact_Change_Tracker_v0.2.md` is retired)

> **`review-reorient` note.** The Day-24 merge step (`MergeService` /
> `ShellGitAdapter.applyAndCommit`) was retired with the code-generation path. The
> harness no longer writes to Git — it reads an external PR. The _"Tracker owns
> pre-merge, Git owns post-merge"_ split below therefore still describes the
> provenance model for a change, but the `changes.commit_sha` join point is no
> longer written by the retired merge step (write-back, if any, is a
> read-only comment/status, not a commit).

## Context

The Harness must answer, with evidence, the question "what did the AI change, and
why?" Two systems could each be the system of record for that answer: the
**Artifact Tracker** (in-house, `@harness/artifact-tracker`) and **Git** (the
destination repository). If both try to own the same truth, provenance becomes
ambiguous and rollback becomes guesswork.

## Decision

The boundary is a single chronological seam — the **human merge**:

- **Tracker owns everything _before_ merge.** Content (content-addressed
  snapshots), the change lifecycle (`PENDING → VERIFIED → REVIEWED`,
  `any → ROLLED_BACK`), diffs (Day 17), and the provenance chain (which agent
  run, which task, which attempt) all live in the Tracker. It is the pre-commit
  source of truth.
- **Git owns everything _after_ merge.** The repository history, the actual
  committed bytes, and the branch/tag topology are Git's. The Tracker never
  rewrites Git history and never shells out to Git.
- **The single join point is `changes.commit_sha`.** The merge step (Day 24)
  writes the resulting commit SHA back into the change's metadata. That one
  column is how a pre-commit change maps to its post-merge commit, and it is the
  _only_ coupling between the two systems.

## Consequences

- **Append-only provenance.** Tracker metadata (`artifacts`, `changes`,
  `snapshots`, links, hashes) is never deleted — enforced by the no-`DELETE`
  lint test in `packages/artifact-tracker/src/__tests__/no-delete.test.ts`.
  Only snapshot _content_ may be pruned by a future retention job.
- **No shelling out.** `artifact-tracker` never invokes `git`. This keeps the
  boundary rule (Spec 1 §5 R4) and the package's dependency allow-list clean,
  and avoids entangling the tracker with the host's Git installation.
- **Pre-commit changes have `commit_sha = NULL`.** Until the Day-24 merge step,
  a change is trackable but not yet realized in Git. Read paths that need "what
  does the repo currently say" must go through Git, not the Tracker.

## Related

- Tracker service: `packages/artifact-tracker/src/artifact-tracker.ts` (Day 14).
- Wiring: `docs/architecture/wiring-map.md`.
- Merge-on-approve (writes `commit_sha`): Day 24.
