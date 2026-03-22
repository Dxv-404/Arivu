/**
 * Arivu — Enhanced Genealogy Story
 *
 * Replaces the plain-text genealogy modal with a structured,
 * interactive experience featuring:
 * - Dot matrix book loading animation
 * - Three Pivotal Moments summary
 * - Interactive timeline
 * - Era-chapter narrative with mutation verbs
 * - Contradiction callouts
 * - Paths Abandoned section
 * - Typewriter reveal effect
 * - Clickable paper references (Locate → zoom in graph)
 */

/* global d3, window */
'use strict';

/* ═══════════════════════════════════════════════════════════════════════
   DOT MATRIX BOOK ANIMATION
   ═══════════════════════════════════════════════════════════════════════ */

const BOOK_FRAMES = [
  // Frame 0: Book open, pages flat
  [
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,
    0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,
    0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,
    0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,
    0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,
    0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,
    0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,
    0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,
    0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  ],
  // Frame 1: Right page starting to lift
  [
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,1,1,1,1,1,1,1,1,1,1,1,0,0,0,
    0,1,1,1,1,1,1,1,1,1,1,1,0,0,1,0,
    0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,
    0,1,1,0,0,0,0,1,1,0,0,0,1,1,0,0,
    0,1,1,0,0,0,0,1,1,0,0,1,1,0,0,0,
    0,1,1,0,0,0,0,1,1,0,1,1,0,0,0,0,
    0,1,1,0,0,0,0,1,1,1,1,0,0,0,0,0,
    0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,
    0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  ],
  // Frame 2: Page mid-flip (curved over spine)
  [
    0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,
    0,0,1,1,1,1,1,1,1,0,0,0,0,0,0,0,
    0,1,1,1,1,1,1,0,0,0,0,0,0,0,1,0,
    0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,
    0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,
    0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,
    0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,
    0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,
    0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,
    0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  ],
  // Frame 3: Page landing on left side
  [
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,1,1,1,1,1,1,1,1,1,1,1,0,0,
    0,1,0,0,0,1,1,1,1,1,1,1,1,1,1,0,
    0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,
    0,0,1,1,0,0,0,1,1,0,0,0,0,1,1,0,
    0,0,0,1,1,0,0,1,1,0,0,0,0,1,1,0,
    0,0,0,0,1,1,0,1,1,0,0,0,0,1,1,0,
    0,0,0,0,0,1,1,1,1,0,0,0,0,1,1,0,
    0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,
    0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  ],
];

function createDotMatrixLoader() {
  const container = document.createElement('div');
  container.className = 'dot-matrix-loader';

  const grid = document.createElement('div');
  grid.className = 'dot-matrix-book';
  for (let i = 0; i < 192; i++) {
    const dot = document.createElement('div');
    dot.className = 'dot';
    grid.appendChild(dot);
  }
  container.appendChild(grid);

  const text = document.createElement('div');
  text.className = 'loading-text';
  text.textContent = 'Tracing intellectual lineage...';
  container.appendChild(text);

  // Start animation
  const dots = grid.querySelectorAll('.dot');
  let frameIndex = 0;
  const interval = setInterval(() => {
    const frame = BOOK_FRAMES[frameIndex % BOOK_FRAMES.length];
    frame.forEach((val, i) => {
      if (i < dots.length) dots[i].classList.toggle('on', val === 1);
    });
    frameIndex++;
  }, 600);

  container._stopAnimation = () => clearInterval(interval);
  return container;
}


/* ═══════════════════════════════════════════════════════════════════════
   DATA EXTRACTION — Compute structured data from graph JSON
   ═══════════════════════════════════════════════════════════════════════ */

