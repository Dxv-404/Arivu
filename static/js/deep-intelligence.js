/**
 * static/js/deep-intelligence.js
 * Deep Intelligence Module — Architects view with Nothing OS dot matrix aesthetic.
 * All visualizations use actual SVG circle grids, not CSS overlays.
 * Handles: dot switching, author analysis, constellation rendering, window content.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 1 — DOT SWITCHING SYSTEM (generic, reusable)
   ═══════════════════════════════════════════════════════════════════════════ */

class DotSwitcher {
  constructor() {
    this._views = new Map();
    this._activeIndexes = new Map();
    this._containers = new Map();
    this._subtitles = new Map();
    this._titles = new Map();
    this._init();
  }

  _init() {
    document.querySelectorAll('.pagination-dots').forEach(dotsEl => {
      const section = dotsEl.dataset.section;
      if (!section) return;
      dotsEl.querySelectorAll('.dot').forEach(dot => {
        dot.style.cursor = 'pointer';
        dot.addEventListener('click', () => {
          const idx = parseInt(dot.dataset.index, 10);
          if (!isNaN(idx)) this.switchTo(section, idx);
        });
      });
      this._activeIndexes.set(section, 0);
    });
  }

  registerView(section, index, renderFn, contentContainer, subtitle, title) {
    if (!this._views.has(section)) this._views.set(section, {});
    this._views.get(section)[index] = renderFn;
    if (contentContainer && !this._containers.has(section)) {
      this._containers.set(section, contentContainer);
    }
    if (subtitle) {
      if (!this._subtitles.has(section)) this._subtitles.set(section, {});
      this._subtitles.get(section)[index] = subtitle;
    }
    if (title) {
      if (!this._titles.has(section)) this._titles.set(section, {});
      this._titles.get(section)[index] = title;
    }
  }

  switchTo(section, index) {
    const views = this._views.get(section);
    if (!views || !views[index]) return;
    const current = this._activeIndexes.get(section);
    if (current === index) return;

    // Update dot visuals
    const dotsEl = document.querySelector(`.pagination-dots[data-section="${section}"]`);
    if (dotsEl) {
      dotsEl.querySelectorAll('.dot').forEach(d => d.classList.remove('active'));
      dotsEl.querySelector(`.dot[data-index="${index}"]`)?.classList.add('active');
    }
    this._activeIndexes.set(section, index);

    // Update title and subtitle
    const sectionEl = document.getElementById(`${section}-section`);
    const titles = this._titles.get(section);
    if (titles?.[index] && sectionEl) {
      const titleEl = sectionEl.querySelector('.panel-card-header h3');
      if (titleEl) {
        // Preserve any badges (like score badges) inside the h3
        const badge = titleEl.querySelector('.score-badge');
        titleEl.textContent = titles[index] + ' ';
        if (badge) titleEl.appendChild(badge);
      }
    }
    const subtitles = this._subtitles.get(section);
    if (subtitles?.[index] && sectionEl) {
      const subEl = sectionEl.querySelector('.panel-sub');
      if (subEl) subEl.textContent = subtitles[index];
    }

    // Swap content
    const container = this._containers.get(section);
    if (!container) return;
    container.style.transition = 'opacity 0.2s ease';
    container.style.opacity = '0';
    setTimeout(() => {
      // Update window button INSIDE the timeout — use closure index to avoid race condition
      if (section === 'dna') {
        const sectionEl = document.getElementById('dna-section');
        const winBtn = sectionEl?.querySelector('.window-icon-btn');
        if (winBtn) winBtn.dataset.window = index === 0 ? 'dna' : index === 1 ? 'architects' : index === 2 ? 'momentum' : index === 3 ? 'pathfinder' : 'dna';
      }
      if (section === 'diversity') {
        const sectionEl = document.getElementById('diversity-section');
        const winBtn = sectionEl?.querySelector('.window-icon-btn');
        if (winBtn) winBtn.dataset.window = index === 0 ? 'diversity' : index === 1 ? 'idea-flow' : index === 2 ? 'blindspots' : index === 3 ? 'trust-evidence' : 'diversity';
      }
      container.querySelectorAll('[data-dot-view]').forEach(v => v.style.display = 'none');
      let targetView = container.querySelector(`[data-dot-view="${index}"]`);
      if (!targetView) {
        targetView = document.createElement('div');
        targetView.dataset.dotView = String(index);
        container.appendChild(targetView);
        views[index](targetView);
      }
      targetView.style.display = '';
      container.style.opacity = '1';

      // Dispatch dot-switched event for character personality system
      window.dispatchEvent(new CustomEvent('arivu:dot-switched', {
        detail: { container: section, fromIndex: current, toIndex: index }
      }));
    }, 200);
  }

  getActiveIndex(section) { return this._activeIndexes.get(section) || 0; }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 2 — ARCHITECT ANALYSIS ENGINE (pure client-side computation)
   ═══════════════════════════════════════════════════════════════════════════ */

class ArchitectAnalyzer {
  constructor(graphData) {
    this._graphData = graphData;
    this._nodes = graphData?.nodes || [];
    this._edges = (graphData?.edges || []).map(e => ({
      ...e, source: _edgeId(e.source), target: _edgeId(e.target),
    }));
    this._dnaClusters = graphData?.dna_profile?.clusters || [];
    this._result = null;
  }

  analyze() {
    if (this._result) return this._result;
    const authorMap = new Map();
    const totalNodes = this._nodes.length;
    const paperLookup = new Map();
    this._nodes.forEach(n => paperLookup.set(n.id, n));

    const paperToCluster = new Map();
    this._dnaClusters.forEach(c => (c.papers || []).forEach(pid => paperToCluster.set(pid, c.name)));

    this._nodes.forEach(node => {
      (node.authors || []).forEach(authorName => {
        if (!authorName?.trim()) return;
        const name = authorName.trim();
        if (!authorMap.has(name)) {
          authorMap.set(name, {
            name, papers: [], paperIds: new Set(), totalImpact: 0, maxSingleImpact: 0,
            bottleneckCount: 0, clusters: new Set(), years: [], depths: [],
            mutationTypes: {}, citationIntents: {},
            totalCitations: 0, inDegree: 0,
          });
        }
        const a = authorMap.get(name);
        a.papers.push({ id: node.id, title: node.title, year: node.year });
        a.paperIds.add(node.id);
        a.totalImpact += (node.pruning_impact || 0);
        a.maxSingleImpact = Math.max(a.maxSingleImpact, node.pruning_impact || 0);
        a.totalCitations += (node.citation_count || 0);
        if (node.is_bottleneck) a.bottleneckCount++;
        const cluster = paperToCluster.get(node.id);
        if (cluster) a.clusters.add(cluster);
        if (node.year) a.years.push(node.year);
        if (node.depth != null) a.depths.push(node.depth);
      });
    });

    this._edges.forEach(edge => {
      const sourceNode = paperLookup.get(edge.source);
      if (!sourceNode) return;
      (sourceNode.authors || []).forEach(authorName => {
        const a = authorMap.get(authorName?.trim());
        if (!a) return;
        const mt = edge.mutation_type || 'unknown';
        a.mutationTypes[mt] = (a.mutationTypes[mt] || 0) + 1;
        const ci = edge.citation_intent || 'unknown';
        a.citationIntents[ci] = (a.citationIntents[ci] || 0) + 1;
      });
      // Count in-degree: edges pointing TO this author's papers
      const targetNode = paperLookup.get(edge.target);
      if (targetNode && edge.mutation_type !== 'incidental') {
        (targetNode.authors || []).forEach(authorName => {
          const a = authorMap.get(authorName?.trim());
          if (a) a.inDegree++;
        });
      }
    });

    const allAuthors = Array.from(authorMap.values()).map(a => {
      const yearRange = a.years.length > 0 ? { min: Math.min(...a.years), max: Math.max(...a.years) } : null;
      const avgDepth = a.depths.length > 0 ? a.depths.reduce((s, d) => s + d, 0) / a.depths.length : 0;
      const dominantMutation = Object.entries(a.mutationTypes).sort((x, y) => y[1] - x[1])[0];

      // Classify author archetype
      let archetype = 'contributor';
      if (a.bottleneckCount > 0 && a.maxSingleImpact > 20) archetype = 'bottleneck';
      else if (a.clusters.size > 1) archetype = 'bridge';
      else if (avgDepth > 1.5 && yearRange && yearRange.max < 2005) archetype = 'pioneer';
      else if (a.papers.length > 5 && a.maxSingleImpact < 5) archetype = 'prolific';

      // Normalize citation count to 0-100 scale for scoring
      const citationScore = Math.min(100, Math.log10(Math.max(a.totalCitations, 1)) * 20);

      return {
        name: a.name, papers: a.papers, paperIds: a.paperIds,
        paperCount: a.papers.length, clusterCount: a.clusters.size,
        clusterNames: Array.from(a.clusters),
        maxImpact: Math.min(100, Math.round(a.maxSingleImpact * 10) / 10),
        totalImpact: a.totalImpact, bottleneckCount: a.bottleneckCount,
        totalCitations: a.totalCitations, inDegree: a.inDegree,
        yearRange, avgDepth: Math.round(avgDepth * 10) / 10,
        dominantMutation: dominantMutation ? dominantMutation[0] : 'unknown',
        dominantMutationCount: dominantMutation ? dominantMutation[1] : 0,
        archetype,
        // Power formula: balances structural criticality with historical importance
        // pruning impact (what breaks), citations (community recognition),
        // in-degree (how many papers in THIS graph cite them), paper count, bottlenecks
        structuralPower:
          (a.papers.length * 2) +           // Paper count: 15%
          (a.totalImpact * 0.30) +          // Pruning impact: 25%
          (a.bottleneckCount * 10) +        // Bottleneck bonus: 10%
          (citationScore * 0.30) +          // Citation influence: 25%
          (a.inDegree * 1.5) +             // In-graph influence: 20%
          (a.clusters.size * 3),            // Cross-cluster breadth: 5%
      };
    });

    allAuthors.sort((a, b) => b.structuralPower - a.structuralPower);
    const maxPower = allAuthors[0]?.structuralPower || 1;
    allAuthors.forEach(a => { a.normalizedPower = Math.round((a.structuralPower / maxPower) * 100); });

    const coAuthorLinks = this._computeCoAuthorLinks();
    const citationLinks = this._computeCitationLinks();

    const totalImpact = allAuthors.reduce((s, a) => s + a.totalImpact, 0) || 1;
    const top3Impact = allAuthors.slice(0, 3).reduce((s, a) => s + a.totalImpact, 0);
    const top5Impact = allAuthors.slice(0, 5).reduce((s, a) => s + a.totalImpact, 0);
    const top3Pct = Math.min(100, Math.round((top3Impact / totalImpact) * 100));
    const top5Pct = Math.min(100, Math.round((top5Impact / totalImpact) * 100));

    let concentrationLevel = 'LOW', concentrationColor = '#22C55E';
    if (top3Pct > 70) { concentrationLevel = 'HIGH'; concentrationColor = '#EF4444'; }
    else if (top3Pct > 45) { concentrationLevel = 'MODERATE'; concentrationColor = '#F59E0B'; }

    const generations = this._computeGenerations(allAuthors);
    const strongestCollab = coAuthorLinks[0] || null;
    const seedNode = this._nodes.find(n => n.is_seed);
    const allYears = allAuthors.filter(a => a.yearRange).flatMap(a => [a.yearRange.min, a.yearRange.max]);
    const yearSpan = allYears.length >= 2 ? (Math.max(...allYears) - Math.min(...allYears)) : 0;

    this._result = {
      allAuthors, topAuthors: allAuthors.slice(0, 10), totalAuthors: allAuthors.length,
      totalNodes, coAuthorLinks, citationLinks, top3Pct, top5Pct,
      concentrationLevel, concentrationColor, generations, strongestCollab,
      seedYear: seedNode?.year || new Date().getFullYear(), yearSpan,
      top3Names: allAuthors.slice(0, 3).map(a => a.name.split(' ').pop()).join(', '),
    };
    return this._result;
  }

  _computeCoAuthorLinks() {
    const links = new Map();
    this._nodes.forEach(node => {
      const authors = (node.authors || []).map(a => a?.trim()).filter(Boolean);
      for (let i = 0; i < authors.length; i++) {
        for (let j = i + 1; j < authors.length; j++) {
          const key = [authors[i], authors[j]].sort().join('|||');
          links.set(key, (links.get(key) || 0) + 1);
        }
      }
    });
    return Array.from(links.entries())
      .map(([key, count]) => { const [a, b] = key.split('|||'); return { source: a, target: b, count, type: 'coauthor' }; })
      .sort((a, b) => b.count - a.count);
  }

  _computeCitationLinks() {
    const links = new Map();
    const nodeLookup = new Map(this._nodes.map(n => [n.id, n]));
    this._edges.forEach(edge => {
      const srcNode = nodeLookup.get(edge.source);
      const tgtNode = nodeLookup.get(edge.target);
      if (!srcNode || !tgtNode) return;
      (srcNode.authors || []).forEach(sa => {
        (tgtNode.authors || []).forEach(ta => {
          if (sa === ta) return;
          const key = `${sa}|||${ta}`;
          links.set(key, (links.get(key) || 0) + 1);
        });
      });
    });
    return Array.from(links.entries())
      .map(([key, count]) => { const [a, b] = key.split('|||'); return { source: a, target: b, count, type: 'citation' }; })
      .sort((a, b) => b.count - a.count);
  }

