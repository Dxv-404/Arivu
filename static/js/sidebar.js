/**
 * static/js/sidebar.js
 * Sidebar rail behavior: icon-only buttons with hover tooltips,
 * Opera GX-style slide-out panels, view switcher, filter dropdown,
 * collapsible bottom bar, recenter button.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Only activate on the redesigned tool page
  if (!document.querySelector('.tool-layout-v2')) return;

  // ═══════ SIDEBAR SLIDE-OUT PANELS ═══════

  const sidebar = document.querySelector('.sidebar-rail');
  const backdrop = document.getElementById('panel-backdrop');
  let activePanel = null;

  function openPanel(panelId) {
    // Special cases: genealogy opens a dialog, table-view toggles an overlay
    if (panelId === 'genealogy') {
      // Use enhanced genealogy if available, fall back to basic
      if (window.triggerEnhancedGenealogy) {
        window.triggerEnhancedGenealogy();
      } else {
        triggerGenealogy();
      }
      return;
    }
    if (panelId === 'table-view') {
      toggleTableView();
      return;
    }

    // Close current panel if same button pressed
    if (activePanel === panelId) {
      closePanel();
      return;
    }

    // Close any existing open panel
    closePanel(true); // skip transition for swap

    const panel = document.getElementById(panelId);
    if (!panel) return;

    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    backdrop.classList.add('visible');
    activePanel = panelId;

    // Mark sidebar button as active
    sidebar.querySelectorAll('.sidebar-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.panel === panelId);
    });
  }

  function closePanel(instant) {
    if (!activePanel) return;
    const panel = document.getElementById(activePanel);
    if (panel) {
      if (instant) panel.style.transition = 'none';
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      if (instant) {
        // Force reflow then restore transition
        panel.offsetHeight;
        panel.style.transition = '';
      }
    }
    backdrop.classList.remove('visible');
    sidebar.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('active'));
    activePanel = null;
  }

  // Sidebar button clicks
  sidebar.addEventListener('click', (e) => {
    const btn = e.target.closest('.sidebar-btn');
    if (!btn) return;
    // Intel buttons (window-icon-btn with data-window) are handled by WindowManager, not here
    if (btn.classList.contains('window-icon-btn') && btn.dataset.window) return;
    openPanel(btn.dataset.panel);
  });

  // Backdrop click closes panel
  backdrop.addEventListener('click', () => closePanel());

  // Close buttons inside panels
  document.querySelectorAll('.slide-panel-close').forEach(btn => {
    btn.addEventListener('click', () => closePanel());
  });

  // Escape key closes panel AND resets pruning if active
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activePanel) {
      closePanel();
      // Also reset pruning so the prune pill doesn't linger
      window.dispatchEvent(new CustomEvent('arivu:reset-prune'));
      e.stopImmediatePropagation();
    }
  });

  // ═══════ GENEALOGY TRIGGER ═══════

  function triggerGenealogy() {
    // Reuse the existing genealogy button handler from loader.js
    // The #genealogy-btn ID is on the sidebar button, so loader.js
    // already bound to it. Just click it programmatically won't work
    // since loader.js binds AFTER graph loads. Fire the same logic.
    const modal = document.getElementById('genealogy-modal');
    const content = document.getElementById('genealogy-content');
    if (!modal || !content) return;
    content.textContent = 'Generating genealogy narrative…';
    modal.showModal();

    const paperId = window.ARIVU_CONFIG?.paperId;
    if (!paperId) { content.textContent = 'No paper loaded yet.'; return; }

    // Use the resolved paperId from the loaded graph if available
    const resolvedId = window._graphLoader?.paperId || paperId;

    fetch(`/api/genealogy/${encodeURIComponent(resolvedId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.narrative) {
          content.textContent = data.narrative;
        } else if (data.error === 'LLM not configured') {
          content.textContent = 'Genealogy stories require an AI language model (Groq). The service is not configured on this instance.';
        } else {
          content.textContent = data.error || 'No narrative available.';
        }
      })
      .catch(() => {
        content.textContent = 'Failed to generate genealogy narrative. Please try again.';
      });
  }

  // Close genealogy modal
  document.getElementById('genealogy-close')?.addEventListener('click', () => {
    document.getElementById('genealogy-modal').close();
  });

  // ═══════ TABLE VIEW TOGGLE ═══════

  function toggleTableView() {
    const tv = document.getElementById('table-view');
    if (!tv) return;
    tv.hidden = !tv.hidden;
    // If opening and table not yet populated, populate it
    if (!tv.hidden && window._arivuGraph) {
      const graphData = {
        nodes: window._arivuGraph.allNodes,
        edges: window._arivuGraph.allEdges
      };
      // Reuse loader's populate method if available
      if (window._graphLoader && window._graphLoader._populateTableView) {
        window._graphLoader._populateTableView(graphData);
      }
    }
  }

  // ═══════ COLLAPSIBLE BOTTOM BAR ═══════

  const bottomBar = document.getElementById('bottom-bar');
  const bottomToggle = document.getElementById('bottom-bar-toggle');

  if (bottomBar && bottomToggle) {
    bottomToggle.addEventListener('click', (e) => {
      // Don't toggle if user clicked a window-icon-btn inside the toggle bar
      if (e.target.closest('.window-icon-btn')) return;
      bottomBar.classList.toggle('collapsed');
    });

    // Tab switching
    const tabs = bottomBar.querySelectorAll('[role="tab"]');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.setAttribute('aria-selected', 'false'));
        tab.setAttribute('aria-selected', 'true');

        const orphansPanel = document.getElementById('orphans-panel');
        const coveragePanel = document.getElementById('coverage-panel');
        if (tab.id === 'tab-orphans') {
          if (orphansPanel) orphansPanel.hidden = false;
          if (coveragePanel) coveragePanel.hidden = true;
        } else {
          if (orphansPanel) orphansPanel.hidden = true;
          if (coveragePanel) coveragePanel.hidden = false;
        }
      });
    });
  }

  // ═══════ VIEW SWITCHER ═══════

  const viewBtns = document.querySelectorAll('.view-btn');
  const modeLabel = document.getElementById('mode-label');
  let currentView = 'tree'; // default: tree layout (per wireframe spec)

  viewBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const view = btn.dataset.view;
      if (view === currentView) return;

      viewBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      switchView(view);
    });
  });

  function switchView(view) {
    const container = document.getElementById('graph-svg-container');
    if (!container) return;

    if (view === 'tree') {
      modeLabel.textContent = 'MODE: TREE LAYOUT';
      // Hide force-directed, show tree
      const forceSvg = container.querySelector('svg:not(.tree-svg)');
      if (forceSvg) forceSvg.style.display = 'none';

      // Create tree layout if not already present
      if (!window._treeLayout && window._arivuGraph) {
        window._treeLayout = new TreeLayout(container, {
          nodes: window._arivuGraph.allNodes,
          edges: window._arivuGraph.allEdges,
          metadata: window._arivuGraph.metadata
        });
        // Phase C #012: Restore annotations on tree layout after creation
        if (window._treeLayout?.addAnnotation) {
          const graphId = window._arivuGraph?.metadata?.graph_id || 'default';
          try {
            const annotations = JSON.parse(sessionStorage.getItem(`athena_annotations_${graphId}`) || '{}');
            for (const [paperId, ann] of Object.entries(annotations)) {
              window._treeLayout.addAnnotation(paperId, ann.label, ann.color);
            }
          } catch (e) {}
        }
      }
      const treeSvg = container.querySelector('.tree-svg');
      if (treeSvg) treeSvg.style.display = '';

    } else if (view === 'graph') {
      modeLabel.textContent = 'MODE: FORCE GRAPH';
      // Hide tree, show force-directed
      const treeSvg = container.querySelector('.tree-svg');
      if (treeSvg) treeSvg.style.display = 'none';

      const forceSvg = container.querySelector('svg:not(.tree-svg)');
      if (forceSvg) forceSvg.style.display = '';
    }

    currentView = view;
  }

  // ═══════ RECENTER BUTTON ═══════

  document.getElementById('recenter-btn')?.addEventListener('click', () => {
    if (currentView === 'graph' && window._arivuGraph) {
      window._arivuGraph._zoomToFit();
    } else if (currentView === 'tree' && window._treeLayout) {
      window._treeLayout.recenter();
    }
  });

  // ═══════ FILTER DROPDOWN ═══════

  const filterSelect = document.getElementById('graph-filter');
  if (filterSelect) {
    filterSelect.addEventListener('change', () => {
      applyFilter(filterSelect.value);
    });
  }

  function applyFilter(filterType) {
    // Apply to force graph
    const graph = window._arivuGraph;
    if (graph && graph.nodeElements) {
      const nodes = graph.allNodes;
      const citationsSorted = nodes.map(n => n.citation_count || 0).sort((a, b) => b - a);
      const topCitationThreshold = citationsSorted[Math.floor(nodes.length * 0.2)] || 0;
      const bottomCitationThreshold = citationsSorted[Math.floor(nodes.length * 0.8)] || 0;
      const impactSorted = nodes.map(n => n.pruning_impact || 0).sort((a, b) => b - a);
      const topImpactThreshold = impactSorted[Math.floor(nodes.length * 0.2)] || 1;

      graph.nodeElements.transition().duration(400)
        .style('opacity', d => {
          switch (filterType) {
            case 'relevant': return 1;
            case 'cited-desc': return (d.citation_count || 0) >= topCitationThreshold ? 1 : 0.12;
            case 'cited-asc': return (d.citation_count || 0) <= bottomCitationThreshold ? 1 : 0.12;
            case 'impact': return (d.pruning_impact || 0) >= topImpactThreshold ? 1 : 0.12;
            case 'bottlenecks': return d.is_bottleneck ? 1 : 0.12;
            case 'decade': return 1;
            case 'contradictions': return 1;
            default: return 1;
          }
        });

      if (graph.edgeElements) {
        graph.edgeElements.transition().duration(400)
          .attr('stroke-opacity', d => {
            if (filterType === 'contradictions') {
              return d.mutation_type === 'contradiction' ? 0.9 : 0.05;
            }
            if (filterType === 'relevant') return 0.4;
            return 0.15;
          });
      }
    }

    // Apply to tree layout (uses the same filter type names)
    if (window._treeLayout?.applyFilter) {
      const treeFilterMap = {
        'relevant': 'most-relevant',
        'cited-desc': 'most-cited',
        'cited-asc': 'least-cited',
        'impact': 'highest-impact',
        'bottlenecks': 'bottlenecks',
        'contradictions': 'contradictions',
        'decade': 'by-decade'
      };
      window._treeLayout.applyFilter(treeFilterMap[filterType] || 'most-relevant');
    }

    // Phase C #107: Dispatch filter awareness event for Athena
    const filterLabels = {
      'relevant': null,
      'cited-desc': 'Most Cited',
      'cited-asc': 'Least Cited',
      'impact': 'Highest Impact',
      'bottlenecks': 'Bottlenecks Only',
      'contradictions': 'Contradictions',
      'decade': 'By Decade',
    };
    const totalNodes = graph?.allNodes?.length || 0;
    const activeFilter = filterLabels[filterType] || null;
    document.dispatchEvent(new CustomEvent('athena:graph:filter', {
      detail: {
        active_filters: {
          field: null,
          year_range: null,
          cluster: null,
          mutation_type: filterType === 'contradictions' ? 'contradiction' : null,
          display_filter: activeFilter,
        },
        visible_count: activeFilter ? Math.floor(totalNodes * 0.2) : totalNodes,
        hidden_count: activeFilter ? Math.floor(totalNodes * 0.8) : 0,
        filter_type: filterType,
      }
    }));
  }
});
