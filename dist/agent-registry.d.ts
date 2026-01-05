/**
 * Agent Registry - Loads agent definitions from .claude/agents/ directories
 *
 * Agents are loaded from:
 * 1. {cwd}/.claude/agents/ (project-level)
 * 2. ~/.claude/agents/ (user-level)
 *
 * Project-level agents override user-level agents with the same name.
 *
 * Agent format (same as Claude Code):
 * ```markdown
 * ---
 * name: agent-name
 * description: Description with optional <example> blocks
 * ---
 *
 * # System Prompt
 * ...
 * ```
 */
import { type AgentConfig } from './types.js';
/**
 * Manages agent definitions loaded from filesystem
 */
export declare class AgentRegistry {
    private agents;
    private agentsDirs;
    private loaded;
    /**
     * Load agents from a single directory
     */
    load(agentsDir: string): Promise<void>;
    /**
     * Load agents from multiple directories
     * Later directories take precedence (can override earlier ones)
     *
     * @param dirs - Array of directories to load from
     */
    loadFromMultiple(dirs: string[]): Promise<void>;
    /**
     * Load agents from a single directory (internal)
     */
    private loadDir;
    /**
     * Parse a markdown agent definition file
     *
     * Uses lenient parsing to handle various frontmatter formats:
     * - Standard YAML frontmatter with --- delimiters
     * - Frontmatter with Examples: blocks (common in Claude Code agents)
     * - Files with or without closing ---
     *
     * Extracts name, description, and optional model using regex
     * rather than strict YAML parsing for compatibility.
     */
    private parseAgentFile;
    /**
     * Extract name, description, and model from frontmatter using lenient regex
     *
     * Handles various formats including:
     * - Single-line values: name: my-agent
     * - Multi-line descriptions with Examples: blocks
     * - Escaped newlines in values: description: line1\n\nline2
     */
    private extractFrontmatterFields;
    /**
     * Get an agent configuration by name
     */
    get(name: string): AgentConfig | undefined;
    /**
     * Get an agent configuration by name, throwing if not found
     */
    getOrThrow(name: string): AgentConfig;
    /**
     * Check if an agent exists
     */
    has(name: string): boolean;
    /**
     * List all loaded agent configurations
     */
    list(): AgentConfig[];
    /**
     * List all agent names
     */
    listNames(): string[];
    /**
     * Reload all agents from disk
     */
    reload(): Promise<void>;
    /**
     * Get the number of loaded agents
     */
    get size(): number;
    /**
     * Check if the registry has been loaded
     */
    get isLoaded(): boolean;
}
/**
 * Global registry instance
 */
export declare const registry: AgentRegistry;
//# sourceMappingURL=agent-registry.d.ts.map