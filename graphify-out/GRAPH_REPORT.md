# Graph Report - harness-human-attention-infrastructure  (2026-09-26)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 5793 nodes · 13605 edges · 230 communities (202 shown, 28 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 152 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6f750db2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 192
- Community 193
- Community 194
- Community 195
- Community 196
- Community 197
- Community 198
- Community 199
- Community 200
- Community 201
- Community 202
- Community 203
- Community 204
- Community 205
- Community 206
- Community 207
- Community 208
- Community 209
- Community 210
- Community 211
- Community 212
- Community 213
- Community 214
- Community 215
- Community 216
- Community 217
- Community 218
- Community 219
- Community 220
- Community 221
- Community 222
- Community 223
- Community 224
- Community 225

## God Nodes (most connected - your core abstractions)
1. `TaskID` - 47 edges
2. `glyph()` - 41 edges
3. `newBrandedId()` - 32 edges
4. `typescript` - 28 edges
5. `scripts` - 28 edges
6. `../../tsconfig.base.json` - 27 edges
7. `GitProviderError` - 26 edges
8. `buildApp()` - 24 edges
9. `@types/node` - 24 edges
10. `fastify` - 23 edges

## Surprising Connections (you probably didn't know these)
- `ReRankInput` --references--> `RetrievedDoc`  [EXTRACTED]
  packages/context-engine/src/ranking/re-ranker.ts → packages/context-engine/src/retrieval/retriever.ts
- `TaskFailedPayload` --references--> `TaskID`  [EXTRACTED]
  packages/domain/src/events/task-events.ts → packages/domain/src/ids.ts
- `AttentionVariantPair` --references--> `PipelineVariant`  [EXTRACTED]
  packages/evaluation/src/ab/attention-variants.ts → packages/evaluation/src/harness/variant.ts
- `ArtifactMergedPayload` --references--> `TaskID`  [EXTRACTED]
  packages/domain/src/events/artifact-events.ts → packages/domain/src/ids.ts
- `buildApp()` --indirect_call--> `checkReviewRateLimit()`  [INFERRED]
  apps/api/src/app.ts → apps/api/src/rate-limit.ts

## Import Cycles
- None detected.

## Communities (230 total, 28 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (124): buildApp(), startRateLimitPruner(), stopRateLimitPruner(), fastify, FastifyRequest, randomToken(), readCookie(), registerAuthHook() (+116 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (109): main(), NOW, REPO_ROOT, REVIEWER, SEED, SeedItem, seedReviewer(), Seed (+101 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (105): ROOT, packages_db_dist_index_verificationcheckresults, packages_db_dist_index_verificationtestresults, packages_domain_dist_index_newverificationrequestid, packages_domain_dist_index_newverificationresultid, packages_domain_dist_index_verificationcompletedpayload, packages_domain_dist_index_verificationresultid, packages_domain_dist_index_verificationstatus (+97 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (86): app, bus, container, initApiTracing(), LoopCompletedRow, recentLearningCycles(), registerLearningRoutes(), orphanedTaskCount() (+78 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (26): AwsS3ClientPort, S3ClientPortConfig, ContentBackend, ContentIntegrityError, ContentRef, ContentStore, ObjectStoreUnavailableError, PutMeta (+18 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (74): PriorityLevel, ReviewDecision, ReviewListSummary, ReviewsListItem, AlertTriangle(), ArrowLeft(), ArrowRight(), ArrowUpDown() (+66 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (35): assert(), main(), makeEvent(), packages_domain_dist_index_eventenvelope, packages_domain_dist_index_newworkflowid, packages_domain_dist_index_priority, packages_domain_dist_index_taskcreatedpayload, packages_event_bus_dist_index_inmemorystreamtransport (+27 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (29): AccessTokenClaims, AuthConfig, AuthService, DEFAULT_TOKEN_TTL_MS, toUser(), AuthError, ForbiddenError, InvalidTokenError (+21 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (53): FixSuggestion, PrFile, RecalledMemory, ReviewSeverity, TriageRuleId, ACTIONABLE, BreakdownTab(), CATEGORY_LABEL (+45 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (39): packages_domain_dist_index_reviewerid, packages_review_src_index_missingrationaleerror, packages_review_src_index_queueconflicterror, packages_review_src_index_queueitemnotfounderror, packages_review_src_index_queuestateerror, packages_review_src_index_reviewerror, packages_review_src_index_reviewservice, factorValue() (+31 more)

### Community 10 - "Community 10"
Cohesion: 0.07
Nodes (30): packages_domain_dist_index_issue, packages_domain_dist_index_ticketprovidertype, packages_mcp_dist_index, packages_mcp_dist_index_toolresult, adfToPlainText(), collectTextLeaves(), JiraIssuePayload, mapJiraIssue() (+22 more)

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (51): attentionThresholds, contextSourceEmbeddings, agentRunStatuses, aiProviderTypes, artifactStatuses, changeStatuses, checkStatusCheck, checkStatuses (+43 more)

### Community 12 - "Community 12"
Cohesion: 0.07
Nodes (29): main(), makeEmbedder(), parseBatchSize(), readEmbeddingRows(), Embedder, EmbeddingUnavailableError, EmbedError, EmbedQueryResult (+21 more)

