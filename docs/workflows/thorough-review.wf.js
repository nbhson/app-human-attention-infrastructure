// thorough-review.wf.js — Multi-pass code review workflow
// Solutions for non-deterministic code review:
// 1. N-pass review (loop-until-dry) x 8 agents/pass
// 2. Adversarial verification (3 judges, majority vote, re-verify critical)
// 3. Merge & dedup across passes (normalized line key)
// 4. Final synthesis with severity classification

export const meta = {
  name: 'thorough-review',
  description:
    'Multi-pass, multi-lens code review with adversarial verification and cross-run dedup',
  phases: [
    { title: 'Prepare', detail: 'PR info, CLAUDE.md scan' },
    { title: 'Review', detail: '3 vong review, 8 agents moi vong' },
    { title: 'Verify', detail: 'Adversarial verify (3 judges per finding)' },
    { title: 'Synthesize', detail: 'Dedup, classify, report' },
  ],
};

// --- Schema definitions ------------------------------------------------

const FINDING = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    line: { type: 'number' },
    severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
    description: { type: 'string' },
    evidence: { type: 'string' },
    category: {
      type: 'string',
      enum: [
        'security',
        'bug',
        'performance',
        'architecture',
        'error_handling',
        'code_quality',
        'regression',
        'compliance',
      ],
    },
  },
  required: ['file', 'line', 'severity', 'description', 'category'],
};

const ROUND_RESULT = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: FINDING },
  },
  required: ['findings'],
};

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['refuted', 'reason'],
};

