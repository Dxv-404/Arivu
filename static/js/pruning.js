/**
 * static/js/pruning.js
 * PruningSystem — multi-node selection and cascading collapse animation.
 * Wires up to ArivuGraph via custom events.
 */

class PruningSystem {
  constructor(graph) {
    this.graph = graph;
    this.state = 'idle';       // idle | selecting | animating | pruned
    this.pruneSet = new Set();
    this.currentResult = null;
    this._graphSeedId = graph.metadata.seed_paper_id;
    this._pillMutated = false; // Track whether _showPrunedState replaced pill HTML

    // Capture the pill's original HTML once at construction time.
    // reset() restores this instead of duplicating the template string in JS.
    const pill = document.getElementById('prune-pill');
    this._originalPillHTML = pill ? pill.innerHTML : '';

    this._setupListeners();
    this._setupKeyboard();
  }

  _setupListeners() {
    window.addEventListener('arivu:node-clicked', (e) => {
      if (this.state === 'animating') return;
      const { nodeId } = e.detail;
      if (this.state === 'pruned') { this.reset(); return; }

      // Select node from either force graph or tree layout
      const nodeEl = this._selectNodeEl(nodeId);
      if (this.pruneSet.has(nodeId)) {
        this.pruneSet.delete(nodeId);
        if (nodeEl) nodeEl.classed('prune-selected', false);
      } else {
        this.pruneSet.add(nodeId);
        if (nodeEl) nodeEl.classed('prune-selected', true);
      }

      this.state = this.pruneSet.size > 0 ? 'selecting' : 'idle';
      this._updatePill();
    });

    window.addEventListener('arivu:reset-prune', () => this.reset());

    document.getElementById('prune-execute-btn')?.addEventListener('click', () => this.execute());
    document.getElementById('prune-clear-btn')?.addEventListener('click', () => this.reset());
  }

