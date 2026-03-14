/**
 * static/js/semantic-zoom.js
 *
 * SemanticZoomRenderer: when the user zooms out below k=0.4,
 * switch to concept cluster bubbles instead of individual nodes.
 *
 * Wired up in loader.js._initGraph() after graph renders (not panels.js).
 * graph.js zoom handler calls renderClusters()/removeClusterOverlay()
 * via the null-guarded: if (k < 0.4 && this._semanticZoom) ...
 *
 * Dependencies: D3.js (loaded globally in base.html)
 */

class SemanticZoomRenderer {
  constructor(graph, dnaProfile) {
    this.graph = graph;
    this._clusterOverlay = null;
    this.clusters = this._buildClusters(dnaProfile);
  }

  _buildClusters(dnaProfile) {
    const clusters = {};
    const list = (dnaProfile && dnaProfile.clusters) ? dnaProfile.clusters : [];
    for (const c of list) {
      clusters[c.name] = {
        name:       c.name,
        color:      c.color || '#3B82F6',
        percentage: c.percentage || 0,
        paperIds:   c.papers || [],
        cx: 0, cy: 0, radius: 40,
        topAuthors: [],
      };
    }
    return clusters;
  }

  updateClusterPositions() {
    for (const [name, cluster] of Object.entries(this.clusters)) {
      const paperNodes = (this.graph.allNodes || [])
        .filter(n => cluster.paperIds.includes(n.id) && n.x !== undefined);
      if (!paperNodes.length) continue;

      cluster.cx = paperNodes.reduce((s, n) => s + n.x, 0) / paperNodes.length;
      cluster.cy = paperNodes.reduce((s, n) => s + n.y, 0) / paperNodes.length;

      const devX = Math.sqrt(
        paperNodes.reduce((s, n) => s + (n.x - cluster.cx) ** 2, 0) / paperNodes.length
      );
      const devY = Math.sqrt(
        paperNodes.reduce((s, n) => s + (n.y - cluster.cy) ** 2, 0) / paperNodes.length
      );
      cluster.radius = Math.max(40, devX, devY);

      cluster.topAuthors = paperNodes
        .slice().sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0))
        .slice(0, 3)
        .map(n => {
          const authors = n.authors || [];
          const first = typeof authors[0] === 'string' ? authors[0] : '';
          return first.split(' ').pop() || 'Unknown';
        });
    }
  }

  renderClusters() {
    this.updateClusterPositions();
    this.removeClusterOverlay();

    const zoomGroup = this.graph.zoomGroup;
    if (!zoomGroup) return;

    if (this.graph.nodeGroup) this.graph.nodeGroup.style('opacity', '0.15');
    if (this.graph.edgeGroup) this.graph.edgeGroup.style('opacity', '0.05');

    const clusterGroup = zoomGroup.append('g')
      .attr('class', 'cluster-overlay')
      .style('pointer-events', 'all');

    for (const [name, cluster] of Object.entries(this.clusters)) {
      if (!cluster.paperIds.length) continue;

      const g = clusterGroup.append('g')
        .attr('transform', `translate(${cluster.cx.toFixed(1)},${cluster.cy.toFixed(1)})`)
        .attr('cursor', 'pointer')
        .on('click', () => this._zoomToCluster(cluster));

      g.append('circle')
        .attr('r', cluster.radius)
        .attr('fill', cluster.color)
        .attr('fill-opacity', 0.12)
        .attr('stroke', cluster.color)
        .attr('stroke-opacity', 0.45)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '6,3');

      g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.6em')
        .attr('fill', cluster.color).attr('font-size', '13px').attr('font-weight', '600')
        .attr('font-family', 'Inter, sans-serif').text(cluster.name);

      g.append('text').attr('text-anchor', 'middle').attr('dy', '0.9em')
        .attr('fill', '#94A3B8').attr('font-size', '11px')
        .attr('font-family', 'Inter, sans-serif')
        .text(`${cluster.paperIds.length} papers · ${cluster.percentage}%`);

      if (cluster.topAuthors.length) {
        g.append('text').attr('text-anchor', 'middle').attr('dy', '2.2em')
          .attr('fill', '#64748B').attr('font-size', '10px')
          .attr('font-family', 'Inter, sans-serif')
          .text(cluster.topAuthors.join(' · '));
      }

      g.on('mouseenter', function() {
        d3.select(this).select('circle')
          .attr('fill-opacity', 0.22).attr('stroke-opacity', 0.75);
      }).on('mouseleave', function() {
        d3.select(this).select('circle')
          .attr('fill-opacity', 0.12).attr('stroke-opacity', 0.45);
      });
    }

    this._clusterOverlay = clusterGroup;
  }

  removeClusterOverlay() {
    if (this._clusterOverlay) {
      this._clusterOverlay.remove();
      this._clusterOverlay = null;
    }
    if (this.graph.nodeGroup) this.graph.nodeGroup.style('opacity', null);
    if (this.graph.edgeGroup) this.graph.edgeGroup.style('opacity', null);
  }

  _zoomToCluster(cluster) {
    const svg  = this.graph.svg;
    const zoom = this.graph.zoom;
    if (!svg || !zoom) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    svg.transition().duration(750).call(
      zoom.transform,
      d3.zoomIdentity.translate(w / 2, h / 2).scale(1.4)
        .translate(-cluster.cx, -cluster.cy)
    );
  }
}