### Community 13 - "Community 13"
Cohesion: 0.03
Nodes (59): buildRawLLMProvider(), ENGINE_STUB_TOKENS, loadMockScript(), packages_agent_runtime_dist_index_anthropicprovider, packages_agent_runtime_dist_index_llmprovider, packages_agent_runtime_dist_index_loggingllmprovider, packages_agent_runtime_dist_index_mockscript, packages_agent_runtime_dist_index_openaicompatibleprovider (+51 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (28): assert(), gitDecision(), jiraDecision(), main(), MemoryWritebackLogStore, onService(), RecordingClient, registryOf() (+20 more)

### Community 15 - "Community 15"
Cohesion: 0.07
Nodes (25): packages_domain_dist_index_writebackaction, packages_domain_dist_index_writebackprovider, packages_git_provider_dist_index_githost, packages_git_provider_dist_index_gittoolmap, packages_git_provider_dist_index_parserepopath, packages_ticket_provider_dist_index_ticketsystem, packages_ticket_provider_dist_index_tickettoolmap, dedupKey() (+17 more)

### Community 16 - "Community 16"
Cohesion: 0.06
Nodes (35): AnchorStatus, FindingAnchor, json(), JudgeRun, LlmCall, post(), PullRequestCheck, PullRequestCheckStatus (+27 more)

### Community 17 - "Community 17"
Cohesion: 0.07
Nodes (48): RFC-9562, AssessmentFeedbackID, Brand, ClaimID, JudgeAgreementID, newAgentRunID(), newArtifactID(), newAssessmentFeedbackID() (+40 more)

### Community 18 - "Community 18"
Cohesion: 0.08
Nodes (30): packages_domain_dist_index_pullrequest, cloneAndCheckout(), CloneError, CloneOptions, cloneUrlFor(), defaultRunGit(), firstLine(), GitRunResult (+22 more)

### Community 19 - "Community 19"
Cohesion: 0.06
Nodes (41): nonNegativeInt(), FormatRejectCommentOptions, formatRejectWritebackBody(), RejectFindingItem, RejectSuggestionItem, ListPayloadSummary, prFilePathsFromPayload(), priorityFromRiskScore() (+33 more)

### Community 20 - "Community 20"
Cohesion: 0.07
Nodes (29): packages_domain_dist_index_memoryentry, packages_domain_dist_index_reviewdecisionsubmittedpayload, packages_domain_dist_index_reviewdecisiontype, packages_domain_dist_index_reviewseverity, packages_domain_dist_index_reviewverdict, resolveChainHeads(), DecisionDistillInput, DistilledMemory (+21 more)

### Community 21 - "Community 21"
Cohesion: 0.08
Nodes (40): db, packages_db_dist_index_createdb, packages_domain_dist_index_attentionitemroutedpayload, CliArgs, ClosableDb, main(), parseArgs(), DEFECT_STATES (+32 more)

### Community 22 - "Community 22"
Cohesion: 0.09
Nodes (29): packages_db_dist_index_taskstatehistory, packages_domain_dist_index_eventid, packages_domain_dist_index_taskid, packages_domain_dist_index_taskstatechangedpayload, packages_domain_dist_index_tasktrigger, IllegalTransitionError, MissingRationaleError, StateConflictError (+21 more)

### Community 23 - "Community 23"
Cohesion: 0.07
Nodes (28): cap(), DOCKER_INFRA_EXIT_CODES, DockerSandbox, DockerSandboxOptions, SandboxInfraError, SandboxTimeoutError, BUILD_CONTEXT, DOCKERFILE (+20 more)

### Community 24 - "Community 24"
Cohesion: 0.06
Nodes (32): dependencies, @harness/domain, pino, devDependencies, @types/node, typescript, vitest, exports (+24 more)

### Community 25 - "Community 25"
Cohesion: 0.06
Nodes (30): packages_db_dist_index_evidence, packages_db_dist_index_evidencelinks, packages_domain_dist_index_evidenceid, packages_domain_dist_index_memoryarchivedpayload, packages_domain_dist_index_memoryconsolidatedpayload, packages_domain_dist_index_memoryentrycreatedpayload, packages_domain_dist_index_memoryid, packages_domain_dist_index_memorykind (+22 more)

### Community 26 - "Community 26"
Cohesion: 0.07
Nodes (29): packages_domain_dist_index_aiprovidertype, packages_domain_dist_index_createfixsuggestion, packages_domain_dist_index_createreviewfinding, packages_domain_dist_index_createreviewreport, packages_domain_dist_index_judgerunstore, packages_domain_dist_index_newjudgerunid, packages_domain_dist_index_newreviewreportid, packages_domain_dist_index_reviewfinding (+21 more)

### Community 27 - "Community 27"
Cohesion: 0.06
Nodes (29): packages_context_engine_src_index_kendalltau, packages_context_engine_src_index_keyworddependencyranker, packages_context_engine_src_index_semanticranker, packages_context_engine_src_index_sha256, packages_context_engine_src_index_tiktokentokenizer, kendallTau(), SEMANTIC_RANK_METHOD, ShadowComparisonInput (+21 more)

### Community 28 - "Community 28"
Cohesion: 0.10
Nodes (37): packages_db_dist_index_abexperiments, packages_db_dist_index_abruns, packages_db_dist_index_abstore, packages_db_dist_index_asreadonlydb, BASELINE, ClosableDb, DEP_HEAVY, main() (+29 more)

### Community 29 - "Community 29"
Cohesion: 0.07
Nodes (26): artifacts, assessmentFeedback, assessments, autoApproveKillSwitch, reviewExamples, calibrationDatasets, calibrationRows, calibrationWeights (+18 more)

### Community 30 - "Community 30"
Cohesion: 0.10
Nodes (26): CollectedFile, EXCLUDED_DIRS, EXCLUDED_SUFFIXES, LOCKFILE_NAMES, MAX_FILE_SIZE_BYTES, ContextEngine, checkFreshness(), Freshness (+18 more)

### Community 31 - "Community 31"
Cohesion: 0.07
Nodes (26): packages_db_dist_index_evaluationreports, buildAndPersist(), CliArgs, ClosableDb, main(), parseArgs(), sourceVersion(), EvaluationReport (+18 more)

### Community 32 - "Community 32"
Cohesion: 0.08
Nodes (25): HybridRetriever, DEFAULT_VARIANT_COUNT, LLMQueryRewriter, MAX_VARIANT_COUNT, parseVariants(), QueryRewriter, REWRITE_TIMEOUT_MS, withTimeout() (+17 more)

### Community 33 - "Community 33"
Cohesion: 0.11
Nodes (35): packages_db_dist_index_abrunreport, ArmReport, ClosableDb, DEFAULT_TOP_K, fmt(), loadDotenv(), loadFixtures(), loadStoredResult() (+27 more)

### Community 34 - "Community 34"
Cohesion: 0.08
Nodes (22): AbOutcomeSignals, AbRecommendation, AbRunReport, AbStore, CreateExperimentInput, RecordRunInput, createDb(), DrizzleDB (+14 more)

### Community 35 - "Community 35"
Cohesion: 0.09
Nodes (30): loadReviewExamples(), normalizeRow(), computeGoldAgreement(), evaluateJudgeAgainstGold(), GoldAgreement, JudgedExample, JudgeScorer, JudgeVsGoldResult (+22 more)

### Community 36 - "Community 36"
Cohesion: 0.12
Nodes (37): ReconstructedDecision, ReconstructedEvent, ReconstructedRun, ReconstructedVerification, cacheHit, cacheMiss, gauges, InfraAccumulator (+29 more)

### Community 37 - "Community 37"
Cohesion: 0.07
Nodes (14): AutoApproveExecutor, AutoApproveExecutorDeps, AutoApproveLoader, AutoApproveTaskTransition, DbAutoApproveLoader, AutoApproveGate, AutoApproveGateConfig, AutoApproveGateInput (+6 more)

### Community 38 - "Community 38"
Cohesion: 0.10
Nodes (31): affectedTests(), AffectedTestsResult, buildGraph(), DependencyGraph, Edge, ASSET_EXTENSIONS, CLAUSE_KEYWORDS, CODE_EXTENSIONS (+23 more)

### Community 39 - "Community 39"
Cohesion: 0.09
Nodes (26): Chain, packages_db_src_schema_index_agentruns, packages_db_src_schema_index_artifacts, packages_db_src_schema_index_changes, packages_db_src_schema_index_judgeagreements, packages_db_src_schema_index_judgeruns, packages_db_src_schema_index_reviewdecisions, packages_db_src_schema_index_reviewreports (+18 more)

### Community 40 - "Community 40"
Cohesion: 0.06
Nodes (31): assert(), describeOrder(), main(), noopLogger, QUERY, stubRewriter, stubSemanticSource, assert() (+23 more)

### Community 41 - "Community 41"
Cohesion: 0.07
Nodes (30): IntegrationWritebackCompletedPayload, ProviderConfigID, WritebackID, Issue, ProviderConfig, ProviderKind, PullRequest, PullRequestCheck (+22 more)

### Community 42 - "Community 42"
Cohesion: 0.10
Nodes (25): DecideInput, DecisionChoice, EvidenceRecord, FactorScore, get(), json(), post(), QueueItemDetail (+17 more)

### Community 43 - "Community 43"
Cohesion: 0.12
Nodes (23): CalibrationJob, Clock, DEFAULT_LEARNING_FIT_CONFIG, PromotionSeam, buildLearningWindow(), incumbentFeatures(), judgeDisagreement(), judgeFeatures() (+15 more)

### Community 44 - "Community 44"
Cohesion: 0.11
Nodes (16): LexicalRetriever, matchedByOf(), MatchedBy, MatchLayer, RetrievalDocument, RetrievalQuery, RetrievedDoc, reciprocalRankFusion() (+8 more)

### Community 45 - "Community 45"
Cohesion: 0.08
Nodes (32): AgentExecutionRequest, AgentExecutionStatus, AgentRun, AgentRunStatus, AgentType, CreateAgentExecutionRequestInput, DEFAULT_MAX_STEPS, ModelConfig (+24 more)

### Community 46 - "Community 46"
Cohesion: 0.09
Nodes (31): Artifact, ArtifactSnapshot, ArtifactStatus, ArtifactType, Change, ChangeStatus, createArtifact(), CreateArtifactInput (+23 more)

### Community 47 - "Community 47"
Cohesion: 0.12
Nodes (26): packages_db_dist_index_calibrationdatasets, packages_db_dist_index_calibrationrows, computeCoverage(), CoverageReport, NULL_SHARE_THRESHOLD, AssessmentRecord, buildCalibrationRows(), CalibrationInput (+18 more)

### Community 48 - "Community 48"
Cohesion: 0.13
Nodes (16): packages_domain_dist_index_gitprovidertype, packages_domain_dist_index_pullrequestcheck, packages_domain_dist_index_pullrequestcheckstatus, packages_domain_dist_index_pullrequestcommit, FetchPullRequestInput, parseRepoPath(), GithubPrFilePayload, GithubPullPayload (+8 more)

### Community 49 - "Community 49"
Cohesion: 0.08
Nodes (32): packages_domain_src_index_agentrunstatus, packages_domain_src_index_artifactstatus, packages_domain_src_index_changestatus, packages_domain_src_index_contextsourcetype, packages_domain_src_index_createartifact, packages_domain_src_index_createattentionassessment, packages_domain_src_index_createchange, packages_domain_src_index_createcontextsnapshot (+24 more)

### Community 50 - "Community 50"
Cohesion: 0.06
Nodes (32): dotenv, dependencies, drizzle-orm, @harness/domain, @harness/event-bus, postgres, devDependencies, dotenv (+24 more)

### Community 51 - "Community 51"
Cohesion: 0.09
Nodes (25): buildRegistry(), FORGE_STUB, FORGE_URLS, isLive(), main(), printIssue(), printPr(), REPO_ROOT (+17 more)

### Community 52 - "Community 52"
Cohesion: 0.06
Nodes (31): dependencies, react, react-dom, react-router-dom, @tanstack/react-query, devDependencies, jsdom, @testing-library/jest-dom (+23 more)

### Community 53 - "Community 53"
Cohesion: 0.09
Nodes (24): envInt(), canonicalHost(), getOrCreateProject(), parseGithubPrUrl(), resolveReportTaskId(), retryTransient(), ReviewIngestDeps, ReviewIngestError (+16 more)

### Community 54 - "Community 54"
Cohesion: 0.13
Nodes (23): auditApi, AuditEntry, AuditFilters, AuditKind, AuditPage, KIND_FILTERS, KIND_LABEL, kindClass() (+15 more)

### Community 55 - "Community 55"
Cohesion: 0.14
Nodes (18): packages_domain_dist_index_agentrun, packages_domain_dist_index_trajectorystep, ReplayDivergenceError, TrajectoryHashMismatchError, canonicalStep(), hashSteps(), stable(), stableStringify() (+10 more)

### Community 56 - "Community 56"
Cohesion: 0.08
Nodes (21): registerMetricsRoutes(), buildApp(), fastify, FastifyRequest, CachedSource, CacheEntryInput, CacheStats, packages_db_dist_index_contextsourcecache (+13 more)

### Community 57 - "Community 57"
Cohesion: 0.09
Nodes (22): ReviewCreatedResult, ReviewsApiError, ReviewVerification, ReviewVerificationStatus, card, duration(), field, shortSha() (+14 more)

### Community 58 - "Community 58"
Cohesion: 0.12
Nodes (23): BY_EXTENSION, BY_FILENAME, languageOfFile(), classifyReviewableFile(), classifySourceFile(), GENERATED_FILENAMES, GENERATED_PATH_PATTERNS, isGeneratedFile() (+15 more)

### Community 59 - "Community 59"
Cohesion: 0.12
Nodes (27): buildCalibrationReport(), BuildCalibrationReportInput, CALIBRATION_AB_METRIC, CalibrationAb, CalibrationDecision, CalibrationReport, CalibrationRunInput, fmt() (+19 more)

### Community 60 - "Community 60"
Cohesion: 0.07
Nodes (29): dependencies, drizzle-orm, fastify, @harness/agent-runtime, @harness/artifact-tracker, @harness/attention-engine, @harness/auth, @harness/benchmark (+21 more)

### Community 61 - "Community 61"
Cohesion: 0.07
Nodes (28): @harness/object-store, dependencies, diff, drizzle-orm, @harness/db, @harness/di, @harness/domain, @harness/event-bus (+20 more)

### Community 62 - "Community 62"
Cohesion: 0.15
Nodes (26): AttentionItemDeferredPayload, IntegrationPrFetchedPayload, IntegrationTicketFetchedPayload, ReviewFixSuggestionCreatedPayload, ReviewReportCreatedPayload, ReviewRequestedPayload, DecisionSubmittedPayload, ReviewDecisionSubmittedPayload (+18 more)

### Community 63 - "Community 63"
Cohesion: 0.07
Nodes (27): @harness/embeddings, dependencies, drizzle-orm, @harness/db, @harness/di, @harness/domain, @harness/embeddings, @harness/event-bus (+19 more)

### Community 64 - "Community 64"
Cohesion: 0.07
Nodes (28): scripts, audit:orphans, benchmark:regression, build, calibration:report, demo:mcp-connectivity, demo:memory, demo:writeback (+20 more)

### Community 65 - "Community 65"
Cohesion: 0.07
Nodes (27): dependencies, diff, drizzle-orm, @harness/db, @harness/di, @harness/domain, @harness/event-bus, @harness/object-store (+19 more)

### Community 66 - "Community 66"
Cohesion: 0.07
Nodes (26): devDependencies, dotenv, tsx, @types/node, typescript, vitest, tsx, vitest (+18 more)

### Community 67 - "Community 67"
Cohesion: 0.07
Nodes (26): drizzle-orm, dependencies, @anthropic-ai/sdk, drizzle-orm, @harness/db, @harness/domain, @harness/event-bus, @harness/observability (+18 more)

### Community 68 - "Community 68"
Cohesion: 0.07
Nodes (26): @harness/sandbox, dependencies, drizzle-orm, @harness/db, @harness/di, @harness/domain, @harness/event-bus, @harness/observability (+18 more)

### Community 69 - "Community 69"
Cohesion: 0.13
Nodes (23): AttentionAssessment, AttentionFactor, AttentionRule, AttentionRuleAction, AttentionScores, createAttentionAssessment(), CreateAttentionAssessmentInput, PriorityLabel (+15 more)

### Community 70 - "Community 70"
Cohesion: 0.09
Nodes (24): assert(), buildFixtureGraph(), delay(), FIXTURE, FULL_TESTS, main(), runners(), section() (+16 more)

### Community 71 - "Community 71"
Cohesion: 0.12
Nodes (18): App(), AppShell(), AppShellLayout(), SHORTCUTS, ActivityPanelProvider(), SystemActivitySidebar(), useActivityPanel(), getInitialTheme() (+10 more)

### Community 72 - "Community 72"
Cohesion: 0.13
Nodes (14): ANTHROPIC_RETRYABLE_STATUSES, AnthropicError, AnthropicProvider, AnthropicProviderOptions, delay(), toAnthropicTool(), packages_agent_runtime_src_llm_llm_provider_llmprovider, isTextBlock() (+6 more)

### Community 73 - "Community 73"
Cohesion: 0.10
Nodes (16): packages_agent_runtime_src_llm_llm_provider_llmrequest, MockLLM, MockScript, mockTextResponse(), REVIEW_PROMPT_VERSION, failingInner(), REQUEST, CONFIG (+8 more)

### Community 74 - "Community 74"
Cohesion: 0.08
Nodes (25): dependencies, drizzle-orm, @harness/db, @harness/di, @harness/domain, @harness/event-bus, jose, devDependencies (+17 more)

### Community 75 - "Community 75"
Cohesion: 0.10
Nodes (16): packages_context_engine_src_index_memorycontextresolver, ContextMemorySectionEntry, MemoryContextResolver, asString(), fenceFor(), memorySection(), renderContextPrompt(), RenderedMemoryEntry (+8 more)

### Community 76 - "Community 76"
Cohesion: 0.08
Nodes (25): dependencies, drizzle-orm, @harness/db, @harness/domain, @harness/event-bus, devDependencies, tsx, @types/node (+17 more)

### Community 77 - "Community 77"
Cohesion: 0.14
Nodes (23): row(), CorrelationCtx, currentCorrelation(), runWithCorrelation(), store, finishedSpan(), activateSpan(), activeSpanContext() (+15 more)

### Community 78 - "Community 78"
Cohesion: 0.15
Nodes (23): ATTENTION_WARRANTED, clampProbability(), FEATURE_KEYS, FeatureKey, fitJudgeWeights(), fitLogistic(), FitSample, fitWeights() (+15 more)

### Community 79 - "Community 79"
Cohesion: 0.10
Nodes (18): InitializeResultSchema, JsonRpcError, JsonRpcErrorSchema, JsonRpcRequest, JsonRpcRequestSchema, JsonRpcResponse, JsonRpcResponseSchema, McpTool (+10 more)

### Community 80 - "Community 80"
Cohesion: 0.11
Nodes (14): agentRuns, contexts, sourceUsefulness, agentRunStatusCheck, reviewQueueStatusCheck, routingActionCheck, taskStateCheck, llmCallLog (+6 more)

### Community 81 - "Community 81"
Cohesion: 0.08
Nodes (24): @harness/db, @harness/judge, dependencies, drizzle-orm, @harness/db, @harness/domain, @harness/judge, devDependencies (+16 more)

### Community 82 - "Community 82"
Cohesion: 0.08
Nodes (24): @harness/event-bus, dependencies, drizzle-orm, @harness/db, @harness/di, @harness/domain, @harness/event-bus, devDependencies (+16 more)

### Community 83 - "Community 83"
Cohesion: 0.08
Nodes (24): @harness/git-provider, @harness/ticket-provider, dependencies, @harness/domain, @harness/git-provider, @harness/mcp, @harness/ticket-provider, devDependencies (+16 more)

### Community 84 - "Community 84"
Cohesion: 0.13
Nodes (22): AgentRunRow, AuditEntry, AuditKind, EventLogRow, LlmCallRow, mergeEntries(), summarizeEvent(), toEventEntry() (+14 more)

### Community 85 - "Community 85"
Cohesion: 0.08
Nodes (24): dependencies, zod, engines, node, vitest, zod, license, lint-staged (+16 more)

### Community 86 - "Community 86"
Cohesion: 0.14
Nodes (20): extractBalanced(), extractCandidates(), KINDS, normalizeFindings(), normalizeKind(), normalizeLine(), normalizeSeverity(), normalizeSuggestions() (+12 more)

### Community 87 - "Community 87"
Cohesion: 0.17
Nodes (15): buildSummaryPrompt(), parseFileSummary(), ReviewAgent, ReviewAgentOptions, BatchReviewOptions, FileSummary, ReviewAgentOutput, buildInstructionsSection() (+7 more)

### Community 88 - "Community 88"
Cohesion: 0.08
Nodes (24): dependencies, drizzle-orm, @harness/db, @harness/di, @harness/domain, @harness/event-bus, @harness/observability, devDependencies (+16 more)

### Community 89 - "Community 89"
Cohesion: 0.08
Nodes (23): @harness/di, dependencies, drizzle-orm, @harness/db, @harness/di, @harness/domain, @harness/observability, node-cron (+15 more)

### Community 90 - "Community 90"
Cohesion: 0.08
Nodes (23): @harness/observability, dependencies, drizzle-orm, @harness/db, @harness/domain, @harness/event-bus, @harness/observability, devDependencies (+15 more)

### Community 91 - "Community 91"
Cohesion: 0.12
Nodes (15): ArtifactTracker, ArtifactCaptureSubscriber, DEFAULT_OBJECT_STORE_THRESHOLD_BYTES, sha256(), SnapshotContentBackend, SnapshotExecutor, SnapshotResult, SnapshotStore (+7 more)

### Community 92 - "Community 92"
Cohesion: 0.16
Nodes (14): ATTENTION_POLICY_V1, AttentionPolicy, AttentionPolicyRule, AutoApproveConfig, DEFAULT_RULE, FatigueConfig, matches(), matchRule() (+6 more)

### Community 93 - "Community 93"
Cohesion: 0.09
Nodes (22): devDependencies, @types/node, typescript, vitest, exports, files, vitest, main (+14 more)

### Community 94 - "Community 94"
Cohesion: 0.09
Nodes (21): @harness/mcp, dependencies, @harness/domain, @harness/mcp, devDependencies, @types/node, typescript, vitest (+13 more)

### Community 95 - "Community 95"
Cohesion: 0.18
Nodes (10): AttentionSubscriber, CRITICAL_PATHS, extractComplexity(), extractConfidence(), extractImpact(), extractNovelty(), extractRisk(), isCriticalPath() (+2 more)

### Community 96 - "Community 96"
Cohesion: 0.17
Nodes (12): computePriority(), labelFor(), SCORE, weightSum(), BASE, AttentionWeights, FACTOR_KEYS, FactorScores (+4 more)

### Community 97 - "Community 97"
Cohesion: 0.14
Nodes (5): CacheInvalidationListener, ContextCache, FileCollector, isExcludedPath(), listener()

### Community 98 - "Community 98"
Cohesion: 0.13
Nodes (15): populateIndex(), tokenizer, applyBudget(), BudgetedContext, BudgetOptions, DEFAULT_CONTEXT_POLICY, RANK_METHOD, sha256() (+7 more)

### Community 99 - "Community 99"
Cohesion: 0.13
Nodes (13): packages_context_engine_src_index_contextengine, packages_context_engine_src_index_filecollector, GOLD_CORPUS, GoldCase, RANKS, TiktokenEncodingName, TiktokenTokenizer, extractFileReferences() (+5 more)

### Community 100 - "Community 100"
Cohesion: 0.12
Nodes (5): DEFAULT_GIT_TOOL_MAP, GitToolMap, GitToolMapEntry, ResolvedGitTools, StaticGitToolMap

### Community 101 - "Community 101"
Cohesion: 0.10
Nodes (21): scripts, backfill:actors, benchmark:regression, build, calibration:report, demo:closed-loop, demo:durable-queue, demo:hybrid-default (+13 more)

### Community 102 - "Community 102"
Cohesion: 0.14
Nodes (20): assert(), entryRow(), lexicalHits(), main(), publishReportCreated(), section(), seedEntry(), seedReport() (+12 more)

### Community 103 - "Community 103"
Cohesion: 0.15
Nodes (8): buildContainer(), notYetImplemented(), resolveAiIdentity(), JudgeShadow, loadReport(), renderSkippedMarkdown(), ReviewVerificationService, ReviewWorkerSubscriber

### Community 104 - "Community 104"
Cohesion: 0.16
Nodes (13): packages_agent_runtime_src_llm_llm_provider_llmresponse, packages_agent_runtime_src_llm_llm_provider_llmtooldefinition, mapOpenAIResponse(), OpenAIChatCompletion, parseToolArguments(), isAbortError(), OpenAIChatRequest, OpenAICompatibleConfig (+5 more)

### Community 105 - "Community 105"
Cohesion: 0.12
Nodes (15): aiProviderCheck, findingKindCheck, reviewDecisionTypeCheck, reviewPipelineStatusCheck, reviewSeverityCheck, reviewVerdictCheck, reviewVerificationStatusCheck, writebackActionCheck (+7 more)

### Community 106 - "Community 106"
Cohesion: 0.10
Nodes (20): dependencies, zod, devDependencies, @types/node, typescript, vitest, exports, files (+12 more)

### Community 107 - "Community 107"
Cohesion: 0.10
Nodes (20): dependencies, @aws-sdk/client-s3, devDependencies, @types/node, typescript, vitest, exports, files (+12 more)

### Community 108 - "Community 108"
Cohesion: 0.10
Nodes (20): dependencies, @harness/domain, @harness/mcp, devDependencies, @types/node, typescript, vitest, exports (+12 more)

### Community 109 - "Community 109"
Cohesion: 0.10
Nodes (9): AssertKeyAbsent, build(), FakeMcpClient, fakeRegistry(), FakeWritebackLogStore, noCodeSlot, noCommitSlot, noDiffSlot (+1 more)

### Community 110 - "Community 110"
Cohesion: 0.10
Nodes (19): @harness/domain, dependencies, @harness/domain, devDependencies, @types/node, typescript, vitest, exports (+11 more)

### Community 111 - "Community 111"
Cohesion: 0.13
Nodes (19): clamp01(), fmt3(), main(), makeRun(), mulberry32(), rowScores(), score(), packages_benchmark_dist_index (+11 more)

### Community 112 - "Community 112"
Cohesion: 0.10
Nodes (19): dependencies, @harness/domain, devDependencies, @types/node, typescript, vitest, exports, files (+11 more)

### Community 113 - "Community 113"
Cohesion: 0.15
Nodes (13): archiveBelowThreshold(), ArchiveResult, consolidateChains(), ConsolidateResult, applyDecay(), approxEqual(), DecayOptions, DecayResult (+5 more)

### Community 114 - "Community 114"
Cohesion: 0.16
Nodes (18): BASELINE, buildSamples(), clamp01(), classifyAgreement(), classifyFloor(), factors(), FIT, fmt3() (+10 more)

### Community 115 - "Community 115"
Cohesion: 0.13
Nodes (17): assert(), collect, main(), makeFit(), makeLoggingBus(), NOW, SEEDED, snapshot() (+9 more)

### Community 116 - "Community 116"
Cohesion: 0.11
Nodes (18): typescript, devDependencies, @types/node, typescript, vitest, exports, files, vitest (+10 more)

### Community 117 - "Community 117"
Cohesion: 0.18
Nodes (16): MemoryArchivedPayload, MemoryArchiveReason, MemoryConsolidatedPayload, MemoryEntryCreatedPayload, EvidenceID, MemoryID, newMemoryID(), createMemoryEntry() (+8 more)

### Community 118 - "Community 118"
Cohesion: 0.14
Nodes (11): ContextRanker, ContextRankerKind, FusedSource, hybridRanker, keywordRanker, RankedSource, RankingCorpus, rankingVariants() (+3 more)

### Community 119 - "Community 119"
Cohesion: 0.12
Nodes (7): packages_mcp_dist_index_mcpclient, FakeMcpClient, FakeRegistry, ISSUE_JSON, jiraRegistry(), OK, textResult()

### Community 120 - "Community 120"
Cohesion: 0.11
Nodes (18): dependencies, devDependencies, @types/node, typescript, vitest, exports, files, vitest (+10 more)

### Community 121 - "Community 121"
Cohesion: 0.12
Nodes (13): HealthRating, OverallRiskLevel, PRHealthScore, CATEGORY_CONFIG, getRiskDescription(), HEALTH_COLORS, HEALTH_GRADIENTS, PRHealthScoreTab() (+5 more)

### Community 122 - "Community 122"
Cohesion: 0.11
Nodes (17): @types/node, devDependencies, @types/node, typescript, vitest, exports, files, vitest (+9 more)

### Community 123 - "Community 123"
Cohesion: 0.20
Nodes (16): BatchFailureCallback, batchReview(), buildAgentOptions(), buildDiff(), buildReviewInput(), bySeverityThenFile(), dirname(), estimateTokens() (+8 more)

### Community 124 - "Community 124"
Cohesion: 0.15
Nodes (7): FakeMcpClient, githubClient(), gitlabClient(), prJson(), RecordingRegistry, textResult(), packages_mcp_dist_index_mcpconfigerror

### Community 125 - "Community 125"
Cohesion: 0.25
Nodes (14): isRecord(), loadMcpConfig(), McpConfigError, McpTransportKind, parseMcpConfig(), parseServerEntry(), parseStringArray(), parseStringRecord() (+6 more)

### Community 126 - "Community 126"
Cohesion: 0.16
Nodes (7): McpConfig, McpServerEntry, McpClient, buildSseHeaders(), buildTransport(), McpServerRegistry, McpServerRegistryImpl

### Community 127 - "Community 127"
Cohesion: 0.15
Nodes (14): assertUser(), registerReviewRoutes(), toErrorReply(), QueueDecideBody, RationaleBody, ReviewDecideBody, buildApp(), packages_review_dist_index_evidencenotfounderror (+6 more)

### Community 128 - "Community 128"
Cohesion: 0.13
Nodes (15): CallStatus, buildProvenanceChain(), loadArtifacts(), loadVerification(), ProvenanceAgentRunSection, ProvenanceArtifact, ProvenanceEvent, ProvenanceLlmCall (+7 more)

### Community 129 - "Community 129"
Cohesion: 0.24
Nodes (11): ReRanker, ReRankInput, DependencyProximityResolver, dependencySignal(), NEUTRAL_SIGNAL, PLACEHOLDER_RE_RANK_WEIGHTS, RECENCY_HALFLIFE_MS, recencySignal() (+3 more)

### Community 130 - "Community 130"
Cohesion: 0.20
Nodes (12): EventEnvelope, EventType, LearningLoopCompletedPayload, LearningOutcome, LearningStage, LearningStageCompletedPayload, LearningStageStatus, _SystemEventTypes (+4 more)

### Community 131 - "Community 131"
Cohesion: 0.15
Nodes (6): FakeMcpClient, FakeRegistry, FILES_JSON, githubRegistry(), PR_JSON, textResult()

### Community 132 - "Community 132"
Cohesion: 0.12
Nodes (13): exitOnInitialize, garbage, rl, BITBUCKET_FILES, BITBUCKET_PR, GITHUB_FILES, GITHUB_PR, GITLAB_FILES (+5 more)

### Community 133 - "Community 133"
Cohesion: 0.17
Nodes (15): buildSamples(), clamp01(), factors(), FIT, main(), mulberry32(), score(), toJudgeScores() (+7 more)

### Community 134 - "Community 134"
Cohesion: 0.15
Nodes (13): assert(), collect, FACTS, main(), makeForcedWinFit(), makeRealFit(), packages_attention_engine_dist_index_attentionweights, packages_attention_engine_dist_index_learningcandidate (+5 more)

### Community 135 - "Community 135"
Cohesion: 0.17
Nodes (14): ALL_OFF, ALL_ON, computeTriage(), isMajorOrCritical(), isMigrationPath(), isSecurityPath(), MIGRATION_PATH_PATTERNS, SECRET_FILE_PATTERNS (+6 more)

### Community 136 - "Community 136"
Cohesion: 0.18
Nodes (10): Clock, CycleAudit, CycleStageRecord, LearningCycleRecord, Clock, NewCycleId, packages_domain_dist_index_correlationid, packages_domain_dist_index_learningoutcome (+2 more)

### Community 137 - "Community 137"
Cohesion: 0.17
Nodes (12): client, db, requireConnectionString(), client, db, migrationsFolder, packages_db_src_schema_index_projects, packages_db_src_schema_index_tasks (+4 more)

### Community 138 - "Community 138"
Cohesion: 0.17
Nodes (11): ActorStore, storage, DecisionDeniedPayload, AuthContext, DEFAULT_ROLES, OidcUserInfo, Role, Session (+3 more)

### Community 139 - "Community 139"
Cohesion: 0.18
Nodes (14): AgentExecutionOutcome, TaskCreatedPayload, TaskFailedPayload, TaskOrphanRecoveredPayload, TaskStateChangedPayload, TaskTrigger, WorkflowID, createTask() (+6 more)

### Community 140 - "Community 140"
Cohesion: 0.12
Nodes (15): arrowParens, bracketSameLine, bracketSpacing, embeddedLanguageFormatting, endOfLine, htmlWhitespaceSensitivity, printWidth, proseWrap (+7 more)

### Community 141 - "Community 141"
Cohesion: 0.21
Nodes (10): request(), triageRulesApi, TriageRulesError, TriageRuleState, FALLBACK_STATE, readFileAsText(), RULES, DEFAULT_STATE (+2 more)

### Community 142 - "Community 142"
Cohesion: 0.13
Nodes (14): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+6 more)

