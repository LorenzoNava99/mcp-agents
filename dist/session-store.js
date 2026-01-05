/**
 * Session Store - Tracks active and resumable agent sessions
 *
 * Sessions are stored in memory (tied to MCP server process lifetime).
 * This aligns with Claude Code's session model - sessions persist while
 * the MCP server process is running. If Claude Code restarts, sessions are lost.
 */
import { AgentError, AgentErrorCode, } from './types.js';
/**
 * Manages agent sessions and their lifecycle
 */
export class SessionStore {
    sessions = new Map();
    activeQueries = new Map();
    /**
     * Create or update a session entry
     *
     * @param sessionId - Session ID from Claude Agent SDK
     * @param agent - Agent name
     * @param task - Initial task/prompt
     * @param query - Optional Query instance (for active sessions)
     */
    save(sessionId, agent, task, query) {
        const now = new Date();
        const existing = this.sessions.get(sessionId);
        this.sessions.set(sessionId, {
            session_id: sessionId,
            agent,
            initial_task: existing?.initial_task ?? task,
            created_at: existing?.created_at ?? now,
            last_active: now,
            is_active: query !== undefined,
        });
        if (query) {
            this.activeQueries.set(sessionId, query);
        }
    }
    /**
     * Mark a session as completed (no longer active)
     *
     * @param sessionId - Session ID
     */
    complete(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.is_active = false;
            session.last_active = new Date();
        }
        this.activeQueries.delete(sessionId);
    }
    /**
     * Get a session by ID
     *
     * @param sessionId - Session ID
     * @returns Session info or undefined
     */
    get(sessionId) {
        return this.sessions.get(sessionId);
    }
    /**
     * Get a session by ID, throwing if not found
     *
     * @param sessionId - Session ID
     * @returns Session info
     * @throws AgentError if session not found
     */
    getOrThrow(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new AgentError(`Session not found: ${sessionId}`, AgentErrorCode.SESSION_NOT_FOUND, { session_id: sessionId });
        }
        return session;
    }
    /**
     * Get the active Query instance for a session
     *
     * @param sessionId - Session ID
     * @returns Query instance or undefined
     */
    getQuery(sessionId) {
        return this.activeQueries.get(sessionId);
    }
    /**
     * List all sessions, optionally filtered
     *
     * @param filter - Optional filter criteria
     * @returns Array of sessions
     */
    list(filter) {
        let sessions = Array.from(this.sessions.values());
        if (filter?.agent) {
            sessions = sessions.filter((s) => s.agent === filter.agent);
        }
        if (filter?.active_only) {
            sessions = sessions.filter((s) => s.is_active);
        }
        // Sort by last_active descending
        return sessions.sort((a, b) => b.last_active.getTime() - a.last_active.getTime());
    }
    /**
     * List sessions as JSON (for MCP responses)
     *
     * @param filter - Optional filter criteria
     * @returns Array of JSON-serializable sessions
     */
    listJSON(filter) {
        return this.list(filter).map((s) => ({
            session_id: s.session_id,
            agent: s.agent,
            initial_task: s.initial_task,
            created_at: s.created_at.toISOString(),
            last_active: s.last_active.toISOString(),
            is_active: s.is_active,
        }));
    }
    /**
     * Check if a session exists
     *
     * @param sessionId - Session ID
     * @returns true if session exists
     */
    has(sessionId) {
        return this.sessions.has(sessionId);
    }
    /**
     * Check if a session is currently active
     *
     * @param sessionId - Session ID
     * @returns true if session is active
     */
    isActive(sessionId) {
        return this.sessions.get(sessionId)?.is_active ?? false;
    }
    /**
     * Cancel/interrupt an active session
     *
     * Any work already completed (files written, etc.) is preserved.
     * The session becomes resumable after cancellation.
     *
     * @param sessionId - Session ID
     * @returns true if session was cancelled
     */
    async cancel(sessionId) {
        const query = this.activeQueries.get(sessionId);
        if (query) {
            try {
                await query.interrupt();
                this.complete(sessionId);
                return true;
            }
            catch (error) {
                console.error(`[SessionStore] Failed to cancel ${sessionId}:`, error);
                // Still mark as complete
                this.complete(sessionId);
                return true;
            }
        }
        return false;
    }
    /**
     * Remove a session from the store
     *
     * @param sessionId - Session ID
     * @returns true if session was removed
     */
    remove(sessionId) {
        this.activeQueries.delete(sessionId);
        return this.sessions.delete(sessionId);
    }
    /**
     * Clear all sessions
     */
    clear() {
        // Cancel all active queries first
        for (const query of this.activeQueries.values()) {
            query.interrupt().catch(() => { });
        }
        this.activeQueries.clear();
        this.sessions.clear();
    }
    /**
     * Get the number of sessions
     */
    get size() {
        return this.sessions.size;
    }
    /**
     * Get the number of active sessions
     */
    get activeCount() {
        return this.activeQueries.size;
    }
}
/**
 * Global session store instance
 */
export const sessionStore = new SessionStore();
//# sourceMappingURL=session-store.js.map