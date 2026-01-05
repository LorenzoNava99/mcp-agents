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

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { query, createSdkMcpServer, tool, type SDKMessage, type Options } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

import { registry } from './agent-registry.js';
import { sessionStore } from './session-store.js';
import {
  type RunAgentParams,
  type GetSessionsParams,
  type CancelAgentParams,
  type RunAgentsBatchParams,
  type AgentResult,
  type BatchResult,
  type BatchTaskResult,
  type ExecutionContext,
  type DelegateToAgentParams,
  type DelegationResult,
  MAX_DELEGATION_DEPTH,
  AgentError,
  AgentErrorCode,
} from './types.js';

// Agent directories - same as Claude Code's native agent locations
const CWD_AGENTS_DIR = resolve(process.cwd(), '.claude', 'agents');
const USER_AGENTS_DIR = resolve(homedir(), '.claude', 'agents');

// ============================================================================
// Inter-Agent Delegation
// ============================================================================

/**
 * Global map to store execution contexts by session ID
 * This allows the delegation tool handler to access the current context
 */
const executionContexts: Map<string, ExecutionContext> = new Map();

/**
 * Create a default execution context for root-level agent runs
 */
function createDefaultContext(agentName: string, sessionId: string = ''): ExecutionContext {
  return {
    depth: 0,
    agentStack: [agentName],
    rootSessionId: sessionId,
  };
}

/**
 * Create a child context for delegated agent runs
 *
 * @param parentContext - The parent agent's execution context
 * @param childAgentName - The name of the agent being delegated to
 * @throws AgentError if depth exceeds limit or cycle detected
 */
function createChildContext(
  parentContext: ExecutionContext,
  childAgentName: string
): ExecutionContext {
  const newDepth = parentContext.depth + 1;

  // Check depth limit
  if (newDepth > MAX_DELEGATION_DEPTH) {
    throw new AgentError(
      `Delegation depth limit exceeded (max: ${MAX_DELEGATION_DEPTH}). ` +
      `Chain: ${parentContext.agentStack.join(' → ')} → ${childAgentName}`,
      AgentErrorCode.DELEGATION_DEPTH_EXCEEDED,
      {
        depth: newDepth,
        max_depth: MAX_DELEGATION_DEPTH,
        chain: [...parentContext.agentStack, childAgentName],
      }
    );
  }

  // Check for cycles
  if (parentContext.agentStack.includes(childAgentName)) {
    throw new AgentError(
      `Delegation cycle detected: ${childAgentName} is already in the call chain. ` +
      `Chain: ${parentContext.agentStack.join(' → ')} → ${childAgentName}`,
      AgentErrorCode.DELEGATION_CYCLE_DETECTED,
      {
        cycle_agent: childAgentName,
        chain: [...parentContext.agentStack, childAgentName],
      }
    );
  }

  return {
    depth: newDepth,
    agentStack: [...parentContext.agentStack, childAgentName],
    rootSessionId: parentContext.rootSessionId,
  };
}

/**
 * Handle a delegate_to_agent tool call
 *
 * This function is called when an agent uses the delegate_to_agent tool.
 * It creates a child context and runs the delegated agent.
 *
 * @param params - Delegation parameters from the tool call
 * @param parentSessionId - Session ID of the calling agent (to look up context)
 * @returns DelegationResult with the delegated agent's response
 */
async function handleDelegation(
  params: DelegateToAgentParams,
  parentSessionId: string
): Promise<DelegationResult> {
  const { agent: targetAgent, task, context_data } = params;

  // Look up parent context from the global map
  const parentContext = executionContexts.get(parentSessionId);
  if (!parentContext) {
    console.error(`[Delegation] Warning: No context found for session ${parentSessionId}, using default`);
    // Create a temporary context if none found (shouldn't happen normally)
    const tempContext = createDefaultContext('unknown', parentSessionId);
    return handleDelegationWithContext(params, tempContext);
  }

  return handleDelegationWithContext(params, parentContext);
}

