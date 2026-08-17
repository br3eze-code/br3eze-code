import fs from 'node:fs/promises';
import path from 'node:path';
import { Logger } from '../utils/logger.js';
import { resolveRuntimeConfig } from './runtime-config.js';

/**
 * Session Manager
 */


class SessionManager {
  constructor(options = {}) {
    const runtime = options.runtimeConfig || resolveRuntimeConfig();
    this.basePath = options.basePath || runtime.storyline.basePath || path.join(process.cwd(), 'data/sessions');
    this.mode = options.mode || runtime.storyline.defaultMode;
    this.logger = new Logger('SessionManager');
    this.cache = new Map();
    this.maxCacheSize = options.maxCacheSize ?? runtime.storyline.maxCacheEntries;
    this.sessionTtlMs = options.sessionTtlMs ?? runtime.storyline.sessionTtlMs;
    this.compactKeepLast = options.compactKeepLast ?? runtime.storyline.compactKeepLast;
    this.summaryMaxChars = options.summaryMaxChars ?? runtime.storyline.summaryMaxChars;
    this.systemSummaryLabel = options.systemSummaryLabel || runtime.storyline.systemSummaryLabel;
  }
  
  async initialize() {
    // Ensure base directory exists
    await fs.mkdir(this.basePath, { recursive: true });
    this.logger.info(`Session manager initialized: ${this.basePath} (${this.mode} mode)`);
  }
  
  /**
   * Get session ID for a frame
   * OpenClaw: isolated per sender in DM mode, shared in channel mode
   */
  getSessionId(frame = {}) {
    const agentId = this._safeSegment(frame.agentId || 'default');
    const context = frame.context || {};
    const channel = this._safeSegment(frame.channel || context.channel || 'unknown');
    const sender = this._safeSegment(frame.sender || context.platformId || context.userId || 'anonymous');
    const tenant = this._safeSegment(frame.tenantId || context.tenantId || context.scopes?.tenantId || 'public');
    const domain = this._safeSegment(frame.domain || context.domain || context.scopes?.domain || 'general');
    const site = this._safeSegment(frame.siteId || context.siteId || context.scopes?.siteId || 'all-sites');
    const conversation = this._safeSegment(
      frame.conversationId || context.conversationId || frame.threadId || 'main'
    );

    // Per-user context is the safe default for every channel. A shared room
    // identifier must not merge private history, role-aware UI, OAuth context,
    // or tool state between participants.
    const userScoped = path.join(agentId, tenant, domain, site, channel, sender, conversation);
    if (this.mode === 'shared' && (frame.allowSharedContext || context.allowSharedContext)) {
      return path.join(agentId, tenant, domain, site, channel, conversation);
    }
    return userScoped;
  }

  _safeSegment(value) {
    return String(value)
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 160) || 'unknown';
  }
  
  /**
   * Load session history
   */
  async load(sessionId) {
    // Check cache first
    if (this.cache.has(sessionId)) {
      return this.cache.get(sessionId);
    }
    
    const sessionPath = this.getSessionPath(sessionId);
    
    try {
      const content = await fs.readFile(sessionPath, 'utf8');
      const lines = content.split('\\n').filter(Boolean);
      const history = lines.map(line => JSON.parse(line));
      
      // Add to cache
      this.addToCache(sessionId, history);
      
      return history;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // New session
        return [];
      }
      throw error;
    }
  }
  
  /**
   * Save session history
   */
  async save(sessionId, history) {
    const sessionPath = this.getSessionPath(sessionId);
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    
    // Write as JSONL (one JSON object per line)
    const content = history.map(entry => JSON.stringify(entry)).join('\\n') + '\\n';
    await fs.writeFile(sessionPath, content);
    
    // Update cache
    this.addToCache(sessionId, history);
  }
  
  /**
   * Append to session
   */
  async append(sessionId, entry) {
    const sessionPath = this.getSessionPath(sessionId);
    
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    
    const line = JSON.stringify(entry) + '\\n';
    await fs.appendFile(sessionPath, line);
    
    // Update cache
    const history = this.cache.get(sessionId) || [];
    history.push(entry);
    this.addToCache(sessionId, history);
  }
  
  /**
   * Compact session to prevent infinite growth
   */
  async compact(sessionId, keepLast = this.compactKeepLast) {
    const history = await this.load(sessionId);
    
    if (history.length <= keepLast + 5) return; // No need to compact
    
    // Find system prompt
    const systemPrompt = history.find(h => h.role === 'system');
    
    // Keep recent messages
    const recent = history.slice(-keepLast);
    
    // Create summary of older messages (simplified)
    const older = history.slice(0, -keepLast);
    const summary = this.summarizeHistory(older);
    
    const compacted = [
      systemPrompt,
      { 
        role: 'system', 
                content: `[${this.systemSummaryLabel}: ${summary}]`
      },
      ...recent
    ].filter(Boolean);
    
    await this.save(sessionId, compacted);
    this.logger.debug(`Compacted session ${sessionId}: ${history.length} -> ${compacted.length}`);
  }
  
  /**
   * Simple summarization (in production, use LLM)
   */
  summarizeHistory(history) {
    const userMessages = history.filter(h => h.role === 'user');
    const toolCalls = history.filter(h => h.role === 'tool').length;
    
    if (userMessages.length === 0) return 'No prior context';
    
    const topics = userMessages.slice(-3).map(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return content.substring(0, this.summaryMaxChars);
    }).join('; ');
    
    return `${userMessages.length} messages, ${toolCalls} tool calls. Recent: ${topics}...`;
  }
  
  /**
   * Clear session
   */
  async clear(sessionId) {
    const sessionPath = this.getSessionPath(sessionId);
    
    try {
      await fs.unlink(sessionPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    
    this.cache.delete(sessionId);
  }
  
  /**
   * Get session statistics
   */
  async getStats() {
    try {
      const entries = await fs.readdir(this.basePath, { recursive: true });
      const sessionFiles = entries.filter(e => e.endsWith('.jsonl'));
      
      return {
        totalSessions: sessionFiles.length,
        cachedSessions: this.cache.size,
        mode: this.mode
      };
    } catch (error) {
      return { totalSessions: 0, cachedSessions: this.cache.size, mode: this.mode };
    }
  }
  
  /**
   * Get filesystem path for session
   */
  getSessionPath(sessionId) {
    // Ensure safe path
    const safeId = sessionId.replace(/\.+/g, '.').replace(/[^a-zA-Z0-9_\-\/\\]/g, '_');
    return path.join(this.basePath, `${safeId}.jsonl`);
  }
  
  /**
   * Add to cache with LRU eviction
   */
  addToCache(sessionId, history) {
    if (this.cache.size >= this.maxCacheSize) {
      // Evict oldest
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(sessionId, history);
  }
}

export { SessionManager };

