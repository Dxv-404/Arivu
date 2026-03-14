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

    this._setupListeners();
    this._setupKeyboard();
  }

  _setupListeners() {
    window.addEventListener('arivu:node-clicked', (e) => {
      if (this.state === 'animating') return;
      const { nodeId } = e.detail;
      if (this.state === 'pruned') { this.reset(); return; }

      if (this.pruneSet.has(nodeId)) {
        this.pruneSet.delete(nodeId);
        this.graph.nodeGroup.select(`g.node[data-id="${nodeId}"]`).classed('prune-selected', false);
      } else {
        this.pruneSet.add(nodeId);
        this.graph.nodeGroup.select(`g.node[data-id="${nodeId}"]`).classed('prune-selected', true);
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

    // Snapshot DNA before pruning
    if (window._dnaChart) window._dnaChart.takeSnapshot();

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

      // Update right panel
      if (window._rightPanel) window._rightPanel.renderPruningStats(result);
      if (window._dnaChart && result.dna_after) window._dnaChart.renderComparison(result.dna_after);

    } catch (err) {
      console.error('Prune request failed:', err);
      this.state = 'idle';
    }
  }

  async _animateCascade(result) {
    const delay = ms => new Promise(r => setTimeout(r, this._shouldAnimate() ? ms : 0));

    // Step 1: mark pruned nodes
    for (const nodeId of result.pruned_ids) {
      this.graph.nodeGroup.select(`g.node[data-id="${nodeId}"]`)
        .select('circle')
        .transition().duration(300)
        .attr('fill', '#1a1a2e')
        .attr('stroke', '#111')
        .attr('stroke-width', 1);
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
        this.graph.nodeGroup.select(`g.node[data-id="${nodeId}"]`)
          .select('circle')
          .transition().duration(400)
          .attr('fill', '#7f1d1d')
          .attr('stroke', '#EF4444')
          .style('opacity', 0.25);
        this.graph.nodeGroup.select(`g.node[data-id="${nodeId}"]`)
          .transition().duration(400).style('opacity', 0.2);

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
      this.graph.nodeGroup.select(`g.node[data-id="${survivor.paper_id}"]`)
        .select('circle')
        .transition().duration(300)
        .attr('stroke', '#22C55E').attr('stroke-width', 3);
    }
  }

  reset() {
    this.state = 'idle';
    this.pruneSet.clear();
    this.currentResult = null;

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

    this._updatePill();
    document.getElementById('prune-stats-panel')?.classList.add('hidden');
    if (window._dnaChart) window._dnaChart.resetComparison();
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
}
