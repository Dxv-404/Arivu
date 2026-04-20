/**
 * static/js/tree-layout.js
 * TreeLayout — Radial tree visualization of citation ancestry.
 * Converts the DAG into a tree (BFS from seed, first-parent wins),
 * renders with d3.tree() in radial coordinates, adds cross-edges as secondary lines.
 * Supports zoom/pan, node hover tooltips, and click events for pruning.
 */

class TreeLayout {
  constructor(container, graphData) {
    this.container = container;
    this.nodes = graphData.nodes || [];
    this.edges = graphData.edges || [];
    this.metadata = graphData.metadata || {};
    this.svg = null;
    this.zoomGroup = null;
    this.zoom = null;
    this._tooltip = document.getElementById('graph-tooltip');
    this._tooltipSystem = window._arivuGraph?._tooltipSystem || null;
    this.nodeGroup = null;

    this.init();
  }

  init() {
    const { width, height } = this.container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;

    const { hierarchy, crossEdges } = this._buildHierarchy();
    if (!hierarchy) return;

    const root = d3.hierarchy(hierarchy);
    this.treeRoot = root;

    const radius = Math.min(width, height) / 2 - 60;
    const treeLayout = d3.tree()
      .size([2 * Math.PI, radius])
      .separation((a, b) => {
        return (a.parent === b.parent ? 1 : 1.5) / (a.depth + 1);
      });

    treeLayout(root);

    this.svg = d3.select(this.container)
      .append('svg')
      .attr('class', 'tree-svg')
      .attr('width', '100%')
      .attr('height', '100%');

    this.zoomGroup = this.svg.append('g');

    this._zoomDebounceTimer = null; // Phase C #106
    this.zoom = d3.zoom()
      .scaleExtent([0.1, 5])
      .on('zoom', (event) => {
        this.zoomGroup.attr('transform', event.transform);
        // Phase C #105/#106: Store transform for awareness state
        if (window._arivuGraph) window._arivuGraph.currentTransform = event.transform;
        // Phase C #106: Debounced zoom awareness dispatch (500ms)
        clearTimeout(this._zoomDebounceTimer);
        this._zoomDebounceTimer = setTimeout(() => {
          this._dispatchTreeZoomAwareness(event.transform);
        }, 500);
      });

    this.svg.call(this.zoom);

    this._renderLinks(root);
    this._renderCrossEdges(root, crossEdges);
    this._renderNodes(root);

    this.svg.call(
      this.zoom.transform,
      d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8)
    );
  }

  _buildHierarchy() {
    const seedId = this.metadata.seed_paper_id;
    if (!seedId) return { hierarchy: null, crossEdges: [] };

    const nodeMap = new Map(this.nodes.map(n => [n.id, n]));

    // Build adjacency: source (citing) -> target (cited)
    // In the ancestry graph, edges go from child → parent (citing → cited).
    // The seed paper CITES its references. References CITE their references.
    // So: seed's children in the tree = papers it cites = targets of edges where seed is source.
    const childrenMap = new Map();
    for (const edge of this.edges) {
      const source = typeof edge.source === 'object' ? edge.source.id : edge.source;
      const target = typeof edge.target === 'object' ? edge.target.id : edge.target;
      if (!childrenMap.has(source)) childrenMap.set(source, []);
      childrenMap.get(source).push(target);
    }

    // BFS from seed — each node assigned to first-visited parent
    const visited = new Set();
    const crossEdges = [];
    const rootData = { id: seedId, data: nodeMap.get(seedId) || { id: seedId, title: 'Seed' }, children: [] };
    visited.add(seedId);

    const queue = [rootData];
    const treeNodeMap = new Map([[seedId, rootData]]);

    while (queue.length > 0) {
      const current = queue.shift();
      const children = childrenMap.get(current.id) || [];

      for (const childId of children) {
        if (!nodeMap.has(childId)) continue;

        if (!visited.has(childId)) {
          visited.add(childId);
          const childNode = { id: childId, data: nodeMap.get(childId), children: [] };
          current.children.push(childNode);
          treeNodeMap.set(childId, childNode);
          queue.push(childNode);
        } else {
          // Cross-edge: this creates a line from current → already-placed node
          crossEdges.push({ from: current.id, to: childId });
        }
      }
    }

    return { hierarchy: rootData, crossEdges };
  }

  _radialPoint(angle, radius) {
    // Convert from polar (angle in radians, radius) to Cartesian
    return [
      radius * Math.cos(angle - Math.PI / 2),
      radius * Math.sin(angle - Math.PI / 2)
    ];
  }

  _renderLinks(root) {
    const linkGroup = this.zoomGroup.append('g').attr('class', 'tree-links');

    linkGroup.selectAll('path.tree-link')
      .data(root.links())
      .join('path')
      .attr('class', 'tree-link')
      .attr('d', d3.linkRadial()
        .angle(d => d.x)
        .radius(d => d.y)
      )
      .attr('fill', 'none')
      .attr('stroke', '#9CA3AF')
      .attr('stroke-width', d => Math.max(0.5, 2.5 - d.target.depth * 0.4))
      .attr('stroke-opacity', 0.5);
  }

  _renderCrossEdges(root, crossEdges) {
    if (!crossEdges.length) return;

    // Build a map from node ID to tree position
    const posMap = new Map();
    root.each(d => {
      const [x, y] = this._radialPoint(d.x, d.y);
      posMap.set(d.data.id, { x, y });
    });

    const crossGroup = this.zoomGroup.append('g').attr('class', 'tree-cross-edges');

    crossGroup.selectAll('line.cross-edge')
      .data(crossEdges.filter(e => posMap.has(e.from) && posMap.has(e.to)))
      .join('line')
      .attr('class', 'cross-edge')
      .attr('x1', d => posMap.get(d.from).x)
      .attr('y1', d => posMap.get(d.from).y)
      .attr('x2', d => posMap.get(d.to).x)
      .attr('y2', d => posMap.get(d.to).y)
      .attr('stroke', '#D1D5DB')
      .attr('stroke-width', 0.5)
      .attr('stroke-opacity', 0.25)
      .attr('stroke-dasharray', '3,3');
  }

  _renderNodes(root) {
    this.nodeGroup = this.zoomGroup.append('g').attr('class', 'tree-nodes');
    const nodeGroup = this.nodeGroup;
    const tooltip = this._tooltipSystem;

    const nodes = nodeGroup.selectAll('g.tree-node')
      .data(root.descendants())
      .join('g')
      .attr('class', 'tree-node')
      .attr('data-id', d => d.data.id)
      .attr('transform', d => {
        const [x, y] = this._radialPoint(d.x, d.y);
        return `translate(${x},${y})`;
      });

    // Node rectangles
    nodes.append('rect')
      .attr('class', 'node-rect')
      .attr('width', d => d.depth === 0 ? 14 : 10)
      .attr('height', d => d.depth === 0 ? 10 : 7)
      .attr('x', d => d.depth === 0 ? -7 : -5)
      .attr('y', d => d.depth === 0 ? -5 : -3.5)
      .attr('rx', 2)
      .attr('fill', d => d.depth === 0 ? '#374151' : '#9CA3AF')
      .attr('stroke', d => d.depth === 0 ? '#111827' : '#6B7280')
      .attr('stroke-width', d => d.depth === 0 ? 1.5 : 0.5);

    // Node labels
    nodes.filter(d => d.depth <= 1 || (d.data.data?.is_bottleneck))
      .append('text')
      .attr('dy', -8)
      .attr('text-anchor', 'middle')
      .attr('font-size', d => d.depth === 0 ? '8px' : '6px')
      .attr('fill', '#6B7280')
      .attr('pointer-events', 'none')
      .text(d => {
        const title = d.data.data?.title || '';
        return title.length > 30 ? title.slice(0, 28) + '…' : title;
      });

    // Interaction: hover for tooltip
    nodes.on('mouseover', (event, d) => {
      if (tooltip && d.data.data) {
        tooltip.showNodeTooltip(event, d.data.data);
      }
    })
    .on('mouseout', () => {
      if (tooltip) tooltip.hide();
    })
    .on('click', (event, d) => {
      if (d.data.data) {
        window.dispatchEvent(new CustomEvent('arivu:node-clicked', {
          detail: { nodeId: d.data.id, paper: d.data.data }
        }));
        // Phase C #105: Dispatch athena:graph:click for click-aware chat
        const paper = d.data.data;
        if (window._arivuGraph) window._arivuGraph.lastClickedNode = paper;
        document.dispatchEvent(new CustomEvent('athena:graph:click', {
          detail: {
            type: 'node',
            node: {
              paper_id: paper.id || d.data.id,
              title: paper.title || '',
              year: paper.year || null,
              authors: paper.authors || [],
              citation_count: paper.citation_count || 0,
              fields_of_study: paper.fields_of_study || [],
              pagerank_score: paper.pagerank || null,
              cluster_name: null,
              depth: paper.depth != null ? paper.depth : (d.depth || null),
            },
            edge: null,
          }
        }));
      }
    })
    .on('dblclick', (event, d) => {
      const nodeData = d.data.data;
      if (!nodeData) return;
      const target = nodeData.url
        || (nodeData.doi ? `https://doi.org/${encodeURIComponent(nodeData.doi)}` : null)
        || (nodeData.id ? `https://www.semanticscholar.org/paper/${nodeData.id}` : null);
      if (target) window.open(target, '_blank');
    })
    .on('contextmenu', (event, d) => {
      // Phase C #004: Right-click context menu for tree layout nodes
      event.preventDefault();
      event.stopPropagation();
      const paper = d.data?.data;
      if (!paper) return;

      // Remove existing menu
      const existing = document.getElementById('arivu-graph-context-menu');
      if (existing) existing.remove();

      const menu = document.createElement('div');
      menu.id = 'arivu-graph-context-menu';
      menu.className = 'graph-context-menu';
      menu.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;z-index:1000;`;

      const discussItem = document.createElement('div');
      discussItem.className = 'context-menu-item';
      discussItem.innerHTML = `<svg class="menu-icon" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="7" r="2" fill="currentColor"/></svg> Discuss with Athena`;
      discussItem.addEventListener('click', () => {
        // Set click context
        if (window._arivuGraph) window._arivuGraph.lastClickedNode = paper;
        document.dispatchEvent(new CustomEvent('athena:graph:click', {
          detail: { type: 'node', node: { paper_id: paper.id || d.data.id, title: paper.title || '', year: paper.year || null, authors: paper.authors || [], citation_count: paper.citation_count || 0, fields_of_study: paper.fields_of_study || [], pagerank_score: null, cluster_name: null, depth: d.depth != null ? d.depth : null }, edge: null }
        }));
        document.dispatchEvent(new CustomEvent('athena:discuss:request', {
          detail: { paper_id: paper.id || d.data.id, title: paper.title || '', year: paper.year || null }
        }));
        menu.remove();
      });
      menu.appendChild(discussItem);

      // "Deep Dive with Athena" option (Phase C #016)
      const deepDiveItem = document.createElement('div');
      deepDiveItem.className = 'context-menu-item';
      deepDiveItem.dataset.action = 'deep-dive-athena';
      deepDiveItem.innerHTML = `<svg class="menu-icon" width="14" height="14" viewBox="0 0 14 14"><path d="M7 1 L7 13 M3 5 L7 1 L11 5" fill="none" stroke="currentColor" stroke-width="1.5" transform="rotate(180 7 7)"/></svg> Deep Dive with Athena`;
      deepDiveItem.addEventListener('click', () => {
        const paperId = paper.id || d.data.id;
        const paperTitle = paper.title || '';
        // Set click context
        document.dispatchEvent(new CustomEvent('athena:graph:click', {
          detail: {
            type: 'node',
            node: { paper_id: paperId, title: paperTitle, year: paper.year || null, authors: paper.authors || [], citation_count: paper.citation_count || 0 },
            edge: null,
          }
        }));
        // Open Athena if closed, then send deep dive
        if (window.athenaLayout && !window.athenaLayout.isOpen) {
          window.athenaLayout.toggle();
          setTimeout(() => {
            if (window.athenaEngine) window.athenaEngine.handleUserMessage(`deep dive on "${paperTitle || paperId}"`);
          }, 300);
        } else if (window.athenaEngine) {
          window.athenaEngine.handleUserMessage(`deep dive on "${paperTitle || paperId}"`);
        }
        menu.remove();
      });
      menu.appendChild(deepDiveItem);

      // "View Details" option
      const detailsItem = document.createElement('div');
      detailsItem.className = 'context-menu-item';
      detailsItem.innerHTML = `<svg class="menu-icon" width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="5" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1"/><line x1="5" y1="7" x2="9" y2="7" stroke="currentColor" stroke-width="1"/></svg> View Details`;
      detailsItem.addEventListener('click', () => {
        const url = paper.url || (paper.doi ? `https://doi.org/${encodeURIComponent(paper.doi)}` : null)
          || `https://www.semanticscholar.org/paper/${paper.id || d.data.id}`;
        if (url) window.open(url, '_blank');
        cleanup();
      });
      menu.appendChild(detailsItem);

      document.body.appendChild(menu);
      // Shared cleanup (HIGH-2 fix)
      const cleanup = () => { menu.remove(); document.removeEventListener('click', closeH); document.removeEventListener('keydown', escH); };
      const closeH = (e) => { if (!menu.contains(e.target)) cleanup(); };
      setTimeout(() => document.addEventListener('click', closeH), 50);
      const escH = (e) => { if (e.key === 'Escape') cleanup(); };
      document.addEventListener('keydown', escH);
      // Viewport clipping fix (HIGH-3)
      requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
        if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
      });
    });
  }

  /**
   * Apply a filter to tree nodes — dims non-matching, highlights matching.
   * Uses the same data properties as the force graph nodes.
   * @param {string} filterType - 'most-relevant', 'most-cited', 'bottlenecks', etc.
   */
  applyFilter(filterType) {
    if (!this.nodeGroup) return;

    const nodes = this.nodeGroup.selectAll('g.tree-node');

    if (filterType === 'most-relevant' || !filterType) {
      // Reset — show all nodes at full opacity
      nodes.select('rect.node-rect')
        .attr('opacity', 1)
        .attr('transform', null);
      this.zoomGroup.selectAll('path.tree-link').attr('stroke-opacity', 0.5);
      return;
    }

    nodes.each(function(d) {
      const data = d.data.data || {};
      const rect = d3.select(this).select('rect.node-rect');
      let matches = false;

      switch (filterType) {
        case 'most-cited':
          matches = (data.citation_count || 0) > 1000;
          break;
        case 'least-cited':
          matches = (data.citation_count || 0) > 0 && (data.citation_count || 0) < 50;
          break;
        case 'highest-impact':
          matches = (data.pruning_impact || 0) > 0;
          break;
        case 'bottlenecks':
          matches = !!data.is_bottleneck;
          break;
        case 'contradictions':
          matches = false; // Edges, not nodes — handled differently
          break;
        case 'by-decade':
          matches = true; // All visible, colored by decade
          break;
        default:
          matches = true;
      }

      rect.attr('opacity', matches ? 1 : 0.12)
        .attr('transform', matches ? 'scale(1.3)' : null);
    });

    // Dim edges for non-matching nodes
    this.zoomGroup.selectAll('path.tree-link')
      .attr('stroke-opacity', 0.15);
  }

  /**
   * Apply pruning cascade visual to tree nodes.
   * @param {Set} collapsedIds - Set of paper IDs that collapsed
   * @param {Set} survivedIds - Set of paper IDs that survived
   */
  applyPruneVisual(collapsedIds, survivedIds) {
    if (!this.nodeGroup) return;

    this.nodeGroup.selectAll('g.tree-node').each(function(d) {
      const nodeId = d.data.id;
      const rect = d3.select(this).select('rect.node-rect');

      if (collapsedIds.has(nodeId)) {
        rect.transition().duration(300)
          .attr('fill', '#EF4444')
          .attr('opacity', 0.4);
      } else if (survivedIds.has(nodeId)) {
        rect.transition().duration(300)
          .attr('fill', '#22C55E')
          .attr('opacity', 1);
      }
    });

    // Dim edges to collapsed nodes
    this.zoomGroup.selectAll('path.tree-link').each(function(d) {
      const targetId = d.target.data.id;
      if (collapsedIds.has(targetId)) {
        d3.select(this).transition().duration(300)
          .attr('stroke', '#EF4444')
          .attr('stroke-opacity', 0.2);
      }
    });
  }

  /**
   * Reset pruning visual — restore all nodes to default.
   */
  resetPruneVisual() {
    if (!this.nodeGroup) return;

    this.nodeGroup.selectAll('g.tree-node rect.node-rect').each(function(d) {
      d3.select(this).transition().duration(300)
        .attr('fill', d.depth === 0 ? '#374151' : '#9CA3AF')
        .attr('stroke', d.depth === 0 ? '#111827' : '#6B7280')
        .attr('stroke-width', d.depth === 0 ? 1.5 : 0.5)
        .attr('opacity', 1);
    });

    this.zoomGroup.selectAll('path.tree-link').transition().duration(300)
      .attr('stroke', '#9CA3AF')
      .attr('stroke-opacity', 0.5);
  }

  recenter() {
    if (!this.svg) return; // Guard: SVG not created if container had zero dims
    const { width, height } = this.container.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    this.svg.transition().duration(800).ease(d3.easeCubicOut).call(
      this.zoom.transform,
      d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8)
    );
  }

  zoomToNode(nodeId) {
    if (!this.svg || !this.treeRoot) return;

    // Find the node in the tree
    let targetNode = null;
    this.treeRoot.each(d => {
      if (d.data?.id === nodeId) targetNode = d;
    });

    if (!targetNode) return;

    const { width, height } = this.container.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    // Radial tree: x = angle (radians), y = radius
    // Convert to cartesian for zoom target
    const angle = targetNode.x - Math.PI / 2; // d3 radial convention
    const radius = targetNode.y;
    const cartX = radius * Math.cos(angle);
    const cartY = radius * Math.sin(angle);

    // Zoom to center the node
    const scale = 2.5;
    const tx = width / 2 - cartX * scale;
    const ty = height / 2 - cartY * scale;

    this.svg.transition().duration(600).ease(d3.easeCubicOut).call(
      this.zoom.transform,
      d3.zoomIdentity.translate(tx, ty).scale(scale)
    );

    // Dim all nodes and edges, highlight the target
    this.svg.selectAll('.tree-node').style('opacity', 0.1);
    this.svg.selectAll('path.tree-link, line.cross-edge').style('opacity', 0.03);

    const nodeEl = this.svg.select(`.tree-node[data-id="${nodeId}"]`);
    if (!nodeEl.empty()) {
      nodeEl.style('opacity', 1);

      // Pulse effect on rect
      nodeEl.select('rect').transition().duration(300)
        .attr('stroke', '#D4A843').attr('stroke-width', 3)
        .transition().duration(2000)
        .attr('stroke', '#666').attr('stroke-width', 0.5);
    }

    // Restore after 3.5 seconds
    const svg = this.svg;
    setTimeout(() => {
      svg.selectAll('.tree-node').style('opacity', null);
      svg.selectAll('path.tree-link, line.cross-edge').style('opacity', null);
    }, 3500);
  }

  destroy() {
    if (this.svg) {
      this.svg.remove();
      this.svg = null;
    }
  }

  /**
   * Phase C #106: Compute visible tree nodes and dispatch zoom awareness event.
   * Called 500ms after the last zoom/pan gesture (debounced).
   */
  _dispatchTreeZoomAwareness(transform) {
    try {
      const k = transform.k || 1;
      const tx = transform.x || 0;
      const ty = transform.y || 0;
      const svgRect = this.svg?.node()?.getBoundingClientRect();
      if (!svgRect) return;

      const w = svgRect.width;
      const h = svgRect.height;

      // Collect all tree nodes from the hierarchy
      const allTreeNodes = [];
      if (this.treeRoot) {
        this.treeRoot.each(d => {
          if (d.data?.data) allTreeNodes.push(d);
        });
      }

      // Compute visible nodes (those within viewport after transform)
      const visibleIds = [];
      for (const d of allTreeNodes) {
        // Tree nodes use d.x (horizontal in tree) and d.y (depth-based vertical)
        const sx = (d.y || 0) * k + tx;
        const sy = (d.x || 0) * k + ty;
        if (sx > -100 && sx < w + 100 && sy > -50 && sy < h + 50) {
          visibleIds.push(d.data.id || d.data.data?.id);
        }
      }

      // Determine cluster focus (>60% of visible nodes in same cluster)
      let clusterFocus = null;
      if (visibleIds.length > 0 && window._arivuGraph?._lookupClusterName) {
        const clusterCounts = {};
        for (const id of visibleIds) {
          const name = window._arivuGraph._lookupClusterName(id);
          if (name) clusterCounts[name] = (clusterCounts[name] || 0) + 1;
        }
        for (const [name, count] of Object.entries(clusterCounts)) {
          if (count / visibleIds.length > 0.6) {
            clusterFocus = name;
            break;
          }
        }
      }

      document.dispatchEvent(new CustomEvent('athena:graph:zoom', {
        detail: {
          zoom_level: k,
          visible_nodes: visibleIds.filter(Boolean),
          visible_count: visibleIds.filter(Boolean).length,
          cluster_focus: clusterFocus,
        }
      }));
    } catch (e) {
      // Silent failure — zoom awareness is non-critical
    }
  }

  // ── Phase C #012: Tree Annotation Support ────────────────────────────

  /**
   * Add annotation to a tree node — renders as a branch label extending
   * from the node rect with the annotation text.
   */
  addAnnotation(paperId, label, color = 'gold') {
    if (!this.nodeGroup) return;
    const truncLabel = (label || '').length > 20 ? label.substring(0, 18) + '..' : (label || '');
    const fillColor = '#0D1117'; // Black container
    const borderColor = color === 'teal' ? '#06B6D4' : '#D4A843';

    this.removeAnnotation(paperId);

    this.nodeGroup.selectAll('g.tree-node')
      .filter(d => (d.data?.data?.id || d.data?.id) === paperId)
      .each(function() {
        const g = d3.select(this);
        const badge = g.append('g')
          .attr('class', 'tree-annotation-badge')
          .attr('data-annotation-id', paperId)
          .style('pointer-events', 'none');

        // Branch line extending down from node
        badge.append('line')
          .attr('x1', 0).attr('y1', 8)
          .attr('x2', 0).attr('y2', 22)
          .attr('stroke', borderColor)
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', '3,2');

        // Label background — black container
        const textW = truncLabel.length * 5.5 + 14;
        badge.append('rect')
          .attr('x', -textW / 2).attr('y', 22)
          .attr('width', textW).attr('height', 16)
          .attr('rx', 3)
          .attr('fill', fillColor)
          .attr('stroke', borderColor)
          .attr('stroke-width', 1)
          .attr('opacity', 0.95);

        // Label text — white on black, Array font
        badge.append('text')
          .attr('x', 0).attr('y', 33)
          .attr('text-anchor', 'middle')
          .attr('font-size', '9px')
          .attr('font-family', "'Array', 'JetBrains Mono', monospace")
          .attr('font-weight', '700')
          .attr('fill', '#fff')
          .text(truncLabel);
      });
  }

  removeAnnotation(paperId) {
    if (!this.nodeGroup) return;
    this.nodeGroup.selectAll('.tree-annotation-badge')
      .filter(function() { return this.dataset.annotationId === paperId; })
      .remove();
  }
}