  _setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state !== 'idle') { this.reset(); }
      if (e.key === 'Enter' && this.state === 'selecting') { this.execute(); }
    });
  }

  async execute() {
    if (this.pruneSet.size === 0 || this.state === 'animating') return;
    this.state = 'animating';
    this._hidePill();

    // Phase C #108: Dispatch prune start event for Athena
    const prunedIds = [...this.pruneSet];
    const prunedNode = this.graph.allNodes?.find(n => n.id === prunedIds[0]);
    document.dispatchEvent(new CustomEvent('athena:graph:prune', {
      detail: {
        phase: 'start',
        pruned_paper_id: prunedIds[0] || '',
        pruned_paper_title: prunedNode?.title || '',
      }
    }));

    // Snapshot DNA before pruning (guard against missing chart)
    if (window._dnaChart && typeof window._dnaChart.takeSnapshot === 'function') {
      window._dnaChart.takeSnapshot();
    }

    try {
      const resp = await fetch('/api/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paper_ids: [...this.pruneSet],
          graph_seed_id: this._graphSeedId
        })
      });
      const result = await resp.json();

      if (result.error) {
        console.error('Prune error:', result.error);
        this.state = 'idle';
        return;
      }

      this.currentResult = result;
      await this._animateCascade(result);
      this.state = 'pruned';
      this._showPrunedState(result);

      // Phase C #108: Dispatch prune complete event for Athena
      document.dispatchEvent(new CustomEvent('athena:graph:prune', {
        detail: {
          phase: 'complete',
          pruned_paper_id: prunedIds[0] || '',
          pruned_paper_title: prunedNode?.title || '',
          collapsed_nodes: (result.collapsed_nodes || []).slice(0, 50),
          surviving_nodes: (result.surviving_nodes || []).slice(0, 20),
          impact_percentage: result.impact_percentage || 0,
          collapsed_count: result.collapsed_count || (result.collapsed_nodes || []).length,
        }
      }));

      // Update right panel
      if (window._rightPanel) window._rightPanel.renderPruningStats(result);
      if (window._dnaChart && result.dna_after) window._dnaChart.renderComparison(result.dna_after);

      // Fire event for graph window pruning panel
      window._lastPruneResult = result;
      window.dispatchEvent(new CustomEvent('arivu:prune-result', { detail: result }));

      // Apply prune visuals to tree layout (if it exists)
      if (window._treeLayout?.applyPruneVisual) {
        const collapsedIds = new Set((result.collapsed_nodes || []).map(n => n.paper_id || n.id || n));
        const survivedIds = new Set((result.surviving_nodes || []).map(n => n.paper_id || n.id || n));
        window._treeLayout.applyPruneVisual(collapsedIds, survivedIds);
      }

    } catch (err) {
      console.error('Prune request failed:', err);
      this.state = 'idle';
    }
  }

  async _animateCascade(result) {
    const delay = ms => new Promise(r => setTimeout(r, this._shouldAnimate() ? ms : 0));

    // Step 1: mark pruned nodes (handles both circle for force and rect for tree)
    for (const nodeId of result.pruned_ids) {
      const nodeEl = this._selectNodeEl(nodeId);
      if (nodeEl) {
        this._selectShape(nodeEl)
          .transition().duration(300)
          .attr('fill', '#1a1a2e')
          .attr('stroke', '#111')
          .attr('stroke-width', 1);
      }
    }
    await delay(200);

    // Step 2: cascade by BFS level
    const byLevel = {};
    for (const c of (result.collapsed_nodes || [])) {
      const lvl = c.bfs_level || 0;
      (byLevel[lvl] = byLevel[lvl] || []).push(c.paper_id);
    }

    let totalCollapsed = 0;
    for (const level of Object.keys(byLevel).sort((a,b) => a-b)) {
      await delay(200);
      for (const nodeId of byLevel[level]) {
        const nodeEl = this._selectNodeEl(nodeId);
        if (nodeEl) {
          this._selectShape(nodeEl)
            .transition().duration(400)
            .attr('fill', '#7f1d1d')
            .attr('stroke', '#EF4444')
            .style('opacity', 0.25);
          nodeEl.transition().duration(400).style('opacity', 0.2);
        }

        this.graph.edgeElements
          .filter(d => {
            const src = typeof d.source === 'object' ? d.source.id : d.source;
            const tgt = typeof d.target === 'object' ? d.target.id : d.target;
            return tgt === nodeId || src === nodeId;
          })
          .transition().duration(300)
          .attr('stroke', '#EF4444').attr('stroke-opacity', 0.15);

        totalCollapsed++;
      }
      this._updateCounter(totalCollapsed, result.total_nodes);
    }

    // Step 3: flash survival paths
    await delay(300);
    for (const survivor of (result.surviving_nodes || [])) {
      const path = survivor.survival_path || [];
      for (let i = 0; i < path.length - 1; i++) {
        const fromId = path[i], toId = path[i+1];
        this.graph.edgeElements
          .filter(d => {
            const src = typeof d.source === 'object' ? d.source.id : d.source;
            const tgt = typeof d.target === 'object' ? d.target.id : d.target;
            return (src === fromId && tgt === toId) || (src === toId && tgt === fromId);
          })
          .transition().duration(400)
          .attr('stroke', '#22C55E').attr('stroke-opacity', 0.9).attr('stroke-width', 3);
      }
      const survNodeEl = this._selectNodeEl(survivor.paper_id);
      if (survNodeEl) {
        this._selectShape(survNodeEl)
          .transition().duration(300)
          .attr('stroke', '#22C55E').attr('stroke-width', 3);
      }
    }
  }

  reset() {
    this.state = 'idle';
    this.pruneSet.clear();
    this.currentResult = null;

    // Reset force-graph nodes
    this.graph.nodeGroup.selectAll('g.node')
      .classed('prune-selected', false)
      .transition().duration(500)
      .style('opacity', 1)
      .select('circle')
      .attr('fill', d => this.graph._nodeColor(d))
      .attr('stroke', d => d.is_bottleneck ? '#D4A843' : '#2D3748')
      .attr('stroke-width', d => d.is_bottleneck ? 3 : 1.5)
      .style('opacity', 1);

    this.graph.edgeElements
      .transition().duration(500)
      .attr('stroke', d => this.graph._edgeColor(d))
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', d => 0.5 + (d.similarity_score||0) * 3);

    // Also reset tree nodes if tree layout exists
    if (window._treeLayout?.resetPruneVisual) {
      window._treeLayout.resetPruneVisual();
    } else if (window._treeLayout && window._treeLayout.nodeGroup) {
      window._treeLayout.nodeGroup.selectAll('g.tree-node')
        .classed('prune-selected', false)
        .transition().duration(500)
        .style('opacity', 1)
        .select('rect')
        .attr('fill', d => d.depth === 0 ? '#374151' : '#9CA3AF')
        .attr('stroke', d => d.depth === 0 ? '#111827' : '#6B7280')
        .attr('stroke-width', d => d.depth === 0 ? 1.5 : 0.5)
        .style('opacity', 1);
    }

    // Only restore pill HTML if _showPrunedState() actually mutated it.
    // This prevents unnecessary DOM destruction and listener re-attachment
    // when reset() is called from idle state (e.g. Escape key, arivu:reset-prune).
    if (this._pillMutated) {
      const pill = document.getElementById('prune-pill');
      if (pill) {
        pill.innerHTML = this._originalPillHTML;
        pill.classList.add('hidden');
        // Re-attach listeners since innerHTML replacement destroyed the old elements
        document.getElementById('prune-execute-btn')?.addEventListener('click', () => this.execute());
        document.getElementById('prune-clear-btn')?.addEventListener('click', () => this.reset());
      }
      this._pillMutated = false;
    } else {
      this._updatePill();
    }

    document.getElementById('prune-stats-panel')?.classList.add('hidden');
    if (window._dnaChart) window._dnaChart.resetComparison();

    // Notify window manager that pruning was reset (hides pruning panel in graph window)
    window.dispatchEvent(new CustomEvent('arivu:prune-reset'));

    // Phase C #108: Dispatch prune reset event for Athena
    document.dispatchEvent(new CustomEvent('athena:graph:prune', {
      detail: { phase: 'reset' }
    }));
  }

  _updatePill() {
    const pill = document.getElementById('prune-pill');
    const count = document.getElementById('prune-pill-count');
    if (!pill) return;
    if (this.pruneSet.size === 0) { pill.classList.add('hidden'); }
    else {
      pill.classList.remove('hidden');
      if (count) count.textContent = this.pruneSet.size;
    }
  }
  _hidePill() { document.getElementById('prune-pill')?.classList.add('hidden'); }

  _showPrunedState(result) {
    const pct = result.impact_percentage?.toFixed(1);
    const pill = document.getElementById('prune-pill');
    if (pill) {
      pill.innerHTML = `${pct}% of graph collapsed · <button id="prune-reset-btn">Reset</button>`;
      pill.classList.remove('hidden');
      document.getElementById('prune-reset-btn')?.addEventListener('click', () => this.reset());
      this._pillMutated = true;  // Track that we replaced innerHTML
    }
  }

  _updateCounter(collapsed, total) {
    const pct = total > 0 ? (collapsed / total * 100).toFixed(1) : 0;
    const el = document.getElementById('prune-stat-collapsed');
    if (el) el.textContent = `${collapsed} collapsed (${pct}%)`;
  }

  _shouldAnimate() {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
           !document.body.classList.contains('no-animations');
  }

  /** Select a node element from either force graph or tree layout */
  _selectNodeEl(nodeId) {
    // Try force graph first
    let el = this.graph.nodeGroup.select(`g.node[data-id="${nodeId}"]`);
    if (!el.empty()) return el;
    // Try tree layout
    if (window._treeLayout && window._treeLayout.nodeGroup) {
      el = window._treeLayout.nodeGroup.select(`g.tree-node[data-id="${nodeId}"]`);
      if (!el.empty()) return el;
    }
    return null;
  }

  /** Get the shape element (circle for force, rect for tree) inside a node group */
  _selectShape(nodeGroup) {
    const circle = nodeGroup.select('circle');
    if (!circle.empty()) return circle;
    const rect = nodeGroup.select('rect');
    if (!rect.empty()) return rect;
    return nodeGroup; // fallback
  }
}