function extractGenealogyData() {
  const graphData = window._graphLoader?._graphData;
  if (!graphData?.nodes?.length) return null;

  const nodes = graphData.nodes;
  const edges = graphData.edges || [];
  const totalNodes = nodes.length;
  const seedNode = nodes.find(n => n.is_seed);
  if (!seedNode) return null;

  // Sort nodes by year
  const nodesWithYear = nodes.filter(n => n.year).sort((a, b) => a.year - b.year);
  const minYear = nodesWithYear.length ? nodesWithYear[0].year : null;
  const maxYear = nodesWithYear.length ? nodesWithYear[nodesWithYear.length - 1].year : null;

  // Group by era/decade
  const eras = new Map();
  nodesWithYear.forEach(n => {
    const decade = Math.floor(n.year / 10) * 10;
    if (!eras.has(decade)) eras.set(decade, []);
    eras.get(decade).push(n);
  });

  // Find bottleneck papers (pruning_impact > 0, sorted descending)
  const bottlenecks = nodes
    .filter(n => (n.pruning_impact || 0) > 0 && !n.is_seed)
    .sort((a, b) => (b.pruning_impact || 0) - (a.pruning_impact || 0))
    .slice(0, 10);

  // Count mutation types
  const mutationCounts = {};
  edges.forEach(e => {
    const mt = e.mutation_type || 'unknown';
    mutationCounts[mt] = (mutationCounts[mt] || 0) + 1;
  });

  // Find contradiction edges
  const contradictions = edges.filter(e => e.mutation_type === 'contradiction');

  // Find orphan papers (no descendants in graph, not seed)
  const citedBy = new Map();
  edges.forEach(e => {
    const tgt = typeof e.target === 'object' ? e.target.id : e.target;
    const src = typeof e.source === 'object' ? e.source.id : e.source;
    if (!citedBy.has(tgt)) citedBy.set(tgt, []);
    citedBy.get(tgt).push(src);
  });

  // Identify pivotal transitions with rich descriptions
  const pivotalPapers = [];
  if (nodesWithYear.length >= 3) {
    // Oldest foundation
    const oldest = nodesWithYear[0];
    const oldestField = (oldest.fields_of_study || [])[0] || 'Unknown field';
    // Count how many papers ADOPTED from the oldest
    const oldestDescendants = edges.filter(e => {
      const src = typeof e.source === 'object' ? e.source.id : e.source;
      return src === oldest.id;
    }).length;
    const oldestMutation = edges.find(e => {
      const src = typeof e.source === 'object' ? e.source.id : e.source;
      return src === oldest.id;
    })?.mutation_type || 'adopted';

    pivotalPapers.push({
      paper: oldest,
      label: 'THE FOUNDATION',
      description: `This paper introduced foundational work in ${oldestField} that was ${oldestMutation.toUpperCase()} by ${oldestDescendants} downstream papers. It sits at the deepest root of the lineage — dating back to ${oldest.year}, every subsequent generation builds on ideas that trace through this work.`
    });

    // Top bottleneck (not seed, not oldest)
    const topBn = bottlenecks.find(b => b.id !== oldest.id);
    if (topBn) {
      const bnField = (topBn.fields_of_study || [])[0] || 'this field';
      const bnPct = totalNodes > 1 ? Math.round((topBn.pruning_impact / (totalNodes - 1)) * 100) : 0;
      // Find the dominant mutation type into this bottleneck
      const incomingEdges = edges.filter(e => {
        const tgt = typeof e.target === 'object' ? e.target.id : e.target;
        return tgt === topBn.id;
      });
      const outgoingEdges = edges.filter(e => {
        const src = typeof e.source === 'object' ? e.source.id : e.source;
        return src === topBn.id;
      });
      const dominantMutation = _getDominantMutationType(outgoingEdges);

      pivotalPapers.push({
        paper: topBn,
        label: 'THE TURNING POINT',
        description: `${topBn.pruning_impact || 0} papers (${bnPct}% of the lineage) depend on this work — remove it and ${bnPct}% of this ancestry collapses. Its ideas were primarily ${dominantMutation.toUpperCase()} by ${outgoingEdges.length} subsequent papers, making it the structural chokepoint of the entire lineage.`
      });
    }

    // Seed paper itself
    const seedField = (seedNode.fields_of_study || [])[0] || 'this field';
    const yearSpan = (maxYear || 0) - (minYear || 0);
    const fieldCount = new Set(nodes.flatMap(n => n.fields_of_study || [])).size;
    const bnCount = bottlenecks.length;

    pivotalPapers.push({
      paper: seedNode,
      label: 'THE BREAKTHROUGH',
      description: `The paper being analyzed. It draws on ${edges.length} intellectual connections across ${fieldCount} distinct research fields, spanning ${yearSpan} years of accumulated knowledge. ${bnCount} structurally irreplaceable papers hold this ancestry together.`
    });
  }

  // Helper: get dominant mutation type from a set of edges
  function _getDominantMutationType(edgeList) {
    const counts = {};
    edgeList.forEach(e => {
      const mt = e.mutation_type || 'adoption';
      counts[mt] = (counts[mt] || 0) + 1;
    });
    let max = 0, dominant = 'adoption';
    for (const [mt, c] of Object.entries(counts)) {
      if (c > max) { max = c; dominant = mt; }
    }
    return dominant;
  }

  // Build timeline nodes from era boundaries
  const timelineNodes = [];
  const sortedDecades = [...eras.keys()].sort((a, b) => a - b);
  sortedDecades.forEach(decade => {
    const papers = eras.get(decade);
    const topPaper = papers.sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0))[0];
    timelineNodes.push({
      year: decade,
      label: _getEraLabel(decade, papers, seedNode),
      paperCount: papers.length,
      topPaper: topPaper
    });
  });

  return {
    seedNode,
    nodes,
    edges,
    minYear,
    maxYear,
    eras,
    bottlenecks,
    mutationCounts,
    contradictions,
    pivotalPapers,
    timelineNodes,
    totalNodes,
    totalEdges: edges.length,
  };
}

function _getEraLabel(decade, papers, seedNode, allEras) {
  const seedYear = seedNode?.year || 2020;
  const count = papers.length;

  // Find the most cited paper in this decade for context
  const topPaper = papers.sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0))[0];
  const topField = _getMostCommonField(papers);

  // Unique labels based on decade characteristics
  if (decade + 10 <= 1970) return count <= 3 ? 'Origins' : 'Roots';
  if (decade + 10 <= 1980) return 'Formative era';
  if (decade + 10 <= 1990) return 'Early methods';
  if (decade + 10 <= 2000) return 'Pre-digital';
  if (decade + 10 <= 2005) return 'Modern start';
  if (decade + 10 <= 2010) return count > 20 ? 'Rapid growth' : 'Growth';
  if (decade >= seedYear - 5 && decade <= seedYear) {
    return count > 100 ? 'Explosion' : 'Breakthrough';
  }
  if (decade > seedYear) return 'Aftermath';
  if (count > 200) return 'Peak activity';
  if (count > 50) return 'Expansion';
  return 'Development';
}

