/**
 * static/js/graph.js
 * ArivuGraph — D3.js force-directed citation graph.
 * Handles: rendering, zoom, node/edge styling, keyboard nav, semantic zoom clustering.
 * Does NOT handle: pruning (pruning.js), right panel charts (panels.js).
 */

class ArivuGraph {
  constructor(container, graphData) {
    this._semanticZoom = null;  // Phase 4 backport §0.10
    this.container = container;
    this.allNodes = graphData.nodes || [];
    this.allEdges = graphData.edges || [];
    this.metadata = graphData.metadata || {};

    this.visibleNodeIds = new Set();
    this.expandedNodeIds = new Set();
    this.selectedNodes = new Set();
    this.mode = 'idle'; // idle | selecting | animating | pruned | scripted

    this.svg = null;
    this.zoomGroup = null;
    this.edgeGroup = null;
    this.nodeGroup = null;
    this.simulation = null;
    this.edgeElements = null;
    this.nodeElements = null;
    this.zoom = null;
    this._tooltip = null;

    this.init();
  }

  init() {
    const { width, height } = this.container.getBoundingClientRect();

    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('role', 'img')
      .attr('aria-label', `Citation graph for ${this.metadata.seed_paper_title || 'paper'}`);

    this.zoomGroup = this.svg.append('g').attr('class', 'zoom-group');

    this._defineArrowMarkers();

    this.edgeGroup = this.zoomGroup.append('g').attr('class', 'edges');
    this.nodeGroup = this.zoomGroup.append('g').attr('class', 'nodes');

    this.zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        this.zoomGroup.attr('transform', event.transform);
        this._handleZoomLevelChange(event.transform.k);
      });

    this.svg.call(this.zoom);

    this.simulation = d3.forceSimulation()
      .force('link', d3.forceLink()
        .id(d => d.id)
        .distance(d => 60 + (1 - (d.similarity_score || 0.5)) * 80)
      )
      .force('charge', d3.forceManyBody()
        .strength(d => -80 - Math.log((d.citation_count || 1) + 1) * 10)
      )
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide()
        .radius(d => this._nodeRadius(d) + 8)
      )
      .alphaDecay(0.02)
      .velocityDecay(0.4);

    this._tooltip = document.getElementById('graph-tooltip');
    this._tooltipSystem = new TooltipSystem(this._tooltip);

    this._initialRender();
  }

  _initialRender() {
    // Show ALL nodes upfront — the full citation ancestry
    this.allNodes.forEach(n => this.visibleNodeIds.add(n.id));

    // Adapt force parameters for the graph size
    this._tuneSimulation(this.allNodes.length);

    this._render();

    // Auto-zoom to fit entire graph after layout stabilizes
    setTimeout(() => this._zoomToFit(), 2500);
  }

  _tuneSimulation(nodeCount) {
    const { width, height } = this.container.getBoundingClientRect();

    if (nodeCount > 200) {
      // Large graph: strong repulsion + radial depth rings for structure
      this.simulation
        .force('charge', d3.forceManyBody()
          .strength(d => -180 - Math.log((d.citation_count || 1) + 1) * 15)
          .distanceMax(800)
        )
        .force('link', d3.forceLink()
          .id(d => d.id)
          .distance(d => 90 + (1 - (d.similarity_score || 0.5)) * 110)
          .strength(0.3)
        )
        .force('center', d3.forceCenter(width / 2, height / 2).strength(0.03))
        .force('collision', d3.forceCollide()
          .radius(d => this._nodeRadius(d) + 3)
          .strength(0.6)
        )
        .force('radial', d3.forceRadial(
          d => (d.depth || 0) * 180 + (d.is_seed ? 0 : 60),
          width / 2, height / 2
        ).strength(0.35))
        .alphaDecay(0.012)
        .velocityDecay(0.35);

    } else if (nodeCount > 60) {
      // Medium graph: moderate tuning
      this.simulation
        .force('charge', d3.forceManyBody()
          .strength(d => -120 - Math.log((d.citation_count || 1) + 1) * 12)
        )
        .force('link', d3.forceLink()
          .id(d => d.id)
          .distance(d => 75 + (1 - (d.similarity_score || 0.5)) * 100)
        )
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide()
          .radius(d => this._nodeRadius(d) + 5)
        )
        .force('radial', d3.forceRadial(
          d => (d.depth || 0) * 150,
          width / 2, height / 2
        ).strength(0.2))
        .alphaDecay(0.018)
        .velocityDecay(0.38);
    }
    // Small graphs (<= 60 nodes): keep the default init() forces
  }

  _zoomToFit() {
    const nodes = this.allNodes.filter(n => this.visibleNodeIds.has(n.id));
    if (nodes.length === 0) return;

    const xs = nodes.map(n => n.x || 0);
    const ys = nodes.map(n => n.y || 0);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const padding = 80;

    const { width, height } = this.container.getBoundingClientRect();
    const graphWidth = (maxX - minX) + 2 * padding;
    const graphHeight = (maxY - minY) + 2 * padding;

    if (graphWidth <= 0 || graphHeight <= 0) return;

    const scale = Math.min(width / graphWidth, height / graphHeight, 1.5);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    this.svg.transition().duration(1000).ease(d3.easeCubicOut).call(
      this.zoom.transform,
      d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-centerX, -centerY)
    );
  }

  _render() {
    const visibleNodes = this.allNodes.filter(n => this.visibleNodeIds.has(n.id));
    const nodeIdSet = new Set(visibleNodes.map(n => n.id));
    const visibleEdges = this.allEdges.filter(e =>
      nodeIdSet.has(typeof e.source === 'object' ? e.source.id : e.source) &&
      nodeIdSet.has(typeof e.target === 'object' ? e.target.id : e.target)
    );

    // ── EDGES ──
    this.edgeElements = this.edgeGroup
      .selectAll('line.edge')
      .data(visibleEdges, d => `${typeof d.source === 'object' ? d.source.id : d.source}-${typeof d.target === 'object' ? d.target.id : d.target}`)
      .join(
        enter => enter.append('line')
          .attr('class', d => `edge edge-${d.mutation_type || 'unknown'}`)
          .attr('stroke', d => this._edgeColor(d))
          .attr('stroke-width', d => 0.5 + (d.similarity_score || 0) * 3)
          .attr('stroke-opacity', 0.4)
          .attr('marker-end', d => `url(#arrow-${d.mutation_type || 'unknown'})`)
          .on('mouseover', (event, d) => this._tooltipSystem.showEdgeTooltip(event, d))
          .on('mouseout', () => this._tooltipSystem.hide()),
        update => update,
        exit => exit.remove()
      );

    // ── NODES ──
    this.nodeElements = this.nodeGroup
      .selectAll('g.node')
      .data(visibleNodes, d => d.id)
      .join(
        enter => {
          const g = enter.append('g')
            .attr('class', 'node')
            .attr('data-id', d => d.id)
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('aria-label', d => `${d.title}, ${d.year}, ${(d.citation_count||0).toLocaleString()} citations`)
            .call(d3.drag()
              .on('start', this._dragStarted.bind(this))
              .on('drag', this._dragged.bind(this))
              .on('end', this._dragEnded.bind(this))
            )
            .on('click', (event, d) => this._handleNodeClick(event, d))
            .on('dblclick', (event, d) => { if (d.url) window.open(d.url, '_blank'); })
            .on('mouseover', (event, d) => this._tooltipSystem.showNodeTooltip(event, d))
            .on('mouseout', () => this._tooltipSystem.hide())
            .on('keydown', (event, d) => this._handleNodeKeydown(event, d));

          // Main circle
          g.append('circle')
            .attr('r', d => this._nodeRadius(d))
            .attr('fill', d => this._nodeColor(d))
            .attr('stroke', d => d.is_bottleneck ? '#D4A843' : '#2D3748')
            .attr('stroke-width', d => d.is_bottleneck ? 3 : 1.5)
            .attr('stroke-dasharray', d => d.is_retracted ? '4,2' : 'none');

          // Seed paper ring
          g.filter(d => d.is_seed)
            .append('circle')
            .attr('r', d => this._nodeRadius(d) + 5)
            .attr('fill', 'none')
            .attr('stroke', '#D4A843')
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '4,2');

          // Bottleneck impact badge
          g.filter(d => d.is_bottleneck && d.pruning_impact)
            .append('text')
            .attr('class', 'impact-badge')
            .attr('text-anchor', 'middle')
            .attr('dy', d => -this._nodeRadius(d) - 4)
            .attr('font-size', '9px')
            .attr('fill', '#D4A843')
            .attr('pointer-events', 'none')
            .text(d => `${d.pruning_impact}▸`);

          return g;
        },
        update => update,
        exit => exit.remove()
      );

    this.simulation.nodes(visibleNodes);
    this.simulation.force('link').links(visibleEdges);
    this.simulation.alpha(0.3).restart();

    this.simulation.on('tick', () => {
      this.edgeElements
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);

      this.nodeElements.attr('transform', d => `translate(${d.x || 0},${d.y || 0})`);
    });
  }

  _nodeRadius(d) {
    return 4 + Math.log(Math.max(d.citation_count || 1, 1)) * 2.5;
  }

  _nodeColor(d) {
    const field = (d.fields_of_study || [])[0] || 'Other';
    const colors = {
      'Computer Science': 'var(--field-cs)',
      'Biology': 'var(--field-bio)',
      'Medicine': 'var(--field-bio)',
      'Physics': 'var(--field-physics)',
      'Chemistry': 'var(--field-chem)',
      'Economics': 'var(--field-econ)',
      'Mathematics': 'var(--field-math)',
    };
    return colors[field] || 'var(--field-other)';
  }

  _edgeColor(d) {
    const colors = {
      adoption:       '#3B82F6',
      generalization: '#06B6D4',
      specialization: '#8B5CF6',
      hybridization:  '#F59E0B',
      contradiction:  '#EF4444',
      revival:        '#22C55E',
      incidental:     '#475569',
      unknown:        '#374151',
    };
    return colors[d.mutation_type] || '#475569';
  }

  _defineArrowMarkers() {
    const defs = this.svg.append('defs');
    const mutationTypes = ['adoption','generalization','specialization','hybridization',
                           'contradiction','revival','incidental','unknown'];
    const colors = {
      adoption:'#3B82F6', generalization:'#06B6D4', specialization:'#8B5CF6',
      hybridization:'#F59E0B', contradiction:'#EF4444', revival:'#22C55E',
      incidental:'#475569', unknown:'#374151'
    };
    for (const type of mutationTypes) {
      defs.append('marker')
        .attr('id', `arrow-${type}`)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 18)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', colors[type] || '#475569');
    }
  }

  _handleZoomLevelChange(k) {
    if (k < 0.4 && this._semanticZoom && this.visibleNodeIds.size > 50) {
      this._semanticZoom.renderClusters();
    } else if (k >= 0.4 && this._semanticZoom) {
      this._semanticZoom.removeClusterOverlay();
    }
  }

  _offerExpandOption() {
    const hidden = this.allNodes.filter(n => !this.visibleNodeIds.has(n.id));
    if (hidden.length === 0) return;
    const hint = document.getElementById('keyboard-hint');
    if (hint) hint.classList.remove('hidden');
  }

  expandNode(nodeId) {
    const allEdges = this.allEdges;
    const children = this.allNodes
      .filter(n => allEdges.some(e => {
        const src = typeof e.source === 'object' ? e.source.id : e.source;
        return src === nodeId && n.id === (typeof e.target === 'object' ? e.target.id : e.target);
      }))
      .filter(n => !this.visibleNodeIds.has(n.id))
      .sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0))
      .slice(0, 15);

    if (children.length === 0) return;
    children.forEach(n => this.visibleNodeIds.add(n.id));
    this.expandedNodeIds.add(nodeId);
    this._render();

    this.nodeGroup.selectAll('g.node')
      .filter(d => children.find(c => c.id === d.id))
      .style('opacity', 0)
      .transition().duration(500)
      .style('opacity', 1);
  }

  setMode(mode) { this.mode = mode; }

  setClickable(nodeIds) {
    // In scripted mode, only these nodes respond to click
    this._clickableIds = new Set(nodeIds);
  }

  highlightNode(nodeData, options = {}) {
    const g = this.nodeGroup.select(`g.node[data-id="${nodeData.id}"]`);
    if (g.empty()) return;
    g.select('circle')
      .transition().duration(600)
      .attr('stroke', '#D4A843')
      .attr('stroke-width', 4);

    if (options.pulse) {
      this._addPulseAnimation(g, nodeData);
    }
  }

  removeHighlight(nodeData) {
    const g = this.nodeGroup.select(`g.node[data-id="${nodeData.id}"]`);
    g.select('circle')
      .transition().duration(300)
      .attr('stroke', nodeData.is_bottleneck ? '#D4A843' : '#2D3748')
      .attr('stroke-width', nodeData.is_bottleneck ? 3 : 1.5);
    g.select('.pulse-ring').remove();
  }

  _addPulseAnimation(g, nodeData) {
    const r = this._nodeRadius(nodeData);
    const pulse = g.append('circle')
      .attr('class', 'pulse-ring')
      .attr('r', r + 5)
      .attr('fill', 'none')
      .attr('stroke', '#D4A843')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.8);

    function repeat() {
      pulse.attr('r', r + 5).attr('stroke-opacity', 0.8)
        .transition().duration(800).ease(d3.easeLinear)
        .attr('r', r + 18).attr('stroke-opacity', 0)
        .on('end', repeat);
    }
    repeat();
  }

  getNodeById(nodeId) {
    return this.allNodes.find(n => n.id === nodeId);
  }

  _handleNodeClick(event, d) {
    if (this.mode === 'scripted') {
      if (!this._clickableIds || !this._clickableIds.has(d.id)) return;
      this.container.dispatchEvent(new CustomEvent('arivu:node-clicked', { detail: { nodeId: d.id } }));
      return;
    }

    if (this.mode === 'animating') return;

    // Dispatch for pruning system
    window.dispatchEvent(new CustomEvent('arivu:node-clicked', { detail: { nodeId: d.id, paper: d } }));
  }

  _handleNodeKeydown(event, d) {
    switch(event.key) {
      case 'Enter':
      case ' ':
        this._handleNodeClick(event, d);
        event.preventDefault();
        break;
      case 'ArrowRight': {
        const child = this._getMostCitedChild(d.id);
        if (child) this._focusNode(child.id);
        break;
      }
      case 'ArrowLeft': {
        const parent = this._getParent(d.id);
        if (parent) this._focusNode(parent.id);
        break;
      }
      case 'Escape':
        window.dispatchEvent(new CustomEvent('arivu:reset-prune'));
        break;
    }
  }

  _getMostCitedChild(nodeId) {
    const childIds = this.allEdges
      .filter(e => (typeof e.source === 'object' ? e.source.id : e.source) === nodeId)
      .map(e => typeof e.target === 'object' ? e.target.id : e.target);
    return this.allNodes
      .filter(n => childIds.includes(n.id))
      .sort((a,b) => (b.citation_count||0) - (a.citation_count||0))[0];
  }

  _getParent(nodeId) {
    const parentIds = this.allEdges
      .filter(e => (typeof e.target === 'object' ? e.target.id : e.target) === nodeId)
      .map(e => typeof e.source === 'object' ? e.source.id : e.source);
    return this.allNodes.find(n => parentIds.includes(n.id));
  }

  _focusNode(nodeId) {
    const el = this.nodeGroup.select(`g.node[data-id="${nodeId}"]`).node();
    if (el) el.focus();
  }

  _dragStarted(event, d) {
    if (!event.active) this.simulation.alphaTarget(0.3).restart();
    d.fx = d.x; d.fy = d.y;
  }
  _dragged(event, d) { d.fx = event.x; d.fy = event.y; }
  _dragEnded(event, d) {
    if (!event.active) this.simulation.alphaTarget(0);
    d.fx = null; d.fy = null;
  }
}