### Community 143 - "Community 143"
Cohesion: 0.13
Nodes (15): devDependencies, eslint, eslint-import-resolver-typescript, @eslint/js, eslint-plugin-boundaries, github-mcp-server-js, lint-staged, prettier (+7 more)

### Community 144 - "Community 144"
Cohesion: 0.16
Nodes (8): LearningLoop, makeCollect(), makeFit(), makeLoop(), RecordingBus, T0, T1, T2

### Community 145 - "Community 145"
Cohesion: 0.21
Nodes (13): packages_db_dist_index_calibrationweights, buildFitReport(), FIT_METHOD, NON_RESULT_NOTE, BinaryLabel, FitResult, CalibrationRowDatum, ClosableDb (+5 more)

### Community 146 - "Community 146"
Cohesion: 0.22
Nodes (8): McpClientOptions, PendingRequest, InboundRequest, FIXTURE, SseTransportOptions, StdioTransportOptions, ref_node_http, ref_node_https

### Community 147 - "Community 147"
Cohesion: 0.24
Nodes (3): McpClientError, McpClientImpl, McpTransport

### Community 148 - "Community 148"
Cohesion: 0.24
Nodes (7): provenanceApi, ProvenanceChain, ProvenanceEvent, offsetMs(), Timeline(), ProvenancePage(), mocked