/**
 * Internal handler that performs the delegation with a known context
 */
async function handleDelegationWithContext(
  params: DelegateToAgentParams,
  parentContext: ExecutionContext
): Promise<DelegationResult> {
  const { agent: targetAgent, task, context_data } = params;

  console.error(`[Delegation] ${parentContext.agentStack[parentContext.depth]} → ${targetAgent}`);
  console.error(`[Delegation] Depth: ${parentContext.depth + 1}/${MAX_DELEGATION_DEPTH}`);

  try {
    // Create child context (validates depth and cycles)
    const childContext = createChildContext(parentContext, targetAgent);

    // Build enhanced task with context data
    let enhancedTask = task;
    if (context_data && Object.keys(context_data).length > 0) {
      enhancedTask = `${task}\n\n---\n**Context Data:**\n\`\`\`json\n${JSON.stringify(context_data, null, 2)}\n\`\`\``;
    }

    // Run the delegated agent with the child context
    const result = await runAgent(
      {
        agent: targetAgent,
        task: enhancedTask,
      },
      childContext
    );

    console.error(`[Delegation] ${targetAgent} completed: ${result.success ? 'success' : 'failed'}`);

    return {
      success: result.success,
      agent: targetAgent,
      session_id: result.session_id,
      result: result.summary,
      artifacts: result.artifacts,
      error: result.error,
      context: {
        depth: childContext.depth,
        chain: childContext.agentStack,
      },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);

    console.error(`[Delegation] Failed to delegate to ${targetAgent}: ${errMsg}`);

    return {
      success: false,
      agent: targetAgent,
      session_id: '',
      result: '',
      error: errMsg,
      context: {
        depth: parentContext.depth + 1,
        chain: [...parentContext.agentStack, targetAgent],
      },
    };
  }
}

/**
 * Create the delegation MCP server with the delegate_to_agent tool
 *
 * This MCP server is added to each agent's options to enable inter-agent calls.
 * The tool handler looks up the execution context from the global map.
 */
