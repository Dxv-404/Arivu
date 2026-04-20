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
      // fires a re-entrant 'error' event synchronously from .close().
      // _intentionalClose MUST be set BEFORE .close() to prevent re-entry.
      if (this._intentionalClose) return;

      if (this.eventSource.readyState === EventSource.CLOSED) {
        // Koyeb's proxy sends 502/504 when its request timeout (~300s) hits,
        // causing EventSource to go straight to CLOSED.  Auto-retry up to 5
        // times with a fresh EventSource.  Each successful message resets the
        // counter, so a 10-minute build survives 2+ proxy cycles.
        this._reconnectCount = (this._reconnectCount || 0) + 1;
        if (this._reconnectCount <= 5) {
          console.log(`[Arivu] SSE connection closed by proxy — retry ${this._reconnectCount}/5`);
          this._updateProgress('🔄', `Reconnecting to server (attempt ${this._reconnectCount}/5)...`, null);
          // Set _intentionalClose BEFORE close() to prevent re-entrant error
          this._intentionalClose = true;
          this.eventSource.close();
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
    // Clear stale prune state from previous graph
    window._lastPruneResult = null;

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

    // Listen for orphan highlight requests — works in both force and tree views
    window.addEventListener('arivu:highlight-node', (e) => {
      const paperId = e.detail?.paperId;
      if (!paperId) return;

      // Check which view is active
      const currentView = document.querySelector('.view-btn.active')?.dataset?.view;

      if (currentView === 'tree' && window._treeLayout && window._treeLayout.nodeGroup) {
        // Highlight in tree view
        const treeNode = window._treeLayout.nodeGroup.select(`g.tree-node[data-id="${paperId}"]`);
        if (!treeNode.empty()) {
          treeNode.select('rect')
            .transition().duration(600)
            .attr('stroke', '#D4A843')
            .attr('stroke-width', 3);
          // Auto-remove after 4 seconds
          setTimeout(() => {
            treeNode.select('rect')
              .transition().duration(300)
              .attr('stroke', '#6B7280')
              .attr('stroke-width', 0.5);
          }, 4000);
          // Zoom to the node
          if (window._treeLayout.svg) {
            const transform = treeNode.attr('transform');
            if (transform) {
              const match = transform.match(/translate\(([^,]+),([^)]+)\)/);
              if (match) {
                const [, x, y] = match.map(Number);
                const { width, height } = window._treeLayout.container.getBoundingClientRect();
                window._treeLayout.svg.transition().duration(500).call(
                  window._treeLayout.zoom.transform,
                  d3.zoomIdentity.translate(width/2 - x*2, height/2 - y*2).scale(2)
                );
              }
            }
          }
        }
      } else if (window._arivuGraph) {
        // Highlight in force graph view
        const nodeData = window._arivuGraph.allNodes?.find(n => n.id === paperId);
        if (nodeData) {
          window._arivuGraph.highlightNode(nodeData, { pulse: true });
          setTimeout(() => window._arivuGraph.removeHighlight(nodeData), 4000);
        }
      }
    });

    // Update header (v1 compat)
    const headerInfo = document.getElementById('header-paper-info');
    if (headerInfo && graphData.metadata) {
      headerInfo.textContent = graphData.metadata.seed_paper_title || '';
    }

    // Update paper info row (v2 redesign)
    const seedNode = graphData.nodes?.find(n => n.is_seed);
    const titleEl = document.getElementById('paper-title-text');
    const authorEl = document.getElementById('paper-author-text');
    if (titleEl && graphData.metadata) {
      const year = seedNode?.year || '';
      titleEl.textContent = `${graphData.metadata.seed_paper_title || 'Unknown Paper'}${year ? ` (${year})` : ''}`;
    }
    if (authorEl && seedNode) {
      const authors = (seedNode.authors || []).slice(0, 3).join(', ');
      const suffix = (seedNode.authors || []).length > 3 ? ' et al.' : '';
      const citations = (seedNode.citation_count || 0).toLocaleString();
      authorEl.textContent = `${authors}${suffix} \u00B7 ${citations} citations`;
    }

    // Update bottom bar summary with real data
    const summaryEl = document.getElementById('bottom-bar-summary');
    if (summaryEl) {
      const nodeCount = graphData.nodes?.length || 0;
      summaryEl.textContent = `Orphan Ideas \u00B7 Data Coverage \u00B7 ${nodeCount} papers`;
    }

    // Populate panels — DNA and diversity may be missing on fresh builds
    // (computed after the SSE 'done' event in _on_graph_complete).
    // If missing, poll for them after a delay.
    if (graphData.dna_profile) {
      this._panel.renderDNAProfile(graphData.dna_profile);
    }
    if (graphData.diversity_score) {
      this._panel.renderDiversityScore(graphData.diversity_score);
    }
    if (graphData.leaderboard) this._panel.populateLeaderboard(graphData.leaderboard);

    if (!graphData.dna_profile || !graphData.diversity_score || !graphData.leaderboard) {
      // Fresh build: DNA/diversity computed post-SSE. Poll the panel data endpoint.
      const graphId = graphData.metadata?.graph_id;
      if (graphId) {
        const pollPanelData = (attempt) => {
          if (attempt > 5) return; // give up after 5 tries
          setTimeout(() => {
            fetch(`/api/graph/${encodeURIComponent(graphId)}/panel-data`)
              .then(r => r.ok ? r.json() : null)
              .then(data => {
                if (!data) { pollPanelData(attempt + 1); return; }
                if (data.dna_profile && !graphData.dna_profile) {
                  graphData.dna_profile = data.dna_profile;
                  this._panel.renderDNAProfile(data.dna_profile);
                }
                if (data.diversity_score && !graphData.diversity_score) {
                  graphData.diversity_score = data.diversity_score;
                  this._panel.renderDiversityScore(data.diversity_score);
                }
                if (data.leaderboard && !graphData.leaderboard) {
                  graphData.leaderboard = data.leaderboard;
                  this._panel.populateLeaderboard(data.leaderboard);
                }
              })
              .catch(() => pollPanelData(attempt + 1));
          }, 3000 * attempt); // 3s, 6s, 9s, 12s, 15s
        };
        pollPanelData(1);
      }
    }

    // Load orphans
    fetch(`/api/orphans/${encodeURIComponent(this.paperId)}`)
      .then(r => r.json())
      .then(data => this._panel.populateOrphans(data.orphans));

    // Load data coverage
    fetch(`/api/coverage-report/${encodeURIComponent(this.paperId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) this._renderCoverage(data); })
      .catch(() => {});

    // Leaderboard toggle — only bind if v1 layout (sidebar-rail absent)
    // In v2, sidebar.js handles opening the leaderboard slide-out panel.
    if (!document.querySelector('.sidebar-rail')) {
      document.getElementById('leaderboard-toggle')?.addEventListener('click', () => {
        const sidebar = document.getElementById('leaderboard-sidebar');
        const isOpen = sidebar.classList.toggle('open');
        sidebar.setAttribute('aria-hidden', String(!isOpen));
      });
    }

    // Genealogy button — only bind if v1 layout (sidebar.js handles it in v2)
    if (!document.querySelector('.sidebar-rail')) {
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
    }

    // Chat guide
    this._initChat(graphData.metadata || {});

    // Accessibility table view — only bind if v1 layout (sidebar.js handles it in v2)
    if (!document.querySelector('.sidebar-rail')) {
      document.getElementById('accessibility-toggle')?.addEventListener('click', () => {
        const tv = document.getElementById('table-view');
        tv.hidden = !tv.hidden;
        if (!tv.hidden) this._populateTableView(graphData);
      });
    }
    // Store graphData for sidebar.js table-view access
    this._graphData = graphData;

    // Notify deep intelligence module that graph data is ready
    window.dispatchEvent(new CustomEvent('arivu:graph-ready', { detail: { graphData } }));

    // Phase C #012: Restore annotations from sessionStorage
    // Use a retry loop to handle cases where nodeElements aren't ready yet
    const _restoreAnn = (attempt) => {
      const graph = window._arivuGraph;
      if (!graph || !graph.nodeElements) {
        if (attempt < 10) setTimeout(() => _restoreAnn(attempt + 1), 500);
        return;
      }
      const graphId = graphData?.metadata?.graph_id || graph.metadata?.graph_id || 'default';
      try {
        const annotations = JSON.parse(sessionStorage.getItem(`athena_annotations_${graphId}`) || '{}');
        const count = Object.keys(annotations).length;
        console.log(`[Annotations] Restore attempt ${attempt}: graphId=${graphId}, count=${count}, hasNodes=${!!graph.nodeElements}`);
        if (!count) return;
        for (const [paperId, ann] of Object.entries(annotations)) {
          // Direct D3 annotation — bypass the addAnnotation method in case it's stale
          const label = ann.label || 'noted';
          const truncLabel = label.length > 20 ? label.substring(0, 18) + '..' : label;
          graph.nodeElements
            .filter(d => d.id === paperId)
            .each(function() {
              // Remove existing
              d3.select(this).selectAll('.annotation-badge').remove();
              const badge = d3.select(this).append('g')
                .attr('class', 'annotation-badge')
                .attr('data-annotation-id', paperId)
                .style('pointer-events', 'none');
              const rectW = truncLabel.length * 6.5 + 24;
              const rectH = 18;
              const borderColor = ann.color === 'teal' ? '#06B6D4' : '#D4A843';
              badge.append('rect')
                .attr('x', -rectW / 2).attr('y', -rectH - 16)
                .attr('width', rectW).attr('height', rectH)
                .attr('rx', 4).attr('fill', '#0D1117')
                .attr('stroke', borderColor).attr('stroke-width', 1.5).attr('opacity', 0.95);
              badge.append('polygon')
                .attr('points', '-4,-16 4,-16 0,-11')
                .attr('fill', '#0D1117').attr('stroke', borderColor).attr('stroke-width', 0.5);
              badge.append('text')
                .attr('x', 0).attr('y', -rectH / 2 - 16 + 5)
                .attr('text-anchor', 'middle')
                .attr('font-size', '10px')
                .attr('font-family', "'Array', 'JetBrains Mono', monospace")
                .attr('font-weight', '700').attr('fill', '#fff')
                .text(truncLabel);
              console.log(`[Annotations] Restored badge on: ${paperId.substring(0,12)}...`);
            });
        }
        // Tree layout
        if (window._treeLayout?.addAnnotation) {
          for (const [paperId, ann] of Object.entries(annotations)) {
            window._treeLayout.addAnnotation(paperId, ann.label, ann.color);
          }
        }
      } catch (e) {
        console.warn('[Annotations] Restore failed:', e);
      }
    };
    setTimeout(() => _restoreAnn(0), 2000);

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

    // Background pregeneration of intel content for Blind Spots & Battles.
    // For existing cached graphs that don't have intel_json yet, this silently
    // generates all LLM content in the background so windows open instantly.
    // For new graphs, _on_graph_complete() handles pregeneration server-side.
    if (graphData.metadata?.graph_id && window.BlindspotAnalyzer) {
      setTimeout(() => {
        try {
          const gid = graphData.metadata.graph_id;
          // Check if intel already exists
          fetch(`/api/graph/${encodeURIComponent(gid)}/panel-data`)
            .then(r => r.ok ? r.json() : null)
            .then(panelData => {
              // If intel_json is already populated, skip
              // We can't check intel_json directly from panel-data, so just
              // try the pregenerate endpoint — it will bail if already cached
              const analyzer = new BlindspotAnalyzer(graphData);
              const result = analyzer.analyze();
              window._blindspotResult = result;

              // Fire pregeneration in background (non-blocking)
              fetch(`/api/graph/${encodeURIComponent(gid)}/intel-pregenerate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  stats: result.stats,
                  disputes: result.disputes.slice(0, 5).map(d => ({
                    paperA: d.paperA,
                    paperB: d.paperB,
                    isResolved: d.isResolved,
                    winner: d.winner,
                  })),
                  blindSpots: result.blindSpots.slice(0, 5).map(s => ({
                    name: s.name,
                    paperCount: s.paperCount,
                    edgeCount: s.edgeCount,
                    coverage: s.coverage,
                    status: s.status,
                    topPapers: s.topPapers,
                  })),
                }),
              }).catch(() => {}); // Silently ignore errors
            })
            .catch(() => {});
        } catch (e) {
          // Non-fatal — intel will be lazy-generated on window open
        }
      }, 5000); // Wait 5 seconds after graph load to not compete with initial rendering
    }

    // Auto-switch to tree layout if the v2 redesign sets tree as default view.
    // The ArivuGraph force layout renders first; we hide it and show tree.
    if (document.querySelector('.tool-layout-v2') && window._arivuGraph) {
      setTimeout(() => {
        const container = document.getElementById('graph-svg-container');
        if (!container) return;
        // Create tree layout
        if (!window._treeLayout && typeof TreeLayout !== 'undefined') {
          window._treeLayout = new TreeLayout(container, {
            nodes: window._arivuGraph.allNodes,
            edges: window._arivuGraph.allEdges,
            metadata: window._arivuGraph.metadata
          });
          // Phase C #012: Restore annotations on tree layout after creation
          if (window._treeLayout?.addAnnotation) {
            const graphId = window._arivuGraph?.metadata?.graph_id || 'default';
            try {
              const annotations = JSON.parse(sessionStorage.getItem(`athena_annotations_${graphId}`) || '{}');
              for (const [paperId, ann] of Object.entries(annotations)) {
                window._treeLayout.addAnnotation(paperId, ann.label, ann.color);
              }
            } catch (e) {}
          }
        }
        // Hide force-directed SVG, show tree
        const forceSvg = container.querySelector('svg:not(.tree-svg)');
        if (forceSvg) forceSvg.style.display = 'none';
      }, 2600); // After the force simulation's initial zoom-to-fit (2500ms)
    }

    // Dispatch graph-loaded event for Pathfinder and other systems
    window.dispatchEvent(new CustomEvent('arivu:graph-loaded', {
      detail: { graphData: graphData }
    }));

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

    // Pathfinder suggestion detection keywords
    const PF_KEYWORDS = [
      'where do i fit', 'my research is about', 'i am working on',
      'my position', 'find my place', 'how does my work relate',
      'i want to build a paper', 'my paper is about',
      'i want to use pathfinder', 'open pathfinder', 'pathfinder'
    ];
    const ACADEMIC_KW = ['abstract', 'propose', 'methodology', 'experimental', 'approach', 'evaluate', 'demonstrate', 'framework'];

    const sendMessage = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      send.disabled = true;

      const userMsgDiv = document.createElement('div');
      userMsgDiv.style.cssText = 'text-align:right;margin-bottom:6px;font-size:0.85rem;color:var(--text-primary)';
      userMsgDiv.textContent = text;
      messages.appendChild(userMsgDiv);
      messages.scrollTop = messages.scrollHeight;

      // Check for Pathfinder-worthy prompts BEFORE sending to chat
      const textLower = text.toLowerCase();
      const isPositionQuery = PF_KEYWORDS.some(kw => textLower.includes(kw));
      const wordCount = text.split(/\s+/).length;
      const academicMatches = ACADEMIC_KW.filter(kw => textLower.includes(kw)).length;
      const isAbstract = wordCount > 100 && academicMatches >= 2;

      if (isPositionQuery || isAbstract) {
        const replyDiv = document.createElement('div');
        replyDiv.style.cssText = 'margin-bottom:8px;font-size:0.85rem;color:var(--text-secondary)';
        replyDiv.innerHTML = (isAbstract
          ? 'That looks like an abstract! The Pathfinder can run a full analysis with competitive landscape, reading roadmap, and citation recommendations.'
          : 'This sounds like a research positioning question. The Pathfinder can give you a detailed analysis.'
        ) + '<br><button class="pf-chat-suggest" style="margin-top:8px;padding:6px 14px;background:#374151;color:white;border:none;border-radius:4px;font:600 11px \'JetBrains Mono\',monospace;cursor:pointer;">Take me to Pathfinder →</button>';
        messages.appendChild(replyDiv);
        messages.scrollTop = messages.scrollHeight;

        replyDiv.querySelector('.pf-chat-suggest')?.addEventListener('click', () => {
          // Switch to researcher dot
          window._dotSwitcher?.switchTo('dna', 3);
          // Open pathfinder window after dot switch
          setTimeout(() => {
            window._windowManager?.openWindow('pathfinder');
            // Pre-fill input
            setTimeout(() => {
              const pfInput = document.getElementById('pf-input-initial') || document.getElementById('pf-input');
              if (pfInput) { pfInput.value = text; pfInput.focus(); }
            }, 500);
          }, 300);
        });

        send.disabled = false;
        return; // Don't send to chat backend
      }

      try {
        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ message: text, graph_summary: graphSummary, current_view: { type: 'overview' } })
        });
        const data = await resp.json();
        const reply = data.response || 'No response.';
        const replyDiv = document.createElement('div');
        replyDiv.style.cssText = 'margin-bottom:8px;font-size:0.85rem;color:var(--text-secondary)';

        // Check for Pathfinder suggestion from backend
        if (data.pathfinder_suggestion) {
          replyDiv.innerHTML = reply.replace('[PATHFINDER_SUGGESTION]',
            '<br><button class="pf-chat-suggest" style="margin-top:8px;padding:6px 14px;background:#374151;color:white;border:none;border-radius:4px;font:600 11px \'JetBrains Mono\',monospace;cursor:pointer;">Take me to Pathfinder →</button>'
          );
        } else {
          replyDiv.textContent = reply;
        }
        messages.appendChild(replyDiv);

        // Wire Pathfinder suggestion button if present
        const pfBtn = replyDiv.querySelector('.pf-chat-suggest');
        if (pfBtn) {
          pfBtn.addEventListener('click', () => {
            if (window._dotSwitcher) window._dotSwitcher.switchTo('dna', 3);
            if (window._windowManager) window._windowManager.openWindow('pathfinder');
          });
        }
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
          <td><a href="${n.url || (n.doi ? 'https://doi.org/' + encodeURIComponent(n.doi) : '') || (n.id ? 'https://www.semanticscholar.org/paper/' + n.id : '#')}" target="_blank" rel="noopener">${n.title||'Unknown'}</a></td>
          <td>${(n.authors||[]).slice(0,2).join(', ')}</td>
          <td>${(n.citation_count||0).toLocaleString()}</td>
          <td>${n.year||'?'}</td>
          <td>${(n.fields_of_study||[])[0]||'?'}</td>
          <td>${Number.isFinite(n.pruning_impact) ? n.pruning_impact + ' papers' : '—'}</td>
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
    if (!overlay) return;
    const inner = document.createElement('div');
    inner.className = 'loading-inner';
    const p = document.createElement('p');
    p.style.color = 'var(--danger)';
    p.textContent = msg;
    const a = document.createElement('a');
    a.href = '/';
    a.style.color = 'var(--accent-blue)';
    a.textContent = '\u2190 Back to search';
    inner.appendChild(p);
    inner.appendChild(a);
    overlay.innerHTML = '';
    overlay.appendChild(inner);
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
    const loader = new GraphLoader(cfg.paperId);
    window._graphLoader = loader;
    fetch(`/static/previews/${cfg.paperId}/graph.json`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(g => loader._initGraph(g))
      .catch(() => {
        // Precomputed graph not available — fall back to SSE build with real S2 ID
        const realId = GALLERY_S2_IDS[cfg.paperId];
        if (realId) {
          const fallbackLoader = new GraphLoader(realId);
          window._graphLoader = fallbackLoader;
          fallbackLoader.start();
        } else {
          // Unknown slug — show error instead of hanging
          const overlay = document.getElementById('loading-overlay');
          if (overlay) overlay.innerHTML = '<div class="loading-inner"><p style="color:var(--danger)">This gallery paper has not been precomputed yet. Building graph from scratch...</p></div>';
          const fallbackLoader = new GraphLoader(cfg.paperId);
          window._graphLoader = fallbackLoader;
          fallbackLoader.start();
        }
      });
  } else {
    const loader = new GraphLoader(cfg.paperId);
    window._graphLoader = loader;
    loader.start();
  }
});