  _computeGenerations(allAuthors) {
    const seedNode = this._nodes.find(n => n.is_seed);
    const seedYear = seedNode?.year || new Date().getFullYear();
    const pioneers = [], builders = [], contemporaries = [];
    allAuthors.forEach(a => {
      if (!a.yearRange) { contemporaries.push(a); return; }
      const avgYear = Math.round((a.yearRange.min + a.yearRange.max) / 2);
      if (avgYear < 2000) pioneers.push(a);
      else if (avgYear < seedYear - 3) builders.push(a);
      else contemporaries.push(a);
    });
    const result = [];
    if (pioneers.length > 0) {
      const minYear = Math.min(...pioneers.map(a => a.yearRange?.min || 9999));
      result.push({ name: 'Pioneers', yearRange: `${minYear} to 1999`, authors: pioneers });
    }
    if (builders.length > 0) {
      const by = builders.filter(a => a.yearRange?.max).map(a => a.yearRange.max);
      const maxYear = by.length > 0 ? Math.max(...by) : seedYear - 4;
      result.push({ name: 'Builders', yearRange: `2000 to ${maxYear}`, authors: builders });
    }
    if (contemporaries.length > 0) {
      const my = Math.min(...contemporaries.filter(a => a.yearRange).map(a => a.yearRange?.min || seedYear));
      result.push({ name: 'Contemporaries', yearRange: `${my || seedYear - 3} to present`, authors: contemporaries });
    }
    return result;
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 3 — DOT MATRIX RENDERERS (SVG circle grids, Nothing OS style)
   ═══════════════════════════════════════════════════════════════════════════ */

const DotMatrix = {
  _counter: 0,

  /**
   * Render a single row dot grid: label + dots + value
   * @param {number} pct — 0 to 100
   * @param {number} totalDots — how many dots in the row
   * @param {string} fillColor — filled dot color
   * @param {string} emptyColor — empty dot color
   * @returns {string} HTML string with SVG
   */
  dotRow(pct, totalDots = 20, fillColor = '#374151', emptyColor = '#E5E7EB') {
    const filled = Math.round((pct / 100) * totalDots);
    const dotR = 3;
    const spacing = 10;
    const svgW = totalDots * spacing;
    const svgH = dotR * 2 + 2;

    let circles = '';
    for (let i = 0; i < totalDots; i++) {
      const isFilled = i < filled;
      circles += `<circle cx="${i * spacing + dotR + 1}" cy="${dotR + 1}" r="${dotR}" fill="${isFilled ? fillColor : emptyColor}" />`;
    }
    return `<svg viewBox="0 0 ${svgW} ${svgH}" width="100%" height="${svgH}" class="dot-row-svg">${circles}</svg>`;
  },

  /**
   * Render a full dot grid bar with label and percentage.
   * Returns complete HTML card.
   */
  labeledDotBar(label, pct, totalDots = 20, opts = {}) {
    const { fillColor = '#374151', emptyColor = '#E5E7EB', clickable = false, authorName = '', valueLabel = null } = opts;
    const safeLabel = _esc(label);
    const safePct = Math.max(0, Math.min(100, Math.round(pct)));
    const displayValue = valueLabel !== null ? _esc(String(valueLabel)) : `${safePct}%`;
    return `
      <div class="dm-bar-row${clickable ? ' dm-clickable' : ''}" ${clickable ? `data-author="${_esc(authorName)}"` : ''}>
        <span class="dm-bar-label">${safeLabel}</span>
        <div class="dm-bar-dots">${this.dotRow(safePct, totalDots, fillColor, emptyColor)}</div>
        <span class="dm-bar-value">${displayValue}</span>
      </div>`;
  },

  /**
   * Render a compact dot indicator (like Nothing OS battery).
   * @param {number} value — 0 to max
   * @param {number} max — maximum value
   * @param {number} dots — total dot count
   */
  compactIndicator(value, max, dots = 10, fillColor = '#374151') {
    const filled = Math.round((value / Math.max(max, 1)) * dots);
    const dotR = 2.5;
    const spacing = 7;
    const svgW = dots * spacing;
    let circles = '';
    for (let i = 0; i < dots; i++) {
      circles += `<circle cx="${i * spacing + dotR}" cy="${dotR + 1}" r="${dotR}" fill="${i < filled ? fillColor : '#E5E7EB'}" />`;
    }
    const svgH = dotR * 2 + 2;
    return `<svg viewBox="0 0 ${svgW} ${svgH}" width="${svgW}px" height="${svgH}px" class="dm-compact">${circles}</svg>`;
  },
};


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 4 — CONSTELLATION RENDERER (D3 force with dot matrix nodes)
   ═══════════════════════════════════════════════════════════════════════════ */

class ConstellationRenderer {
  static _idCounter = 0;

  static render(container, result, options = {}) {
    const {
      width = 280, height = 220, maxAuthors = 8,
      showLabels = false, interactive = true, compact = false,
    } = options;

    if (!result?.topAuthors?.length) {
      container.innerHTML = '<p style="color:#9CA3AF;font-size:0.8rem;text-align:center;padding:20px">No author data available.</p>';
      return null;
    }

    // Cleanup previous simulation
    if (container._constellationSim) { try { container._constellationSim.stop(); } catch(e) {} }
    if (container._constellationTimer) clearTimeout(container._constellationTimer);
    container.innerHTML = '';

    const topAuthors = result.topAuthors.slice(0, maxAuthors);
    const authorNames = new Set(topAuthors.map(a => a.name));

    const nodes = topAuthors.map(a => ({
      id: a.name, paperCount: a.paperCount, normalizedPower: a.normalizedPower,
      clusterCount: a.clusterCount, bottleneckCount: a.bottleneckCount,
      maxImpact: a.maxImpact, archetype: a.archetype,
      generation: result.generations.find(g => g.authors.some(ga => ga.name === a.name))?.name || '',
    }));

    const links = [];
    const seenLinks = new Set();
    result.coAuthorLinks.forEach(l => {
      if (authorNames.has(l.source) && authorNames.has(l.target)) {
        const key = [l.source, l.target].sort().join('→');
        if (!seenLinks.has(key)) { seenLinks.add(key); links.push({ ...l }); }
      }
    });
    result.citationLinks.forEach(l => {
      if (authorNames.has(l.source) && authorNames.has(l.target)) {
        const key = [l.source, l.target].sort().join('→');
        if (!seenLinks.has(key)) { seenLinks.add(key); links.push({ ...l }); }
      }
    });

    const svg = d3.select(container).append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .style('max-height', height + 'px')
      .attr('class', 'constellation-svg');

    // Subtle dot matrix background
    const bgId = 'dm-bg-' + (++ConstellationRenderer._idCounter);
    const defs = svg.append('defs');
    defs.append('pattern').attr('id', bgId).attr('width', 10).attr('height', 10)
      .attr('patternUnits', 'userSpaceOnUse')
      .append('circle').attr('cx', 5).attr('cy', 5).attr('r', 0.6).attr('fill', '#E5E7EB');
    svg.append('rect').attr('width', width).attr('height', height).attr('fill', `url(#${bgId})`);

    const g = svg.append('g');

    // Stronger repulsion for breathability
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(compact ? 50 : 70).strength(0.5))
      .force('charge', d3.forceManyBody().strength(compact ? -120 : -180))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => _nodeR(d, compact) + 8));

    const linkEls = g.selectAll('.c-link').data(links).join('line')
      .attr('stroke', d => d.type === 'coauthor' ? '#9CA3AF' : '#D1D5DB')
      .attr('stroke-width', d => d.type === 'coauthor' ? Math.min(d.count + 0.5, 3) : 1)
      .attr('stroke-dasharray', d => d.type === 'citation' ? '3,3' : 'none')
      .attr('opacity', 0.5);

    const nodeGroups = g.selectAll('.c-node').data(nodes).join('g')
      .attr('class', 'c-node').style('cursor', interactive ? 'pointer' : 'default');

    // Dot matrix node rendering
    nodeGroups.each(function(d) {
      const sel = d3.select(this);
      const r = _nodeR(d, compact);

      // Outer ring of dots
      const ringDots = Math.max(10, Math.round(r * 3));
      for (let i = 0; i < ringDots; i++) {
        const angle = (i / ringDots) * Math.PI * 2;
        sel.append('circle')
          .attr('cx', Math.cos(angle) * r).attr('cy', Math.sin(angle) * r)
          .attr('r', compact ? 1.2 : 1.5).attr('fill', '#374151');
      }

      // Inner fill: grid of dots
      const gridStep = compact ? 3 : 3.5;
      const fillR = r - 3;
      for (let y = -fillR; y <= fillR; y += gridStep) {
        for (let x = -fillR; x <= fillR; x += gridStep) {
          if (Math.sqrt(x * x + y * y) <= fillR) {
            sel.append('circle')
              .attr('cx', x).attr('cy', y)
              .attr('r', compact ? 0.9 : 1.1)
              .attr('fill', '#374151')
              .attr('opacity', 0.35 + (d.normalizedPower / 200));
          }
        }
      }

      // Bottleneck indicator
      if (d.bottleneckCount > 0) {
        sel.append('circle').attr('r', r + 4).attr('fill', 'none')
          .attr('stroke', '#D4A843').attr('stroke-width', 1.5)
          .attr('stroke-dasharray', '2,2').attr('opacity', 0.7);
      }
    });

    // Labels
    if (showLabels) {
      nodeGroups.append('text')
        .attr('dy', d => _nodeR(d, compact) + 14)
        .attr('text-anchor', 'middle').attr('fill', '#374151')
        .attr('font-size', '10px').attr('font-weight', '600')
        .attr('font-family', 'Inter, sans-serif')
        .text(d => _shortName(d.id));
    } else {
      nodeGroups.append('text')
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('fill', '#fff').attr('font-size', compact ? '7px' : '9px')
        .attr('font-weight', '700').attr('font-family', 'JetBrains Mono, monospace')
        .text(d => _initials(d.id));
    }

    // Tooltip
    if (interactive) {
      const tooltip = d3.select(container).append('div')
        .attr('class', 'constellation-tooltip').style('display', 'none');
      nodeGroups
        .on('mouseenter', (event, d) => {
          const rect = container.getBoundingClientRect();
          tooltip.style('display', 'block')
            .html(`<strong>${_esc(d.id)}</strong><br>${d.paperCount} papers · ${d.clusterCount} cluster${d.clusterCount !== 1 ? 's' : ''}<br>Peak impact: ${d.maxImpact}%${d.bottleneckCount > 0 ? ' · <span style="color:#D4A843">Bottleneck</span>' : ''}<br><span style="color:#9CA3AF">${d.generation} · ${d.archetype}</span>`)
            .style('left', (event.clientX - rect.left + (container.scrollLeft || 0) + 10) + 'px')
            .style('top', (event.clientY - rect.top + (container.scrollTop || 0) - 10) + 'px');
        })
        .on('mousemove', (event) => {
          const rect = container.getBoundingClientRect();
          tooltip.style('left', (event.clientX - rect.left + 10) + 'px')
            .style('top', (event.clientY - rect.top - 10) + 'px');
        })
        .on('mouseleave', () => tooltip.style('display', 'none'))
        .on('click', (event, d) => {
          window.dispatchEvent(new CustomEvent('arivu:highlight-author', { detail: { authorName: d.id } }));
        });
    }