const PR_INFO = {
  type: 'object',
  properties: {
    eligible: { type: 'boolean' },
    prNumber: { type: 'number' },
    title: { type: 'string' },
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['eligible', 'files', 'reason'],
};

// --- Helpers ------------------------------------------------------------

// Dedup by file + normalized line (nearest 5) to catch off-by-one
// differences across different agents and rounds.
function dedupKey(f) {
  var nl = Math.floor((f.line || 0) / 5) * 5;
  return f.file + ':' + nl;
}

// --- Main ---------------------------------------------------------------

var prId = args && (args.pr || args.branch);

// --- Phase 1: Prepare ---------------------------------------------------
phase('Prepare');
log('Preparing review for ' + (prId ? 'PR #' + prId : 'current branch') + '...');

var prInfo = await agent(
  'You are a PR preparation agent.\n' +
    '\n' +
    'Your task:\n' +
    '1. If a PR identifier is given, check if the PR is eligible -- it must be open, not a draft.\n' +
    '2. Get the PR summary and diff, OR if no PR is given, get the git diff for the current branch.\n' +
    '3. List all changed files.\n' +
    '\n' +
    'PR identifier: ' +
    (prId || 'none') +
    '\n' +
    'If a PR identifier is given, use "gh pr view ' +
    (prId || '') +
    '" and "gh pr diff ' +
    (prId || '') +
    '".\n' +
    'If NO PR identifier is given, use "git diff main..." to get the diff and "git diff --name-only main..." for file list.\n' +
    'For a branch review without a PR, set eligible: true, prNumber: null, and files from the git diff.\n' +
    '\n' +
    'Return a JSON object with:\n' +
    '- eligible: boolean -- is this reviewable?\n' +
    '- prNumber: number or null\n' +
    '- title: string -- PR title or branch name\n' +
    '- summary: string -- description or "Branch: <name>"\n' +
    '- files: array of strings -- changed file paths\n' +
    '- reason: string -- if not eligible, explain why; otherwise "OK"',
  {
    schema: PR_INFO,
    label: 'pr-info',
    phase: 'Prepare',
  },
);

if (!prInfo || !prInfo.eligible) {
  log('PR not eligible: ' + (prInfo ? prInfo.reason : 'unknown error'));
  return {
    findings: [],
    summary: {
      prNumber: prInfo ? prInfo.prNumber : null,
      error: prInfo ? prInfo.reason : 'PR not eligible',
    },
  };
}

log(
  'Reviewing: ' +
    (prInfo.title || 'PR #' + prInfo.prNumber) +
    ' (' +
    prInfo.files.length +
    ' files)',
);

// --- Phase 2: Review Pass (N rounds, loop-until-dry) --------------------
phase('Review');
log('Starting review passes...');

var seen = {};
var allFindings = [];
var dryCount = 0;
var MAX_ROUNDS = 3;
var DRY_LIMIT = 2;
var prIdStr = prId || '';

// 8 review lenses per round, 3 rounds with different focus areas.
var ROUND_LENSES = [
  // Round 1: Security, correctness, robustness
  [
    {
      role: 'Security',
      focus:
        'security vulnerabilities, hardcoded secrets, injection flaws, auth issues, unsafe data handling',
    },
    {
      role: 'Logic Bugs',
      focus:
        'logical errors, incorrect conditions, off-by-one, null pointer risks, incorrect algorithms',
    },
    {
      role: 'Concurrency',
      focus: 'race conditions, deadlocks, async/await issues, shared state, thread safety',
    },
    {
      role: 'Error Handling',
      focus:
        'missing error handling, swallowed exceptions, incorrect error propagation, missing validation',
    },
    {
      role: 'Type Safety',
      focus:
        'type safety issues, incorrect type assertions, missing type guards, API contract violations',
    },
    {
      role: 'Data Flow',
      focus: 'incorrect data transformations, data loss, incorrect state mutations, side effects',
    },
    {
      role: 'Edge Cases',
      focus: 'edge cases, boundary conditions, empty states, null/undefined, unexpected inputs',
    },
    {
      role: 'Dependency',
      focus: 'incorrect imports, dependency misuse, library API misuse, breaking API changes',
    },
  ],
  // Round 2: Architecture, performance, regression
  [
    {
      role: 'Architecture',
      focus:
        'architectural violations, broken abstractions, tight coupling, separation of concerns',
    },
    {
      role: 'Performance',
      focus:
        'performance issues, unnecessary allocations, N+1 queries, memory leaks, inefficient algorithms',
    },
    {
      role: 'Regression',
      focus:
        'git blame/history -- check if changes reintroduce old bugs or contradict past PR comments',
    },
    {
      role: 'Compliance',
      focus: 'compliance with CLAUDE.md, project conventions, coding standards, restricted imports',
    },
    {
      role: 'Testability',
      focus:
        'testability concerns -- untestable code paths, missing test hooks, tightly coupled logic',
    },
    {
      role: 'Migration',
      focus:
        'backward compatibility issues, breaking changes, old-data/new-data transition hazards',
    },
    {
      role: 'Resource Mgmt',
      focus:
        'resource leaks (file handles, connections, memory), improper cleanup, missing disposals',
    },
    {
      role: 'Observability',
      focus:
        'insufficient logging, overly verbose logging, logging of sensitive data, missing metrics',
    },
  ],
  // Round 3: Code quality, business logic, consistency
  [
    {
      role: 'Code Quality',
      focus:
        'code smells, duplication, overly complex logic, readability issues (real problems, not style)',
    },
    {
      role: 'Business Logic',
      focus: 'correctness of business rules, domain logic errors, incorrect assumptions about data',
    },
    {
      role: 'State Management',
      focus:
        'incorrect state transitions, stale state, race conditions in state updates, missing resets',
    },
    {
      role: 'Timing',
      focus:
        'timing issues, race windows, incorrect timeout handling, debouncing/throttling problems',
    },
    {
      role: 'Configuration',
      focus: 'hardcoded configuration, environment-specific values, incorrect config handling',
    },
    {
      role: 'Validation',
      focus: 'missing input validation, incorrect sanitization, bypassable checks, auth bypass',
    },
    {
      role: 'Debugging',
      focus: 'leftover debug code, console.log, TODO comments, commented-out code, dead code',
    },
    {
      role: 'Consistency',
      focus:
        'inconsistencies with surrounding code, naming convention violations, API style mismatches',
    },
  ],
];

for (var round = 0; round < MAX_ROUNDS; round++) {
  log('Round ' + (round + 1) + '/' + MAX_ROUNDS + '...');

  var lenses = ROUND_LENSES[round];
  var results = await parallel(
    lenses.map(function (lens) {
      return function () {
        var cat = lens.role.toLowerCase().replace(/\s+/g, '_');
        return agent(
          'You are a ' +
            lens.role +
            ' reviewer.\n' +
            '\n' +
            'Review the PR diff for: ' +
            lens.focus +
            '\n' +
            '\n' +
            'PR identifier: ' +
            prIdStr +
            '\n' +
            'Changed files: ' +
            prInfo.files.join(', ') +
            '\n' +
            'PR title: ' +
            prInfo.title +
            '\n' +
            'PR summary: ' +
            prInfo.summary +
            '\n' +
            '\n' +
            'Use "gh pr diff ' +
            prIdStr +
            '" to get the diff. If no PR identifier, use "git diff main...".\n' +
            'Focus ONLY on the code changed in this PR -- do NOT flag pre-existing issues in unchanged code.\n' +
            'Return your findings as a JSON object with a "findings" array.\n' +
            'Each finding must have: file (path), line (number), severity (critical|major|minor), description, evidence, category (' +
            cat +
            ').\n' +
            'Return an empty array if no issues found.',
          {
            schema: ROUND_RESULT,
            label: lens.role.toLowerCase().replace(/\s+/g, '-'),
            phase: 'Review',
          },
        );
      };
    }),
  );

  // Collect new findings (dedup by normalized line key)
  var newFindings = [];
  for (var ri = 0; ri < results.length; ri++) {
    var result = results[ri];
    if (!result || !result.findings) continue;
    for (var fi = 0; fi < result.findings.length; fi++) {
      var f = result.findings[fi];
      var key = dedupKey(f);
      if (!seen[key]) {
        seen[key] = true;
        newFindings.push(f);
      }
    }
  }

  var rawCount = 0;
  for (var ri2 = 0; ri2 < results.length; ri2++) {
    if (results[ri2] && results[ri2].findings) {
      rawCount += results[ri2].findings.length;
    }
  }
  log('Round ' + (round + 1) + ': ' + newFindings.length + ' new findings (' + rawCount + ' raw)');

  if (newFindings.length > 0) {
    for (var nfi = 0; nfi < newFindings.length; nfi++) {
      allFindings.push({ finding: newFindings[nfi], round: round });
    }
    dryCount = 0;
  } else {
    dryCount++;
    log('Dry round ' + dryCount + '/' + DRY_LIMIT);
    if (dryCount >= DRY_LIMIT) {
      log('2 consecutive dry rounds -- stopping early');
      break;
    }
  }
}

log('Total unique findings before verification: ' + allFindings.length);

if (allFindings.length === 0) {
  log('No findings -- skipping verification and synthesis');
  return {
    findings: [],
    summary: {
      prNumber: prInfo.prNumber,
      prTitle: prInfo.title,
      totalFiles: prInfo.files.length,
      affectedFiles: 0,
      totalFindings: 0,
      bySeverity: { critical: 0, major: 0, minor: 0 },
      byCategory: {},
      verdictStats: { confirmed: 0, rejected: 0 },
    },
  };
}

// --- Phase 3: Verify (3 judges per finding, re-verify critical) ---------
phase('Verify');
log('Verifying ' + allFindings.length + ' findings (3 judges each)...');

var verifiedFindings = await pipeline(
  allFindings,
  // Stage 1: 3 parallel judges per finding with different stances
  function (item) {
    var f = item.finding;

    // Judge 1: Neutral verifier (default: not refuted)
    var j1 =
      'You are a CODE VERIFIER. Determine if this finding is real or false positive.\n' +
      'Finding:\n' +
      '- File: ' +
      f.file +
      '\n' +
      '- Line: ' +
      f.line +
      '\n' +
      '- Severity: ' +
      f.severity +
      '\n' +
      '- Category: ' +
      f.category +
      '\n' +
      '- Description: ' +
      f.description +
      '\n' +
      '- Evidence: ' +
      f.evidence +
      '\n' +
      '\nPR: ' +
      prIdStr +
      '\nTitle: ' +
      prInfo.title +
      '\n\n' +
      'Use "gh pr diff ' +
      prIdStr +
      '" to re-examine. If no PR id, use "git diff main...".\n' +
      'Default: refuted=false. Only refute if clearly proven false positive.';

    // Judge 2: Neutral verifier (same stance, independent call)
    var j2 =
      'You are a CODE VERIFIER. Determine if this finding is real or false positive.\n' +
      'Finding:\n' +
      '- File: ' +
      f.file +
      '\n' +
      '- Line: ' +
      f.line +
      '\n' +
      '- Severity: ' +
      f.severity +
      '\n' +
      '- Category: ' +
      f.category +
      '\n' +
      '- Description: ' +
      f.description +
      '\n' +
      '- Evidence: ' +
      f.evidence +
      '\n' +
      '\nPR: ' +
      prIdStr +
      '\nTitle: ' +
      prInfo.title +
      '\n\n' +
      'Use "gh pr diff ' +
      prIdStr +
      '" to re-examine. If no PR id, use "git diff main...".\n' +
      'Default: refuted=false. Only refute if clearly proven false positive.';

    // Judge 3: Skeptical verifier (default: refuted, to catch false positives)
    var j3 =
      'You are a SKEPTICAL VERIFIER. Catch FALSE POSITIVES.\n' +
      'Finding:\n' +
      '- File: ' +
      f.file +
      '\n' +
      '- Line: ' +
      f.line +
      '\n' +
      '- Severity: ' +
      f.severity +
      '\n' +
      '- Category: ' +
      f.category +
      '\n' +
      '- Description: ' +
      f.description +
      '\n' +
      '- Evidence: ' +
      f.evidence +
      '\n' +
      '\nPR: ' +
      prIdStr +
      '\nTitle: ' +
      prInfo.title +
      '\n\n' +
      'Use "gh pr diff ' +
      prIdStr +
      '" to re-examine. If no PR id, use "git diff main...".\n' +
      'Default: refuted=true if uncertain. Only set refuted=false if highly confident this is a real bug.';

    return parallel([
      function () {
        return agent(j1, {
          schema: VERDICT,
          label: 'j1:' + f.file + ':' + f.line,
          phase: 'Verify',
        });
      },
      function () {
        return agent(j2, {
          schema: VERDICT,
          label: 'j2:' + f.file + ':' + f.line,
          phase: 'Verify',
        });
      },
      function () {
        return agent(j3, {
          schema: VERDICT,
          label: 'j3:' + f.file + ':' + f.line,
          phase: 'Verify',
        });
      },
    ]);
  },
  // Stage 2: Adjudicate -- majority vote
  function (verdicts, item) {
    var valid = [];
    for (var vi = 0; vi < verdicts.length; vi++) {
      if (verdicts[vi]) valid.push(verdicts[vi]);
    }
    var refutedCount = 0;
    for (var vi2 = 0; vi2 < valid.length; vi2++) {
      if (valid[vi2].refuted) refutedCount++;
    }
    var notRefutedCount = valid.length - refutedCount;
    // Keep if >=2/3 judges did NOT refute (majority say it's real)
    // With 2 neutral + 1 skeptical: both neutrals must agree, or skeptic must also be convinced
    var confirmed = valid.length >= 2 && notRefutedCount >= 2;
    var result = {};
    for (var k in item.finding) {
      if (item.finding.hasOwnProperty(k)) result[k] = item.finding[k];
    }
    result.verified = confirmed;
    result.votes = { refuted: refutedCount, notRefuted: notRefutedCount, total: valid.length };
    return result;
  },
);

var confirmedFindings = [];
var rejectedFindings = [];
for (var vi3 = 0; vi3 < verifiedFindings.length; vi3++) {
  var vf = verifiedFindings[vi3];
  if (vf && vf.verified) {
    confirmedFindings.push(vf);
  } else if (vf) {
    rejectedFindings.push(vf);
  }
}

log(
  'Initial verification: ' +
    confirmedFindings.length +
    ' confirmed, ' +
    rejectedFindings.length +
    ' rejected',
);

// --- Critical Findings Safeguard ---
// Re-verify rejected CRITICAL findings with a more lenient panel.
// Critical bugs should NEVER be silently dropped by verification.
var criticalRejected = [];
var otherRejected = [];
for (var vi4 = 0; vi4 < rejectedFindings.length; vi4++) {
  var rf = rejectedFindings[vi4];
  if (rf.severity === 'critical') {
    criticalRejected.push(rf);
  } else {
    otherRejected.push(rf);
  }
}

if (criticalRejected.length > 0) {
  log(
    'CRITICAL SAFEGUARD: Re-verifying ' +
      criticalRejected.length +
      ' rejected critical findings...',
  );
  var reVerified = await pipeline(
    criticalRejected,
    function (item) {
      var f = item;
      var p =
        'You are a CRITICAL-FINDING VERIFIER. This finding was flagged CRITICAL but initially rejected.\n' +
        'Double-check carefully -- critical bugs can cause data loss, security breaches, or outages.\n' +
        'Finding:\n' +
        '- File: ' +
        f.file +
        '\n' +
        '- Line: ' +
        f.line +
        '\n' +
        '- Severity: ' +
        f.severity +
        '\n' +
        '- Category: ' +
        f.category +
        '\n' +
        '- Description: ' +
        f.description +
        '\n' +
        '- Evidence: ' +
        f.evidence +
        '\n' +
        '\nPR: ' +
        prIdStr +
        '\n\n' +
        'Use "gh pr diff ' +
        prIdStr +
        '" to re-examine. If no PR id, use "git diff main...".\n' +
        'Default: refuted=false. Only refute if ABSOLUTELY CERTAIN this is a false positive.\n' +
        'Better to keep a false positive than to miss a critical bug.';
      return parallel([
        function () {
          return agent(p, {
            schema: VERDICT,
            label: 'cr-j1:' + f.file + ':' + f.line,
            phase: 'Verify',
          });
        },
        function () {
          return agent(p, {
            schema: VERDICT,
            label: 'cr-j2:' + f.file + ':' + f.line,
            phase: 'Verify',
          });
        },
        function () {
          return agent(p, {
            schema: VERDICT,
            label: 'cr-j3:' + f.file + ':' + f.line,
            phase: 'Verify',
          });
        },
      ]);
    },
    function (verdicts, item) {
      var valid = [];
      for (var vi = 0; vi < verdicts.length; vi++) {
        if (verdicts[vi]) valid.push(verdicts[vi]);
      }
      var refutedCount = 0;
      for (var vi2 = 0; vi2 < valid.length; vi2++) {
        if (valid[vi2].refuted) refutedCount++;
      }
      var notRefutedCount = valid.length - refutedCount;
      // Critical findings: keep if ANY 1 judge did NOT refute
      var confirmed = notRefutedCount >= 1;
      var result = {};
      for (var k in item) {
        if (item.hasOwnProperty(k)) result[k] = item[k];
      }
      result.verified = confirmed;
      result.votes = { refuted: refutedCount, notRefuted: notRefutedCount, total: valid.length };
      result.reVerified = true;
      return result;
    },
  );
  for (var rvi = 0; rvi < reVerified.length; rvi++) {
    var rv = reVerified[rvi];
    if (rv && rv.verified) {
      confirmedFindings.push(rv);
      log('  RE-CONFIRMED: ' + rv.file + ':' + rv.line + ' -- ' + rv.description);
    } else if (rv) {
      otherRejected.push(rv);
      log('  STILL REJECTED: ' + rv.file + ':' + rv.line + ' -- ' + rv.description);
    }
  }
  rejectedFindings = otherRejected;
  log(
    'After safeguard: ' +
      confirmedFindings.length +
      ' confirmed, ' +
      rejectedFindings.length +
      ' rejected',
  );
}

// --- Phase 4: Synthesize -------------------------------------------------
phase('Synthesize');
log('Synthesizing results...');

// Final dedup by file+line normalized (ignore category)
var finalDedup = {};
var severityRank = { critical: 3, major: 2, minor: 1 };
for (var cfi = 0; cfi < confirmedFindings.length; cfi++) {
  var f2 = confirmedFindings[cfi];
  var key = f2.file + ':' + Math.floor((f2.line || 0) / 5) * 5;
  var existing = finalDedup[key];
  if (!existing) {
    finalDedup[key] = f2;
  } else {
    if (severityRank[f2.severity] > severityRank[existing.severity]) {
      finalDedup[key] = f2;
    }
    if (f2.reVerified && !existing.reVerified) {
      finalDedup[key] = f2;
    }
  }
}

var finalFindings = [];
for (var k2 in finalDedup) {
  if (finalDedup.hasOwnProperty(k2)) {
    finalFindings.push(finalDedup[k2]);
  }
}

// Classify by severity and category
var bySeverity = { critical: [], major: [], minor: [] };
var byCategory = {};
var affectedFilesMap = {};
for (var ffi = 0; ffi < finalFindings.length; ffi++) {
  var f3 = finalFindings[ffi];
  if (bySeverity[f3.severity]) bySeverity[f3.severity].push(f3);
  byCategory[f3.category] = (byCategory[f3.category] || 0) + 1;
  affectedFilesMap[f3.file] = true;
}
var affectedFilesArr = [];
for (var fk in affectedFilesMap) {
  if (affectedFilesMap.hasOwnProperty(fk)) affectedFilesArr.push(fk);
}

// Build report
log('');
log('=== THOROUGH REVIEW REPORT ===');
log('PR: ' + (prInfo.title || '#' + prInfo.prNumber));
log('Files changed: ' + prInfo.files.length + ' | Files with issues: ' + affectedFilesArr.length);
log(
  'Review rounds: ' +
    Math.min(ROUND_LENSES.length, MAX_ROUNDS) +
    ' (' +
    (dryCount >= DRY_LIMIT ? 'stopped early' : 'completed') +
    ')',
);
log('');
log('Total confirmed findings: ' + finalFindings.length);
log('  Critical: ' + bySeverity.critical.length);
log('  Major: ' + bySeverity.major.length);
log('  Minor: ' + bySeverity.minor.length);
log('');
log('By category:');
var catEntries = [];
for (var ck in byCategory) {
  if (byCategory.hasOwnProperty(ck)) catEntries.push([ck, byCategory[ck]]);
}
catEntries.sort(function (a, b) {
  return b[1] - a[1];
});
for (var cei = 0; cei < catEntries.length; cei++) {
  log('  ' + catEntries[cei][0] + ': ' + catEntries[cei][1]);
}
log('');
if (bySeverity.critical.length > 0) {
  log('--- CRITICAL ---');
  for (var cri = 0; cri < bySeverity.critical.length; cri++) {
    var cf = bySeverity.critical[cri];
    log('  ' + cf.file + ':' + cf.line + ' -- ' + cf.description);
    log('    Evidence: ' + cf.evidence);
    if (cf.reVerified) log('    [Re-verified after initial rejection]');
  }
  log('');
}
if (bySeverity.major.length > 0) {
  log('--- MAJOR ---');
  for (var mai = 0; mai < bySeverity.major.length; mai++) {
    var mf = bySeverity.major[mai];
    log('  ' + mf.file + ':' + mf.line + ' -- ' + mf.description + ' [' + mf.category + ']');
  }
  log('');
}
if (bySeverity.minor.length > 0) {
  log('--- MINOR ---');
  for (var mii = 0; mii < bySeverity.minor.length; mii++) {
    var mif = bySeverity.minor[mii];
    log('  ' + mif.file + ':' + mif.line + ' -- ' + mif.description + ' [' + mif.category + ']');
  }
}

return {
  findings: finalFindings,
  summary: {
    prNumber: prInfo.prNumber,
    prTitle: prInfo.title,
    totalFiles: prInfo.files.length,
    affectedFiles: affectedFilesArr.length,
    totalFindings: finalFindings.length,
    bySeverity: {
      critical: bySeverity.critical.length,
      major: bySeverity.major.length,
      minor: bySeverity.minor.length,
    },
    byCategory: byCategory,
    verdictStats: { confirmed: confirmedFindings.length, rejected: rejectedFindings.length },
  },
};