function createDelegationMcpServer() {
  const agents = registry.list();
  const agentNames = agents.map((a) => a.name);

  const agentListDesc = agentNames.length > 0
    ? `Available agents: ${agentNames.join(', ')}`
    : 'No agents available';

  const delegationTool = tool(
    'delegate_to_agent',
    `Delegate a task to another specialized agent and receive their result.

Use this when the current task would benefit from another agent's expertise.
The delegated agent runs with its own system prompt and capabilities.

${agentListDesc}

## Loop Protection
- Maximum delegation depth: ${MAX_DELEGATION_DEPTH} levels
- Cycles are prevented (A→B→A is not allowed)
- Exceeding limits returns an error instead of crashing

## Usage Guidelines
- Delegate specific, well-defined subtasks
- Provide clear context in the task prompt
- Use context_data for structured information
- Handle delegation errors gracefully`,
    {
      agent: z.string().describe('Name of the agent to delegate to'),
      task: z.string().describe('Task prompt for the delegated agent. Include all necessary context.'),
      context_data: z.record(z.unknown()).optional().describe('Optional structured data to include in the task context'),
      wait_for_result: z.boolean().optional().default(true).describe('Wait for the agent to complete and return result'),
    },
    async (args, extra) => {
      // Extract session ID from the extra context if available
      // The SDK passes request context in extra
      const sessionId = (extra as any)?.sessionId || (extra as any)?.session_id || '';

      console.error(`[Delegation Tool] Called with session: ${sessionId}, agent: ${args.agent}`);

      try {
        const result = await handleDelegation(
          {
            agent: args.agent,
            task: args.task,
            context_data: args.context_data as Record<string, unknown> | undefined,
            wait_for_result: args.wait_for_result,
          },
          sessionId
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
          isError: !result.success,
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                agent: args.agent,
                error: errMsg,
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  return createSdkMcpServer({
    name: 'agent-delegation',
    version: '1.0.0',
    tools: [delegationTool],
  });
}

// ============================================================================
// Dynamic Tool Generation
// ============================================================================

/**
 * Build the run_agent tool description
 *
 * IMPORTANT: Agent descriptions are NOT duplicated here.
 * The Task tool loads agent definitions from .claude/agents/ and provides
 * full descriptions in context. This MCP only lists agent names because
 * both tools are available simultaneously - look up agent descriptions
 * in the Task tool's agent list.
 */
function buildRunAgentTool(): Tool {
  const agents = registry.list();
  const agentNames = agents.map((a) => a.name);

  // Only list names - descriptions are in Task tool context (no duplication)
  let agentList = '';
  if (agentNames.length > 0) {
    agentList = `\n\nAvailable agents: ${agentNames.join(', ')}`;
  } else {
    agentList = '\n\nNo agents loaded. Check .claude/agents/ directory.';
  }

  return {
    name: 'run_agent',
    description: `Execute an agent with Claude Agent SDK, providing session resumption and parallel execution.
${agentList}

## Agent Descriptions

Agent descriptions are provided by the **Task tool** from the same \`.claude/agents/\` directory. Both tools are available simultaneously - refer to Task tool's agent definitions for what each agent does. This avoids duplication and keeps descriptions in sync.

## When to Use run_agent vs Task Tool

**Use run_agent (this tool) for:**
- Custom agents defined in \`.claude/agents/\` directory
- When you need session resumption with follow-up prompts
- When you need to run multiple agents in parallel

**Use Task tool for:**
- Built-in agent types (general-purpose, Explore, Plan, statusline-setup, etc.)
- One-shot tasks that don't need session persistence
- Agent types NOT listed in "Available agents" above

## Key Features

- **Session resumption**: Continue agent conversations with follow-up prompts
- **Parallel execution**: Multiple agents run concurrently when called together (each session is completely independent - one failure does not affect others)
- **Auto-compaction**: SDK handles context management for long-running tasks
- **Model inheritance**: Agents always inherit the model from the parent Claude Code session (not configurable per-agent)

## Agent Capabilities

Agents have access to **all Claude Code tools**:
- **File operations**: Read, Write, Edit, Glob, Grep
- **Execution**: Bash (commands, scripts, builds, tests)
- **Web**: WebSearch, WebFetch
- **Notebooks**: NotebookEdit
- **Interaction**: AskUserQuestion, TodoWrite

Agents run autonomously with full filesystem and command execution capabilities. There are no timeout or turn limits - agents run until task completion.

## Multiple Agent Calls

When multiple run_agent calls are made in a single message:
- Each agent runs in a **completely independent session**
- Sessions do not share state or context
- One agent's failure does not affect other agents
- Results are returned independently for each call

**Note:** Execution is currently sequential due to Claude Code's MCP request handling. True parallel execution depends on client-side support (MCP spec 2025-11 added parallel tool calls, pending Claude Code implementation).

## Session Resumption Workflow

**Step 1 - Initial task:**
\`\`\`
run_agent(agent: "vuln-report-writer", task: "Document the XSS vulnerability")
→ { session_id: "abc123", summary: "Created VULN-001..." }
\`\`\`

**Step 2 - Follow-up (agent has full context from Step 1):**
\`\`\`
run_agent(agent: "vuln-report-writer", task: "Add severity justification", resume: "abc123")
→ Agent continues with accumulated context from Step 1
\`\`\`

**Step 3 - Another follow-up:**
\`\`\`
run_agent(agent: "vuln-report-writer", task: "Change to Critical severity", resume: "abc123")
→ Agent has full context from Steps 1 and 2
\`\`\`

## Forking Sessions

The \`fork\` parameter creates a **branch** from an existing session:

- **Without fork (resume only)**: Continues the session linearly. The original session is modified.
- **With fork=true**: Creates a NEW independent session starting from that checkpoint. The original session remains unchanged.

**Use fork when:**
- You want to explore an alternative approach without losing previous work
- You need to try multiple solutions from the same starting point
- Example: After implementing auth with JWT, fork to explore OAuth - both implementations are preserved

\`\`\`
# Original session
run_agent(agent: "coder", task: "Implement auth") → session: "abc"

# Fork to try alternative (original "abc" unchanged)
run_agent(agent: "coder", task: "Try OAuth instead", resume: "abc", fork: true) → session: "def"

# Can still continue original
run_agent(agent: "coder", task: "Add refresh tokens", resume: "abc") → continues JWT path
\`\`\`

## Returns

\`\`\`json
{
  "success": true,
  "session_id": "abc123-def456",
  "summary": "Agent's final response summarizing what was accomplished",
  "artifacts": ["/path/to/created/file.py", "/path/to/modified/file.ts"]
}
\`\`\`

- **success**: Whether the agent completed without errors
- **session_id**: Use with \`resume\` parameter for follow-up prompts
- **summary**: Agent's response about what was accomplished
- **artifacts**: File paths created or modified by the agent (tracked automatically)
- **error**: Present only on failure, contains error details

## Error Handling

On failure, the response includes an \`error\` field:
- \`AGENT_NOT_FOUND\`: Agent name not in available list
- \`SESSION_NOT_FOUND\`: Resume session ID doesn't exist
- \`SESSION_ALREADY_ACTIVE\`: Can't resume a running session (use cancel_agent first)
- \`EXECUTION_FAILED\`: Agent encountered an error during execution

Sessions persist even on failure - use the session_id for debugging or retry.`,
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Agent name from .claude/agents/. Refer to Task tool for agent descriptions.',
          ...(agentNames.length > 0 && { enum: agentNames }),
        },
        task: {
          type: 'string',
          description: 'Task prompt (or follow-up prompt when resuming)',
        },
        resume: {
          type: 'string',
          description: 'Session ID to resume. The task becomes a follow-up prompt with full context from the previous session. Get session IDs from get_agent_sessions or previous run_agent results.',
        },
        fork: {
          type: 'boolean',
          description: 'Create a NEW session branching from the resumed session. Original session remains unchanged (preserves all work done). New session starts from that checkpoint with independent history. Use to explore alternatives without losing previous work.',
        },
      },
      required: ['agent', 'task'],
    },
  };
}

/**
 * Build all MCP tools
 */
function buildTools(): Tool[] {
  const agents = registry.list();
  const agentNames = agents.map((a) => a.name);

  return [
    buildRunAgentTool(),
    {
      name: 'get_agent_sessions',
      description: `List resumable agent sessions. Use to find session_id for follow-up prompts.

**Important**: Sessions are stored in memory and persist only while the MCP server process runs. If Claude Code restarts, sessions are lost.

## Returns

\`\`\`json
{
  "sessions": [
    {
      "session_id": "abc123-def456",
      "agent": "vuln-report-writer",
      "initial_task": "Document the SQL injection finding",
      "created_at": "2025-01-15T10:30:00Z",
      "last_active": "2025-01-15T10:32:45Z",
      "is_active": false
    }
  ]
}
\`\`\`

- **session_id**: Use with run_agent's \`resume\` parameter for follow-up prompts
- **agent**: Which agent this session belongs to
- **initial_task**: The first prompt that started this session
- **created_at**: When the session was created (ISO 8601)
- **last_active**: When the session was last used (ISO 8601)
- **is_active**: true if agent is currently running (cannot resume active sessions)`,
      inputSchema: {
        type: 'object',
        properties: {
          agent: {
            type: 'string',
            description: 'Filter by agent name (returns only sessions for this agent)',
          },
          active_only: {
            type: 'boolean',
            description: 'Only show currently running sessions',
          },
        },
      },
    },
    {
      name: 'cancel_agent',
      description: `Cancel a running agent session.

**When to use:**
- User explicitly requests to stop an agent
- Agent appears stuck or unresponsive
- You need to resume a session that's still marked as active

**What happens on cancel:**
- The agent stops execution immediately
- Any work already completed (files written, etc.) is preserved
- The session becomes resumable (is_active = false)
- You can resume from where it stopped with run_agent

## Returns

\`\`\`json
{
  "success": true,
  "session_id": "abc123-def456",
  "message": "Cancelled"
}
\`\`\`

If session not found or already completed:
\`\`\`json
{
  "success": false,
  "session_id": "abc123-def456",
  "message": "Not found or already completed"
}
\`\`\``,
      inputSchema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Session ID to cancel (get from get_agent_sessions)',
          },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'run_agents_batch',
      description: `Run multiple agents in TRUE PARALLEL. Use this when you need concurrent execution.

**Why use this instead of multiple run_agent calls?**
- Multiple run_agent calls execute SEQUENTIALLY (Claude Code limitation)
- run_agents_batch executes ALL tasks in parallel using Promise.all()
- Total time = longest single task, not sum of all tasks

## Example

\`\`\`json
{
  "tasks": [
    { "id": "research", "agent": "researcher", "task": "Find API docs" },
    { "id": "analyze", "agent": "analyzer", "task": "Check code patterns" },
    { "id": "test", "agent": "tester", "task": "Run security tests" }
  ]
}
\`\`\`

## Returns

\`\`\`json
{
  "all_success": true,
  "succeeded": 3,
  "failed": 0,
  "total_duration_ms": 8500,
  "results": [
    { "id": "research", "success": true, "session_id": "...", "summary": "...", "duration_ms": 8500 },
    { "id": "analyze", "success": true, "session_id": "...", "summary": "...", "duration_ms": 6200 },
    { "id": "test", "success": true, "session_id": "...", "summary": "...", "duration_ms": 7100 }
  ]
}
\`\`\`

## Limits
- Maximum 10 tasks per batch
- Each task creates an independent session (resumable later)
- One task failure doesn't affect others`,
      inputSchema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Array of agent tasks to run in parallel',
            items: {
              type: 'object',
              properties: {
                agent: {
                  type: 'string',
                  description: 'Agent name from .claude/agents/',
                  ...(agentNames.length > 0 && { enum: agentNames }),
                },
                task: {
                  type: 'string',
                  description: 'Task prompt for the agent',
                },
                id: {
                  type: 'string',
                  description: 'Optional ID to identify this task in results',
                },
              },
              required: ['agent', 'task'],
            },
            minItems: 1,
            maxItems: 10,
          },
        },
        required: ['tasks'],
      },
    },
  ];
}

