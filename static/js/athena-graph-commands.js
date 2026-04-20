/**
 * athena-graph-commands.js — Phase C Feature 7 (#005)
 *
 * Client-side graph command executor. Receives parsed command JSON from
 * the orchestrator (via SSE) and calls the appropriate graph.js / tree-layout.js
 * API methods. Supports: zoom, highlight, filter, reset, trace path.
 *
 * Per ATHENA_PHASE_C.md Feature 7 and ATHENA_FEATURES.md #005.
 */

'use strict';

class AthenaGraphCommands {
  constructor() {
    this.commandQueue = [];
    this.isAnimating = false;
    this.MAX_QUEUE = 3;

    // Listen for command execution events from the orchestrator
    document.addEventListener('athena:command:execute', (e) => {
      this._handleCommand(e.detail);
    });

    // Animation complete — process next queued command
    document.addEventListener('athena:command:complete', () => {
      this.isAnimating = false;
      if (this.commandQueue.length > 0) {
        const next = this.commandQueue.shift();
        this.executeCommand(next);
      }
    });
  }

  _handleCommand(command) {
    if (!command || !command.action) return;

    if (this.isAnimating) {
      if (this.commandQueue.length >= this.MAX_QUEUE) {
        // Too many queued — show error
        document.dispatchEvent(new CustomEvent('athena:command:error', {
          detail: { message: 'Too many queued commands. Please wait.' }
        }));
        return;
      }
      this.commandQueue.push(command);
      return;
    }

    this.executeCommand(command);
  }