/**
 * TooltipSystem — positions and populates the graph tooltip.
 */
class TooltipSystem {
  constructor(tooltipEl) {
    this.el = tooltipEl;
  }

  showNodeTooltip(event, node) {
    this.el.innerHTML = `
      <div class="tooltip-title">${this._esc(node.title || 'Unknown')}</div>
      <div class="tooltip-meta">${(node.authors || []).slice(0,2).join(', ')} · ${node.year || '?'}</div>
      <div class="tooltip-stats">
        <span class="stat">${(node.citation_count||0).toLocaleString()} citations</span>
        ${node.is_bottleneck ? `<span class="stat bottleneck">⚡ ${node.pruning_impact||'?'} papers depend on this</span>` : ''}
        ${node.is_retracted ? '<span class="stat retracted">⚠ Retracted</span>' : ''}
      </div>
      <div class="tooltip-actions">Click to select · Double-click to open paper</div>
    `;
    this._position(event);
    this.el.hidden = false;
  }

  showEdgeTooltip(event, edge) {
    const mutLabels = {
      adoption:'Direct Adoption', generalization:'Generalization',
      specialization:'Specialization', hybridization:'Hybridization',
      contradiction:'Contradiction', revival:'Revival', incidental:'Incidental Mention'
    };
    const tier = (edge.confidence_tier || 'LOW').toLowerCase();
    const dots = {high:'●●●●', medium:'●●●○', low:'●●○○', speculative:'●○○○'};

    const citedSrc = edge.cited_text_source || 'abstract';
    const citingSrc = edge.citing_text_source || 'abstract';
    const notComparable = citedSrc !== citingSrc
      ? `<div class="tooltip-warning">⚠ Scores from different text tiers (${citedSrc} vs ${citingSrc}) — not directly comparable</div>`
      : '';

    this.el.innerHTML = `
      <div class="tooltip-mutation-type" style="color:${this._mutColor(edge.mutation_type)}">
        ${mutLabels[edge.mutation_type] || 'Unknown relationship'}
      </div>
      <div class="tooltip-confidence">
        Confidence: <span class="conf-${tier}">${(edge.confidence_tier||'LOW')}</span>
        <span class="conf-dots conf-${tier}">${dots[tier]||'●○○○'}</span>
      </div>
      ${notComparable}
      <div class="tooltip-section-label">Original idea (${citedSrc}):</div>
      <div class="tooltip-sentence cited">${this._esc(edge.cited_sentence||'No text available')}</div>
      <div class="tooltip-section-label">Inherited as (${citingSrc}):</div>
      <div class="tooltip-sentence citing">${this._esc(edge.citing_sentence||'No text available')}</div>
      <div class="tooltip-similarity">Semantic similarity: ${((edge.similarity_score||0)*100).toFixed(0)}%</div>
      <div class="tooltip-flag">
        <button class="flag-btn" onclick="window._flagEdge('${edge.source||''}','${edge.target||''}')">
          👎 Disagree with this classification
        </button>
      </div>
    `;
    this._position(event);
    this.el.hidden = false;
  }

  hide() { this.el.hidden = true; }

  _position(event) {
    const margin = 15;
    let x = event.pageX + margin;
    let y = event.pageY - margin;
    const rect = this.el.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) x = event.pageX - rect.width - margin;
    if (y + rect.height > window.innerHeight) y = event.pageY - rect.height - margin;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  _esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  _mutColor(type) {
    const c = { adoption:'#3B82F6', generalization:'#06B6D4', specialization:'#8B5CF6',
                 hybridization:'#F59E0B', contradiction:'#EF4444', revival:'#22C55E' };
    return c[type] || '#475569';
  }
}

// Global flag helper
window._flagEdge = function(citing, cited) {
  fetch('/api/flag-edge', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({citing_paper_id: citing, cited_paper_id: cited})
  });
};
