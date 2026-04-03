/**
 * athena-engine.js -- Feature #037 Streaming Text + Features #073, #038, #046,
 * #072, #002, #054, #057, #041, #044, #006, #047, #001, #123
 *
 * Main controller for Athena chat. Handles:
 * - SSE connection lifecycle (Feature #037)
 * - Token streaming + cursor (Features #037, #073)
 * - Markdown rendering (Feature #038)
 * - Typing indicator (Feature #046)
 * - Typing animation (Feature #072)
 * - Block rendering (Feature #002)
 * - Thinking/reasoning display (Feature #054)
 * - Progress indicators (Feature #057)
 * - Stop generation (Feature #041)
 * - Multi-turn context (Feature #044)
 * - Conversation memory (Feature #006)
 * - New chat / clear (Feature #047)
 * - Context-aware responses (Feature #001)
 * - Template prompts (Feature #123)
 *
 * Per ATHENA_CLAUDE.md Part 6.1: class name is AthenaEngine.
 * Per ATHENA_PHASE_A.md Section 2.1.17: method evolution per feature.
 * Per ATHENA_PHASE_A.md Section 2.1.1: message flow protocol.
 *
 * MUST be loaded LAST among Athena scripts (listens for events from others).
 */

'use strict';

class AthenaEngine {
  constructor() {
    this.messagesContainer = document.querySelector('.athena-messages');
    this.panel = document.getElementById('athena-panel');
    if (!this.messagesContainer) return;
    this.threadId = 'main'; // Default thread, changes on New Chat

    // State
    this.isStreaming = false;
    this.currentMessageId = null;
    this.currentAssistantEl = null;
    this.currentProseEl = null;
    this.eventSource = null;
    this.fullResponseText = '';
    this.messageCount = 0;

    // Conversation memory (Feature #006)
    this.memory = (typeof AthenaMemory !== 'undefined')
      ? new AthenaMemory(null, window._arivuGraph?.metadata?.graph_id || null)
      : null;

    // Auto-scroll (Feature #073 / Section 2.1.6)
    this.autoScroller = new AutoScroller(this.messagesContainer);

    // Scroll-to-bottom button
    this.scrollBtn = document.querySelector('.athena-scroll-bottom');
    if (this.scrollBtn) {
      this.scrollBtn.addEventListener('click', () => {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        this.autoScroller.userScrolledUp = false;
        this.scrollBtn.classList.remove('visible');
      });
    }

    this._listen();
    this._loadHistory();
    this._showTemplatesIfEmpty();
  }

  // ── Event Listeners ─────────────────────────────────────────────────────

  _listen() {
    // From AthenaInput (Feature #050)
    document.addEventListener('athena:send', (e) => {
      this.handleUserMessage(e.detail.message);
    });

    // Stop generation (Feature #041)
    document.addEventListener('athena:stop-generation', () => {
      this.stopGeneration();
    });

    // New chat button (Feature #047)
    const newChatBtn = this.panel?.querySelector('.athena-newchat-btn');
    if (newChatBtn) {
      newChatBtn.addEventListener('click', () => this.clearConversation());
    }

    // Load conversation from history sidebar (Feature #048)
    document.addEventListener('athena:session-load', async (e) => {
      const threadId = e.detail?.thread_id;
      if (!threadId) return;
      // Switch to this thread
      this.threadId = threadId;
      this.messagesContainer.innerHTML = '';
      this.messageCount = 0;
      this.fullResponseText = '';
      this.currentAssistantEl = null;
      this.currentProseEl = null;
      // Load messages for this thread
      await this._loadHistory();
    });

    // Listen for graph ready event to update Athena when graph loads
    window.addEventListener('arivu:graph-ready', () => {
      // Update system message to reflect graph is now loaded
      const sysMsg = this.messagesContainer?.querySelector('.msg-system .msg-system-text');
      if (sysMsg && window._arivuGraph?.metadata) {
        const meta = window._arivuGraph.metadata;
        const nodeCount = window._arivuGraph.allNodes?.length || 0;
        sysMsg.textContent = `Analyzing ${meta.seed_paper_title || 'paper'} lineage (${nodeCount} papers). Ask me anything.`;
      }
      // If no messages yet, refresh templates with graph-aware versions
      if (this.messageCount === 0) {
        const existing = this.messagesContainer?.querySelector('.athena-templates');
        if (existing) existing.remove();
        this._showTemplatesIfEmpty();
      }
      // Phase C #105: Clear stale click context on graph reload
      this._clearClickContext();
    });

    // Phase C #105: Click-Aware Chat -- listen for graph node/edge clicks
    document.addEventListener('athena:graph:click', (e) => {
      const detail = e.detail;
      if (!detail) return;

      // Store click context
      this._clickContext = {
        type: detail.type,
        node: detail.node || null,
        edge: detail.edge || null,
        timestamp: Date.now(),
      };

      // Reset staleness timer (5 minutes)
      if (this._clickStalenessTimer) clearTimeout(this._clickStalenessTimer);
      this._clickStalenessTimer = setTimeout(() => {
        this._clearClickContext();
      }, 5 * 60 * 1000);

      // Notify input area to render context chip
      document.dispatchEvent(new CustomEvent('athena:context-chip-update', {
        detail: this._clickContext,
      }));

      // Phase C #020: Auto-show citation evidence on edge click
      if (detail.type === 'edge' && detail.edge?.edge_id) {
        this._fetchAndShowCitationEvidence(detail.edge);
      }
    });

    // Phase C #105: Listen for context chip dismiss (from AthenaInput dismiss button)
    document.addEventListener('athena:click-context-cleared', () => {
      // Clear internal state (no re-dispatch since event already fired)
      this._clickContext = null;
      if (this._clickStalenessTimer) {
        clearTimeout(this._clickStalenessTimer);
        this._clickStalenessTimer = null;
      }
    });

    // Phase C #108: Listen for prune events
    document.addEventListener('athena:graph:prune', (e) => {
      const detail = e.detail;
      if (!detail) return;

      if (detail.phase === 'start') {
        // Prune started — show loading chip
        this._pruneContext = {
          phase: 'start',
          pruned_paper_id: detail.pruned_paper_id,
          pruned_paper_title: detail.pruned_paper_title,
        };
        document.dispatchEvent(new CustomEvent('athena:context-chip-update', {
          detail: {
            type: 'prune-start',
            prune: { title: detail.pruned_paper_title || 'paper' },
          }
        }));
      } else if (detail.phase === 'complete') {
        // Prune complete — update chip with results, store full context
        this._pruneContext = {
          phase: 'complete',
          pruned_paper_id: detail.pruned_paper_id,
          pruned_paper_title: detail.pruned_paper_title,
          collapsed_nodes: detail.collapsed_nodes || [],
          surviving_nodes: detail.surviving_nodes || [],
          impact_percentage: detail.impact_percentage || 0,
          collapsed_count: detail.collapsed_count || 0,
        };
        // Prune context replaces click context (higher priority per spec)
        this._clearClickContext();
        document.dispatchEvent(new CustomEvent('athena:context-chip-update', {
          detail: {
            type: 'prune',
            prune: this._pruneContext,
          }
        }));
      } else if (detail.phase === 'reset') {
        // Prune reset — clear chip and context
        this._pruneContext = null;
        document.dispatchEvent(new CustomEvent('athena:prune-context-cleared'));
      }
    });

    // Phase C #108: Listen for prune chip dismiss
    document.addEventListener('athena:prune-context-cleared', () => {
      this._pruneContext = null;
    });

    // Phase C #106: Zoom-Aware Chat — passive context, no chip
    document.addEventListener('athena:graph:zoom', (e) => {
      const detail = e.detail;
      if (!detail) return;
      const k = detail.zoom_level || 1;
      this._zoomContext = {
        level: k < 0.5 ? 'overview' : k > 2.0 ? 'detail' : 'normal',
        visible_count: detail.visible_count || 0,
        cluster_focus: detail.cluster_focus || null,
      };
    });

    // Phase C #004: Discuss Integration — right-click "Discuss with Athena"
    document.addEventListener('athena:discuss:request', (e) => {
      const detail = e.detail;
      if (!detail?.paper_id) return;

      // Open Athena panel if not already open (CRITICAL-1 fix: use toggle(), not open())
      if (window.athenaLayout && !window.athenaLayout.isOpen) {
        window.athenaLayout.toggle();
      }

      // Show system message first (CRITICAL-3 fix: ghost/system message per spec)
      const title = detail.title || 'this paper';
      const year = detail.year ? ` (${detail.year})` : '';
      this._appendSystemMessage(`Starting discussion about ${title}${year}. Analyzing graph context...`);

      // Send a structured discuss message through the regular pipeline
      // The click context (set by athena:graph:click before this event) provides
      // the computed graph data via the awareness state. The message text tells
      // the LLM what to focus on.
      const discussMessage = `Analyze "${title}"${year} in detail. What is its structural role, impact, and significance in this lineage? Include its key relationships and metrics.`;

      // Queue the message (HIGH-4 fix: if streaming, wait then retry)
      if (this.isStreaming) {
        // Wait for current stream to finish, then send
        const waitForStream = () => {
          if (!this.isStreaming) {
            this.handleUserMessage(discussMessage);
          } else {
            setTimeout(waitForStream, 500);
          }
        };
        setTimeout(waitForStream, 500);
      } else {
        this.handleUserMessage(discussMessage);
      }
    });

    // Phase C #107: Filter-Aware Chat — passive context, no chip
    document.addEventListener('athena:graph:filter', (e) => {
      const detail = e.detail;
      if (!detail) return;
      const activeFilter = detail.active_filters?.display_filter;
      if (activeFilter) {
        this._filterContext = {
          filter_name: activeFilter,
          visible_count: detail.visible_count || 0,
          hidden_count: detail.hidden_count || 0,
        };
      } else {
        // "Most Relevant" = no filter = clear context
        this._filterContext = null;
      }
    });
  }

