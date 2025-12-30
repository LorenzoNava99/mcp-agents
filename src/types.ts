/**
 * MCP Agent Orchestrator - Shared Types
 *
 * Type definitions for agents, sessions, and MCP tool interfaces.
 */

import { z } from 'zod';

// ============================================================================
// Agent Configuration Types
// ============================================================================

/**
 * Agent configuration loaded from markdown definition files
 */
export interface AgentConfig {
  /** Unique agent identifier */
  name: string;
  /** Human-readable description of the agent's purpose */
  description: string;
  /** System prompt defining the agent's behavior */
  systemPrompt: string;
  /** Optional model override (defaults to inheriting parent model) */
  model?: string;
}

// Note: Frontmatter parsing now uses lenient regex extraction in agent-registry.ts
// to handle non-standard YAML (Examples: blocks, escaped newlines, etc.)

// ============================================================================
// Session Management Types
// ============================================================================

/**
 * Information about an active or resumable session
 */
export interface SessionInfo {
  /** Unique session identifier from Claude Agent SDK */
  session_id: string;
  /** Name of the agent associated with this session */
  agent: string;
  /** Initial task/prompt that started the session */
  initial_task: string;
  /** When the session was created */
  created_at: Date;
  /** When the session was last active */
  last_active: Date;
  /** Whether the session is currently running */
  is_active: boolean;
}

/**
 * Serialized session info for JSON responses
 */
export interface SessionInfoJSON {
  session_id: string;
  agent: string;
  initial_task: string;
  created_at: string;
  last_active: string;
  is_active: boolean;
}

// ============================================================================
// MCP Tool Parameter Types
// ============================================================================

/**
 * Parameters for the run_agent tool
 */
export const RunAgentParamsSchema = z.object({
  /** Name of the agent from the registry */
  agent: z.string().describe('Name of the agent to run'),
  /** Task prompt for the agent to execute (or follow-up prompt when resuming) */
  task: z.string().describe('Task prompt for the agent'),
  /** Optional session ID to resume a previous agent run */
  resume: z.string().optional().describe('Session ID to resume'),
  /** Optional: fork session instead of continuing */
  fork: z.boolean().optional().describe('Fork session instead of continuing'),
});

export type RunAgentParams = z.infer<typeof RunAgentParamsSchema>;

/**
 * Parameters for the get_agent_sessions tool
 */
export const GetSessionsParamsSchema = z.object({
  /** Optional filter by agent name */
  agent: z.string().optional().describe('Filter by agent name'),
  /** Include only active sessions */
  active_only: z.boolean().optional().describe('Include only active sessions'),
});

export type GetSessionsParams = z.infer<typeof GetSessionsParamsSchema>;

/**
 * Parameters for the cancel_agent tool
 */
export const CancelAgentParamsSchema = z.object({
  /** Session ID to cancel */
  session_id: z.string().describe('Session ID to cancel'),
});

export type CancelAgentParams = z.infer<typeof CancelAgentParamsSchema>;

/**
 * Single task in a batch request
 */
export const BatchTaskSchema = z.object({
  /** Name of the agent from the registry */
  agent: z.string().describe('Name of the agent to run'),
  /** Task prompt for the agent to execute */
  task: z.string().describe('Task prompt for the agent'),
  /** Optional identifier for this task in results */
  id: z.string().optional().describe('Optional ID to identify this task in results'),
});

export type BatchTask = z.infer<typeof BatchTaskSchema>;

/**
 * Parameters for the run_agents_batch tool
 */
export const RunAgentsBatchParamsSchema = z.object({
  /** Array of tasks to run in parallel */
  tasks: z.array(BatchTaskSchema).min(1).max(10).describe('Array of agent tasks to run in parallel (1-10)'),
});

export type RunAgentsBatchParams = z.infer<typeof RunAgentsBatchParamsSchema>;

/**
 * Result for a single task in batch
 */
export interface BatchTaskResult {
  /** Task identifier (from input or auto-generated) */
  id: string;
  /** Whether this task completed successfully */
  success: boolean;
  /** Session ID for this task */
  session_id: string;
  /** Agent's response/summary */
  summary: string;
  /** Files created or modified */
  artifacts?: string[];
  /** Error message if failed */
  error?: string;
  /** Execution time in ms */
  duration_ms: number;
}

/**
 * Result for batch execution
 */
export interface BatchResult {
  /** Whether all tasks succeeded */
  all_success: boolean;
  /** Number of successful tasks */
  succeeded: number;
  /** Number of failed tasks */
  failed: number;
  /** Total execution time in ms */
  total_duration_ms: number;
  /** Individual task results */
  results: BatchTaskResult[];
}

// ============================================================================
// MCP Tool Response Types
// ============================================================================

/**
 * Result returned by run_agent tool
 */
export interface AgentResult {
  /** Whether the agent completed successfully */
  success: boolean;
  /** Session ID for resuming this agent later */
  session_id: string;
  /** Agent's final response/summary */
  summary: string;
  /** File paths created or modified by the agent (tracked automatically) */
  artifacts?: string[];
  /** Error message if not successful */
  error?: string;
}

/**
 * Result returned by list_agents tool (deprecated - agents are now in run_agent description)
 */
export interface ListAgentsResult {
  agents: Array<{
    name: string;
    description: string;
  }>;
}

/**
 * Result returned by get_agent_sessions tool
 */
export interface GetSessionsResult {
  sessions: SessionInfoJSON[];
}

/**
 * Result returned by cancel_agent tool
 */
export interface CancelAgentResult {
  success: boolean;
  session_id: string;
  message: string;
}

// ============================================================================
// SDK Message Type Helpers
// ============================================================================

/**
 * All possible tool names available in Claude Code
 */
export const CLAUDE_CODE_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash',
  'WebSearch',
  'WebFetch',
  'Task',
  'TodoRead',
  'TodoWrite',
  'NotebookEdit',
  'AskUserQuestion',
] as const;

export type ClaudeCodeTool = typeof CLAUDE_CODE_TOOLS[number];

// ============================================================================
// Error Types
// ============================================================================

/**
 * Custom error for agent-related failures
 */
export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: AgentErrorCode,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export enum AgentErrorCode {
  /** Agent name not found in .claude/agents/ directory */
  AGENT_NOT_FOUND = 'AGENT_NOT_FOUND',
  /** Session ID provided for resume doesn't exist */
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  /** Cannot resume a session that's currently running */
  SESSION_ALREADY_ACTIVE = 'SESSION_ALREADY_ACTIVE',
  /** Agent encountered an error during execution */
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  /** Session was cancelled via cancel_agent */
  CANCELLED = 'CANCELLED',
  /** Agent definition file has invalid format */
  INVALID_CONFIG = 'INVALID_CONFIG',
}