### Community 149 - "Community 149"
Cohesion: 0.20
Nodes (10): packages_domain_dist_index_agreementdimension, packages_domain_dist_index_judgeagreement, agreementFor(), cohensKappa(), computeAgreement(), Dimension, DIMENSIONS, JudgeScorePair (+2 more)

### Community 150 - "Community 150"
Cohesion: 0.30
Nodes (10): packages_domain_dist_index_judgescores, FactorScores, buildJudgeDataset(), incumbentFeatures(), JudgeDatasetInput, JudgeDatasetRow, judgeDisagreement(), toJudgeFeatureVector() (+2 more)

### Community 151 - "Community 151"
Cohesion: 0.20
Nodes (12): main(), parseFixturePath(), resolveFixturePath(), FixtureJson, LoadedTrajectory, loadTrajectory(), RawStep, RawTrajectory (+4 more)

### Community 152 - "Community 152"
Cohesion: 0.24
Nodes (5): EvidenceStore, sha256(), VerificationReport, buildReport(), VerificationEngine

### Community 153 - "Community 153"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution (+5 more)

### Community 154 - "Community 154"
Cohesion: 0.26
Nodes (9): AttentionVariantPair, attentionWeightVariants(), CANDIDATE_ATTENTION_VARIANT_ID, INCUMBENT_ATTENTION_VARIANT_ID, toAttentionWeights(), Split, CONFIG, judgePredictiveSamples() (+1 more)

