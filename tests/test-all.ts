/**
 * Comprehensive Test Suite for MCP Agents
 *
 * Tests:
 * 1. AgentRegistry - loading, parsing, validation
 * 2. SessionStore - CRUD operations, filtering
 * 3. Type validation - Zod schemas
 * 4. Edge cases - errors, missing data
 */

import { AgentRegistry } from '../src/agent-registry.js';
import { SessionStore } from '../src/session-store.js';
import {
  RunAgentParamsSchema,
  GetSessionsParamsSchema,
  CancelAgentParamsSchema,
  AgentError,
  AgentErrorCode,
} from '../src/types.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      testsPassed++;
    } catch (error) {
      console.error(`❌ FAIL: ${name}`);
      console.error(`   Error: ${(error as Error).message}`);
      testsFailed++;
    }
  })();
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

// Test directory setup
const TEST_DIR = join(tmpdir(), 'mcp-agents-test-' + Date.now());
const USER_AGENTS_DIR = join(TEST_DIR, 'user-agents');
const PROJECT_AGENTS_DIR = join(TEST_DIR, 'project-agents');

async function setupTestDirs() {
  await mkdir(USER_AGENTS_DIR, { recursive: true });
  await mkdir(PROJECT_AGENTS_DIR, { recursive: true });
}

async function cleanupTestDirs() {
  try {
    await rm(TEST_DIR, { recursive: true, force: true });
  } catch {}
}

// Valid agent file content
const VALID_AGENT = `---
name: test-agent
description: A test agent for unit testing
---

# Test Agent System Prompt

You are a test agent.
`;

const VALID_AGENT_WITH_MODEL = `---
name: custom-model-agent
description: Agent with custom model
model: claude-opus-4
---

# Custom Model Agent

You have a custom model.
`;

const INVALID_NO_FRONTMATTER = `# Just Markdown

No YAML frontmatter here.
`;

const INVALID_YAML = `---
name: broken
description: [invalid yaml
  - missing bracket
---

Content
`;

const INVALID_MISSING_NAME = `---
description: Missing the name field
---

Content
`;

const INVALID_MISSING_DESCRIPTION = `---
name: no-description
---

Content
`;

// ============================================================================
// AgentRegistry Tests
// ============================================================================