function _getMostCommonField(papers) {
  const counts = {};
  papers.forEach(p => {
    (p.fields_of_study || []).forEach(f => {
      counts[f] = (counts[f] || 0) + 1;
    });
  });
  let maxField = null, maxCount = 0;
  for (const [f, c] of Object.entries(counts)) {
    if (c > maxCount) { maxField = f; maxCount = c; }
  }
  return maxField;
}


/* ═══════════════════════════════════════════════════════════════════════
   RENDERERS — Build the 4 sections of the genealogy panel
   ═══════════════════════════════════════════════════════════════════════ */

function renderPivotalMoments(data) {
  const section = document.createElement('div');
  section.className = 'genealogy-section';

  const header = document.createElement('h3');
  header.className = 'genealogy-section-header';
  header.textContent = 'Three moments that made this paper possible';
  section.appendChild(header);

  const container = document.createElement('div');
  container.className = 'pivotal-moments';

  data.pivotalPapers.forEach((pm, i) => {
    const card = document.createElement('div');
    card.className = 'pivotal-card';

    const num = document.createElement('div');
    num.className = 'pivotal-number';
    num.textContent = ['①', '②', '③'][i] || `${i + 1}`;

    const title = document.createElement('div');
    title.className = 'pivotal-title';
    title.textContent = pm.label;

    const year = document.createElement('div');
    year.className = 'pivotal-year';
    year.textContent = pm.paper.year || 'Unknown year';

    const text = document.createElement('div');
    text.className = 'pivotal-text';
    text.textContent = pm.description;

    const paperChip = document.createElement('span');
    paperChip.className = 'paper-chip';
    paperChip.dataset.paperId = pm.paper.id;
    paperChip.textContent = _truncTitle(pm.paper.title, 60);
    paperChip.addEventListener('click', () => _locatePaper(pm.paper.id));

    card.appendChild(num);
    card.appendChild(title);
    card.appendChild(year);
    card.appendChild(paperChip);
    card.appendChild(document.createElement('br'));
    card.appendChild(text);
    container.appendChild(card);

    // Add connector between cards (not after last)
    if (i < data.pivotalPapers.length - 1) {
      const conn = document.createElement('div');
      conn.className = 'pivotal-connector';
      container.appendChild(conn);
    }
  });

  section.appendChild(container);
  return section;
}

function renderTimeline(data) {
  const section = document.createElement('div');
  section.className = 'genealogy-section';

  const header = document.createElement('h3');
  header.className = 'genealogy-section-header';
  header.textContent = 'The lineage';
  section.appendChild(header);

  const timeline = document.createElement('div');
  timeline.className = 'genealogy-timeline';

  const track = document.createElement('div');
  track.className = 'timeline-track';
  timeline.appendChild(track);

  data.timelineNodes.forEach(tn => {
    const node = document.createElement('div');
    node.className = 'timeline-node';
    node.addEventListener('click', () => {
      if (tn.topPaper) _locatePaper(tn.topPaper.id);
    });

    const tooltip = document.createElement('div');
    tooltip.className = 'timeline-tooltip';
    tooltip.textContent = tn.topPaper ? _truncTitle(tn.topPaper.title, 40) : `${tn.paperCount} papers`;

    const yearEl = document.createElement('div');
    yearEl.className = 'timeline-year';
    yearEl.textContent = tn.year + 's';

    const dot = document.createElement('div');
    dot.className = 'timeline-dot';

    const era = document.createElement('div');
    era.className = 'timeline-era';
    era.textContent = tn.label;

    node.appendChild(tooltip);
    node.appendChild(yearEl);
    node.appendChild(dot);
    node.appendChild(era);
    timeline.appendChild(node);
  });

  section.appendChild(timeline);
  return section;
}

function renderNarrativeFromLLM(narrativeText, data) {
  const section = document.createElement('div');
  section.className = 'genealogy-section';

  const header = document.createElement('h3');
  header.className = 'genealogy-section-header';
  header.textContent = 'Full story';
  section.appendChild(header);

  const content = document.createElement('div');
  content.className = 'narrative-chapters';

  // Parse the LLM narrative and enhance it
  const enhanced = _enhanceNarrative(narrativeText, data);
  content.innerHTML = enhanced;

  // Attach locate handlers to paper chips
  content.querySelectorAll('.paper-chip').forEach(chip => {
    chip.addEventListener('click', () => _locatePaper(chip.dataset.paperId));
  });
  content.querySelectorAll('.narrative-locate-btn').forEach(btn => {
    btn.addEventListener('click', () => _locatePaper(btn.dataset.paperId));
  });

  section.appendChild(content);
  return section;
}