### Community 157 - "Community 157"
Cohesion: 0.17
Nodes (11): dependsOn, outputs, cache, persistent, $schema, tasks, build, dev (+3 more)

### Community 158 - "Community 158"
Cohesion: 0.24
Nodes (8): AnchorStatus, computeFindingAnchor(), FindingAnchor, lineInRanges(), newFileHunkRanges(), StoredPrFile, StoredPrPayload, PATCH

### Community 159 - "Community 159"
Cohesion: 0.27
Nodes (4): AdaptiveThresholdController, computeRates(), ThresholdStore, toRecord()

### Community 160 - "Community 160"
Cohesion: 0.25
Nodes (5): clamp(), DEFAULT_USAGE_LEARN_CONFIG, SourceUsefulness, UsageLearner, UsageLearnerConfig

### Community 161 - "Community 161"
Cohesion: 0.22
Nodes (8): JudgeRunID, AgreementDimension, JudgeAgreement, JudgeAgreementRecord, JudgeAgreementStore, JudgeRun, JudgeRunStore, JudgeScores

### Community 162 - "Community 162"
Cohesion: 0.18
Nodes (11): scripts, build, eval:ab, eval:ab-report, eval:fit, eval:make-dataset, eval:metrics, eval:replay (+3 more)

### Community 163 - "Community 163"
Cohesion: 0.18
Nodes (11): dependencies, drizzle-orm, @harness/db, @harness/di, @harness/domain, @opentelemetry/api, @opentelemetry/exporter-trace-otlp-http, @opentelemetry/sdk-metrics (+3 more)

