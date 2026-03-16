/**
 * static/js/river-view.js
 * RiverView — Papers flow like a river from left (oldest) to right (newest).
 * River width represents citation density per era. Paper circles flow along
 * the river path. Uses D3.js area and force layout.
 *
 * Dependencies: D3.js v7 (loaded globally in base.html)
 */

class RiverView {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {object} graphData - Full graph JSON (nodes, edges, metadata)
   */
  constructor(container, graphData) {
    this.container = container;
    this.nodes = (graphData.nodes || []).map(function(n) { return Object.assign({}, n); });
    this.edges = (graphData.edges || []).map(function(e) { return Object.assign({}, e); });
    this.metadata = graphData.metadata || {};
    this.svg = null;
    this._destroyed = false;
  }

  /** Render the river visualization. */
  render() {
    if (this._destroyed) return;
    this.container.innerHTML = '';
    this.container.style.background = 'var(--bg-primary)';

    var rect = this.container.getBoundingClientRect();
    var w = rect.width || 800;
    var h = rect.height || 600;
    var margin = { top: 30, right: 40, bottom: 50, left: 50 };
    var innerW = w - margin.left - margin.right;
    var innerH = h - margin.top - margin.bottom;

    // Group nodes by year and compute density
    var yearMap = {};
    var self = this;
    this.nodes.forEach(function(n) {
      var yr = n.year || 2000;
      if (!yearMap[yr]) yearMap[yr] = { year: yr, papers: [], totalCitations: 0 };
      yearMap[yr].papers.push(n);
      yearMap[yr].totalCitations += (n.citation_count || 0);
    });
    var years = Object.keys(yearMap).map(Number).sort(function(a, b) { return a - b; });

    if (years.length === 0) {
      this.container.innerHTML = '<p style="color:var(--text-muted);padding:24px;">No data to display.</p>';
      return;
    }

    var minYear = years[0];
    var maxYear = years[years.length - 1];

    // Density = paper count per year
    var densityData = years.map(function(yr) {
      return { year: yr, count: yearMap[yr].papers.length };
    });
    var maxDensity = Math.max.apply(null, densityData.map(function(d) { return d.count; })) || 1;

    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', '0 0 ' + w + ' ' + h)
      .attr('role', 'img')
      .attr('aria-label', 'River view of citation flow over time');

    var g = this.svg.append('g')
      .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    // Zoom support
    this.svg.call(
      d3.zoom().scaleExtent([0.3, 4]).on('zoom', function(event) {
        g.attr('transform', 'translate(' + (margin.left + event.transform.x) + ',' + (margin.top + event.transform.y) + ') scale(' + event.transform.k + ')');
      })
    );

    // X scale: time axis
    var xScale = d3.scaleLinear()
      .domain([minYear, maxYear])
      .range([0, innerW]);

    // River width scale: maps density to vertical extent
    var widthScale = d3.scaleLinear()
      .domain([0, maxDensity])
      .range([20, innerH * 0.35]);

    var centerY = innerH / 2;

    // Build the river area shape
    var areaTop = d3.line()
      .x(function(d) { return xScale(d.year); })
      .y(function(d) { return centerY - widthScale(d.count) / 2; })
      .curve(d3.curveBasis);

    var areaBottom = d3.line()
      .x(function(d) { return xScale(d.year); })
      .y(function(d) { return centerY + widthScale(d.count) / 2; })
      .curve(d3.curveBasis);

    var areaGen = d3.area()
      .x(function(d) { return xScale(d.year); })
      .y0(function(d) { return centerY + widthScale(d.count) / 2; })
      .y1(function(d) { return centerY - widthScale(d.count) / 2; })
      .curve(d3.curveBasis);

    // River gradient
    var defs = this.svg.append('defs');
    var gradient = defs.append('linearGradient')
      .attr('id', 'river-gradient')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '100%').attr('y2', '0%');
    gradient.append('stop').attr('offset', '0%').attr('stop-color', '#1E3A5F').attr('stop-opacity', 0.8);
    gradient.append('stop').attr('offset', '50%').attr('stop-color', '#3B82F6').attr('stop-opacity', 0.6);
    gradient.append('stop').attr('offset', '100%').attr('stop-color', '#06B6D4').attr('stop-opacity', 0.8);

    // Draw the river
    g.append('path')
      .datum(densityData)
      .attr('d', areaGen)
      .attr('fill', 'url(#river-gradient)')
      .attr('stroke', 'none');

