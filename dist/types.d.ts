/**
 * MCP Agent Orchestrator - Shared Types
 *
 * Type definitions for agents, sessions, and MCP tool interfaces.
 */
import { z } from 'zod';
/**
 * Execution context for tracking delegation depth and preventing cycles
 */
export interface ExecutionContext {
    /** Current depth in the delegation chain (0 = root) */
    depth: number;
    /** Stack of agent names in the current delegation chain */
    agentStack: string[];
    /** Session ID of the root agent that started the chain */
    rootSessionId: string;
}
/**
 * Maximum delegation depth to prevent runaway recursion
 */
export declare const MAX_DELEGATION_DEPTH = 5;
/**
 * Parameters for the delegate_to_agent tool (used internally by agents)
 */
export interface DelegateToAgentParams {
    /** Name of the agent to delegate to */
    agent: string;
    /** Task prompt for the delegated agent */
    task: string;
    /** Optional context data to pass to the delegated agent */
    context_data?: Record<string, unknown>;
    /** Whether to wait for the result (default: true) */
    wait_for_result?: boolean;
}
/**
 * Result returned by delegate_to_agent tool
 */
export interface DelegationResult {
    /** Whether the delegated agent completed successfully */
    success: boolean;
    /** Name of the agent that was called */
    agent: string;
    /** Session ID of the delegated agent */
    session_id: string;
    /** Summary/result from the delegated agent */
    result: string;
    /** Files created or modified by the delegated agent */
    artifacts?: string[];
    /** Error message if delegation failed */
    error?: string;
    /** Execution context information */
    context: {
        depth: number;
        chain: string[];
    };
}
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
/**
 * Parameters for the run_agent tool
 */
export declare const RunAgentParamsSchema: z.ZodObject<{
    /** Name of the agent from the registry */
    agent: z.ZodString;
    /** Task prompt for the agent to execute (or follow-up prompt when resuming) */
    task: z.ZodString;
    /** Optional session ID to resume a previous agent run */
    resume: z.ZodOptional<z.ZodString>;
    /** Optional: fork session instead of continuing */
    fork: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    agent: string;
    task: string;
    resume?: string | undefined;
    fork?: boolean | undefined;
}, {
    agent: string;
    task: string;
    resume?: string | undefined;
    fork?: boolean | undefined;
}>;
export type RunAgentParams = z.infer<typeof RunAgentParamsSchema>;
/**
 * Parameters for the get_agent_sessions tool
 */
export declare const GetSessionsParamsSchema: z.ZodObject<{
    /** Optional filter by agent name */
    agent: z.ZodOptional<z.ZodString>;
    /** Include only active sessions */
    active_only: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    agent?: string | undefined;
    active_only?: boolean | undefined;
}, {
    agent?: string | undefined;
    active_only?: boolean | undefined;
}>;
export type GetSessionsParams = z.infer<typeof GetSessionsParamsSchema>;
/**
 * Parameters for the cancel_agent tool
 */
export declare const CancelAgentParamsSchema: z.ZodObject<{
    /** Session ID to cancel */
    session_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    session_id: string;
}, {
    session_id: string;
}>;
export type CancelAgentParams = z.infer<typeof CancelAgentParamsSchema>;
/**
 * Single task in a batch request
 */
export declare const BatchTaskSchema: z.ZodObject<{
    /** Name of the agent from the registry */
    agent: z.ZodString;
    /** Task prompt for the agent to execute */
    task: z.ZodString;
    /** Optional identifier for this task in results */
    id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    agent: string;
    task: string;
    id?: string | undefined;
}, {
    agent: string;
    task: string;
    id?: string | undefined;
}>;
export type BatchTask = z.infer<typeof BatchTaskSchema>;
/**
 * Parameters for the run_agents_batch tool
 */
export declare const RunAgentsBatchParamsSchema: z.ZodObject<{
    /** Array of tasks to run in parallel */
    tasks: z.ZodArray<z.ZodObject<{
        /** Name of the agent from the registry */
        agent: z.ZodString;
        /** Task prompt for the agent to execute */
        task: z.ZodString;
        /** Optional identifier for this task in results */
        id: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        agent: string;
        task: string;
        id?: string | undefined;
    }, {
        agent: string;
        task: string;
        id?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    tasks: {
        agent: string;
        task: string;
        id?: string | undefined;
    }[];
}, {
    tasks: {
        agent: string;
        task: string;
        id?: string | undefined;
    }[];
}>;
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
/**
 * All possible tool names available in Claude Code
 */
export declare const CLAUDE_CODE_TOOLS: readonly ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebSearch", "WebFetch", "Task", "TodoRead", "TodoWrite", "NotebookEdit", "AskUserQuestion"];
export type ClaudeCodeTool = typeof CLAUDE_CODE_TOOLS[number];
/**
 * Custom error for agent-related failures
 */
export declare class AgentError extends Error {
    readonly code: AgentErrorCode;
    readonly details?: Record<string, unknown> | undefined;
    constructor(message: string, code: AgentErrorCode, details?: Record<string, unknown> | undefined);
}
export declare enum AgentErrorCode {
    /** Agent name not found in .claude/agents/ directory */
    AGENT_NOT_FOUND = "AGENT_NOT_FOUND",
    /** Session ID provided for resume doesn't exist */
    SESSION_NOT_FOUND = "SESSION_NOT_FOUND",
    /** Cannot resume a session that's currently running */
    SESSION_ALREADY_ACTIVE = "SESSION_ALREADY_ACTIVE",
    /** Agent encountered an error during execution */
    EXECUTION_FAILED = "EXECUTION_FAILED",
    /** Session was cancelled via cancel_agent */
    CANCELLED = "CANCELLED",
    /** Agent definition file has invalid format */
    INVALID_CONFIG = "INVALID_CONFIG",
    /** Delegation depth limit exceeded */
    DELEGATION_DEPTH_EXCEEDED = "DELEGATION_DEPTH_EXCEEDED",
    /** Delegation would create a cycle (A→B→A) */
    DELEGATION_CYCLE_DETECTED = "DELEGATION_CYCLE_DETECTED",
    /** Delegated agent failed during execution */
    DELEGATION_FAILED = "DELEGATION_FAILED"
}
//# sourceMappingURL=types.d.ts.map