  /**
   * Phase C #105: Clear click context and staleness timer.
   * Dispatches athena:click-context-cleared to remove the chip from AthenaInput.
   */
  /**
   * Phase C #020: Citation Sentence Viewer.
   * Auto-fetches citation evidence from the server when an edge is clicked.
   * Renders inline as a citation_evidence block in the chat, without needing
   * the user to ask a question first.
   */
  async _fetchAndShowCitationEvidence(edgeData) {
    if (!edgeData?.edge_id) return;

    // Don't fetch if Athena panel is not visible
    const panel = document.querySelector('.athena-panel-container');
    if (!panel || panel.classList.contains('hidden')) return;

    // Cache check — don't re-fetch for the same edge in this session
    const cacheKey = `citation_${edgeData.edge_id}`;
    const cachedRaw = sessionStorage.getItem(cacheKey);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw);
        if (cached._skip) return; // Previously determined: no meaningful data
        this._renderCitationBlock(cached);
        return;
      } catch (e) { /* re-fetch */ }
    }

    try {
      const resp = await fetch(`/api/edge/${encodeURIComponent(edgeData.edge_id)}/citation`);
      if (!resp.ok) return; // Silently skip if edge not in DB

      const citation = await resp.json();

      // DON'T show the block if edge has no meaningful analysis.
      // If mutation_type is "incidental" AND confidence < 0.35 AND no sentences,
      // the NLP pipeline never ran Stage 2 — showing default values is misleading.
      const hasRealAnalysis = (
        (citation.citing_sentence && citation.citing_sentence.trim()) ||
        (citation.cited_sentence && citation.cited_sentence.trim()) ||
        (citation.mutation_type && citation.mutation_type !== 'incidental') ||
        (citation.confidence && citation.confidence >= 0.35)
      );

      if (!hasRealAnalysis) {
        // Cache the "skip" decision so we don't re-fetch
        sessionStorage.setItem(cacheKey, JSON.stringify({ _skip: true }));
        return;
      }

      // Cache for this session
      sessionStorage.setItem(cacheKey, JSON.stringify(citation));

      this._renderCitationBlock(citation);
    } catch (err) {
      console.warn('Citation evidence fetch failed:', err);
    }
  }

  /**
   * Render citation evidence as an inline assistant message block.
   */
  _renderCitationBlock(citation) {
    // Create an assistant message bubble to hold the citation block
    const assistantEl = this._createAssistantBubble();
    const contentEl = assistantEl.querySelector('.msg-content');
    if (!contentEl) return;

    // Render the block via BlockFactory
    if (typeof BlockFactory !== 'undefined') {
      const blockEl = BlockFactory.render({
        type: 'citation_evidence',
        provenance: 'computed',
        data: citation,
      });
      contentEl.appendChild(blockEl);
    }

    this.autoScroller.scrollToBottom();
  }

  /**
   * Create a minimal assistant message bubble for auto-generated blocks.
   * Returns the outer wrapper element (already appended to chat).
   */
  _createAssistantBubble() {
    const wrapper = document.createElement('div');
    wrapper.className = 'athena-msg athena-msg--assistant';

    const content = document.createElement('div');
    content.className = 'msg-content';
    wrapper.appendChild(content);

    const timestamp = document.createElement('div');
    timestamp.className = 'msg-timestamp';
    const now = new Date();
    timestamp.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    wrapper.appendChild(timestamp);

    const container = document.querySelector('.athena-messages');
    if (container) container.appendChild(wrapper);

    return wrapper;
  }

  _clearClickContext() {
    const wasActive = this._clickContext !== null;
    this._clickContext = null;
    if (this._clickStalenessTimer) {
      clearTimeout(this._clickStalenessTimer);
      this._clickStalenessTimer = null;
    }
    // Only dispatch if context was actually cleared (prevents spurious events)
    if (wasActive) {
      document.dispatchEvent(new CustomEvent('athena:click-context-cleared'));
    }
  }

  // ── Handle User Message (Feature #037) ──────────────────────────────────

  async handleUserMessage(text) {
    if (this.isStreaming) return;
    if (!text.trim()) return;

    // Phase C #034: Check for traversal control commands
    if (this._traversalState) {
      const lower = text.toLowerCase().trim();
      if (lower === 'stop' || lower === 'halt' || lower === 'cancel') {
        this._traversalState.stopped = true;
        this._traversalState = null;
        this._appendSystemMessage('Traversal stopped.');
        return;
      }
      if (lower === 'continue' || lower === 'resume' || lower === 'next') {
        this._traversalState.paused = false;
        this._appendSystemMessage('Resuming traversal...');
        this._executeTraversalStep();
        return;
      }
      if (lower === 'skip') {
        this._traversalState.currentStep++;
        this._traversalState.paused = false;
        this._appendSystemMessage('Skipping to next step...');
        this._executeTraversalStep();
        return;
      }
      // Any other message pauses the traversal
      this._traversalState.paused = true;
      this._appendSystemMessage('Traversal paused. Type "continue" to resume or "stop" to end.');
    }

    // Check for slash commands BEFORE sending to backend (Feature #056)
    if (text.startsWith('/') && window.athenaSlashCommands) {
      const parsed = window.athenaSlashCommands.parseSlashCommand(text);
      if (parsed && parsed.command) {
        const cmd = window.athenaSlashCommands.commands.find(
          c => c.command === parsed.command || c.command === '/' + parsed.command
        );
        if (cmd) {
          cmd.handler(parsed.args);
          return; // Handled locally, don't send to backend
        }
      }
    }

    // Hide templates on first message (Feature #123)
    this._hideTemplates();

    // B-29: Remove previous follow-up pills
    this._removeFollowups();

    // B-30: Remove previous quick actions
    const prevActions = this.messagesContainer.querySelectorAll('.athena-quick-actions');
    prevActions.forEach(el => el.remove());

    // Render user message in DOM
    this._appendUserMessage(text);

    // Show typing indicator (Feature #046)
    this._showTypingIndicator();

    // Dispatch stream-start
    this.isStreaming = true;
    document.dispatchEvent(new CustomEvent('athena:stream-start'));

    try {
      // POST /api/athena/send (per Section 2.1.1)
      const graphId = window._arivuGraph?.metadata?.graph_id || null;
      const awareness = this._getAwarenessState();

      // Phase C #105: Pronoun resolution -- replace "this paper" / "that paper"
      // with actual title from click context. Only in the message sent to backend,
      // NOT in the displayed user message (already rendered above).
      let resolvedText = text;
      if (this._clickContext?.type === 'node' && this._clickContext?.node?.title) {
        const title = this._clickContext.node.title;
        resolvedText = resolvedText.replace(
          /\b(this|that|the selected|the clicked)\s+paper\b/gi,
          `"${title}"`
        );
      } else if (this._clickContext?.type === 'edge' && this._clickContext?.edge) {
        const e = this._clickContext.edge;
        const edgeLabel = `${e.citing_title || 'citing paper'} -> ${e.cited_title || 'cited paper'}`;
        resolvedText = resolvedText.replace(
          /\b(this|that|the selected|the clicked)\s+(edge|connection|link|relationship)\b/gi,
          `the edge "${edgeLabel}"`
        );
      }

      const res = await fetch('/api/athena/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: resolvedText,
          graph_id: graphId,
          thread_id: this.threadId,
          awareness: awareness,
          mode: window.athenaModeSelector?.getMode() || 'default',
        }),
      });

      if (!res.ok) {
        this._hideTypingIndicator();
        this._showError('Failed to send message. Please try again.');
        this._endStream();
        return;
      }

      const { message_id } = await res.json();
      this.currentMessageId = message_id;

      // Connect EventSource (per Section 2.1.1 step 7)
      this._connectSSE(message_id);
    } catch (err) {
      console.error('Athena send failed:', err);
      this._hideTypingIndicator();
      this._showError('Connection error. Please try again.');
      this._endStream();
    }
  }

  // ── SSE Connection (Feature #037) ───────────────────────────────────────

  _connectSSE(messageId) {
    if (this.eventSource) {
      this.eventSource.close();
    }

    const url = `/api/athena/stream?message_id=${encodeURIComponent(messageId)}`;
    this.eventSource = new EventSource(url);
    this._retryCount = 0;

    // Listen for all event types per ATHENA_CLAUDE.md Part 4.5
    const eventTypes = [
      'thinking_step', 'thinking_done', 'block', 'prose',
      'progress', 'followups', 'enrichment', 'confidence',
      'mode_state', 'artifact', 'error', 'done',
      'command',  // Phase C #005: Graph commands
      'section_start',  // Phase C #016: Deep Dive sections
      'traversal_plan'  // Phase C #034: Guided navigation
    ];

    eventTypes.forEach(type => {
      this.eventSource.addEventListener(type, (e) => {
        if (!e.data || e.data === 'undefined') return;
        try {
          const data = JSON.parse(e.data);
          this._handleSSEEvent(type, data);
        } catch (err) {
          console.warn(`SSE event '${type}' parse skipped:`, e.data);
        }
      });
    });

    this.eventSource.onerror = () => {
      // If stream already ended (done event received), do NOT reconnect
      if (!this.isStreaming || !this.eventSource) {
        return;
      }
      if (this._retryCount < 2) {
        this._retryCount++;
        console.warn(`SSE reconnecting (attempt ${this._retryCount})...`);
      } else {
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }
        this._showError('Connection lost. Please try again.');
        this._endStream();
      }
    };
  }

  _handleSSEEvent(type, data) {
    switch (type) {
      case 'thinking_step':
        this._handleThinkingStep(data);
        break;
      case 'thinking_done':
        this._handleThinkingDone(data);
        break;
      case 'block':
        this._handleBlock(data);
        break;
      case 'prose':
        this._handleProse(data);
        break;
      case 'progress':
        this._handleProgress(data);
        break;
      case 'done':
        this._handleDone(data);
        break;
      case 'error':
        this._handleErrorEvent(data);
        break;
      case 'followups':
        this._handleFollowups(data);
        break;
      case 'confidence':
        this._handleConfidence(data);
        break;
      case 'command':
        // Phase C #005: Graph command — dispatch to graph command executor
        document.dispatchEvent(new CustomEvent('athena:command:execute', { detail: data }));
        break;
      case 'section_start':
        // Phase C #016: Deep Dive section — create collapsible container
        this._handleSectionStart(data);
        break;
      case 'traversal_plan':
        // Phase C #034: Guided navigation — execute step-by-step
        this._handleTraversalPlan(data);
        break;
      case 'mode_state':
        // Mode state acknowledgment (Phase E full)
        break;
      case 'enrichment':
        this._handleEnrichment(data);
        break;
    }
  }

  // ── Prose Handling (Feature #037) ───────────────────────────────────────

  /**
   * Phase C #016: Deep Dive section start handler.
   * Creates a collapsible <details> section and sets it as the current
   * prose target, so subsequent 'prose' events stream into it.
   */
  _handleSectionStart(data) {
    this._hideTypingIndicator();

    if (!this.currentAssistantEl) {
      this.currentAssistantEl = this._appendAssistantMessage();
    }
    const contentEl = this.currentAssistantEl.querySelector('.msg-content');
    if (!contentEl) return;

    const sectionNum = data.section || 1;
    const sectionTitle = data.title || `Section ${sectionNum}`;

    // Create collapsible section
    const details = document.createElement('details');
    details.className = 'deep-dive-section';
    details.open = true; // Start expanded
    details.dataset.section = sectionNum;

    const summary = document.createElement('summary');
    summary.className = 'deep-dive-section-header';
    summary.innerHTML = `<span class="deep-dive-section-num">${sectionNum}</span> <span class="deep-dive-section-title">${this._escapeHtml(sectionTitle)}</span>`;
    details.appendChild(summary);

    const sectionContent = document.createElement('div');
    sectionContent.className = 'deep-dive-section-content';
    details.appendChild(sectionContent);

    contentEl.appendChild(details);

    // Set the new section content as the current prose target
    // so _handleProse streams into it instead of the main msg-content
    this.currentProseEl = document.createElement('div');
    this.currentProseEl.className = 'msg-prose';
    sectionContent.appendChild(this.currentProseEl);

    this.autoScroller.scrollToBottom();
  }

  /**
   * Phase C #034: Chat-Driven Graph Navigation.
   * Receives a full traversal plan and executes it step-by-step
   * with zoom + highlight + narration animations.
   */
  _handleTraversalPlan(plan) {
    if (!plan?.steps?.length) return;

    this._hideTypingIndicator();

    // Store traversal state for pause/resume/stop
    this._traversalState = {
      plan: plan,
      currentStep: 0,
      paused: false,
      stopped: false,
    };

    // Execute the first step after a brief delay
    setTimeout(() => this._executeTraversalStep(), 500);
  }

  async _executeTraversalStep() {
    const state = this._traversalState;
    if (!state || state.stopped || state.currentStep >= state.plan.steps.length) {
      // Traversal complete — add replay button
      if (state && this.currentAssistantEl) {
        const contentEl = this.currentAssistantEl.querySelector('.msg-content');
        if (contentEl && !contentEl.querySelector('.traversal-replay-btn')) {
          const plan = state.plan;
          const replayBtn = document.createElement('button');
          replayBtn.className = 'traversal-replay-btn';
          replayBtn.textContent = '▶ Replay Tour';
          replayBtn.addEventListener('click', () => {
            this._replayTraversalAnimation(plan);
          });
          contentEl.appendChild(replayBtn);
        }
      }
      this._traversalState = null;
      return;
    }

    if (state.paused) return; // Will resume when user types "continue"

    const step = state.plan.steps[state.currentStep];
    const commands = window.athenaGraphCommands;
    const graph = window._arivuGraph;
    const tree = window._treeLayout;

    // 1. Zoom to the target paper (600ms)
    if (commands && step.to_paper_id) {
      commands.executeCommand({ action: 'zoom', target: step.to_title || step.to_paper_id });
    }

    // 2. Wait for zoom to settle (800ms total)
    await new Promise(r => setTimeout(r, 800));

    // 3. Highlight the edge if exists (200ms)
    if (step.edge_id && step.from_paper_id) {
      const fromId = step.from_paper_id;
      const toId = step.to_paper_id;
      if (graph?.edgeElements) {
        graph.edgeElements
          .filter(d => {
            const src = typeof d.source === 'object' ? d.source.id : d.source;
            const tgt = typeof d.target === 'object' ? d.target.id : d.target;
            return (src === fromId && tgt === toId) || (src === toId && tgt === fromId);
          })
          .transition().duration(200)
          .attr('stroke', '#D4A843').attr('stroke-width', 3).attr('stroke-opacity', 1);
      }
    }

    // 4. Highlight the target node with gold pulse
    if (step.to_paper_id) {
      if (graph?.nodeElements) {
        graph.nodeElements
          .filter(d => d.id === step.to_paper_id)
          .select('circle')
          .transition().duration(200)
          .attr('stroke', '#D4A843').attr('stroke-width', 4);
      }
      if (tree?.nodeGroup) {
        tree.nodeGroup.selectAll('g.tree-node')
          .filter(d => (d.data?.data?.id || d.data?.id) === step.to_paper_id)
          .select('rect.node-rect')
          .transition().duration(200)
          .style('stroke', '#D4A843').style('stroke-width', '4px');
      }
    }

    // 5. Show narration as a chat message
    if (step.narration && !state.stopped) {
      if (!this.currentAssistantEl) {
        this.currentAssistantEl = this._appendAssistantMessage();
      }
      const contentEl = this.currentAssistantEl.querySelector('.msg-content');
      if (contentEl) {
        const stepEl = document.createElement('div');
        stepEl.className = 'traversal-step';
        stepEl.dataset.step = step.step_index;

        const stepNum = document.createElement('span');
        stepNum.className = 'traversal-step-num';
        stepNum.textContent = step.step_index + 1;

        const narrationEl = document.createElement('span');
        narrationEl.className = 'traversal-step-narration';
        let rendered = this._renderMarkdownFull(step.narration);
        rendered = this._processCitations(rendered);
        narrationEl.innerHTML = rendered;

        stepEl.appendChild(stepNum);
        stepEl.appendChild(narrationEl);
        contentEl.appendChild(stepEl);
        this.autoScroller.scrollToBottom();
      }
    }

    // 6. Post-narration pause (1500ms)
    await new Promise(r => setTimeout(r, 1500));

    // 7. Clear highlights (restore normal appearance)
    if (graph?.edgeElements) {
      graph.edgeElements
        .transition().duration(150)
        .attr('stroke', '#64748B').attr('stroke-width', 1).attr('stroke-opacity', 0.4);
    }
    if (graph?.nodeElements) {
      graph.nodeElements
        .select('circle')
        .transition().duration(150)
        .attr('stroke', null).attr('stroke-width', 1);
    }

    // 8. Advance to next step
    if (!state.stopped && !state.paused) {
      state.currentStep++;
      this._executeTraversalStep();
    }
  }

  /**
   * Replay traversal animation ONLY — zoom + highlight on graph,
   * no new chat messages. Used by the ▶ Replay Tour button.
   */
  async _replayTraversalAnimation(plan) {
    if (!plan?.steps?.length) return;

    const commands = window.athenaGraphCommands;
    const graph = window._arivuGraph;

    for (const step of plan.steps) {
      // Zoom to paper
      if (commands && step.to_title) {
        commands.executeCommand({ action: 'zoom', target: step.to_title || step.to_paper_id });
      }
      await new Promise(r => setTimeout(r, 800));

      // Highlight edge
      if (step.from_paper_id && step.to_paper_id && graph?.edgeElements) {
        graph.edgeElements
          .filter(d => {
            const src = typeof d.source === 'object' ? d.source.id : d.source;
            const tgt = typeof d.target === 'object' ? d.target.id : d.target;
            return (src === step.from_paper_id && tgt === step.to_paper_id) ||
                   (src === step.to_paper_id && tgt === step.from_paper_id);
          })
          .transition().duration(200)
          .attr('stroke', '#D4A843').attr('stroke-width', 3).attr('stroke-opacity', 1);
      }

      // Highlight node
      if (step.to_paper_id && graph?.nodeElements) {
        graph.nodeElements
          .filter(d => d.id === step.to_paper_id)
          .select('circle')
          .transition().duration(200)
          .attr('stroke', '#D4A843').attr('stroke-width', 4);
      }

      // Pause
      await new Promise(r => setTimeout(r, 1500));

      // Clear highlights
      if (graph?.edgeElements) {
        graph.edgeElements.transition().duration(150)
          .attr('stroke', '#64748B').attr('stroke-width', 1).attr('stroke-opacity', 0.4);
      }
      if (graph?.nodeElements) {
        graph.nodeElements.select('circle').transition().duration(150)
          .attr('stroke', null).attr('stroke-width', 1);
      }
    }
  }

  _handleProse(data) {
    // Hide typing indicator on first content
    this._hideTypingIndicator();

    // Create assistant message container if needed
    if (!this.currentAssistantEl) {
      this.currentAssistantEl = this._appendAssistantMessage();
    }

    // Get or create prose element
    if (!this.currentProseEl) {
      this.currentProseEl = document.createElement('div');
      this.currentProseEl.className = 'msg-prose';
      this.currentProseEl.dataset.provenance = data.provenance || 'interpreted';
      this.currentAssistantEl.querySelector('.msg-content').appendChild(this.currentProseEl);
    }

    // Remove cursor before appending (Feature #073)
    this._hideCursor();

    // Append text with inline Markdown (Feature #038)
    const text = data.content || '';
    this.fullResponseText += text;
    this.currentProseEl.innerHTML = this._renderMarkdownInline(this.fullResponseText);

    // Re-add cursor (Feature #073)
    this._showCursor();

    // Auto-scroll
    this.autoScroller.scrollToBottom();
  }

  // ── Block Handling (Feature #002) ───────────────────────────────────────

  _handleBlock(data) {
    this._hideTypingIndicator();

    if (!this.currentAssistantEl) {
      this.currentAssistantEl = this._appendAssistantMessage();
    }

    const contentEl = this.currentAssistantEl.querySelector('.msg-content');

    // Use BlockFactory (not inline rendering) per Phase A verification fix
    const blockEl = (typeof BlockFactory !== 'undefined')
      ? BlockFactory.render(data)
      : this._fallbackBlockRender(data);
    contentEl.appendChild(blockEl);
    this.autoScroller.scrollToBottom();
  }

  /**
   * Fallback if BlockFactory not loaded (should not happen in production).
   */
  _fallbackBlockRender(data) {
    const el = document.createElement('div');
    el.className = `block block-${(data.type || 'unknown').replace(/_/g, '-')}`;
    el.dataset.provenance = data.provenance || 'computed';
    if (data.type === 'stat_grid' && data.data?.stats) {
      el.innerHTML = this._renderStatGrid(data.data.stats);
    } else if (data.type === 'paper_card' && data.data) {
      el.innerHTML = this._renderPaperCard(data.data);
    } else {
      el.innerHTML = `<div class="block-label">${data.type}</div>
        <pre style="font-size:11px;color:#64748B;overflow-x:auto">${JSON.stringify(data.data, null, 2)}</pre>`;
    }
    return el;
  }

  // ── Thinking Steps (Feature #054) ───────────────────────────────────────

  _handleThinkingStep(data) {
    this._hideTypingIndicator();

    if (!this.currentAssistantEl) {
      this.currentAssistantEl = this._appendAssistantMessage();
    }

    let thinkingEl = this.currentAssistantEl.querySelector('.msg-thinking');
    if (!thinkingEl) {
      thinkingEl = document.createElement('div');
      thinkingEl.className = 'msg-thinking';
      thinkingEl.innerHTML = `
        <div class="msg-thinking-header" onclick="var s=this.nextElementSibling;s.setAttribute('aria-expanded',s.getAttribute('aria-expanded')==='true'?'false':'true')">
          <span class="thinking-step-icon">●</span> Thinking...
        </div>
        <div class="msg-thinking-steps" aria-expanded="true"></div>
      `;
      this.currentAssistantEl.querySelector('.msg-content').prepend(thinkingEl);
    }

    const stepsEl = thinkingEl.querySelector('.msg-thinking-steps');
    const step = document.createElement('div');
    step.className = 'thinking-step';
    step.innerHTML = `<span class="thinking-step-icon">●</span><span>${data.label || `Step ${data.step}`}</span>`;
    stepsEl.appendChild(step);

    this.autoScroller.scrollToBottom();
  }

  _handleThinkingDone(data) {
    const thinkingEl = this.currentAssistantEl?.querySelector('.msg-thinking');
    if (thinkingEl) {
      const header = thinkingEl.querySelector('.msg-thinking-header');
      if (header) {
        header.innerHTML = `<span class="thinking-step-icon">●</span> Thought for ${data.steps_completed || 0} steps`;
      }
      const steps = thinkingEl.querySelector('.msg-thinking-steps');
      if (steps) steps.setAttribute('aria-expanded', 'false');
    }
  }

  // ── Progress Indicators (Feature #057) ──────────────────────────────────

  _handleProgress(data) {
    this._hideTypingIndicator();

    if (!this.currentAssistantEl) {
      this.currentAssistantEl = this._appendAssistantMessage();
    }

    let progressEl = this.currentAssistantEl.querySelector('.athena-progress');
    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.className = 'athena-progress';
      this.currentAssistantEl.querySelector('.msg-content').appendChild(progressEl);
    }

    const total = data.total || 5;
    const current = data.step || 1;
    let dots = '';
    for (let i = 1; i <= total; i++) {
      const cls = i < current ? 'complete' : i === current ? 'active' : '';
      dots += `<span class="athena-progress-dot ${cls}"></span>`;
    }

    progressEl.innerHTML = `
      <div class="athena-progress-dots">${dots}</div>
      <span class="athena-progress-label">${data.label || `Step ${current} of ${total}`}</span>
    `;

    this.autoScroller.scrollToBottom();
  }

  // ── Done Event (Feature #037) ───────────────────────────────────────────

  _handleDone(data) {
    // CRITICAL: Close EventSource IMMEDIATELY to prevent auto-reconnect
    // The browser's EventSource will auto-reconnect on stream end, hitting the
    // server with an expired message_id. Close it before any other processing.
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Remove cursor (Feature #073)
    this._hideCursor();

    // Full Markdown re-render (Feature #038)
    // Phase C fix: use full_text from done event (authoritative raw LLM output)
    // instead of accumulated fullResponseText (which may have gaps from backend block extraction)
    const authorativeText = data.full_text || this.fullResponseText;
    if (authorativeText) this.fullResponseText = authorativeText;
    if (this.currentProseEl && this.fullResponseText) {
      this.currentProseEl.innerHTML = this._renderMarkdownFull(this.fullResponseText);
    }

    // Remove streaming class
    if (this.currentAssistantEl) {
      this.currentAssistantEl.classList.remove('msg-streaming');

      // Add metadata
      const metaEl = this.currentAssistantEl.querySelector('.msg-meta');
      if (metaEl && data.model) {
        const modelSpan = document.createElement('span');
        modelSpan.className = 'msg-model';
        modelSpan.textContent = data.model.split('-').pop(); // "versatile" or "instant"
        metaEl.appendChild(modelSpan);
      }
    }

    // Remove progress indicator
    const progressEl = this.currentAssistantEl?.querySelector('.athena-progress');
    if (progressEl) progressEl.remove();

    // B-23/B-24: Process citations in rendered prose
    if (this.currentProseEl) {
      this.currentProseEl.innerHTML = this._processCitations(this.currentProseEl.innerHTML);
    }

    // B-24: Render footnotes if provided
    if (data.footnotes && data.footnotes.length) {
      this._renderFootnotes(data.footnotes);
    }

    // B-28: Check if response needs collapsing
    this._checkCollapse();

    // B-30: Generate quick action buttons
    this._generateQuickActions();

    // Save state before endStream resets everything (B2-02 fix)
    const savedMessageId = this.currentMessageId;
    const savedAssistantEl = this.currentAssistantEl;
    const savedResponseText = this.fullResponseText;

    // Store assistant message BEFORE endStream resets fullResponseText (B2-02)
    this._storeAssistantMessage();

    // End stream (resets fullResponseText, currentMessageId, etc.)
    this._endStream();

    // B-26: Update summary bar
    this.messageCount++;
    this._updateSummaryBar();

    // Poll for Gemini enrichment (async, Feature #037/Phase 6)
    if (savedMessageId) {
      setTimeout(() => this._pollEnrichment(savedMessageId), 3000);
    }
  }

  // ── Error Handling ──────────────────────────────────────────────────────

  _handleErrorEvent(data) {
    this._hideTypingIndicator();
    this._showError(data.message || 'An error occurred');
    // Close EventSource and end stream on ANY error
    // This prevents reconnect attempts and ensures isStreaming resets
    this._endStream();
  }

  // ── Enrichment (Feature #037 Phase 6) ───────────────────────────────────

  _handleEnrichment(data) {
    if (!this.currentAssistantEl) return;

    if (data.action === 'enrich' && data.addition) {
      const enrichEl = document.createElement('div');
      enrichEl.className = 'msg-prose provenance-enriched';
      enrichEl.style.marginTop = '12px';
      enrichEl.style.borderTop = '1px solid #E2E8F0';
      enrichEl.style.paddingTop = '12px';
      enrichEl.innerHTML = this._renderMarkdownInline(data.addition);
      this.currentAssistantEl.querySelector('.msg-content').appendChild(enrichEl);
      this.autoScroller.scrollToBottom();
    }
  }

  async _pollEnrichment(messageId) {
    try {
      const res = await fetch(`/api/athena/enrichment?message_id=${encodeURIComponent(messageId)}`);
      const { enrichment } = await res.json();
      if (enrichment && enrichment.action !== 'pass') {
        this._handleEnrichment(enrichment);
      }
    } catch (e) {
      // Silent fail for enrichment polling
    }
  }

  // ── Stop Generation (Feature #041) ──────────────────────────────────────

  stopGeneration() {
    if (!this.isStreaming) return;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Append "(stopped)" to current response
    if (this.currentProseEl) {
      this.fullResponseText += ' (stopped)';
      this.currentProseEl.innerHTML = this._renderMarkdownFull(this.fullResponseText);
    }

    this._hideCursor();
    this._endStream();
  }

  // ── Stream Lifecycle ────────────────────────────────────────────────────

  _endStream() {
    this.isStreaming = false;
    this.currentMessageId = null;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Reset for next message
    this.currentAssistantEl = null;
    this.currentProseEl = null;
    this.fullResponseText = '';

    document.dispatchEvent(new CustomEvent('athena:stream-end'));
  }

  // ── DOM Rendering Helpers ───────────────────────────────────────────────

  _appendUserMessage(text, contextData) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgId = `u_${Date.now().toString(36)}`;

    // Build context chip from either live context or restored metadata
    const ctx = contextData || this._captureCurrentContext();
    const chipHtml = ctx ? this._buildUserContextChip(ctx) : '';

    const el = document.createElement('div');
    el.className = 'msg msg-user';
    el.dataset.threadId = this.threadId || 'main';
    el.dataset.messageId = msgId;
    el.innerHTML = `
      ${chipHtml}
      <div class="msg-content"><p>${this._escapeHtml(text)}</p></div>
      <div class="msg-meta"><span class="msg-time">${timeStr}</span></div>
    `;

    // Wire up chip click handler
    const chip = el.querySelector('.msg-context-chip');
    if (chip) {
      chip.addEventListener('click', () => this._handleContextChipClick(chip));
    }

    this.messagesContainer.appendChild(el);
    this.autoScroller.scrollToBottom();
    this.messageCount++;
  }

  /**
   * Capture current click/prune context as a compact object for storage.
   * Returns null if no context is active.
   */
  _captureCurrentContext() {
    if (this._clickContext?.type === 'node' && this._clickContext?.node) {
      const n = this._clickContext.node;
      return { type: 'node', paper_id: n.paper_id || n.id || '', title: n.title || '', year: n.year };
    }
    if (this._clickContext?.type === 'edge' && this._clickContext?.edge) {
      const e = this._clickContext.edge;
      return { type: 'edge', citing_paper_id: e.citing_paper_id || '', cited_paper_id: e.cited_paper_id || '', citing_title: e.citing_title || '', cited_title: e.cited_title || '' };
    }
    if (this._pruneContext && this._pruneContext.state === 'complete') {
      return { type: 'prune', paper_id: this._pruneContext.removed_paper_id || '', title: this._pruneContext.paper_title || '', impact: this._pruneContext.impact_percentage };
    }
    return null;
  }

  /**
   * Build a WhatsApp-style reply context chip for user messages.
   * Shows what node/edge/prune the user was referencing.
   */
  _buildUserContextChip(ctx) {
    if (!ctx || !ctx.type) return '';

    if (ctx.type === 'node') {
      const title = (ctx.title || '').length > 45 ? ctx.title.substring(0, 43) + '...' : (ctx.title || 'Paper');
      const year = ctx.year ? ` (${ctx.year})` : '';
      return `<div class="msg-context-chip msg-context-chip--node" data-type="node" data-paper-id="${this._escapeHtml(ctx.paper_id || '')}" data-title="${this._escapeHtml(ctx.title || '')}" title="Click to zoom & highlight in graph">
        <span class="msg-chip-icon">●</span>
        <span class="msg-chip-label">${this._escapeHtml(title)}${year}</span>
      </div>`;
    }

    if (ctx.type === 'edge') {
      const citing = (ctx.citing_title || '').length > 25 ? ctx.citing_title.substring(0, 23) + '...' : (ctx.citing_title || 'Paper');
      const cited = (ctx.cited_title || '').length > 25 ? ctx.cited_title.substring(0, 23) + '...' : (ctx.cited_title || 'Paper');
      return `<div class="msg-context-chip msg-context-chip--edge" data-type="edge" data-citing-id="${this._escapeHtml(ctx.citing_paper_id || '')}" data-cited-id="${this._escapeHtml(ctx.cited_paper_id || '')}" data-citing-title="${this._escapeHtml(ctx.citing_title || '')}" data-cited-title="${this._escapeHtml(ctx.cited_title || '')}" title="Click to zoom & highlight edge in graph">
        <span class="msg-chip-icon">⇢</span>
        <span class="msg-chip-label">${this._escapeHtml(citing)} → ${this._escapeHtml(cited)}</span>
      </div>`;
    }

    if (ctx.type === 'prune') {
      const title = (ctx.title || '').length > 35 ? ctx.title.substring(0, 33) + '...' : (ctx.title || 'Paper');
      const pct = ctx.impact ? ` — ${ctx.impact}% collapsed` : '';
      return `<div class="msg-context-chip msg-context-chip--prune" data-type="prune" data-paper-id="${this._escapeHtml(ctx.paper_id || '')}" data-title="${this._escapeHtml(ctx.title || '')}" title="Click to highlight pruned paper">
        <span class="msg-chip-icon">✂</span>
        <span class="msg-chip-label">Pruned: ${this._escapeHtml(title)}${pct}</span>
      </div>`;
    }

    return '';
  }

  _appendAssistantMessage() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgId = this.currentMessageId || `a_${Date.now().toString(36)}`;

    const el = document.createElement('div');
    el.className = 'msg msg-assistant msg-streaming';
    el.dataset.threadId = this.threadId || 'main';
    el.dataset.messageId = msgId;

    el.innerHTML = `
      <div class="msg-content"></div>
      <div class="msg-meta"><span class="msg-time">${timeStr}</span></div>
    `;

    this.messagesContainer.appendChild(el);
    return el;
  }

  /**
   * Handle click on a context chip — zooms to + highlights the referenced
   * node/edge in BOTH graph views (force graph + tree layout).
   */
  _handleContextChipClick(chip) {
    const type = chip.dataset.type;
    const graph = window._arivuGraph;
    const tree = window._treeLayout;
    const commands = window.athenaGraphCommands;

    if (type === 'node' || type === 'prune') {
      const paperId = chip.dataset.paperId;
      const title = chip.dataset.title || '';
      if (!paperId) return;

      // Use the graph commands system for zoom (works on both views)
      if (commands) {
        commands.executeCommand({ action: 'zoom', target: title || paperId });
      }

      // Also highlight with gold pulse in both views
      setTimeout(() => {
        // Force graph highlight
        if (graph?.nodeElements) {
          graph.nodeElements
            .filter(d => d.id === paperId)
            .select('circle')
            .transition().duration(300)
            .attr('stroke', '#D4A843').attr('stroke-width', 4).attr('r', d => (d.is_seed ? 14 : 10))
            .transition().duration(2500)
            .attr('stroke', null).attr('stroke-width', 1).attr('r', d => (d.is_seed ? 10 : 6));
        }

        // Tree layout highlight
        if (tree?.nodeGroup) {
          tree.nodeGroup.selectAll('g.tree-node')
            .filter(d => (d.data?.data?.id || d.data?.id) === paperId)
            .select('rect.node-rect')
            .transition().duration(300)
            .style('stroke', '#D4A843').style('stroke-width', '4px')
            .attr('transform', 'scale(1.3)')
            .transition().duration(2500)
            .style('stroke', null).style('stroke-width', null)
            .attr('transform', null);
        }
      }, 600); // Delay to let zoom complete first
    }

    if (type === 'edge') {
      const citingId = chip.dataset.citingId;
      const citedId = chip.dataset.citedId;
      const citingTitle = chip.dataset.citingTitle || '';
      if (!citingId || !citedId) return;

      // Zoom to the citing paper first (brings the edge into view)
      if (commands) {
        commands.executeCommand({ action: 'zoom', target: citingTitle || citingId });
      }

      // Then highlight the edge with gold pulse in both views
      setTimeout(() => {
        // Force graph edge highlight
        if (graph?.edgeElements) {
          graph.edgeElements
            .filter(d => {
              const src = typeof d.source === 'object' ? d.source.id : d.source;
              const tgt = typeof d.target === 'object' ? d.target.id : d.target;
              return (src === citingId && tgt === citedId) || (src === citedId && tgt === citingId);
            })
            .transition().duration(300)
            .attr('stroke', '#D4A843').attr('stroke-width', 4).attr('stroke-opacity', 1)
            .transition().duration(2500)
            .attr('stroke', '#64748B').attr('stroke-width', 1).attr('stroke-opacity', 0.4);
        }

        // Also highlight both nodes briefly
        if (graph?.nodeElements) {
          graph.nodeElements
            .filter(d => d.id === citingId || d.id === citedId)
            .select('circle')
            .transition().duration(300)
            .attr('stroke', '#D4A843').attr('stroke-width', 3)
            .transition().duration(2500)
            .attr('stroke', null).attr('stroke-width', 1);
        }
      }, 600);
    }
  }

  _appendSystemMessage(text) {
    const el = document.createElement('div');
    el.className = 'msg msg-system';
    el.innerHTML = `
      <span class="msg-system-icon">●</span>
      <span class="msg-system-text">${this._escapeHtml(text)}</span>
    `;
    this.messagesContainer.appendChild(el);
    this.autoScroller.scrollToBottom();
  }

  _showError(message) {
    const el = document.createElement('div');
    el.className = 'msg msg-system';
    el.style.borderLeftColor = '#EF4444';
    el.innerHTML = `
      <span class="msg-system-icon" style="color:#EF4444">●</span>
      <span class="msg-system-text">${this._escapeHtml(message)}</span>
    `;
    this.messagesContainer.appendChild(el);
    this.autoScroller.scrollToBottom();
  }

  // ── Typing Indicator (Feature #046) ─────────────────────────────────────

  _showTypingIndicator() {
    this._hideTypingIndicator();
    const el = document.createElement('div');
    el.className = 'athena-typing-indicator';
    el.id = 'athena-typing';
    el.setAttribute('aria-label', 'Athena is thinking');
    el.innerHTML = `
      <span class="athena-typing-dot"></span>
      <span class="athena-typing-dot"></span>
      <span class="athena-typing-dot"></span>
    `;
    this.messagesContainer.appendChild(el);
    this.autoScroller.scrollToBottom();

    // Timeout after 30 seconds (per ATHENA_PHASE_A.md Feature #046)
    this._typingTimeout = setTimeout(() => {
      this._hideTypingIndicator();
      this._showError('Response is taking longer than expected...');
    }, 30000);
  }

  _hideTypingIndicator() {
    const el = document.getElementById('athena-typing');
    if (el) el.remove();
    if (this._typingTimeout) {
      clearTimeout(this._typingTimeout);
      this._typingTimeout = null;
    }
  }

  // ── Streaming Cursor (Feature #073) ─────────────────────────────────────

  _showCursor() {
    if (!this.currentProseEl) return;
    // Remove existing cursor first
    this._hideCursor();
    const cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';
    this.currentProseEl.appendChild(cursor);
  }

  _hideCursor() {
    const cursors = this.messagesContainer.querySelectorAll('.streaming-cursor');
    cursors.forEach(c => c.remove());
  }

  // ── Markdown Rendering (Feature #038) ───────────────────────────────────

  _renderMarkdownInline(text) {
    // Safe inline Markdown during streaming (per Section 2.1.5)
    let html = this._escapeHtml(text);

    // Replace [ungrounded] markers with visual indicator (empty dot)
    html = html.replace(/\[ungrounded\]/g, '<span class="provenance-ungrounded" title="This number was not found in computed data">&#9675;</span>');

    // Bold **text**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic *text*
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    // Inline code `text`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Headings (at start of line)
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    if (!html.startsWith('<h') && !html.startsWith('<p>')) {
      html = '<p>' + html + '</p>';
    }

    return html;
  }

  _renderMarkdownFull(text) {
    // Full re-render on stream completion (per Section 2.1.5)

    // Step 1: Parse [BLOCK:type:key=val]content[/BLOCK] syntax BEFORE markdown
    // Extract blocks, replace with placeholders, render via BlockFactory after
    const blockPlaceholders = [];
    let processed = text.replace(
      /\[BLOCK:(\w+)(?::([^\]]*))?\]([\s\S]*?)\[\/BLOCK\]/g,
      (_, type, params, content) => {
        const trimmed = content.trim();
        const data = { message: trimmed, content: trimmed, text: trimmed };
        // Parse key=value params (e.g., level=warn, title=Section Title)
        if (params) {
          params.split(':').forEach(p => {
            const [k, v] = p.split('=');
            if (k && v) data[k.trim()] = v.trim();
          });
        }
        const idx = blockPlaceholders.length;
        blockPlaceholders.push({ type, data });
        return `\x01BLOCK_${idx}\x01`;
      }
    );

    // Step 2a: Extract math blocks BEFORE inline markdown to prevent corruption
    // Display math: $$...$$
    const mathBlocks = [];
    processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
      const idx = mathBlocks.length;
      mathBlocks.push({ latex: latex.trim(), display: true });
      return `\x01MATH_${idx}\x01`;
    });
    // Inline math: $...$  (but not $$)
    processed = processed.replace(/(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g, (_, latex) => {
      const idx = mathBlocks.length;
      mathBlocks.push({ latex: latex.trim(), display: false });
      return `\x01MATH_${idx}\x01`;
    });

    // Step 2b: Extract code blocks BEFORE inline markdown to prevent corruption
    const codeBlocks = [];
    processed = processed.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({ lang: lang || 'text', code: code.trim() });
      return `\x01CODE_${idx}\x01`;
    });

    // Step 3: Apply inline markdown
    let html = this._renderMarkdownInline(processed);

    // Step 4: Restore code blocks with syntax highlighting + copy button
    for (let i = 0; i < codeBlocks.length; i++) {
      const { lang, code } = codeBlocks[i];
      const escaped = this._escapeHtml(code);
      const highlighted = (typeof tokenize === 'function') ? tokenize(code, lang) : escaped;
      const lines = highlighted.split('\n');
      let lineNums = '';
      let lineContent = '';
      for (let n = 0; n < lines.length; n++) {
        lineNums += `<div class="code-line-num">${n + 1}</div>`;
        lineContent += `<div class="code-line">${lines[n]}</div>`;
      }
      const codeHtml = `<div class="block-code">` +
        `<div class="code-block-header"><span class="code-block-lang">${lang}</span>` +
        `<button class="block-copy-btn" onclick="copyToClipboard(this.closest('.block-code').querySelector('.code-content').textContent, this)">Copy</button></div>` +
        `<div class="code-block-body"><div class="code-line-numbers">${lineNums}</div>` +
        `<div class="code-content">${lineContent}</div></div></div>`;
      html = html.replace(`\x01CODE_${i}\x01`, codeHtml);
    }

    // Step 5: Restore [BLOCK:...] placeholders via BlockFactory
    for (let i = 0; i < blockPlaceholders.length; i++) {
      const { type, data } = blockPlaceholders[i];
      if (typeof BlockFactory !== 'undefined') {
        // Render via BlockFactory to a temporary element, extract HTML
        const blockEl = BlockFactory.render({ type, data, provenance: 'interpreted' });
        const wrapper = document.createElement('div');
        wrapper.appendChild(blockEl);
        html = html.replace(`\x01BLOCK_${i}\x01`, wrapper.innerHTML);
      } else {
        // Fallback: simple styled div
        html = html.replace(`\x01BLOCK_${i}\x01`,
          `<div class="block-warning" style="border-left:3px solid #F59E0B;padding:8px 12px;margin:8px 0;background:#FFFBEB;border-radius:4px">${this._escapeHtml(data.message)}</div>`);
      }
    }

    // Step 6: Restore math blocks via KaTeX
    for (let i = 0; i < mathBlocks.length; i++) {
      const { latex, display } = mathBlocks[i];
      let mathHtml;
      if (typeof katex !== 'undefined') {
        try {
          mathHtml = katex.renderToString(latex, {
            displayMode: display,
            throwOnError: false,
            output: 'html',
          });
          if (display) {
            mathHtml = `<div class="block-equation" style="margin:12px 0;text-align:center;overflow-x:auto">${mathHtml}</div>`;
          }
        } catch {
          mathHtml = display
            ? `<div class="block-equation" style="margin:12px 0;text-align:center;font-family:'JetBrains Mono',monospace;color:#94A3B8">${this._escapeHtml(latex)}</div>`
            : `<code>${this._escapeHtml(latex)}</code>`;
        }
      } else {
        // KaTeX not loaded — render as styled monospace
        mathHtml = display
          ? `<div class="block-equation" style="margin:12px 0;text-align:center;font-family:'JetBrains Mono',monospace;font-size:14px;color:#E2E8F0;background:#1E293B;padding:12px;border-radius:6px">${this._escapeHtml(latex)}</div>`
          : `<code class="math-inline" style="font-family:'JetBrains Mono',monospace;color:#D4A843">${this._escapeHtml(latex)}</code>`;
      }
      html = html.replace(`\x01MATH_${i}\x01`, mathHtml);
    }

    // Unordered lists
    html = html.replace(/(?:^|\n)- (.+)/g, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');

    // Ordered lists
    html = html.replace(/(?:^|\n)\d+\. (.+)/g, '<li>$1</li>');

    // Blockquotes
    html = html.replace(/(?:^|\n)> (.+)/g, '<blockquote>$1</blockquote>');

    // Basic Markdown table support
    html = html.replace(
      /(?:<br>|\n)?\|(.+)\|(?:<br>|\n)\|[-| :]+\|(?:<br>|\n)((?:\|.+\|(?:<br>|\n)?)+)/g,
      (match, headerRow, bodyRows) => {
        const headers = headerRow.split('|').map(h => h.trim()).filter(Boolean);
        const headHtml = headers.map(h => `<th style="padding:4px 8px;border:1px solid #E2E8F0;font-size:12px;background:#F8FAFC">${h}</th>`).join('');
        const rows = bodyRows.split(/(?:<br>|\n)/).filter(r => r.trim() && r.includes('|'));
        const bodyHtml = rows.map(row => {
          const cells = row.split('|').map(c => c.trim()).filter(Boolean);
          return '<tr>' + cells.map(c => `<td style="padding:4px 8px;border:1px solid #E2E8F0;font-size:12px">${c}</td>`).join('') + '</tr>';
        }).join('');
        return `<table style="border-collapse:collapse;margin:8px 0;width:100%"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
      }
    );

    return html;
  }

  // ── Block Renderers (Feature #002) ──────────────────────────────────────

  _renderStatGrid(stats) {
    if (!stats || !stats.length) return '';
    let html = '<div class="stat-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">';
    for (const stat of stats) {
      html += `
        <div class="stat-item" style="padding:8px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px">
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#64748B;letter-spacing:0.05em">${this._escapeHtml(stat.label || '')}</div>
          <div style="font-size:16px;font-weight:600;color:#1a1a2e;margin-top:2px">${this._escapeHtml(String(stat.value || ''))}</div>
          ${stat.detail ? `<div style="font-size:11px;color:#94A3B8;margin-top:1px">${this._escapeHtml(stat.detail)}</div>` : ''}
        </div>`;
    }
    html += '</div>';
    return html;
  }

  _renderPaperCard(data) {
    const authors = (data.authors || []).slice(0, 3).join(', ');
    const authorsMore = (data.authors || []).length > 3 ? ` +${data.authors.length - 3}` : '';
    return `
      <div style="padding:12px;border:1px solid #E2E8F0;border-radius:8px;background:#FFFFFF">
        <div style="font-weight:600;font-size:14px;color:#1a1a2e;margin-bottom:4px">${this._escapeHtml(data.title || 'Unknown')}</div>
        <div style="font-size:12px;color:#64748B">${this._escapeHtml(authors)}${authorsMore} (${data.year || '?'})</div>
        <div style="display:flex;gap:12px;margin-top:6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#94A3B8">
          <span>Citations: ${(data.citation_count || 0).toLocaleString()}</span>
          ${data.fields && data.fields.length ? `<span>${data.fields[0]}</span>` : ''}
        </div>
      </div>`;
  }

  // ── Conversation Memory (Feature #006) ──────────────────────────────────

  async _loadHistory() {
    try {
      // Use AthenaMemory if available, else direct fetch
      let messages;
      if (this.memory) {
        messages = await this.memory.loadHistory(this.threadId, 50);
      } else {
        const res = await fetch(`/api/athena/history?thread_id=${this.threadId}&limit=50`);
        if (!res.ok) return;
        messages = (await res.json()).messages;
      }

      if (messages && messages.length > 0) {
        // Show restoration notice
        this._appendSystemMessage(`Previous conversation restored (${messages.length} messages)`);

        for (const msg of messages) {
          if (msg.role === 'user') {
            // Restore context chip from DB metadata (persisted awareness)
            const savedContext = msg.metadata?.context || null;
            this._appendUserMessage(msg.content, savedContext);
          } else if (msg.role === 'assistant') {
            const el = this._appendAssistantMessage();
            el.classList.remove('msg-streaming');
            const contentEl = el.querySelector('.msg-content');

            // Reconstruct blocks from metadata (per Section 2.1.22)
            if (msg.metadata?.blocks) {
              for (const block of msg.metadata.blocks) {
                const blockEl = (typeof BlockFactory !== 'undefined')
                  ? BlockFactory.render(block)
                  : this._fallbackBlockRender(block);
                contentEl.appendChild(blockEl);
              }
            }

            // Render prose with full markdown + citation processing
            if (msg.content) {
              // Phase C #008: Detect Pathfinder from stored history
              if (msg.content === '[Pathfinder handoff offered]') {
                // Show handoff card without buttons (already answered or pending)
                const cardEl = document.createElement('div');
                cardEl.className = 'block block-pathfinder-handoff';
                const compassSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0E7490" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polygon points="12,2 14.5,9.5 12,8 9.5,9.5" fill="#06B6D4" stroke="none"/><polygon points="12,22 9.5,14.5 12,16 14.5,14.5" fill="#0E7490" stroke="none"/><circle cx="12" cy="12" r="2" fill="#0E7490"/></svg>';
                cardEl.innerHTML = `
                  <div class="pathfinder-handoff-icon">${compassSvg}</div>
                  <div class="pathfinder-handoff-body">
                    <div class="pathfinder-handoff-title">Pathfinder Suggestion</div>
                    <p class="pathfinder-handoff-msg">Answered by Pathfinder.</p>
                  </div>
                `;
                contentEl.appendChild(cardEl);
              } else if (msg.content && msg.content.startsWith('[PATHFINDER_RESULT]')) {
                // Pathfinder result HTML from DB — render the teal blocks directly
                const resultHtml = msg.content.substring('[PATHFINDER_RESULT]'.length);
                const resultEl = document.createElement('div');
                resultEl.className = 'pathfinder-result';
                resultEl.innerHTML = resultHtml;
                contentEl.appendChild(resultEl);
              } else if (msg.content && msg.content.startsWith('[PATHFINDER_ANALYSIS]')) {
                // Legacy format — render as markdown
                const resultText = msg.content.substring('[PATHFINDER_ANALYSIS]\n'.length);
                const resultEl = document.createElement('div');
                resultEl.className = 'msg-prose pathfinder-result';
                let rendered = this._renderMarkdownFull(resultText);
                resultEl.innerHTML = '<div class="pathfinder-result-header">PATHFINDER ANALYSIS</div>' + rendered;
                contentEl.appendChild(resultEl);
              } else if (msg.content && msg.content.startsWith('[Terminal suggestion:')) {
                // Restore terminal suggestion block
                const cmdMatch = msg.content.match(/\[Terminal suggestion:\s*(.+)\]$/);
                if (cmdMatch) {
                  const cmd = cmdMatch[1].trim();
                  const blockEl = (typeof BlockFactory !== 'undefined')
                    ? BlockFactory.render({
                        type: 'terminal_suggest',
                        provenance: 'computed',
                        data: { command: cmd, message: 'Terminal command suggestion:' },
                      })
                    : document.createElement('span');
                  contentEl.appendChild(blockEl);
                }
              }
              // Phase C: Detect [Command: Action Target] patterns from stored history
              else {
              const cmdMatch = msg.content.match(/^\[Command:\s*(\w+)\s*(.*?)\]$/);
              if (cmdMatch) {
                // Restore command blocks
                const action = cmdMatch[1];
                const target = cmdMatch[2].trim();
                const blockEl = (typeof BlockFactory !== 'undefined')
                  ? BlockFactory.render({
                      type: 'command_confirm',
                      provenance: 'computed',
                      data: { action, target, status: 'executed' },
                    })
                  : document.createElement('span');
                contentEl.appendChild(blockEl);
              } else if (msg.content.includes('[SECTION:')) {
                // Restore deep dive sections from stored [SECTION:N:Title] markers
                const sections = msg.content.split(/\[SECTION:\d+:[^\]]+\]\n?/);
                const headers = [...msg.content.matchAll(/\[SECTION:(\d+):([^\]]+)\]/g)];

                for (let i = 0; i < headers.length; i++) {
                  const secNum = headers[i][1];
                  const secTitle = headers[i][2];
                  const secContent = sections[i + 1] || '';

                  if (!secContent.trim()) continue;

                  const details = document.createElement('details');
                  details.className = 'deep-dive-section';
                  details.open = true;
                  details.dataset.section = secNum;

                  const summary = document.createElement('summary');
                  summary.className = 'deep-dive-section-header';
                  summary.innerHTML = `<span class="deep-dive-section-num">${secNum}</span> <span class="deep-dive-section-title">${this._escapeHtml(secTitle)}</span>`;
                  details.appendChild(summary);

                  const sectionBody = document.createElement('div');
                  sectionBody.className = 'deep-dive-section-content';
                  const proseEl = document.createElement('div');
                  proseEl.className = 'msg-prose';
                  let rendered = this._renderMarkdownFull(secContent.trim());
                  rendered = this._processCitations(rendered);
                  proseEl.innerHTML = rendered;
                  sectionBody.appendChild(proseEl);
                  details.appendChild(sectionBody);

                  contentEl.appendChild(details);
                }
              } else if (msg.content.startsWith('[TRAVERSAL]')) {
                // Restore traversal steps from stored [TRAVERSAL_STEP:N] markers
                const stepMatches = [...msg.content.matchAll(/\[TRAVERSAL_STEP:(\d+)\]([^\[]*)/g)];
                if (stepMatches.length > 0) {
                  for (const match of stepMatches) {
                    const stepNum = match[1];
                    const narration = match[2].trim();
                    if (!narration) continue;

                    const stepEl = document.createElement('div');
                    stepEl.className = 'traversal-step';
                    stepEl.dataset.step = stepNum;

                    const numEl = document.createElement('span');
                    numEl.className = 'traversal-step-num';
                    numEl.textContent = stepNum;

                    const narrEl = document.createElement('span');
                    narrEl.className = 'traversal-step-narration';
                    let rendered = this._renderMarkdownFull(narration);
                    rendered = this._processCitations(rendered);
                    narrEl.innerHTML = rendered;

                    stepEl.appendChild(numEl);
                    stepEl.appendChild(narrEl);
                    contentEl.appendChild(stepEl);
                  }

                  // Add replay button
                  const replayBtn = document.createElement('button');
                  replayBtn.className = 'traversal-replay-btn';
                  replayBtn.textContent = '▶ Replay Tour';
                  replayBtn.addEventListener('click', () => {
                    const planJson = msg.metadata?.traversal_plan;
                    if (planJson && window.athenaEngine) {
                      try {
                        const plan = JSON.parse(planJson);
                        window.athenaEngine._replayTraversalAnimation(plan);
                      } catch (e) {
                        console.warn('Replay failed:', e);
                      }
                    }
                  });
                  contentEl.appendChild(replayBtn);
                }
              } else {
                // Normal prose rendering
                const proseEl = document.createElement('div');
                proseEl.className = 'msg-prose';
                let rendered = this._renderMarkdownFull(msg.content);
                rendered = this._processCitations(rendered);
                proseEl.innerHTML = rendered;
                contentEl.appendChild(proseEl);
              }
              } // Close the else block from pathfinder detection
            }
          } else if (msg.role === 'system') {
            this._appendSystemMessage(msg.content);
          }
        }
        this.messageCount = messages.length;
      }
    } catch (e) {
      console.warn('Failed to load Athena history:', e);
    }
  }

  _storeAssistantMessage() {
    if (!this.fullResponseText) return;
    // Server-side storage is handled by orchestrator.finalize_response().
    // Update local memory cache so buildContextWindow() stays current.
    if (this.memory) {
      this.memory.storeMessage('assistant', this.fullResponseText, {
        message_id: this.currentMessageId,
      }).catch(() => {}); // Non-blocking; server already persisted
    }
  }

  // ── New Chat / Clear (Feature #047) ─────────────────────────────────────

  clearConversation() {
    if (this.messageCount >= 3) {
      this._showConfirmDialog();
    } else {
      this._doClear();
    }
  }

  _showConfirmDialog() {
    const overlay = this.panel.querySelector('.athena-overlay');
    if (overlay) overlay.classList.add('visible');

    const dialog = document.createElement('div');
    dialog.className = 'athena-confirm-dialog';
    dialog.innerHTML = `
      <h3>New Conversation</h3>
      <p>Start a fresh conversation? Your current messages will be preserved in history.</p>
      <div class="athena-confirm-actions">
        <button class="confirm-cancel">Cancel</button>
        <button class="confirm-primary">New Chat</button>
      </div>
    `;

    dialog.querySelector('.confirm-cancel').addEventListener('click', () => {
      dialog.remove();
      if (overlay) overlay.classList.remove('visible');
    });

    dialog.querySelector('.confirm-primary').addEventListener('click', () => {
      dialog.remove();
      if (overlay) overlay.classList.remove('visible');
      this._doClear();
    });

    this.panel.appendChild(dialog);
  }

  _doClear() {
    // Generate new thread_id so old conversation is preserved in history
    this.threadId = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    this.messagesContainer.innerHTML = '';
    this.messageCount = 0;
    this.fullResponseText = '';
    this.currentAssistantEl = null;
    this.currentProseEl = null;

    // Phase C #105: Clear click context on new conversation
    this._clearClickContext();

    this._appendSystemMessage('New conversation started');
    this._showTemplatesIfEmpty();

    // Refresh history sidebar if open
    if (window.athenaHistory) {
      window.athenaHistory.loadSessions();
    }
  }

  // ── Template Prompts (Feature #123) ─────────────────────────────────────

  _showTemplatesIfEmpty() {
    if (this.messageCount > 0) return;

    const graphLoaded = !!window._arivuGraph?.metadata?.graph_id;
    let templates;

    if (graphLoaded) {
      const meta = window._arivuGraph?.metadata || {};
      const seedTitle = meta.seed_paper_title || 'this paper';
      const nodes = window._arivuGraph?.allNodes || [];
      // Sort by pagerank (structural importance) if available, else fallback to citation_count
      const topNode = nodes.length
        ? [...nodes].sort((a, b) => (b.pagerank || b.citation_count || 0) - (a.pagerank || a.citation_count || 0))[0]
        : null;
      const dna = window._arivuGraph?.dnaProfile;
      const rawCluster = dna?.clusters?.[0]?.label || 'main';
      const clusterName = rawCluster.toLowerCase().includes('cluster')
        ? rawCluster
        : `${rawCluster} research cluster`;

      templates = [
        { text: `Explain the ancestry of ${seedTitle}`, icon: '●' },
        { text: `What are the most important papers in this lineage?`, icon: '●' },
        { text: topNode ? `What would collapse if ${topNode.title?.substring(0, 40)} were removed?` : `Show me the bottleneck paper`, icon: '●' },
        { text: `Tell me about the ${clusterName}`, icon: '●' },
      ];
    } else {
      templates = [
        { text: 'What can you help me with?', icon: '●' },
        { text: 'How does citation analysis work?', icon: '●' },
        { text: 'Explain research lineage mapping', icon: '●' },
        { text: 'What makes a paper structurally important?', icon: '●' },
      ];
    }

    const container = document.createElement('div');
    container.className = 'athena-templates';
    container.id = 'athena-templates';

    // Welcome message
    const welcome = document.createElement('div');
    welcome.className = 'msg msg-system';
    welcome.innerHTML = graphLoaded
      ? `<span class="msg-system-icon">●</span><span class="msg-system-text">Ready to analyze this lineage. Ask me anything.</span>`
      : `<span class="msg-system-icon">●</span><span class="msg-system-text">Load a graph to unlock full analysis. You can ask general questions now.</span>`;
    container.appendChild(welcome);

    for (const t of templates) {
      const card = document.createElement('div');
      card.className = 'athena-template-card';
      card.innerHTML = `<span class="athena-template-icon">${t.icon}</span><span>${t.text}</span>`;
      card.addEventListener('click', () => {
        // Send as message via AthenaInput
        if (window.athenaInput) {
          window.athenaInput.setText(t.text);
          window.athenaInput.send();
        }
      });
      container.appendChild(card);
    }

    this.messagesContainer.appendChild(container);
  }

  _hideTemplates() {
    const el = document.getElementById('athena-templates');
    if (el) el.remove();
  }

  // ── Context (Feature #044 + #001) ───────────────────────────────────────

  getGraphContext() {
    // Extract graph data for backend context assembly
    if (!window._arivuGraph?.metadata?.graph_id) return null;
    return {
      graph_id: window._arivuGraph.metadata?.graph_id,
      total_nodes: window._arivuGraph.allNodes?.length || 0,
      seed_title: window._arivuGraph.metadata?.seed_paper_title || '',
    };
  }

  /**
   * Collect graph awareness state from the frontend.
   * Sent with each message so the orchestrator can provide context-aware responses.
   */
  _getAwarenessState() {
    const state = {};

    // Phase C #105: Use _clickContext (enriched, with staleness check)
    if (this._clickContext) {
      const age = Date.now() - (this._clickContext.timestamp || 0);
      if (age < 5 * 60 * 1000) { // within 5-minute staleness window
        if (this._clickContext.type === 'node' && this._clickContext.node) {
          const n = this._clickContext.node;
          state.clicked_paper = {
            paper_id: n.paper_id,
            title: n.title,
            year: n.year,
            cluster_name: n.cluster_name || null,
            pagerank_score: n.pagerank_score || null,
            depth: n.depth != null ? n.depth : null,
            citation_count: n.citation_count || 0,
          };
        } else if (this._clickContext.type === 'edge' && this._clickContext.edge) {
          const e = this._clickContext.edge;
          state.clicked_edge = {
            citing_title: e.citing_title || '',
            cited_title: e.cited_title || '',
            mutation_type: e.mutation_type || 'incidental',
            mutation_confidence: e.mutation_confidence || 0,
            citation_intent: e.citation_intent || '',
            citing_sentence: e.citing_sentence || null,
            cited_sentence: e.cited_sentence || null,
          };
        }
      } else {
        // Context expired -- clear it
        this._clearClickContext();
      }
    }

    // Phase C #108: Prune context (higher priority than click context)
    if (this._pruneContext && this._pruneContext.phase === 'complete') {
      state.prune_state = 'active';
      state.pruned_paper = this._pruneContext.pruned_paper_title || 'Unknown';
      state.prune_impact = this._pruneContext.impact_percentage || 0;
      state.prune_collapsed_count = this._pruneContext.collapsed_count || 0;
      // Include top 5 collapsed nodes (level 1 = direct dependents)
      const level1 = (this._pruneContext.collapsed_nodes || [])
        .filter(n => n.bfs_level === 1)
        .slice(0, 5);
      if (level1.length) {
        state.prune_direct_dependents = level1.map(n => n.title || n.paper_id || '?');
      }
      // Include top 3 surviving nodes with paths
      const survivors = (this._pruneContext.surviving_nodes || []).slice(0, 3);
      if (survivors.length) {
        state.prune_survivors = survivors.map(n => ({
          title: n.title || n.paper_id || '?',
          path: n.survival_path || [],
        }));
      }
    }

    // Phase C #106: Zoom awareness (from debounced zoom event, not raw transform)
    if (this._zoomContext) {
      state.zoom_level = this._zoomContext.level;
      if (this._zoomContext.visible_count > 0) {
        state.zoom_visible_count = this._zoomContext.visible_count;
      }
      if (this._zoomContext.cluster_focus) {
        state.zoom_cluster_focus = this._zoomContext.cluster_focus;
      }
    } else {
      // Fallback: use raw transform if zoom event hasn't fired yet
      const transform = window._arivuGraph?.currentTransform;
      if (transform) {
        const k = transform.k || 1;
        state.zoom_level = k < 0.5 ? 'overview' : k > 2.0 ? 'detail' : 'normal';
      }
    }

    // Phase C #107: Filter awareness
    if (this._filterContext) {
      state.active_filters = [{
        type: 'display',
        value: this._filterContext.filter_name,
      }];
      state.filter_visible_count = this._filterContext.visible_count;
      state.filter_hidden_count = this._filterContext.hidden_count;
    }

    return Object.keys(state).length > 0 ? state : null;
  }

  // ── B-23/B-24: Citation Processing ──────────────────────────────────────

  _processCitations(html) {
    // Handle BOTH [CITE:hex_paper_id] and [CITE:Paper Title (Author, Year)] formats.
    // The LLM often outputs title-based citations instead of hex IDs.
    if (!html) return html;

    const refs = {};
    let refCount = 0;

    // Pass 1: Handle [CITE:hex_paper_id] markers (40-char hex IDs)
    html = html.replace(/\[CITE:([a-f0-9]{20,})\]/gi, (match, paperId) => {
      if (!refs[paperId]) {
        refCount++;
        refs[paperId] = refCount;
      }
      const n = refs[paperId];
      return `<sup class="citation-ref" data-paper-id="${paperId}" data-footnote="${n}" id="cite-ref-${n}">[${n}]</sup>`;
    });

    // Pass 2: Handle [CITE:Paper Title (Author, Year)] — title-based citations
    // Match anything inside [CITE:...] that isn't a pure hex ID (already handled above)
    html = html.replace(/\[CITE:([^\]]+)\]/g, (match, titleRef) => {
      // Skip if it's already been processed (hex IDs)
      if (/^[a-f0-9]{20,}$/i.test(titleRef)) return match;

      const key = titleRef.trim().toLowerCase();
      if (!refs[key]) {
        refCount++;
        refs[key] = refCount;
      }
      const n = refs[key];
      // Render as an inline citation chip with the paper title
      const shortTitle = titleRef.length > 60 ? titleRef.slice(0, 57) + '...' : titleRef;
      return `<span class="citation-chip" data-footnote="${n}" title="${this._escapeHtml(titleRef)}">${this._escapeHtml(shortTitle)}</span>`;
    });

    // Store citation refs for footnote generation
    this._citationRefs = refs;

    // Pass 3: Handle [N] already-processed markers (from backend post-processing)
    if (refCount > 0) {
      html = html.replace(/(?<!data-footnote=")(?<!id="cite-ref-)\[(\d+)\](?!<\/sup>)/g, (match, num) => {
        const n = parseInt(num, 10);
        if (n > 0 && n <= refCount) {
          return `<sup class="citation-ref" data-footnote="${n}" id="cite-ref-${n}">${match}</sup>`;
        }
        return match;
      });
    }

    return html;
  }

  _renderFootnotes(footnotes) {
    if (!footnotes || !footnotes.length) return;
    if (!this.currentAssistantEl) return;
    const contentEl = this.currentAssistantEl.querySelector('.msg-content');
    if (!contentEl) return;
    const el = (typeof BlockFactory !== 'undefined')
      ? BlockFactory.render({ type: 'footnote', data: { footnotes }, provenance: 'computed' })
      : document.createElement('span');
    contentEl.appendChild(el);
    this.autoScroller.scrollToBottom();
  }

  // ── B-25: Confidence Thermometer ──────────────────────────────────────

  _handleConfidence(data) {
    if (!this.currentAssistantEl) return;
    const contentEl = this.currentAssistantEl.querySelector('.msg-content');
    if (!contentEl) return;
    const el = (typeof BlockFactory !== 'undefined')
      ? BlockFactory.render({ type: 'confidence_bar', data, provenance: 'computed' })
      : document.createElement('span');
    contentEl.appendChild(el);
    this.autoScroller.scrollToBottom();
  }

  // ── B-26: Evolving Summary Bar ────────────────────────────────────────
  // FIX #2: Currently purely local (extracts topics from DOM text).
  // Phase F upgrade path: replace with LLM-generated summaries via
  // a dedicated summarize endpoint that produces a 1-line conversation digest.

  _updateSummaryBar() {
    if (sessionStorage.getItem('athena-summary-dismissed') === 'true') return;
    if (this.messageCount < 3 || this.messageCount % 3 !== 0) return;

    let bar = this.panel?.querySelector('.athena-summary-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'athena-summary-bar';
      bar.innerHTML = '<span class="summary-text"></span><button class="summary-dismiss" aria-label="Dismiss summary">x</button>';
      bar.querySelector('.summary-dismiss').addEventListener('click', () => {
        bar.style.display = 'none';
        sessionStorage.setItem('athena-summary-dismissed', 'true');
      });
      // Insert before messages area
      const messagesArea = this.messagesContainer;
      if (messagesArea && messagesArea.parentNode) {
        messagesArea.parentNode.insertBefore(bar, messagesArea);
      }
    }

    // Build summary from recent messages
    const msgEls = this.messagesContainer.querySelectorAll('.msg-user .msg-content p');
    const recentTexts = Array.from(msgEls).slice(-3).map(el => el.textContent);
    const summary = recentTexts.length > 0
      ? `Topics: ${recentTexts.map(t => t.substring(0, 30)).join(', ')}`
      : 'Start a conversation to see a summary here.';
    bar.querySelector('.summary-text').textContent = summary;
    bar.style.display = '';
  }

  // ── B-28: Collapsible Long Responses ──────────────────────────────────

  _checkCollapse() {
    if (!this.currentAssistantEl) return;
    const contentEl = this.currentAssistantEl.querySelector('.msg-content');
    if (!contentEl) return;
    // Check rendered height
    if (contentEl.scrollHeight > 600) {
      this.currentAssistantEl.classList.add('msg-collapsed');
      // Add "Show more" button if not already present
      if (!this.currentAssistantEl.querySelector('.msg-show-more-btn')) {
        const btn = document.createElement('button');
        btn.className = 'msg-show-more-btn';
        btn.textContent = 'Show more';
        const collapsedEl = this.currentAssistantEl; // R3-01: capture before endStream nullifies
        btn.addEventListener('click', () => {
          collapsedEl.classList.remove('msg-collapsed');
          btn.remove();
        });
        collapsedEl.appendChild(btn);
      }
    }
  }

  // ── B-29: Follow-Up Suggestions ───────────────────────────────────────

  _handleFollowups(data) {
    if (!this.currentAssistantEl) return;
    const suggestions = data.suggestions || [];
    if (!suggestions.length) return;

    // Remove any previous followup pills
    this._removeFollowups();

    const container = document.createElement('div');
    container.className = 'athena-followup-pills';
    for (const text of suggestions.slice(0, 4)) {
      const pill = document.createElement('button');
      pill.className = 'followup-pill';
      pill.textContent = text;
      pill.addEventListener('click', () => {
        this._removeFollowups();
        document.dispatchEvent(new CustomEvent('athena:send', { detail: { message: text } }));
      });
      container.appendChild(pill);
    }
    this.currentAssistantEl.appendChild(container);
    this.autoScroller.scrollToBottom();
  }

  _removeFollowups() {
    const pills = this.messagesContainer.querySelectorAll('.athena-followup-pills');
    pills.forEach(el => el.remove());
  }

  // ── B-30: Quick Action Buttons ────────────────────────────────────────

  _generateQuickActions() {
    if (!this.currentAssistantEl) return;
    const blocks = this.currentAssistantEl.querySelectorAll('.block');
    const actions = [];

    blocks.forEach(blockEl => {
      const type = blockEl.className.match(/block-(\S+)/)?.[1]?.replace(/-/g, '_');
      if (type === 'paper_card') {
        const paperId = blockEl.dataset?.paperId || '';
        const titleEl = blockEl.querySelector('.paper-title, [style*="font-weight:600"]');
        const title = titleEl?.textContent || 'this paper';
        if (paperId) {
          actions.push({ label: 'Show on graph', event: 'athena:navigate', payload: { paperId } });
        }
        actions.push({ label: 'Deep dive', event: 'athena:send', payload: `Deep dive into ${title.substring(0, 40)}` });
      }
      if (type === 'timeline') {
        actions.push({ label: 'Narrate this timeline', event: 'athena:send', payload: '/timeline narrate' });
      }
    });

    actions.push({ label: 'Ask a follow-up', event: 'focus-input', payload: null });
    const limited = actions.slice(0, 4);

    if (limited.length > 0) {
      const container = document.createElement('div');
      container.className = 'athena-quick-actions';
      for (const action of limited) {
        const btn = document.createElement('button');
        btn.className = 'quick-action-btn';
        btn.textContent = action.label;
        btn.addEventListener('click', () => {
          if (action.event === 'focus-input') {
            const textarea = document.querySelector('.athena-textarea');
            if (textarea) textarea.focus();
          } else if (action.event === 'athena:send') {
            document.dispatchEvent(new CustomEvent('athena:send', { detail: { message: action.payload } }));
          } else {
            document.dispatchEvent(new CustomEvent(action.event, { detail: action.payload }));
          }
        });
        container.appendChild(btn);
      }
      this.currentAssistantEl.appendChild(container);
    }
  }

  // ── Utilities ───────────────────────────────────────────────────────────

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ── Auto-Scroller (per ATHENA_PHASE_A.md Section 2.1.6) ────────────────────

class AutoScroller {
  constructor(container) {
    this.container = container;
    this.userScrolledUp = false;

    this.container.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = this.container;
      this.userScrolledUp = (scrollHeight - scrollTop - clientHeight) > 50;

      // Toggle scroll-to-bottom button
      const btn = document.querySelector('.athena-scroll-bottom');
      if (btn) btn.classList.toggle('visible', this.userScrolledUp);
    });
  }

  scrollToBottom() {
    if (!this.userScrolledUp) {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// B-31: #056 Slash Command System
// Per ATHENA_PHASE_B.md Section 2.1.12
// ══════════════════════════════════════════════════════════════════════════════

class SlashCommandRegistry {
  constructor() {
    this.commands = [
      { command: '/help',      description: 'Show available commands',       handler: () => this._dispatch('help') },
      { command: '/clear',     description: 'Start new conversation',        handler: () => this._dispatch('clear') },
      { command: '/compare',   description: 'Compare two papers',            args: '[paper1] [paper2]', handler: (args) => this._dispatch('compare', args) },
      { command: '/timeline',  description: 'Show timeline of the lineage',  handler: () => this._dispatch('timeline') },
      { command: '/deep-dive', description: 'Deep analysis of a paper',      args: '[paper]', handler: (args) => this._dispatch('deep-dive', args) },
      { command: '/mode',      description: 'Switch conversation mode',      args: '[mode name]', handler: (args) => this._dispatch('mode', args) },
      { command: '/stats',     description: 'Show graph statistics',         handler: () => this._dispatch('stats') },
      { command: '/prune',     description: 'Simulate removing a paper',     args: '[paper]', handler: (args) => this._dispatch('prune', args) },
      { command: '/terminal',  description: 'Open Arivu Terminal',           handler: () => this._dispatch('terminal') },
      { command: '/cmd',       description: 'Open Arivu Terminal',           handler: () => this._dispatch('terminal') },
    ];
    this.menuEl = null;
    this.activeIndex = 0;
    this.filtered = [];
    this._setupInputListener();
  }

  _dispatch(type, args) {
    if (type === 'clear' && window.athenaEngine) {
      window.athenaEngine.clearConversation();
    } else if (type === 'help') {
      // B2-10 fix: Show help locally instead of sending to LLM
      const helpLines = this.commands.map(c => `**${c.command}** ${c.args || ''} - ${c.description}`);
      const helpText = 'Available commands:\n' + helpLines.join('\n');
      if (window.athenaEngine) {
        const msgEl = window.athenaEngine._appendAssistantMessage();
        const contentEl = msgEl.querySelector('.msg-content');
        contentEl.innerHTML = window.athenaEngine._renderMarkdownFull(helpText);
        window.athenaEngine.autoScroller.scrollToBottom();
      }
    } else if (type === 'terminal') {
      // Open a new Arivu Terminal without stealing Athena focus
      if (window.terminalManager) {
        window.terminalManager.create();
        // Refocus Athena input after terminal steals focus
        setTimeout(() => {
          const athenaInput = document.querySelector('.athena-textarea');
          if (athenaInput) athenaInput.focus();
        }, 150);
      }
    } else {
      const argStr = args ? ` ${args.join(' ')}` : '';
      document.dispatchEvent(new CustomEvent('athena:send', { detail: { message: `/${type}${argStr}` } }));
    }
  }

  _setupInputListener() {
    const textarea = document.querySelector('.athena-textarea');
    if (!textarea) return;
    const wrapper = textarea.closest('.athena-input-wrapper');
    if (!wrapper) return;

    textarea.addEventListener('input', () => {
      const val = textarea.value;
      if (val.startsWith('/')) {
        const query = val.toLowerCase();
        this.filtered = this.commands.filter(c => c.command.startsWith(query));
        if (this.filtered.length > 0) {
          this._showMenu(wrapper, this.filtered);
        } else {
          this._hideMenu();
        }
      } else {
        this._hideMenu();
      }
    });

    textarea.addEventListener('keydown', (e) => {
      if (!this.menuEl) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.activeIndex = Math.min(this.activeIndex + 1, this.filtered.length - 1);
        this._highlightItem();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.activeIndex = Math.max(this.activeIndex - 1, 0);
        this._highlightItem();
      } else if (e.key === 'Enter' && this.filtered[this.activeIndex]) {
        e.preventDefault();
        const cmd = this.filtered[this.activeIndex];
        textarea.value = cmd.command + ' ';
        this._hideMenu();
        textarea.focus();
      } else if (e.key === 'Escape') {
        this._hideMenu();
      }
    });
  }

  _showMenu(wrapper, items) {
    this._hideMenu();
    this.activeIndex = 0;
    this.menuEl = document.createElement('div');
    this.menuEl.className = 'athena-slash-menu';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const btn = document.createElement('button');
      btn.className = `athena-slash-menu-item${i === 0 ? ' active' : ''}`;
      btn.innerHTML = `<span class="slash-cmd-name">${item.command}</span><span class="slash-cmd-desc">${item.description}</span>`;
      btn.addEventListener('click', () => {
        const textarea = wrapper.querySelector('.athena-textarea');
        if (textarea) { textarea.value = item.command + ' '; textarea.focus(); }
        this._hideMenu();
      });
      this.menuEl.appendChild(btn);
    }
    wrapper.style.position = 'relative';
    wrapper.appendChild(this.menuEl);
  }

  _hideMenu() {
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
  }

  _highlightItem() {
    if (!this.menuEl) return;
    const items = this.menuEl.querySelectorAll('.athena-slash-menu-item');
    items.forEach((el, i) => el.classList.toggle('active', i === this.activeIndex));
  }

  parseSlashCommand(input) {
    const parts = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    for (const char of input) {
      if (!inQuote && (char === '"' || char === "'")) { inQuote = true; quoteChar = char; }
      else if (inQuote && char === quoteChar) { inQuote = false; }
      else if (!inQuote && char === ' ') { if (current) parts.push(current); current = ''; }
      else { current += char; }
    }
    if (current) parts.push(current);
    return { command: parts[0], args: parts.slice(1) };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// B-32: #048 Conversation History Sidebar
// Per ATHENA_PHASE_B.md Section 2.1.13
// ══════════════════════════════════════════════════════════════════════════════

class AthenaHistorySidebar {
  constructor(panelEl) {
    this.panel = panelEl;
    this.sidebar = null;
    this.sessions = [];
    this._build();
    this._bindToggle();
  }

  _build() {
    this.sidebar = document.createElement('div');
    this.sidebar.className = 'athena-history-sidebar';
    this.sidebar.innerHTML = `
      <div class="athena-history-header">
        <span>History</span>
        <button class="athena-history-close" aria-label="Close history">x</button>
      </div>
      <div class="athena-history-search">
        <input type="text" placeholder="Search conversations..." aria-label="Search history" />
      </div>
      <div class="athena-history-list"></div>
    `;

    this.sidebar.querySelector('.athena-history-close').addEventListener('click', () => this.close());
    this.sidebar.querySelector('.athena-history-search input').addEventListener('input', (e) => {
      this._filterSessions(e.target.value);
    });

    if (this.panel) {
      this.panel.appendChild(this.sidebar);
    }
  }

  _bindToggle() {
    const historyBtn = this.panel?.querySelector('.athena-history-btn');
    if (historyBtn) {
      historyBtn.addEventListener('click', () => this.toggle());
    }
  }

  toggle() {
    if (this.sidebar.classList.contains('open')) {
      this.close();
    } else {
      this.open();
    }
  }

  async open() {
    this.sidebar.classList.add('open');
    await this._loadSessions();
  }

  close() {
    this.sidebar.classList.remove('open');
  }

  async _loadSessions() {
    try {
      const res = await fetch('/api/athena/history/sessions');
      if (!res.ok) return;
      const data = await res.json();
      this.sessions = data.sessions || [];
      this._renderSessions(this.sessions);
    } catch (e) {
      console.warn('Failed to load history sessions:', e);
      this._renderEmpty();
    }
  }

  _renderSessions(sessions) {
    const listEl = this.sidebar.querySelector('.athena-history-list');
    listEl.innerHTML = '';

    if (!sessions.length) {
      this._renderEmpty();
      return;
    }

    const now = new Date();
    const today = now.toDateString();
    const yesterday = new Date(now - 86400000).toDateString();
    const weekAgo = new Date(now - 7 * 86400000);

    const groups = { today: [], yesterday: [], week: [], older: [] };
    for (const s of sessions) {
      const d = new Date(s.last_active);
      if (d.toDateString() === today) groups.today.push(s);
      else if (d.toDateString() === yesterday) groups.yesterday.push(s);
      else if (d > weekAgo) groups.week.push(s);
      else groups.older.push(s);
    }

    const groupLabels = [
      ['today', 'Today'], ['yesterday', 'Yesterday'],
      ['week', 'Last 7 Days'], ['older', 'Older'],
    ];

    for (const [key, label] of groupLabels) {
      if (groups[key].length === 0) continue;
      const groupLabel = document.createElement('div');
      groupLabel.className = 'athena-history-group-label';
      groupLabel.textContent = label;
      listEl.appendChild(groupLabel);

      for (const session of groups[key]) {
        const item = document.createElement('button');
        item.className = 'athena-history-item';
        item.innerHTML = `
          <div class="athena-history-item-title">${this._esc(session.first_message || session.topic_summary || 'Untitled')}</div>
          <div class="athena-history-item-meta">${session.message_count || 0} messages${session.graph_title ? ' | ' + this._esc(session.graph_title) : ''}</div>
        `;
        item.addEventListener('click', () => {
          document.dispatchEvent(new CustomEvent('athena:session-load', { detail: { thread_id: session.thread_id } }));
          this.close();
        });
        listEl.appendChild(item);
      }
    }
  }

  _renderEmpty() {
    const listEl = this.sidebar.querySelector('.athena-history-list');
    listEl.innerHTML = '<div class="athena-history-empty">No past conversations. Start chatting!</div>';
  }

  _filterSessions(query) {
    if (!query) {
      this._renderSessions(this.sessions);
      return;
    }
    const q = query.toLowerCase();
    const filtered = this.sessions.filter(s =>
      (s.first_message || '').toLowerCase().includes(q) ||
      (s.graph_title || '').toLowerCase().includes(q) ||
      (s.topic_summary || '').toLowerCase().includes(q)
    );
    this._renderSessions(filtered);
  }

  _esc(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// B-33: #049 Mode Selector
// Per ATHENA_PHASE_B.md Section 2.1.24
// ══════════════════════════════════════════════════════════════════════════════

class ModeSelector {
  constructor(containerEl) {
    this.container = containerEl;
    this.current = sessionStorage.getItem('athena-mode') || 'default';
    this.modes = [
      { id: 'default',     name: 'Explorer',    desc: 'Explore the research graph freely', enabled: true },
      { id: 'analyst',     name: 'Analyst',     desc: 'Quantitative focus with data blocks', enabled: true },
      { id: 'storyteller', name: 'Storyteller', desc: 'Narrative research storytelling', enabled: true },
      { id: 'debate',      name: 'Debate',      desc: 'Coming in Phase E', enabled: false },
      { id: 'teach',       name: 'Teacher',     desc: 'Coming in Phase E', enabled: false },
      { id: 'socratic',    name: 'Socratic',    desc: 'Coming in Phase E', enabled: false },
    ];
    this.dropdownEl = null;
    this._build();
  }

  _build() {
    if (!this.container) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'athena-mode-selector';

    const btn = document.createElement('button');
    btn.className = 'athena-mode-btn';
    btn.innerHTML = `<span class="mode-current-name">${this._currentName()}</span> <span style="font-size:8px">&#9662;</span>`;
    btn.addEventListener('click', () => this._toggleDropdown());
    wrapper.appendChild(btn);
    this.btnEl = btn;

    this.dropdownEl = document.createElement('div');
    this.dropdownEl.className = 'athena-mode-dropdown-menu';
    for (const mode of this.modes) {
      const option = document.createElement('button');
      option.className = `athena-mode-option-item${mode.id === this.current ? ' active' : ''}${!mode.enabled ? ' disabled' : ''}`;
      option.innerHTML = `<span class="mode-opt-name">${mode.name}</span><span class="mode-opt-desc">${mode.desc}</span>`;
      option.addEventListener('click', () => {
        if (!mode.enabled) return;
        this.select(mode.id);
        this._hideDropdown();
      });
      this.dropdownEl.appendChild(option);
    }
    wrapper.appendChild(this.dropdownEl);
    this.container.appendChild(wrapper);

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) this._hideDropdown();
    });
  }

  _currentName() {
    const m = this.modes.find(m => m.id === this.current);
    return m ? m.name : 'Explorer';
  }

  _toggleDropdown() {
    this.dropdownEl.classList.toggle('visible');
  }

  _hideDropdown() {
    this.dropdownEl.classList.remove('visible');
  }

  select(modeId) {
    const mode = this.modes.find(m => m.id === modeId);
    if (!mode || !mode.enabled) return;
    this.current = modeId;
    sessionStorage.setItem('athena-mode', modeId);

    // Update button label
    this.btnEl.querySelector('.mode-current-name').textContent = mode.name;

    // Update active state in dropdown
    this.dropdownEl.querySelectorAll('.athena-mode-option-item').forEach((el, i) => {
      el.classList.toggle('active', this.modes[i].id === modeId);
    });

    // Dispatch mode change event
    document.dispatchEvent(new CustomEvent('athena:mode-change', { detail: { mode: modeId } }));
  }

  getMode() {
    return this.current;
  }
}

window.SlashCommandRegistry = SlashCommandRegistry;
window.AthenaHistorySidebar = AthenaHistorySidebar;
window.ModeSelector = ModeSelector;

// ── Initialize ──────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.athenaEngine = new AthenaEngine();
    window.athenaSlashCommands = new SlashCommandRegistry();
    const panel = document.getElementById('athena-panel');
    if (panel) {
      window.athenaHistory = new AthenaHistorySidebar(panel);
      const headerControls = panel.querySelector('.athena-header-controls');
      if (headerControls) {
        window.athenaModeSelector = new ModeSelector(headerControls);
      }
    }
  });
} else {
  window.athenaEngine = new AthenaEngine();
  window.athenaSlashCommands = new SlashCommandRegistry();
  const panel = document.getElementById('athena-panel');
  if (panel) {
    window.athenaHistory = new AthenaHistorySidebar(panel);
    const headerControls = panel.querySelector('.athena-header-controls');
    if (headerControls) {
      window.athenaModeSelector = new ModeSelector(headerControls);
    }
  }
}
