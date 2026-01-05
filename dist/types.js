/**
 * MCP Agent Orchestrator - Shared Types
 *
 * Type definitions for agents, sessions, and MCP tool interfaces.
 */
import { z } from 'zod';
/**
 * Maximum delegation depth to prevent runaway recursion
 */
export const MAX_DELEGATION_DEPTH = 5;
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
/**
 * Parameters for the get_agent_sessions tool
 */
export const GetSessionsParamsSchema = z.object({
    /** Optional filter by agent name */
    agent: z.string().optional().describe('Filter by agent name'),
    /** Include only active sessions */
    active_only: z.boolean().optional().describe('Include only active sessions'),
});
/**
 * Parameters for the cancel_agent tool
 */
export const CancelAgentParamsSchema = z.object({
    /** Session ID to cancel */
    session_id: z.string().describe('Session ID to cancel'),
});
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
/**
 * Parameters for the run_agents_batch tool
 */
export const RunAgentsBatchParamsSchema = z.object({
    /** Array of tasks to run in parallel */
    tasks: z.array(BatchTaskSchema).min(1).max(10).describe('Array of agent tasks to run in parallel (1-10)'),
});
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
];
// ============================================================================
// Error Types
// ============================================================================
/**
 * Custom error for agent-related failures
 */
export class AgentError extends Error {
    code;
    details;
    constructor(message, code, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'AgentError';
    }
}
export var AgentErrorCode;
(function (AgentErrorCode) {
    /** Agent name not found in .claude/agents/ directory */
    AgentErrorCode["AGENT_NOT_FOUND"] = "AGENT_NOT_FOUND";
    /** Session ID provided for resume doesn't exist */
    AgentErrorCode["SESSION_NOT_FOUND"] = "SESSION_NOT_FOUND";
    /** Cannot resume a session that's currently running */
    AgentErrorCode["SESSION_ALREADY_ACTIVE"] = "SESSION_ALREADY_ACTIVE";
    /** Agent encountered an error during execution */
    AgentErrorCode["EXECUTION_FAILED"] = "EXECUTION_FAILED";
    /** Session was cancelled via cancel_agent */
    AgentErrorCode["CANCELLED"] = "CANCELLED";
    /** Agent definition file has invalid format */
    AgentErrorCode["INVALID_CONFIG"] = "INVALID_CONFIG";
    /** Delegation depth limit exceeded */
    AgentErrorCode["DELEGATION_DEPTH_EXCEEDED"] = "DELEGATION_DEPTH_EXCEEDED";
    /** Delegation would create a cycle (A→B→A) */
    AgentErrorCode["DELEGATION_CYCLE_DETECTED"] = "DELEGATION_CYCLE_DETECTED";
    /** Delegated agent failed during execution */
    AgentErrorCode["DELEGATION_FAILED"] = "DELEGATION_FAILED";
})(AgentErrorCode || (AgentErrorCode = {}));
//# sourceMappingURL=types.js.map