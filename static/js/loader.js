/**
 * static/js/loader.js
 * GraphLoader: SSE client for progressive graph building.
 * Orchestrates all panel initialization when graph is ready.
 */

class GraphLoader {
  constructor(paperId, goal = 'general') {
    this.paperId = paperId;
    this.goal = goal;
    this.eventSource = null;
    this._graph = null;
    this._panel = new RightPanel();
    window._rightPanel = this._panel;
  }

  start() {
    this._intentionalClose = false;  // Reset for retries
    const url = `/api/graph/stream?paper_id=${encodeURIComponent(this.paperId)}&goal=${this.goal}`;
    this.eventSource = new EventSource(url);
    this._lastEventTime = Date.now();

    // Timeout: if no SSE event received for 180s, show error instead of hanging.
    // NLP worker on HuggingFace Spaces can take 60-90s to wake from cold start,
    // so 180s gives enough headroom for wake + first embedding batch.
    this._stallTimer = setInterval(() => {
      if (Date.now() - this._lastEventTime > 180000) {
        clearInterval(this._stallTimer);
        this._intentionalClose = true;
        this.eventSource.close();
        this._showError('Graph build is taking too long. The server may be busy — try again later or try a different paper.');
      }
    }, 15000);

    this.eventSource.addEventListener('message', (e) => {
      this._lastEventTime = Date.now();
      this._reconnectCount = 0;  // Reset reconnect counter on successful data
      try { this._handleEvent(JSON.parse(e.data)); } catch(err) { console.error('SSE parse error', err); }
    });

    this.eventSource.addEventListener('error', () => {
      // Guard: when WE close the EventSource (e.g. for retry), the browser
      // may fire a final 'error' event with readyState=CLOSED. Suppress it
      // so it doesn't overwrite the retry progress message.
      if (this._intentionalClose) return;

      if (this.eventSource.readyState === EventSource.CLOSED) {
        // Koyeb's proxy may send a 502/504 when its request timeout (~300s)
        // is hit, which causes EventSource to go straight to CLOSED instead
        // of CONNECTING.  Auto-retry up to 3 times with a fresh EventSource.
        this._reconnectCount = (this._reconnectCount || 0) + 1;
        if (this._reconnectCount <= 3) {
          console.log(`[Arivu] SSE connection closed by proxy — retry ${this._reconnectCount}/3`);
          this._updateProgress('🔄', `Reconnecting to server (attempt ${this._reconnectCount}/3)...`, null);
          this.eventSource.close();
          this._intentionalClose = true;
          setTimeout(() => this.start(), 2000);
        } else {
          clearInterval(this._stallTimer);
          this._showError('Connection to server was lost after multiple retries. Please refresh.');
        }
      }
      // readyState === CONNECTING: browser is auto-reconnecting — do nothing
    });
  }

  _handleEvent(data) {
    switch(data.status) {
      case 'keepalive':  break; // Silent — stall timer already reset by message listener
      case 'searching':  this._updateProgress('🔍', data.message || 'Searching...', 5); break;
      case 'crawling':   this._updateProgress('🕸️', data.message || 'Crawling references...', 20); break;
      case 'analyzing':  this._updateProgress('🧠', data.message || 'Analysing relationships...', 60); break;
      case 'computing':  this._updateProgress('⚡', data.message || 'Computing insights...', 85); break;
      case 'finalizing': this._updateProgress('⚙️', data.message || 'Finalizing graph...', 92); break;
      case 'done':
        this._retryCount = 0;  // Reset on success
        this._updateProgress('✅', 'Graph ready!', 100);
        clearInterval(this._stallTimer);
        this._intentionalClose = true;
        this.eventSource.close();
        // Both cached and fresh builds send graph data inline via data.graph.
        // (data.graph_url was never populated by the server — that code path was a bug.)
        if (data.graph) {
          this._initGraph(data.graph);
        } else if (data.graph_url) {
          fetch(data.graph_url).then(r => r.json()).then(g => this._initGraph(g))
            .catch(() => this._showError('Failed to load graph data.'));
        } else {
          this._showError('Graph completed but data is missing. Please refresh and try again.');
        }
        break;
      case 'error':
        clearInterval(this._stallTimer);
        this._intentionalClose = true;
        this.eventSource.close();
        if (data.retry) {
          // Stall/restart detected — automatically retry after a short delay.
          // The server has already marked the dead job as 'timed_out', so the
          // reconnection guard will start a fresh build on the next request.
          this._retryCount = (this._retryCount || 0) + 1;
          if (this._retryCount <= 2) {
            this._updateProgress('🔄', 'Server restarted. Retrying in 3 seconds...', 0);
            setTimeout(() => this.start(), 3000);
          } else {
            this._showError('Build failed after multiple retries. Please try again later.');
          }
        } else {
          this._showError(data.message || 'Graph build failed.');
        }
        break;
      case 'timeout':
        // Server-side 5-minute build timeout
        this._showError(data.message || 'Graph build timed out. Please try again.');
        clearInterval(this._stallTimer);
        this._intentionalClose = true;
        this.eventSource.close();
        break;
    }
  }

