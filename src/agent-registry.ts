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

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import {
  type AgentConfig,
  AgentError,
  AgentErrorCode,
} from './types.js';

/**
 * Manages agent definitions loaded from filesystem
 */
export class AgentRegistry {
  private agents: Map<string, AgentConfig> = new Map();
  private agentsDirs: string[] = [];
  private loaded: boolean = false;

  /**
   * Load agents from a single directory
   */
  async load(agentsDir: string): Promise<void> {
    await this.loadFromMultiple([agentsDir]);
  }

  /**
   * Load agents from multiple directories
   * Later directories take precedence (can override earlier ones)
   *
   * @param dirs - Array of directories to load from
   */
  async loadFromMultiple(dirs: string[]): Promise<void> {
    this.agents.clear();
    this.agentsDirs = dirs;

    for (const dir of dirs) {
      await this.loadDir(dir);
    }

    this.loaded = true;
  }

  /**
   * Load agents from a single directory (internal)
   */
  private async loadDir(agentsDir: string): Promise<void> {
    // Check if directory exists
    try {
      const dirStat = await stat(agentsDir);
      if (!dirStat.isDirectory()) {
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Directory doesn't exist - that's fine
        return;
      }
      throw error;
    }

    // Read all markdown files
    const files = await readdir(agentsDir);
    const mdFiles = files.filter((f) => extname(f).toLowerCase() === '.md');

    // Parse each file
    for (const file of mdFiles) {
      try {
        const filePath = join(agentsDir, file);
        const content = await readFile(filePath, 'utf-8');
        const config = this.parseAgentFile(content, file);

        // Add/override agent
        this.agents.set(config.name, config);
      } catch (error) {
        // Log but continue with other files
        console.error(`[AgentRegistry] Failed to load ${file}:`, (error as Error).message);
      }
    }
  }

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
  private parseAgentFile(content: string, filename: string): AgentConfig {
    // Primary regex: Match frontmatter between --- delimiters
    // Allows multiple newlines/whitespace after closing ---
    let frontmatterMatch = content.match(
      /^---[\t ]*[\r\n]+([\s\S]*?)[\r\n]+---[\t ]*[\r\n]+([\s\S]*)$/
    );

    // Fallback: Try matching without closing --- (some files use blank line as separator)
    if (!frontmatterMatch) {
      frontmatterMatch = content.match(
        /^---[\t ]*[\r\n]+([\s\S]*?)[\r\n]{2,}(#[\s\S]*)$/
      );
      if (frontmatterMatch) {
        console.warn(`[AgentRegistry] ${filename}: No closing ---, using fallback parser`);
      }
    }

    if (!frontmatterMatch) {
      throw new AgentError(
        `Invalid agent file: ${filename} - Missing frontmatter (expected --- delimiters)`,
        AgentErrorCode.INVALID_CONFIG,
        { filename }
      );
    }

    const [, frontmatterRaw, systemPrompt] = frontmatterMatch;

    // Extract fields using lenient regex parsing
    // This handles non-standard YAML like Examples: blocks with <example> tags
    const extracted = this.extractFrontmatterFields(frontmatterRaw, filename);

    return {
      name: extracted.name,
      description: extracted.description,
      model: extracted.model,
      systemPrompt: systemPrompt.trim(),
    };
  }

  /**
   * Extract name, description, and model from frontmatter using lenient regex
   *
   * Handles various formats including:
   * - Single-line values: name: my-agent
   * - Multi-line descriptions with Examples: blocks
   * - Escaped newlines in values: description: line1\n\nline2
   */
  private extractFrontmatterFields(
    frontmatter: string,
    filename: string
  ): { name: string; description: string; model?: string } {
    // Extract name (always single line)
    const nameMatch = frontmatter.match(/^name:\s*(.+?)[\r\n]/m);
    if (!nameMatch) {
      throw new AgentError(
        `Missing 'name' field in ${filename}`,
        AgentErrorCode.INVALID_CONFIG,
        { filename }
      );
    }
    const name = nameMatch[1].trim();

    // Extract description - can be multi-line, ends at next known key or end
    // Known keys: name, description, model, tools, color, Examples
    const descMatch = frontmatter.match(
      /^description:\s*([\s\S]*?)(?=^(?:name|model|tools|color|Examples):|$)/m
    );
    if (!descMatch) {
      throw new AgentError(
        `Missing 'description' field in ${filename}`,
        AgentErrorCode.INVALID_CONFIG,
        { filename }
      );
    }
    // Clean up description: trim, handle escaped newlines, remove trailing Examples if captured
    let description = descMatch[1]
      .replace(/\\n/g, '\n')  // Handle escaped newlines
      .replace(/\n+$/, '')    // Remove trailing newlines
      .trim();

    // If description accidentally captured Examples: block, truncate before it
    const examplesIdx = description.indexOf('\nExamples:');
    if (examplesIdx !== -1) {
      description = description.substring(0, examplesIdx).trim();
    }

    // Extract model (optional, single line)
    // Handle both mid-file and end-of-frontmatter positions
    const modelMatch = frontmatter.match(/^model:\s*(.+?)(?:[\r\n]|$)/m);
    const model = modelMatch ? modelMatch[1].trim() : undefined;

    return { name, description, model };
  }

  /**
   * Get an agent configuration by name
   */
  get(name: string): AgentConfig | undefined {
    return this.agents.get(name);
  }

  /**
   * Get an agent configuration by name, throwing if not found
   */
  getOrThrow(name: string): AgentConfig {
    const config = this.agents.get(name);
    if (!config) {
      throw new AgentError(
        `Agent not found: "${name}". Available: ${this.listNames().join(', ') || 'none'}`,
        AgentErrorCode.AGENT_NOT_FOUND,
        { agent: name, available: this.listNames() }
      );
    }
    return config;
  }

  /**
   * Check if an agent exists
   */
  has(name: string): boolean {
    return this.agents.has(name);
  }

  /**
   * List all loaded agent configurations
   */
  list(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  /**
   * List all agent names
   */
  listNames(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Reload all agents from disk
   */
  async reload(): Promise<void> {
    if (this.agentsDirs.length > 0) {
      await this.loadFromMultiple(this.agentsDirs);
    }
  }

  /**
   * Get the number of loaded agents
   */
  get size(): number {
    return this.agents.size;
  }

  /**
   * Check if the registry has been loaded
   */
  get isLoaded(): boolean {
    return this.loaded;
  }
}

/**
 * Global registry instance
 */
export const registry = new AgentRegistry();
