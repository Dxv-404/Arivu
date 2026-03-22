/**
 * static/js/momentum-tracker.js
 * Momentum Tracker — Field Pulse, Citation Velocity, Temporal Convergence, Orbital System.
 * All visualizations use pure SVG dot matrix circles (Nothing OS aesthetic).
 *
 * Layer 1 (compact): Momentum Gauge semicircle
 * Layer 2 (window): Field Pulse cards + LLM analysis section
 * Layer 3 (full): Citation Velocity + Temporal Convergence + Orbital System
 */

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 1 — MOMENTUM ANALYZER (pure client-side computation)
   ═══════════════════════════════════════════════════════════════════════════ */

class MomentumAnalyzer {
  constructor(graphData) {
    this._graphData = graphData;
    this._nodes = graphData?.nodes || [];
    this._edges = (graphData?.edges || []).map(e => ({
      ...e,
      source: typeof e.source === 'object' ? e.source.id : e.source,
      target: typeof e.target === 'object' ? e.target.id : e.target,
    }));
    this._dna = graphData?.dna_profile || null;
    this._result = null;
  }

  analyze() {
    if (this._result) return this._result;

    const fields = this._computeFieldPulse();
    const velocity = this._computeCitationVelocity();
    const convergence = this._computeTemporalConvergence();
    const orbital = this._computeOrbitalData(fields);
    const gauge = this._computeGauge(fields);

    this._result = { fields, velocity, convergence, orbital, gauge };
    return this._result;
  }

  // ── Field Pulse: per-field lifecycle analysis ─────────────────────────

  _computeFieldPulse() {
    const fieldMap = new Map();
    const seedNode = this._nodes.find(n => n.is_seed);
    const seedFields = new Set(seedNode?.fields_of_study || []);

    this._nodes.forEach(node => {
      (node.fields_of_study || []).forEach(field => {
        if (!field?.trim()) return;
        if (!fieldMap.has(field)) {
          fieldMap.set(field, {
            name: field,
            papers: [],
            years: [],
            totalCitations: 0,
            isSeedField: seedFields.has(field),
          });
        }
        const f = fieldMap.get(field);
        f.papers.push({ id: node.id, title: node.title, year: node.year, citations: node.citation_count || 0 });
        if (node.year) f.years.push(node.year);
        f.totalCitations += (node.citation_count || 0);
      });
    });

    // Also use DNA clusters if available
    const clusters = this._dna?.clusters || [];
    const clusterFields = new Map();
    clusters.forEach(c => {
      if (c.name && c.papers?.length) {
        clusterFields.set(c.name, {
          color: c.color || '#6B7280',
          percentage: c.percentage || 0,
          paperIds: new Set(c.papers),
        });
      }
    });

    const results = [];
    fieldMap.forEach((field, name) => {
      if (field.papers.length < 1) return;

      // Compute year bins (3-year windows for mini-graph)
      const yearBins = {};
      field.years.forEach(y => {
        const bin = Math.floor(y / 3) * 3;
        yearBins[bin] = (yearBins[bin] || 0) + 1;
      });

      const sortedBins = Object.keys(yearBins).map(Number).sort((a, b) => a - b);
      const binCounts = sortedBins.map(y => yearBins[y]);
      const maxBin = Math.max(...binCounts, 1);

      // Determine lifecycle status
      const status = this._determineStatus(binCounts, sortedBins);

      // Find matching cluster color
      let color = '#6B7280';
      clusterFields.forEach((cf, cName) => {
        if (cName.toLowerCase().includes(name.toLowerCase().split(' ')[0]) ||
            name.toLowerCase().includes(cName.toLowerCase().split(' ')[0])) {
          color = cf.color;
        }
      });

      results.push({
        name,
        paperCount: field.papers.length,
        totalCitations: field.totalCitations,
        avgCitations: field.papers.length > 0 ? Math.round(field.totalCitations / field.papers.length) : 0,
        isSeedField: field.isSeedField,
        status,
        color,
        yearBins: sortedBins,
        binCounts,
        maxBin,
        yearRange: sortedBins.length > 0 ? `${sortedBins[0]}-${sortedBins[sortedBins.length - 1] + 2}` : 'N/A',
        papers: field.papers.sort((a, b) => (b.citations || 0) - (a.citations || 0)),
      });
    });

    // Sort: peaking first, then by paper count
    const statusOrder = { PEAKING: 0, EMERGING: 1, STABLE: 2, DECLINING: 3 };
    results.sort((a, b) => {
      const so = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (so !== 0) return so;
      return b.paperCount - a.paperCount;
    });

    // Assign colors if not matched from clusters
    const defaultColors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F97316', '#EAB308', '#10B981', '#06B6D4', '#6366F1'];
    results.forEach((f, i) => {
      if (f.color === '#6B7280') {
        f.color = defaultColors[i % defaultColors.length];
      }
    });

    return results;
  }

  _determineStatus(binCounts, sortedBins) {
    if (binCounts.length < 2) return 'STABLE';

    const peakIdx = binCounts.indexOf(Math.max(...binCounts));
    const totalBins = binCounts.length;
    const lastTwo = binCounts.slice(-2);
    const firstTwo = binCounts.slice(0, 2);
    const lastSum = lastTwo.reduce((s, v) => s + v, 0);
    const firstSum = firstTwo.reduce((s, v) => s + v, 0);

    // EMERGING: only appears in the last 1-2 bins and wasn't present earlier
    const earlyBins = binCounts.slice(0, Math.max(1, totalBins - 2));
    const earlySum = earlyBins.reduce((s, v) => s + v, 0);
    if (earlySum === 0 && lastSum > 0) return 'EMERGING';

    // PEAKING: peak is in the last 2 bins and recent activity > early activity
    if (peakIdx >= totalBins - 2 && lastSum > firstSum) return 'PEAKING';

    // DECLINING: peak is early and recent activity is much lower
    if (peakIdx <= 1 && totalBins > 3 && lastSum < firstSum * 0.5) return 'DECLINING';

    return 'STABLE';
  }

  // ── Citation Velocity: top papers ranked by citations ──────────────────

  _computeCitationVelocity() {
    const topPapers = this._nodes
      .filter(n => n.citation_count > 0 && n.year)
      .sort((a, b) => b.citation_count - a.citation_count)
      .slice(0, 10)
      .map(n => ({
        id: n.id,
        title: n.title,
        year: n.year,
        citations: n.citation_count,
        isSeed: n.is_seed || false,
        isBottleneck: n.is_bottleneck || false,
        authors: (n.authors || []).slice(0, 2).join(', '),
        shortTitle: this._shortenTitle(n.title),
      }));

    // Sort by year for the line graph
    const byYear = [...topPapers].sort((a, b) => a.year - b.year);
    const maxCitations = Math.max(...topPapers.map(p => p.citations), 1);

    return {
      topPapers,
      byYear,
      maxCitations,
      totalCitations: this._nodes.reduce((s, n) => s + (n.citation_count || 0), 0),
    };
  }

