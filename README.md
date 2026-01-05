# MCP Agents

MCP server that **enhances the Task tool** with Claude Agent SDK, providing session resumption and independent agent execution.

## IMPORTANT: Replaces Task Tool

**When this MCP is active, it REPLACES the native Task tool.** All agents defined in `.claude/agents/` must be executed through `run_agent`, not through Task.

## Why Use This Instead of Task?

| Feature | Task Tool | run_agent (MCP) |
|---------|-----------|-----------------|
| Session resumption | No | Yes |
| Follow-up prompts | No | Yes |
| Independent sessions | No | Yes |
| Auto-compaction | No | Yes (SDK) |
| Summary-only returns | No | Yes |

## Agent Location

Agents are loaded from the **same location as Claude Code's native agents**:

```
~/.claude/agents/           ← User-level (global)
{cwd}/.claude/agents/       ← Project-level (overrides user-level)
```

**No duplication needed.** Your existing Claude Code agents work with this MCP.

## Installation

```bash
cd mcp-agents
npm install
npm run build
```

## Configuration

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "mcp-agents": {
      "command": "node",
      "args": ["/path/to/mcp-agents/dist/index.js"]
    }
  }
}
```

No `AGENTS_DIR` needed - agents are loaded from `.claude/agents/` automatically.

## MCP Tools

### `run_agent`

**Replaces the Task tool.** Run an autonomous subagent.

```typescript
// New task
run_agent(agent: "researcher", task: "Research rate limiting best practices")

// Follow-up prompt (resume session)
run_agent(agent: "researcher", task: "Focus on token bucket algorithm", resume: "session-id")
```

**Parameters:**
| Name | Required | Description |
|------|----------|-------------|
| `agent` | Yes | Agent name from `.claude/agents/` |
| `task` | Yes | Task prompt (or follow-up when resuming) |
| `resume` | No | Session ID for follow-up prompts |
| `fork` | No | Create independent branch |

**Returns:**
```typescript
{
  success: boolean;
  session_id: string;
  summary: string;
  artifacts?: string[];  // Files created/modified
  error?: string;        // Present on failure
}
```

### `run_agents_batch`

**TRUE PARALLEL execution.** Runs multiple agents concurrently using Promise.all().

```typescript
run_agents_batch({
  tasks: [
    { id: "research", agent: "researcher", task: "Find API docs" },
    { id: "analyze", agent: "analyzer", task: "Check patterns" },
    { id: "test", agent: "tester", task: "Run tests" }
  ]
})
```

**Why use this?**
- Multiple `run_agent` calls execute sequentially (Claude Code limitation)
- `run_agents_batch` executes ALL tasks in parallel
- Total time = longest task, not sum of all tasks

**Returns:**
```typescript
{
  all_success: boolean;
  succeeded: number;
  failed: number;
  total_duration_ms: number;
  results: BatchTaskResult[];  // Each with id, success, session_id, summary
}
```

### `get_agent_sessions`

List resumable sessions for follow-up prompts.

### `cancel_agent`

Cancel a running agent session.

## Agent Format

Same format as Claude Code agents:

```markdown
---
name: my-agent
description: |
  Description of what this agent does.

  Examples:
  - <example>
    Context: When to use
    user: "Example request"
    assistant: "Example response"
    </example>
---

# System Prompt

Your agent instructions here...
```

## Key Features

### Session Resumption
```
1. run_agent(agent="coder", task="Implement auth module")
   → session_id: "abc123"

2. run_agent(agent="coder", task="Add password reset", resume="abc123")
   → Agent continues with full context
```

### Multiple Agent Calls
Multiple `run_agent` calls in one message run in independent sessions. Each agent's failure doesn't affect others.

> **Note:** Execution is currently sequential due to Claude Code's MCP handling. True parallel execution depends on client-side support (MCP spec 2025-11 added parallel tool calls).

### Auto-Compaction
The Claude Agent SDK handles context management for long-running tasks.

### Environment Inheritance
Agents inherit environment from Claude Code session (uses subscription, not API key).

## How It Works

1. MCP loads agents from `.claude/agents/` on each session start
2. Claude already has agent descriptions in context (from same folder)
3. Tool description says "use run_agent, not Task"
4. When `run_agent` is called, MCP uses Claude Agent SDK's `query()` function
5. Agent runs autonomously with all Claude Code tools
6. Only summary is returned (not full conversation)
7. Session can be resumed with follow-up prompts

## License

MIT