### Community 164 - "Community 164"
Cohesion: 0.20
Nodes (9): compilerOptions, declaration, outDir, rootDir, sourceMap, types, extends, include (+1 more)

### Community 165 - "Community 165"
Cohesion: 0.33
Nodes (7): DailyBudgetConfig, decideDeferral(), DEFERRABLE_ACTIONS, DeferralDecision, nextUtcMidnight(), startOfUtcDay(), packages_domain_dist_index_routingaction

### Community 167 - "Community 167"
Cohesion: 0.31
Nodes (8): pickBooleans(), registerTriageRulesRoutes(), DEFAULT_STATE, loadTriageRuleState(), saveTriageRuleState(), toState(), TriageRuleState, packages_db_dist_index_triagerules

### Community 168 - "Community 168"
Cohesion: 0.28
Nodes (8): ENGINE_PACKAGES, engineNewSites(), harnessDependencies(), PackageJson, readPackage(), ROOT, SEAM_CONCRETES, walkSource()

### Community 169 - "Community 169"
Cohesion: 0.22
Nodes (8): compilerOptions, module, moduleResolution, noEmit, skipLibCheck, strict, target, include

### Community 170 - "Community 170"
Cohesion: 0.22
Nodes (8): compilerOptions, module, moduleResolution, noEmit, skipLibCheck, strict, target, include

