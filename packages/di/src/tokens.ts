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
  Db: 'Db',
  EventLogWriter: 'EventLogWriter',
  ArtifactCaptureSubscriber: 'ArtifactCaptureSubscriber',
  TaskStateMachine: 'TaskStateMachine',
  TaskService: 'TaskService',
  Dispatcher: 'Dispatcher',
  DispatchLoop: 'DispatchLoop',
  WorkflowRunner: 'WorkflowRunner',
  LLMProvider: 'LLMProvider',
  ToolRegistry: 'ToolRegistry',
  AgentRunner: 'AgentRunner',
  RuntimePollLoop: 'RuntimePollLoop',
  TrajectoryRecorder: 'TrajectoryRecorder',
  Orchestrator: 'Orchestrator',
  AgentRuntime: 'AgentRuntime',
  ContextEngine: 'ContextEngine',
  ArtifactTracker: 'ArtifactTracker',
  AttentionEngine: 'AttentionEngine',
  VerificationEngine: 'VerificationEngine',
} as const;

/** The string union of every known token. */
export type Token = (typeof TOKENS)[keyof typeof TOKENS];