  _shortenTitle(title) {
    if (!title) return '?';
    // Take first 3-4 meaningful words
    const words = title.split(/\s+/).filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'via', 'using'].includes(w.toLowerCase()));
    return words.slice(0, 3).join(' ');
  }

  // ── Temporal Convergence: papers vs edges per year ────────────────────

  _computeTemporalConvergence() {
    const nodeById = new Map(this._nodes.map(n => [n.id, n]));
    const yearPapers = {};
    const yearEdges = {};

    this._nodes.forEach(n => {
      if (!n.year) return;
      const bin = Math.floor(n.year / 5) * 5;
      yearPapers[bin] = (yearPapers[bin] || 0) + 1;
    });

    this._edges.forEach(e => {
      if (e.mutation_type === 'incidental') return;
      const sourceNode = nodeById.get(e.source);
      if (!sourceNode?.year) return;
      const bin = Math.floor(sourceNode.year / 5) * 5;
      yearEdges[bin] = (yearEdges[bin] || 0) + 1;
    });

    const allYears = [...new Set([...Object.keys(yearPapers), ...Object.keys(yearEdges)])]
      .map(Number).sort((a, b) => a - b);

    const columns = allYears.map(y => ({
      year: y,
      papers: yearPapers[y] || 0,
      edges: yearEdges[y] || 0,
    }));

    const maxPapers = Math.max(...columns.map(c => c.papers), 1);
    const maxEdges = Math.max(...columns.map(c => c.edges), 1);
    const maxTotal = Math.max(...columns.map(c => c.papers + c.edges), 1);

    // Detect convergence events (edge density spikes)
    const edgeCounts = columns.map(c => c.edges);
    const avgEdges = edgeCounts.length > 0 ? edgeCounts.reduce((s, v) => s + v, 0) / edgeCounts.length : 0;
    const stdEdges = edgeCounts.length > 1
      ? Math.sqrt(edgeCounts.reduce((s, v) => s + (v - avgEdges) ** 2, 0) / edgeCounts.length) : 0;

    const events = columns
      .filter(c => c.edges > avgEdges + stdEdges && c.edges >= 3)
      .map(c => ({ year: c.year, edges: c.edges, papers: c.papers }));

    return { columns, maxPapers, maxEdges, maxTotal, events, totalMeaningfulEdges: edgeCounts.reduce((s, v) => s + v, 0) };
  }

  // ── Orbital Data: field proximity to seed ─────────────────────────────

  _computeOrbitalData(fields) {
    const seedNode = this._nodes.find(n => n.is_seed);
    const seedFields = new Set(seedNode?.fields_of_study || []);

    // Calculate proximity: fields that share papers with the seed's field are "inner"
    const fieldProximity = fields.map(f => {
      let proximity = 3; // default: outer orbit

      // Inner orbit: same field as seed
      if (seedFields.has(f.name)) proximity = 1;
      // Middle orbit: shares papers at depth 0-1
      else {
        const hasCloseConnection = f.papers.some(p => {
          const node = this._nodes.find(n => n.id === p.id);
          return node && (node.depth === 0 || node.depth === 1);
        });
        if (hasCloseConnection) proximity = 2;
      }

      return {
        ...f,
        orbit: proximity,
        orbitLabel: proximity === 1 ? 'Core' : proximity === 2 ? 'Related' : 'Tangential',
        maxCitations: Math.max(...(f.papers || []).map(p => p.citations || 0), 0),
      };
    });

    // Cap at top 10 for visual clarity
    const topFields = fieldProximity.slice(0, 10);
    const remainingCount = fieldProximity.length - topFields.length;
    const remainingPapers = fieldProximity.slice(10).reduce((s, f) => s + f.paperCount, 0);

    return {
      planets: topFields,
      remainingCount,
      remainingPapers,
      orbits: [
        { level: 1, label: 'Core', radius: 0.3 },
        { level: 2, label: 'Related', radius: 0.6 },
        { level: 3, label: 'Tangential', radius: 0.9 },
      ],
    };
  }

  // ── Gauge Score: overall momentum ─────────────────────────────────────

  _computeGauge(fields) {
    const total = fields.length;
    if (total === 0) return { score: 0, label: 'NO DATA', peaking: 0, stable: 0, declining: 0, emerging: 0 };

    const peaking = fields.filter(f => f.status === 'PEAKING').length;
    const emerging = fields.filter(f => f.status === 'EMERGING').length;
    const stable = fields.filter(f => f.status === 'STABLE').length;
    const declining = fields.filter(f => f.status === 'DECLINING').length;

    // Score: 100 if all peaking, 0 if all declining
    // Weight: peaking=100, emerging=80, stable=50, declining=10
    const weightedSum = (peaking * 100 + emerging * 80 + stable * 50 + declining * 10);
    const score = Math.round(weightedSum / total);

    let label = 'STABLE';
    if (score >= 80) label = 'ACCELERATING';
    else if (score >= 60) label = 'GROWING';
    else if (score >= 40) label = 'STABLE';
    else if (score >= 20) label = 'COOLING';
    else label = 'DECLINING';

    return { score, label, peaking, stable, declining, emerging, total };
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 2 — COMPACT VIEW: Momentum Gauge (semicircle dot matrix)
   ═══════════════════════════════════════════════════════════════════════════ */

class MomentumPanel {
  static render(container) {
    const graphData = window._graphLoader?._graphData;
    if (!graphData?.nodes?.length) {
      container.innerHTML = '<p style="color:#9CA3AF;font-size:0.8rem;text-align:center;padding:40px">No graph data available.</p>';
      return;
    }

    const analyzer = new MomentumAnalyzer(graphData);
    const result = analyzer.analyze();
    window._momentumResult = result;

    const { gauge } = result;

    // Build semicircle gauge from SVG dots
    const totalDots = 20; // dots in the semicircle arc
    const filledDots = Math.round((gauge.score / 100) * totalDots);
    const cx = 100, cy = 85, radius = 65;

    let dots = '';
    for (let i = 0; i < totalDots; i++) {
      // Angle from 180 to 0 degrees (left to right semicircle)
      const angle = Math.PI - (i / (totalDots - 1)) * Math.PI;
      const x = cx + radius * Math.cos(angle);
      const y = cy - radius * Math.sin(angle);
      const filled = i < filledDots;
      const r = filled ? 4.5 : 3.5;
      const fill = filled ? '#374151' : '#E5E7EB';
      const opacity = filled ? (0.4 + (i / filledDots) * 0.6) : 0.5;
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" opacity="${opacity.toFixed(2)}" />`;
    }

    // Score text in center
    const scoreText = `<text x="${cx}" y="${cy - 8}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="24" font-weight="700" fill="#1F2937">${gauge.score}</text>`;
    const labelText = `<text x="${cx}" y="${cy + 12}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9" font-weight="500" fill="#6B7280" letter-spacing="1.5">${gauge.label}</text>`;
    const maxText = `<text x="${cx}" y="${cy + 26}" text-anchor="middle" font-family="Inter, sans-serif" font-size="8" fill="#9CA3AF">/ 100</text>`;

    const svg = `<svg viewBox="0 0 200 110" width="200" style="display:block;margin:0 auto;">
      ${dots}${scoreText}${labelText}${maxText}
    </svg>`;

    const statsLine = `${gauge.peaking} peaking · ${gauge.declining} declining · ${gauge.stable} stable`;

    container.innerHTML = `
      <div style="text-align:center;padding:8px 0;">
        ${svg}
        <p style="font-size:0.75rem;color:#6B7280;margin:8px 0 0 0;">${statsLine}</p>
      </div>
    `;
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 3 — WINDOW VIEW: Field Pulse Cards + Analysis
   ═══════════════════════════════════════════════════════════════════════════ */

class MomentumWindow {
  static populate(body) {
    const graphData = window._graphLoader?._graphData;
    if (!graphData?.nodes?.length) {
      body.innerHTML = '<p style="color:#9CA3AF;padding:40px;text-align:center">No graph data.</p>';
      return;
    }

    const result = window._momentumResult || new MomentumAnalyzer(graphData).analyze();
    window._momentumResult = result;

    body.innerHTML = `
      <div class="mt-window-content">
        <h4 class="mt-section-title">FIELD PULSE</h4>
        <div class="mt-cards-scroll" id="mt-cards-container"></div>
        <div class="mt-analysis-section" id="mt-analysis-container">
          <p class="mt-analysis-placeholder">Click a field card above to see analysis</p>
        </div>
        <div class="mt-detailed-link" id="mt-readmore-link">
          <span>DETAILED DATA</span>
          <button class="mt-readmore-btn">View full analysis →</button>
        </div>
      </div>
    `;

    // Render field pulse cards
    const cardsContainer = body.querySelector('#mt-cards-container');
    this._renderFieldCards(cardsContainer, result);

    // Wire read more
    const readmoreBtn = body.querySelector('.mt-readmore-btn');
    if (readmoreBtn) {
      readmoreBtn.addEventListener('click', () => {
        MomentumFullAnalysis.show(body, result);
      });
    }
  }

  static _renderFieldCards(container, result) {
    const { fields } = result;
    if (!fields?.length) {
      container.innerHTML = '<p style="color:#9CA3AF;text-align:center;padding:20px;">No field data.</p>';
      return;
    }

    // Show top fields (max 15 to avoid too many cards)
    const displayFields = fields.slice(0, 15);

    let cardsHTML = '';
    displayFields.forEach((field, idx) => {
      const statusColors = {
        PEAKING: '#22C55E', EMERGING: '#3B82F6', STABLE: '#6B7280', DECLINING: '#EF4444'
      };
      const statusColor = statusColors[field.status] || '#6B7280';

      // Build mini dot matrix pulse graph (SVG)
      const miniGraph = this._buildMiniPulseGraph(field, 80, 40);

      cardsHTML += `
        <div class="mt-field-card" data-field-index="${idx}" data-field-name="${field.name}">
          <div class="mt-card-header">
            <span class="mt-card-name">${field.name}</span>
            <span class="mt-card-dot" style="background:${field.color}"></span>
          </div>
          <div class="mt-card-count">${field.paperCount} paper${field.paperCount !== 1 ? 's' : ''}</div>
          <div class="mt-card-graph">${miniGraph}</div>
          <div class="mt-card-status">
            <span class="mt-status-dot" style="background:${statusColor}"></span>
            <span class="mt-status-label">${field.status}</span>
          </div>
          <div class="mt-card-snippet">${this._getFieldSnippet(field)}</div>
        </div>
      `;
    });

    container.innerHTML = cardsHTML;

    // Add click handlers
    container.querySelectorAll('.mt-field-card').forEach(card => {
      card.addEventListener('click', () => {
        // Remove active from all
        container.querySelectorAll('.mt-field-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');

        const idx = parseInt(card.dataset.fieldIndex, 10);
        const field = displayFields[idx];
        this._showFieldAnalysis(field, result);
      });
    });
  }

  static _buildMiniPulseGraph(field, width, height) {
    const { binCounts, maxBin } = field;
    if (!binCounts?.length) return '<svg width="80" height="40"></svg>';

    const cols = binCounts.length;
    const rows = 6; // dot rows for mini graph
    const dotR = 2.2;
    const colSpacing = Math.max(6, Math.min(10, width / (cols + 1)));
    const rowSpacing = 5.5;
    const svgW = (cols + 1) * colSpacing;
    const svgH = rows * rowSpacing + 4;

    let circles = '';
    binCounts.forEach((count, colIdx) => {
      const x = (colIdx + 1) * colSpacing;
      const filledRows = Math.max(0, Math.round((count / maxBin) * rows));

      for (let row = 0; row < rows; row++) {
        const y = (rows - 1 - row) * rowSpacing + dotR + 2;
        const isFilled = row < filledRows;

        if (isFilled) {
          // Line width: fill this dot + partial adjacent dots for thickness
          const intensity = 0.35 + (row / Math.max(filledRows, 1)) * 0.65;
          circles += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" fill="#374151" opacity="${intensity.toFixed(2)}" />`;

          // Add "thickness" dots: 1 dot above the line edge for 2-3 dot width effect
          if (row === filledRows - 1 && row + 1 < rows) {
            const aboveY = (rows - 1 - (row + 1)) * rowSpacing + dotR + 2;
            circles += `<circle cx="${x.toFixed(1)}" cy="${aboveY.toFixed(1)}" r="${dotR * 0.7}" fill="#374151" opacity="0.2" />`;
          }
        } else {
          circles += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR * 0.6}" fill="#E5E7EB" opacity="0.4" />`;
        }
      }
    });

    return `<svg viewBox="0 0 ${svgW.toFixed(0)} ${svgH.toFixed(0)}" width="${Math.min(width, svgW * 1.2).toFixed(0)}" style="display:block;margin:0 auto;"><rect width="100%" height="100%" fill="none"/>${circles}</svg>`;
  }

  static _getFieldSnippet(field) {
    const { status, paperCount, yearRange } = field;
    if (status === 'PEAKING') return `${paperCount} papers, activity rising`;
    if (status === 'EMERGING') return `New presence, gaining traction`;
    if (status === 'DECLINING') return `Activity tapering off`;
    return `Consistent presence across ${yearRange}`;
  }

  static _showFieldAnalysis(field, result) {
    const analysisContainer = document.getElementById('mt-analysis-container');
    if (!analysisContainer) return;

    // Show convergence event tag if relevant
    const events = result.convergence?.events || [];
    let eventTag = '';
    if (events.length > 0) {
      const mainEvent = events[events.length - 1];
      eventTag = `
        <div class="mt-event-tag" title="A convergence event is a period when meaningful connections between papers spiked significantly above average, indicating rapid knowledge integration.">
          ${events.length} convergence event${events.length > 1 ? 's' : ''} (${mainEvent.year}s, ${mainEvent.edges} connections)
        </div>
      `;
    }

    // Show shimmer while loading LLM analysis
    analysisContainer.innerHTML = `
      ${eventTag}
      <div class="mt-field-analysis-content">
        <div class="mt-shimmer-block" style="height:14px;width:90%;margin-bottom:8px;border-radius:4px;"></div>
        <div class="mt-shimmer-block" style="height:14px;width:85%;margin-bottom:8px;border-radius:4px;"></div>
        <div class="mt-shimmer-block" style="height:14px;width:70%;margin-bottom:8px;border-radius:4px;"></div>
        <div class="mt-shimmer-block" style="height:14px;width:80%;margin-bottom:8px;border-radius:4px;"></div>
      </div>
    `;

    // Fetch LLM analysis for this field — guard against race conditions
    const fetchId = Date.now();
    MomentumWindow._activeFetchId = fetchId;
    this._fetchFieldAnalysis(field, result).then(analysis => {
      // Only apply if this is still the active fetch (user didn't click another card)
      if (MomentumWindow._activeFetchId !== fetchId) return;
      const contentEl = analysisContainer.querySelector('.mt-field-analysis-content');
      if (contentEl) {
        contentEl.innerHTML = `<div class="mt-llm-text">${analysis}</div>`;
      }
    });
  }

  static async _fetchFieldAnalysis(field, result) {
    const seedPaperId = window._graphLoader?._graphData?.metadata?.seed_paper_id;
    if (!seedPaperId) return this._templateFieldAnalysis ? this._templateFieldAnalysis(field) : '<p>No graph data available.</p>';
    const seedTitle = window._graphLoader?._graphData?.metadata?.seed_paper_title || 'the seed paper';

    try {
      const res = await fetch(`/api/graph/${encodeURIComponent(seedPaperId)}/momentum-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed_paper_id: seedPaperId,
          seed_paper_title: seedTitle,
          field_name: field.name,
          field_paper_count: field.paperCount,
          field_status: field.status,
          field_total_citations: field.totalCitations,
          field_year_range: field.yearRange,
          field_top_papers: field.papers.slice(0, 5).map(p => `${p.title} (${p.year})`),
          convergence_events: (result.convergence?.events || []).map(e => `${e.year}: ${e.edges} edges`),
          analysis_type: 'field',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return data.analysis || this._templateFieldAnalysis(field);
      }
    } catch (e) {
      console.warn('Momentum LLM fetch failed, using template:', e);
    }

    return this._templateFieldAnalysis(field);
  }

  static _templateFieldAnalysis(field) {
    const { name, paperCount, status, totalCitations, yearRange, papers } = field;
    const topPaper = papers[0];
    const lines = [];

    if (status === 'PEAKING') {
      lines.push(`${name} is the most active research direction in this lineage with ${paperCount} papers and ${totalCitations.toLocaleString()} total citations spanning ${yearRange}.`);
      lines.push(`The field has been accelerating, with the majority of papers published in recent years.`);
    } else if (status === 'DECLINING') {
      lines.push(`${name} was once a significant contributor to this lineage with ${paperCount} papers, but activity has been declining.`);
      lines.push(`Most papers were published earlier in the timeline, suggesting the field's methods have been superseded.`);
    } else {
      lines.push(`${name} maintains a steady presence in this lineage with ${paperCount} papers spanning ${yearRange}.`);
    }

    if (topPaper) {
      lines.push(`The most cited paper is "${topPaper.title}" (${topPaper.year}) with ${topPaper.citations?.toLocaleString()} citations.`);
    }

    let html = `<p>${lines.join(' ')}</p><ul class="mt-analysis-bullets">`;
    html += `<li>${paperCount} papers spanning ${yearRange}</li>`;
    html += `<li>${totalCitations.toLocaleString()} total citations across all papers</li>`;
    html += `<li>Status: ${status}</li>`;
    html += `</ul>`;
    return html;
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 4 — FULL ANALYSIS VIEW (Layer 3)
   ═══════════════════════════════════════════════════════════════════════════ */

class MomentumFullAnalysis {
  static show(body, result) {
    if (!result) {
      const graphData = window._graphLoader?._graphData;
      result = window._momentumResult || new MomentumAnalyzer(graphData).analyze();
    }

    body.innerHTML = `
      <div class="mt-full-analysis">
        <div class="mt-full-header">
          <button class="mt-back-btn">← Back</button>
          <h3>MOMENTUM TRACKER — FULL ANALYSIS</h3>
        </div>

        <div class="mt-full-section">
          <h4 class="mt-section-title">CITATION VELOCITY — TOP PAPERS</h4>
          <div class="mt-velocity-row">
            <div class="mt-velocity-chart" id="mt-velocity-chart"></div>
            <div class="mt-velocity-analysis" id="mt-velocity-analysis">
              <div class="mt-shimmer-block" style="height:14px;width:90%;margin-bottom:8px;"></div>
              <div class="mt-shimmer-block" style="height:14px;width:80%;margin-bottom:8px;"></div>
              <div class="mt-shimmer-block" style="height:14px;width:85%;margin-bottom:8px;"></div>
            </div>
          </div>
        </div>

        <div class="mt-full-section">
          <h4 class="mt-section-title">TEMPORAL CONVERGENCE</h4>
          <div class="mt-convergence-chart" id="mt-convergence-chart"></div>
          <div class="mt-convergence-analysis" id="mt-convergence-analysis">
            <div class="mt-shimmer-block" style="height:14px;width:90%;margin-bottom:8px;"></div>
            <div class="mt-shimmer-block" style="height:14px;width:75%;margin-bottom:8px;"></div>
          </div>
        </div>

        <div class="mt-full-section">
          <h4 class="mt-section-title">LIFECYCLE SUMMARY — ORBITAL SYSTEM</h4>
          <div class="mt-orbital-container" id="mt-orbital-chart"></div>
          <div class="mt-orbital-analysis" id="mt-orbital-analysis">
            <div class="mt-shimmer-block" style="height:14px;width:85%;margin-bottom:8px;"></div>
            <div class="mt-shimmer-block" style="height:14px;width:78%;margin-bottom:8px;"></div>
          </div>
        </div>

        <button class="mt-discuss-btn" id="mt-discuss-btn">Discuss with AI</button>
      </div>
    `;

    // Back button
    body.querySelector('.mt-back-btn')?.addEventListener('click', () => {
      MomentumWindow.populate(body);
    });

    // Render charts
    this._renderVelocityChart(body.querySelector('#mt-velocity-chart'), result);
    this._renderConvergenceChart(body.querySelector('#mt-convergence-chart'), result);
    this._renderOrbitalSystem(body.querySelector('#mt-orbital-chart'), result);

    // Fetch LLM analyses
    this._fetchFullAnalyses(result, body);

    // Discuss button
    body.querySelector('#mt-discuss-btn')?.addEventListener('click', () => {
      const chatPanel = document.querySelector('[data-panel="chat"]');
      if (chatPanel) chatPanel.click();
      setTimeout(() => {
        const chatInput = document.querySelector('#chat-input, .chat-input input, .chat-input textarea');
        if (chatInput) {
          chatInput.value = `Tell me about the momentum and field dynamics of this research lineage. Which fields are growing, which are declining, and what convergence events shaped the field?`;
          chatInput.focus();
        }
      }, 300);
    });
  }

  // ── Citation Velocity Line Chart ──────────────────────────────────────

  static _renderVelocityChart(container, result) {
    if (!container) return;
    const { velocity } = result;
    const { byYear, maxCitations } = velocity;
    if (!byYear?.length) { container.innerHTML = '<p style="color:#9CA3AF;text-align:center;">No citation data.</p>'; return; }

    const margin = { top: 20, right: 20, bottom: 60, left: 55 };
    const width = 380;
    const height = 240;
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    // Scale
    const xScale = (i) => margin.left + (i / Math.max(byYear.length - 1, 1)) * chartW;
    const yScale = (v) => margin.top + chartH - (v / maxCitations) * chartH;

    // Build SVG
    let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" style="display:block;">`;

    // Dashed reference lines (3 horizontal)
    for (let i = 1; i <= 3; i++) {
      const y = margin.top + (chartH / 4) * i;
      const val = Math.round(maxCitations * (1 - i / 4));
      svg += `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#E5E7EB" stroke-dasharray="4,4" />`;
      svg += `<text x="${margin.left - 8}" y="${y + 3}" text-anchor="end" font-size="8" fill="#9CA3AF" font-family="JetBrains Mono, monospace">${(val / 1000).toFixed(0)}k</text>`;
    }

    // Y-axis label
    svg += `<text x="${margin.left - 40}" y="${margin.top + chartH / 2}" text-anchor="middle" font-size="8" fill="#9CA3AF" font-family="JetBrains Mono, monospace" transform="rotate(-90, ${margin.left - 40}, ${margin.top + chartH / 2})">citations</text>`;

    // Data line
    let pathD = '';
    byYear.forEach((paper, i) => {
      const x = xScale(i);
      const y = yScale(paper.citations);
      pathD += (i === 0 ? 'M' : 'L') + `${x.toFixed(1)},${y.toFixed(1)} `;
    });
    svg += `<path d="${pathD}" fill="none" stroke="#374151" stroke-width="1.5" stroke-linejoin="round" />`;

    // Data dots (interactive)
    byYear.forEach((paper, i) => {
      const x = xScale(i);
      const y = yScale(paper.citations);
      const r = paper.isSeed ? 6 : (paper.isBottleneck ? 5 : 4);
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${paper.isSeed ? '#D4A843' : '#374151'}" stroke="white" stroke-width="1.5" class="mt-velocity-dot" data-paper-id="${paper.id}" data-title="${paper.title}" data-year="${paper.year}" data-citations="${paper.citations}" style="cursor:pointer;" />`;

      // X-axis label (paper name)
      const label = paper.shortTitle.length > 10 ? paper.shortTitle.substring(0, 10) + '..' : paper.shortTitle;
      svg += `<text x="${x.toFixed(1)}" y="${height - margin.bottom + 14}" text-anchor="middle" font-size="6.5" fill="#6B7280" font-family="Inter, sans-serif" transform="rotate(-30, ${x.toFixed(1)}, ${height - margin.bottom + 14})">${label}</text>`;
      svg += `<text x="${x.toFixed(1)}" y="${height - margin.bottom + 26}" text-anchor="middle" font-size="6" fill="#9CA3AF" font-family="JetBrains Mono, monospace">${paper.year}</text>`;
    });

    svg += '</svg>';
    container.innerHTML = svg;

    // Click handlers for dots
    container.querySelectorAll('.mt-velocity-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        const paperId = dot.dataset.paperId;
        if (paperId) {
          // _zoomToNode is defined in deep-intelligence.js at file scope
          // Both scripts share the global scope via <script> tags
          try { _zoomToNode(paperId); } catch(e) { console.warn('zoomToNode unavailable:', e); }
        }
      });

      // Tooltip on hover — cleanup on leave AND on window close
      dot.addEventListener('mouseenter', (e) => {
        // Remove any stale tooltips first
        document.querySelectorAll('.mt-chart-tooltip').forEach(t => t.remove());
        const safeTitle = (dot.dataset.title || '').replace(/</g, '&lt;');
        const year = dot.dataset.year || '';
        const citations = parseInt(dot.dataset.citations || '0').toLocaleString();
        const tooltip = document.createElement('div');
        tooltip.className = 'mt-chart-tooltip';
        tooltip.innerHTML = `<strong>${safeTitle}</strong><br>${year} · ${citations} citations`;
        tooltip.style.cssText = `position:fixed;left:${e.clientX + 12}px;top:${e.clientY - 30}px;z-index:100000;`;
        document.body.appendChild(tooltip);
        dot._tooltip = tooltip;
      });
      dot.addEventListener('mouseleave', () => {
        if (dot._tooltip) { dot._tooltip.remove(); dot._tooltip = null; }
      });
    });
  }

  // ── Temporal Convergence Dot Matrix Block Bars ──────────────────────────
  // Each bar is a BLOCK of dots (4-5 wide × N tall), matching the wireframe.
  // Papers = lighter filled dots (bottom), Edges = dark filled dots (top).
  // Proper Y-axis with arrow, X-axis with arrow, event markers on axis.

  static _renderConvergenceChart(container, result) {
    if (!container) return;
    const { convergence } = result;
    const { columns, events } = convergence;
    if (!columns?.length) { container.innerHTML = '<p style="color:#9CA3AF;text-align:center;">No temporal data.</p>'; return; }

    // Use all columns (every year bin has data)
    const numCols = columns.length;

    // Layout constants
    const barDotsWide = 4;
    const barMaxRows = 12;
    const dotR = 2;
    const dotGap = 5.5;
    const barGap = 6;
    const barW = barDotsWide * dotGap;
    const colStep = barW + barGap;
    const margin = { top: 6, bottom: 40, left: 8, right: 15 };

    const svgW = margin.left + numCols * colStep + margin.right;
    const chartH = barMaxRows * dotGap;
    const svgH = margin.top + chartH + margin.bottom;
    const axisY = margin.top + chartH;

    // Scale against combined max so tallest bar fills full height
    const maxCombined = Math.max(...columns.map(c => c.papers + c.edges), 1);

    let svg = `<svg viewBox="0 0 ${svgW} ${svgH}" width="100%" style="display:block;max-width:520px;margin:0 auto;">`;

    // ── Y-axis line with arrow ──
    const yAxisTop = axisY - barMaxRows * dotGap;
    const yAxisX = margin.left;
    svg += `<line x1="${yAxisX}" y1="${yAxisTop}" x2="${yAxisX}" y2="${axisY}" stroke="#9CA3AF" stroke-width="1" />`;
    svg += `<polygon points="${yAxisX - 3},${yAxisTop + 3} ${yAxisX + 3},${yAxisTop + 3} ${yAxisX},${yAxisTop - 4}" fill="#9CA3AF" />`;

    // ── X-axis line with arrow ──
    const xAxisEnd = margin.left + numCols * colStep + 5;
    svg += `<line x1="${yAxisX}" y1="${axisY}" x2="${xAxisEnd}" y2="${axisY}" stroke="#9CA3AF" stroke-width="1" />`;
    svg += `<polygon points="${xAxisEnd},${axisY - 3} ${xAxisEnd},${axisY + 3} ${xAxisEnd + 6},${axisY}" fill="#9CA3AF" />`;

    // ── Draw bars ──
    columns.forEach((col, colIdx) => {
      // Bar left edge starts right after the y-axis
      const barLeft = margin.left + 4 + colIdx * colStep;
      const barCenterX = barLeft + barW / 2;

      const combinedCount = col.papers + col.edges;
      const rawRows = Math.round((combinedCount / maxCombined) * barMaxRows);
      const totalRows = Math.min(barMaxRows, combinedCount > 0 ? Math.max(1, rawRows) : 0);
      const paperRows = combinedCount > 0 ? Math.max(col.papers > 0 ? 1 : 0, Math.round((col.papers / combinedCount) * totalRows)) : 0;

      // Draw the block of dots
      for (let row = 0; row < totalRows; row++) {
        const y = axisY - (row + 1) * dotGap + dotGap / 2;
        const isEdge = row >= paperRows;
        for (let dx = 0; dx < barDotsWide; dx++) {
          const x = barLeft + dx * dotGap + dotGap / 2;
          const fill = isEdge ? '#1F2937' : '#C4C9D2';
          const op = isEdge ? '0.9' : '0.8';
          svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" fill="${fill}" opacity="${op}" />`;
        }
      }

      // Invisible hover rect over the entire bar column for tooltip
      const isEvent = events.some(e => e.year === col.year);
      const barTop = totalRows > 0 ? axisY - totalRows * dotGap : axisY - dotGap;
      svg += `<rect x="${barLeft}" y="${barTop}" width="${barW}" height="${axisY - barTop}" fill="transparent" class="mt-conv-bar-hover" data-year="${col.year}" data-papers="${col.papers}" data-edges="${col.edges}" data-event="${isEvent}" style="cursor:pointer;" />`;

      // Year label centered under bar
      const showLabel = numCols <= 14 || colIdx % 2 === 0 || colIdx === numCols - 1;
      if (showLabel) {
        svg += `<text x="${barCenterX.toFixed(0)}" y="${axisY + 14}" text-anchor="middle" font-size="7" fill="#6B7280" font-family="JetBrains Mono, monospace">'${String(col.year).slice(-2)}</text>`;
      }

      // Convergence event marker
      if (isEvent) {
        svg += `<polygon points="${barCenterX - 4},${axisY + 24} ${barCenterX + 4},${axisY + 24} ${barCenterX},${axisY + 18}" fill="#F97316" />`;
      }
    });

    // ── Legend ──
    const legY = svgH - 6;
    const legX = margin.left + 10;
    svg += `<circle cx="${legX}" cy="${legY}" r="${dotR}" fill="#C4C9D2" />`;
    svg += `<text x="${legX + 8}" y="${legY + 3}" font-size="6.5" fill="#6B7280" font-family="Inter, sans-serif">Papers</text>`;
    svg += `<circle cx="${legX + 55}" cy="${legY}" r="${dotR}" fill="#1F2937" />`;
    svg += `<text x="${legX + 63}" y="${legY + 3}" font-size="6.5" fill="#6B7280" font-family="Inter, sans-serif">Meaningful edges</text>`;
    svg += `<polygon points="${legX + 145},${legY} ${legX + 153},${legY} ${legX + 149},${legY - 5}" fill="#F97316" />`;
    svg += `<text x="${legX + 158}" y="${legY + 3}" font-size="6.5" fill="#6B7280" font-family="Inter, sans-serif">Convergence event</text>`;

    svg += '</svg>';
    container.innerHTML = svg;

    // Hover tooltips on bars
    container.querySelectorAll('.mt-conv-bar-hover').forEach(rect => {
      rect.addEventListener('mouseenter', (e) => {
        document.querySelectorAll('.mt-chart-tooltip').forEach(t => t.remove());
        const year = rect.dataset.year;
        const papers = rect.dataset.papers;
        const edges = rect.dataset.edges;
        const isEvt = rect.dataset.event === 'true';
        let html = `<strong>${year}s</strong><br>${papers} papers · ${edges} meaningful edges`;
        if (isEvt) html += `<br><span style="color:#F97316;">Convergence event</span>`;
        const tooltip = document.createElement('div');
        tooltip.className = 'mt-chart-tooltip';
        tooltip.innerHTML = html;
        tooltip.style.cssText = `position:fixed;left:${e.clientX + 12}px;top:${e.clientY - 40}px;z-index:100000;`;
        document.body.appendChild(tooltip);
        rect._tooltip = tooltip;
      });
      rect.addEventListener('mousemove', (e) => {
        if (rect._tooltip) {
          rect._tooltip.style.left = (e.clientX + 12) + 'px';
          rect._tooltip.style.top = (e.clientY - 40) + 'px';
        }
      });
      rect.addEventListener('mouseleave', () => {
        if (rect._tooltip) { rect._tooltip.remove(); rect._tooltip = null; }
      });
    });
  }

  // ── Orbital System ────────────────────────────────────────────────────

  static _renderOrbitalSystem(container, result) {
    if (!container) return;
    const { orbital } = result;
    if (!orbital?.planets?.length) { container.innerHTML = '<p style="color:#9CA3AF;text-align:center;">No orbital data.</p>'; return; }

    const size = 400;
    const cx = size / 2, cy = size / 2;
    const maxPapers = Math.max(...orbital.planets.map(p => p.paperCount), 1);

    // Create container with recenter button
    container.innerHTML = `
      <div style="position:relative;">
        <div id="mt-orbital-svg-wrap" style="overflow:hidden;border-radius:8px;border:1px solid #E5E7EB;"></div>
        <button id="mt-orbital-recenter" style="position:absolute;top:8px;right:8px;background:#fff;border:1px solid #D1D5DB;border-radius:6px;padding:4px 10px;font-size:0.7rem;cursor:pointer;color:#374151;font-family:'JetBrains Mono',monospace;z-index:5;" title="Recenter">⊕ Recenter</button>
      </div>
      <div style="display:flex;gap:16px;justify-content:center;margin-top:8px;flex-wrap:wrap;">
        <span style="font-size:0.7rem;color:#9CA3AF;">● Core (inner)</span>
        <span style="font-size:0.7rem;color:#9CA3AF;">○ Related (middle)</span>
        <span style="font-size:0.7rem;color:#9CA3AF;">◎ Tangential (outer)</span>
        <span style="font-size:0.7rem;color:#9CA3AF;">Size = paper count · Click to highlight</span>
      </div>
    `;

    const wrap = container.querySelector('#mt-orbital-svg-wrap');
    const svg = d3.select(wrap).append('svg')
      .attr('viewBox', `0 0 ${size} ${size}`)
      .attr('width', '100%')
      .style('display', 'block')
      .style('max-width', `${size}px`)
      .style('margin', '0 auto')
      .style('cursor', 'grab');

    // Zoom group
    const g = svg.append('g').attr('class', 'orbital-zoom-group');

    // D3 zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.5, 4])
      .on('zoom', (event) => { g.attr('transform', event.transform); });
    svg.call(zoom);

    // Recenter button
    container.querySelector('#mt-orbital-recenter')?.addEventListener('click', () => {
      svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
    });

    // Draw orbit rings (dotted circles)
    orbital.orbits.forEach(orbit => {
      const r = orbit.radius * (size / 2 - 30);
      const numDots = Math.round(r * 2 * Math.PI / 8);
      for (let i = 0; i < numDots; i++) {
        const angle = (i / numDots) * Math.PI * 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        g.append('circle').attr('cx', x).attr('cy', y).attr('r', 1).attr('fill', '#D1D5DB').attr('opacity', 0.5);
      }
      // Orbit label
      g.append('text').attr('x', cx + r + 5).attr('y', cy - r - 3)
        .attr('font-size', '5.5px').attr('fill', '#9CA3AF')
        .attr('font-family', 'JetBrains Mono, monospace').attr('opacity', 0.7)
        .text(orbit.label);
    });

    // Draw seed "sun" at center
    const sunR = 12;
    for (let dx = -sunR; dx <= sunR; dx += 4) {
      for (let dy = -sunR; dy <= sunR; dy += 4) {
        if (dx * dx + dy * dy <= sunR * sunR) {
          g.append('circle').attr('cx', cx + dx).attr('cy', cy + dy).attr('r', 1.8).attr('fill', '#374151');
        }
      }
    }
    g.append('text').attr('x', cx).attr('y', cy + sunR + 12)
      .attr('text-anchor', 'middle').attr('font-size', '7px').attr('fill', '#374151')
      .attr('font-family', 'JetBrains Mono, monospace').attr('font-weight', 600)
      .text('★ SEED');

    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'mt-orbital-tooltip';
    tooltip.style.cssText = 'position:fixed;display:none;background:#fff;border:1px solid #D1D5DB;border-radius:8px;padding:10px 14px;font-size:0.75rem;box-shadow:0 4px 12px rgba(0,0,0,0.1);z-index:9999;max-width:240px;pointer-events:none;';
    document.body.appendChild(tooltip);

    // Place planets on orbits
    const orbitGroups = { 1: [], 2: [], 3: [] };
    orbital.planets.forEach(p => { (orbitGroups[p.orbit] || orbitGroups[3]).push(p); });

    const allPlanetGroups = [];

    Object.entries(orbitGroups).forEach(([orbitLevel, planets]) => {
      const orbitInfo = orbital.orbits.find(o => o.level === parseInt(orbitLevel));
      if (!orbitInfo || !planets.length) return;
      const orbitR = orbitInfo.radius * (size / 2 - 30);

      planets.forEach((planet, i) => {
        const angle = (i / planets.length) * Math.PI * 2 - Math.PI / 2;
        const px = cx + orbitR * Math.cos(angle);
        const py = cy + orbitR * Math.sin(angle);
        const planetR = Math.max(6, Math.min(22, 6 + (planet.paperCount / maxPapers) * 16));

        // Planet group (for hover/click)
        const pg = g.append('g')
          .attr('class', 'orbital-planet')
          .attr('data-field', planet.name)
          .style('cursor', 'pointer');

        // Invisible hit area for easier clicking
        pg.append('circle').attr('cx', px).attr('cy', py).attr('r', planetR + 4)
          .attr('fill', 'transparent').attr('stroke', 'none');

        // Dot matrix planet
        const dotStep = planetR > 12 ? 4 : 3;
        for (let dx = -planetR; dx <= planetR; dx += dotStep) {
          for (let dy = -planetR; dy <= planetR; dy += dotStep) {
            if (dx * dx + dy * dy <= planetR * planetR) {
              const opacity = planet.status === 'PEAKING' ? 0.8 : (planet.status === 'DECLINING' ? 0.3 : 0.55);
              pg.append('circle').attr('cx', px + dx).attr('cy', py + dy).attr('r', 1.5)
                .attr('fill', planet.color).attr('opacity', opacity).attr('class', 'planet-dot');
            }
          }
        }

        // Label
        const shortName = planet.name.length > 12 ? planet.name.substring(0, 11) + '.' : planet.name;
        pg.append('text').attr('x', px).attr('y', py + planetR + 10)
          .attr('text-anchor', 'middle').attr('font-size', '6.5px').attr('fill', '#374151')
          .attr('font-family', 'Inter, sans-serif').attr('font-weight', 500).text(shortName);
        pg.append('text').attr('x', px).attr('y', py + planetR + 19)
          .attr('text-anchor', 'middle').attr('font-size', '5.5px').attr('fill', '#9CA3AF')
          .attr('font-family', 'JetBrains Mono, monospace').text(`${planet.paperCount}p`);

        // Hover tooltip
        pg.on('mouseenter', (event) => {
          tooltip.style.display = 'block';
          tooltip.innerHTML = `
            <div style="font-weight:600;color:#111;margin-bottom:4px;">${planet.name}</div>
            <div style="color:#6B7280;margin-bottom:6px;">${planet.paperCount} papers · ${planet.status}</div>
            <div style="font-size:0.7rem;color:#9CA3AF;">Orbit: ${planet.orbit === 1 ? 'Core' : planet.orbit === 2 ? 'Related' : 'Tangential'}</div>
            <div style="font-size:0.7rem;color:#9CA3AF;">Year range: ${planet.yearRange || 'N/A'}</div>
            <div style="font-size:0.7rem;color:#9CA3AF;">Top citation: ${(planet.maxCitations || 0).toLocaleString()}</div>
            <div style="font-size:0.65rem;color:#3B82F6;margin-top:6px;">Click to highlight papers in graph</div>
          `;
          tooltip.style.left = (event.clientX + 12) + 'px';
          tooltip.style.top = (event.clientY - 10) + 'px';

          // Dim other planets
          g.selectAll('.orbital-planet').style('opacity', 0.2);
          pg.style('opacity', 1);
        });

        pg.on('mousemove', (event) => {
          tooltip.style.left = (event.clientX + 12) + 'px';
          tooltip.style.top = (event.clientY - 10) + 'px';
        });

        pg.on('mouseleave', () => {
          tooltip.style.display = 'none';
          g.selectAll('.orbital-planet').style('opacity', 1);
        });

        // Click to highlight papers from this field in the main graph
        pg.on('click', () => {
          MomentumWindow._highlightFieldInGraph(planet.name);
        });

        allPlanetGroups.push({ planet, group: pg });
      });
    });

    // Cleanup tooltip on container removal
    const observer = new MutationObserver(() => {
      if (!document.body.contains(wrap)) {
        tooltip.remove();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Highlight papers from a field in the main graph ────────────────────

  static _highlightFieldInGraph(fieldName) {
    const graphData = window._graphLoader?._graphData;
    if (!graphData) return;

    // Find all paper IDs that belong to this field
    const fieldPaperIds = new Set();
    graphData.nodes.forEach(n => {
      if (n.fields_of_study?.some(f => f.toLowerCase() === fieldName.toLowerCase())) {
        fieldPaperIds.add(n.id);
      }
    });

    if (fieldPaperIds.size === 0) return;

    // Detect mode
    const modeLabel = document.getElementById('mode-label');
    const isTreeMode = modeLabel?.textContent?.toLowerCase()?.includes('tree');

    if (isTreeMode && window._treeLayout?.svg) {
      const tree = window._treeLayout;
      // Dim everything
      tree.svg.selectAll('.tree-node').style('opacity', 0.08);
      tree.svg.selectAll('path.tree-link, line.cross-edge').style('opacity', 0.02);
      // Highlight matching nodes
      tree.svg.selectAll('.tree-node').each(function() {
        const el = d3.select(this);
        const nodeId = el.attr('data-id');
        if (fieldPaperIds.has(nodeId)) {
          el.style('opacity', 1);
          el.select('rect').transition().duration(300).attr('stroke', '#D4A843').attr('stroke-width', 2.5);
        }
      });
      // Restore after 4 seconds
      setTimeout(() => {
        tree.svg.selectAll('.tree-node').style('opacity', null);
        tree.svg.selectAll('path.tree-link, line.cross-edge').style('opacity', null);
        tree.svg.selectAll('.tree-node rect').attr('stroke', '#666').attr('stroke-width', 0.5);
      }, 4000);
    } else if (window._arivuGraph) {
      const graph = window._arivuGraph;
      if (!graph.svg) return;
      // Dim everything
      graph.svg.selectAll('.node-group').style('opacity', 0.08);
      graph.svg.selectAll('line, .edge-line, .edge-path').style('opacity', 0.02);
      // Highlight matching nodes
      graph.svg.selectAll('.node-group').each(function() {
        const el = d3.select(this);
        const nodeId = el.attr('data-id');
        if (fieldPaperIds.has(nodeId)) {
          el.style('opacity', 1);
          el.select('circle, use').transition().duration(300).attr('stroke', '#D4A843').attr('stroke-width', 3);
        }
      });
      // Restore after 4 seconds
      setTimeout(() => {
        graph.svg.selectAll('.node-group').style('opacity', null);
        graph.svg.selectAll('line, .edge-line, .edge-path').style('opacity', null);
        graph.svg.selectAll('.node-group circle, .node-group use').attr('stroke', null).attr('stroke-width', null);
      }, 4000);
    }
  }

  // ── LLM Analyses for all sections ─────────────────────────────────────

  static async _fetchFullAnalyses(result, body) {
    const seedPaperId = window._graphLoader?._graphData?.metadata?.seed_paper_id;
    if (!seedPaperId) { this._applyAnalyses(body, this._templateAnalyses(result)); return; }
    const seedTitle = window._graphLoader?._graphData?.metadata?.seed_paper_title || 'the seed paper';

    const topPapersStr = (result.velocity?.byYear || []).map(p => `${p.title} (${p.year}, ${(p.citations || 0).toLocaleString()} citations)`).join('; ');
    const convergenceStr = result.convergence.columns.map(c => `${c.year}: ${c.papers}p/${c.edges}e`).join(', ');
    const eventsStr = result.convergence.events.map(e => `${e.year}: ${e.edges} edges, ${e.papers} papers`).join('; ');
    const fieldsStr = result.fields.slice(0, 8).map(f => `${f.name} (${f.paperCount}p, ${f.status})`).join('; ');

    try {
      const res = await fetch(`/api/graph/${encodeURIComponent(seedPaperId)}/momentum-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed_paper_id: seedPaperId,
          seed_paper_title: seedTitle,
          analysis_type: 'full',
          top_papers: topPapersStr,
          convergence_data: convergenceStr,
          convergence_events: eventsStr,
          fields_summary: fieldsStr,
          total_nodes: window._graphLoader?._graphData?.nodes?.length || 0,
          total_edges: window._graphLoader?._graphData?.edges?.length || 0,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        this._applyAnalyses(body, data);
        return;
      }
    } catch (e) {
      console.warn('Momentum full analysis fetch failed:', e);
    }

    // Template fallback
    this._applyAnalyses(body, this._templateAnalyses(result));
  }

  static _applyAnalyses(body, data) {
    const velEl = body.querySelector('#mt-velocity-analysis');
    if (velEl && data.velocity_analysis) {
      velEl.innerHTML = `<div class="mt-llm-text"><h5>WHY THESE PAPERS LEAD</h5>${data.velocity_analysis}</div>`;
    }
    const convEl = body.querySelector('#mt-convergence-analysis');
    if (convEl && data.convergence_analysis) {
      convEl.innerHTML = `<div class="mt-llm-text"><h5>WHY THIS CONVERGENCE MATTERS</h5>${data.convergence_analysis}</div>`;
    }
    const orbEl = body.querySelector('#mt-orbital-analysis');
    if (orbEl && data.orbital_analysis) {
      orbEl.innerHTML = `<div class="mt-llm-text"><h5>FIELD RELATIONSHIPS</h5>${data.orbital_analysis}</div>`;
    }
  }

  static _templateAnalyses(result) {
    const topPaper = result.velocity.byYear[result.velocity.byYear.length - 1];
    const events = result.convergence.events;
    const fields = result.fields;

    return {
      velocity_analysis: `<p>The citation velocity chart shows ${result.velocity.byYear.length} papers ranked by citation count. ${topPaper ? `${topPaper.title} (${topPaper.year}) leads with ${topPaper.citations.toLocaleString()} citations.` : ''} The distribution reveals which papers became reference points for the entire lineage.</p>`,
      convergence_analysis: `<p>${events.length > 0 ? `${events.length} convergence event${events.length > 1 ? 's' : ''} detected. The most significant occurred around ${events[events.length - 1].year} with ${events[events.length - 1].edges} meaningful connections forming in a 5-year window.` : 'No major convergence events detected. The field has grown steadily without dramatic acceleration.'} The ratio of meaningful edges to papers indicates how densely interconnected each era's research was.</p>`,
      orbital_analysis: `<p>The orbital system shows ${fields.length} research fields arranged by their proximity to the seed paper. ${(result.orbital?.planets || []).filter(f => f.orbit === 1).map(f => f.name).join(' and ') || 'Core fields'} form the inner orbit, directly related to the seed paper's research direction. ${(result.orbital?.planets || []).filter(f => f.orbit === 3).map(f => f.name).slice(0, 3).join(', ') || 'Peripheral fields'} orbit at the edge, contributing occasional cross-disciplinary insights.</p>`,
    };
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 5 — REGISTRATION & EXPORTS
   ═══════════════════════════════════════════════════════════════════════════ */

window.MomentumAnalyzer = MomentumAnalyzer;
window.MomentumPanel = MomentumPanel;
window.MomentumWindow = MomentumWindow;
window.MomentumFullAnalysis = MomentumFullAnalysis;