### Community 171 - "Community 171"
Cohesion: 0.25
Nodes (7): elements, elementTypesRules, ENGINE_TYPES, SHARED, @eslint/js, eslint-plugin-boundaries, typescript-eslint

### Community 172 - "Community 172"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 173 - "Community 173"
Cohesion: 0.46
Nodes (3): ChangeStatusSubscriber, setChangeStatus(), newBus()

### Community 174 - "Community 174"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 175 - "Community 175"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 176 - "Community 176"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 177 - "Community 177"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 178 - "Community 178"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 179 - "Community 179"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 180 - "Community 180"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 181 - "Community 181"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 182 - "Community 182"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 183 - "Community 183"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 184 - "Community 184"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 185 - "Community 185"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 186 - "Community 186"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 187 - "Community 187"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 188 - "Community 188"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 189 - "Community 189"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 190 - "Community 190"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 191 - "Community 191"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 192 - "Community 192"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 193 - "Community 193"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 194 - "Community 194"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 195 - "Community 195"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 196 - "Community 196"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 197 - "Community 197"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 198 - "Community 198"
Cohesion: 0.33
Nodes (3): WritebackRecord, WritebackDetailModal(), WritebackDetailModalProps

### Community 201 - "Community 201"
Cohesion: 0.38
Nodes (6): budgetFiles(), BudgetFilesOptions, BudgetFilesResult, estimateTokens(), keywordScore(), packages_domain_dist_index_pullrequestfile

