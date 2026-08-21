/**
 * Keyword tokenization (day-20 §2.2 / §6).
 *
 * Keywords are lowercased, split on non-alphanumeric boundaries, and stopword-
 * filtered. Without the stopword filter, "the"/"a"/"fix" would dominate the
 * overlap score and turn ranking into noise (day-20 §6).
 */

/** Words that carry no salience for file matching — include task-action verbs. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'if',
  'of',
  'at',
  'by',
  'for',
  'with',
  'about',
  'to',
  'from',
  'in',
  'on',
  'into',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'this',
  'that',
  'these',
  'those',
  'my',
  'your',
  'our',
  'their',
  'as',
  'so',
  'not',
  'no',
  'yes',
  'can',
  'will',
  'would',
  'should',
  'could',
  'may',
  'might',
  'must',
  'just',
  'very',
  'also',
  'more',
  'most',
  'some',
  'any',
  'all',
  'each',
  'both',
  'few',
  'than',
  'then',
  'there',
  'here',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'why',
  'how',
  'when',
  'get',
  'got',
  'make',
  'made',
  'use',
  'used',
  'using',
  'fix',
  'add',
  'update',
  'remove',
  'change',
]);

/**
 * Tokenize `text` into a deduplicated set of lowercase, stopword-filtered
 * keywords.
 */
export function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word));
  return new Set(tokens);
}

const FILE_REFERENCE = new RegExp(
  `[A-Za-z0-9_./-]+\\.(?:ts|tsx|js|jsx|mts|cts|json|md|css|scss|less|py|rb|rs|go|java|kt|cpp|c|h|hpp|sh|yaml|yml|toml|sql)\\b`,
  'g',
);

/**
 * Extract repo-relative file references from a task title/description so the
 * collector can pin them as `targetFiles` (§2.2). Matches tokens that carry a
 * source extension, e.g. `src/PaymentService.ts` → `src/PaymentService.ts`.
 */
export function extractFileReferences(text: string): string[] {
  const matches = text.match(FILE_REFERENCE);
  if (!matches) return [];
  return [...new Set(matches)];
}
