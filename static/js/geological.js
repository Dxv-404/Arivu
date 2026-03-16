/**
 * static/js/geological.js
 * GeologicalView — Papers displayed in horizontal strata by year.
 * Oldest papers at the bottom, newest on top. Each stratum has a
 * warm-to-dark gradient based on age. Paradigm shifts shown as bold jagged lines.
 *
 * Dependencies: D3.js v7 (loaded globally in base.html)
 */

class GeologicalView {
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
    this._destroyed = false;
  }

  /** Render the geological strata visualization. */
  render() {
    if (this._destroyed) return;
    this.container.innerHTML = '';
    this.container.style.background = 'var(--bg-primary)';

    const { width, height } = this.container.getBoundingClientRect();
    const w = width || 800;
    const h = height || 600;
    const margin = { top: 30, right: 30, bottom: 40, left: 60 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;

    // Group nodes by year
    var yearMap = {};
    this.nodes.forEach(function(n) {
      var yr = n.year || 2000;
      if (!yearMap[yr]) yearMap[yr] = [];
      yearMap[yr].push(n);
    });
    var years = Object.keys(yearMap).map(Number).sort(function(a, b) { return a - b; });
    if (years.length === 0) {
      this.container.innerHTML = '<p style="color:var(--text-muted);padding:24px;">No data to display.</p>';
      return;
    }

    var minYear = years[0];
    var maxYear = years[years.length - 1];

    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', '0 0 ' + w + ' ' + h)
      .attr('role', 'img')
      .attr('aria-label', 'Geological strata view of citation graph');

    var g = this.svg.append('g')
      .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    // Zoom support
    var zoomGroup = g;
    this.svg.call(
      d3.zoom().scaleExtent([0.3, 4]).on('zoom', function(event) {
        zoomGroup.attr('transform', 'translate(' + (margin.left + event.transform.x) + ',' + (margin.top + event.transform.y) + ') scale(' + event.transform.k + ')');
      })
    );

    // Scales: oldest at bottom (high y), newest at top (low y)
    var yScale = d3.scaleLinear()
      .domain([minYear, maxYear])
      .range([innerH, 0]);

    var stratumHeight = Math.max(8, innerH / Math.max(years.length, 1));

    // Color gradient: oldest = warm dark (#5C3D2E), newest = cool (#1E293B)
    var colorScale = d3.scaleLinear()
      .domain([minYear, maxYear])
      .range(['#5C3D2E', '#1E293B']);

    // Draw strata bands
    var strataBg = g.append('g').attr('class', 'strata-bg');
    years.forEach(function(yr) {
      var yPos = yScale(yr) - stratumHeight / 2;
      strataBg.append('rect')
        .attr('x', 0)
        .attr('y', yPos)
        .attr('width', innerW)
        .attr('height', stratumHeight)
        .attr('fill', colorScale(yr))
        .attr('opacity', 0.5)
        .attr('rx', 2);

      // Year label on the left
      strataBg.append('text')
        .attr('x', -8)
        .attr('y', yPos + stratumHeight / 2)
        .attr('text-anchor', 'end')
        .attr('alignment-baseline', 'middle')
        .attr('fill', 'var(--text-muted)')
        .attr('font-size', '10px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(yr);
    });

    // Detect paradigm shifts: years with sudden increase in papers or new fields
    var paradigmYears = this._detectParadigmShifts(years, yearMap);

    // Draw paradigm shift jagged lines
    var jagged = g.append('g').attr('class', 'paradigm-shifts');
    paradigmYears.forEach(function(yr) {
      var yPos = yScale(yr);
      var points = [];
      var teeth = 15;
      for (var i = 0; i <= teeth; i++) {
        var xp = (i / teeth) * innerW;
        var yp = yPos + (i % 2 === 0 ? -4 : 4);
        points.push(xp + ',' + yp);
      }
      jagged.append('polyline')
        .attr('points', points.join(' '))
        .attr('fill', 'none')
        .attr('stroke', 'var(--danger)')
        .attr('stroke-width', 2.5)
        .attr('opacity', 0.7);

      jagged.append('text')
        .attr('x', innerW + 6)
        .attr('y', yPos + 4)
        .attr('fill', 'var(--danger)')
        .attr('font-size', '9px')
        .attr('font-family', 'Inter, sans-serif')
        .text('Shift');
    });

    // Draw edges between nodes across strata
    var nodeIdMap = {};
    var xCounters = {};
    this.nodes.forEach(function(n) {
      var yr = n.year || 2000;
      if (!xCounters[yr]) xCounters[yr] = 0;
      var count = (yearMap[yr] || []).length;
      var spacing = innerW / (count + 1);
      xCounters[yr]++;
      n._geoX = spacing * xCounters[yr];
      n._geoY = yScale(yr);
      nodeIdMap[n.id] = n;
    });

    var edgeGroup = g.append('g').attr('class', 'geo-edges');
    this.edges.forEach(function(e) {
      var srcId = typeof e.source === 'object' ? e.source.id : e.source;
      var tgtId = typeof e.target === 'object' ? e.target.id : e.target;
      var src = nodeIdMap[srcId];
      var tgt = nodeIdMap[tgtId];
      if (!src || !tgt) return;
      edgeGroup.append('line')
        .attr('x1', src._geoX).attr('y1', src._geoY)
        .attr('x2', tgt._geoX).attr('y2', tgt._geoY)
        .attr('stroke', '#94A3B8')
        .attr('stroke-width', 0.5)
        .attr('stroke-opacity', 0.15);
    });

    // Draw paper nodes as circles within strata
    var nodeGroup = g.append('g').attr('class', 'geo-nodes');
    var self = this;
    var nodeEls = nodeGroup.selectAll('g')
      .data(this.nodes)
      .join('g')
      .attr('transform', function(d) { return 'translate(' + d._geoX + ',' + d._geoY + ')'; });

    nodeEls.append('circle')
      .attr('r', function(d) { return self._nodeRadius(d); })
      .attr('fill', function(d) { return self._fieldColor(d); })
      .attr('stroke', function(d) { return d.is_bottleneck ? '#D4A843' : 'none'; })
      .attr('stroke-width', function(d) { return d.is_bottleneck ? 2 : 0; })
      .attr('cursor', 'pointer');

    // Seed marker
    nodeEls.filter(function(d) { return d.is_seed; })
      .append('circle')
      .attr('r', function(d) { return self._nodeRadius(d) + 5; })
      .attr('fill', 'none')
      .attr('stroke', '#D4A843')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3,2');

    // Labels for significant nodes
    nodeEls.filter(function(d) { return d.is_seed || d.is_bottleneck; })
      .append('text')
      .attr('dx', function(d) { return self._nodeRadius(d) + 5; })
      .attr('dy', 3)
      .attr('fill', 'var(--text-secondary)')
      .attr('font-size', '9px')
      .attr('font-family', 'Inter, sans-serif')
      .attr('pointer-events', 'none')
      .text(function(d) { return self._truncate(d.title || '', 25); });

    // Tooltips
    nodeEls.append('title')
      .text(function(d) { return (d.title || 'Unknown') + ' (' + (d.year || '?') + ') - ' + (d.citation_count || 0).toLocaleString() + ' citations'; });
  }

  /**
   * Detect years that might be paradigm shifts.
   * Simple heuristic: years where paper count jumps significantly.
   * @param {number[]} years - Sorted list of years
   * @param {Object} yearMap - Year -> papers mapping
   * @returns {number[]}
   */
  _detectParadigmShifts(years, yearMap) {
    var shifts = [];
    for (var i = 1; i < years.length; i++) {
      var prev = (yearMap[years[i - 1]] || []).length;
      var curr = (yearMap[years[i]] || []).length;
      if (prev > 0 && curr >= prev * 2.5 && curr >= 3) {
        shifts.push(years[i]);
      }
    }
    return shifts;
  }

  /**
   * Node radius based on citation count.
   * @param {object} d - Node data
   * @returns {number}
   */
  _nodeRadius(d) {
    return 3 + Math.log(Math.max(d.citation_count || 1, 1)) * 1.8;
  }

  /**
   * Color by field of study.
   * @param {object} d - Node data
   * @returns {string}
   */
  _fieldColor(d) {
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