### Community 202 - "Community 202"
Cohesion: 0.33
Nodes (5): compilerOptions, noEmit, types, extends, include

### Community 203 - "Community 203"
Cohesion: 0.40
Nodes (3): classifyError(), LoggingLLMProvider, sanitizeMessage()

### Community 208 - "Community 208"
Cohesion: 0.50
Nodes (4): E2E_REVIEWER, main(), REPO_ROOT, seedReviewerIfMissing()

### Community 209 - "Community 209"
Cohesion: 0.80
Nodes (3): isSensitiveFile(), maskSecretValue(), redactSensitivePatch()

### Community 220 - "Community 220"
Cohesion: 0.50
Nodes (3): getMeter(), setMeterName(), @opentelemetry/api

## Knowledge Gaps
- **1617 isolated node(s):** `FastifyRequest`, `EnabledBody`, `KillBody`, `AuditQuery`, `SourceFilter` (+1612 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 2494 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fastify` connect `Community 56` to `Community 0`, `Community 1`, `Community 66`, `Community 3`, `Community 19`, `Community 127`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Why does `typescript` connect `Community 116` to `Community 24`, `Community 50`, `Community 52`, `Community 61`, `Community 63`, `Community 65`, `Community 66`, `Community 67`, `Community 68`, `Community 74`, `Community 76`, `Community 81`, `Community 82`, `Community 83`, `Community 85`, `Community 88`, `Community 89`, `Community 90`, `Community 93`, `Community 94`, `Community 106`, `Community 107`, `Community 108`, `Community 110`, `Community 112`, `Community 120`, `Community 122`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **What connects `FastifyRequest`, `EnabledBody`, `KillBody` to the rest of the system?**
  _1617 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.028002990052325916 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.03866039952996475 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.03019175846593227 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.04287962234461054 - nodes in this community are weakly interconnected._