// ============================================================================
// Agent Execution (Non-blocking)
// ============================================================================

/**
 * Run an agent with the Claude Agent SDK
 *
 * Agents run until completion with no timeout or turn limits.
 * Model is always inherited from the parent Claude Code session.
 *
 * @param params - Agent run parameters
 * @param context - Optional execution context for delegation tracking
 */
async function runAgent(
  params: RunAgentParams,
  context?: ExecutionContext
): Promise<AgentResult> {
  const executionId = Math.random().toString(36).substring(7);

  console.error(`[Agents:${executionId}] Starting agent "${params.agent}"`);

  // Get agent configuration
  const agentConfig = registry.getOrThrow(params.agent);

  // Validate session exists before attempting resume
  if (params.resume && !sessionStore.has(params.resume)) {
    throw new AgentError(
      `Session not found: ${params.resume}`,
      AgentErrorCode.SESSION_NOT_FOUND,
      { session_id: params.resume }
    );
  }

  // Check if resuming an active session
  if (params.resume && sessionStore.isActive(params.resume)) {
    throw new AgentError(
      `Session ${params.resume} is already active. Use cancel_agent first.`,
      AgentErrorCode.SESSION_ALREADY_ACTIVE,
      { session_id: params.resume }
    );
  }

  // Create default context if not provided (backward compatibility)
  // Note: For root calls from MCP, context will be undefined and created here
  // For delegated calls, context is passed from handleDelegation
  let executionContext = context;

  // Build delegation info for system prompt
  const delegationInfo = buildDelegationSystemPromptSection();

  // Enhance system prompt with delegation capability
  const enhancedSystemPrompt = `${agentConfig.systemPrompt}

${delegationInfo}`;

  // Create delegation MCP server for this agent
  const delegationServer = createDelegationMcpServer();

  // The MCP tool name follows the pattern: mcp__<server-name>__<tool-name>
  const delegationToolName = 'mcp__agent-delegation__delegate_to_agent';

  // Build SDK options - model is always inherited from parent session
  const options: Options = {
    systemPrompt: enhancedSystemPrompt,
    tools: { type: 'preset', preset: 'claude_code' },
    env: process.env as Record<string, string>,
    ...(params.resume && { resume: params.resume }),
    ...(params.fork && { forkSession: params.fork }),
    permissionMode: 'acceptEdits',
    // Add the delegation MCP server to enable inter-agent calls
    mcpServers: {
      'agent-delegation': delegationServer,
    },
    // Auto-approve the delegation tool to avoid MCP permission prompts
    allowedTools: [delegationToolName],
  };

  // Enhance task with return expectations for structured output
  const enhancedTask = `${params.task}

---
**Output Requirements**: When you complete this task, your final response MUST include:
1. A clear summary of what was accomplished
2. List of any files created or modified (with full paths)`;

  console.error(`[Agents:${executionId}] Task: ${params.task.substring(0, 100)}...`);
  if (params.resume) {
    console.error(`[Agents:${executionId}] Resuming session: ${params.resume}`);
  }
  if (context) {
    console.error(`[Agents:${executionId}] Context: depth=${context.depth}, chain=${context.agentStack.join('→')}`);
  }

  let sessionId = '';
  let result = '';
  const artifacts: string[] = [];
  let errorMessage: string | undefined;

  try {
    const q = query({
      prompt: enhancedTask,
      options,
    });

    for await (const message of q) {
      // Initialize context and store in global map when we get session ID
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id;

        // Create or update execution context
        if (!executionContext) {
          executionContext = createDefaultContext(params.agent, sessionId);
        } else if (!executionContext.rootSessionId) {
          executionContext = { ...executionContext, rootSessionId: sessionId };
        }

        // Store context in global map for delegation tool to access
        executionContexts.set(sessionId, executionContext);
        console.error(`[Agents:${executionId}] Stored context for session: ${sessionId}`);
      }

      // Process message with standard handlers
      processMessage(message, {
        onInit: (sid) => {
          sessionId = sid;
          sessionStore.save(sessionId, params.agent, params.task, q);
          console.error(`[Agents:${executionId}] Session: ${sessionId}`);
        },
        onResult: (r) => {
          result = r;
        },
        onArtifact: (artifact) => {
          artifacts.push(artifact);
        },
        onError: (err) => {
          errorMessage = err;
        },
      });
    }

    // Clean up: remove context from global map and mark session complete
    if (sessionId) {
      executionContexts.delete(sessionId);
      sessionStore.complete(sessionId);
    }

    console.error(`[Agents:${executionId}] Completed`);

    return {
      success: !errorMessage,
      session_id: sessionId,
      summary: result || (errorMessage ? `Error: ${errorMessage}` : 'No result'),
      artifacts: artifacts.length > 0 ? artifacts : undefined,
      error: errorMessage,
    };
  } catch (error) {
    // Clean up on error
    if (sessionId) {
      executionContexts.delete(sessionId);
      sessionStore.complete(sessionId);
    }

    const errMsg = error instanceof Error ? error.message : String(error);

    console.error(`[Agents:${executionId}] Failed: ${errMsg}`);

    return {
      success: false,
      session_id: sessionId || 'unknown',
      summary: `Agent execution failed: ${errMsg}`,
      error: errMsg,
    };
  }
}

