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
    const url = `/api/graph/stream?paper_id=${encodeURIComponent(this.paperId)}&goal=${this.goal}`;
    this.eventSource = new EventSource(url);

    this.eventSource.addEventListener('message', (e) => {
      try { this._handleEvent(JSON.parse(e.data)); } catch(err) { console.error('SSE parse error', err); }
    });

    this.eventSource.addEventListener('error', () => {
      if (this.eventSource.readyState === EventSource.CLOSED) {
        this._showError('Connection to server was lost. Please refresh.');
      }
    });
  }

  _handleEvent(data) {
    switch(data.status) {
      case 'searching':  this._updateProgress('🔍', data.message || 'Searching...', 5); break;
      case 'crawling':   this._updateProgress('🕸️', data.message || 'Crawling references...', 20); break;
      case 'analyzing':  this._updateProgress('🧠', data.message || 'Analysing relationships...', 60); break;
      case 'computing':  this._updateProgress('⚡', data.message || 'Computing insights...', 85); break;
      case 'done':
        this._updateProgress('✅', 'Graph ready!', 100);
        this.eventSource.close();
        if (data.cached) {
          fetch(data.graph_url).then(r => r.json()).then(g => this._initGraph(g));
        } else {
          this._initGraph(data.graph);
        }
        break;
      case 'error':
        this._showError(data.message || 'Graph build failed.');
        this.eventSource.close();
        break;
    }
  }

  _initGraph(graphData) {
    document.getElementById('loading-overlay').hidden = true;

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
      const resp = await fetch(`/api/genealogy/${encodeURIComponent(this.paperId)}`);
      const data = await resp.json();
      content.textContent = data.narrative || data.error || 'No narrative available.';
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

      messages.innerHTML += `<div style="text-align:right;margin-bottom:6px;font-size:0.85rem;color:var(--text-primary)">${text}</div>`;

      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ message: text, graph_summary: graphSummary, current_view: { type: 'overview' } })
      });
      const data = await resp.json();
      const reply = data.response || 'No response.';
      messages.innerHTML += `<div style="margin-bottom:8px;font-size:0.85rem;color:var(--text-secondary)">${reply}</div>`;
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

  _updateProgress(icon, message, pct) {
    const iconEl = document.getElementById('progress-icon');
    const msgEl = document.getElementById('progress-message');
    const bar = document.getElementById('progress-bar');
    const log = document.getElementById('progress-log');
    if (iconEl) iconEl.textContent = icon;
    if (msgEl) msgEl.textContent = message;
    if (bar) { bar.style.width = `${pct}%`; bar.parentElement?.setAttribute('aria-valuenow', pct); }
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

// Auto-initialize on tool page
document.addEventListener('DOMContentLoaded', () => {
  const cfg = window.ARIVU_CONFIG;
  if (!cfg || !cfg.paperId) return;

  if (cfg.isGallery) {
    // Gallery: load precomputed JSON directly
    fetch(`/static/previews/${cfg.paperId}/graph.json`)
      .then(r => r.json())
      .then(g => new GraphLoader(cfg.paperId)._initGraph(g))
      .catch(() => new GraphLoader(cfg.paperId).start());
  } else {
    new GraphLoader(cfg.paperId).start();
  }
});