  executeCommand(command) {
    const graph = window._arivuGraph;
    const tree = window._treeLayout;
    const action = command.action;
    const target = command.target || '';

    switch (action) {
      case 'zoom': {
        // Zoom to a specific paper node
        const nodeId = this._resolveNodeId(target);
        if (nodeId) {
          this.isAnimating = true;
          // Try tree layout first (it's the default view)
          if (tree && tree.zoomToNode) {
            tree.zoomToNode(nodeId);
          }
          // Also try force graph
          if (graph && graph.svg && graph.zoom) {
            const node = graph.allNodes?.find(n => n.id === nodeId);
            if (node && node.x != null && node.y != null && !isNaN(node.x)) {
              const svgRect = graph.svg.node().getBoundingClientRect();
              const scale = 2;
              const transform = d3.zoomIdentity
                .translate(svgRect.width / 2 - node.x * scale, svgRect.height / 2 - node.y * scale)
                .scale(scale);
              graph.svg.transition().duration(800).call(graph.zoom.transform, transform);
            }
          }
          // Also dispatch click context for the zoomed paper
          const paper = (graph?.allNodes || tree?.treeRoot?.descendants?.()?.map(d => d.data?.data) || [])
            .flat().find(n => n?.id === nodeId);
          if (paper) {
            document.dispatchEvent(new CustomEvent('athena:graph:click', {
              detail: { type: 'node', node: { paper_id: nodeId, title: paper.title || '', year: paper.year || null }, edge: null }
            }));
          }
          // Highlight pulse after zoom completes (zoom takes 800ms)
          setTimeout(() => {
            // Force graph: gold ring pulse
            if (graph?.nodeElements) {
              graph.nodeElements.filter(d => d.id === nodeId)
                .select('circle')
                .transition().duration(300)
                .attr('stroke', '#D4A843')
                .attr('stroke-width', 4);
              setTimeout(() => {
                graph.nodeElements?.filter(d => d.id === nodeId)
                  .select('circle')
                  .transition().duration(800)
                  .attr('stroke', d => d.is_bottleneck ? '#D4A843' : '#2D3748')
                  .attr('stroke-width', d => d.is_bottleneck ? 3 : 1.5);
              }, 2000);
            }
            // Tree layout: gold border pulse
            if (tree?.nodeGroup) {
              tree.nodeGroup.selectAll('g.tree-node')
                .filter(d => d.data?.id === nodeId || d.data?.data?.id === nodeId)
                .select('rect')
                .transition().duration(300)
                .attr('stroke', '#D4A843')
                .attr('stroke-width', 3);
              setTimeout(() => {
                tree.nodeGroup?.selectAll('g.tree-node')
                  .filter(d => d.data?.id === nodeId || d.data?.data?.id === nodeId)
                  .select('rect')
                  .transition().duration(800)
                  .attr('stroke', d => d.depth === 0 ? '#111827' : '#6B7280')
                  .attr('stroke-width', d => d.depth === 0 ? 1.5 : 0.5);
              }, 2000);
            }
            document.dispatchEvent(new CustomEvent('athena:command:complete'));
          }, 850);
        } else {
          // Entity not found — let the prose response explain
          console.warn('Graph command: could not resolve entity:', target);
        }
        break;
      }

      case 'highlight': {
        // Highlight a specific node with gold ring (works on both force graph and tree)
        const nodeId = this._resolveNodeId(target);
        if (nodeId) {
          // Force graph highlight
          if (graph?.nodeElements) {
            graph.nodeElements.filter(d => d.id === nodeId)
              .select('circle')
              .transition().duration(300)
              .attr('stroke', '#D4A843')
              .attr('stroke-width', 4);
            setTimeout(() => {
              graph.nodeElements?.filter(d => d.id === nodeId)
                .select('circle')
                .transition().duration(500)
                .attr('stroke', d => d.is_bottleneck ? '#D4A843' : '#2D3748')
                .attr('stroke-width', d => d.is_bottleneck ? 3 : 1.5);
            }, 5000);
          }
          // Tree layout highlight
          if (tree?.nodeGroup) {
            tree.nodeGroup.selectAll('g.tree-node')
              .filter(d => d.data?.id === nodeId || d.data?.data?.id === nodeId)
              .select('rect')
              .transition().duration(300)
              .attr('stroke', '#D4A843')
              .attr('stroke-width', 3);
            setTimeout(() => {
              tree.nodeGroup?.selectAll('g.tree-node')
                .filter(d => d.data?.id === nodeId || d.data?.data?.id === nodeId)
                .select('rect')
                .transition().duration(500)
                .attr('stroke', d => d.depth === 0 ? '#111827' : '#6B7280')
                .attr('stroke-width', d => d.depth === 0 ? 1.5 : 0.5);
            }, 5000);
          }
          // Also set click context
          const paper = graph?.allNodes?.find(n => n.id === nodeId);
          if (paper) {
            document.dispatchEvent(new CustomEvent('athena:graph:click', {
              detail: { type: 'node', node: { paper_id: nodeId, title: paper.title || '', year: paper.year || null }, edge: null }
            }));
          }
        }
        break;
      }

      case 'filter': {
        // Apply a filter via the sidebar dropdown
        // Uses substring matching so "bottlenecks" matches even if target has extra words
        const filterMap = {
          'most cited': 'cited-desc',
          'least cited': 'cited-asc',
          'highest impact': 'impact',
          'bottleneck': 'bottlenecks',      // singular matches too
          'bottlenecks': 'bottlenecks',
          'contradiction': 'contradictions', // singular matches too
          'contradictions': 'contradictions',
          'impact': 'impact',
          'cited': 'cited-desc',            // bare "cited" → most cited
          'all': 'relevant',
          'reset': 'relevant',
          'relevant': 'relevant',
        };
        const targetLower = target.toLowerCase().trim();
        // First try exact match
        let filterType = filterMap[targetLower];
        // Then try substring match: check if any filterMap key is IN the target
        if (!filterType) {
          for (const [key, val] of Object.entries(filterMap)) {
            if (targetLower.includes(key) || key.includes(targetLower)) {
              filterType = val;
              break;
            }
          }
        }
        filterType = filterType || 'relevant';
        const select = document.getElementById('graph-filter');
        if (select) {
          select.value = filterType;
          select.dispatchEvent(new Event('change'));
        }
        break;
      }

      case 'reset': {
        // Reset all graph visual state
        const select = document.getElementById('graph-filter');
        if (select) {
          select.value = 'relevant';
          select.dispatchEvent(new Event('change'));
        }
        // Reset pruning if active
        if (window._pruningSystem?.state === 'pruned') {
          window._pruningSystem.reset();
        }
        // Recenter
        if (tree && tree.recenter) {
          tree.recenter();
        } else if (graph && graph.svg && graph.zoom) {
          const { width, height } = graph.svg.node().getBoundingClientRect();
          graph.svg.transition().duration(800).call(
            graph.zoom.transform,
            d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8)
          );
        }
        break;
      }

      case 'annotate': {
        // Phase C #012: Add annotation badge to a node
        const annNodeId = this._resolveNodeId(target);
        const label = command.label || 'noted';
        if (annNodeId && graph?.addAnnotation) {
          graph.addAnnotation(annNodeId, label, 'gold');
        }
        break;
      }

      case 'remove_annotation': {
        // Remove annotation from a node (or all)
        if (target === 'all') {
          const annotations = graph?.getAnnotations?.() || {};
          for (const pid of Object.keys(annotations)) {
            graph.removeAnnotation(pid);
          }
        } else {
          const rmNodeId = this._resolveNodeId(target);
          if (rmNodeId && graph?.removeAnnotation) {
            graph.removeAnnotation(rmNodeId);
          }
        }
        break;
      }

      default:
        console.warn(`Unknown graph command action: ${action}`);
    }
  }

  /**
   * Resolve a natural language paper reference to a node ID.
   * Uses the existing graph nodes for fuzzy matching.
   */
  _resolveNodeId(query) {
    if (!query) return null;
    const graph = window._arivuGraph;
    if (!graph?.allNodes) return null;

    // Strip filler words that don't help matching
    let queryLower = query.toLowerCase().trim()
      .replace(/\b(paper|the|a|an|this|that|node|about|from|to)\b/g, '')
      .replace(/\s+/g, ' ').trim();

    // Common abbreviations
    const aliases = {
      'resnet': 'deep residual learning',
      'vggnet': 'very deep convolutional',
      'vgg': 'very deep convolutional',
      'alexnet': 'imagenet classification with deep',
      'lstm': 'long short-term memory',
      'bert': 'bert',
      'gpt': 'language models are unsupervised',
      'attention': 'attention is all you need',
      'transformer': 'attention is all you need',
      'batch norm': 'batch normalization',
      'dropout': 'dropout',
      'adam': 'adam',
      'coco': 'microsoft coco',
      'faster rcnn': 'faster r-cnn',
      'r-cnn': 'rich feature hierarchies',
      'imagenet': 'imagenet large scale',
    };

    const expanded = aliases[queryLower] || queryLower;

    let bestMatch = null;
    let bestScore = 0;

    for (const node of graph.allNodes) {
      const title = (node.title || '').toLowerCase();

      // Exact match
      if (title === expanded) return node.id;

      // Substring match (query is contained in title OR title starts with query)
      if (title.includes(expanded)) {
        const score = 0.9;
        if (score > bestScore) { bestScore = score; bestMatch = node.id; }
        continue;
      }
      if (expanded.length > 10 && title.startsWith(expanded.substring(0, 10))) {
        const score = 0.75;
        if (score > bestScore) { bestScore = score; bestMatch = node.id; }
        continue;
      }

      // Word overlap (skip very short words)
      const queryWords = expanded.split(/\s+/).filter(w => w.length > 3);
      const titleWords = title.split(/\s+/).filter(w => w.length > 3);
      if (queryWords.length > 0 && titleWords.length > 0) {
        const overlap = queryWords.filter(qw =>
          titleWords.some(tw => tw.includes(qw) || qw.includes(tw))
        ).length;
        // Score based on how many query words match AND how many title words are covered
        const queryRatio = overlap / queryWords.length;
        const titleRatio = overlap / titleWords.length;
        const score = (queryRatio * 0.6 + titleRatio * 0.4);
        if (score > bestScore) { bestScore = score; bestMatch = node.id; }
      }
    }

    return bestScore >= 0.4 ? bestMatch : null;
  }
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.athenaGraphCommands = new AthenaGraphCommands();
  });
} else {
  window.athenaGraphCommands = new AthenaGraphCommands();
}