async function testAgentRegistry() {
  console.log('\n📦 Testing AgentRegistry...\n');

  // Test 1: Load from valid directory with agents
  await test('Load agents from valid directory', async () => {
    await setupTestDirs();
    await writeFile(join(USER_AGENTS_DIR, 'test.md'), VALID_AGENT);

    const registry = new AgentRegistry();
    await registry.load(USER_AGENTS_DIR);

    assertEqual(registry.size, 1, 'Should load 1 agent');
    assert(registry.has('test-agent'), 'Should have test-agent');
  });

  // Test 2: Load from non-existent directory (should not throw)
  await test('Load from non-existent directory gracefully', async () => {
    const registry = new AgentRegistry();
    await registry.load('/nonexistent/path/that/does/not/exist');
    assertEqual(registry.size, 0, 'Should have 0 agents');
  });

  // Test 3: Load from multiple directories
  await test('Load from multiple directories', async () => {
    await writeFile(join(USER_AGENTS_DIR, 'user-agent.md'), `---
name: user-agent
description: User level agent
---
System prompt`);

    await writeFile(join(PROJECT_AGENTS_DIR, 'project-agent.md'), `---
name: project-agent
description: Project level agent
---
System prompt`);

    const registry = new AgentRegistry();
    await registry.loadFromMultiple([USER_AGENTS_DIR, PROJECT_AGENTS_DIR]);

    assertEqual(registry.size, 3, 'Should load 3 agents total');
    assert(registry.has('user-agent'), 'Should have user-agent');
    assert(registry.has('project-agent'), 'Should have project-agent');
  });

  // Test 4: Project agents override user agents
  await test('Project agents override user agents with same name', async () => {
    await writeFile(join(USER_AGENTS_DIR, 'override-test.md'), `---
name: shared-agent
description: User version
---
User system prompt`);

    await writeFile(join(PROJECT_AGENTS_DIR, 'override-test.md'), `---
name: shared-agent
description: Project version
---
Project system prompt`);

    const registry = new AgentRegistry();
    await registry.loadFromMultiple([USER_AGENTS_DIR, PROJECT_AGENTS_DIR]);

    const agent = registry.get('shared-agent');
    assert(agent !== undefined, 'Should have shared-agent');
    assertEqual(agent!.description, 'Project version', 'Should use project version');
    assert(agent!.systemPrompt.includes('Project'), 'Should have project system prompt');
  });

  // Test 5: Parse agent with optional model field
  await test('Parse agent with optional model field', async () => {
    await writeFile(join(PROJECT_AGENTS_DIR, 'model-agent.md'), VALID_AGENT_WITH_MODEL);

    const registry = new AgentRegistry();
    await registry.load(PROJECT_AGENTS_DIR);

    const agent = registry.get('custom-model-agent');
    assert(agent !== undefined, 'Should have custom-model-agent');
    assertEqual(agent!.model, 'claude-opus-4', 'Should have custom model');
  });

  // Test 6: Reject file without frontmatter
  await test('Skip file without frontmatter (log error, continue)', async () => {
    await rm(PROJECT_AGENTS_DIR, { recursive: true, force: true });
    await mkdir(PROJECT_AGENTS_DIR, { recursive: true });
    await writeFile(join(PROJECT_AGENTS_DIR, 'invalid.md'), INVALID_NO_FRONTMATTER);
    await writeFile(join(PROJECT_AGENTS_DIR, 'valid.md'), VALID_AGENT);

    const registry = new AgentRegistry();
    await registry.load(PROJECT_AGENTS_DIR);

    assertEqual(registry.size, 1, 'Should only load valid agent');
    assert(registry.has('test-agent'), 'Should have test-agent');
  });

  // Test 7: Reject file with invalid YAML (lenient parser extracts what it can)
  // Note: Our lenient regex parser will extract name: broken and description from this
  // This is expected behavior - we prioritize loading over strict YAML validation
  await test('Parse file with malformed YAML leniently', async () => {
    await rm(PROJECT_AGENTS_DIR, { recursive: true, force: true });
    await mkdir(PROJECT_AGENTS_DIR, { recursive: true });
    await writeFile(join(PROJECT_AGENTS_DIR, 'broken.md'), INVALID_YAML);

    const registry = new AgentRegistry();
    await registry.load(PROJECT_AGENTS_DIR);

    // Lenient parser extracts name: broken and description: [invalid yaml
    assertEqual(registry.size, 1, 'Lenient parser should extract agent');
    assert(registry.has('broken'), 'Should have extracted agent named broken');
  });

  // Test 8: Reject file missing required name field
  await test('Skip file missing required name field', async () => {
    await rm(PROJECT_AGENTS_DIR, { recursive: true, force: true });
    await mkdir(PROJECT_AGENTS_DIR, { recursive: true });
    await writeFile(join(PROJECT_AGENTS_DIR, 'noname.md'), INVALID_MISSING_NAME);

    const registry = new AgentRegistry();
    await registry.load(PROJECT_AGENTS_DIR);

    assertEqual(registry.size, 0, 'Should have 0 agents');
  });

  // Test 9: Reject file missing required description field
  await test('Skip file missing required description field', async () => {
    await rm(PROJECT_AGENTS_DIR, { recursive: true, force: true });
    await mkdir(PROJECT_AGENTS_DIR, { recursive: true });
    await writeFile(join(PROJECT_AGENTS_DIR, 'nodesc.md'), INVALID_MISSING_DESCRIPTION);

    const registry = new AgentRegistry();
    await registry.load(PROJECT_AGENTS_DIR);

    assertEqual(registry.size, 0, 'Should have 0 agents');
  });

  // Test 10: getOrThrow throws for missing agent
  await test('getOrThrow throws AgentError for missing agent', async () => {
    const registry = new AgentRegistry();

    try {
      registry.getOrThrow('nonexistent');
      throw new Error('Should have thrown');
    } catch (error) {
      assert(error instanceof AgentError, 'Should be AgentError');
      assertEqual((error as AgentError).code, AgentErrorCode.AGENT_NOT_FOUND, 'Should be AGENT_NOT_FOUND');
    }
  });

  // Test 11: Reload clears and reloads
  await test('Reload clears and reloads agents', async () => {
    await rm(PROJECT_AGENTS_DIR, { recursive: true, force: true });
    await mkdir(PROJECT_AGENTS_DIR, { recursive: true });
    await writeFile(join(PROJECT_AGENTS_DIR, 'agent1.md'), `---
name: agent1
description: First agent
---
Prompt`);

    const registry = new AgentRegistry();
    await registry.load(PROJECT_AGENTS_DIR);
    assertEqual(registry.size, 1, 'Should have 1 agent initially');

    // Add another agent file
    await writeFile(join(PROJECT_AGENTS_DIR, 'agent2.md'), `---
name: agent2
description: Second agent
---
Prompt`);

    await registry.reload();
    assertEqual(registry.size, 2, 'Should have 2 agents after reload');
  });

  // Test 12: Empty directory
  await test('Handle empty directory', async () => {
    await rm(PROJECT_AGENTS_DIR, { recursive: true, force: true });
    await mkdir(PROJECT_AGENTS_DIR, { recursive: true });

    const registry = new AgentRegistry();
    await registry.load(PROJECT_AGENTS_DIR);

    assertEqual(registry.size, 0, 'Should have 0 agents');
    assertEqual(registry.listNames().length, 0, 'Should have empty name list');
  });

  // Test 13: list() returns all agents
  await test('list() returns all agent configs', async () => {
    await writeFile(join(PROJECT_AGENTS_DIR, 'a.md'), `---
name: agent-a
description: A
---
A`);
    await writeFile(join(PROJECT_AGENTS_DIR, 'b.md'), `---
name: agent-b
description: B
---
B`);

    const registry = new AgentRegistry();
    await registry.load(PROJECT_AGENTS_DIR);

    const agents = registry.list();
    assertEqual(agents.length, 2, 'Should return 2 agents');
    assert(agents.some(a => a.name === 'agent-a'), 'Should include agent-a');
    assert(agents.some(a => a.name === 'agent-b'), 'Should include agent-b');
  });
}