    simulation.on('tick', () => {
      nodes.forEach(d => {
        const pad = _nodeR(d, compact) + 8;
        d.x = Math.max(pad, Math.min(width - pad, d.x));
        d.y = Math.max(pad, Math.min(height - pad, d.y));
      });
      linkEls.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      nodeGroups.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    simulation.alpha(0.5).restart();
    const timer = setTimeout(() => simulation.stop(), compact ? 1800 : 2800);
    container._constellationSim = simulation;
    container._constellationTimer = timer;
    return { svg, simulation };
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 5 — NARRATIVE TEMPLATES (distinct per archetype, no em dashes)
   ═══════════════════════════════════════════════════════════════════════════ */

function _narrativeForAuthor(author, result) {
  const lastName = _esc(author.name.split(' ').pop());
  const mc = author.dominantMutationCount;
  const mt = author.dominantMutation;
  const verb = { adoption: 'adopted by', generalization: 'generalized across', specialization: 'specialized into', hybridization: 'hybridized with', contradiction: 'challenged by', revival: 'revived in', incidental: 'referenced by' }[mt] || 'used by';
  const topPaper = author.papers[0];
  const paperRef = topPaper ? `"${_esc(topPaper.title?.substring(0, 50))}${topPaper.title?.length > 50 ? '...' : ''}" (${topPaper.year || '?'})` : '';

  switch (author.archetype) {
    case 'bottleneck':
      return `${lastName}'s work is a structural chokepoint in this lineage. ${paperRef ? `Their paper ${paperRef} alone` : 'Their most impactful paper'} underpins ${author.maxImpact}% of this graph. Remove it and ${mc} downstream papers lose their methodological foundation. The dominant pattern is ${mt}: their core ideas were ${verb} ${mc} subsequent works.`;
    case 'bridge':
      return `${lastName} connects ${author.clusterCount} distinct research threads: ${author.clusterNames.slice(0, 2).map(c => '"' + _esc(c) + '"').join(' and ')}. Without this cross-pollination, these threads would exist as isolated silos. Their ${author.paperCount} papers serve as translation points where ideas from one domain get ${verb} ${mc} works in another.`;
    case 'pioneer':
      return `${lastName} laid foundational groundwork starting in ${author.yearRange?.min || '?'}. While newer papers rarely cite them directly, ${mc} papers on the critical path trace their methods back to this early work. ${paperRef ? `Their paper ${paperRef}` : 'Their early work'} established assumptions that the entire lineage still builds on.`;
    case 'prolific':
      return `${lastName} appears across ${author.paperCount} papers in this lineage, but no single paper is individually critical. Peak impact is only ${author.maxImpact}%. Their influence is distributed rather than concentrated, contributing to ${author.clusterCount} cluster${author.clusterCount > 1 ? 's' : ''} without dominating any.`;
    default:
      return `${lastName} contributed ${author.paperCount} paper${author.paperCount > 1 ? 's' : ''} to this lineage. Their ideas were ${verb} ${mc} downstream works, with a peak single-paper impact of ${author.maxImpact}%. They operate primarily within the "${_esc(author.clusterNames[0] || 'main')}" research thread.`;
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 6 — ARCHITECTS IN-PANEL VIEW (dot 1 for DNA section)
   ═══════════════════════════════════════════════════════════════════════════ */

class ArchitectsPanel {
  static render(container) {
    const graphData = window._graphLoader?._graphData;
    if (!graphData?.nodes?.length) {
      container.innerHTML = '<p style="color:#9CA3AF;font-size:0.8rem;text-align:center;padding:40px">Build a graph first.</p>';
      return;
    }
    const analyzer = new ArchitectAnalyzer(graphData);
    const result = analyzer.analyze();
    window._architectResult = result;

    container.innerHTML = `
      <div class="architects-compact">
        <div class="architects-constellation-compact" id="constellation-compact"></div>
        <div class="architects-headline">
          <span class="architects-insight">Remove ${_esc(result.top3Names)} and <strong>${result.top3Pct}%</strong> of this lineage collapses</span>
          ${result.strongestCollab ? `<span class="architects-sub">${_esc(result.strongestCollab.source.split(' ').pop())} and ${_esc(result.strongestCollab.target.split(' ').pop())}: ${result.strongestCollab.count} papers together</span>` : ''}
          <span class="architects-hint">hover for details · click to highlight in graph</span>
        </div>
      </div>
    `;

    const el = container.querySelector('#constellation-compact');
    if (el) ConstellationRenderer.render(el, result, { width: 340, height: 280, maxAuthors: 8, showLabels: false, interactive: true, compact: true });
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 7 — ARCHITECTS WINDOW (Layer 2)
   ═══════════════════════════════════════════════════════════════════════════ */

class ArchitectsWindow {
  static populate(body) {
    const graphData = window._graphLoader?._graphData;
    if (!graphData?.nodes?.length) { body.innerHTML = '<p style="color:#9CA3AF;padding:40px;text-align:center">No graph data.</p>'; return; }

    const analyzer = new ArchitectAnalyzer(graphData);
    const result = analyzer.analyze();
    window._architectResult = result;

    body.innerHTML = `
      <div class="architects-window-content">
        <div class="architects-constellation-window" id="constellation-window"></div>

        <div class="dm-section">
          <h4 class="dm-section-title">WHY THESE ARCHITECTS MATTER</h4>
          <div id="architects-why-cards">
            ${result.topAuthors.slice(0, 3).map((a, i) => `
              <div class="dm-card" data-author="${_esc(a.name)}">
                <div class="dm-card-header">
                  <span class="dm-card-name">${_esc(a.name)}</span>
                  <span class="dm-card-meta">${a.paperCount}p · peak ${a.maxImpact}%</span>
                </div>
                <div class="dm-card-archetype">${a.archetype.toUpperCase()}</div>
                <div class="dm-card-body" id="architect-why-${i}">
                  <div class="shimmer-lines"><div class="shimmer-line" style="width:95%"></div><div class="shimmer-line" style="width:80%"></div><div class="shimmer-line" style="width:88%"></div></div>
                </div>
                <button class="dm-card-action" data-author="${_esc(a.name)}">Highlight papers</button>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="dm-section">
          <h4 class="dm-section-title">QUICK STATS</h4>
          <div class="dm-stats-grid">
            <div class="dm-stat">
              <div class="dm-stat-value">${result.generations.length}</div>
              <div class="dm-stat-label">Generations</div>
              <div class="dm-stat-detail">${result.yearSpan} years of research lineage</div>
            </div>
            <div class="dm-stat ${result.concentrationLevel === 'HIGH' ? 'dm-stat-warn' : ''}">
              <div class="dm-stat-value">${result.top3Pct}%</div>
              <div class="dm-stat-label">Top 3 Control</div>
              <div class="dm-stat-detail">${result.concentrationLevel === 'HIGH' ? 'Dangerously concentrated. Healthy fields stay below 40%.' : result.concentrationLevel === 'MODERATE' ? 'Moderate concentration. Room for more diverse contributors.' : 'Well distributed across contributors.'}</div>
            </div>
            ${result.strongestCollab ? `
            <div class="dm-stat">
              <div class="dm-stat-value">${result.strongestCollab.count}</div>
              <div class="dm-stat-label">Tightest Collab</div>
              <div class="dm-stat-detail">${_esc(result.strongestCollab.source.split(' ').pop())} and ${_esc(result.strongestCollab.target.split(' ').pop())} co-authored more papers together than most authors have total.</div>
            </div>` : ''}
          </div>
        </div>

        <div class="dm-section">
          <h4 class="dm-section-title">POWER DISTRIBUTION</h4>
          <div id="architects-power-bar"></div>
          <div class="dm-explain" id="power-explain"></div>
        </div>

        <div class="dm-readmore-wrap">
          <button class="dm-readmore-btn" id="architects-readmore-btn">Full analysis</button>
        </div>
      </div>
    `;

    // Constellation
    const cEl = body.querySelector('#constellation-window');
    if (cEl) ConstellationRenderer.render(cEl, result, { width: 620, height: 380, maxAuthors: 10, showLabels: true, interactive: true, compact: false });

    // Power bar as dot grids
    _renderDotMatrixPowerBar(body.querySelector('#architects-power-bar'), result);

    // Power explanation: show template immediately, replace with LLM version when ready
    const explainEl = body.querySelector('#power-explain');
    if (explainEl) explainEl.innerHTML = _buildPowerExplanation(result);

    // Highlight buttons
    body.querySelectorAll('.dm-card-action').forEach(btn => {
      btn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('arivu:highlight-author', { detail: { authorName: btn.dataset.author } })));
    });

    // Load WHY narratives
    _loadWhyNarratives(result, body);

    // Read more
    body.querySelector('#architects-readmore-btn')?.addEventListener('click', () => ArchitectsFullAnalysis.populate(body, result));
  }
}

function _renderDotMatrixPowerBar(container, result) {
  if (!container) return;
  // Show top 8 authors, bars relative to the HIGHEST scorer (not total)
  const topN = result.topAuthors.slice(0, 8);
  const maxPower = topN[0]?.structuralPower || 1;

  let html = '';
  topN.forEach(a => {
    const pct = Math.max(2, Math.round((a.structuralPower / maxPower) * 100));
    html += DotMatrix.labeledDotBar(
      a.name.split(' ').pop(),
      pct, 20,
      { clickable: true, authorName: a.name, valueLabel: `${a.paperCount}p` }
    );
  });
  container.innerHTML = html;

  container.querySelectorAll('.dm-clickable').forEach(row => {
    row.addEventListener('click', () => window.dispatchEvent(new CustomEvent('arivu:highlight-author', { detail: { authorName: row.dataset.author } })));
  });
}

function _buildPowerExplanation(result) {
  const top = result.topAuthors;
  if (top.length < 3) return '<p>Not enough authors to analyze power distribution.</p>';

  const parts = [];

  // Why the top authors dominate
  const top3 = top.slice(0, 3);
  const top3Names = top3.map(a => _esc(a.name.split(' ').pop())).join(', ');
  const topReason = top3[0].archetype === 'bottleneck'
    ? `${top3Names} rank highest because their papers are structural bottlenecks. Removing any of their work would collapse large portions of this graph.`
    : `${top3Names} lead because they combine high citation counts with strong in-graph influence. Multiple papers in this lineage build directly on their work.`;
  parts.push(topReason);

  // Call out notable authors who aren't in top 3 but should be known
  const notableOutside = top.slice(3, 10).filter(a =>
    a.paperCount >= top3[0].paperCount * 0.7 ||
    a.totalCitations > top3[0].totalCitations * 0.3 ||
    a.archetype === 'pioneer'
  );

  if (notableOutside.length > 0) {
    // Pick diverse notable authors: prioritize pioneers and high-citation authors
    // Sort by citation count to surface the most recognized names
    const sorted = [...notableOutside].sort((a, b) => b.totalCitations - a.totalCitations);
    const notableNames = sorted.slice(0, 4).map(a => {
      const name = _esc(a.name.split(' ').pop());
      if (a.archetype === 'pioneer') return `${name} (foundational pioneer, ${a.paperCount} papers)`;
      if (a.paperCount > 10) return `${name} (${a.paperCount} papers across ${a.clusterCount} clusters)`;
      if (a.totalCitations > 50000) return `${name} (${Math.round(a.totalCitations / 1000)}K citations, ${a.paperCount} papers)`;
      return `${name} (${a.paperCount} papers, bridges ${a.clusterCount} clusters)`;
    });
    parts.push(`Other influential contributors include ${notableNames.join(', ')}. Their individual papers may not be structural bottlenecks, but their cumulative presence across the lineage makes them foundational.`);
  }

  // Add actionable note
  parts.push('Click any name to highlight their papers in the graph.');

  return parts.map(p => `<p>${p}</p>`).join('');
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 8 — ARCHITECTS FULL ANALYSIS (Layer 3)
   ═══════════════════════════════════════════════════════════════════════════ */

class ArchitectsFullAnalysis {
  static populate(body, result) {
    if (!result) result = window._architectResult;
    if (!result) { body.innerHTML = '<p style="color:#9CA3AF;padding:40px;text-align:center">No data.</p>'; return; }

    body.style.transition = 'opacity 0.2s ease';
    body.style.opacity = '0';

    setTimeout(() => {
      const top1 = result.topAuthors[0];
      const top1Name = top1?.name?.split(' ').pop() || '?';
      const seedYear = result.seedYear;

      // Build a rich story from data
      const storyParts = [];
      storyParts.push(`This lineage was built by ${result.totalAuthors} researchers across ${result.generations.length} generation${result.generations.length > 1 ? 's' : ''} spanning ${result.yearSpan} years.`);
      if (result.generations.length >= 2) {
        const first = result.generations[0];
        const last = result.generations[result.generations.length - 1];
        storyParts.push(`The ${first.name.toLowerCase()} (${first.yearRange}) established the foundational methods. The ${last.name.toLowerCase()} (${last.yearRange}) now dominate with ${last.authors.length} active contributors.`);
      }
      if (result.concentrationLevel === 'HIGH') {
        storyParts.push(`Concentration is dangerously high: the top 3 authors control ${result.top3Pct}% of structural load. A healthy field typically stays below 40%. If ${top1Name}'s work were retracted, ${top1?.maxImpact || 0}% of this graph collapses.`);
      } else if (result.concentrationLevel === 'MODERATE') {
        storyParts.push(`The top 3 control ${result.top3Pct}% of structural impact, which is moderate. There's opportunity for new contributors to strengthen underrepresented branches.`);
      }
      if (result.strongestCollab) {
        storyParts.push(`The tightest collaboration is ${_esc(result.strongestCollab.source.split(' ').pop())} and ${_esc(result.strongestCollab.target.split(' ').pop())} with ${result.strongestCollab.count} co-authored papers.`);
      }

      body.innerHTML = `
        <div class="architects-full-analysis">
          <div class="detail-header">
            <button class="detail-back-btn" id="architect-back-btn">Back</button>
            <h3>ARCHITECTS: FULL ANALYSIS</h3>
          </div>

          <div class="dm-story">${storyParts.map(s => `<p>${s}</p>`).join('')}</div>

          <div class="dm-section">
            <h4 class="dm-section-title">INFLUENCE ARCHAEOLOGY</h4>
            <div id="archaeology-flow"></div>
          </div>

          <div class="dm-section">
            <h4 class="dm-section-title">CONCENTRATION RISK</h4>
            <div id="concentration-dots"></div>
            <p class="dm-explain">${result.concentrationLevel === 'HIGH'
              ? `Dangerously concentrated. Healthy fields have top 3 below 40%. This lineage is at ${result.top3Pct}%.`
              : result.concentrationLevel === 'MODERATE'
                ? `Moderate concentration at ${result.top3Pct}%. Approaching the 40% threshold.`
                : `Healthy distribution at ${result.top3Pct}%. Impact is well-spread.`}</p>
          </div>

          <div class="dm-section">
            <h4 class="dm-section-title">COLLABORATION MAP</h4>
            <div id="collab-links"></div>
          </div>

          <div class="dm-section">
            <h4 class="dm-section-title">ALL AUTHORS</h4>
            <div id="author-grid"></div>
          </div>

          <div class="dm-discuss-wrap">
            <button class="dm-discuss-btn" id="architect-discuss-btn">Discuss with AI</button>
          </div>
        </div>
      `;

      // Render sub-sections
      _renderArchaeology(body.querySelector('#archaeology-flow'), result);
      _renderConcentrationDots(body.querySelector('#concentration-dots'), result);
      _renderCollabLinks(body.querySelector('#collab-links'), result);
      _renderAuthorGrid(body.querySelector('#author-grid'), result);

      // Back
      body.querySelector('#architect-back-btn')?.addEventListener('click', () => {
        body.style.opacity = '0';
        setTimeout(() => { ArchitectsWindow.populate(body); body.style.opacity = '1'; }, 200);
      });

      // Discuss — include paper title and top authors for context
      body.querySelector('#architect-discuss-btn')?.addEventListener('click', () => {
        const input = document.querySelector('#chat-input');
        if (input) {
          const seedTitle = window._graphLoader?._graphData?.metadata?.seed_paper_title || 'this paper';
          const topNames = result.topAuthors.slice(0, 5).map(a => a.name).join(', ');
          input.value = `For the paper "${seedTitle}", who are the most critical architects of its research lineage? The top ranked are ${topNames}. Why do they rank where they do, and are there any important contributors being underrepresented?`;
          input.focus();
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        // Try opening chat panel
        const chatBtn = document.querySelector('[data-panel="panel-chat"]');
        if (chatBtn) chatBtn.click();
      });

      body.style.opacity = '1';
    }, 200);
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 9 — LAYER 3 RENDER HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function _renderArchaeology(container, result) {
  if (!container) return;
  let html = '<div class="dm-archaeology">';
  result.generations.forEach((gen, i) => {
    const top = gen.authors.slice(0, 5);
    const topAuthor = top[0];
    // Generate a generation-level narrative
    let narrative = '';
    if (gen.name === 'Pioneers') narrative = 'Established the foundational methods and theoretical framework that later generations built upon.';
    else if (gen.name === 'Builders') narrative = 'Translated early theory into practical systems, created benchmarks, and bridged classical and modern approaches.';
    else narrative = 'Currently dominant. Producing the highest-impact work and setting the direction for the field.';

    html += `
      <div class="dm-gen-card">
        <div class="dm-gen-header">
          <span class="dm-gen-name">${gen.name}</span>
          <span class="dm-gen-years">${gen.yearRange}</span>
          <span class="dm-gen-count">${gen.authors.length} author${gen.authors.length > 1 ? 's' : ''}</span>
        </div>
        <p class="dm-gen-narrative">${narrative}</p>
        <div class="dm-gen-authors">
          ${top.map(a => `<span class="dm-gen-author dm-clickable" data-author="${_esc(a.name)}">${_esc(a.name)} <span class="dm-gen-papers">${a.paperCount}p</span> ${a.bottleneckCount > 0 ? '<span class="dm-bottleneck-dot"></span>' : ''}</span>`).join('')}
          ${gen.authors.length > 5 ? `<span class="dm-gen-more">+${gen.authors.length - 5} more</span>` : ''}
        </div>
      </div>
      ${i < result.generations.length - 1 ? '<div class="dm-gen-arrow">↓</div>' : ''}`;
  });
  html += '</div>';
  container.innerHTML = html;
  container.querySelectorAll('.dm-clickable').forEach(el => {
    el.addEventListener('click', () => window.dispatchEvent(new CustomEvent('arivu:highlight-author', { detail: { authorName: el.dataset.author } })));
  });
}

function _renderConcentrationDots(container, result) {
  if (!container) return;
  let html = '';
  html += DotMatrix.labeledDotBar('Top 3', Math.min(result.top3Pct, 100), 20);
  html += DotMatrix.labeledDotBar('Top 5', Math.min(result.top5Pct, 100), 20);
  if (result.totalAuthors > 5) {
    html += DotMatrix.labeledDotBar(`Rest (${result.totalAuthors - 5})`, Math.max(0, 100 - result.top5Pct), 20, { fillColor: '#D1D5DB' });
  }
  container.innerHTML = html;
}

function _renderCollabLinks(container, result) {
  if (!container) return;
  const co = result.coAuthorLinks.slice(0, 6);
  const ci = result.citationLinks.slice(0, 4);

  let html = '';
  if (co.length > 0) {
    html += '<div class="dm-collab-group">';
    co.forEach(l => {
      // Find co-authored paper titles
      const graphData = window._graphLoader?._graphData;
      const sharedPapers = graphData?.nodes?.filter(n =>
        (n.authors || []).includes(l.source) && (n.authors || []).includes(l.target)
      )?.slice(0, 2) || [];
      const paperNames = sharedPapers.map(p => _esc(p.title?.substring(0, 40) + (p.title?.length > 40 ? '...' : ''))).join(', ');

      html += `
        <div class="dm-collab-row">
          <div class="dm-collab-names">
            <span class="dm-collab-name dm-clickable" data-author="${_esc(l.source)}">${_esc(l.source.split(' ').pop())}</span>
            <span class="dm-collab-line">${'●'.repeat(Math.min(l.count, 6))}</span>
            <span class="dm-collab-name dm-clickable" data-author="${_esc(l.target)}">${_esc(l.target.split(' ').pop())}</span>
            <span class="dm-collab-count">${l.count} shared</span>
          </div>
          ${paperNames ? `<div class="dm-collab-papers">${paperNames}</div>` : ''}
        </div>`;
    });
    html += '</div>';
  }

  // Research triangles
  const pairs = new Set(result.coAuthorLinks.map(l => [l.source, l.target].sort().join('|||')));
  const names = result.topAuthors.slice(0, 8).map(a => a.name);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      for (let k = j + 1; k < names.length; k++) {
        if (pairs.has([names[i], names[j]].sort().join('|||')) &&
            pairs.has([names[j], names[k]].sort().join('|||')) &&
            pairs.has([names[i], names[k]].sort().join('|||'))) {
          html += `<div class="dm-collab-insight">Research triangle detected: ${names[i].split(' ').pop()}, ${names[j].split(' ').pop()}, and ${names[k].split(' ').pop()} co-appear so frequently that their individual contributions are hard to disentangle.</div>`;
          i = names.length; j = names.length; break; // Only show first
        }
      }
    }
  }

  container.innerHTML = html || '<p style="color:#9CA3AF;font-size:0.8rem">No collaboration links found.</p>';
  container.querySelectorAll('.dm-clickable').forEach(el => {
    el.addEventListener('click', () => window.dispatchEvent(new CustomEvent('arivu:highlight-author', { detail: { authorName: el.dataset.author } })));
  });
}

function _renderAuthorGrid(container, result) {
  if (!container) return;
  const maxPapers = Math.max(...result.allAuthors.slice(0, 15).map(a => a.paperCount), 1);

  let html = '<div class="dm-author-grid">';
  result.allAuthors.slice(0, 15).forEach(a => {
    html += `
      <div class="dm-author-card dm-clickable" data-author="${_esc(a.name)}">
        <div class="dm-author-top">
          <span class="dm-author-name">${_esc(a.name)}</span>
          <span class="dm-author-archetype">${a.archetype}</span>
        </div>
        <div class="dm-author-dots">
          ${DotMatrix.compactIndicator(a.paperCount, maxPapers, 10)}
          <span class="dm-author-count">${a.paperCount}p</span>
        </div>
        <div class="dm-author-meta">
          ${a.clusterCount} cluster${a.clusterCount > 1 ? 's' : ''} · peak ${a.maxImpact}%
          ${a.bottleneckCount > 0 ? ' · <span class="dm-bottleneck-dot"></span>' : ''}
        </div>
      </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
  container.querySelectorAll('.dm-clickable').forEach(el => {
    el.addEventListener('click', () => window.dispatchEvent(new CustomEvent('arivu:highlight-author', { detail: { authorName: el.dataset.author } })));
  });
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 10 — IDEA FLOW ANALYZER
   ═══════════════════════════════════════════════════════════════════════════ */

class IdeaFlowAnalyzer {
  constructor(graphData) {
    this._nodes = graphData?.nodes || [];
    this._edges = (graphData?.edges || []).map(e => ({
      ...e, source: _edgeId(e.source), target: _edgeId(e.target),
    }));
    this._result = null;
  }

  analyze() {
    if (this._result) return this._result;
    const nodes = this._nodes;
    const edges = this._edges;
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // Build adjacency
    const adjOut = new Map();
    edges.forEach(e => {
      if (!adjOut.has(e.source)) adjOut.set(e.source, []);
      adjOut.get(e.source).push(e);
    });

    // Critical path: try non-incidental first, fall back to all edges
    const seed = nodes.find(n => n.is_seed);
    let criticalPath = seed ? this._findLongestPath(seed.id, nodeMap, adjOut, false) : [];
    if (criticalPath.length <= 1) {
      // Fallback: include incidental edges
      criticalPath = seed ? this._findLongestPath(seed.id, nodeMap, adjOut, true) : [];
    }
    if (criticalPath.length <= 1) {
      // Last resort: find longest path from ANY node
      let bestPath = criticalPath;
      nodes.slice(0, 50).forEach(n => { // Cap at 50 to avoid perf issues
        const path = this._findLongestPath(n.id, nodeMap, adjOut, true);
        if (path.length > bestPath.length) bestPath = path;
      });
      criticalPath = bestPath;
    }

    // Mutation heatmap data: bin edges by year and mutation type
    const heatmap = this._buildMutationHeatmap(edges, nodeMap);

    // Topology
    const adjIn = new Map();
    edges.forEach(e => {
      if (!adjIn.has(e.target)) adjIn.set(e.target, []);
      adjIn.get(e.target).push(e);
    });
    let branchPoints = 0, mergePoints = 0, deadEnds = 0;
    nodes.forEach(n => {
      const outNI = (adjOut.get(n.id) || []).filter(e => e.mutation_type !== 'incidental').length;
      const inNI = (adjIn.get(n.id) || []).filter(e => e.mutation_type !== 'incidental').length;
      if (outNI > 1) branchPoints++;
      if (inNI > 1) mergePoints++;
      if (outNI === 0 && !n.is_seed) deadEnds++;
    });
    const topoType = mergePoints > branchPoints ? 'CONVERGING' : branchPoints > mergePoints ? 'DIVERGING' : 'BALANCED';

    // Mutation type counts
    const mutCounts = {};
    edges.forEach(e => {
      if (e.mutation_type !== 'incidental') {
        mutCounts[e.mutation_type] = (mutCounts[e.mutation_type] || 0) + 1;
      }
    });
    const dominantMut = Object.entries(mutCounts).sort((a, b) => b[1] - a[1])[0];
    const totalNonInc = edges.filter(e => e.mutation_type !== 'incidental').length;

    // Depth impact: max single-paper impact AND paper count per depth level
    // pruning_impact is a RAW COUNT of affected papers, not a percentage
    // Convert to percentage of total graph size
    const totalNodeCount = nodes.length || 1;
    const depthMaxImpact = {};
    const depthCounts = {};
    const depthAvgImpact = {};
    const depthTotalImpact = {};
    nodes.forEach(n => {
      if (n.depth != null) {
        const d = n.depth;
        const rawImpact = n.pruning_impact || 0;
        // Convert to percentage: (affected papers / total papers) * 100, capped at 100
        const impactPct = Math.min(100, Math.round((rawImpact / totalNodeCount) * 100));
        depthCounts[d] = (depthCounts[d] || 0) + 1;
        depthTotalImpact[d] = (depthTotalImpact[d] || 0) + impactPct;
        depthMaxImpact[d] = Math.max(depthMaxImpact[d] || 0, impactPct);
      }
    });
    // Compute averages
    Object.keys(depthCounts).forEach(d => {
      depthAvgImpact[d] = depthCounts[d] > 0 ? Math.round(depthTotalImpact[d] / depthCounts[d]) : 0;
    });

    // Year span
    const years = nodes.filter(n => n.year).map(n => n.year);
    const minYear = years.length > 0 ? Math.min(...years) : 0;
    const maxYear = years.length > 0 ? Math.max(...years) : 0;

    this._result = {
      criticalPath,
      heatmap,
      topology: { branchPoints, mergePoints, deadEnds, type: topoType },
      mutCounts,
      dominantMutation: dominantMut ? dominantMut[0] : 'unknown',
      dominantMutationCount: dominantMut ? dominantMut[1] : 0,
      totalNonIncidental: totalNonInc,
      totalEdges: edges.length,
      depthMaxImpact,
      depthCounts,
      depthAvgImpact,
      yearRange: { min: minYear, max: maxYear },
      nodeCount: nodes.length,
    };
    return this._result;
  }

  _findLongestPath(startId, nodeMap, adjOut, includeIncidental) {
    let longest = [];
    const visited = new Set();
    const dfs = (nodeId, path) => {
      if (path.length > longest.length) longest = [...path];
      if (path.length > 20) return; // Cap for perf, matches legacy _findCriticalPath
      for (const e of (adjOut.get(nodeId) || [])) {
        if (!includeIncidental && e.mutation_type === 'incidental') continue;
        if (visited.has(e.target)) continue;
        const tn = nodeMap.get(e.target);
        if (!tn) continue;
        visited.add(e.target);
        path.push({
          nodeId: e.target, title: tn.title, year: tn.year,
          mutationType: e.mutation_type, confidence: e.confidence_tier,
          citingSentence: e.citing_sentence, citedSentence: e.cited_sentence,
        });
        dfs(e.target, path);
        path.pop();
        visited.delete(e.target);
      }
    };
    const sn = nodeMap.get(startId);
    if (sn) {
      visited.add(startId);
      dfs(startId, [{ nodeId: startId, title: sn.title, year: sn.year, mutationType: null, isSeed: sn.is_seed }]);
    }
    return longest;
  }

  _buildMutationHeatmap(edges, nodeMap) {
    // Bin edges by 5-year intervals, counting per mutation type
    const bins = new Map(); // yearBin -> { adoption: N, generalization: N, ... }
    const allTypes = new Set();

    edges.forEach(e => {
      if (e.mutation_type === 'incidental') return;
      const srcNode = nodeMap.get(e.source);
      if (!srcNode?.year) return;
      const bin = Math.floor(srcNode.year / 5) * 5;
      if (!bins.has(bin)) bins.set(bin, {});
      const counts = bins.get(bin);
      counts[e.mutation_type] = (counts[e.mutation_type] || 0) + 1;
      allTypes.add(e.mutation_type);
    });

    const sortedYears = Array.from(bins.keys()).sort((a, b) => a - b);
    const types = Array.from(allTypes).sort();

    // Build column data: each column is a year bin, value = total non-inc edges
    const columns = sortedYears.map(year => {
      const counts = bins.get(year) || {};
      const total = Object.values(counts).reduce((s, v) => s + v, 0);
      return { year, total, counts };
    });

    const maxTotal = Math.max(...columns.map(c => c.total), 1);

    return { columns, types, maxTotal, sortedYears };
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 11 — NASDAQ-STYLE VERTICAL DOT ARRAY RENDERER
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Render a NASDAQ-style vertical dot array block.
 * Dark background, lit dots form a "mountain" shape showing data over time.
 * @param {HTMLElement} container
 * @param {Object} heatmap — from IdeaFlowAnalyzer
 * @param {Object} opts — { cols, rows, dotR, spacing, litColor, dimColor, darkBg, compact, interactive }
 */
function _renderHeatGrid(container, heatmap, opts = {}) {
  const {
    cols = 0, rows = 12, dotR = 3, spacing = 8, colSpacing = 0,
    litColor = '#374151', dimColor = '#E5E7EB', darkBg = '#FFFFFF',
    compact = false, interactive = true,
  } = opts;

  if (!heatmap?.columns?.length) {
    container.innerHTML = '<p style="color:#9CA3AF;font-size:0.8rem;text-align:center;padding:20px">No mutation data available.</p>';
    return;
  }

  const numCols = cols || heatmap.columns.length;
  const numRows = compact ? 8 : rows;
  const cSpacing = colSpacing || spacing; // horizontal spacing between columns
  const svgW = numCols * cSpacing + cSpacing;
  const svgH = numRows * spacing + spacing + (compact ? 16 : 24); // extra for year labels
  const maxVal = heatmap.maxTotal;

  let circles = '';
  let yearLabels = '';

  heatmap.columns.forEach((col, colIdx) => {
    const x = colIdx * cSpacing + cSpacing;
    const filledRows = Math.max(1, Math.round((col.total / maxVal) * numRows));

    // Draw dots bottom-up: filled from bottom, empty above
    for (let row = 0; row < numRows; row++) {
      const y = (numRows - 1 - row) * spacing + spacing / 2;
      const isFilled = row < filledRows;

      if (isFilled) {
        // Determine color intensity based on position in the column
        const intensity = 0.4 + (row / filledRows) * 0.6;
        circles += `<circle cx="${x}" cy="${y}" r="${dotR}" fill="${litColor}" opacity="${intensity}" data-col="${colIdx}" data-year="${col.year}" data-total="${col.total}" />`;
      } else {
        circles += `<circle cx="${x}" cy="${y}" r="${dotR * 0.6}" fill="${dimColor}" opacity="0.3" />`;
      }
    }

    // Year label at bottom (show every other for compact, all for full)
    if (!compact || colIdx % 2 === 0 || colIdx === heatmap.columns.length - 1) {
      const labelY = numRows * spacing + spacing / 2 + (compact ? 10 : 14);
      const yearStr = String(col.year).slice(-2); // '95, '00, etc
      yearLabels += `<text x="${x}" y="${labelY}" text-anchor="middle" fill="#6B7280" font-size="${compact ? '7' : '9'}px" font-family="JetBrains Mono, monospace">'${yearStr}</text>`;
    }
  });

  // Fixed pixel width based on column count: ~20px per column for compact, ~30px for window
  const pxPerCol = compact ? 22 : 36;
  const finalW = Math.max(150, Math.min(numCols * pxPerCol + 20, compact ? 300 : 500));

  const svgHTML = `
    <svg viewBox="0 0 ${svgW} ${svgH}" width="${finalW}" class="dm-heatgrid" style="background:${darkBg};border-radius:8px;display:block;margin:0 auto;">
      ${circles}
      ${yearLabels}
    </svg>
  `;

  container.innerHTML = svgHTML;

  // Tooltip on hover
  if (interactive) {
    const tooltip = document.createElement('div');
    tooltip.className = 'dm-heatgrid-tooltip';
    tooltip.style.display = 'none';
    container.style.position = 'relative';
    container.appendChild(tooltip);

    container.querySelector('.dm-heatgrid')?.addEventListener('mousemove', (event) => {
      const circle = event.target.closest('circle[data-year]');
      if (circle) {
        const year = circle.dataset.year;
        const total = circle.dataset.total;
        const col = heatmap.columns.find(c => String(c.year) === year);
        if (col) {
          const breakdown = Object.entries(col.counts).map(([t, c]) => `${t}: ${c}`).join(', ');
          tooltip.innerHTML = `<strong>${year}s</strong><br>${total} transformations<br>${breakdown}`;
          tooltip.style.display = 'block';
          const rect = container.getBoundingClientRect();
          tooltip.style.left = (event.clientX - rect.left + 10) + 'px';
          tooltip.style.top = (event.clientY - rect.top - 10) + 'px';
        }
      } else {
        tooltip.style.display = 'none';
      }
    });

    container.querySelector('.dm-heatgrid')?.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 12 — IDEA FLOW COMPACT VIEW (Diversity dot 1)
   ═══════════════════════════════════════════════════════════════════════════ */

class IdeaFlowPanel {
  static render(container) {
    const graphData = window._graphLoader?._graphData;
    if (!graphData?.nodes?.length) {
      container.innerHTML = '<p style="color:#9CA3AF;font-size:0.8rem;text-align:center;padding:40px">Build a graph first.</p>';
      return;
    }
    const analyzer = new IdeaFlowAnalyzer(graphData);
    const result = analyzer.analyze();
    window._ideaFlowResult = result;

    const topMut = result.dominantMutation !== 'unknown' ? result.dominantMutation : 'mixed';
    const topoLabel = result.topology.type;

    container.innerHTML = `
      <div class="ideaflow-compact">
        <div class="ideaflow-chart-compact" id="ideaflow-chart-compact"></div>
        <div class="ideaflow-headline">
          <span class="ideaflow-insight">${result.totalNonIncidental} meaningful transformations · ${result.yearRange.max - result.yearRange.min} year span</span>
          <span class="ideaflow-sub">${topMut} dominant · ${topoLabel} field</span>
          <span class="ideaflow-hint">hover for breakdown by period</span>
        </div>
      </div>
    `;

    const chartEl = container.querySelector('#ideaflow-chart-compact');
    if (chartEl) _renderHeatGrid(chartEl, result.heatmap, { compact: true, rows: 6, dotR: 2, spacing: 6, colSpacing: 10 });
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 13 — IDEA FLOW WINDOW (Layer 2)
   ═══════════════════════════════════════════════════════════════════════════ */

class IdeaFlowWindow {
  static populate(body) {
    const graphData = window._graphLoader?._graphData;
    if (!graphData?.nodes?.length) { body.innerHTML = '<p style="color:#9CA3AF;padding:40px;text-align:center">No graph data.</p>'; return; }

    const result = window._ideaFlowResult || new IdeaFlowAnalyzer(graphData).analyze();
    window._ideaFlowResult = result;

    const pathSteps = result.criticalPath.length;
    const yearSpan = result.yearRange.max - result.yearRange.min;

    body.innerHTML = `
      <div class="ideaflow-window-content">
        <div class="dm-section">
          <h4 class="dm-section-title">MUTATION LANDSCAPE</h4>
          <div class="ideaflow-chart-window" id="ideaflow-chart-window"></div>
        </div>

        <div class="dm-section">
          <h4 class="dm-section-title">WHY THIS MATTERS</h4>
          <div id="ideaflow-why">
            <div class="shimmer-lines"><div class="shimmer-line" style="width:95%"></div><div class="shimmer-line" style="width:80%"></div><div class="shimmer-line" style="width:88%"></div></div>
          </div>
        </div>

        <div class="dm-section">
          <h4 class="dm-section-title">QUICK STATS</h4>
          <div class="dm-stats-grid">
            <div class="dm-stat">
              <div class="dm-stat-value">${result.totalNonIncidental}</div>
              <div class="dm-stat-label">Transformations</div>
              <div class="dm-stat-detail">${result.totalEdges - result.totalNonIncidental} incidental edges filtered out</div>
            </div>
            <div class="dm-stat">
              <div class="dm-stat-value">${result.topology.type}</div>
              <div class="dm-stat-label">Field Shape</div>
              <div class="dm-stat-detail">${result.topology.mergePoints} merge points vs ${result.topology.branchPoints} branch points</div>
            </div>
            <div class="dm-stat">
              <div class="dm-stat-value">${pathSteps}</div>
              <div class="dm-stat-label">Longest Chain</div>
              <div class="dm-stat-detail">${yearSpan > 0 ? `Spanning ${yearSpan} years of intellectual evolution` : 'From seed through its deepest reference chain'}</div>
            </div>
          </div>
        </div>

        <div class="dm-section">
          <h4 class="dm-section-title">MUTATION BREAKDOWN</h4>
          <div id="ideaflow-mut-bars"></div>
        </div>

        ${pathSteps > 1 ? `
        <div class="dm-section">
          <h4 class="dm-section-title">CRITICAL PATH</h4>
          <div id="ideaflow-path"></div>
        </div>
        ` : ''}

        <div class="dm-readmore-wrap">
          <button class="dm-readmore-btn" id="ideaflow-readmore-btn">Full analysis</button>
        </div>
      </div>
    `;

    // Render chart (bigger)
    const chartEl = body.querySelector('#ideaflow-chart-window');
    if (chartEl) _renderHeatGrid(chartEl, result.heatmap, { compact: false, rows: 6, dotR: 2, spacing: 6, colSpacing: 14 });

    // Mutation breakdown as dot bars
    _renderMutationBars(body.querySelector('#ideaflow-mut-bars'), result);

    // Critical path as compact list
    if (pathSteps > 1) _renderCriticalPath(body.querySelector('#ideaflow-path'), result);

    // Load WHY explanation
    _loadIdeaFlowWhy(result, body);

    // Read more
    body.querySelector('#ideaflow-readmore-btn')?.addEventListener('click', () => IdeaFlowFullAnalysis.populate(body, result));
  }
}

function _renderMutationBars(container, result) {
  if (!container) return;
  const maxCount = Math.max(...Object.values(result.mutCounts), 1);
  let html = '';
  Object.entries(result.mutCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      const pct = Math.round((count / maxCount) * 100);
      html += DotMatrix.labeledDotBar(type, pct, 20, { valueLabel: `${count}` });
    });
  container.innerHTML = html || '<p style="color:#9CA3AF;font-size:0.8rem">No non-incidental mutations found.</p>';
}

function _renderCriticalPath(container, result) {
  if (!container) return;
  let html = '<div class="dm-critical-path">';
  result.criticalPath.forEach((step, i) => {
    const isLast = i === result.criticalPath.length - 1;
    html += `
      <div class="dm-path-step ${step.isSeed ? 'dm-path-seed' : ''}">
        <span class="dm-path-title">${_esc(step.title?.substring(0, 50))}${step.title?.length > 50 ? '...' : ''}</span>
        <span class="dm-path-year">${step.year || '?'}</span>
        ${step.isSeed ? '<span class="dm-path-badge">SEED</span>' : ''}
      </div>
      ${!isLast ? `<div class="dm-path-arrow">${result.criticalPath[i + 1]?.mutationType || '→'}</div>` : ''}
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 14 — IDEA FLOW FULL ANALYSIS (Layer 3)
   ═══════════════════════════════════════════════════════════════════════════ */

class IdeaFlowFullAnalysis {
  static populate(body, result) {
    if (!result) result = window._ideaFlowResult;
    if (!result) { body.innerHTML = '<p style="color:#9CA3AF;padding:40px;text-align:center">No data.</p>'; return; }

    body.style.transition = 'opacity 0.2s ease';
    body.style.opacity = '0';

    setTimeout(() => {
      const storyParts = [];
      storyParts.push(`This lineage contains ${result.totalNonIncidental} meaningful idea transformations across ${result.nodeCount} papers.`);
      if (result.dominantMutation !== 'unknown') {
        storyParts.push(`The dominant transformation pattern is ${result.dominantMutation} (${result.dominantMutationCount} edges), indicating that most papers in this lineage ${result.dominantMutation === 'generalization' ? 'expand and broaden earlier methods' : result.dominantMutation === 'adoption' ? 'directly inherit methods from their predecessors' : result.dominantMutation === 'specialization' ? 'narrow and focus earlier methods into specific domains' : 'build on earlier work in varied ways'}.`);
      }
      storyParts.push(`The field topology is ${result.topology.type}: ${result.topology.type === 'CONVERGING' ? 'ideas are consolidating, with more merge points than branches. This suggests the field is maturing toward consensus methods.' : result.topology.type === 'DIVERGING' ? 'ideas are branching into more subfields than they are merging. This suggests an expanding, exploratory field.' : 'branching and merging are roughly balanced, indicating a stable field with both exploration and consolidation.'}`);

      body.innerHTML = `
        <div class="ideaflow-full-analysis">
          <div class="detail-header">
            <button class="detail-back-btn" id="ideaflow-back-btn">Back</button>
            <h3>IDEA FLOW: FULL ANALYSIS</h3>
          </div>

          <div class="dm-story">${storyParts.map(s => `<p>${s}</p>`).join('')}</div>

          ${result.criticalPath.length > 1 ? `
          <div class="dm-section">
            <h4 class="dm-section-title">CRITICAL PATH WITH EVIDENCE</h4>
            <div id="ideaflow-evidence-path"></div>
          </div>
          ` : ''}

          <div class="dm-section">
            <h4 class="dm-section-title">MUTATION TYPES EXPLAINED</h4>
            <div id="ideaflow-mut-detail"></div>
          </div>

          <div class="dm-section">
            <h4 class="dm-section-title">DEPTH IMPACT</h4>
            <div id="ideaflow-depth-impact"></div>
          </div>

          <div class="dm-discuss-wrap">
            <button class="dm-discuss-btn" id="ideaflow-discuss-btn">Discuss with AI</button>
          </div>
        </div>
      `;

      // Evidence path
      if (result.criticalPath.length > 1) {
        _renderEvidencePath(body.querySelector('#ideaflow-evidence-path'), result);
      }

      // Mutation detail
      _renderMutationDetail(body.querySelector('#ideaflow-mut-detail'), result);

      // Depth impact
      _renderDepthImpact(body.querySelector('#ideaflow-depth-impact'), result);

      // Back
      body.querySelector('#ideaflow-back-btn')?.addEventListener('click', () => {
        body.style.opacity = '0';
        setTimeout(() => { IdeaFlowWindow.populate(body); body.style.opacity = '1'; }, 200);
      });

      // Discuss
      body.querySelector('#ideaflow-discuss-btn')?.addEventListener('click', () => {
        const input = document.querySelector('#chat-input');
        if (input) {
          const seedTitle = window._graphLoader?._graphData?.metadata?.seed_paper_title || 'this paper';
          input.value = `For "${seedTitle}", how do ideas flow through its research lineage? The dominant pattern is ${result.dominantMutation} and the field is ${result.topology.type}. What does this mean for researchers working in this area?`;
          input.focus();
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        document.querySelector('[data-panel="panel-chat"]')?.click();
      });

      body.style.opacity = '1';
    }, 200);
  }
}

function _renderEvidencePath(container, result) {
  if (!container) return;
  let html = '<div class="dm-evidence-path">';
  result.criticalPath.forEach((step, i) => {
    const isLast = i === result.criticalPath.length - 1;
    const nextStep = !isLast ? result.criticalPath[i + 1] : null;
    const nodeId = step.nodeId || '';
    const hasEvidence = step.citingSentence || step.citedSentence;

    html += `
      <div class="dm-evidence-step dm-evidence-expandable" data-node-id="${_esc(nodeId)}" data-step-index="${i}">
        <div class="dm-evidence-header" style="cursor:pointer">
          <div style="flex:1;min-width:0">
            <span class="dm-evidence-title">${_esc(step.title?.substring(0, 55))}${step.title?.length > 55 ? '...' : ''}</span>
            <span class="dm-evidence-year">${step.year || '?'}</span>
            ${step.isSeed ? '<span class="dm-path-badge">SEED</span>' : ''}
          </div>
          <span class="dm-expand-icon" style="font-size:0.7rem;color:#9CA3AF;transition:transform 0.2s">▶</span>
        </div>

        <div class="dm-evidence-expanded" style="display:none;padding:8px 0 4px 0">
          <div class="dm-evidence-context" style="font-size:0.8rem;color:#4B5563;line-height:1.5;margin-bottom:8px">
            <div class="dm-evidence-loading" style="display:none">
              <div style="height:10px;background:#F3F4F6;border-radius:4px;margin-bottom:4px;animation:shimmer 1.5s infinite"></div>
              <div style="height:10px;background:#F3F4F6;border-radius:4px;width:80%;animation:shimmer 1.5s infinite 0.1s"></div>
            </div>
            <div class="dm-evidence-llm-text"></div>
          </div>

          ${hasEvidence ? `
          <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;padding:8px 10px;margin-bottom:6px">
            <div style="font-family:'JetBrains Mono',monospace;font-size:0.65rem;font-weight:600;color:#9CA3AF;letter-spacing:0.05em;margin-bottom:4px">EVIDENCE</div>
            ${step.citingSentence ? `
            <div style="font-size:0.75rem;color:#374151;font-style:italic;margin-bottom:4px;line-height:1.4">
              <span style="color:#9CA3AF;font-style:normal;font-size:0.65rem">CITING:</span>
              "${_esc(step.citingSentence)}"
            </div>` : ''}
            ${step.citedSentence ? `
            <div style="font-size:0.75rem;color:#374151;font-style:italic;line-height:1.4">
              <span style="color:#9CA3AF;font-style:normal;font-size:0.65rem">CITED:</span>
              "${_esc(step.citedSentence)}"
            </div>` : ''}
          </div>
          ` : ''}

          <button class="dm-zoom-btn" data-node-id="${_esc(nodeId)}" style="
            font-size:0.72rem;color:#3B82F6;background:none;border:1px solid #DBEAFE;
            border-radius:4px;padding:3px 8px;cursor:pointer;font-family:'JetBrains Mono',monospace;
          ">Zoom to paper →</button>
        </div>
      </div>
      ${!isLast && nextStep?.mutationType ? `
        <div class="dm-evidence-arrow">
          <span class="dm-evidence-mutation">${nextStep.mutationType}</span>
          ${nextStep.confidence ? `<span class="dm-evidence-conf">${nextStep.confidence}</span>` : ''}
        </div>
      ` : ''}
    `;
  });
  html += '</div>';
  container.innerHTML = html;

  // Wire up expand/collapse, zoom, and LLM loading
  container.querySelectorAll('.dm-evidence-expandable').forEach(stepEl => {
    const header = stepEl.querySelector('.dm-evidence-header');
    const expanded = stepEl.querySelector('.dm-evidence-expanded');
    const icon = stepEl.querySelector('.dm-expand-icon');
    const nodeId = stepEl.dataset.nodeId;
    const stepIdx = parseInt(stepEl.dataset.stepIndex, 10);
    let llmLoaded = false;

    header.addEventListener('click', () => {
      const isOpen = expanded.style.display !== 'none';
      if (isOpen) {
        expanded.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
      } else {
        // Collapse all others
        container.querySelectorAll('.dm-evidence-expanded').forEach(e => e.style.display = 'none');
        container.querySelectorAll('.dm-expand-icon').forEach(e => e.style.transform = 'rotate(0deg)');

        expanded.style.display = '';
        icon.style.transform = 'rotate(90deg)';

        // Zoom to this paper
        _zoomToNode(nodeId);

        // Load LLM context if not already loaded
        if (!llmLoaded) {
          _loadStepContext(stepEl, stepIdx, result);
          llmLoaded = true;
        }
      }
    });

    // Zoom button
    const zoomBtn = stepEl.querySelector('.dm-zoom-btn');
    if (zoomBtn) {
      zoomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        _zoomToNode(nodeId);
      });
    }
  });
}

function _zoomToNode(nodeId) {
  if (!nodeId) return;

  // Detect which view is active
  const modeLabel = document.getElementById('mode-label');
  const isTreeMode = modeLabel?.textContent?.toLowerCase()?.includes('tree');

  if (isTreeMode && window._treeLayout?.zoomToNode) {
    window._treeLayout.zoomToNode(nodeId);
    return;
  }

  // Try force graph (public properties: svg, zoom, simulation)
  if (window._arivuGraph) {
    const g = window._arivuGraph;
    const simNodes = g.simulation?.nodes();
    const node = simNodes?.find(n => n.id === nodeId);
    if (node && g.svg && g.zoom) {
      const containerEl = g.container || g.svg.node()?.parentElement;
      const width = containerEl?.clientWidth || 800;
      const height = containerEl?.clientHeight || 600;

      // Zoom to node position
      const scale = 2.5;
      const x = -node.x * scale + width / 2;
      const y = -node.y * scale + height / 2;
      g.svg.transition().duration(500).call(
        g.zoom.transform,
        d3.zoomIdentity.translate(x, y).scale(scale)
      );

      // Dim all nodes and edges, highlight the target
      g.svg.selectAll('.node-group').style('opacity', 0.12);
      g.svg.selectAll('line, .edge-line, .edge-path').style('opacity', 0.05);

      const targetEl = g.svg.select(`.node-group[data-id="${nodeId}"]`);
      if (!targetEl.empty()) {
        targetEl.style('opacity', 1);
        // Pulse effect
        targetEl.select('circle, use').transition().duration(300)
          .attr('stroke', '#D4A843').attr('stroke-width', 3)
          .transition().duration(2000)
          .attr('stroke', null).attr('stroke-width', null);
      }

      // Restore after 3.5 seconds
      setTimeout(() => {
        g.svg.selectAll('.node-group').style('opacity', null);
        g.svg.selectAll('line, .edge-line, .edge-path').style('opacity', null);
      }, 3500);
    }
  }
}

async function _loadStepContext(stepEl, stepIdx, result) {
  const textEl = stepEl.querySelector('.dm-evidence-llm-text');
  const loadingEl = stepEl.querySelector('.dm-evidence-loading');
  if (!textEl) return;

  const step = result.criticalPath[stepIdx];
  const prevStep = stepIdx > 0 ? result.criticalPath[stepIdx - 1] : null;
  const nextStep = stepIdx < result.criticalPath.length - 1 ? result.criticalPath[stepIdx + 1] : null;

  if (!step) return;

  // Template fallback first (instant)
  let templateText = '';
  if (step.isSeed) {
    templateText = `This is the seed paper, the starting point of this analysis. Everything in this graph traces back to this work.`;
  } else if (step.mutationType === 'adoption') {
    templateText = `This paper directly adopted methods from ${prevStep?.title ? '"' + prevStep.title.substring(0, 40) + '..."' : 'its predecessor'}. It inherited the core approach without fundamental changes.`;
  } else if (step.mutationType === 'generalization') {
    templateText = `This paper took ideas from ${prevStep?.title ? '"' + prevStep.title.substring(0, 40) + '..."' : 'earlier work'} and expanded them to work in broader contexts or domains.`;
  } else if (step.mutationType === 'specialization') {
    templateText = `This paper narrowed down a general method from ${prevStep?.title ? '"' + prevStep.title.substring(0, 40) + '..."' : 'its predecessor'} to a specific domain or use case.`;
  } else if (step.mutationType === 'contradiction') {
    templateText = `This paper challenged or disproved claims from ${prevStep?.title ? '"' + prevStep.title.substring(0, 40) + '..."' : 'earlier work'}. A direct intellectual challenge.`;
  } else if (step.mutationType === 'hybridization') {
    templateText = `This paper combined methods from multiple sources into a new approach.`;
  } else {
    templateText = `This paper connects to the lineage through ${step.mutationType || 'an indirect'} relationship.`;
  }
  textEl.textContent = templateText;

  // Now try LLM for richer context
  if (loadingEl) loadingEl.style.display = '';

  try {
    const graphData = window._graphLoader?._graphData;
    const seedTitle = graphData?.nodes?.find(n => n.is_seed)?.title || '';

    const promptData = {
      paper_title: step.title,
      paper_year: step.year,
      mutation_from_previous: step.mutationType,
      confidence: step.confidence,
      citing_sentence: step.citingSentence?.substring(0, 200),
      cited_sentence: step.citedSentence?.substring(0, 200),
      previous_paper: prevStep?.title,
      next_paper: nextStep?.title,
      next_mutation: nextStep?.mutationType,
      seed_paper: seedTitle,
      position_in_path: `step ${stepIdx + 1} of ${result.criticalPath.length}`,
    };

    const resp = await fetch('/api/interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'critical_path_step',
        data: promptData,
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data.interpretation) {
        textEl.textContent = data.interpretation;
      }
    }
  } catch (e) {
    // Template fallback already shown, silently fail
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

function _renderMutationDetail(container, result) {
  if (!container) return;
  const descriptions = {
    adoption: 'Direct method inheritance. The citing paper uses the cited paper\'s approach with minimal modification.',
    generalization: 'The citing paper takes a specific method and applies it to broader contexts or domains.',
    specialization: 'The citing paper narrows a general method to a specific domain or use case.',
    hybridization: 'The citing paper combines methods from multiple sources into a new approach.',
    contradiction: 'The citing paper directly challenges or disproves claims from the cited paper.',
    revival: 'The citing paper brings back a previously abandoned or forgotten method.',
  };
  let html = '';
  Object.entries(result.mutCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      const desc = descriptions[type] || 'A transformation of ideas between papers.';
      const pct = Math.round((count / result.totalNonIncidental) * 100);
      html += `
        <div class="dm-card" style="margin-bottom:8px">
          <div class="dm-card-header">
            <span class="dm-card-name">${type}</span>
            <span class="dm-card-meta">${count} edges (${pct}%)</span>
          </div>
          <p class="dm-card-text">${desc}</p>
        </div>
      `;
    });
  container.innerHTML = html || '<p style="color:#9CA3AF;font-size:0.8rem">No mutations found.</p>';
}

function _renderDepthImpact(container, result) {
  if (!container) return;

  const depths = Object.keys(result.depthMaxImpact).map(d => parseInt(d)).sort((a, b) => a - b);
  if (depths.length === 0) {
    container.innerHTML = '<p style="color:#9CA3AF;font-size:0.8rem">No depth data available.</p>';
    return;
  }

  const maxImpact = Math.max(...depths.map(d => result.depthMaxImpact[d] || 0), 1);
  let barsHtml = '';

  depths.forEach(d => {
    const impact = Math.min(100, Math.round(result.depthMaxImpact[d] || 0));
    const count = result.depthCounts?.[d] || 0;
    const avg = Math.round(result.depthAvgImpact?.[d] || 0);
    const pct = Math.min(100, Math.round(((result.depthMaxImpact[d] || 0) / maxImpact) * 100));
    const label = d === 0 ? 'Seed' : d === 1 ? 'Parents' : d === 2 ? 'Grandparents' : `Depth ${d}`;
    barsHtml += `
      <div style="margin-bottom:6px">
        ${DotMatrix.labeledDotBar(label, pct, 20, { valueLabel: `${impact}%` })}
        <div style="font-size:0.7rem;color:#9CA3AF;margin-left:2px;margin-top:1px">${count} papers, avg impact ${avg}%</div>
      </div>
    `;
  });

  // Generate explanation based on the data pattern
  const seedImpact = Math.round(result.depthMaxImpact[0] || 0);
  const d1Impact = Math.round(result.depthMaxImpact[1] || 0);
  const d2Impact = Math.round(result.depthMaxImpact[2] || 0);
  const d1Count = result.depthCounts?.[1] || 0;
  const d2Count = result.depthCounts?.[2] || 0;
  const totalPapers = result.nodeCount || 1;

  let pattern = '';
  let explanation = '';

  if (d1Impact > d2Impact && d1Impact > 5) {
    pattern = 'SHALLOW ROOTS';
    const d2Why = d2Impact === 0
      ? `Grandparent papers (${d2Count} at depth 2) show 0% individual impact because there are so many alternative paths through them. Removing any single one doesn't collapse the graph, but collectively they are the foundation everything builds on.`
      : `${d2Count} grandparent papers at depth 2 have a lower peak impact of ${d2Impact}%, meaning the field has diversified its foundations.`;
    explanation = `The most structurally critical papers are the ${d1Count} direct parents at depth 1, with a peak impact of ${d1Impact}%. `
      + `These are the papers that, if removed, would cause the most damage to this lineage. `
      + d2Why;
  } else if (d2Impact > d1Impact && d2Impact > 5) {
    pattern = 'DEEP ROOTS';
    explanation = `The most influential work sits at depth 2 (grandparents) with ${d2Impact}% peak impact. `
      + `This lineage depends on foundational work from earlier generations. `
      + `${d2Count} grandparent papers carry more structural weight than the ${d1Count} direct parents. `
      + `The research has deep historical foundations that still shape the field today.`;
  } else if (d1Impact > 0 && d2Impact > 0 && Math.abs(d1Impact - d2Impact) < 5) {
    pattern = 'BALANCED DEPTH';
    explanation = `Impact is distributed across depth levels. `
      + `Parents (${d1Impact}% peak across ${d1Count} papers) and grandparents (${d2Impact}% peak across ${d2Count} papers) carry similar structural weight. `
      + `Each generation contributed meaningfully to this lineage.`;
  } else {
    pattern = 'DISTRIBUTED';
    const d2Why = d2Impact === 0
      ? `The ${d2Count} grandparent papers each have near-zero individual impact because the graph has enough redundancy at that depth that no single paper is a bottleneck.`
      : `${d2Count} grandparent papers have up to ${d2Impact}% individual impact.`;
    explanation = `The seed paper anchors this ${totalPapers}-paper lineage. `
      + `${d1Count} parent papers have up to ${d1Impact}% individual impact. `
      + d2Why;
  }

  container.innerHTML = `
    ${barsHtml}
    <div class="dm-card" style="margin-top:12px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:10px 12px">
      <div style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;font-weight:600;color:#374151;letter-spacing:0.05em;margin-bottom:4px">${pattern}</div>
      <p style="font-size:0.78rem;color:#4B5563;line-height:1.5;margin:0">${explanation}</p>
    </div>
  `;
}

async function _loadIdeaFlowWhy(result, body) {
  // Template fallback first
  const whyEl = body.querySelector('#ideaflow-why');
  if (!whyEl) return;

  const parts = [];
  if (result.dominantMutation !== 'unknown') {
    parts.push(`The dominant pattern is ${result.dominantMutation} (${result.dominantMutationCount} of ${result.totalNonIncidental} transformations). This means most papers in this lineage ${result.dominantMutation === 'generalization' ? 'take specific methods and apply them more broadly' : result.dominantMutation === 'adoption' ? 'directly inherit and reuse established methods' : result.dominantMutation === 'specialization' ? 'narrow general methods into focused applications' : 'transform ideas in varied ways'}.`);
  }
  if (result.topology.type === 'CONVERGING') {
    parts.push(`The field is converging: ${result.topology.mergePoints} merge points vs ${result.topology.branchPoints} branches. Ideas are consolidating toward fewer, stronger methods.`);
  } else if (result.topology.type === 'DIVERGING') {
    parts.push(`The field is diverging: ${result.topology.branchPoints} branches vs ${result.topology.mergePoints} merges. Research is expanding into new subfields faster than consolidating.`);
  }
  parts.push(`${result.topology.deadEnds} papers are dead ends with no downstream influence in this lineage.`);

  whyEl.innerHTML = parts.map(p => `<p class="dm-card-text">${p}</p>`).join('');
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 15 — ARCHITECT WHY NARRATIVES (Groq LLM with template fallback)
   ═══════════════════════════════════════════════════════════════════════════ */

async function _loadWhyNarratives(result, body) {
  const graphData = window._graphLoader?._graphData;
  const graphId = graphData?.metadata?.graph_id;
  const seedId = graphData?.metadata?.seed_paper_id;

  if (!graphId || !seedId) { _fillWhyFallbacks(result, body); return; }

  try {
    const topData = result.topAuthors.slice(0, 3).map(a => ({
      name: a.name, paperCount: a.paperCount, avgImpact: a.maxImpact,
      bottleneckCount: a.bottleneckCount, clusterCount: a.clusterCount,
      clusterNames: a.clusterNames, dominantMutation: a.dominantMutation,
      dominantMutationCount: a.dominantMutationCount, archetype: a.archetype,
      totalCitations: a.totalCitations, inDegree: a.inDegree,
      papers: a.papers.slice(0, 5).map(p => ({ title: p.title, year: p.year })),
      generation: result.generations.find(g => g.authors.some(ga => ga.name === a.name))?.name || '',
    }));

    const resp = await fetch(`/api/graph/${encodeURIComponent(graphId)}/architect-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed_paper_id: seedId, top_authors: topData, total_nodes: result.totalNodes, concentration_pct: result.top3Pct }),
    });

    if (resp.ok) {
      const data = await resp.json();
      (data.analyses || []).forEach((analysis, i) => {
        const el = body.querySelector(`#architect-why-${i}`);
        if (el && analysis.narrative) el.innerHTML = `<p class="dm-card-text">${_esc(analysis.narrative)}</p>`;
      });
      // Update power explanation with LLM version if available
      if (data.power_explanation) {
        const explainEl = body.querySelector('#power-explain');
        if (explainEl) explainEl.innerHTML = `<p>${_esc(data.power_explanation)}</p><p>Click any name to highlight their papers in the graph.</p>`;
      }
    } else { throw new Error('API error'); }
  } catch (err) {
    console.warn('Architect WHY fallback:', err);
    _fillWhyFallbacks(result, body);
  }
}

function _fillWhyFallbacks(result, body) {
  result.topAuthors.slice(0, 3).forEach((a, i) => {
    const el = body.querySelector(`#architect-why-${i}`);
    if (el) el.innerHTML = `<p class="dm-card-text">${_narrativeForAuthor(a, result)}</p>`;
  });
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 11 — GRAPH INTEGRATION (highlight author's papers)
   ═══════════════════════════════════════════════════════════════════════════ */

function _setupAuthorHighlight() {
  if (window._authorHighlightSetup) return;
  window._authorHighlightSetup = true;

  window.addEventListener('arivu:highlight-author', (e) => {
    const authorName = e.detail?.authorName;
    if (!authorName) return;
    const graphData = window._graphLoader?._graphData;
    if (!graphData?.nodes) return;

    const paperIds = new Set();
    graphData.nodes.forEach(n => {
      if ((n.authors || []).some(a => a === authorName)) paperIds.add(n.id);
    });
    if (paperIds.size === 0) return;

    const container = document.getElementById('graph-svg-container');
    (container ? container.querySelectorAll('svg') : []).forEach(svg => {
      const nodeEls = svg.querySelectorAll('g[data-id]');
      if (nodeEls.length === 0) return;
      nodeEls.forEach(ng => {
        const nid = ng.dataset?.id || ng.getAttribute('data-id');
        if (paperIds.has(nid)) { ng.style.opacity = '1'; ng.style.filter = 'drop-shadow(0 0 6px #D4A843)'; }
        else { ng.style.opacity = '0.15'; ng.style.filter = ''; }
      });
      svg.querySelectorAll('.edge-line, .link, line.link').forEach(e => e.style.opacity = '0.05');
      setTimeout(() => {
        nodeEls.forEach(ng => { ng.style.opacity = ''; ng.style.filter = ''; });
        svg.querySelectorAll('.edge-line, .link, line.link').forEach(e => e.style.opacity = '');
      }, 4000);
    });
  });
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 12 — SHARED UTILITIES
   ═══════════════════════════════════════════════════════════════════════════ */

function _nodeR(d, compact) { return (compact ? 8 : 11) + (d.normalizedPower / 100) * (compact ? 10 : 14); }
function _shortName(name) { if (!name) return '?'; const p = name.trim().split(/\s+/).filter(Boolean); return p.length >= 2 ? p[0][0] + '. ' + p[p.length - 1] : (p[0] || '?').substring(0, 10); }
function _initials(name) { if (!name) return '?'; const p = name.trim().split(/\s+/).filter(Boolean); return p.length >= 2 ? p[0][0] + p[p.length - 1][0] : (p[0] || '?')[0] || '?'; }
function _esc(s) { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _edgeId(val) { if (!val) return ''; if (typeof val === 'string') return val; if (typeof val === 'object' && val.id) return val.id; return String(val); }


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 13 — INITIALIZATION
   ═══════════════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  if (!document.querySelector('.tool-layout-v2')) return;
  window._dotSwitcher = new DotSwitcher();
  _setupAuthorHighlight();
  window.addEventListener('arivu:graph-ready', () => {
    // Reset dot registrations so wrappers are rebuilt for new graph data
    if (window._dotSwitcher) {
      window._dotSwitcher._views.delete('dna');
      window._dotSwitcher._views.delete('diversity');
      window._dotSwitcher._containers.delete('dna');
      window._dotSwitcher._containers.delete('diversity');
    }
    window._ideaFlowResult = null;
    window._architectResult = null;
    _registerDNADots(); _registerDiversityDots();
  });
  if (window._graphLoader?._graphData) setTimeout(() => { _registerDNADots(); _registerDiversityDots(); }, 500);
});

function _registerDNADots() {
  const switcher = window._dotSwitcher;
  if (!switcher || switcher._views.has('dna')) return;

  const dnaSection = document.getElementById('dna-section');
  if (!dnaSection) return;

  let wrapper = dnaSection.querySelector('.dna-content-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'dna-content-wrapper';
    const chartWrapper = dnaSection.querySelector('.dna-chart-wrapper');
    const comparison = dnaSection.querySelector('#dna-comparison');
    const view0 = document.createElement('div');
    view0.dataset.dotView = '0';
    if (chartWrapper) view0.appendChild(chartWrapper);
    if (comparison) view0.appendChild(comparison);
    wrapper.appendChild(view0);
    const dots = dnaSection.querySelector('.pagination-dots');
    if (dots) dnaSection.insertBefore(wrapper, dots);
    else dnaSection.appendChild(wrapper);
  }

  switcher.registerView('dna', 0, () => {}, wrapper, 'Semantic clusters in this paper\'s ancestry', 'Research DNA');
  switcher.registerView('dna', 1, (c) => ArchitectsPanel.render(c), wrapper, 'Who built this research lineage', 'Architects');
  switcher.registerView('dna', 2, (c) => { if (window.MomentumPanel) MomentumPanel.render(c); else c.innerHTML = '<p style="color:#9CA3AF;font-size:0.8rem;text-align:center;padding:40px">Loading...</p>'; }, wrapper, 'Overall field momentum', 'Momentum Tracker');
  switcher.registerView('dna', 3, (c) => _renderResearcherCharacter(c), wrapper, 'Your research companion', 'Researcher');
}

function _renderResearcherCharacter(container) {
  if (container.querySelector('.researcher-char-wrap')) return;

  const wrap = document.createElement('div');
  wrap.className = 'researcher-char-wrap';
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 0;overflow:hidden;';

  // Character container (for portal animation targeting)
  const charOuter = document.createElement('div');
  charOuter.className = 'pf-char-compact-container';
  charOuter.style.cssText = 'transition:transform 0.4s ease,opacity 0.4s ease;';

  if (window.ResearcherCharacter && window.RESEARCHER_SPRITES) {
    const charContainer = document.createElement('div');
    charOuter.appendChild(charContainer);
    const compactChar = new ResearcherCharacter(charContainer, { scale: 0.48 });
    window._compactResearcherCharacter = compactChar;
  } else {
    charOuter.innerHTML = '<p style="color:#9CA3AF;font-size:0.8rem;text-align:center;padding:40px">Loading character...</p>';
  }
  wrap.appendChild(charOuter);

  // Gone sign (hidden by default, shown when character portals to window)
  const goneSign = document.createElement('div');
  goneSign.className = 'pf-gone-sign';
  goneSign.style.display = 'none';
  goneSign.innerHTML = `
    <div style="margin:20px auto;width:80px;text-align:center;">
      <svg viewBox="0 0 60 40" width="60" style="display:block;margin:0 auto 8px;">
        ${(() => {
          let dots = '';
          for (let y = 0; y < 6; y++) for (let x = 0; x < 9; x++) {
            const isSign = y >= 1 && y <= 4 && x >= 1 && x <= 7;
            dots += `<circle cx="${x*7+3}" cy="${y*7+3}" r="2.2" fill="${isSign ? '#374151' : '#E5E7EB'}" opacity="${isSign ? 0.6 : 0.2}"/>`;
          }
          return dots;
        })()}
      </svg>
    </div>
    <p class="pf-gone-message" style="font:11px 'JetBrains Mono',monospace;color:#9CA3AF;text-align:center;margin:0;"></p>
  `;
  wrap.appendChild(goneSign);

  container.appendChild(wrap);
}

function _registerDiversityDots() {
  const switcher = window._dotSwitcher;
  if (!switcher || switcher._views.has('diversity')) return;

  const divSection = document.getElementById('diversity-section');
  if (!divSection) return;

  let wrapper = divSection.querySelector('.diversity-content-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'diversity-content-wrapper';
    const radarCanvas = divSection.querySelector('#diversity-radar-chart');
    const contextNote = divSection.querySelector('#diversity-context-note');
    const view0 = document.createElement('div');
    view0.dataset.dotView = '0';
    if (radarCanvas) view0.appendChild(radarCanvas);
    if (contextNote) view0.appendChild(contextNote);
    wrapper.appendChild(view0);
    const dots = divSection.querySelector('.pagination-dots');
    if (dots) divSection.insertBefore(wrapper, dots);
    else divSection.appendChild(wrapper);
  }

  switcher.registerView('diversity', 0, () => {}, wrapper, 'How broad are this paper\'s intellectual roots', 'Intellectual Diversity');
  switcher.registerView('diversity', 1, (c) => IdeaFlowPanel.render(c), wrapper, 'How ideas transform across this lineage', 'Idea Flow');
  switcher.registerView('diversity', 2, (c) => { if (window.BlindspotPanel) BlindspotPanel.render(c); else c.innerHTML = '<p style="color:#9CA3AF;font-size:0.8rem;text-align:center;padding:40px">Loading...</p>'; }, wrapper, 'Disputes and gaps in this lineage', 'Blind Spots & Battles');
  switcher.registerView('diversity', 3, (c) => { if (window.TrustEvidencePanel) TrustEvidencePanel.render(c); else c.innerHTML = '<p style="color:#9CA3AF;font-size:0.8rem;text-align:center;padding:40px">Loading...</p>'; }, wrapper, 'How reliable is this analysis', 'Trust & Evidence');
}

// Exports
window.ArchitectsWindow = ArchitectsWindow;
window.ArchitectsFullAnalysis = ArchitectsFullAnalysis;
window.ArchitectAnalyzer = ArchitectAnalyzer;
window.IdeaFlowWindow = IdeaFlowWindow;
window.IdeaFlowFullAnalysis = IdeaFlowFullAnalysis;
window.DotSwitcher = DotSwitcher;
window._zoomToNode = _zoomToNode;
window._diZoomToNode = _zoomToNode;


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 14 — LEGACY DeepIntelligence CLASS (backward compat)
   ═══════════════════════════════════════════════════════════════════════════ */

class DeepIntelligence {
  constructor() { this._cache = new Map(); }
  _edgeId(val) { return _edgeId(val); }
  _getGraphData() {
    const data = window._graphLoader?._graphData;
    if (!data) return null;
    const edges = (data.edges || []).map(e => ({ ...e, source: _edgeId(e.source), target: _edgeId(e.target) }));
    return { nodes: data.nodes || [], edges, metadata: data.metadata || {}, dna: data.dna_profile || null, diversity: data.diversity_score || null, leaderboard: data.leaderboard || null };
  }
  _getCached(key) { const e = this._cache.get(key); if (!e) return null; if (e.graphId !== this._getGraphData()?.metadata?.graph_id) { this._cache.delete(key); return null; } return e.data; }
  _setCache(key, data) { this._cache.set(key, { graphId: this._getGraphData()?.metadata?.graph_id || '', data }); }

  computeArchitects() {
    const cached = this._getCached('architects');
    if (cached) return cached;
    const graphData = window._graphLoader?._graphData;
    if (!graphData) return null;
    const r = new ArchitectAnalyzer(graphData).analyze();
    const result = {
      topAuthors: r.topAuthors.map(a => ({ name: a.name, papers: a.papers || [], paperCount: a.paperCount, archetype: a.archetype || 'contributor', clusterCount: a.clusterCount, clusters: a.clusterNames, depthSpan: '0-2', avgImpact: a.maxImpact, totalImpact: a.totalImpact, bottleneckCount: a.bottleneckCount, yearRange: a.yearRange, powerScore: a.structuralPower })),
      top3Concentration: r.top3Pct, totalAuthors: r.totalAuthors,
      generations: r.generations.map(g => ({ label: g.name, range: [0, 9999], authors: g.authors, yearRange: g.yearRange })),
      constellation: { nodes: r.topAuthors.slice(0, 8).map(a => ({ name: a.name, powerScore: a.structuralPower, clusterCount: a.clusterCount })), links: r.coAuthorLinks.slice(0, 10) },
    };
    this._setCache('architects', result); return result;
  }

  computeIdeaFlow() { const cached = this._getCached('ideaFlow'); if (cached) return cached; const g = this._getGraphData(); if (!g) return null; const { nodes, edges } = g; const nodeMap = new Map(nodes.map(n => [n.id, n])); const adjOut = new Map(); const adjIn = new Map(); edges.forEach(e => { if (!adjOut.has(e.source)) adjOut.set(e.source, []); adjOut.get(e.source).push(e); if (!adjIn.has(e.target)) adjIn.set(e.target, []); adjIn.get(e.target).push(e); }); const seed = nodes.find(n => n.is_seed); const criticalPath = seed ? this._findCriticalPath(seed.id, nodeMap, adjOut, edges) : []; const depthImpact = nodes.filter(n => n.pruning_impact > 0).map(n => ({ id: n.id, title: n.title, depth: n.depth, impact: n.pruning_impact, year: n.year })); const avgD = depthImpact.sort((a, b) => b.impact - a.impact).slice(0, 5).reduce((s, n) => s + n.depth, 0) / Math.min(5, depthImpact.length) || 0; let bp = 0, mp = 0, de = 0; nodes.forEach(n => { const o = (adjOut.get(n.id) || []).filter(e => e.mutation_type !== 'incidental').length; const i2 = (adjIn.get(n.id) || []).filter(e => e.mutation_type !== 'incidental').length; if (o > 1) bp++; if (i2 > 1) mp++; if (o === 0 && !n.is_seed) de++; }); const result = { criticalPath, depthImpact: depthImpact.sort((a, b) => b.impact - a.impact), depthClassification: avgD > 1.5 ? 'DEEP-ROOTED' : avgD > 0.8 ? 'BALANCED' : 'SHALLOW', avgDepthOfTop5: avgD.toFixed(1), topology: { branchPoints: bp, mergePoints: mp, deadEnds: de, type: mp > bp ? 'CONVERGING' : bp > mp ? 'DIVERGING' : 'BALANCED' } }; this._setCache('ideaFlow', result); return result; }

  _findCriticalPath(seedId, nodeMap, adjOut, edges) { let longest = []; const visited = new Set(); const dfs = (nid, path) => { if (path.length > longest.length) longest = [...path]; if (path.length > 20) return; for (const e of (adjOut.get(nid) || [])) { if (e.mutation_type === 'incidental' || visited.has(e.target)) continue; const tn = nodeMap.get(e.target); if (!tn) continue; visited.add(e.target); path.push({ nodeId: e.target, title: tn.title, year: tn.year, authors: tn.authors, mutationType: e.mutation_type, citationIntent: e.citation_intent, confidence: e.final_confidence, confidenceTier: e.confidence_tier, citingSentence: e.citing_sentence, citedSentence: e.cited_sentence, similarity: e.similarity_score }); dfs(e.target, path); path.pop(); visited.delete(e.target); } }; const sn = nodeMap.get(seedId); if (sn) { visited.add(seedId); dfs(seedId, [{ nodeId: seedId, title: sn.title, year: sn.year, authors: sn.authors, mutationType: null, isSeed: true }]); } return longest; }

  computeMomentum() { const cached = this._getCached('momentum'); if (cached) return cached; const g = this._getGraphData(); if (!g) return null; const { nodes, edges, dna } = g; const clusters = dna?.clusters || []; const clusterLifecycle = clusters.map(c => { const cn = nodes.filter(n => (c.papers || []).includes(n.id)); const yb = {}; cn.forEach(n => { if (n.year) { const d = Math.floor(n.year / 5) * 5; yb[d] = (yb[d] || 0) + 1; } }); const years = Object.keys(yb).map(Number).sort((a, b) => a - b); const counts = years.map(y => yb[y]); let status = 'STABLE'; if (counts.length >= 2) { const pi = counts.indexOf(Math.max(...counts)); if (pi === counts.length - 1) status = 'EMERGING'; else if (pi <= 1 && counts.length > 3) status = 'DECLINING'; else if (pi > 0 && pi < counts.length - 1) status = 'PEAKING'; } return { name: c.name, color: c.color, percentage: c.percentage, years, counts, status, paperCount: cn.length, isSeedCluster: cn.some(n => n.is_seed) }; }); const sparklines = nodes.filter(n => n.citation_count > 0 && n.year).sort((a, b) => b.citation_count - a.citation_count).slice(0, 10).map(n => { const age = Math.max(1, new Date().getFullYear() - n.year); return { id: n.id, title: n.title, year: n.year, citations: n.citation_count, velocity: Math.round(n.citation_count / age), sparkData: Array.from({ length: 5 }, (_, i) => Math.round(n.citation_count * Math.pow((i + 1) / 5, 0.7))), isSeed: n.is_seed }; }); const yeCount = {}, ypCount = {}; nodes.forEach(n => { if (n.year) { const b = Math.floor(n.year / 5) * 5; ypCount[b] = (ypCount[b] || 0) + 1; } }); const nById = new Map(nodes.map(n => [n.id, n])); edges.forEach(e => { if (e.mutation_type === 'incidental') return; const sn = nById.get(e.source); if (sn?.year) { const b = Math.floor(sn.year / 5) * 5; yeCount[b] = (yeCount[b] || 0) + 1; } }); const allY = [...new Set([...Object.keys(yeCount), ...Object.keys(ypCount)])].map(Number).sort((a, b) => a - b); const conv = allY.map(y => ({ year: y, papers: ypCount[y] || 0, edges: yeCount[y] || 0, ratio: (ypCount[y] || 0) > 0 ? ((yeCount[y] || 0) / ypCount[y]).toFixed(2) : 0 })); const ratios = conv.map(c => parseFloat(c.ratio)); const avg = ratios.length > 0 ? ratios.reduce((s, r) => s + r, 0) / ratios.length : 0; const std = ratios.length > 1 ? Math.sqrt(ratios.reduce((s, r) => s + (r - avg) ** 2, 0) / ratios.length) : 0; const result = { clusterLifecycle, sparklines, convergence: conv, convergenceEvents: conv.filter(c => parseFloat(c.ratio) > avg + std && c.edges >= 3).map(c => ({ year: c.year, edges: c.edges, papers: c.papers })) }; this._setCache('momentum', result); return result; }

  computeBlindSpots() { const cached = this._getCached('blindSpots'); if (cached) return cached; const g = this._getGraphData(); if (!g) return null; const { nodes, edges } = g; const nodeMap = new Map(nodes.map(n => [n.id, n])); const ce = edges.filter(e => e.mutation_type === 'contradiction' || e.citation_intent === 'direct_contradiction' || e.citation_intent === 'negative_citation'); const battles = ce.map(e => { const s = nodeMap.get(e.source), t = nodeMap.get(e.target); if (!s || !t) return null; const sc = s.citation_count || 0, tc = t.citation_count || 0; const r = Math.max(sc, tc) / Math.max(1, Math.min(sc, tc)); let status = 'ACTIVE', winner = null; if (r > 3) { status = 'RESOLVED'; winner = sc > tc ? s : t; } return { source: { id: s.id, title: s.title, year: s.year, citations: sc, authors: s.authors }, target: { id: t.id, title: t.title, year: t.year, citations: tc, authors: t.authors }, mutationType: e.mutation_type, confidence: e.confidence_tier, status, winner: winner?.title || null, citingSentence: e.citing_sentence, citedSentence: e.cited_sentence }; }).filter(Boolean); const fc = {}; nodes.forEach(n => (n.fields_of_study || []).forEach(f => { fc[f] = (fc[f] || 0) + 1; })); const bs = []; Object.keys(fc).forEach(f => { const c = fc[f]; if ((c / nodes.length) * 100 < 3 && c >= 1) { const fns = new Set(nodes.filter(n => (n.fields_of_study || []).includes(f)).map(n => n.id)); const ce2 = edges.filter(e => (fns.has(e.source) || fns.has(e.target)) && e.mutation_type !== 'incidental'); if (ce2.length >= 2) bs.push({ field: f, paperCount: c, edgeCount: ce2.length, reason: `${c} paper${c > 1 ? 's' : ''} but ${ce2.length} meaningful connections` }); } }); const result = { battles: battles.sort((a, b) => (a.status === 'ACTIVE' ? -1 : 1) - (b.status === 'ACTIVE' ? -1 : 1)), blindSpots: bs.sort((a, b) => b.edgeCount - a.edgeCount), missingCitations: [], stats: { totalContradictions: ce.length, activeDisputes: battles.filter(b => b.status === 'ACTIVE').length, resolvedDisputes: battles.filter(b => b.status === 'RESOLVED').length, blindSpotCount: bs.length } }; this._setCache('blindSpots', result); return result; }

  computeReadingRoadmap() { const cached = this._getCached('roadmap'); if (cached) return cached; const g = this._getGraphData(); if (!g) return null; const { nodes, edges } = g; const seed = nodes.find(n => n.is_seed); const bn = nodes.filter(n => n.is_bottleneck).sort((a, b) => (b.pruning_impact || 0) - (a.pruning_impact || 0)); const hi = nodes.filter(n => n.pruning_impact > 5 && !n.is_bottleneck && !n.is_seed).sort((a, b) => (b.pruning_impact || 0) - (a.pruning_impact || 0)); const dr = new Set(edges.filter(e => e.source === seed?.id).map(e => e.target)); const cd = nodes.filter(n => !n.is_seed && !dr.has(n.id) && n.pruning_impact > 3).sort((a, b) => (b.pruning_impact || 0) - (a.pruning_impact || 0)).slice(0, 5).map(n => ({ id: n.id, title: n.title, year: n.year, reason: n.is_bottleneck ? `Bottleneck: ${n.pruning_impact?.toFixed(1)}% impact` : `High impact (${n.pruning_impact?.toFixed(1)}%) at depth ${n.depth}` })); const rm = []; if (seed) rm.push({ ...seed, reason: 'Your starting point', symbol: 'star', priority: 1 }); bn.slice(0, 3).forEach((n, i) => rm.push({ ...n, reason: `Bottleneck #${i + 1}: ${n.pruning_impact?.toFixed(1)}% impact`, symbol: 'diamond', priority: 2 })); hi.slice(0, 3).forEach(n => rm.push({ ...n, reason: `High structural importance at depth ${n.depth}`, symbol: 'circle', priority: 3 })); const roots = nodes.filter(n => n.is_root && !n.is_seed).sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0)); if (roots.length > 0) rm.push({ ...roots[0], reason: 'Foundational root, deepest ancestor', symbol: 'triangle', priority: 4 }); const result = { roadmap: rm.slice(0, 8), citationDebt: cd }; this._setCache('roadmap', result); return result; }

  computeTrustEvidence() { const cached = this._getCached('trust'); if (cached) return cached; const g = this._getGraphData(); if (!g) return null; const { nodes, edges } = g; const te = edges.length; const cd = { HIGH: 0, MEDIUM: 0, LOW: 0, SPECULATIVE: 0 }; edges.forEach(e => { cd[e.confidence_tier || 'SPECULATIVE'] = (cd[e.confidence_tier || 'SPECULATIVE'] || 0) + 1; }); const td = { 1: 0, 2: 0, 3: 0, 4: 0 }; nodes.forEach(n => { td[n.text_tier || 4] = (td[n.text_tier || 4] || 0) + 1; }); const cc = edges.filter(e => e.comparable).length; const hct = edges.filter(e => (e.confidence_tier === 'HIGH' || e.confidence_tier === 'MEDIUM') && (e.citing_text_source !== 'none' || e.cited_text_source !== 'none')).length; const hcTotal = cd.HIGH + cd.MEDIUM; const lcto = edges.filter(e => (e.confidence_tier === 'LOW' || e.confidence_tier === 'SPECULATIVE') && e.citing_text_source === 'none' && e.cited_text_source === 'none').length; const lcTotal = cd.LOW + cd.SPECULATIVE; const nodeMap = new Map(nodes.map(n => [n.id, n])); const risks = []; nodes.filter(n => n.pruning_impact > 20 && !n.is_seed).sort((a, b) => (b.pruning_impact || 0) - (a.pruning_impact || 0)).slice(0, 3).forEach(n => risks.push({ type: 'SINGLE_THREAD', severity: n.pruning_impact > 30 ? 'critical' : 'warning', title: 'Single-Thread Dependency', description: `${n.title} (${n.year || '?'}): ${n.pruning_impact?.toFixed(1)}% affected if flawed.`, impact: n.pruning_impact, paperId: n.id, paperTitle: n.title })); const sbn = edges.filter(e => { const t = nodeMap.get(e.target); return (e.confidence_tier === 'SPECULATIVE' || e.confidence_tier === 'LOW') && t?.is_bottleneck; }); if (sbn.length > 0) risks.push({ type: 'WEAK_FOUNDATION', severity: sbn.length > 5 ? 'critical' : 'warning', title: 'Low-Confidence Foundations', description: `${sbn.length} edge${sbn.length > 1 ? 's' : ''} connecting to bottlenecks are low confidence.`, count: sbn.length }); const ac = edges.filter(e => e.mutation_type === 'adoption').length; const contr = edges.filter(e => e.mutation_type === 'contradiction').length; if (ac > 10 && contr === 0) risks.push({ type: 'UNCONTESTED', severity: 'info', title: 'Uncontested Assumptions', description: `${ac} adoptions, 0 contradictions.` }); const bt = {}; edges.forEach(e => { if (!e.citing_sentence && !e.cited_sentence) return; if (!e.comparable) return; const t = e.mutation_type || 'unknown'; if (!bt[t]) bt[t] = []; bt[t].push({ source: nodeMap.get(e.source), target: nodeMap.get(e.target), citingSentence: e.citing_sentence, citedSentence: e.cited_sentence, similarity: e.similarity_score, confidence: e.confidence_tier, mutationType: e.mutation_type, citationIntent: e.citation_intent }); }); const to = { HIGH: 0, MEDIUM: 1, LOW: 2, SPECULATIVE: 3 }; Object.values(bt).forEach(arr => arr.sort((a, b) => (to[a.confidence] || 4) - (to[b.confidence] || 4))); const result = { confDist: cd, textDist: td, comparableCount: cc, incomparableCount: te - cc, totalEdges: te, trustedPct: te > 0 ? Math.round(((cd.HIGH + cd.MEDIUM) / te) * 100) : 0, comparablePct: te > 0 ? Math.round((cc / te) * 100) : 0, highConfTextPct: hcTotal > 0 ? Math.round((hct / hcTotal) * 100) : 0, lowConfTitleOnlyPct: lcTotal > 0 ? Math.round((lcto / lcTotal) * 100) : 0, fragility: risks, evidenceGallery: bt, totalNodes: nodes.length }; this._setCache('trust', result); return result; }
}

window.DeepIntel = new DeepIntelligence();