function renderContradictions(data) {
  if (!data.contradictions.length) return null;

  const nodes = data.nodes;
  const edges = data.edges;
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  const section = document.createElement('div');
  section.className = 'genealogy-section';

  const header = document.createElement('h3');
  header.className = 'genealogy-section-header';
  header.textContent = 'Contested ideas';
  section.appendChild(header);

  data.contradictions.slice(0, 3).forEach((edge, idx) => {
    const srcId = typeof edge.source === 'object' ? edge.source.id : edge.source;
    const tgtId = typeof edge.target === 'object' ? edge.target.id : edge.target;
    const srcNode = nodeMap.get(srcId);
    const tgtNode = nodeMap.get(tgtId);
    if (!srcNode || !tgtNode) return;

    // Count papers citing each side
    const citeSrc = edges.filter(e => {
      const tgt = typeof e.target === 'object' ? e.target.id : e.target;
      return tgt === srcId;
    }).length;
    const citeTgt = edges.filter(e => {
      const tgt = typeof e.target === 'object' ? e.target.id : e.target;
      return tgt === tgtId;
    }).length;
    // Count papers citing both
    const srcCiters = new Set(edges.filter(e => {
      const tgt = typeof e.target === 'object' ? e.target.id : e.target;
      return tgt === srcId;
    }).map(e => typeof e.source === 'object' ? e.source.id : e.source));
    const tgtCiters = new Set(edges.filter(e => {
      const tgt = typeof e.target === 'object' ? e.target.id : e.target;
      return tgt === tgtId;
    }).map(e => typeof e.source === 'object' ? e.source.id : e.source));
    const citeBoth = [...srcCiters].filter(id => tgtCiters.has(id)).length;

    // Determine which fields the papers are from
    const srcField = (srcNode.fields_of_study || [])[0] || '';
    const tgtField = (tgtNode.fields_of_study || [])[0] || '';

    const detailId = `contradiction-detail-${idx}`;

    const box = document.createElement('div');
    box.className = 'contradiction-callout';

    // Generate "What they disagree about" from paper titles, fields, and edge evidence
    const disagreementTopic = _inferDisagreementTopic(srcNode, tgtNode, edge);
    const srcShort = _truncTitle(srcNode.title, 35);
    const tgtShort = _truncTitle(tgtNode.title, 35);

    // Generate specific "why this matters" based on actual data
    const totalInLineage = data.totalNodes;
    const srcDownstream = (srcNode.pruning_impact || 0);
    const tgtDownstream = (tgtNode.pruning_impact || 0);
    const whyMatters = _generateWhyMatters(srcNode, tgtNode, srcField, tgtField, citeSrc, citeTgt, citeBoth, srcDownstream, tgtDownstream, totalInLineage);

    box.innerHTML = `
      <div class="contradiction-header">⚡ Contested idea</div>
      <div class="contradiction-papers">
        <div class="contradiction-paper">
          <span class="paper-chip" data-paper-id="${_esc(srcId)}">"${_esc(_truncTitle(srcNode.title, 60))}"</span>
          <br><small style="color:#666">${_esc(srcNode.authors?.[0] || '')} · ${srcNode.year || ''} · ${(srcNode.citation_count || 0).toLocaleString()} citations</small>
        </div>
        <div class="contradiction-divider">── CONTRADICTED BY ──</div>
        <div class="contradiction-paper">
          <span class="paper-chip" data-paper-id="${_esc(tgtId)}">"${_esc(_truncTitle(tgtNode.title, 60))}"</span>
          <br><small style="color:#666">${_esc(tgtNode.authors?.[0] || '')} · ${tgtNode.year || ''} · ${(tgtNode.citation_count || 0).toLocaleString()} citations</small>
        </div>
      </div>
      <button class="contradiction-expand-btn" data-target="${detailId}" aria-expanded="false">
        Show details ▼
      </button>
      <div id="${detailId}" class="contradiction-details" style="display:none">
        <div class="contradiction-detail-section">
          <div class="contradiction-detail-label">WHAT THEY DISAGREE ABOUT</div>
          <div class="contradiction-detail-text">
            ${_esc(disagreementTopic)}
          </div>
        </div>
        <div class="contradiction-detail-section">
          <div class="contradiction-detail-label">THE LINEAGE SPLIT</div>
          <div class="contradiction-detail-text">
            ${citeSrc} paper${citeSrc !== 1 ? 's' : ''} in this lineage cite "${_esc(srcShort)}".<br>
            ${citeTgt} paper${citeTgt !== 1 ? 's' : ''} cite "${_esc(tgtShort)}".<br>
            ${citeBoth > 0
              ? `Only ${citeBoth} paper${citeBoth > 1 ? 's' : ''} cite both, suggesting most researchers chose one side without acknowledging the tension.`
              : `No papers cite both. The field has completely split on this question without any work attempting to reconcile the approaches.`
            }
          </div>
        </div>
        <div class="contradiction-detail-section">
          <div class="contradiction-detail-label">WHY THIS MATTERS</div>
          <div class="contradiction-detail-text">
            ${_esc(whyMatters)}
          </div>
        </div>
      </div>
    `;

    // Wire up collapsible toggle
    const expandBtn = box.querySelector('.contradiction-expand-btn');
    expandBtn.addEventListener('click', () => {
      const detail = box.querySelector(`#${detailId}`);
      const isOpen = detail.style.display !== 'none';
      detail.style.display = isOpen ? 'none' : 'block';
      expandBtn.textContent = isOpen ? 'Show details ▼' : 'Hide details ▲';
      expandBtn.setAttribute('aria-expanded', String(!isOpen));
    });

    // Wire up paper chips
    box.querySelectorAll('.paper-chip').forEach(chip => {
      chip.addEventListener('click', () => _locatePaper(chip.dataset.paperId));
    });

    section.appendChild(box);
  });

  return section;
}