/**
 * Build the delegation info section for the system prompt
 *
 * This informs the agent about the delegate_to_agent tool capability.
 */
function buildDelegationSystemPromptSection(): string {
  const agents = registry.list();
  const agentNames = agents.map((a) => a.name);

  if (agentNames.length === 0) {
    return '';
  }

  const agentList = agents
    .map((a) => `- **${a.name}**: ${a.description}`)
    .join('\n');

  return `
---
## Inter-Agent Delegation

You have access to a tool called \`mcp__agent-delegation__delegate_to_agent\` that allows you to delegate subtasks to other specialized agents.

### Available Agents
${agentList}

### How to Delegate
Use the delegation tool when a subtask would benefit from another agent's expertise:

\`\`\`
mcp__agent-delegation__delegate_to_agent({
  agent: "agent-name",
  task: "Clear description of the subtask",
  context_data: { key: "optional structured data" }
})
\`\`\`

### Delegation Rules
- Maximum depth: ${MAX_DELEGATION_DEPTH} levels of delegation
- No cycles: You cannot delegate to an agent that's already in the call chain
- Errors are returned gracefully - handle them in your response

### When to Delegate
- When a subtask requires specialized knowledge another agent has
- When you want to parallelize work across multiple agents
- When the task naturally decomposes into independent subtasks
`;
}