  _initGraph(graphData) {
    try {
    // After graph resolution, update paperId to the canonical seed_paper_id
    // (the S2 ID). The user may have entered a DOI, arXiv ID, or title —
    // the graph engine resolves it to an S2 paper_id stored as seed_paper_id.
    // All subsequent API calls (orphans, coverage, DNA, etc.) need this ID.
    if (graphData.metadata && graphData.metadata.seed_paper_id) {
      this.paperId = graphData.metadata.seed_paper_id;
    }

    // Use classList (not .hidden attribute) — the CSS rule
    // #loading-overlay { display:flex } has higher specificity than
    // the UA [hidden] { display:none }, so .hidden = true won't work.
    document.getElementById('loading-overlay').classList.add('hidden');

    const container = document.getElementById('graph-svg-container');
    this._graph = new ArivuGraph(container, graphData);
    window._arivuGraph = this._graph;

    const pruning = new PruningSystem(this._graph);

    // Update header
    const headerInfo = document.getElementById('header-paper-info');
    if (headerInfo && graphData.metadata) {
      headerInfo.textContent = graphData.metadata.seed_paper_title || '';
    }

    // Populate panels
    this._panel.renderDNAProfile(graphData.dna_profile);
    this._panel.renderDiversityScore(graphData.diversity_score);
    if (graphData.leaderboard) this._panel.populateLeaderboard(graphData.leaderboard);

    // Load orphans
    fetch(`/api/orphans/${encodeURIComponent(this.paperId)}`)
      .then(r => r.json())
      .then(data => this._panel.populateOrphans(data.orphans));

    // Load data coverage
    fetch(`/api/coverage-report/${encodeURIComponent(this.paperId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) this._renderCoverage(data); })
      .catch(() => {});

    // Leaderboard toggle
    document.getElementById('leaderboard-toggle')?.addEventListener('click', () => {
      const sidebar = document.getElementById('leaderboard-sidebar');
      const isOpen = sidebar.classList.toggle('open');
      sidebar.setAttribute('aria-hidden', String(!isOpen));
    });

    // Genealogy button
    document.getElementById('genealogy-btn')?.addEventListener('click', async () => {
      const modal = document.getElementById('genealogy-modal');
      const content = document.getElementById('genealogy-content');
      content.textContent = 'Generating genealogy narrative…';
      modal.showModal();
      try {
        const resp = await fetch(`/api/genealogy/${encodeURIComponent(this.paperId)}`);
        const data = await resp.json();
        if (data.narrative) {
          content.textContent = data.narrative;
        } else if (data.error === 'LLM not configured') {
          content.textContent = 'Genealogy stories require an AI language model (Groq). The service is not configured on this instance.';
        } else {
          content.textContent = data.error || 'No narrative available. The graph may still be loading.';
        }
      } catch (err) {
        content.textContent = 'Failed to generate genealogy narrative. Please try again.';
      }
    });
    document.getElementById('genealogy-close')?.addEventListener('click', () => {
      document.getElementById('genealogy-modal').close();
    });

    // Chat guide
    this._initChat(graphData.metadata || {});

    // Accessibility table view
    document.getElementById('accessibility-toggle')?.addEventListener('click', () => {
      const tv = document.getElementById('table-view');
      tv.hidden = !tv.hidden;
      if (!tv.hidden) this._populateTableView(graphData);
    });

    // Initialise semantic zoom AFTER graph renders and node positions settle
    if (window.SemanticZoomRenderer && window._arivuGraph && graphData.dna_profile?.clusters) {
      window._arivuGraph._semanticZoom = new SemanticZoomRenderer(
        window._arivuGraph,
        graphData.dna_profile
      );
    }

    // Initialise export panel after graph loads
    if (window.ExportPanel) {
      const exportPanel = new ExportPanel("export-panel-container");
      exportPanel.render();
    }

    } catch (err) {
      console.error('Graph initialization error:', err);
      this._showError(`Graph loaded but failed to render: ${err.message}. Please refresh.`);
    }
  }

  _initChat(graphSummary) {
    const input = document.getElementById('chat-input');
    const send = document.getElementById('chat-send');
    const messages = document.getElementById('chat-messages');
    if (!input || !send || !messages) return;

    const sendMessage = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      send.disabled = true;

      messages.innerHTML += `<div style="text-align:right;margin-bottom:6px;font-size:0.85rem;color:var(--text-primary)">${text}</div>`;
      messages.scrollTop = messages.scrollHeight;

      try {
        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ message: text, graph_summary: graphSummary, current_view: { type: 'overview' } })
        });
        const data = await resp.json();
        const reply = data.response || 'No response.';
        messages.innerHTML += `<div style="margin-bottom:8px;font-size:0.85rem;color:var(--text-secondary)">${reply}</div>`;
      } catch (err) {
        messages.innerHTML += `<div style="margin-bottom:8px;font-size:0.85rem;color:var(--danger)">Failed to get response. Please try again.</div>`;
      }
      send.disabled = false;
      messages.scrollTop = messages.scrollHeight;
    };

    send.addEventListener('click', sendMessage);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });
  }

  _populateTableView(graphData) {
    const tbody = document.getElementById('papers-tbody');
    if (!tbody || !graphData.nodes) return;
    tbody.innerHTML = graphData.nodes
      .sort((a,b) => (b.citation_count||0) - (a.citation_count||0))
      .map(n => `
        <tr>
          <td><a href="${n.url||'#'}" target="_blank" rel="noopener">${n.title||'Unknown'}</a></td>
          <td>${(n.authors||[]).slice(0,2).join(', ')}</td>
          <td>${(n.citation_count||0).toLocaleString()}</td>
          <td>${n.year||'?'}</td>
          <td>${(n.fields_of_study||[])[0]||'?'}</td>
          <td>${n.pruning_impact ? n.pruning_impact + ' papers' : '—'}</td>
        </tr>
      `).join('');
  }

  _renderCoverage(data) {
    const container = document.getElementById('coverage-details');
    if (!container) return;
    const pct = data.abstract_coverage?.pct || 0;
    const label = data.reliability_label || 'LOW';
    const labelColor = label === 'HIGH' ? 'var(--success)' : label === 'MEDIUM' ? 'var(--warning)' : 'var(--danger)';
    container.innerHTML = `
      <div style="padding:16px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
          <span style="font-size:2rem;font-weight:700;color:${labelColor}">${pct}%</span>
          <div>
            <div style="font-size:0.9rem;color:var(--text-primary)">Abstract Coverage</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">${data.abstract_coverage?.count || 0} of ${data.abstract_coverage?.total || 0} papers have abstracts</div>
          </div>
        </div>
        <div style="background:var(--bg-elevated);border-radius:6px;height:8px;overflow:hidden;margin-bottom:12px">
          <div style="width:${pct}%;height:100%;background:${labelColor};border-radius:6px;transition:width 0.5s ease"></div>
        </div>
        <div style="font-size:0.8rem;color:var(--text-secondary)">
          Reliability: <span style="color:${labelColor};font-weight:600">${label}</span>
          — ${label === 'HIGH' ? 'Graph insights are well-supported by paper abstracts.' :
               label === 'MEDIUM' ? 'Some papers lack abstracts. Insights may be incomplete.' :
               'Many papers lack abstracts. Consider this when interpreting results.'}
        </div>
      </div>
    `;
  }

  _updateProgress(icon, message, pct) {
    const iconEl = document.getElementById('progress-icon');
    const msgEl = document.getElementById('progress-message');
    const bar = document.getElementById('progress-bar');
    const log = document.getElementById('progress-log');
    if (iconEl) iconEl.textContent = icon;
    if (msgEl) msgEl.textContent = message;
    if (bar && pct != null) { bar.style.width = `${pct}%`; bar.parentElement?.setAttribute('aria-valuenow', pct); }
    if (log) {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
      log.prepend(entry);
    }
  }

  _showError(msg) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.innerHTML = `<div class="loading-inner"><p style="color:var(--danger)">${msg}</p><a href="/" style="color:var(--accent-blue)">← Back to search</a></div>`;
  }
}

// Slug → S2 corpus ID mapping for gallery papers
const GALLERY_S2_IDS = {
  attention: '204e3073870fae3d05bcbc2f6a8e263d9b72e776',
  alexnet:   'abd1c342495432171beb7ca8fd9551ef13cbd0ff',
  bert:      'df2b0e26d0599ce3e70df8a9da02e51594e0e992',
  gans:      '54e325aee6b2d476bbbb88615ac15e251c6e8214',
  word2vec:  '330da625c15427c6e42ccfa3b747fb29e5835bf0',
  resnet:    '2c03df8b48bf3fa39054345bafabfeff15bfd11d',
  gpt2:      '9405cc0d6169988371b2755e573cc28650d14dfe',
};

// Auto-initialize on tool page
document.addEventListener('DOMContentLoaded', () => {
  const cfg = window.ARIVU_CONFIG;
  if (!cfg || !cfg.paperId) return;

  if (cfg.isGallery) {
    // Gallery: load precomputed JSON directly
    fetch(`/static/previews/${cfg.paperId}/graph.json`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(g => new GraphLoader(cfg.paperId)._initGraph(g))
      .catch(() => {
        // Precomputed graph not available — fall back to SSE build with real S2 ID
        const realId = GALLERY_S2_IDS[cfg.paperId];
        if (realId) {
          new GraphLoader(realId).start();
        } else {
          // Unknown slug — show error instead of hanging
          const overlay = document.getElementById('loading-overlay');
          if (overlay) overlay.innerHTML = '<div class="loading-inner"><p style="color:var(--danger)">This gallery paper has not been precomputed yet. Building graph from scratch...</p></div>';
          new GraphLoader(cfg.paperId).start();
        }
      });
  } else {
    new GraphLoader(cfg.paperId).start();
  }
});