function renderPathsAbandoned(data) {
  // Get orphan data from the existing orphan panel
  const orphanData = window._graphLoader?._graphData?.orphan_ideas;
  const orphans = Array.isArray(orphanData) ? orphanData : [];
  if (!orphans.length) return null;

  const section = document.createElement('div');
  section.className = 'genealogy-section';

  const header = document.createElement('h3');
  header.className = 'genealogy-section-header';
  header.textContent = 'Paths abandoned';
  section.appendChild(header);

  const intro = document.createElement('div');
  intro.className = 'abandoned-intro';
  intro.textContent = 'While the lineage converged on its dominant approach, these ideas were left behind:';
  section.appendChild(intro);

  orphans.slice(0, 4).forEach(orphan => {
    const card = document.createElement('div');
    card.className = 'abandoned-card';

    const mark = document.createElement('div');
    mark.className = 'abandoned-mark';
    mark.textContent = '✕';

    const title = document.createElement('div');
    title.className = 'abandoned-title';
    title.textContent = `"${_truncTitle(orphan.title || 'Unknown', 60)}" (${orphan.year || '?'})`;

    const meta = document.createElement('div');
    meta.className = 'abandoned-meta';
    meta.textContent = `${(orphan.citation_count || 0).toLocaleString()} citations elsewhere · 0 descendants here`;

    const text = document.createElement('div');
    text.className = 'abandoned-text';
    const fields = (orphan.fields_of_study || []).slice(0, 3).join(', ');
    text.textContent = fields
      ? `From ${fields}. This approach was not adopted within the lineage, suggesting a potential research gap.`
      : 'This idea was introduced but never adopted by subsequent work in this lineage.';

    card.appendChild(mark);
    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(text);
    section.appendChild(card);
  });

  return section;
}


/* ═══════════════════════════════════════════════════════════════════════
   NARRATIVE ENHANCEMENT — Parse LLM text and add visual elements
   ═══════════════════════════════════════════════════════════════════════ */

