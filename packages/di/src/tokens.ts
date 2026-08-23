/**
 * Registry of DI tokens.
 *
 * Tokens are plain string constants, not Symbols or class references. Strings
 * are readable in logs and serialisable into config, and they keep registration
 * decoupled from resolution (a class-reference token would force the concrete
 * class to be imported before it can be registered).
 */

export const TOKENS = {
  EventBus: 'EventBus',
  Logger: 'Logger',
  Db: 'Db',
  EventLogWriter: 'EventLogWriter',
  OidcProvider: 'OidcProvider',
  AuthService: 'AuthService',
  SessionService: 'SessionService',
  ArtifactCaptureSubscriber: 'ArtifactCaptureSubscriber',
  SnapshotStore: 'SnapshotStore',
  ChangeStatusSubscriber: 'ChangeStatusSubscriber',
  EvidenceStore: 'EvidenceStore',
  TaskStateMachine: 'TaskStateMachine',
  TaskService: 'TaskService',
  LLMProvider: 'LLMProvider',
  Orchestrator: 'Orchestrator',
  AgentRuntime: 'AgentRuntime',
  ContextEngine: 'ContextEngine',
  ContextCache: 'ContextCache',
  CacheInvalidationListener: 'CacheInvalidationListener',
  Embedder: 'Embedder',
  EmbeddingIndexer: 'EmbeddingIndexer',
  ReembedListener: 'ReembedListener',
  SemanticRetriever: 'SemanticRetriever',
  SemanticRanker: 'SemanticRanker',
  ArtifactTracker: 'ArtifactTracker',
  ContentStore: 'ContentStore',
  AttentionEngine: 'AttentionEngine',
  AttentionSubscriber: 'AttentionSubscriber',
  AttentionRouter: 'AttentionRouter',
  WeightsProvider: 'WeightsProvider',
  VerificationEngine: 'VerificationEngine',
  Sandbox: 'Sandbox',
  ReviewService: 'ReviewService',
  AutoApproveGate: 'AutoApproveGate',
  AutoApproveKillSwitch: 'AutoApproveKillSwitch',
  AutoApproveSampler: 'AutoApproveSampler',
  AutoApproveExecutor: 'AutoApproveExecutor',
  MetricsComputer: 'MetricsComputer',
  // Review-reorient: the external-PR review slice.
  ReviewAgent: 'ReviewAgent',
  ReviewIngestService: 'ReviewIngestService',
  GitProvider: 'GitProvider',
  TicketProvider: 'TicketProvider',
  // Review-reorient Phase 3: the MCP connection layer (day-02).
  McpServerRegistry: 'McpServerRegistry',
  // Review-reorient Phase 3: the write-back seam (day-06).
  WriteBackService: 'WriteBackService',
  // Review-reorient Phase 3: review memory (day-16).
  MemoryStore: 'MemoryStore',
} as const;

/** The string union of every known token. */
export type Token = (typeof TOKENS)[keyof typeof TOKENS];
