/**
 * static/js/landing-demo.js
 * Landing page: scripted 4-step demo state machine.
 * "Show me" → highlight Vaswani node → click → cascade animation → search reveal
 */

// Pre-computed pruning result for Vaswani 2017 (Attention Is All You Need)
// Loaded from static/data/precomputed_vaswani.json when available, fallback inline.
const PRECOMPUTED_VASWANI_ID = '204e3073870fae3d05bcbc2f6a8e263d9b72e776';

document.addEventListener('DOMContentLoaded', () => {
  const showMeBtn = document.getElementById('show-me-btn');
  const heroContent = document.getElementById('hero-content');
  const demoContainer = document.getElementById('demo-graph-container');
  const searchSection = document.getElementById('search-section');
  const demoCountEl = document.getElementById('demo-count');

  if (!showMeBtn) return;

  showMeBtn.addEventListener('click', async () => {
    showMeBtn.disabled = true;

    // Step 1: Fetch precomputed preview graph
    let previewGraph;
    try {
      const resp = await fetch('/static/previews/attention/graph.json');
      previewGraph = await resp.json();
    } catch (e) {
      // No precomputed graph — skip to search
      revealSearch();
      return;
    }

    // Step 2: Fade hero text, reveal graph
    heroContent.classList.add('fading');
    demoContainer.classList.add('active');
    await delay(400);

    const graph = new ArivuGraph(demoContainer, previewGraph);
    graph.setMode('scripted');

    // Wait for simulation to settle
    await delay(1200);

    // Step 3: Highlight Vaswani node
    const vaswaniNode = graph.getNodeById(PRECOMPUTED_VASWANI_ID);
    if (!vaswaniNode) { revealSearch(); return; }

    graph.highlightNode(vaswaniNode, { pulse: true });
    graph.setClickable([vaswaniNode.id]);

    // Step 4: Wait for click (or auto-trigger after 8s)
    await Promise.race([
      waitForNodeClick(demoContainer, vaswaniNode.id),
      delay(8000)
    ]);

    graph.removeHighlight(vaswaniNode);

    // Step 5: Fetch pruning result
    let pruneResult;
    const precomputed = (previewGraph.precomputed_pruning || {})[PRECOMPUTED_VASWANI_ID];
    if (precomputed) {
      pruneResult = precomputed;
    } else {
      try {
        const r = await fetch('/api/prune', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paper_ids: [PRECOMPUTED_VASWANI_ID], graph_seed_id: PRECOMPUTED_VASWANI_ID })
        });
        pruneResult = await r.json();
      } catch (e) { pruneResult = null; }
    }

    // Step 6: Animate cascade
    if (pruneResult) {
      graph.setMode('animating');
      const pruning = new PruningSystem(graph);
      pruning.currentResult = pruneResult;
      await pruning._animateCascade(pruneResult);

      if (demoCountEl) demoCountEl.textContent = pruneResult.collapsed_count || 47;
    }

    await delay(1500);

    // Step 7: Reveal search
    revealSearch();
  });

  function revealSearch() {
    if (searchSection) {
      searchSection.classList.remove('hidden');
      searchSection.scrollIntoView({ behavior: 'smooth' });
    }
    new PaperSearch();  // init search autocomplete
  }

  function delay(ms) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return new Promise(r => setTimeout(r, reduced ? 0 : ms));
  }

  function waitForNodeClick(container, nodeId) {
    return new Promise(resolve => {
      function handler(e) {
        if (e.detail?.nodeId === nodeId) {
          container.removeEventListener('arivu:node-clicked', handler);
          window.removeEventListener('arivu:node-clicked', handler);
          resolve();
        }
      }
      container.addEventListener('arivu:node-clicked', handler);
      window.addEventListener('arivu:node-clicked', handler);
    });
  }
});
