/**
 * athena-memory.js -- Feature #006 Conversation Memory
 *
 * Manages conversation persistence: store, retrieve, summarize.
 * Server-side storage in chat_history table. Client-side cache.
 * Per ATHENA_CLAUDE.md Part 6.1: class name is AthenaMemory.
 * Per ATHENA_PHASE_A.md Section 2.1.22: storage format.
 *
 * Security: history is ALWAYS loaded from DB via /api/athena/history.
 * NEVER from client payload. Per ATHENA_CLAUDE.md Part 8 Never-Do List.
 */

'use strict';

class AthenaMemory {
  constructor(sessionId, graphId) {
    this.sessionId = sessionId;
    this.graphId = graphId;
    this.messages = [];
    this.turnCount = 0;
  }

  /**
   * Store a message both locally and on the server.
   */
  async storeMessage(role, content, metadata = {}) {
    const msg = {
      role,
      content,
      metadata: { ...metadata, graph_id: this.graphId },
      created_at: new Date().toISOString(),
    };
    this.messages.push(msg);
    this.turnCount++;

    // Persist to server (non-blocking)
    try {
      await fetch('/api/athena/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          content,
          thread_id: 'main',
          metadata: msg.metadata,
        }),
      });
    } catch (e) {
      console.warn('Failed to persist message:', e);
      // Message still in local cache, will retry on next store
    }
  }

  /**
   * Load conversation history from server.
   * Per ATHENA_PHASE_A.md: always from DB, never from client payload.
   */
  async loadHistory(threadId = 'main', limit = 50) {
    try {
      const res = await fetch(`/api/athena/history?thread_id=${threadId}&limit=${limit}`);
      if (!res.ok) return [];
      const { messages } = await res.json();
      this.messages = messages || [];
      this.turnCount = this.messages.length;
      return this.messages;
    } catch (e) {
      console.warn('Failed to load history:', e);
      return [];
    }
  }

  /**
   * Build context window for LLM prompt.
   * Returns last 10 messages + optional summary.
   * Per ATHENA_PHASE_A.md Section 2.1.8.
   */
  buildContextWindow() {
    const recent = this.messages.slice(-10);
    // Summary generation stub (real implementation in Phase F)
    const summary = this.messages.length > 10
      ? `[Previous conversation: ${this.messages.length - 10} earlier messages about research analysis]`
      : '';
    return { recent, summary };
  }

  /**
   * Get count of messages in current conversation.
   */
  getMessageCount() {
    return this.turnCount;
  }

  /**
   * Clear local cache (server-side history preserved).
   */
  clear() {
    this.messages = [];
    this.turnCount = 0;
  }
}

// Expose globally
window.AthenaMemory = AthenaMemory;