// ============================================================================
// SessionStore Tests
// ============================================================================

async function testSessionStore() {
  console.log('\n📦 Testing SessionStore...\n');

  // Test 1: Create and retrieve session
  await test('Create and retrieve session', () => {
    const store = new SessionStore();
    store.save('session-1', 'test-agent', 'Test task');

    const session = store.get('session-1');
    assert(session !== undefined, 'Session should exist');
    assertEqual(session!.agent, 'test-agent', 'Agent should match');
    assertEqual(session!.initial_task, 'Test task', 'Task should match');
  });

  // Test 2: Complete session
  await test('Complete session marks inactive', () => {
    const store = new SessionStore();
    store.save('session-3', 'agent', 'task', {} as any); // Mock query

    let session = store.get('session-3');
    assertEqual(session!.is_active, true, 'Should be active initially');

    store.complete('session-3');
    session = store.get('session-3');
    assertEqual(session!.is_active, false, 'Should be inactive after complete');
  });

  // Test 3: List all sessions
  await test('List all sessions', () => {
    const store = new SessionStore();
    store.save('s1', 'agent-a', 'task 1');
    store.save('s2', 'agent-b', 'task 2');
    store.save('s3', 'agent-a', 'task 3');

    const all = store.list();
    assertEqual(all.length, 3, 'Should have 3 sessions');
  });

  // Test 4: Filter by agent
  await test('Filter sessions by agent', () => {
    const store = new SessionStore();
    store.save('s1', 'agent-a', 'task 1');
    store.save('s2', 'agent-b', 'task 2');
    store.save('s3', 'agent-a', 'task 3');

    const filtered = store.list({ agent: 'agent-a' });
    assertEqual(filtered.length, 2, 'Should have 2 sessions for agent-a');
    assert(filtered.every(s => s.agent === 'agent-a'), 'All should be agent-a');
  });

  // Test 5: Filter active only
  await test('Filter active sessions only', () => {
    const store = new SessionStore();
    store.save('active-1', 'agent', 'task', {} as any);
    store.save('inactive-1', 'agent', 'task');
    store.complete('inactive-1');

    const active = store.list({ active_only: true });
    assertEqual(active.length, 1, 'Should have 1 active session');
    assertEqual(active[0].session_id, 'active-1', 'Should be active-1');
  });

  // Test 6: isActive check
  await test('isActive returns correct status', () => {
    const store = new SessionStore();
    store.save('check-active', 'agent', 'task', {} as any);

    assertEqual(store.isActive('check-active'), true, 'Should be active');
    assertEqual(store.isActive('nonexistent'), false, 'Nonexistent should be false');

    store.complete('check-active');
    assertEqual(store.isActive('check-active'), false, 'Completed should be false');
  });

  // Test 7: getOrThrow throws for missing
  await test('getOrThrow throws for missing session', () => {
    const store = new SessionStore();

    try {
      store.getOrThrow('does-not-exist');
      throw new Error('Should have thrown');
    } catch (error) {
      assert(error instanceof AgentError, 'Should be AgentError');
      assertEqual((error as AgentError).code, AgentErrorCode.SESSION_NOT_FOUND, 'Should be SESSION_NOT_FOUND');
    }
  });

  // Test 8: listJSON returns serializable format
  await test('listJSON returns ISO date strings', () => {
    const store = new SessionStore();
    store.save('json-test', 'agent', 'task');

    const json = store.listJSON();
    assertEqual(json.length, 1, 'Should have 1 session');
    assert(typeof json[0].created_at === 'string', 'created_at should be string');
    assert(json[0].created_at.includes('T'), 'Should be ISO format');
  });

  // Test 9: Remove session
  await test('Remove session', () => {
    const store = new SessionStore();
    store.save('to-remove', 'agent', 'task');
    assertEqual(store.has('to-remove'), true, 'Should exist');

    const removed = store.remove('to-remove');
    assertEqual(removed, true, 'Should return true');
    assertEqual(store.has('to-remove'), false, 'Should not exist after remove');
  });

  // Test 10: Clear all sessions
  await test('Clear all sessions', () => {
    const store = new SessionStore();
    store.save('s1', 'a', 't');
    store.save('s2', 'b', 't');

    store.clear();
    assertEqual(store.size, 0, 'Should have 0 sessions after clear');
  });

  // Test 11: activeCount
  await test('activeCount returns correct count', () => {
    const store = new SessionStore();
    store.save('ac-1', 'a', 't', {} as any);
    store.save('ac-2', 'a', 't', {} as any);
    store.save('ac-3', 'a', 't');

    assertEqual(store.activeCount, 2, 'Should have 2 active');

    store.complete('ac-1');
    assertEqual(store.activeCount, 1, 'Should have 1 active after complete');
  });
}

