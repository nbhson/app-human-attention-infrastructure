import { describe, expect, it } from 'vitest';

import { GitProviderError } from '../git-provider.js';
import { parseUnifiedDiff } from '../unified-diff.js';

const MODIFIED = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line1
-old
+new
+added
 line3`;

const ADDED = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+one
+two`;

const DELETED = `diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-uno
-dos`;

const RENAMED = `diff --git a/src/old.ts b/src/new.ts
similarity index 90%
rename from src/old.ts
rename to src/new.ts
index 5555555..6666666 100644
--- a/src/old.ts
+++ b/src/new.ts
@@ -1 +1 @@
-same
+same changed`;

const BINARY = `diff --git a/asset.png b/asset.png
new file mode 100644
index 0000000..7777777
Binary files /dev/null and b/asset.png differ`;

describe('parseUnifiedDiff', () => {
  it('parses a modified file with line counts and the block as patch', () => {
    const [file] = parseUnifiedDiff(MODIFIED);
    expect(file).toMatchObject({ path: 'src/a.ts', status: 'MODIFIED', additions: 2, deletions: 1 });
    expect(file!.patch).toContain('@@ -1,3 +1,4 @@');
  });

  it('infers CREATED / DELETED from /dev/null markers', () => {
    const [added] = parseUnifiedDiff(ADDED);
    expect(added).toMatchObject({ path: 'src/new.ts', status: 'CREATED', additions: 2, deletions: 0 });
    const [deleted] = parseUnifiedDiff(DELETED);
    expect(deleted).toMatchObject({ path: 'src/gone.ts', status: 'DELETED', additions: 0, deletions: 2 });
  });

  it('infers RENAMED from rename markers', () => {
    const [renamed] = parseUnifiedDiff(RENAMED);
    expect(renamed).toMatchObject({ path: 'src/new.ts', status: 'RENAMED' });
  });

  it('keeps binary files with an empty patch', () => {
    const [bin] = parseUnifiedDiff(BINARY);
    expect(bin).toMatchObject({ path: 'asset.png', status: 'CREATED', patch: '' });
  });

  it('splits multi-file diffs', () => {
    const files = parseUnifiedDiff(`${MODIFIED}\n${ADDED}`);
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'src/new.ts']);
  });

  it('throws loudly on text with no file blocks', () => {
    expect(() => parseUnifiedDiff('No changes.')).toThrow(GitProviderError);
    expect(() => parseUnifiedDiff('')).toThrow(/no unified-diff file blocks/);
  });
});