function _enhanceNarrative(text, data) {
  if (!text) return '<p class="chapter-text" style="color:#999">No narrative available.</p>';

  // Step 1: Force chapter headings onto their own lines.
  // LLM sometimes puts "THE HEADING (YEARS)" inline with text.
  // Split them out so they become block elements.
  let processed = text;

  // Pattern: ALL-CAPS heading with year range, e.g. "THE FOUNDATIONS (1956-1970)"
  // Insert newlines before and after to ensure block separation
  processed = processed.replace(
    /\s*(THE\s+[A-Z][A-Z\s]+\([0-9]{4}[\s\-–]+[0-9]{4}\))\s*/g,
    '\n\n$1\n\n'
  );
  // Also handle headings without year ranges: "THE BREAKTHROUGH" etc.
  processed = processed.replace(
    /\s*(THE\s+[A-Z][A-Z\s]{5,})\s*(?=\n|[A-Z"])/g,
    '\n\n$1\n\n'
  );

  // Step 2: Remove generic LLM filler closing sentences
  const fillerPatterns = [
    /As researchers continue to build upon.*$/gm,
    /This lineage is a testament to.*$/gm,
    /The field is expected to further evolve.*$/gm,
    /In conclusion,.*$/gm,
    /Overall, this.*demonstrates the.*$/gm,
    /This rich and complex.*$/gm,
  ];
  fillerPatterns.forEach(p => { processed = processed.replace(p, ''); });

  // Step 3: Escape HTML
  let html = _esc(processed);

  // Step 4: Make paper titles clickable
  data.nodes.forEach(n => {
    if (!n.title || n.title.length < 10) return;
    const shortTitle = _truncTitle(n.title, 60);
    const escaped = _escRegex(_esc(shortTitle));
    // Match &quot;Title&quot; or "Title" patterns (HTML-escaped quotes)
    const patterns = [
      new RegExp(`&quot;${escaped}&quot;`, 'gi'),
      new RegExp(`"${escaped}"`, 'gi'),
    ];
    patterns.forEach(pattern => {
      html = html.replace(pattern, (match) => {
        return `<span class="paper-chip" data-paper-id="${_esc(n.id)}">${match}</span>`;
      });
    });
  });

  // Step 5: Highlight mutation verbs
  const mutationVerbs = ['ADOPTED', 'GENERALIZED', 'SPECIALIZED', 'CONTRADICTED', 'EXTENDED', 'HYBRIDIZED', 'REVIVED', 'GENERALIZATION'];
  mutationVerbs.forEach(verb => {
    html = html.replace(new RegExp(`\\b${verb}\\b`, 'g'),
      `<span class="mutation-verb">${verb}</span>`);
  });

  // Step 6: Add bottleneck badges inline
  data.bottlenecks.slice(0, 5).forEach(bn => {
    const badge = `<span class="narrative-paper-badge">█ BOTTLENECK — ${bn.pruning_impact || 0} papers</span>`;
    const pattern = new RegExp(`(data-paper-id="${_esc(bn.id)}">[^<]+<\\/span>)`, 'g');
    html = html.replace(pattern, `$1 ${badge}`);
  });

  // Step 7: Convert chapter headings to block elements
  // Match THE SOMETHING (YEARS) or THE SOMETHING on its own line
  html = html.replace(
    /^(THE\s+[A-Z][A-Z\s\(\)\-–\d,]{5,})$/gm,
    '</p><div class="narrative-chapter"><h4 class="chapter-heading">$1</h4>'
  );

  // Step 8: Wrap remaining text in paragraphs
  // Split on double newlines
  const parts = html.split(/\n{2,}/);
  html = parts.map(p => {
    p = p.trim();
    if (!p) return '';
    if (p.startsWith('</p><div')) return p; // chapter heading
    if (p.startsWith('<div')) return p;
    if (p.startsWith('<h4')) return `<div class="narrative-chapter">${p}`;
    return `<p class="chapter-text">${p}</p>`;
  }).join('\n');

  // Clean up any orphaned tags
  html = html.replace(/<p class="chapter-text"><\/p>/g, '');
  html = html.replace(/^\s*<\/p>/gm, '');

  return html;
}


/* ═══════════════════════════════════════════════════════════════════════
   TYPEWRITER EFFECT
   ═══════════════════════════════════════════════════════════════════════ */

function typewriterReveal(container, onComplete) {
  // Get all text nodes in the container
  const textElements = container.querySelectorAll('.pivotal-text, .chapter-text, .abandoned-text, .contradiction-stats, .abandoned-intro');
  if (!textElements.length) { if (onComplete) onComplete(); return; }

  // Store original text, hide it
  const items = [];
  textElements.forEach(el => {
    items.push({ el, text: el.textContent, index: 0 });
    el.textContent = '';
    el.style.visibility = 'visible';
  });

  // Add cursor to first element
  const cursor = document.createElement('span');
  cursor.className = 'genealogy-cursor';

  let currentItem = 0;
  let skipped = false;

  function revealNext() {
    if (skipped || currentItem >= items.length) {
      cursor.remove();
      if (onComplete) onComplete();
      return;
    }

    const item = items[currentItem];
    if (item.index < item.text.length) {
      // Reveal next character
      item.el.textContent = item.text.slice(0, item.index + 1);
      item.el.appendChild(cursor);
      item.index++;
      // Speed: headers and short text faster, body text normal
      const delay = item.text.length < 50 ? 15 : 25;
      setTimeout(revealNext, delay);
    } else {
      // Move to next text element
      cursor.remove();
      currentItem++;
      if (currentItem < items.length) {
        items[currentItem].el.appendChild(cursor);
        setTimeout(revealNext, 100);
      } else {
        revealNext();
      }
    }
  }

  // Start after a brief pause
  if (items[0]) items[0].el.appendChild(cursor);
  setTimeout(revealNext, 300);

  // Return skip function
  return () => {
    skipped = true;
    cursor.remove();
    items.forEach(item => {
      item.el.textContent = item.text;
    });
    if (onComplete) onComplete();
  };
}


/* ═══════════════════════════════════════════════════════════════════════
   MAIN ENTRY — Trigger genealogy story in the slide-out panel
   ═══════════════════════════════════════════════════════════════════════ */

function triggerEnhancedGenealogy() {
  const modal = document.getElementById('genealogy-modal');
  const content = document.getElementById('genealogy-content');
  if (!modal || !content) return;

  // Extract graph data
  const data = extractGenealogyData();

  // Show loader
  content.innerHTML = '';
  const loader = createDotMatrixLoader();
  content.appendChild(loader);
  modal.showModal();

  if (!data) {
    loader._stopAnimation();
    content.innerHTML = '<div style="padding:40px;text-align:center;color:#666">No graph data loaded yet. Build a graph first.</div>';
    return;
  }

  const paperId = window.ARIVU_CONFIG?.paperId;
  const resolvedId = window._graphLoader?.paperId || paperId;

  if (!resolvedId) {
    loader._stopAnimation();
    content.innerHTML = '<div style="padding:40px;text-align:center;color:#666">No paper loaded.</div>';
    return;
  }

  // Fetch narrative from API
  fetch(`/api/genealogy/${encodeURIComponent(resolvedId)}`)
    .then(r => r.json())
    .then(apiData => {
      loader._stopAnimation();
      content.innerHTML = '';

      const panel = document.createElement('div');
      panel.className = 'genealogy-panel';
      panel.style.position = 'relative';

      // Section 1: Pivotal Moments
      panel.appendChild(renderPivotalMoments(data));

      // Section 2: Timeline
      panel.appendChild(renderTimeline(data));

      // Section 3: Full Narrative (from LLM or fallback)
      const narrative = apiData.narrative || _buildFallbackNarrative(data);
      panel.appendChild(renderNarrativeFromLLM(narrative, data));

      // Section 3b: Contradictions
      const contradictionEl = renderContradictions(data);
      if (contradictionEl) panel.appendChild(contradictionEl);

      // Section 4: Paths Abandoned
      const abandonedEl = renderPathsAbandoned(data);
      if (abandonedEl) panel.appendChild(abandonedEl);

      content.appendChild(panel);

      // Add skip button
      const skipBtn = document.createElement('button');
      skipBtn.className = 'genealogy-skip-btn';
      skipBtn.textContent = 'Skip ▶▶';
      panel.appendChild(skipBtn);

      // Start typewriter effect
      const skipFn = typewriterReveal(panel, () => {
        skipBtn.remove();
      });

      skipBtn.addEventListener('click', () => {
        if (skipFn) skipFn();
        skipBtn.remove();
      });

      // Also skip on click anywhere in the panel
      panel.addEventListener('click', (e) => {
        if (e.target.closest('.paper-chip, .narrative-locate-btn, .timeline-node, .genealogy-skip-btn')) return;
        if (skipFn) skipFn();
        skipBtn.remove();
      });
    })
    .catch(err => {
      console.error('Genealogy fetch failed:', err);
      loader._stopAnimation();
      content.innerHTML = '';

      // Render with client-side fallback
      const panel = document.createElement('div');
      panel.className = 'genealogy-panel';

      panel.appendChild(renderPivotalMoments(data));
      panel.appendChild(renderTimeline(data));
      panel.appendChild(renderNarrativeFromLLM(_buildFallbackNarrative(data), data));

      const contradictionEl = renderContradictions(data);
      if (contradictionEl) panel.appendChild(contradictionEl);

      const abandonedEl = renderPathsAbandoned(data);
      if (abandonedEl) panel.appendChild(abandonedEl);

      content.appendChild(panel);
      typewriterReveal(panel);
    });
}


/* ═══════════════════════════════════════════════════════════════════════
   FALLBACK NARRATIVE — When Groq is unavailable
   ═══════════════════════════════════════════════════════════════════════ */

function _buildFallbackNarrative(data) {
  const seed = data.seedNode;
  const bn = data.bottlenecks;
  const mc = data.mutationCounts;
  const totalEdges = data.totalEdges;

  // Count mutation percentages
  const adoptionPct = totalEdges > 0 ? Math.round(((mc.adoption || 0) / totalEdges) * 100) : 0;
  const genPct = totalEdges > 0 ? Math.round(((mc.generalization || 0) / totalEdges) * 100) : 0;
  const contrPct = totalEdges > 0 ? Math.round(((mc.contradiction || 0) / totalEdges) * 100) : 0;

  let text = '';

  // Era: Foundations
  if (data.minYear && data.minYear < 2000) {
    const oldPapers = data.nodes.filter(n => n.year && n.year < 2000).slice(0, 3);
    text += `THE FOUNDATIONS (${data.minYear}-2000)\n\n`;
    text += `The oldest roots of this lineage reach back to ${data.minYear}. `;
    if (oldPapers.length) {
      text += `"${oldPapers[0].title}" (${oldPapers[0].year}) established early ideas that would be ADOPTED by later generations. `;
    }
    text += `These foundational papers provided the theoretical ground on which the field would build.\n\n`;
  }

  // Era: Growth
  const growthPapers = data.nodes.filter(n => n.year && n.year >= 2000 && n.year < 2015);
  if (growthPapers.length > 5) {
    text += `THE GROWTH PERIOD (2000-2015)\n\n`;
    text += `${growthPapers.length} papers from this period expanded the field. `;
    if (genPct > 10) {
      text += `${genPct}% of connections involve GENERALIZED approaches, where ideas were extended beyond their original scope. `;
    }
    const topGrowth = growthPapers.sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0))[0];
    if (topGrowth) {
      text += `"${topGrowth.title}" (${topGrowth.year}) became a key reference with ${(topGrowth.citation_count || 0).toLocaleString()} citations.\n\n`;
    }
  }

  // Era: Breakthrough
  text += `THE BREAKTHROUGH (${(seed.year || 2020) - 2}-${seed.year || 2020})\n\n`;
  text += `"${seed.title}" (${seed.year}) represents the culmination of this lineage. `;
  if (bn.length > 0) {
    text += `${bn.length} structurally irreplaceable papers hold this ancestry together. `;
    text += `The most critical is "${bn[0].title}" (${bn[0].year}), supporting ${bn[0].pruning_impact || 0} descendants. `;
  }
  text += `${adoptionPct}% of intellectual connections are direct ADOPTED methods. `;
  if (contrPct > 0) {
    text += `${contrPct}% involve CONTRADICTED assumptions, showing the field has some internal debate.`;
  }

  return text;
}


