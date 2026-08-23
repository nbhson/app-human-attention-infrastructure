import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { dependencyKindCheck, symbolKindCheck } from './enums.js';

/**
 * The symbol index (day-14 §2.1) — one row per lexical symbol a source file
 * defines (an `export`) or references (an `import`). `file` is the repo-relative
 * POSIX path and `line` the 1-based source line; `column` is optional (the lexer
 * may only pin the line). Populated by `@harness/code-index`'s indexer; `db`
 * holds the table, not the parser.
 */
export const codeIndexSymbols = pgTable(
  'code_index_symbols',
  {
    id: text('id').primaryKey(),
    file: text('file').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    line: integer('line').notNull(),
    column: integer('column'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [symbolKindCheck, index('code_index_symbols_file_idx').on(table.file)],
);

/**
 * The dependency graph (day-14 §2.1) — one row per *local, resolvable* module
 * edge (`from_file` imports `to_file`). Bare packages and dynamic
 * `import(variable)` are deliberately *not* edges: they are a graph gap surfaced
 * by the indexer's `complete` flag, not a row.
 */
export const codeIndexDeps = pgTable(
  'code_index_deps',
  {
    id: text('id').primaryKey(),
    from_file: text('from_file').notNull(),
    to_file: text('to_file').notNull(),
    kind: text('kind').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    dependencyKindCheck,
    index('code_index_deps_from_idx').on(table.from_file),
    index('code_index_deps_to_idx').on(table.to_file),
  ],
);