/**
 * Run multiple agents in TRUE PARALLEL using Promise.all()
 *
 * This bypasses Claude Code's sequential MCP request handling by
 * accepting all tasks in a single request and executing them concurrently.
 */
async function runAgentsBatch(params: RunAgentsBatchParams): Promise<BatchResult> {
  const batchId = Math.random().toString(36).substring(7);
  const batchStart = Date.now();

  console.error(`[Batch:${batchId}] Starting ${params.tasks.length} agents in parallel`);

  // Execute all agents in parallel
  const taskPromises = params.tasks.map(async (task, index): Promise<BatchTaskResult> => {
    const taskId = task.id || `task-${index}`;
    const taskStart = Date.now();

    try {
      const result = await runAgent({
        agent: task.agent,
        task: task.task,
      });

      return {
        id: taskId,
        success: result.success,
        session_id: result.session_id,
        summary: result.summary,
        artifacts: result.artifacts,
        error: result.error,
        duration_ms: Date.now() - taskStart,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        id: taskId,
        success: false,
        session_id: 'failed',
        summary: `Failed: ${errMsg}`,
        error: errMsg,
        duration_ms: Date.now() - taskStart,
      };
    }
  });

  // Wait for ALL agents to complete
  const results = await Promise.all(taskPromises);

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalDuration = Date.now() - batchStart;

  console.error(`[Batch:${batchId}] Completed: ${succeeded} succeeded, ${failed} failed in ${totalDuration}ms`);

  return {
    all_success: failed === 0,
    succeeded,
    failed,
    total_duration_ms: totalDuration,
    results,
  };
}