/* ═══════════════════════════════════════════════════════════════════════
   CONTRADICTION ANALYSIS HELPERS
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Infer what two contradicting papers disagree about based on their
 * titles, fields, years, and edge evidence.
 */
function _inferDisagreementTopic(srcNode, tgtNode, edge) {
  const srcTitle = srcNode.title || '';
  const tgtTitle = tgtNode.title || '';
  const srcFields = (srcNode.fields_of_study || []).slice(0, 3);
  const tgtFields = (tgtNode.fields_of_study || []).slice(0, 3);
  const evidence = edge.mutation_evidence || edge.citing_sentence || '';
  const srcYear = srcNode.year || '?';
  const tgtYear = tgtNode.year || '?';

  // Extract key terms from titles (words > 4 chars, not common words)
  const stopWords = new Set(['with', 'from', 'that', 'this', 'their', 'using', 'based', 'through', 'about', 'between', 'learning', 'neural', 'network', 'networks', 'paper', 'approach', 'method']);
  const extractTerms = (title) => title.split(/[\s\-:,]+/)
    .filter(w => w.length > 4 && !stopWords.has(w.toLowerCase()))
    .map(w => w.replace(/[^\w]/g, ''))
    .filter(w => w.length > 0)
    .slice(0, 5);

  const srcTerms = extractTerms(srcTitle);
  const tgtTerms = extractTerms(tgtTitle);

  // Find shared terms (common ground) and unique terms (the disagreement)
  const srcSet = new Set(srcTerms.map(t => t.toLowerCase()));
  const tgtSet = new Set(tgtTerms.map(t => t.toLowerCase()));
  const shared = [...srcSet].filter(t => tgtSet.has(t));
  const srcUnique = srcTerms.filter(t => !tgtSet.has(t.toLowerCase())).slice(0, 3);
  const tgtUnique = tgtTerms.filter(t => !srcSet.has(t.toLowerCase())).slice(0, 3);

  // If we have edge evidence, use it
  if (evidence && evidence.length > 20) {
    return `${evidence.slice(0, 250)}`;
  }

  // Build a contextual description
  const sharedTopic = shared.length > 0
    ? `Both papers address ${shared.join(', ')}`
    : `These papers approach related problems from different angles`;

  const yearGap = Math.abs((srcNode.year || 2000) - (tgtNode.year || 2000));
  const fieldDiff = srcFields[0] !== tgtFields[0] && srcFields[0] && tgtFields[0];

  let disagreement = `${sharedTopic}. `;

  if (srcUnique.length > 0 && tgtUnique.length > 0) {
    disagreement += `"${_truncTitle(srcTitle, 40)}" focuses on ${srcUnique.join(', ').toLowerCase()}, while "${_truncTitle(tgtTitle, 40)}" emphasizes ${tgtUnique.join(', ').toLowerCase()}. `;
  }

  if (fieldDiff) {
    disagreement += `The contradiction spans ${srcFields[0]} and ${tgtFields[0]}, indicating a cross-disciplinary methodological disagreement. `;
  } else if (yearGap > 10) {
    disagreement += `The ${yearGap}-year gap between these papers (${srcYear} vs ${tgtYear}) suggests the later work challenges established assumptions from the earlier period. `;
  } else {
    disagreement += `Published ${yearGap <= 2 ? 'around the same time' : 'within a few years'}, these papers represent competing contemporaneous approaches to the same problem. `;
  }

  return disagreement.trim();
}

