/**
 * static/js/ai-content.js
 * ArivuAI — Frontend renderer for AI interpretations.
 * Handles: fetching interpretations from backend, rendering finding cards,
 * confidence bars, comparison bars, micro-visualizations, text selection + discuss.
 */

class ArivuAI {
  constructor() {
    this._cache = new Map(); // key -> rendered HTML
    this._initTextSelection();
    this._initInteractive();
  }

  /**
   * Load and render an AI interpretation into a container.
   * @param {string} containerType - 'graph', 'dna', 'diversity', 'orphans', 'coverage'
   * @param {string} level - 'short' or 'detailed'
   * @param {HTMLElement} targetEl - DOM element to populate
   */
  async loadInterpretation(containerType, level, targetEl) {
    if (!targetEl) return;

    const cacheKey = `${containerType}:${level}`;
    if (this._cache.has(cacheKey)) {
      targetEl.innerHTML = this._cache.get(cacheKey);
      return;
    }

    // Show loading skeleton
    targetEl.innerHTML = this._loadingSkeleton();

    try {
      const graphId = this._getGraphId();
      if (!graphId) {
        targetEl.innerHTML = this._renderFallback(containerType, level);
        return;
      }

      // 15-second timeout to prevent "Analysis loading" forever
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(`/api/graph/${encodeURIComponent(graphId)}/interpret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ container: containerType, level }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        // API not available — use client-side fallback
        const html = this._renderFallback(containerType, level);
        this._cache.set(cacheKey, html);
        targetEl.innerHTML = html;
        return;
      }

      const data = await resp.json();
      const html = this._renderInterpretation(data, containerType, level);
      this._cache.set(cacheKey, html);
      targetEl.innerHTML = html;
    } catch (err) {
      console.warn('AI interpretation fetch failed, using fallback:', err);
      const html = this._renderFallback(containerType, level);
      this._cache.set(cacheKey, html);
      targetEl.innerHTML = html;
    }
  }

  /**
   * Load pruning interpretation.
   */
  async loadPruningInterpretation(pruneResult, targetEl, level = 'short') {
    if (!targetEl) return;

    // If no pruneResult, try to get from last known
    if (!pruneResult) {
      pruneResult = window._lastPruneResult;
    }
    if (!pruneResult) {
      targetEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem">Prune a paper to see the analysis.</p>';
      return;
    }

    // Cache key based on pruned paper IDs
    const paperIds = (pruneResult.pruned_ids || []).sort().join(',');
    const cacheKey = `prune:${paperIds}:${level}`;
    if (this._cache.has(cacheKey)) {
      targetEl.innerHTML = this._cache.get(cacheKey);
      return;
    }

    targetEl.innerHTML = this._loadingSkeleton();

    try {
      const graphId = this._getGraphId();
      if (!graphId) {
        const html = this._renderPruningFallback(pruneResult, level);
        this._cache.set(cacheKey, html);
        targetEl.innerHTML = html;
        return;
      }
      // 15-second timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(`/api/graph/${encodeURIComponent(graphId)}/prune-interpret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pruned_paper_ids: pruneResult.pruned_ids || [],
          collapse_count: pruneResult.collapsed_count || 0,
          survived_count: pruneResult.survived_count || 0,
          impact_percentage: pruneResult.impact_percentage || 0,
          level
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        const html = this._renderPruningFallback(pruneResult, level);
        this._cache.set(cacheKey, html);
        targetEl.innerHTML = html;
        return;
      }

      const data = await resp.json();
      const html = this._renderPruningInterpretation(data, pruneResult, level);
      this._cache.set(cacheKey, html);
      targetEl.innerHTML = html;
    } catch (err) {
      const html = this._renderPruningFallback(pruneResult, level);
      this._cache.set(cacheKey, html);
      targetEl.innerHTML = html;
    }
  }

  // ═══════ RENDERING ═══════

  _renderInterpretation(data, containerType, level) {
    const findings = data.findings || [];
    if (!findings.length) return this._renderFallback(containerType, level);

    let html = '';

    if (level === 'detailed') {
      // "If you read nothing else" box
      if (data.key_takeaway) {
        html += `<div class="ai-highlight-box">${this._esc(data.key_takeaway)}</div>`;
      }
    }

    // Finding cards
    for (const finding of findings) {
      html += this._renderFinding(finding, level);
    }

    // Micro-visualizations (detailed only)
    if (level === 'detailed' && data.temporal_distribution) {
      html += this._renderMicroViz(data.temporal_distribution);
    }

    // Disagreement map (detailed only)
    if (level === 'detailed' && data.contradictions && data.contradictions.length) {
      html += this._renderDisagreementMap(data.contradictions);
    }

    // Unseen connections (detailed only)
    if (level === 'detailed' && data.unseen_connections && data.unseen_connections.length) {
      html += this._renderUnseenConnections(data.unseen_connections);
    }

    // Research opportunities (detailed only)
    if (level === 'detailed' && data.opportunities && data.opportunities.length) {
      html += this._renderOpportunities(data.opportunities);
    }

    // Nuggets / Things you might not know (LLM may include these)
    const nuggets = data.nuggets || data.things_you_might_not_know || data.insights || [];
    if (level === 'detailed' && nuggets.length > 0) {
      html += '<div class="research-opportunities"><h5>Things You Might Not Know</h5>';
      nuggets.forEach((n, i) => {
        html += `<p style="margin:0 0 6px"><span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:#374151;color:#fff;text-align:center;line-height:20px;font-size:0.7rem;margin-right:6px;">${i + 1}</span>${this._esc(this._toText(n))}</p>`;
      });
      html += '</div>';
    }

    return html;
  }

  _renderFinding(finding, level) {
    const category = this._esc(finding.category || 'FINDING');
    const text = this._toText(finding.text || finding);
    const ref = finding.ref || '';

    // Process text: wrap paper names in clickable chips (#1)
    const processedText = this._wrapPaperChips(text);

    let html = `<div class="ai-finding" data-ref="${ref}" data-category="${category}">`;
    html += `<div class="ai-finding-label">${category}</div>`;

    // Confidence bar (detailed only)
    if (level === 'detailed' && finding.confidence) {
      html += this._renderConfidenceBar(finding.confidence);
    }

    html += `<div class="ai-finding-text">${processedText}</div>`;

    // Comparison bar (show for most striking finding)
    if (finding.comparison) {
      html += this._renderComparisonBar(finding.comparison);
    }

    // Evidence data (for expandable evidence cards #4)
    if (finding.evidence && finding.evidence.length > 0) {
      html += `<div class="finding-evidence collapsed" data-evidence='${JSON.stringify(finding.evidence).replace(/'/g, "&#39;")}'>
        <div class="evidence-papers"></div>
      </div>`;
    }

    // Deep dive data (for collapsible deep dive #10)
    if (finding.deepDive) {
      html += `<div class="finding-deep-dive collapsed">
        <div class="deep-dive-content">${this._esc(finding.deepDive)}</div>
      </div>`;
    }

    // Hover toolbar (progressive disclosure layer 1) — appears on finding hover
    html += `<div class="finding-toolbar">`;
    // #8 Trace path (only if lineage chain data exists)
    if (finding.lineageChain && finding.lineageChain.length > 1) {
      html += `<button class="toolbar-btn trace-btn" data-chain='${JSON.stringify(finding.lineageChain)}' title="Trace lineage path in graph">▶ Trace</button>`;
    }
    // #4 Evidence toggle
    if (finding.evidence && finding.evidence.length > 0) {
      html += `<button class="toolbar-btn evidence-btn" title="Show supporting papers">📋 Evidence (${finding.evidence.length})</button>`;
    }
    // #10 Deep dive toggle
    if (finding.deepDive) {
      html += `<button class="toolbar-btn deepdive-btn" title="Explore deeper analysis">🔍 Deep dive</button>`;
    }
    // #7 Ask About This
    html += `<button class="toolbar-btn ask-btn" title="Ask about this finding">💬 Ask</button>`;
    html += `</div>`;

    html += '</div>';
    return html;
  }

  _renderConfidenceBar(confidence) {
    const level = confidence >= 0.75 ? 'high' : confidence >= 0.5 ? 'medium' : 'low';
    const label = level.toUpperCase();
    const filled = Math.round(confidence * 10);
    const empty = 10 - filled;

    let segments = '';
    for (let i = 0; i < filled; i++) segments += '<span class="bar-segment filled"></span>';
    for (let i = 0; i < empty; i++) segments += '<span class="bar-segment empty"></span>';

    return `
      <div class="confidence-bar-inline">
        <div class="confidence-bar-track">${segments}</div>
        <span class="confidence-level-text ${level}">${label} CONFIDENCE</span>
      </div>
    `;
  }

  _renderComparisonBar(comparison) {
    const { thisValue, avgValue, thisLabel, avgLabel, note } = comparison;
    const maxVal = Math.max(thisValue, avgValue, 1);

    return `
      <div class="comparison-bar">
        <div class="comparison-bar-row">
          <span class="comparison-bar-label">${this._esc(thisLabel || 'This paper')}</span>
          <div class="comparison-bar-track-outer">
            <div class="comparison-bar-fill" style="width:${(thisValue / maxVal * 100).toFixed(0)}%"></div>
          </div>
          <span class="comparison-bar-value">${this._formatPct(thisValue)}</span>
        </div>
        <div class="comparison-bar-row">
          <span class="comparison-bar-label">${this._esc(avgLabel || 'Field avg')}</span>
          <div class="comparison-bar-track-outer">
            <div class="comparison-bar-fill" style="width:${(avgValue / maxVal * 100).toFixed(0)}%;background:#9CA3AF"></div>
          </div>
          <span class="comparison-bar-value">${this._formatPct(avgValue)}</span>
        </div>
        ${note ? `<div class="comparison-bar-note">${this._esc(note)}</div>` : ''}
      </div>
    `;
  }

