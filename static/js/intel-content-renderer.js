/**
 * static/js/intel-content-renderer.js
 * Shared Content Block Renderer for all intelligence windows.
 *
 * Renders structured JSON content blocks into interactive HTML.
 * Used by: Architects, Idea Flow, Momentum, Blind Spots & Battles.
 *
 * Block types:
 *   prose          — styled paragraph text with [paper names] clickable
 *   section_header — styled section divider (THE CASE, THE EVIDENCE, etc.)
 *   evidence_cards — side-by-side FOR/AGAINST comparison boxes
 *   verdict        — bold conclusion sentence
 *   takeaway       — highlighted gold box with key insight
 *   opportunity    — yellow/gold actionable insight box
 *   paper_chain    — clickable breadcrumb trail of papers
 *   evidence_trail — expandable list of papers backing a claim
 *   show_me        — inline button that triggers a graph action
 *   confidence     — inline dot bar rating
 *   venn           — dot matrix Venn diagram of shared references
 *   timeline       — temporal overlap visualization
 *   connect_dots   — hypothetical connection analysis
 */

const IntelContentRenderer = {

  /**
   * Render an array of content blocks into interactive HTML.
   * @param {Array} blocks - Array of {type: string, ...data} objects
   * @param {Object} opts - {graphData, onPaperClick, onTraceClick}
   * @returns {string} HTML string
   */
  render(blocks, opts = {}) {
    if (!blocks || !Array.isArray(blocks)) return '';
    return blocks.map(block => this._renderBlock(block, opts)).join('');
  },

  /**
   * After inserting rendered HTML into the DOM, call this to wire up
   * all interactive elements (paper clicks, expand, show me, etc.)
   */
  wireInteractions(container, opts = {}) {
    if (!container) return;

    // 1. Paper name clicks — [Paper Name] in text
    container.querySelectorAll('.icr-paper-link').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const paperId = el.dataset.paperId;
        if (paperId) _zoomToNode(paperId);
      });
    });

    // 2. Trace connection links
    container.querySelectorAll('.icr-trace-link').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const fromId = el.dataset.fromId;
        const toId = el.dataset.toId;
        if (fromId && toId) this._traceConnection(fromId, toId);
      });
    });

    // 3. Evidence trail expanders
    container.querySelectorAll('.icr-trail-toggle').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const trail = el.closest('.icr-evidence-trail');
        const list = trail?.querySelector('.icr-trail-list');
        if (list) {
          const isOpen = list.style.display !== 'none';
          list.style.display = isOpen ? 'none' : 'block';
          el.textContent = isOpen ? el.textContent.replace('▴', '▾') : el.textContent.replace('▾', '▴');
        }
      });
    });

    // 4. "Highlight all N" buttons in expanded trails
    container.querySelectorAll('.icr-highlight-all').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const ids = JSON.parse(el.dataset.paperIds || '[]');
        this._highlightMultiple(ids);
      });
    });

    // 5. Show me buttons
    container.querySelectorAll('.icr-show-me').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const action = el.dataset.action;
        const paperId = el.dataset.paperId;
        const paperIds = el.dataset.paperIds ? JSON.parse(el.dataset.paperIds) : [];

        if (action === 'zoom' && paperId) {
          _zoomToNode(paperId);
        } else if (action === 'highlight' && paperIds.length) {
          this._highlightMultiple(paperIds);
        } else if (action === 'collapse' && paperId) {
          this._triggerCollapse(paperId);
        } else if (action === 'simulate' && el.dataset.fromId && el.dataset.toId) {
          this._simulateConnection(el.dataset.fromId, el.dataset.toId);
        }
      });
    });

    // 6. Discuss buttons
    container.querySelectorAll('.icr-discuss-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const context = el.dataset.context || '';
        this._openDiscuss(context);
      });
    });

    // 7. Show both in graph
    container.querySelectorAll('.icr-show-both').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const idA = el.dataset.idA;
        const idB = el.dataset.idB;
        if (idA && idB) this._highlightPair(idA, idB);
      });
    });
  },

  // ─── Block Renderers ───────────────────────────────────────────────────

  _renderBlock(block, opts) {
    switch (block.type) {
      case 'prose': return this._renderProse(block, opts);
      case 'section_header': return this._renderSectionHeader(block);
      case 'evidence_cards': return this._renderEvidenceCards(block);
      case 'verdict': return this._renderVerdict(block);
      case 'takeaway': return this._renderTakeaway(block);
      case 'opportunity': return this._renderOpportunity(block);
      case 'paper_chain': return this._renderPaperChain(block);
      case 'evidence_trail': return this._renderEvidenceTrail(block);
      case 'show_me': return this._renderShowMe(block);
      case 'confidence': return this._renderConfidence(block);
      case 'venn': return this._renderVenn(block);
      case 'timeline': return this._renderTimeline(block);
      case 'connect_dots': return this._renderConnectDots(block);
      default: return '';
    }
  },

  _renderProse(block) {
    const text = this._linkifyPapers(block.content || '');
    return `<div class="icr-prose">${text}</div>`;
  },

  _renderSectionHeader(block) {
    return `<div class="icr-section-header">${this._esc(block.title || '')}</div>`;
  },

  _renderEvidenceCards(block) {
    const cardA = block.cardA || { title: '', points: [] };
    const cardB = block.cardB || { title: '', points: [] };

    const renderPoints = (points) => points.map(p => {
      const text = this._linkifyPapers(typeof p === 'string' ? p : (p.text || ''));
      const showMe = p.showMe ? `<span class="icr-show-me" data-action="${p.showMe.action || 'highlight'}" data-paper-id="${p.showMe.paperId || ''}" data-paper-ids='${JSON.stringify(p.showMe.paperIds || [])}'>[show me →]</span>` : '';
      const collapse = p.collapse ? `<span class="icr-show-me" data-action="collapse" data-paper-id="${p.collapse.paperId || ''}">[see the collapse →]</span>` : '';
      return `<li>${text} ${showMe}${collapse}</li>`;
    }).join('');

    return `
      <div class="icr-evidence-cards">
        <div class="icr-evidence-card icr-card-for">
          <div class="icr-evidence-card-title">${this._esc(cardA.title)}</div>
          <ul>${renderPoints(cardA.points)}</ul>
        </div>
        <div class="icr-evidence-card icr-card-against">
          <div class="icr-evidence-card-title">${this._esc(cardB.title)}</div>
          <ul>${renderPoints(cardB.points)}</ul>
        </div>
      </div>`;
  },

  _renderVerdict(block) {
    const text = this._linkifyPapers(block.content || '');
    return `<div class="icr-verdict">${text}</div>`;
  },

  _renderTakeaway(block) {
    const text = this._linkifyPapers(block.content || '');
    return `<div class="icr-takeaway"><div class="icr-takeaway-label">TAKEAWAY</div>${text}</div>`;
  },

  _renderOpportunity(block) {
    const title = this._esc(block.title || 'Opportunity');
    const text = this._linkifyPapers(block.content || '');
    const papers = (block.papers || []).map(p =>
      `<span class="icr-paper-link" data-paper-id="${p.id || ''}">${this._esc(p.title || p.name || '')}</span>`
    ).join(' + ');
    const trace = block.traceFrom && block.traceTo ?
      `<span class="icr-trace-link" data-from-id="${block.traceFrom}" data-to-id="${block.traceTo}">[Trace connection →]</span>` : '';

    return `
      <div class="icr-opportunity">
        <div class="icr-opportunity-title">💡 ${title}</div>
        <div class="icr-opportunity-text">${text}</div>
        ${papers ? `<div class="icr-opportunity-papers">${papers}</div>` : ''}
        ${trace}
      </div>`;
  },

  _renderPaperChain(block) {
    const papers = block.papers || [];
    const chain = papers.map(p =>
      `<span class="icr-paper-link icr-chain-node" data-paper-id="${p.id || ''}">${this._esc(p.title || '')}</span>`
    ).join('<span class="icr-chain-arrow"> → </span>');
    const traceAll = papers.length >= 2 ?
      `<span class="icr-trace-link" data-from-id="${papers[0]?.id}" data-to-id="${papers[papers.length-1]?.id}">[Trace this path in graph →]</span>` : '';
    return `<div class="icr-paper-chain">${chain} ${traceAll}</div>`;
  },

  _renderEvidenceTrail(block) {
    const count = block.count || block.papers?.length || 0;
    const label = this._linkifyPapers(block.label || `${count} papers`);
    const papers = block.papers || [];
    const paperListHTML = papers.map(p =>
      `<li><span class="icr-paper-link" data-paper-id="${p.id || ''}">${this._esc(p.title || '')}</span> ${p.year ? `(${p.year})` : ''} ${p.mutation ? `<span class="icr-trail-mutation">— ${p.mutation}</span>` : ''}</li>`
    ).join('');
    const ids = JSON.stringify(papers.map(p => p.id).filter(Boolean));

    return `
      <div class="icr-evidence-trail">
        <span class="icr-trail-toggle">${label} [show ${count} ▾]</span>
        <div class="icr-trail-list" style="display:none;">
          <ul>${paperListHTML}</ul>
          <span class="icr-highlight-all" data-paper-ids='${ids}'>[Highlight all ${count} in graph →]</span>
        </div>
      </div>`;
  },

  _renderShowMe(block) {
    const label = block.label || '[show me →]';
    return `<span class="icr-show-me" data-action="${block.action || 'highlight'}" data-paper-id="${block.paperId || ''}" data-paper-ids='${JSON.stringify(block.paperIds || [])}' data-from-id="${block.fromId || ''}" data-to-id="${block.toId || ''}">${label}</span>`;
  },

  _renderConfidence(block) {
    const score = Math.max(0, Math.min(10, Math.round((block.score || 0) * 10)));
    const filled = '●'.repeat(score);
    const empty = '○'.repeat(10 - score);
    const label = block.label || (score >= 8 ? 'HIGH' : score >= 5 ? 'MODERATE' : 'LOW');
    return `<span class="icr-confidence">${filled}${empty} <span class="icr-confidence-label">${label}</span></span>`;
  },

  _renderVenn(block) {
    const sharedCount = block.shared?.length || 0;
    const onlyA = block.onlyA || 0;
    const onlyB = block.onlyB || 0;
    const sharedPapers = (block.shared || []).map(p =>
      `<span class="icr-paper-link" data-paper-id="${p.id || ''}">${this._esc(p.title || p.name || '')}</span>`
    ).join(' · ');
    const showAncestry = block.shared?.length ?
      `<span class="icr-show-me" data-action="highlight" data-paper-ids='${JSON.stringify(block.shared.map(p => p.id).filter(Boolean))}'>[Show shared ancestry in graph →]</span>` : '';

    // Simple text-based Venn (the SVG version would be more visual but this is functional)
    return `
      <div class="icr-venn">
        <div class="icr-venn-title">SHARED DNA</div>
        <div class="icr-venn-diagram">
          <div class="icr-venn-circle icr-venn-a">
            <div class="icr-venn-count">${onlyA} only</div>
          </div>
          <div class="icr-venn-overlap">
            <div class="icr-venn-count">${sharedCount} shared</div>
          </div>
          <div class="icr-venn-circle icr-venn-b">
            <div class="icr-venn-count">${onlyB} only</div>
          </div>
        </div>
        <div class="icr-venn-shared">${sharedCount} shared: ${sharedPapers}</div>
        ${showAncestry}
      </div>`;
  },

  _renderTimeline(block) {
    const paperA = block.paperA || {};
    const paperB = block.paperB || {};
    const yearA = paperA.year || 0;
    const yearB = paperB.year || 0;
    const minYear = Math.min(yearA, yearB) - 1;
    const maxYear = Math.max(yearA, yearB) + 1;
    const nameA = this._esc((paperA.title || '').substring(0, 25));
    const nameB = this._esc((paperB.title || '').substring(0, 25));

    return `
      <div class="icr-timeline">
        <div class="icr-timeline-title">TIMELINE</div>
        <div class="icr-timeline-track">
          <div class="icr-timeline-axis">
            <span>${minYear}</span>
            <span>${yearA}</span>
            <span>${yearB}</span>
            <span>${maxYear}</span>
          </div>
          <div class="icr-timeline-bar icr-timeline-bar-a" style="left:${((yearA - minYear) / (maxYear - minYear)) * 100}%;width:${Math.max(15, ((1) / (maxYear - minYear)) * 100)}%;">
            ${nameA}
          </div>
          <div class="icr-timeline-bar icr-timeline-bar-b" style="left:${((yearB - minYear) / (maxYear - minYear)) * 100}%;width:${Math.max(15, ((1) / (maxYear - minYear)) * 100)}%;">
            ${nameB}
          </div>
          <div class="icr-timeline-overlap" style="left:${((Math.max(yearA, yearB) - minYear - 0.5) / (maxYear - minYear)) * 100}%;width:${Math.max(5, ((Math.abs(yearA - yearB) <= 1 ? 1.5 : 0.5) / (maxYear - minYear)) * 100)}%;">
            overlap
          </div>
        </div>
      </div>`;
  },

  _renderConnectDots(block) {
    const items = (block.impacts || []).map(i =>
      `<li>${this._linkifyPapers(typeof i === 'string' ? i : i.text || '')}</li>`
    ).join('');
    const impact = block.impactScore || 0;
    const impactLabel = impact >= 0.7 ? 'HIGH' : impact >= 0.4 ? 'MODERATE' : 'LOW';
    const filledDots = Math.round(impact * 10);
    const simulate = block.fromId && block.toId ?
      `<span class="icr-show-me" data-action="simulate" data-from-id="${block.fromId}" data-to-id="${block.toId}">[Simulate this connection in graph →]</span>` : '';

    return `
      <div class="icr-connect-dots">
        <div class="icr-connect-title">CONNECT THE DOTS</div>
        <div class="icr-connect-content">
          <div class="icr-connect-text">If these papers were connected:</div>
          <ul>${items}</ul>
          <div class="icr-connect-impact">
            Impact: ${'●'.repeat(filledDots)}${'○'.repeat(10 - filledDots)} ${impactLabel}
          </div>
          ${simulate}
        </div>
      </div>`;
  },

  // ─── Utility Functions ─────────────────────────────────────────────────

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  },

  /**
   * Convert [Paper Name] in text to clickable paper links.
   * Searches graph data to find matching paper IDs.
   */
  _linkifyPapers(text) {
    if (!text) return '';
    const nodes = window._graphLoader?._graphData?.nodes || [];

    // Replace [Paper Title] patterns with clickable links
    return text.replace(/\[([^\]]+)\]/g, (match, paperName) => {
      // Try to find the paper in graph data
      const normalizedName = paperName.toLowerCase().trim();
      const node = nodes.find(n => {
        const title = (n.title || '').toLowerCase();
        return title === normalizedName ||
               title.startsWith(normalizedName) ||
               normalizedName.startsWith(title.substring(0, 20));
      });

      if (node) {
        return `<span class="icr-paper-link" data-paper-id="${node.id}" title="${this._esc(node.title)}">${this._esc(paperName)}</span>`;
      }
      // If no match found, still style it but without click functionality
      return `<span class="icr-paper-mention">${this._esc(paperName)}</span>`;
    });
  },

  // ─── Graph Interaction Functions ───────────────────────────────────────

  _traceConnection(fromId, toId) {
    // BFS from fromId to toId in the graph
    const graphData = window._graphLoader?._graphData;
    if (!graphData) return;

    const adjOut = new Map();
    const adjIn = new Map();
    graphData.edges.forEach(e => {
      const s = typeof e.source === 'object' ? e.source.id : e.source;
      const t = typeof e.target === 'object' ? e.target.id : e.target;
      if (!adjOut.has(s)) adjOut.set(s, []);
      if (!adjIn.has(t)) adjIn.set(t, []);
      adjOut.get(s).push(t);
      adjIn.get(t).push(s);
    });

    // BFS in both directions to find shortest path
    const path = this._bfsPath(fromId, toId, adjOut) || this._bfsPath(fromId, toId, adjIn) || this._bfsPath(toId, fromId, adjOut) || this._bfsPath(toId, fromId, adjIn);

    if (path && path.length >= 2) {
      this._highlightMultiple(path);
    } else {
      // Highlight just the two nodes
      this._highlightPair(fromId, toId);
    }
  },

  _bfsPath(startId, endId, adj) {
    const visited = new Set([startId]);
    const queue = [[startId, [startId]]];

    while (queue.length > 0) {
      const [current, path] = queue.shift();
      if (current === endId) return path;

      const neighbors = adj.get(current) || [];
      for (const next of neighbors) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push([next, [...path, next]]);
        }
      }
    }
    return null;
  },

  _highlightMultiple(ids) {
    if (!ids?.length) return;
    const idSet = new Set(ids);

    const modeLabel = document.getElementById('mode-label');
    const isTree = modeLabel?.textContent?.toLowerCase()?.includes('tree');

    if (isTree && window._treeLayout?.svg) {
      const svg = window._treeLayout.svg;
      svg.selectAll('.tree-node').style('opacity', d => idSet.has(d.data?.id) ? 1 : 0.08);
      svg.selectAll('path.tree-link, line.cross-edge').style('opacity', 0.03);
      setTimeout(() => {
        svg.selectAll('.tree-node').style('opacity', null);
        svg.selectAll('path.tree-link, line.cross-edge').style('opacity', null);
      }, 4000);
    } else if (window._arivuGraph?.svg) {
      const g = window._arivuGraph;
      g.svg.selectAll('.node-group').style('opacity', function() {
        const nodeId = this.getAttribute('data-id');
        return idSet.has(nodeId) ? 1 : 0.08;
      });
      g.svg.selectAll('line, .edge-line, .edge-path').style('opacity', 0.03);
      setTimeout(() => {
        g.svg.selectAll('.node-group').style('opacity', null);
        g.svg.selectAll('line, .edge-line, .edge-path').style('opacity', null);
      }, 4000);
    }
  },

  _highlightPair(idA, idB) {
    this._highlightMultiple([idA, idB]);
  },

  _triggerCollapse(paperId) {
    // Trigger the pruning animation on a specific paper
    if (window._arivuGraph) {
      window._arivuGraph.selectedNodes?.clear();
      window._arivuGraph.selectedNodes?.add(paperId);
      // Dispatch prune event
      document.getElementById('prune-execute-btn')?.click();
    }
  },

  _simulateConnection(fromId, toId) {
    // Temporarily draw a dashed line between two papers
    const modeLabel = document.getElementById('mode-label');
    const isTree = modeLabel?.textContent?.toLowerCase()?.includes('tree');

    if (isTree && window._treeLayout?.svg) {
      const svg = window._treeLayout.svg;
      let fromNode = null, toNode = null;
      window._treeLayout.treeRoot?.each(d => {
        if (d.data?.id === fromId) fromNode = d;
        if (d.data?.id === toId) toNode = d;
      });
      if (fromNode && toNode) {
        const angleA = fromNode.x - Math.PI / 2;
        const angleB = toNode.x - Math.PI / 2;
        const xA = fromNode.y * Math.cos(angleA);
        const yA = fromNode.y * Math.sin(angleA);
        const xB = toNode.y * Math.cos(angleB);
        const yB = toNode.y * Math.sin(angleB);

        const line = svg.select('g').append('line')
          .attr('x1', xA).attr('y1', yA)
          .attr('x2', xB).attr('y2', yB)
          .attr('stroke', '#D4A843')
          .attr('stroke-width', 2)
          .attr('stroke-dasharray', '6,4')
          .attr('opacity', 0.8)
          .attr('class', 'icr-simulated-edge');

        setTimeout(() => line.remove(), 4000);
      }
    } else if (window._arivuGraph?.svg) {
      const g = window._arivuGraph;
      const simNodes = g.simulation?.nodes() || [];
      const nodeA = simNodes.find(n => n.id === fromId);
      const nodeB = simNodes.find(n => n.id === toId);
      if (nodeA && nodeB) {
        const line = g.svg.select('g').append('line')
          .attr('x1', nodeA.x).attr('y1', nodeA.y)
          .attr('x2', nodeB.x).attr('y2', nodeB.y)
          .attr('stroke', '#D4A843')
          .attr('stroke-width', 2)
          .attr('stroke-dasharray', '6,4')
          .attr('opacity', 0.8)
          .attr('class', 'icr-simulated-edge');

        setTimeout(() => line.remove(), 4000);
      }
    }

    // Also highlight both nodes
    this._highlightPair(fromId, toId);
  },

  _openDiscuss(context) {
    // Open the chat panel — try multiple approaches
    // 1. Click the sidebar button (triggers event delegation on .sidebar-rail)
    const chatBtn = document.querySelector('.sidebar-btn[data-panel="panel-chat"]');
    if (chatBtn) {
      chatBtn.click();
    } else {
      // 2. Directly open the panel if button not found
      const panel = document.getElementById('panel-chat');
      const backdrop = document.getElementById('panel-backdrop');
      if (panel) {
        panel.classList.add('open');
        panel.setAttribute('aria-hidden', 'false');
        if (backdrop) backdrop.classList.add('visible');
      }
    }

    // Fill in the context message after panel opens
    setTimeout(() => {
      const chatInput = document.getElementById('chat-input');
      if (chatInput && context) {
        chatInput.value = context;
        chatInput.focus();
      }
    }, 500);
  },
};

// Make globally available
window.IntelContentRenderer = IntelContentRenderer;