/**
 * Generate specific "why this matters" text based on actual lineage data.
 */
function _generateWhyMatters(srcNode, tgtNode, srcField, tgtField, citeSrc, citeTgt, citeBoth, srcDownstream, tgtDownstream, totalInLineage) {
  const parts = [];

  // Structural impact
  if (srcDownstream > 0 || tgtDownstream > 0) {
    const dominant = srcDownstream > tgtDownstream ? srcNode : tgtNode;
    const minor = srcDownstream > tgtDownstream ? tgtNode : srcNode;
    const domCount = Math.max(srcDownstream, tgtDownstream);
    const minCount = Math.min(srcDownstream, tgtDownstream);
    const domPct = totalInLineage > 1 ? Math.round((domCount / (totalInLineage - 1)) * 100) : 0;

    if (domPct > 10) {
      parts.push(`"${_truncTitle(dominant.title, 40)}" supports ${domCount} papers (${domPct}% of this lineage), giving its approach structural dominance. If its assumptions are wrong, ${domPct}% of this research direction is at risk.`);
    }
  }

  // Citation asymmetry
  if (citeSrc > 0 && citeTgt > 0) {
    const ratio = Math.max(citeSrc, citeTgt) / Math.min(citeSrc, citeTgt);
    if (ratio > 2) {
      const favored = citeSrc > citeTgt ? srcNode : tgtNode;
      parts.push(`The lineage favors "${_truncTitle(favored.title, 35)}" by a ${ratio.toFixed(1)}:1 citation ratio, but this doesn't mean it's correct. The less-cited approach may offer overlooked insights.`);
    }
  }

  // No resolution
  if (citeBoth === 0) {
    parts.push(`No paper in this lineage attempts to reconcile these approaches. A synthesis paper that addresses both perspectives could fill a significant structural gap.`);
  } else if (citeBoth <= 2) {
    parts.push(`Only ${citeBoth} paper${citeBoth > 1 ? 's' : ''} acknowledge${citeBoth === 1 ? 's' : ''} both sides, meaning the disagreement is mostly invisible to researchers working within either camp.`);
  }

  // Field boundary
  if (srcField && tgtField && srcField !== tgtField) {
    parts.push(`This crosses the ${srcField}/${tgtField} boundary, which often means the disagreement stems from different evaluation criteria rather than different evidence.`);
  }

  if (parts.length === 0) {
    parts.push(`Papers downstream of this split may be building on incompatible assumptions without realizing it. Researchers citing either paper should be aware of the alternative approach.`);
  }

  return parts.join(' ');
}


/* ═══════════════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════════════════ */

function _locatePaper(paperId) {
  if (!paperId) return;
  const graph = window._arivuGraph;
  if (!graph) return;

  // Find the node
  const node = graph.allNodes?.find(n => n.id === paperId);
  if (!node || typeof node.x !== 'number') return;

  // Zoom to it
  if (graph.svg && graph.zoom) {
    const transform = d3.zoomIdentity
      .translate(graph.svg.node().clientWidth / 2, graph.svg.node().clientHeight / 2)
      .scale(2)
      .translate(-node.x, -node.y);
    graph.svg.transition().duration(750).call(graph.zoom.transform, transform);
  }

  // Pulse the node
  if (graph.nodeGroup) {
    const nodeEl = graph.nodeGroup.select(`g.node[data-id="${paperId}"]`);
    if (!nodeEl.empty()) {
      const circle = nodeEl.select('circle');
      if (!circle.empty()) {
        const origR = parseFloat(circle.attr('r')) || 6;
        const origStroke = circle.attr('stroke');
        circle
          .transition().duration(200).attr('r', origR * 2).attr('stroke', '#D4A843').attr('stroke-width', 3)
          .transition().duration(200).attr('r', origR * 1.5).attr('stroke', '#D4A843').attr('stroke-width', 2)
          .transition().duration(1500).attr('r', origR).attr('stroke', origStroke || '#6B7280').attr('stroke-width', 1);
      }
    }
  }
}

function _truncTitle(title, max) {
  if (!title) return 'Unknown';
  return title.length > max ? title.slice(0, max) + '...' : title;
}

function _esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function _escRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


/* ═══════════════════════════════════════════════════════════════════════
   EXPORTS — Make available to sidebar.js
   ═══════════════════════════════════════════════════════════════════════ */

window.triggerEnhancedGenealogy = triggerEnhancedGenealogy;
