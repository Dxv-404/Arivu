/**
 * static/js/constellation.js
 * ConstellationView — Papers rendered as stars on a deep-space background.
 * Gossamer edges with low opacity, bottleneck nodes pulse gently.
 * Uses D3 force simulation for layout.
 *
 * Dependencies: D3.js v7 (loaded globally in base.html)
 */

class ConstellationView {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {object} graphData - Full graph JSON (nodes, edges, metadata)
   */
  constructor(container, graphData) {
    this.container = container;
    this.nodes = (graphData.nodes || []).map(n => Object.assign({}, n));
    this.edges = (graphData.edges || []).map(e => Object.assign({}, e));
    this.metadata = graphData.metadata || {};
    this.svg = null;
    this.simulation = null;
    this._destroyed = false;
  }

  /** Render the full constellation visualization. */
  render() {
    if (this._destroyed) return;
    this.container.innerHTML = '';

    const { width, height } = this.container.getBoundingClientRect();
    const w = width || 800;
    const h = height || 600;

    // Deep space background
    this.container.style.background = '#050812';

    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${w} ${h}`)
      .attr('role', 'img')
      .attr('aria-label', 'Constellation view of citation graph');

    const defs = this.svg.append('defs');

    // Star glow filter
    const filter = defs.append('filter').attr('id', 'star-glow');
    filter.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', 3).attr('result', 'blur');
    filter.append('feMerge').selectAll('feMergeNode')
      .data(['blur', 'SourceGraphic']).join('feMergeNode').attr('in', d => d);

    // Pulse animation filter for bottlenecks
    const pulseFilter = defs.append('filter').attr('id', 'bottleneck-glow');
    pulseFilter.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', 5).attr('result', 'blur');
    pulseFilter.append('feMerge').selectAll('feMergeNode')
      .data(['blur', 'SourceGraphic']).join('feMergeNode').attr('in', d => d);

    const zoomGroup = this.svg.append('g').attr('class', 'constellation-zoom');

    // Scatter background stars
    const starfield = zoomGroup.append('g').attr('class', 'starfield');
    for (let i = 0; i < 120; i++) {
      starfield.append('circle')
        .attr('cx', Math.random() * w)
        .attr('cy', Math.random() * h)
        .attr('r', Math.random() * 1.2 + 0.3)
        .attr('fill', '#ffffff')
        .attr('opacity', Math.random() * 0.3 + 0.05);
    }

    // Zoom behavior
    this.svg.call(
      d3.zoom().scaleExtent([0.2, 5]).on('zoom', (event) => {
        zoomGroup.attr('transform', event.transform);
      })
    );

    // Gossamer edges
    const edgeGroup = zoomGroup.append('g').attr('class', 'constellation-edges');
    const edgeElements = edgeGroup.selectAll('line')
      .data(this.edges)
      .join('line')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 0.5)
      .attr('stroke-opacity', d => 0.04 + (d.similarity_score || 0) * 0.12);

    // Star nodes
    const nodeGroup = zoomGroup.append('g').attr('class', 'constellation-nodes');
    const nodeGroups = nodeGroup.selectAll('g')
      .data(this.nodes)
      .join('g')
      .attr('class', 'constellation-star')
      .call(d3.drag()
        .on('start', (event, d) => { if (!event.active) this.simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d) => { if (!event.active) this.simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    // Star circles
    nodeGroups.append('circle')
      .attr('r', d => this._starRadius(d))
      .attr('fill', d => this._starColor(d))
      .attr('filter', d => d.is_bottleneck ? 'url(#bottleneck-glow)' : 'url(#star-glow)')
      .attr('opacity', d => d.is_seed ? 1 : 0.75);

    // Seed paper outer ring
    nodeGroups.filter(d => d.is_seed)
      .append('circle')
      .attr('r', d => this._starRadius(d) + 6)
      .attr('fill', 'none')
      .attr('stroke', '#D4A843')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6)
      .attr('stroke-dasharray', '3,3');

    // Bottleneck pulse rings
    nodeGroups.filter(d => d.is_bottleneck)
      .append('circle')
      .attr('class', 'constellation-pulse')
      .attr('r', d => this._starRadius(d) + 4)
      .attr('fill', 'none')
      .attr('stroke', '#D4A843')
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.5);

    this._animatePulse();

    // Labels for important nodes
    nodeGroups.filter(d => d.is_seed || d.is_bottleneck || (d.citation_count || 0) > 500)
      .append('text')
      .attr('dy', d => this._starRadius(d) + 12)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', '9px')
      .attr('font-family', 'Inter, sans-serif')
      .attr('pointer-events', 'none')
      .text(d => this._truncate(d.title || '', 30));

    // Tooltips
    nodeGroups.append('title')
      .text(d => `${d.title || 'Unknown'} (${d.year || '?'}) — ${(d.citation_count || 0).toLocaleString()} citations`);

    // Force simulation
    this.simulation = d3.forceSimulation(this.nodes)
      .force('link', d3.forceLink(this.edges).id(d => d.id).distance(100).strength(0.15))
      .force('charge', d3.forceManyBody().strength(-60))
      .force('center', d3.forceCenter(w / 2, h / 2))
      .force('collision', d3.forceCollide().radius(d => this._starRadius(d) + 10))
      .alphaDecay(0.02)
      .on('tick', () => {
        edgeElements
          .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        nodeGroups.attr('transform', d => `translate(${d.x || 0},${d.y || 0})`);
      });

    this._edgeElements = edgeElements;
    this._nodeGroups = nodeGroups;
  }

  /**
   * Preview pruning: fade collapsed nodes, highlight survivors.
   * @param {string[]} collapsedIds - Paper IDs to collapse
   */
  showPruningPreview(collapsedIds) {
    if (!this._nodeGroups || !collapsedIds) return;
    const collapsed = new Set(collapsedIds);

    this._nodeGroups.transition().duration(800)
      .attr('opacity', d => collapsed.has(d.id) ? 0.1 : 1);

    this._edgeElements.transition().duration(800)
      .attr('stroke-opacity', d => {
        const srcId = typeof d.source === 'object' ? d.source.id : d.source;
        const tgtId = typeof d.target === 'object' ? d.target.id : d.target;
        return (collapsed.has(srcId) || collapsed.has(tgtId)) ? 0.01 : 0.12;
      });
  }

  /** Animate the bottleneck pulse rings. */
  _animatePulse() {
    if (this._destroyed) return;
    const pulseRings = this.svg.selectAll('.constellation-pulse');
    if (pulseRings.empty()) return;

    function pulse() {
      pulseRings
        .attr('stroke-opacity', 0.5)
        .attr('r', function() { return parseFloat(d3.select(this.parentNode).select('circle').attr('r')) + 4; })
        .transition().duration(1500).ease(d3.easeSineInOut)
        .attr('stroke-opacity', 0.1)
        .attr('r', function() { return parseFloat(d3.select(this.parentNode).select('circle').attr('r')) + 14; })
        .transition().duration(1500).ease(d3.easeSineInOut)
        .attr('stroke-opacity', 0.5)
        .attr('r', function() { return parseFloat(d3.select(this.parentNode).select('circle').attr('r')) + 4; })
        .on('end', pulse);
    }
    pulse();
  }

  /**
   * Star size based on citation count.
   * @param {object} d - Node data
   * @returns {number}
   */
  _starRadius(d) {
    return 2 + Math.log(Math.max(d.citation_count || 1, 1)) * 2;
  }

  /**
   * Star color: warm white for high citations, cool blue for low.
   * @param {object} d - Node data
   * @returns {string}
   */
  _starColor(d) {
    if (d.is_seed) return '#D4A843';
    const count = d.citation_count || 0;
    if (count > 1000) return '#FFF8E7';
    if (count > 200) return '#E0D4B8';
    if (count > 50) return '#A8B4CC';
    return '#7B8FB0';
  }

  /**
   * Truncate a string with ellipsis.
   * @param {string} str
   * @param {number} n
   * @returns {string}
   */
  _truncate(str, n) {
    return str.length > n ? str.slice(0, n) + '...' : str;
  }

  /** Tear down the view and stop the simulation. */
  destroy() {
    this._destroyed = true;
    if (this.simulation) this.simulation.stop();
    if (this.container) {
      this.container.innerHTML = '';
      this.container.style.background = '';
    }
    this.svg = null;
    this.simulation = null;
  }
}