  _renderMicroViz(distribution, vizType) {
    const maxPct = Math.max(...distribution.map(d => d.pct || 0), 1);
    let rows = '';
    for (const d of distribution) {
      const width = ((d.pct || 0) / maxPct * 100).toFixed(0);
      // Add data attributes for interactive hover (#2 mutation type, #6 decade)
      let dataAttr = '';
      if (vizType === 'mutation') dataAttr = ` data-mutation-type="${(d.rawLabel || d.label || '').toLowerCase()}"`;
      else if (vizType === 'temporal') dataAttr = ` data-decade="${(d.label || '').replace('s', '')}"`;
      rows += `
        <div class="micro-viz-row"${dataAttr}>
          <span class="micro-viz-label">${this._esc(d.label)}</span>
          <div class="micro-viz-bar-outer">
            <div class="micro-viz-bar-fill" style="width:${width}%"></div>
          </div>
          <span class="micro-viz-pct">${d.pct}%</span>
        </div>
      `;
    }
    return `<div class="micro-viz">${rows}</div>`;
  }

  _renderDisagreementMap(contradictions) {
    let html = '<div class="disagreement-map"><h5>Contested Ideas</h5>';
    for (const c of contradictions) {
      html += `
        <div class="disagreement-pair">
          <div class="disagreement-paper">"${this._esc(c.paper_a)}" (${c.year_a || '?'})</div>
          <span class="disagreement-connector">CONTRADICTS</span>
          <div class="disagreement-paper">"${this._esc(c.paper_b)}" (${c.year_b || '?'})</div>
        </div>
        ${c.context ? `<div class="disagreement-context">${this._esc(c.context)}</div>` : ''}
      `;
    }
    html += '</div>';
    return html;
  }

  _renderUnseenConnections(connections) {
    let html = '<div class="unseen-connections"><h5>Things You Might Not Know</h5>';
    connections.forEach((c, i) => {
      html += `
        <div class="unseen-item">
          <span class="unseen-number">${i + 1}</span>
          <span>${this._esc(this._toText(c))}</span>
        </div>
      `;
    });
    html += '</div>';
    return html;
  }

  _renderOpportunities(opportunities) {
    let html = '<div class="research-opportunities"><h5>Research Opportunities</h5>';
    for (const o of opportunities) {
      html += `<p style="margin:0 0 6px">&bull; ${this._esc(this._toText(o))}</p>`;
    }
    html += '</div>';
    return html;
  }

  // ═══════ INTERACTIVE FEATURES (#1, #2, #4, #6, #7, #8, #10, #17) ═══════

  /**
   * #1 — Clickable paper reference chips.
   * Wraps paper titles in quoted text with clickable spans.
   * Pattern: "Title of Paper" → <span class="paper-chip">Title of Paper</span>
   */
  _wrapPaperChips(text) {
    const escaped = this._esc(text);
    // Match "Paper Title" patterns (quoted paper names)
    return escaped.replace(/&quot;([^&]{5,80})&quot;/g, (match, title) => {
      // Find matching node by title substring
      const nodes = window._graphLoader?._graphData?.nodes || window._arivuGraph?.allNodes || [];
      const node = nodes.find(n => (n.title || '').toLowerCase().includes(title.toLowerCase().slice(0, 30)));
      const paperId = node ? (node.id || node.paper_id || '') : '';
      return `<span class="paper-chip" data-paper-id="${paperId}" title="Click to highlight in graph">"${title}"</span>`;
    });
  }