    // River bank lines
    g.append('path')
      .datum(densityData)
      .attr('d', areaTop)
      .attr('fill', 'none')
      .attr('stroke', 'var(--accent-blue)')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.5);

    g.append('path')
      .datum(densityData)
      .attr('d', areaBottom)
      .attr('fill', 'none')
      .attr('stroke', 'var(--accent-blue)')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.5);

    // X axis (years)
    var tickYears = years.filter(function(_, i) {
      return i % Math.max(1, Math.floor(years.length / 12)) === 0;
    });
    g.append('g')
      .attr('transform', 'translate(0,' + (innerH + 5) + ')')
      .call(d3.axisBottom(xScale).tickValues(tickYears).tickFormat(d3.format('d')))
      .selectAll('text')
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', '10px');

    // Place paper circles along the river
    var nodePositions = {};
    years.forEach(function(yr) {
      var papers = yearMap[yr].papers;
      var x = xScale(yr);
      var halfWidth = widthScale(yearMap[yr].papers.length) / 2;
      papers.forEach(function(paper, i) {
        var spread = papers.length > 1 ? (i / (papers.length - 1)) * 2 - 1 : 0;
        var y = centerY + spread * halfWidth * 0.7;
        paper._riverX = x;
        paper._riverY = y;
        nodePositions[paper.id] = paper;
      });
    });

    // Draw edges
    var edgeGroup = g.append('g').attr('class', 'river-edges');
    this.edges.forEach(function(e) {
      var srcId = typeof e.source === 'object' ? e.source.id : e.source;
      var tgtId = typeof e.target === 'object' ? e.target.id : e.target;
      var src = nodePositions[srcId];
      var tgt = nodePositions[tgtId];
      if (!src || !tgt) return;
      edgeGroup.append('line')
        .attr('x1', src._riverX).attr('y1', src._riverY)
        .attr('x2', tgt._riverX).attr('y2', tgt._riverY)
        .attr('stroke', '#94A3B8')
        .attr('stroke-width', 0.4)
        .attr('stroke-opacity', 0.1);
    });

    // Draw paper circles
    var nodeGroup = g.append('g').attr('class', 'river-nodes');
    var nodeEls = nodeGroup.selectAll('g')
      .data(this.nodes)
      .join('g')
      .attr('transform', function(d) { return 'translate(' + d._riverX + ',' + d._riverY + ')'; });

    nodeEls.append('circle')
      .attr('r', function(d) { return self._nodeRadius(d); })
      .attr('fill', function(d) { return self._nodeColor(d); })
      .attr('stroke', function(d) { return d.is_seed ? '#D4A843' : d.is_bottleneck ? '#D4A843' : 'none'; })
      .attr('stroke-width', function(d) { return (d.is_seed || d.is_bottleneck) ? 2 : 0; })
      .attr('opacity', 0.85)
      .attr('cursor', 'pointer');

    // Labels for seed and bottleneck nodes
    nodeEls.filter(function(d) { return d.is_seed || d.is_bottleneck; })
      .append('text')
      .attr('dy', function(d) { return -self._nodeRadius(d) - 4; })
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-secondary)')
      .attr('font-size', '9px')
      .attr('font-family', 'Inter, sans-serif')
      .attr('pointer-events', 'none')
      .text(function(d) { return self._truncate(d.title || '', 22); });

    // Tooltips
    nodeEls.append('title')
      .text(function(d) { return (d.title || 'Unknown') + ' (' + (d.year || '?') + ') - ' + (d.citation_count || 0).toLocaleString() + ' citations'; });

    // Axis label
    g.append('text')
      .attr('x', innerW / 2)
      .attr('y', innerH + 35)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', '11px')
      .attr('font-family', 'Inter, sans-serif')
      .text('Year of Publication');
  }

  /**
   * Node radius based on citation count.
   * @param {object} d - Node data
   * @returns {number}
   */
  _nodeRadius(d) {
    return 3 + Math.log(Math.max(d.citation_count || 1, 1)) * 1.5;
  }

  /**
   * Node color by field of study.
   * @param {object} d - Node data
   * @returns {string}
   */
  _nodeColor(d) {
    if (d.is_seed) return '#D4A843';
    var field = (d.fields_of_study || [])[0] || 'Other';
    var colors = {
      'Computer Science': '#648FFF',
      'Biology': '#785EF0',
      'Medicine': '#785EF0',
      'Physics': '#DC267F',
      'Chemistry': '#FE6100',
      'Economics': '#FFB000',
      'Mathematics': '#009E73',
    };
    return colors[field] || '#56B4E9';
  }

  /**
   * Truncate string with ellipsis.
   * @param {string} str
   * @param {number} n
   * @returns {string}
   */
  _truncate(str, n) {
    return str.length > n ? str.slice(0, n) + '...' : str;
  }

  /** Tear down the view. */
  destroy() {
    this._destroyed = true;
    if (this.container) {
      this.container.innerHTML = '';
      this.container.style.background = '';
    }
    this.svg = null;
  }
}
