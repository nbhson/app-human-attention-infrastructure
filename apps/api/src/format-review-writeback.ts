export interface RejectFindingItem {
  readonly severity: string;
  readonly file: string;
  readonly line?: number | null | undefined;
  readonly message: string;
  readonly suggestion?: string | null | undefined;
  readonly kind?: string | undefined;
}

export interface RejectSuggestionItem {
  readonly file: string;
  readonly hunk?: string | null | undefined;
  readonly proposed: string;
  readonly rationale: string;
}

export interface FormatRejectCommentOptions {
  readonly decision: string;
  readonly rationale?: string | undefined;
  readonly userComment?: string | undefined;
  readonly summary: string;
  readonly findings: readonly RejectFindingItem[];
  readonly suggestions: readonly RejectSuggestionItem[];
}

/**
 * Builds a structured, rich Markdown comment to post back to the Git PR
 * when a reviewer submits a REJECT decision. Contains the human decision,
 * reviewer rationale, AI review summary, full findings catalog, and fix proposals.
 */
export function formatRejectWritebackBody(options: FormatRejectCommentOptions): string {
  const parts: string[] = [];

  // 1. Header & Human Decision
  parts.push(`## ❌ PR Review: REJECTED`);
  if (options.userComment && options.userComment.trim().length > 0) {
    parts.push(`### 💬 Reviewer Feedback\n${options.userComment.trim()}`);
  } else if (options.rationale && options.rationale.trim().length > 0) {
    parts.push(`### 💬 Reviewer Rationale\n${options.rationale.trim()}`);
  }

  // 2. AI Executive Summary
  if (options.summary && options.summary.trim().length > 0) {
    parts.push(`### 🤖 AI Review Summary\n${options.summary.trim()}`);
  }

  // 3. Actionable Findings
  if (options.findings.length > 0) {
    const findingsList = options.findings
      .map((f, i) => {
        const location = f.file + (f.line !== null && f.line !== undefined ? `:${f.line}` : '');
        const badge = `**[${f.severity}]**`;
        let text = `${i + 1}. ${badge} \`${location}\`\n   ${f.message}`;
        if (f.suggestion && f.suggestion.trim().length > 0) {
          text += `\n   *Recommendation:* ${f.suggestion.trim()}`;
        }
        return text;
      })
      .join('\n\n');

    parts.push(`### ⚠️ Findings & Issues (${options.findings.length})\n${findingsList}`);
  }

  // 4. Fix Suggestions with code blocks
  if (options.suggestions.length > 0) {
    const suggestionsList = options.suggestions
      .map((s, i) => {
        let item = `#### ${i + 1}. \`${s.file}\`\n${s.rationale}`;
        if (s.hunk && s.hunk.trim().length > 0) {
          item += `\n\`\`\`diff\n${s.hunk.trim()}\n\`\`\``;
        }
        if (s.proposed && s.proposed.trim().length > 0) {
          item += `\n**Proposed fix:**\n\`\`\`suggestion\n${s.proposed.trim()}\n\`\`\``;
        }
        return item;
      })
      .join('\n\n');

    parts.push(`### 💡 Suggested Fixes (${options.suggestions.length})\n${suggestionsList}`);
  }

  return parts.join('\n\n---\n\n');
}