/**
 * Process SDK message (synchronous for performance)
 */
function processMessage(
  message: SDKMessage,
  handlers: {
    onInit: (sessionId: string) => void;
    onResult: (result: string) => void;
    onArtifact: (artifact: string) => void;
    onError: (error: string) => void;
  }
): void {
  switch (message.type) {
    case 'system':
      if (message.subtype === 'init') {
        handlers.onInit(message.session_id);
      }
      break;

    case 'result':
      if (message.subtype === 'success') {
        handlers.onResult(message.result);
      } else {
        const errors = 'errors' in message ? message.errors : [];
        handlers.onError(errors.join('; ') || message.subtype);
      }
      break;

    case 'assistant':
      if (message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            const input = block.input as Record<string, unknown>;
            if ((block.name === 'Write' || block.name === 'Edit') && input.file_path) {
              handlers.onArtifact(String(input.file_path));
            }
          }
        }
      }
      break;
  }
}

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new Server(
  {
    name: 'agents',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Handle tool listing - reloads agents from .claude/agents/ directories
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Load from both cwd/.claude/agents/ and ~/.claude/agents/
  console.error(`[Agents] Loading agents from:`);
  console.error(`  - ${CWD_AGENTS_DIR}`);
  console.error(`  - ${USER_AGENTS_DIR}`);

  await registry.loadFromMultiple([CWD_AGENTS_DIR, USER_AGENTS_DIR]);

  console.error(`[Agents] Loaded ${registry.size} agents: ${registry.listNames().join(', ') || 'none'}`);

  return {
    tools: buildTools(),
  };
});

