# Claude Code Configuration

Local configuration for Claude Code. Not committed — overrides team defaults.

## Permissions

Commands allowed without confirmation (see `settings.local.json`):

- `pnpm --version`, `corepack --version`
- `docker --version`, `docker compose *`
- `git --version`

## Quick Commands

```bash
# Setup
pnpm install
docker compose up -d
pnpm --filter @harness/db migrate

# Development
pnpm dev                    # API + web UI
pnpm test                   # unit + integration
pnpm e2e                    # end-to-end
pnpm lint && pnpm typecheck # quality gate
pnpm build                  # build all

# Demos
pnpm demo:mcp-connectivity
pnpm demo:memory
pnpm demo:writeback
pnpm demo:verification
pnpm demo:closed-loop
```

## Architecture Note

HAI Harness is a **review-only control plane** (`review-reorient`). The code-generation path (AgentRunner, Dispatcher, ToolRegistry, reconcile.ts) was retired in Phase 3. See `docs/runbook/limitations.md` §3.

## Auto-Review Mode

When enabled in the Triage Rules settings, the AI reviewer operates in **full code-review mode** — surfacing ALL findings including MINOR, NIT, and INFO (naming, style, architecture, maintainability).

- **Default**: OFF (human-review mode, only CRITICAL/MAJOR shown)
- **Endpoint**: `POST /api/reviews/auto` (separate from the async `POST /api/reviews`)
- **Config**: Toggles in the Triage Rules page (Admin/Reviewer role required)

## Review Instructions (text.md)

The Triage Rules page includes a **Review instructions** toggle and a text.md file upload. When enabled:

1. Upload a markdown instructions/skills file via the "Choose .md file" button or paste directly into the textarea
2. Toggle **"Review instructions (text.md)"** ON
3. Every subsequent AI review (both the quick summarize pass and the full batch review) will inject the instructions verbatim into the prompt as authoritative guidance

This enables the **PR + Jira + text.md + AI** flow — project-specific rules, coding standards, or domain knowledge that the AI reviewer must follow on top of its general review capabilities. Toggle OFF to return to the standard PR + Jira + AI flow.

## Memory

Project memory is stored in `.claude/memory/` and indexed in `MEMORY.md`.
