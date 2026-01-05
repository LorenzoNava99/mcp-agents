/**
 * Session Store - Tracks active and resumable agent sessions
 *
 * Sessions are stored in memory (tied to MCP server process lifetime).
 * This aligns with Claude Code's session model - sessions persist while
 * the MCP server process is running. If Claude Code restarts, sessions are lost.
 */
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import { type SessionInfo, type SessionInfoJSON } from './types.js';
/**
 * Manages agent sessions and their lifecycle
 */
export declare class SessionStore {
    private sessions;
    private activeQueries;
    /**
     * Create or update a session entry
     *
     * @param sessionId - Session ID from Claude Agent SDK
     * @param agent - Agent name
     * @param task - Initial task/prompt
     * @param query - Optional Query instance (for active sessions)
     */
    save(sessionId: string, agent: string, task: string, query?: Query): void;
    /**
     * Mark a session as completed (no longer active)
     *
     * @param sessionId - Session ID
     */
    complete(sessionId: string): void;
    /**
     * Get a session by ID
     *
     * @param sessionId - Session ID
     * @returns Session info or undefined
     */
    get(sessionId: string): SessionInfo | undefined;
    /**
     * Get a session by ID, throwing if not found
     *
     * @param sessionId - Session ID
     * @returns Session info
     * @throws AgentError if session not found
     */
    getOrThrow(sessionId: string): SessionInfo;
    /**
     * Get the active Query instance for a session
     *
     * @param sessionId - Session ID
     * @returns Query instance or undefined
     */
    getQuery(sessionId: string): Query | undefined;
    /**
     * List all sessions, optionally filtered
     *
     * @param filter - Optional filter criteria
     * @returns Array of sessions
     */
    list(filter?: {
        agent?: string;
        active_only?: boolean;
    }): SessionInfo[];
    /**
     * List sessions as JSON (for MCP responses)
     *
     * @param filter - Optional filter criteria
     * @returns Array of JSON-serializable sessions
     */
    listJSON(filter?: {
        agent?: string;
        active_only?: boolean;
    }): SessionInfoJSON[];
    /**
     * Check if a session exists
     *
     * @param sessionId - Session ID
     * @returns true if session exists
     */
    has(sessionId: string): boolean;
    /**
     * Check if a session is currently active
     *
     * @param sessionId - Session ID
     * @returns true if session is active
     */
    isActive(sessionId: string): boolean;
    /**
     * Cancel/interrupt an active session
     *
     * Any work already completed (files written, etc.) is preserved.
     * The session becomes resumable after cancellation.
     *
     * @param sessionId - Session ID
     * @returns true if session was cancelled
     */
    cancel(sessionId: string): Promise<boolean>;
    /**
     * Remove a session from the store
     *
     * @param sessionId - Session ID
     * @returns true if session was removed
     */
    remove(sessionId: string): boolean;
    /**
     * Clear all sessions
     */
    clear(): void;
    /**
     * Get the number of sessions
     */
    get size(): number;
    /**
     * Get the number of active sessions
     */
    get activeCount(): number;
}
/**
 * Global session store instance
 */
export declare const sessionStore: SessionStore;
//# sourceMappingURL=session-store.d.ts.map