/**
 * Handle tool calls
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const requestId = Math.random().toString(36).substring(7);
  const requestTime = Date.now();

  console.error(`[MCP:${requestId}] REQUEST RECEIVED: ${name} at ${new Date(requestTime).toISOString()}`);

  try {
    switch (name) {
      case 'run_agent': {
        const params = args as RunAgentParams;
        if (!params.agent || !params.task) {
          throw new Error('Missing required parameters: agent and task');
        }
        console.error(`[MCP:${requestId}] Starting agent: ${params.agent}`);
        const result = await runAgent(params);
        console.error(`[MCP:${requestId}] Completed in ${Date.now() - requestTime}ms`);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'run_agents_batch': {
        const params = args as RunAgentsBatchParams;
        if (!params.tasks || !Array.isArray(params.tasks) || params.tasks.length === 0) {
          throw new Error('Missing required parameter: tasks (non-empty array)');
        }
        if (params.tasks.length > 10) {
          throw new Error('Maximum 10 tasks per batch');
        }
        console.error(`[MCP:${requestId}] Starting batch of ${params.tasks.length} agents`);
        const result = await runAgentsBatch(params);
        console.error(`[MCP:${requestId}] Batch completed in ${Date.now() - requestTime}ms`);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'get_agent_sessions': {
        const params = args as GetSessionsParams | undefined;
        const sessions = sessionStore.listJSON({
          agent: params?.agent,
          active_only: params?.active_only,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ sessions }, null, 2) }],
        };
      }

      case 'cancel_agent': {
        const params = args as CancelAgentParams;
        if (!params.session_id) {
          throw new Error('Missing required parameter: session_id');
        }
        const cancelled = await sessionStore.cancel(params.session_id);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: cancelled,
              session_id: params.session_id,
              message: cancelled ? 'Cancelled' : 'Not found or already completed',
            }),
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = error instanceof AgentError ? error.code : 'UNKNOWN_ERROR';

    console.error(`[Agents] Error (${name}):`, errorMessage);

    return {
      content: [{ type: 'text', text: JSON.stringify({ error: errorMessage, code: errorCode }) }],
      isError: true,
    };
  }
});

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.error(`[Agents] Starting MCP server...`);
  console.error(`[Agents] Agent directories:`);
  console.error(`  - Project: ${CWD_AGENTS_DIR}`);
  console.error(`  - User: ${USER_AGENTS_DIR}`);

  // Initial load
  await registry.loadFromMultiple([CWD_AGENTS_DIR, USER_AGENTS_DIR]);

  if (registry.size === 0) {
    console.error(`[Agents] No agents found. Add .md files to .claude/agents/`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[Agents] Connected. Agents: ${registry.listNames().join(', ') || 'none'}`);
  console.error(`[Agents] Prefer run_agent over Task for session resumption capabilities.`);
}

main().catch((error) => {
  console.error('[Agents] Fatal:', error);
  process.exit(1);
});