  /**
   * Initialize all interactive event delegation.
   * Called once in constructor. Uses event delegation on document
   * to handle clicks on dynamically rendered content.
   */
  _initInteractive() {
    // #1 — Paper chip click → zoom to node in graph
    document.addEventListener('click', (e) => {
      const chip = e.target.closest('.paper-chip');
      if (!chip) return;
      const paperId = chip.dataset.paperId;
      if (!paperId) return;
      e.preventDefault();
      this._highlightNodeInGraph(paperId);
    });

    // #2 — Mutation bar hover → highlight edges in graph
    document.addEventListener('mouseover', (e) => {
      const bar = e.target.closest('.micro-viz-row[data-mutation-type]');
      if (!bar) return;
      const mutType = bar.dataset.mutationType;
      if (mutType) this._highlightEdgesByType(mutType);
    });
    document.addEventListener('mouseout', (e) => {
      const bar = e.target.closest('.micro-viz-row[data-mutation-type]');
      if (!bar) return;
      this._clearEdgeHighlights();
    });

    // #6 — Timeline bar hover → show papers from that decade
    document.addEventListener('mouseover', (e) => {
      const bar = e.target.closest('.micro-viz-row[data-decade]');
      if (!bar) return;
      this._showDecadeTooltip(bar);
    });
    document.addEventListener('mouseout', (e) => {
      const bar = e.target.closest('.micro-viz-row[data-decade]');
      if (!bar) return;
      this._hideDecadeTooltip();
    });

    // Toolbar buttons (event delegation for #4, #7, #8, #10)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.toolbar-btn');
      if (!btn) return;
      const finding = btn.closest('.ai-finding');
      if (!finding) return;

      if (btn.classList.contains('trace-btn')) {
        // #8 — Trace lineage path
        const chain = JSON.parse(btn.dataset.chain || '[]');
        this._traceLineagePath(chain);
      } else if (btn.classList.contains('evidence-btn')) {
        // #4 — Toggle evidence cards
        const evEl = finding.querySelector('.finding-evidence');
        if (evEl) {
          const isCollapsed = evEl.classList.toggle('collapsed');
          if (!isCollapsed && evEl.querySelector('.evidence-papers').children.length === 0) {
            this._populateEvidence(evEl);
          }
          btn.textContent = isCollapsed ? `📋 Evidence (${JSON.parse(evEl.dataset.evidence || '[]').length})` : '📋 Hide evidence';
        }
      } else if (btn.classList.contains('deepdive-btn')) {
        // #10 — Toggle deep dive
        const ddEl = finding.querySelector('.finding-deep-dive');
        if (ddEl) {
          const isCollapsed = ddEl.classList.toggle('collapsed');
          btn.textContent = isCollapsed ? '🔍 Deep dive' : '🔍 Hide';
        }
      } else if (btn.classList.contains('ask-btn')) {
        // #7 — Ask About This
        const category = finding.dataset.category || 'this finding';
        const text = finding.querySelector('.ai-finding-text')?.textContent || '';
        const windowEl = finding.closest('.arivu-window');
        this._openDiscuss(`${category}: ${text.slice(0, 200)}`, windowEl);
      }
    });
  }

  /**
   * #1 — Highlight a node in the graph by paper ID.
   * Zooms to the node and pulses it gold. After 3 seconds, restores original style.
   */
  _highlightNodeInGraph(paperId) {
    if (!paperId) return;
    const graph = window._arivuGraph;
    if (!graph) return;

    // Find the node in D3 force graph
    const nodeEl = graph.nodeGroup?.select(`g.node[data-id="${paperId}"]`);
    if (nodeEl && !nodeEl.empty()) {
      const circle = nodeEl.select('circle');
      if (!circle.empty()) {
        const origR = parseFloat(circle.attr('r')) || 6;
        const origStroke = circle.attr('stroke') || '#6B7280';
        const origStrokeWidth = parseFloat(circle.attr('stroke-width')) || 1;

        // Pulse: grow → shrink → restore to original
        circle
          .transition().duration(200).attr('r', origR * 1.8).attr('stroke', '#D4A843').attr('stroke-width', 3)
          .transition().duration(200).attr('r', origR * 1.3).attr('stroke', '#D4A843').attr('stroke-width', 2)
          .transition().duration(2500).attr('r', origR).attr('stroke', origStroke).attr('stroke-width', origStrokeWidth);

        // Smooth zoom to the node (single transition, won't freeze)
        const d = graph.allNodes?.find(n => n.id === paperId);
        if (d && d.x != null && d.y != null && graph.svg && graph.zoom) {
          const svgEl = graph.svg.node();
          const w = svgEl.clientWidth || svgEl.getBoundingClientRect().width;
          const h = svgEl.clientHeight || svgEl.getBoundingClientRect().height;
          if (w > 0 && h > 0) {
            const transform = d3.zoomIdentity.translate(w / 2, h / 2).scale(2).translate(-d.x, -d.y);
            graph.svg.transition().duration(750).call(graph.zoom.transform, transform);
          }
        }
      }
    }

    // Also try tree layout
    if (window._treeLayout?.nodeGroup) {
      const treeNode = window._treeLayout.nodeGroup.select(`g.tree-node[data-id="${paperId}"]`);
      if (treeNode && !treeNode.empty()) {
        treeNode.select('rect')
          .transition().duration(200).attr('fill', '#D4A843').attr('stroke', '#92742C').attr('stroke-width', 2)
          .transition().duration(2500).attr('fill', '#9CA3AF').attr('stroke', '#6B7280').attr('stroke-width', 0.5);
      }
    }
  }

  /**
   * #2 — Highlight edges by mutation type.
   */
  _highlightEdgesByType(mutationType) {
    const graph = window._arivuGraph;
    if (!graph?.linkGroup) return;

    const colorMap = {
      adoption: '#3B82F6', generalization: '#22C55E', specialization: '#06B6D4',
      hybridization: '#8B5CF6', contradiction: '#EF4444', revival: '#F59E0B', incidental: '#9CA3AF'
    };
    const color = colorMap[mutationType] || '#6B7280';

    graph.linkGroup.selectAll('line, path')
      .attr('stroke-opacity', function() {
        const d = d3.select(this).datum();
        return (d?.mutation_type === mutationType) ? 1 : 0.05;
      })
      .attr('stroke', function() {
        const d = d3.select(this).datum();
        return (d?.mutation_type === mutationType) ? color : '#ccc';
      })
      .attr('stroke-width', function() {
        const d = d3.select(this).datum();
        return (d?.mutation_type === mutationType) ? 2.5 : 0.5;
      });
  }

  /**
   * #2 — Clear edge highlights.
   */
  _clearEdgeHighlights() {
    const graph = window._arivuGraph;
    if (!graph?.linkGroup) return;
    graph.linkGroup.selectAll('line, path')
      .attr('stroke-opacity', 0.3)
      .attr('stroke', '#94A3B8')
      .attr('stroke-width', 1);
  }

  /**
   * #6 — Show decade tooltip on timeline bar hover.
   */
  _showDecadeTooltip(barEl) {
    // Get decade from data attribute
    const decade = barEl.dataset.decade;
    if (!decade) return;

    const decadeStart = parseInt(decade);
    const decadeEnd = decadeStart + 9;
    const nodes = (window._graphLoader?._graphData?.nodes || [])
      .filter(n => n.year && n.year >= decadeStart && n.year <= decadeEnd)
      .sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0))
      .slice(0, 5);

    if (nodes.length === 0) return;

    // Create tooltip
    let existing = document.getElementById('decade-tooltip');
    if (existing) existing.remove();

    const tt = document.createElement('div');
    tt.id = 'decade-tooltip';
    tt.className = 'decade-tooltip';
    const paperList = nodes.map(n => `<div class="decade-paper">"${(n.title || '').slice(0, 40)}..." (${n.year})</div>`).join('');
    tt.innerHTML = `<div class="decade-tooltip-title">${decade}s (${nodes.length} papers)</div>${paperList}`;

    const rect = barEl.getBoundingClientRect();
    tt.style.left = rect.right + 8 + 'px';
    tt.style.top = rect.top + 'px';
    document.body.appendChild(tt);
  }

  /**
   * #6 — Hide decade tooltip.
   */
  _hideDecadeTooltip() {
    const tt = document.getElementById('decade-tooltip');
    if (tt) tt.remove();
  }

  /**
   * #4 — Populate evidence cards for a finding.
   */
  _populateEvidence(evEl) {
    const evidence = JSON.parse(evEl.dataset.evidence || '[]');
    const container = evEl.querySelector('.evidence-papers');
    if (!container) return;

    let html = '';
    evidence.slice(0, 10).forEach(e => {
      html += `<div class="evidence-card">
        <span class="paper-chip" data-paper-id="${e.id || ''}">"${this._esc((e.title || '').slice(0, 50))}"</span>
        <span class="evidence-meta">${e.year || '?'} · ${(e.citation_count || 0).toLocaleString()} cit.</span>
      </div>`;
    });
    if (evidence.length > 10) {
      html += `<div class="evidence-more">+${evidence.length - 10} more papers</div>`;
    }
    container.innerHTML = html;
  }

  /**
   * #8 — Trace a lineage path with sequential edge animation.
   * Uses BFS on the graph edge data to find the REAL shortest path
   * between two nodes, then animates each edge sequentially.
   * IMPORTANT: Does NOT zoom (concurrent zoom transitions freeze D3).
   */
  _traceLineagePath(chain) {
    if (!chain || chain.length < 2) return;
    const graph = window._arivuGraph;
    if (!graph) return;
    if (this._traceActive) return;
    this._traceActive = true;

    // Get the real edge data to build an adjacency map
    const graphData = window._graphLoader?._graphData;
    if (!graphData?.edges) { this._traceActive = false; return; }

    // Build adjacency list from edges (undirected for path finding)
    const adj = new Map();
    for (const e of graphData.edges) {
      const src = typeof e.source === 'object' ? e.source.id : e.source;
      const tgt = typeof e.target === 'object' ? e.target.id : e.target;
      if (!src || !tgt) continue;
      if (!adj.has(src)) adj.set(src, []);
      if (!adj.has(tgt)) adj.set(tgt, []);
      adj.get(src).push(tgt);
      adj.get(tgt).push(src);
    }

    // BFS to find shortest path from chain[0] to chain[chain.length-1]
    const startId = chain[0];
    const endId = chain[chain.length - 1];
    const realPath = this._bfsPath(adj, startId, endId);

    if (!realPath || realPath.length < 2) {
      console.warn('Trace: no path found between', startId, 'and', endId);
      this._traceActive = false;
      return;
    }

    // Cap path length to prevent excessively long animations
    const path = realPath.length > 12 ? [...realPath.slice(0, 6), ...realPath.slice(-6)] : realPath;

    // Save original edge styles for restore
    const origEdgeStyles = [];
    if (graph.linkGroup) {
      graph.linkGroup.selectAll('line, path').each(function() {
        const el = d3.select(this);
        origEdgeStyles.push({
          el, stroke: el.attr('stroke'), opacity: el.attr('stroke-opacity'), width: el.attr('stroke-width')
        });
      });
    }
    const origNodeOpacities = [];
    if (graph.nodeGroup) {
      graph.nodeGroup.selectAll('circle').each(function() {
        const el = d3.select(this);
        origNodeOpacities.push({ el, opacity: el.attr('opacity') || 1 });
      });
    }

    // Phase 1: Dim everything (300ms)
    if (graph.linkGroup) {
      graph.linkGroup.selectAll('line, path')
        .transition().duration(300)
        .attr('stroke-opacity', 0.06).attr('stroke', '#d0d0d0').attr('stroke-width', 0.5);
    }
    if (graph.nodeGroup) {
      graph.nodeGroup.selectAll('circle')
        .transition().duration(300).attr('opacity', 0.2);
    }

    // Phase 2: Animate path edges one by one
    let delay = 400;
    for (let i = 0; i < path.length; i++) {
      const nodeId = path[i];
      const nextId = i < path.length - 1 ? path[i + 1] : null;

      setTimeout(() => {
        // Pulse this node
        this._pulseNodeOnly(nodeId, '#D4A843');

        // Highlight the edge to the next node
        if (nextId && graph.linkGroup) {
          graph.linkGroup.selectAll('line, path').each(function() {
            const d = d3.select(this).datum();
            if (!d) return;
            const sId = typeof d.source === 'object' ? d.source.id : d.source;
            const tId = typeof d.target === 'object' ? d.target.id : d.target;
            if ((sId === nodeId && tId === nextId) || (sId === nextId && tId === nodeId)) {
              d3.select(this)
                .transition().duration(350)
                .attr('stroke', '#D4A843').attr('stroke-opacity', 1).attr('stroke-width', 3);
            }
          });
        }
      }, delay);
      delay += 500;
    }

    // Phase 3: Hold for 2s, then restore everything
    setTimeout(() => {
      origEdgeStyles.forEach(os => {
        os.el.transition().duration(600)
          .attr('stroke', os.stroke || '#94A3B8')
          .attr('stroke-opacity', os.opacity || 0.3)
          .attr('stroke-width', os.width || 1);
      });
      origNodeOpacities.forEach(on => {
        on.el.transition().duration(600).attr('opacity', on.opacity);
      });
      this._traceActive = false;
    }, delay + 2000);
  }

  /**
   * BFS shortest path between two nodes in adjacency map.
   * Returns array of node IDs from start to end, or null if no path.
   */
  _bfsPath(adj, startId, endId) {
    if (startId === endId) return [startId];
    if (!adj.has(startId)) return null;

    const visited = new Set([startId]);
    const queue = [[startId]]; // queue of paths

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];
      const neighbors = adj.get(current) || [];

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        const newPath = [...path, neighbor];
        if (neighbor === endId) return newPath;
        // Limit BFS depth to prevent excessive search on large graphs
        if (newPath.length < 15) {
          queue.push(newPath);
        }
      }
    }
    return null; // no path found
  }

  /**
   * Pulse a node visually WITHOUT zooming. Used by trace path.
   */
  _pulseNodeOnly(paperId, color) {
    const graph = window._arivuGraph;
    if (!graph?.nodeGroup) return;

    const nodeEl = graph.nodeGroup.select(`g.node[data-id="${paperId}"]`);
    if (nodeEl.empty()) return;

    const circle = nodeEl.select('circle');
    if (circle.empty()) return;

    const origR = parseFloat(circle.attr('r')) || 6;
    circle
      .attr('opacity', 1)
      .transition().duration(150).attr('r', origR * 1.6).attr('stroke', color).attr('stroke-width', 3)
      .transition().duration(150).attr('r', origR * 1.2).attr('stroke', color).attr('stroke-width', 2)
      .transition().duration(2000).attr('r', origR).attr('stroke', color).attr('stroke-width', 1.5);
  }

  /**
   * #17 — Cross-graph memory. Compare current graph metrics against
   * previously explored graphs stored in localStorage.
   */
  _getCrossGraphMemory() {
    const graphData = window._graphLoader?._graphData;
    if (!graphData) return null;

    const nodes = graphData.nodes || [];
    const edges = graphData.edges || [];
    const seedNode = nodes.find(n => n.is_seed);
    const graphId = graphData.metadata?.graph_id;

    if (!graphId || !seedNode) return null;

    // Current graph metrics
    const bottleneckNodes = nodes.filter(n => n.is_bottleneck);
    const topBn = [...bottleneckNodes].sort((a, b) => (b.pruning_impact || 0) - (a.pruning_impact || 0))[0];
    const topBnPct = topBn && nodes.length > 1 ? Math.min(100, Math.round((topBn.pruning_impact || 0) / (nodes.length - 1) * 100)) : 0;
    const fields = {};
    nodes.forEach(n => { const f = (n.fields_of_study || [])[0] || 'Other'; fields[f] = (fields[f] || 0) + 1; });
    const topFieldPct = nodes.length ? Math.round(Math.max(...Object.values(fields)) / nodes.length * 100) : 0;
    const adoptionPct = edges.length ? Math.round(edges.filter(e => e.mutation_type === 'adoption').length / edges.length * 100) : 0;

    const currentMetrics = {
      graphId,
      title: seedNode.title || 'Unknown',
      nodeCount: nodes.length,
      bottleneckPct: topBnPct,
      topFieldPct,
      adoptionPct,
      bottleneckCount: bottleneckNodes.length,
      timestamp: Date.now()
    };

    // Save to localStorage
    let history = [];
    try { history = JSON.parse(localStorage.getItem('arivu_graph_memory') || '[]'); } catch {}
    // Remove current graph if already stored, keep last 20
    history = history.filter(h => h.graphId !== graphId);
    history.push(currentMetrics);
    if (history.length > 20) history = history.slice(-20);
    try { localStorage.setItem('arivu_graph_memory', JSON.stringify(history)); } catch {}

    // Find pattern matches in previous graphs
    const prev = history.filter(h => h.graphId !== graphId);
    if (prev.length === 0) return null;

    const matches = [];

    // Pattern: similar bottleneck concentration
    const bnMatches = prev.filter(h => Math.abs(h.bottleneckPct - topBnPct) < 15 && h.bottleneckPct > 40);
    if (bnMatches.length > 0 && topBnPct > 40) {
      const best = bnMatches.reduce((a, b) => Math.abs(a.bottleneckPct - topBnPct) < Math.abs(b.bottleneckPct - topBnPct) ? a : b);
      matches.push({
        type: 'bottleneck_similarity',
        text: `The "${best.title.slice(0, 40)}..." graph you explored earlier has a similar structural pattern: ${best.bottleneckPct}% bottleneck dependency vs ${topBnPct}% here. Both lineages share the same single-point vulnerability.`,
        icon: '🔗'
      });
    }

    // Pattern: similar field concentration
    const fieldMatches = prev.filter(h => Math.abs(h.topFieldPct - topFieldPct) < 10 && h.topFieldPct > 60);
    if (fieldMatches.length > 0 && topFieldPct > 60 && matches.length === 0) {
      const best = fieldMatches[0];
      matches.push({
        type: 'field_similarity',
        text: `Similar field concentration to the "${best.title.slice(0, 40)}..." graph (${best.topFieldPct}% vs ${topFieldPct}% here). Both ancestries are dominated by a single discipline.`,
        icon: '🧬'
      });
    }

    // Pattern: contrasting graph sizes
    const sizeContrasts = prev.filter(h => Math.abs(h.nodeCount - nodes.length) > 300);
    if (sizeContrasts.length > 0 && matches.length < 2) {
      const best = sizeContrasts[0];
      const larger = best.nodeCount > nodes.length;
      matches.push({
        type: 'size_contrast',
        text: `Compared to the "${best.title.slice(0, 40)}..." graph (${best.nodeCount} papers), this lineage is ${larger ? 'significantly smaller' : 'significantly larger'} at ${nodes.length} papers. ${larger ? 'A smaller lineage may indicate a more focused or newer research direction.' : 'A larger lineage suggests a more established field with deeper roots.'}`,
        icon: '📊'
      });
    }

    return matches.length > 0 ? matches : null;
  }

  /**
   * #17 — Render cross-graph memory section.
   */
  _renderCrossGraphMemory() {
    const matches = this._getCrossGraphMemory();
    if (!matches || matches.length === 0) return '';

    let html = '<div class="cross-graph-memory"><h5>Pattern Match</h5>';
    matches.forEach(m => {
      html += `<div class="memory-match"><span class="memory-icon">${m.icon}</span><span>${this._esc(m.text)}</span></div>`;
    });
    html += '</div>';
    return html;
  }

  _renderPruningInterpretation(data, pruneResult, level) {
    if (level === 'short') {
      return `<p style="font-size:0.8rem;color:var(--text-secondary);line-height:1.5">${this._esc(data.short_text || 'Analysis loading...')}</p>`;
    }
    // Detailed pruning narrative
    return this._renderInterpretation(data, 'pruning', 'detailed');
  }

  // ═══════ FALLBACK (client-side computed, no Groq) ═══════

  _renderFallback(containerType, level) {
    const graphData = window._graphLoader?._graphData;
    if (!graphData) return '<p style="color:var(--text-muted);font-size:0.8rem">Graph data not available.</p>';

    const nodes = graphData.nodes || [];
    const totalNodes = nodes.length;

    if (containerType === 'graph') {
      return this._renderGraphFallback(graphData, level);
    } else if (containerType === 'dna') {
      return this._renderDNAFallback(graphData, level);
    } else if (containerType === 'diversity') {
      return this._renderDiversityFallback(graphData, level);
    } else if (containerType === 'orphans') {
      return this._renderOrphansFallback(graphData, level);
    } else if (containerType === 'coverage') {
      return this._renderCoverageFallback(graphData, level);
    }

    return '<p style="color:var(--text-muted);font-size:0.8rem">Interpretation not available.</p>';
  }

  _renderGraphFallback(graphData, level) {
    const nodes = graphData.nodes || [];
    const edges = graphData.edges || [];
    const totalNodes = nodes.length;
    const bottleneckNodes = nodes.filter(n => n.is_bottleneck);
    const bottlenecks = bottleneckNodes.length;
    const seedNode = nodes.find(n => n.is_seed);
    const fields = {};
    nodes.forEach(n => {
      const f = (n.fields_of_study || [])[0] || 'Other';
      fields[f] = (fields[f] || 0) + 1;
    });
    const sortedFields = Object.entries(fields).sort((a, b) => b[1] - a[1]);
    const topField = sortedFields[0] || ['Unknown', 0];
    const topFieldPct = ((topField[1] / totalNodes) * 100).toFixed(0);
    const secondField = sortedFields[1];
    const secondFieldPct = secondField ? ((secondField[1] / totalNodes) * 100).toFixed(0) : 0;

    const years = nodes.map(n => n.year).filter(Boolean);
    const minYear = years.length ? Math.min(...years) : null;
    const maxYear = years.length ? Math.max(...years) : null;
    const yearSpan = (minYear && maxYear) ? (maxYear - minYear) : 0;
    const post2015 = years.filter(y => y >= 2015).length;
    const post2015Pct = years.length ? Math.round(post2015 / years.length * 100) : 0;

    // Top bottleneck by pruning impact
    const topBn = [...bottleneckNodes].sort((a, b) => (b.pruning_impact || 0) - (a.pruning_impact || 0))[0];
    const topBnPct = topBn && totalNodes > 1 ? Math.min(100, Math.round((topBn.pruning_impact || 0) / (totalNodes - 1) * 100)) : 0;

    // Contradiction edges
    const contradictions = edges.filter(e => e.mutation_type === 'contradiction');

    let html = '';

    // Summary note: 2-3 line condensed interpretation
    const summaryNote = topBn && topBnPct > 50
      ? `This lineage is structurally fragile. ${bottlenecks} bottleneck paper${bottlenecks > 1 ? 's' : ''} hold${bottlenecks === 1 ? 's' : ''} together ${topBnPct}% of the ancestry. The dominant tradition is ${topField[0]} (${topFieldPct}%), spanning ${yearSpan} years back to ${minYear || '?'}.`
      : `A ${totalNodes}-paper ancestry spanning ${yearSpan} years across ${sortedFields.length} fields. ${parseInt(topFieldPct) > 70 ? `Heavily concentrated in ${topField[0]} (${topFieldPct}%).` : `Led by ${topField[0]} (${topFieldPct}%) with moderate diversity.`}`;
    html += `<div class="ai-summary-note">${this._esc(summaryNote)}</div>`;

    if (level === 'detailed') {
      const takeaway = topBn
        ? `This lineage of ${totalNodes} papers spans ${yearSpan} years. ${bottlenecks} bottleneck papers hold it together. Remove "${(topBn.title || '').slice(0, 60)}" and ${topBnPct}% collapses.`
        : `This lineage contains ${totalNodes} papers spanning ${yearSpan} years across ${sortedFields.length} research fields.`;
      html += `<div class="ai-highlight-box">${this._esc(takeaway)}</div>`;
    }

    // Compute edge mutation type distribution (Arivu-unique data)
    const mutationTypes = {};
    edges.forEach(e => {
      const mt = e.mutation_type || 'unknown';
      mutationTypes[mt] = (mutationTypes[mt] || 0) + 1;
    });
    const adoptionPct = edges.length ? Math.round((mutationTypes['adoption'] || 0) / edges.length * 100) : 0;
    const contradictionPct = edges.length ? Math.round((mutationTypes['contradiction'] || 0) / edges.length * 100) : 0;
    const generalizationPct = edges.length ? Math.round((mutationTypes['generalization'] || 0) / edges.length * 100) : 0;

    // Compute survivor info for fragility finding
    const survivorCount = totalNodes - (topBn?.pruning_impact || 0) - 1; // total - collapsed - pruned
    const leafNodes = nodes.filter(n => !n.is_seed && (n.pruning_impact === 0 || n.pruning_impact === undefined));
    const pre2000Papers = nodes.filter(n => n.year && n.year < 2000);

    // Build lineage chain endpoints for trace path (#8)
    // BFS finds the real shortest path at animation time (in _traceLineagePath)
    // We just provide the start (seed) and end (oldest ancestor) points
    const oldestPaper = [...nodes].filter(n => n.year && !n.is_seed).sort((a, b) => (a.year || 9999) - (b.year || 9999))[0];
    const lineageChain = [];
    if (seedNode) lineageChain.push(seedNode.id);
    if (oldestPaper && oldestPaper.id !== seedNode?.id) lineageChain.push(oldestPaper.id);

    // Build evidence lists for bottleneck finding (#4)
    const bnEvidence = bottleneckNodes.slice(0, 8).map(n => ({
      id: n.id, title: n.title || '', year: n.year, citation_count: n.citation_count || 0
    }));

    // Most surprising finding FIRST — fragility or bottleneck (this is Arivu's unique insight)
    if (bottlenecks > 0 && topBn) {
      const survivalNote = topBnPct > 70 && survivorCount > 0
        ? ` If this paper's core assumptions were challenged, only ${survivorCount} papers would survive through independent paths${pre2000Papers.length > 3 ? ` (primarily pre-${Math.min(2000, minYear + 30)} foundational work)` : ''}.`
        : '';
      html += this._renderFinding({
        category: topBnPct > 50 ? 'FRAGILITY' : 'BOTTLENECK',
        text: `${topBnPct > 50 ? `${topBnPct}% of this lineage depends on a single paper.` : `${bottlenecks} structurally irreplaceable papers detected.`} "${(topBn.title || '').slice(0, 50)}" supports ${topBn.pruning_impact || 0} descendants.${survivalNote}`,
        comparison: topBnPct > 25 ? {
          thisValue: topBnPct, avgValue: 35,
          thisLabel: 'Top bottleneck', avgLabel: 'Typical', note: topBnPct > 50 ? 'Single-point dependency' : ''
        } : null,
        confidence: level === 'detailed' ? 0.85 : undefined,
        evidence: bnEvidence,
        lineageChain: lineageChain.length >= 2 ? lineageChain : undefined,
        deepDive: level === 'detailed' && topBnPct > 30 ? `The top bottleneck "${(topBn.title || '').slice(0, 60)}" was published in ${topBn.year || '?'} and has ${(topBn.citation_count || 0).toLocaleString()} citations. ${bottlenecks > 3 ? `${bottlenecks} papers form the structural skeleton of this lineage. Together they support ${nodes.filter(n => (n.pruning_impact || 0) > 0).length} papers that would collapse without them.` : `Only ${bottlenecks} papers hold this entire lineage together, making it exceptionally fragile.`}` : undefined,
      }, level);
    }

    // Finding 2: Intellectual inheritance — edge mutation distribution (Arivu-unique)
    if (edges.length > 10) {
      const dominantMutation = adoptionPct > 60 ? 'adoption' : generalizationPct > 20 ? 'generalization' : null;
      html += this._renderFinding({
        category: 'INTELLECTUAL INHERITANCE',
        text: dominantMutation === 'adoption'
          ? `${adoptionPct}% of edges are direct method adoption. Only ${contradictionPct}% represent contradictions. This lineage has ${contradictionPct < 5 ? 'very little internal debate. Most papers build on predecessors without questioning their assumptions.' : 'some healthy intellectual tension.'}`
          : `${generalizationPct}% of connections involve generalization of earlier ideas. ${adoptionPct}% are direct adoptions. This lineage ${generalizationPct > 15 ? 'actively extends and broadens foundational concepts.' : 'primarily reuses established methods.'}`,
        confidence: level === 'detailed' ? 0.8 : undefined,
      }, level);
    }

    // Finding 3: Temporal shape — interpretation, not just stats
    if (post2015Pct > 60 || yearSpan > 50) {
      html += this._renderFinding({
        category: post2015Pct > 70 ? 'SHALLOW ROOTS' : 'DEEP ROOTS',
        text: post2015Pct > 70
          ? `${post2015Pct}% of ancestry is post-2015. This lineage has shallow historical depth and may be vulnerable to paradigm shifts in recent approaches.`
          : `This lineage reaches back ${yearSpan} years to ${minYear || '?'}, drawing on ${yearSpan > 50 ? 'deep' : 'moderate'} historical foundations that predate current trends.`,
        confidence: level === 'detailed' ? 0.9 : undefined,
      }, level);
    }

    // Detailed-only sections
    if (level === 'detailed') {
      // Mutation type distribution micro-viz (Arivu-unique)
      if (edges.length > 10) {
        const mutDist = Object.entries(mutationTypes)
          .filter(([k]) => k !== 'unknown' && k !== 'incidental')
          .sort((a, b) => b[1] - a[1])
          .map(([label, count]) => ({ label: label.charAt(0).toUpperCase() + label.slice(1), pct: Math.round(count / edges.length * 100) }));
        if (mutDist.length > 1) {
          html += `<div style="margin:12px 0 4px;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280">How ideas flow through this lineage</div>`;
          // Add rawLabel for mutation type hover (#2)
          mutDist.forEach(d => { d.rawLabel = d.label; });
          html += this._renderMicroViz(mutDist, 'mutation');
        }
      }

      // Temporal distribution micro-viz
      const yearBuckets = {};
      years.forEach(y => {
        const decade = `${Math.floor(y / 10) * 10}s`;
        yearBuckets[decade] = (yearBuckets[decade] || 0) + 1;
      });
      const tempDist = Object.entries(yearBuckets).sort().map(([label, count]) => ({
        label, pct: Math.round(count / totalNodes * 100)
      }));
      if (tempDist.length > 2) {
        html += `<div style="margin:12px 0 4px;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280">Temporal distribution</div>`;
        html += this._renderMicroViz(tempDist, 'temporal');
      }

      // Bottleneck ranking (top 5)
      if (bottleneckNodes.length > 1) {
        const bnSorted = [...bottleneckNodes].sort((a, b) => (b.pruning_impact || 0) - (a.pruning_impact || 0)).slice(0, 5);
        html += this._renderFinding({
          category: 'BOTTLENECK RANKING',
          text: bnSorted.map((bn, i) =>
            `${i + 1}. "${(bn.title || '').slice(0, 45)}" (${bn.year || '?'}) supports ${bn.pruning_impact || 0} papers (${totalNodes > 1 ? Math.round((bn.pruning_impact || 0) / (totalNodes - 1) * 100) : 0}%)`
          ).join('\n'),
          confidence: 0.9,
        }, level);
      }

      // Contradiction/disagreement map
      if (contradictions.length > 0) {
        html += this._renderDisagreementMap(contradictions.slice(0, 3).map(e => ({
          paper_a: typeof e.source === 'object' ? e.source.title : this._findNodeTitle(e.source, nodes),
          year_a: typeof e.source === 'object' ? e.source.year : '',
          paper_b: typeof e.target === 'object' ? e.target.title : this._findNodeTitle(e.target, nodes),
          year_b: typeof e.target === 'object' ? e.target.year : '',
          context: `${e.mutation_evidence || 'These papers present opposing views within this lineage.'}`,
        })));
      } else if (contradictionPct === 0 && edges.length > 20) {
        html += this._renderFinding({
          category: 'NO INTERNAL DEBATE',
          text: `Zero contradiction edges in ${edges.length} connections. This lineage has no papers that directly challenge each other. Every paper builds on or extends predecessors. This consensus may indicate methodological maturity or groupthink.`,
          confidence: 0.75,
        }, level);
      }

      // Unseen connections
      const unseenConns = [];
      if (secondField && parseInt(secondFieldPct) > 8) {
        unseenConns.push(`The ${secondField[0]} cluster (${secondFieldPct}%) is ${parseInt(secondFieldPct) > 15 ? 'unusually large' : 'notable'} for a ${topField[0]} paper. These papers may represent cross-disciplinary foundations worth investigating.`);
      }
      if (minYear && maxYear && yearSpan > 50) {
        const oldestPapers = nodes.filter(n => n.year && n.year < minYear + 15).sort((a, b) => (a.year || 9999) - (b.year || 9999)).slice(0, 2);
        if (oldestPapers.length > 0) {
          unseenConns.push(`The oldest papers in this lineage ("${(oldestPapers[0].title || '').slice(0, 40)}..." ${oldestPapers[0].year || '?'}) predate the main research direction by ${yearSpan - 15}+ years. These foundational ideas may contain overlooked insights.`);
        }
      }
      // Most-cited paper that ISN'T a bottleneck (popular but structurally unimportant)
      const highCitedNonBn = nodes
        .filter(n => !n.is_bottleneck && !n.is_seed && (n.citation_count || 0) > 1000)
        .sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0))[0];
      if (highCitedNonBn) {
        unseenConns.push(`"${(highCitedNonBn.title || '').slice(0, 40)}..." has ${(highCitedNonBn.citation_count || 0).toLocaleString()} citations but is not a structural bottleneck. It is widely known but not structurally critical to this specific lineage.`);
      }
      if (unseenConns.length > 0) {
        html += this._renderUnseenConnections(unseenConns);
      }

      // Research opportunities
      const opps = [];
      if (post2015Pct > 60) {
        opps.push(`Explore pre-2015 literature in ${topField[0]} for foundational ideas not yet incorporated. Papers from the ${Math.floor((minYear || 1990) / 10) * 10}s-2000s in this lineage are sparse but may contain underutilized theoretical frameworks.`);
      }
      if (secondField && parseInt(secondFieldPct) > 5) {
        opps.push(`The ${secondField[0]} cluster suggests potential for cross-domain approaches combining ${topField[0]} and ${secondField[0]} methods. Papers at the boundary between these clusters may yield novel hybrid techniques.`);
      }
      if (bottlenecks > 0 && topBnPct > 40) {
        opps.push(`This lineage has a single-point dependency on "${(topBn.title || '').slice(0, 40)}...". Research that provides alternative theoretical foundations would be structurally valuable and reduce the field's fragility.`);
      }
      if (contradictionPct < 3 && edges.length > 30) {
        opps.push(`With almost no internal contradictions, this lineage lacks critical examination of its own assumptions. A paper that systematically challenges the dominant approach would fill a structural gap.`);
      }
      if (opps.length > 0) {
        html += this._renderOpportunities(opps);
      }

      // #17 — Cross-graph memory (conditional, at bottom)
      html += this._renderCrossGraphMemory();
    }

    return html;
  }

  _renderDNAFallback(graphData, level) {
    const dna = graphData.dna_profile;
    if (!dna?.clusters?.length) return '<p style="color:#9CA3AF;font-size:0.8rem">DNA profile not available.</p>';

    // FIX: Sort clusters by percentage descending (they come sorted alphabetically from backend)
    const clusters = [...dna.clusters].sort((a, b) => (b.percentage || 0) - (a.percentage || 0));
    // Clean cluster names: remove "(N papers)" suffix if present in the name
    clusters.forEach(c => { c.cleanName = (c.name || '').replace(/\s*\(\d+\s*papers?\)/i, '').trim(); });

    const top = clusters[0];
    const topPct = Math.round(top.percentage);
    const topCount = top.size || Math.round((graphData.nodes?.length || 0) * top.percentage / 100);
    const second = clusters.length > 1 ? clusters[1] : null;
    const secondPct = second ? Math.round(second.percentage) : 0;
    const secondCount = second ? (second.size || Math.round((graphData.nodes?.length || 0) * second.percentage / 100)) : 0;
    const concentration = Math.round(clusters.slice(0, 3).reduce((s, c) => s + c.percentage, 0));
    const totalClusters = clusters.length;

    // Detect absent common fields (fields that typically appear in research lineages)
    const commonFields = ['Neuroscience', 'Linguistics', 'Cognitive science', 'Psychology', 'Biology', 'Physics', 'Economics'];
    const presentFields = new Set(clusters.map(c => c.cleanName.toLowerCase()));
    const absentFields = commonFields.filter(f => !presentFields.has(f.toLowerCase()));

    let html = '';

    // Summary note: 2-3 line condensed interpretation
    const summaryNote = topPct > 70
      ? `This ancestry is dominated by ${top.cleanName} (${topPct}%), creating a methodologically narrow lineage. ${second && secondPct > 10 ? `A ${second.cleanName} cluster (${secondPct}%) provides some cross-disciplinary grounding.` : `Limited cross-disciplinary influence is visible.`}`
      : totalClusters > 5
        ? `A diverse ancestry spanning ${totalClusters} research clusters. ${top.cleanName} leads at ${topPct}%, but no single field dominates, suggesting broad intellectual foundations.`
        : `This ancestry draws from ${totalClusters} clusters, led by ${top.cleanName} at ${topPct}%. ${concentration > 90 ? 'The top 3 clusters account for most papers, limiting diversity.' : 'A moderate spread of intellectual traditions.'}`;
    html += `<div class="ai-summary-note">${this._esc(summaryNote)}</div>`;

    if (level === 'detailed') {
      html += `<div class="ai-highlight-box">${totalClusters} distinct clusters identified. ${top.cleanName} dominates at ${topPct}%. ${concentration > 85 ? 'High concentration in top 3 clusters signals narrow methodological scope.' : 'Moderate diversity across clusters.'}</div>`;
    }

    // Finding 1: Most interesting finding first
    if (topPct > 70) {
      // Monoculture risk is the most interesting for concentrated lineages
      html += this._renderFinding({
        category: 'MONOCULTURE RISK',
        text: `${topCount} of ${graphData.nodes?.length || '?'} papers (${topPct}%) are ${top.cleanName}. This ancestry draws almost exclusively from one field, limiting exposure to alternative approaches.`,
        ref: 'cluster_0',
        comparison: {
          thisValue: topPct, avgValue: 55,
          thisLabel: 'This paper', avgLabel: 'Typical',
          note: topPct > 80 ? 'Very high concentration' : 'Above average concentration'
        },
        confidence: level === 'detailed' ? 0.9 : undefined,
      }, level);
    } else {
      html += this._renderFinding({
        category: 'DOMINANT LINEAGE',
        text: `${top.cleanName} leads at ${topPct}% (${topCount} papers), but no single field overwhelms this ancestry. This suggests balanced intellectual foundations.`,
        ref: 'cluster_0',
        confidence: level === 'detailed' ? 0.9 : undefined,
      }, level);
    }

    // Finding 2: Cross-pollination or bridge
    if (second && secondPct > 8) {
      html += this._renderFinding({
        category: secondPct > 15 ? 'HIDDEN BRIDGE' : 'CROSS-POLLINATION',
        text: `${secondPct}% comes from ${second.cleanName} (${secondCount} papers)${secondPct > 15 ? `, suggesting a methodological split between ${top.cleanName} and ${second.cleanName} within this lineage.` : '. This secondary tradition may contain overlooked foundational ideas.'}`,
        ref: 'cluster_1',
        confidence: level === 'detailed' ? 0.75 : undefined,
      }, level);
    }

    // Finding 3: Absent fields — domain-contextualized (what's NOT there and WHY it matters)
    if (absentFields.length > 0 && level !== 'short-minimal') {
      // Build domain-specific reasoning for why absent fields matter
      const topLower = top.cleanName.toLowerCase();
      const domainReasons = {
        'Neuroscience': topLower.includes('computer') || topLower.includes('vision') || topLower.includes('intelligence')
          ? 'research on biological neural processing could provide architecture design insights beyond purely engineering approaches'
          : 'understanding of biological information processing could inform theoretical foundations',
        'Linguistics': topLower.includes('computer') || topLower.includes('intelligence') || topLower.includes('information')
          ? 'formal language theory and semantics could strengthen computational models of meaning'
          : 'structural analysis of language could provide new analytical frameworks',
        'Cognitive science': topLower.includes('computer') || topLower.includes('intelligence') || topLower.includes('vision')
          ? 'human cognitive processes (attention, memory, pattern recognition) could inspire new computational models'
          : 'understanding of human reasoning could inform system design',
        'Psychology': 'behavioral insights and experimental methodology could broaden the lineage\'s empirical grounding',
        'Biology': topLower.includes('computer') || topLower.includes('algorithm')
          ? 'biological optimization and evolutionary strategies could offer alternative algorithmic approaches'
          : 'biological systems could provide models for robustness and adaptability',
        'Physics': 'mathematical frameworks from physics (information theory, statistical mechanics) could provide theoretical depth',
        'Economics': 'game theory and mechanism design could inform multi-agent and optimization approaches'
      };

      const relevantAbsent = absentFields.filter(f => domainReasons[f]).slice(0, 2);
      if (relevantAbsent.length > 0) {
        const reasonTexts = relevantAbsent.map(f => `${f} (${domainReasons[f]})`);
        html += this._renderFinding({
          category: 'ABSENT FIELDS',
          text: `No papers from ${relevantAbsent.join(' or ')}. For a ${top.cleanName} lineage, ${reasonTexts[0]}. ${relevantAbsent.length > 1 ? `Additionally, ${reasonTexts[1]}.` : ''} This gap suggests a purely ${topLower.includes('computer') ? 'engineering' : 'domain'}-driven lineage.`,
          confidence: level === 'detailed' ? 0.7 : undefined,
        }, level);
      } else {
        const absText = absentFields.length > 3
          ? `${absentFields.slice(0, 3).join(', ')}, and ${absentFields.length - 3} other common fields`
          : absentFields.join(', ');
        html += this._renderFinding({
          category: 'ABSENT FIELDS',
          text: `No papers from ${absText}. These fields often inform related research but are absent from this lineage, representing potential blind spots.`,
          confidence: level === 'detailed' ? 0.7 : undefined,
        }, level);
      }
    }

    if (level === 'detailed') {
      // Unseen connections: minor clusters
      const unseenConns = [];
      if (totalClusters > 5) {
        const minorClusters = clusters.slice(3).filter(c => c.percentage > 0.3);
        if (minorClusters.length > 0) {
          const minorNames = minorClusters.slice(0, 3).map(c => c.cleanName).join(', ');
          unseenConns.push(`${minorClusters.length} minor clusters (${minorNames}) represent niche traditions. These papers entered the lineage through specific cross-domain citations.`);
        }
      }
      if (second && secondPct < 5 && topPct > 80) {
        unseenConns.push(`The gap between ${top.cleanName} (${topPct}%) and ${second.cleanName} (${secondPct}%) is extreme. This lineage has almost no intellectual diversity.`);
      }
      if (unseenConns.length > 0) html += this._renderUnseenConnections(unseenConns);

      // Opportunities
      const opps = [];
      if (absentFields.length > 2) {
        opps.push(`Incorporating perspectives from ${absentFields[0]} or ${absentFields[1]} could strengthen this lineage's theoretical foundations and open unexplored research directions.`);
      }
      if (concentration > 90) {
        opps.push(`This ancestry is highly concentrated. Papers citing work outside the top 3 clusters may offer genuinely novel approaches that the mainstream lineage has missed.`);
      }
      if (opps.length > 0) html += this._renderOpportunities(opps);
    }

    return html;
  }

  _renderDiversityFallback(graphData, level) {
    const div = graphData.diversity_score;
    if (!div) return '<p style="color:#9CA3AF;font-size:0.8rem">Diversity score not available.</p>';

    const scores = [
      { key: 'field_diversity', name: 'Field Diversity', val: div.field_diversity || 0 },
      { key: 'temporal_span', name: 'Temporal Span', val: div.temporal_span || 0 },
      { key: 'concept_diversity', name: 'Concept Clusters', val: div.concept_diversity || 0 },
      { key: 'citation_entropy', name: 'Citation Balance', val: div.citation_entropy || 0 }
    ];

    const best = scores.reduce((a, b) => a.val > b.val ? a : b);
    const worst = scores.reduce((a, b) => a.val < b.val ? a : b);
    const overall = div.overall || Math.round(scores.reduce((s, sc) => s + sc.val, 0) / 4);

    let html = '';

    // Summary note: 2-3 line condensed interpretation
    const summaryNote = overall > 70
      ? `A well-diversified ancestry scoring ${overall}/100 overall. ${best.name} is particularly strong at ${Math.round(best.val)}/100. ${worst.val < 40 ? `${worst.name} (${Math.round(worst.val)}/100) is the primary blind spot worth addressing.` : 'No major blind spots detected.'}`
      : worst.val < 25
        ? `This ancestry has a significant diversity gap. ${worst.name} scores only ${Math.round(worst.val)}/100, suggesting the research draws too narrowly in this dimension. Overall score: ${overall}/100.`
        : `Moderate diversity at ${overall}/100 overall. ${best.name} leads at ${Math.round(best.val)}/100, while ${worst.name} (${Math.round(worst.val)}/100) has room for growth.`;
    html += `<div class="ai-summary-note">${this._esc(summaryNote)}</div>`;

    if (level === 'detailed') {
      html += `<div class="ai-highlight-box">Overall diversity score: ${overall}/100. Strongest dimension: ${best.name} (${Math.round(best.val)}). Weakest: ${worst.name} (${Math.round(worst.val)}).</div>`;
    }

    // Finding 1: Lead with the blind spot (most actionable)
    html += this._renderFinding({
      category: worst.val < 30 ? 'CRITICAL BLIND SPOT' : 'BLIND SPOT',
      text: `${worst.name} scores only ${Math.round(worst.val)}/100. ${worst.key === 'temporal_span' ? 'This ancestry draws too heavily from recent work, lacking historical depth.' : worst.key === 'field_diversity' ? 'This ancestry is too concentrated in one field, missing cross-disciplinary insights.' : worst.key === 'concept_diversity' ? 'Too few distinct research threads. The ancestry converges on a narrow set of ideas.' : 'Citation patterns are highly skewed toward a few heavily-cited papers.'}`,
      ref: worst.key,
      comparison: {
        thisValue: Math.round(worst.val), avgValue: 50,
        thisLabel: 'This paper', avgLabel: 'Average', note: worst.val < 30 ? 'Significantly below average' : 'Below average'
      },
      confidence: level === 'detailed' ? 0.85 : undefined,
    }, level);

    // Finding 2: Strength
    html += this._renderFinding({
      category: 'STRENGTH',
      text: `${best.name} at ${Math.round(best.val)}/100. ${best.key === 'field_diversity' ? 'This ancestry draws from multiple research fields, providing broad intellectual foundations.' : best.key === 'temporal_span' ? 'A wide historical range gives this lineage deep roots and time-tested foundations.' : best.key === 'concept_diversity' ? 'Many distinct research threads contribute to this ancestry, indicating rich intellectual diversity.' : 'Citations are well-distributed, with no single paper dominating the lineage.'}`,
      ref: best.key,
      comparison: best.val > 60 ? {
        thisValue: Math.round(best.val), avgValue: 50,
        thisLabel: 'This paper', avgLabel: 'Average', note: best.val > 70 ? 'Above average' : ''
      } : null,
      confidence: level === 'detailed' ? 0.85 : undefined,
    }, level);

    // Finding 3: Paradox detection — contradictions between metrics
    if (best.val > 70 && worst.val < 30 && Math.abs(best.val - worst.val) > 50) {
      html += this._renderFinding({
        category: 'PARADOX',
        text: `${best.name} scores ${Math.round(best.val)}/100 but ${worst.name} scores only ${Math.round(worst.val)}/100. ${
          best.key === 'citation_entropy' && worst.key === 'concept_diversity'
            ? 'Many different papers are being cited, but they all converge on the same ideas. Quantity without diversity.'
            : best.key === 'field_diversity' && worst.key === 'temporal_span'
              ? 'This ancestry draws from many fields but only from recent work. Broad but shallow.'
              : best.key === 'temporal_span' && worst.key === 'field_diversity'
                ? 'Deep historical roots but narrow disciplinary focus. Time-tested but potentially insular.'
                : `A ${Math.round(best.val - worst.val)}-point gap between the strongest and weakest dimensions suggests an unbalanced research foundation.`
        }`,
        confidence: level === 'detailed' ? 0.85 : undefined,
      }, level);
    }

    if (level === 'detailed') {
      // All scores as finding
      const mid = scores.filter(s => s !== best && s !== worst);
      mid.forEach(s => {
        html += this._renderFinding({
          category: s.val > 60 ? 'STRENGTH' : s.val < 40 ? 'GAP' : 'MODERATE',
          text: `${s.name}: ${Math.round(s.val)}/100. ${
            s.key === 'field_diversity' ? (s.val > 60 ? 'Draws from multiple research fields.' : 'Concentrated in few fields.')
            : s.key === 'temporal_span' ? (s.val > 60 ? 'Wide historical range.' : 'Dominated by recent work.')
            : s.key === 'concept_diversity' ? (s.val > 60 ? 'Many distinct research threads.' : 'Converging on few ideas.')
            : s.val > 60 ? 'Well-distributed citations.' : 'Skewed toward few papers.'
          }`,
          ref: s.key,
          confidence: 0.8,
        }, level);
      });

      // Opportunities
      const opps = [];
      if (worst.val < 40) {
        opps.push(`Improve ${worst.name.toLowerCase()} by incorporating papers from ${worst.key === 'temporal_span' ? 'earlier decades' : worst.key === 'field_diversity' ? 'adjacent fields' : worst.key === 'concept_diversity' ? 'research threads outside the mainstream approach' : 'lesser-cited but methodologically distinct work'}.`);
      }
      if (best.val > 70 && worst.val < 30) {
        opps.push(`The ${Math.round(best.val - worst.val)}-point gap between ${best.name} and ${worst.name} is a structural weakness. A paper that addresses this imbalance would strengthen the lineage's foundations.`);
      }
      if (opps.length > 0) html += this._renderOpportunities(opps);
    }

    return html;
  }

  _renderOrphansFallback(graphData, level) {
    const nodes = graphData.nodes || [];
    const totalNodes = nodes.length;

    // Get REAL orphan data from the DOM (populated by /api/orphans endpoint)
    // NOT from pruning_impact === 0 (which is wrong — leaf nodes aren't orphans)
    const orphanCards = document.querySelectorAll('#orphan-cards-container .orphan-card');
    const realOrphans = [];
    orphanCards.forEach(card => {
      const titleEl = card.querySelector('.orphan-concept');
      const metaEl = card.querySelector('.orphan-meta .orphan-paper');
      const title = titleEl ? titleEl.textContent.replace(/^"|"$/g, '').trim() : 'Unknown';
      const metaText = metaEl ? metaEl.textContent : '';
      const yearMatch = metaText.match(/^(\d{4})/);
      const citMatch = metaText.match(/(\d[\d,]*)\s*citations/);
      realOrphans.push({
        title,
        year: yearMatch ? yearMatch[1] : '?',
        citations: citMatch ? parseInt(citMatch[1].replace(/,/g, '')) : 0,
        paperId: card.dataset.paperId || ''
      });
    });

    const count = realOrphans.length;
    // Sort by citations descending to find the most notable orphan
    realOrphans.sort((a, b) => b.citations - a.citations);
    const topOrphan = realOrphans[0];

    let html = '';

    // Summary note
    if (count === 0) {
      html += `<div class="ai-summary-note">No orphan ideas detected in this ancestry. All papers in the lineage have been adopted by subsequent work to some degree.</div>`;
    } else if (topOrphan && topOrphan.citations > 100) {
      html += `<div class="ai-summary-note">${count} orphan paper${count > 1 ? 's' : ''} identified. "${topOrphan.title.slice(0, 50)}" has ${topOrphan.citations.toLocaleString()} citations elsewhere but was never adopted within this lineage. These represent potentially overlooked research opportunities.</div>`;
    } else {
      html += `<div class="ai-summary-note">${count} paper${count > 1 ? 's' : ''} in this ancestry introduced ideas that subsequent work did not pick up. These orphaned concepts may contain valuable but overlooked insights worth revisiting.</div>`;
    }

    // Finding 1: Most notable orphan
    if (topOrphan && topOrphan.citations > 50) {
      html += this._renderFinding({
        category: 'ABANDONED',
        text: `"${topOrphan.title.slice(0, 70)}" (${topOrphan.year}) has ${topOrphan.citations.toLocaleString()} citations outside this lineage but was never adopted within it. This idea was picked up by other research directions but ignored here.`,
        confidence: level === 'detailed' ? 0.8 : undefined,
      }, level);
    }

    // Finding 2: Opportunity assessment
    if (count > 0) {
      html += this._renderFinding({
        category: 'OPPORTUNITY',
        text: `${count} orphan paper${count > 1 ? 's' : ''} detected through trajectory analysis (declining citation trends within this lineage).${count > 5 ? ' A high orphan count suggests the field selectively ignores certain approaches.' : ' These may represent unexplored research directions worth investigating.'}`,
        confidence: level === 'detailed' ? 0.7 : undefined,
      }, level);
    }

    if (level === 'detailed' && count > 1) {
      // Unseen connections: specific orphan papers
      const unseenConns = realOrphans.slice(0, 3).map(o =>
        `"${o.title.slice(0, 60)}" (${o.year}) has ${o.citations.toLocaleString()} citations externally but no descendants within this lineage.`
      );
      if (unseenConns.length > 0) html += this._renderUnseenConnections(unseenConns);

      html += this._renderOpportunities([
        'Revisit orphan papers with high external citations. Their ideas may be applicable but were overlooked by this research direction.',
        count > 5 ? 'The number of orphaned ideas suggests this field has a narrow methodological focus. Cross-pollination from orphan approaches could yield novel insights.' : null
      ].filter(Boolean));
    }

    return html;
  }

  _renderCoverageFallback(graphData, level) {
    const nodes = graphData.nodes || [];
    const total = nodes.length;
    const tiers = { 1: 0, 2: 0, 3: 0, 4: 0 };
    nodes.forEach(n => {
      const t = n.text_tier || 4;
      tiers[t] = (tiers[t] || 0) + 1;
    });
    const fullText = tiers[1] || 0;
    const abstracts = (tiers[2] || 0) + (tiers[3] || 0);
    const titleOnly = tiers[4] || 0;
    const abstractPct = total ? Math.round((fullText + abstracts) / total * 100) : 0;
    const fullPct = total ? Math.round(fullText / total * 100) : 0;

    let html = '';

    // Summary note
    const coverageSummary = abstractPct > 80
      ? `Strong data coverage at ${abstractPct}%. Most edge classifications in this graph are based on abstract or full-text analysis, providing high confidence in mutation type and citation intent labels.`
      : abstractPct > 50
        ? `Moderate data coverage at ${abstractPct}%. ${100 - abstractPct}% of papers have title-only data, meaning their edge classifications are speculative. Focus on insights from the well-covered papers.`
        : `Low data coverage at ${abstractPct}%. Over half of all papers have title-only data. Edge classifications and mutation types should be treated with caution. Insights are more reliable for recent papers with available abstracts.`;
    html += `<div class="ai-summary-note">${this._esc(coverageSummary)}</div>`;

    html += this._renderFinding({
      category: abstractPct > 80 ? 'HIGH CONFIDENCE' : abstractPct > 50 ? 'MODERATE CONFIDENCE' : 'LOW CONFIDENCE',
      text: `${abstractPct}% of papers have abstract or better coverage. ${fullPct}% have full text. Edge classifications for the remaining ${100 - abstractPct}% are based on titles only and should be treated as speculative.`,
      comparison: {
        thisValue: abstractPct, avgValue: 70,
        thisLabel: 'This graph', avgLabel: 'Ideal', note: abstractPct > 70 ? 'Good coverage' : 'Below ideal'
      },
      confidence: level === 'detailed' ? 0.95 : undefined,
    }, level);

    // Temporal coverage gap — correlate age with data quality
    const pre2000 = nodes.filter(n => n.year && n.year < 2000);
    const post2015 = nodes.filter(n => n.year && n.year >= 2015);
    const pre2000TitleOnly = pre2000.filter(n => (n.text_tier || 4) === 4).length;
    const post2015HasAbstract = post2015.filter(n => (n.text_tier || 4) <= 3).length;
    const pre2000TitlePct = pre2000.length > 0 ? Math.round(pre2000TitleOnly / pre2000.length * 100) : 0;
    const post2015AbstractPct = post2015.length > 0 ? Math.round(post2015HasAbstract / post2015.length * 100) : 0;

    if (pre2000.length > 3 && pre2000TitlePct > 70) {
      html += this._renderFinding({
        category: 'TEMPORAL COVERAGE GAP',
        text: `Papers before 2000 are ${pre2000TitlePct}% title-only (${pre2000TitleOnly} of ${pre2000.length}). Papers after 2015 are ${post2015AbstractPct}% abstract-available. Edges to the oldest (and often most foundational) ancestors are the least reliable. Insights about this lineage's deep roots should be treated with extra caution.`,
        confidence: level === 'detailed' ? 0.9 : undefined,
      }, level);
    }

    if (level === 'detailed') {
      html += this._renderFinding({
        category: 'GAP',
        text: `${titleOnly} papers (${total ? Math.round(titleOnly / total * 100) : 0}%) have title-only data. Edges involving these papers have low confidence classifications.`,
        confidence: 0.9,
      }, level);

      // Micro-viz: coverage tiers
      html += this._renderMicroViz([
        { label: 'Full text', pct: fullPct },
        { label: 'Abstract', pct: total ? Math.round(abstracts / total * 100) : 0 },
        { label: 'Title only', pct: total ? Math.round(titleOnly / total * 100) : 0 },
      ]);

      html += this._renderOpportunities([
        'Papers with title-only data can be improved by fetching full text from arXiv or Europe PMC. This would increase classification confidence.',
        pre2000TitlePct > 70 ? `The ${pre2000.length} pre-2000 papers are almost entirely title-only. Prioritizing abstract/full-text retrieval for these foundational papers would significantly improve edge classification accuracy for the lineage's deepest roots.` : null
      ].filter(Boolean));
    }

    return html;
  }

  _renderPruningFallback(pruneResult, level) {
    if (!pruneResult) return '';
    const pct = (pruneResult.impact_percentage || 0).toFixed(1);
    const collapsed = pruneResult.collapsed_count || 0;
    const survived = pruneResult.survived_count || 0;
    const total = collapsed + survived;

    if (level === 'detailed') {
      let html = `<div class="ai-highlight-box">Removing the selected paper causes ${pct}% of the graph to collapse. ${survived} papers survive through independent lineages.</div>`;

      html += this._renderFinding({
        category: 'FRAGILITY',
        text: `${collapsed} papers (${pct}%) lose their foundation. This paper is ${parseInt(pct) > 50 ? 'a load-bearing wall' : 'moderately important'} in this lineage.`,
        comparison: {
          thisValue: parseInt(pct), avgValue: 25,
          thisLabel: 'This removal', avgLabel: 'Typical bottleneck', note: parseInt(pct) > 50 ? 'Critical dependency' : ''
        },
        confidence: 0.9,
      }, 'detailed');

      html += this._renderFinding({
        category: 'SCALE',
        text: `${survived} papers survive through independent lineages. These represent the field's alternative intellectual foundations.`,
        confidence: 0.85,
      }, 'detailed');

      // Survival paths micro-viz
      html += this._renderMicroViz([
        { label: 'Collapsed', pct: parseInt(pct) },
        { label: 'Survived', pct: 100 - parseInt(pct) },
      ]);

      html += this._renderOpportunities([
        'Research that provides alternative theoretical foundations to this paper would reduce the lineage\'s structural fragility.'
      ]);

      return html;
    }

    return `<div class="ai-finding">
      <div class="ai-finding-label">${parseInt(pct) > 50 ? 'FRAGILITY' : 'BOTTLENECK'}</div>
      <div class="ai-finding-text">Removing this paper causes ${pct}% of the graph to collapse. ${collapsed} papers lose their foundation while ${survived} survive through independent lineages.</div>
    </div>`;
  }

  _findNodeTitle(nodeId, nodes) {
    if (!nodeId || !nodes) return 'Unknown';
    const n = nodes.find(n => n.id === nodeId);
    return n ? n.title || 'Unknown' : 'Unknown';
  }

  // ═══════ TEXT SELECTION → DISCUSS ═══════

  _initTextSelection() {
    let tooltip = null;

    document.addEventListener('mouseup', (e) => {
      // Remove existing tooltip — but NOT if user is clicking on it
      if (tooltip && !tooltip.contains(e.target)) { tooltip.remove(); tooltip = null; }

      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (!text || text.length < 10) return;

      // Only trigger inside AI interpretation containers or window bodies
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer.parentElement?.closest('.ai-interpretation, .arivu-window-body, .ai-finding, .genealogy-panel, .genealogy-section, .narrative-chapters, .contradiction-callout, .pivotal-card, .abandoned-card');
      if (!container) return;

      // Create tooltip
      const rect = range.getBoundingClientRect();
      tooltip = document.createElement('div');
      tooltip.className = 'discuss-tooltip';
      tooltip.textContent = '💬 Discuss';
      tooltip.style.left = (rect.left + rect.width / 2) + 'px';
      // Position below selection; if near bottom of viewport, position above instead
      const tooltipHeight = 32;
      if (rect.bottom + 8 + tooltipHeight > window.innerHeight) {
        tooltip.style.top = (rect.top - tooltipHeight - 4) + 'px';
      } else {
        tooltip.style.top = (rect.bottom + 8) + 'px';
      }
      document.body.appendChild(tooltip);

      tooltip.addEventListener('click', () => {
        // Check for arivu-window first, then genealogy dialog
        const windowEl = container.closest('.arivu-window');
        const dialogEl = container.closest('#genealogy-modal');
        this._openDiscuss(text, windowEl || dialogEl || null);
        tooltip.remove();
        tooltip = null;
        selection.removeAllRanges();
      });
    });

    // Remove tooltip on click elsewhere (but not when clicking the tooltip itself)
    document.addEventListener('mousedown', (e) => {
      if (tooltip && !tooltip.contains(e.target)) { tooltip.remove(); tooltip = null; }
    });
  }

  _openDiscuss(contextText, windowEl) {
    if (windowEl) {
      // Open discuss overlay inside the window
      this._showDiscussOverlay(contextText, windowEl);
    } else {
      // Open sidebar chat with context
      this._openChatWithContext(contextText);
    }
  }

  _showDiscussOverlay(contextText, windowEl) {
    // Remove any existing overlay in this window
    const existing = windowEl.querySelector('.discuss-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'discuss-overlay';
    overlay.innerHTML = `
      <div class="discuss-context">"${this._esc(contextText.slice(0, 200))}"</div>
      <div class="discuss-messages" id="discuss-msgs"></div>
      <div class="discuss-input-row">
        <input type="text" class="discuss-input" placeholder="Ask about this..." aria-label="Discuss this text">
        <button class="discuss-send-btn" aria-label="Send">&#x2192;</button>
      </div>
      <button class="discuss-back-btn">Back</button>
    `;

    // Find the appropriate body container (arivu-window-body or genealogy-content for dialogs)
    const body = windowEl.querySelector('.arivu-window-body') || windowEl.querySelector('#genealogy-content') || windowEl;
    body.style.position = 'relative';
    body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => overlay.classList.add('visible'));

    // Back button
    overlay.querySelector('.discuss-back-btn').addEventListener('click', () => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 300);
    });

    // Send message
    const input = overlay.querySelector('.discuss-input');
    const send = overlay.querySelector('.discuss-send-btn');
    const msgs = overlay.querySelector('#discuss-msgs');

    const sendMsg = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';

      msgs.innerHTML += `<div style="text-align:right;margin-bottom:6px;font-size:0.82rem;color:var(--text-primary)">${this._esc(text)}</div>`;
      msgs.scrollTop = msgs.scrollHeight;

      try {
        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            context: contextText,
            graph_summary: window._arivuGraph?.metadata || {},
            current_view: { type: 'discuss' }
          })
        });
        const data = await resp.json();
        msgs.innerHTML += `<div style="margin-bottom:8px;font-size:0.82rem;color:var(--text-secondary)">${this._esc(data.response || 'No response.')}</div>`;
      } catch {
        msgs.innerHTML += `<div style="margin-bottom:8px;font-size:0.82rem;color:var(--danger)">Failed to get response.</div>`;
      }
      msgs.scrollTop = msgs.scrollHeight;
    };

    send.addEventListener('click', sendMsg);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });
    input.focus();
  }

  _openChatWithContext(contextText) {
    // Open sidebar chat panel
    const chatBtn = document.querySelector('.sidebar-btn[data-panel="panel-chat"]');
    if (chatBtn) chatBtn.click();

    // Pre-fill chat input with context
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.value = `Regarding: "${contextText.slice(0, 100)}..." — `;
      chatInput.focus();
    }
  }

  // ═══════ HELPERS ═══════

  _getGraphId() {
    return window._arivuGraph?.metadata?.graph_id || window._graphLoader?._graphData?.metadata?.graph_id;
  }

  _esc(s) {
    const div = document.createElement('div');
    div.textContent = String(s || '');
    return div.innerHTML;
  }

  /** Extract a readable string from any value — handles LLM returning objects instead of strings */
  _toText(val) {
    if (typeof val === 'string') return val;
    if (val == null) return '';
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (typeof val === 'object') {
      // Try common LLM response keys
      for (const key of ['text', 'suggestion', 'description', 'title', 'content', 'message', 'summary', 'insight', 'finding', 'fact', 'note', 'detail', 'explanation']) {
        if (typeof val[key] === 'string' && val[key].length > 0) return val[key];
      }
      // Recursively try first string value
      for (const v of Object.values(val)) {
        if (typeof v === 'string' && v.length > 5) return v;
      }
      // Last resort: skip non-string keys like confidence/score
      const strs = Object.values(val).filter(v => typeof v === 'string' && v.length > 5);
      if (strs.length > 0) return strs[0];
    }
    return JSON.stringify(val);
  }

  _formatPct(val) {
    if (typeof val === 'number') return val.toFixed(0) + '%';
    return String(val);
  }

  _loadingSkeleton() {
    return `<div class="ai-loading">
      <div class="skeleton-line"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line"></div>
    </div>`;
  }
}

// ═══════ INITIALIZE ═══════

document.addEventListener('DOMContentLoaded', () => {
  if (!document.querySelector('.tool-layout-v2')) return;
  window.ArivuAI = new ArivuAI();
});