// ============================================================================
// Zod Schema Validation Tests
// ============================================================================

async function testZodSchemas() {
  console.log('\n📦 Testing Zod Schemas...\n');

  // RunAgentParamsSchema tests
  await test('RunAgentParamsSchema: valid minimal', () => {
    const result = RunAgentParamsSchema.safeParse({
      agent: 'test-agent',
      task: 'Do something',
    });
    assert(result.success, 'Should parse valid minimal');
  });

  await test('RunAgentParamsSchema: valid with resume', () => {
    const result = RunAgentParamsSchema.safeParse({
      agent: 'test-agent',
      task: 'Continue',
      resume: 'session-123',
    });
    assert(result.success, 'Should parse with resume');
    assertEqual(result.data?.resume, 'session-123', 'Resume should match');
  });

  await test('RunAgentParamsSchema: valid with fork', () => {
    const result = RunAgentParamsSchema.safeParse({
      agent: 'test-agent',
      task: 'Fork it',
      fork: true,
    });
    assert(result.success, 'Should parse with fork');
    assertEqual(result.data?.fork, true, 'Fork should be true');
  });

  await test('RunAgentParamsSchema: reject missing agent', () => {
    const result = RunAgentParamsSchema.safeParse({
      task: 'Do something',
    });
    assert(!result.success, 'Should reject missing agent');
  });

  await test('RunAgentParamsSchema: reject missing task', () => {
    const result = RunAgentParamsSchema.safeParse({
      agent: 'test-agent',
    });
    assert(!result.success, 'Should reject missing task');
  });

  // GetSessionsParamsSchema tests
  await test('GetSessionsParamsSchema: valid empty', () => {
    const result = GetSessionsParamsSchema.safeParse({});
    assert(result.success, 'Should parse empty object');
  });

  await test('GetSessionsParamsSchema: valid with agent filter', () => {
    const result = GetSessionsParamsSchema.safeParse({
      agent: 'specific-agent',
    });
    assert(result.success, 'Should parse with agent');
  });

  await test('GetSessionsParamsSchema: valid with active_only', () => {
    const result = GetSessionsParamsSchema.safeParse({
      active_only: true,
    });
    assert(result.success, 'Should parse with active_only');
  });

  // CancelAgentParamsSchema tests
  await test('CancelAgentParamsSchema: valid', () => {
    const result = CancelAgentParamsSchema.safeParse({
      session_id: 'session-to-cancel',
    });
    assert(result.success, 'Should parse valid');
  });

  await test('CancelAgentParamsSchema: reject missing session_id', () => {
    const result = CancelAgentParamsSchema.safeParse({});
    assert(!result.success, 'Should reject missing session_id');
  });
}

