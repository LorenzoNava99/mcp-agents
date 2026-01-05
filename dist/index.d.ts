#!/usr/bin/env node
/**
 * MCP Agents
 *
 * MCP server providing enhanced agent execution via Claude Agent SDK.
 * Works alongside the Task tool which loads agent descriptions from .claude/agents/.
 *
 * Architecture:
 * - Task tool: Loads agent definitions and provides descriptions in context
 * - This MCP: Provides enhanced execution with session resumption and parallel execution
 *
 * Key features:
 * - Session resumption for follow-up prompts (use session_id from previous run)
 * - Parallel execution when multiple run_agent calls are made together
 * - Auto-compaction via Claude Agent SDK for long-running tasks
 * - Structured output with summary and artifact tracking
 *
 * Tools:
 * - run_agent: Execute an agent with enhanced capabilities (prefer over Task)
 * - get_agent_sessions: List sessions for follow-up prompts
 * - cancel_agent: Cancel a running agent session
 */
export {};
//# sourceMappingURL=index.d.ts.map