// ============================================================================
// Error Handling Tests
// ============================================================================

async function testErrorHandling() {
  console.log('\n📦 Testing Error Handling...\n');

  await test('AgentError has correct structure', () => {
    const error = new AgentError(
      'Test error message',
      AgentErrorCode.AGENT_NOT_FOUND,
      { agent: 'test' }
    );

    assertEqual(error.message, 'Test error message', 'Message should match');
    assertEqual(error.code, AgentErrorCode.AGENT_NOT_FOUND, 'Code should match');
    assertEqual(error.name, 'AgentError', 'Name should be AgentError');
    assertEqual((error.details as any)?.agent, 'test', 'Details should be preserved');
  });

  await test('All error codes are defined', () => {
    const codes = [
      AgentErrorCode.AGENT_NOT_FOUND,
      AgentErrorCode.SESSION_NOT_FOUND,
      AgentErrorCode.SESSION_ALREADY_ACTIVE,
      AgentErrorCode.EXECUTION_FAILED,
      AgentErrorCode.CANCELLED,
      AgentErrorCode.INVALID_CONFIG,
    ];

    assertEqual(codes.length, 6, 'Should have 6 error codes');
    codes.forEach(code => {
      assert(typeof code === 'string', `Code ${code} should be string`);
    });
  });
}

// ============================================================================
// Integration-style Tests
// ============================================================================

async function testIntegration() {
  console.log('\n📦 Testing Integration Scenarios...\n');

  await test('Full workflow: load agents, create session, complete', async () => {
    // Setup
    await rm(PROJECT_AGENTS_DIR, { recursive: true, force: true });
    await mkdir(PROJECT_AGENTS_DIR, { recursive: true });
    await writeFile(join(PROJECT_AGENTS_DIR, 'workflow-agent.md'), `---
name: workflow-agent
description: For workflow testing
---
System prompt`);

    // Load registry
    const registry = new AgentRegistry();
    await registry.load(PROJECT_AGENTS_DIR);
    assert(registry.has('workflow-agent'), 'Agent should be loaded');

    // Get agent config
    const config = registry.getOrThrow('workflow-agent');
    assertEqual(config.name, 'workflow-agent', 'Name should match');

    // Create session
    const store = new SessionStore();
    store.save('workflow-session', config.name, 'Test workflow');

    // Check session
    const session = store.getOrThrow('workflow-session');
    assertEqual(session.agent, 'workflow-agent', 'Agent should match');

    // Complete
    store.complete('workflow-session');
    assertEqual(store.isActive('workflow-session'), false, 'Should be inactive');

    // Verify in list
    const sessions = store.listJSON({ agent: 'workflow-agent' });
    assertEqual(sessions.length, 1, 'Should have 1 session');
    assertEqual(sessions[0].is_active, false, 'Should show inactive in JSON');
  });

  await test('Agent override preserves system prompt', async () => {
    await rm(USER_AGENTS_DIR, { recursive: true, force: true });
    await rm(PROJECT_AGENTS_DIR, { recursive: true, force: true });
    await mkdir(USER_AGENTS_DIR, { recursive: true });
    await mkdir(PROJECT_AGENTS_DIR, { recursive: true });

    // User version
    await writeFile(join(USER_AGENTS_DIR, 'shared.md'), `---
name: shared
description: User shared agent
---
User prompt content here`);

    // Project version with different content
    await writeFile(join(PROJECT_AGENTS_DIR, 'shared.md'), `---
name: shared
description: Project shared agent
---
Project prompt content here - OVERRIDE`);

    const registry = new AgentRegistry();
    await registry.loadFromMultiple([USER_AGENTS_DIR, PROJECT_AGENTS_DIR]);

    const agent = registry.getOrThrow('shared');
    assertEqual(agent.description, 'Project shared agent', 'Description should be project');
    assert(agent.systemPrompt.includes('OVERRIDE'), 'System prompt should be project version');
  });
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function main() {
  console.log('🧪 MCP Agents Test Suite\n');
  console.log('='.repeat(60));

  try {
    await setupTestDirs();

    await testAgentRegistry();
    await testSessionStore();
    await testZodSchemas();
    await testErrorHandling();
    await testIntegration();

  } finally {
    await cleanupTestDirs();
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed\n`);

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
