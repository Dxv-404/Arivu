/**
 * static/js/trust-evidence.js
 * Trust & Evidence — dot 3 in Intellectual Diversity container
 *
 * Compact view: Trust Lock (SVG padlock open/half/closed)
 * Initial detail (window): Trust Overview + Evidence Cascade + Fragility Network + Risk Cards
 * Full detail (read more): Evidence Cross-Tab + Sentence Gallery + Expanded Fragility + Assessment
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1 — DATA COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════

const TrustComputer = {
  compute(graphData) {
    const nodes = graphData?.nodes || [];
    const edges = graphData?.edges || [];

    // Confidence tier counts
    const tiers = { HIGH: 0, MEDIUM: 0, LOW: 0, SPECULATIVE: 0 };
    edges.forEach(e => {
      const tier = (e.confidence_tier || 'SPECULATIVE').toUpperCase();
      if (tiers.hasOwnProperty(tier)) tiers[tier]++;
      else tiers.SPECULATIVE++;
    });

    const totalEdges = edges.length || 1;
    const trustedCount = tiers.HIGH + tiers.MEDIUM;
    const trustPct = Math.round((trustedCount / totalEdges) * 100);

    // Comparable percentage
    const comparableCount = edges.filter(e => e.comparable).length;
    const comparablePct = Math.round((comparableCount / totalEdges) * 100);

    // Text depth distribution
    const textTiers = { fullText: 0, intro: 0, abstract: 0, titleOnly: 0 };
    nodes.forEach(n => {
      const tt = n.text_tier || 4;
      if (tt === 1) textTiers.fullText++;
      else if (tt === 2) textTiers.intro++;
      else if (tt === 3) textTiers.abstract++;
      else textTiers.titleOnly++;
    });

    // Depth distribution with text quality
    const depthData = {};
    nodes.forEach(n => {
      const d = n.depth ?? -1;
      if (d < 0) return;
      if (!depthData[d]) depthData[d] = { total: 0, fullText: 0, abstract: 0, titleOnly: 0 };
      depthData[d].total++;
      const tt = n.text_tier || 4;
      if (tt <= 1) depthData[d].fullText++;
      else if (tt <= 3) depthData[d].abstract++;
      else depthData[d].titleOnly++;
    });

    // Fragility risks
    const bottlenecks = nodes.filter(n => n.is_bottleneck && (n.pruning_impact || 0) > 25);
    const risks = [];

    // Single-thread dependencies: bottleneck papers with high impact
    bottlenecks.sort((a, b) => (b.pruning_impact || 0) - (a.pruning_impact || 0));
    bottlenecks.forEach(bn => {
      // Count papers that depend on this bottleneck
      const dependentCount = Math.round((bn.pruning_impact || 0) / 100 * nodes.length);
      risks.push({
        type: 'SINGLE-THREAD DEPENDENCY',
        paper: bn,
        impact: bn.pruning_impact || 0,
        dependentCount,
        description: `${dependentCount} papers depend on this with no alternative path. If flawed, ${Math.round(bn.pruning_impact || 0)}% of this lineage loses its foundation.`,
      });
    });

    // Low-confidence foundations: edges connecting to bottlenecks that are LOW/SPECULATIVE
    const bottleneckIds = new Set(bottlenecks.map(b => b.id));
    const weakBottleneckEdges = edges.filter(e => {
      const src = typeof e.source === 'object' ? e.source.id : e.source;
      const tgt = typeof e.target === 'object' ? e.target.id : e.target;
      const touchesBottleneck = bottleneckIds.has(src) || bottleneckIds.has(tgt);
      const isWeak = ['LOW', 'SPECULATIVE'].includes((e.confidence_tier || '').toUpperCase());
      return touchesBottleneck && isWeak;
    });

    if (weakBottleneckEdges.length > 0) {
      risks.push({
        type: 'LOW-CONFIDENCE FOUNDATIONS',
        paper: null,
        impact: 0,
        dependentCount: weakBottleneckEdges.length,
        description: `${weakBottleneckEdges.length} edges connecting to bottleneck papers are LOW or SPECULATIVE confidence. The structural load-bearing connections have the weakest evidence.`,
        weakEdges: weakBottleneckEdges,
      });
    }

    // Evidence pairs for gallery
    const evidencePairs = [];
    const mutationCounts = {};
    edges.forEach(e => {
      const mt = e.mutation_type || 'unknown';
      mutationCounts[mt] = (mutationCounts[mt] || 0) + 1;
      if (e.citing_sentence && e.cited_sentence) {
        const srcId = typeof e.source === 'object' ? e.source.id : e.source;
        const tgtId = typeof e.target === 'object' ? e.target.id : e.target;
        const srcNode = nodes.find(n => n.id === srcId);
        const tgtNode = nodes.find(n => n.id === tgtId);
        evidencePairs.push({
          citingPaper: srcNode?.title || 'Unknown',
          citingId: srcId,
          citedPaper: tgtNode?.title || 'Unknown',
          citedId: tgtId,
          citingSentence: e.citing_sentence,
          citedSentence: e.cited_sentence,
          confidenceTier: e.confidence_tier || 'SPECULATIVE',
          similarity: e.similarity_score || 0,
          comparable: e.comparable || false,
          citingTextSource: e.citing_text_source || 'none',
          citedTextSource: e.cited_text_source || 'none',
          mutationType: mt,
        });
      }
    });

    // Cross-reference stats
    const highMedEdges = edges.filter(e => ['HIGH', 'MEDIUM'].includes((e.confidence_tier || '').toUpperCase()));
    const lowSpecEdges = edges.filter(e => ['LOW', 'SPECULATIVE'].includes((e.confidence_tier || '').toUpperCase()));
    const highMedWithText = highMedEdges.filter(e => e.citing_sentence || e.cited_sentence).length;
    const lowSpecTitleOnly = lowSpecEdges.filter(e => !e.citing_sentence && !e.cited_sentence).length;
    const incomparable = edges.filter(e => !e.comparable).length;

    return {
      trustPct,
      comparablePct,
      totalEdges: edges.length,
      totalNodes: nodes.length,
      tiers,
      textTiers,
      depthData,
      risks,
      evidencePairs,
      mutationCounts,
      weakBottleneckEdges,
      crossRef: {
        highMedWithTextPct: highMedEdges.length ? Math.round((highMedWithText / highMedEdges.length) * 100) : 0,
        lowSpecTitleOnlyPct: lowSpecEdges.length ? Math.round((lowSpecTitleOnly / lowSpecEdges.length) * 100) : 0,
        incomparable,
      },
    };
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2 — TRUST LOCK SVG (Compact View)
// ═══════════════════════════════════════════════════════════════════════════

function renderTrustLock(container, trustPct, riskCount) {
  const W = 140, H = 200;
  const dotR = 2.8, dotGap = 7;
  const bodyX = 30, bodyY = 80, bodyW = 80, bodyH = 90;
  const bodyRows = Math.floor(bodyH / dotGap);
  const bodyCols = Math.floor(bodyW / dotGap);
  const filledRows = Math.max(0, Math.round((trustPct / 100) * bodyRows));

  // Determine lock state
  let shackleState = 'open'; // 0-30%
  if (trustPct > 60) shackleState = 'closed';
  else if (trustPct > 30) shackleState = 'half';

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="120" style="display:block;margin:0 auto;">`;

  // Shackle (arc of dots)
  const shackleW = 40, shackleH = 35;
  const shackleCx = bodyX + bodyW / 2;
  const shackleCy = bodyY - 5;

  if (shackleState === 'closed') {
    // Full arc
    for (let a = Math.PI; a <= 2 * Math.PI; a += 0.25) {
      const x = shackleCx + Math.cos(a) * shackleW / 2;
      const y = shackleCy + Math.sin(a) * shackleH / 1.5;
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" fill="#374151"/>`;
    }
    // Vertical sides
    for (let y = shackleCy - shackleH / 1.5; y <= shackleCy; y += dotGap) {
      svg += `<circle cx="${shackleCx - shackleW/2}" cy="${y.toFixed(1)}" r="${dotR}" fill="#374151"/>`;
      svg += `<circle cx="${shackleCx + shackleW/2}" cy="${y.toFixed(1)}" r="${dotR}" fill="#374151"/>`;
    }
  } else if (shackleState === 'half') {
    // Left side connected, right side at 45 degrees
    for (let a = Math.PI; a <= 1.75 * Math.PI; a += 0.25) {
      const x = shackleCx + Math.cos(a) * shackleW / 2;
      const y = shackleCy + Math.sin(a) * shackleH / 1.5;
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" fill="#374151"/>`;
    }
    for (let y = shackleCy - shackleH / 1.5; y <= shackleCy; y += dotGap) {
      svg += `<circle cx="${shackleCx - shackleW/2}" cy="${y.toFixed(1)}" r="${dotR}" fill="#374151"/>`;
    }
    // Right side raised
    const rightBaseX = shackleCx + shackleW / 2;
    for (let i = 0; i < 4; i++) {
      svg += `<circle cx="${(rightBaseX + i * 3).toFixed(1)}" cy="${(shackleCy - 10 - i * 6).toFixed(1)}" r="${dotR}" fill="#374151"/>`;
    }
  } else {
    // Open: left side connected, right side fully raised
    for (let a = Math.PI; a <= 1.5 * Math.PI; a += 0.25) {
      const x = shackleCx + Math.cos(a) * shackleW / 2;
      const y = shackleCy + Math.sin(a) * shackleH / 1.5;
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" fill="#374151"/>`;
    }
    for (let y = shackleCy - shackleH / 1.5; y <= shackleCy; y += dotGap) {
      svg += `<circle cx="${shackleCx - shackleW/2}" cy="${y.toFixed(1)}" r="${dotR}" fill="#374151"/>`;
    }
    // Right side fully up
    const rightBaseX = shackleCx + shackleW / 2;
    for (let i = 0; i < 6; i++) {
      svg += `<circle cx="${rightBaseX.toFixed(1)}" cy="${(shackleCy - 5 - i * dotGap).toFixed(1)}" r="${dotR}" fill="#374151"/>`;
    }
  }

  // Lock body (rectangular grid of dots)
  for (let row = 0; row < bodyRows; row++) {
    for (let col = 0; col < bodyCols; col++) {
      const x = bodyX + col * dotGap + dotGap / 2;
      const y = bodyY + row * dotGap + dotGap / 2;

      // Keyhole: empty dots in center
      const isKeyhole = (row >= Math.floor(bodyRows * 0.35) && row <= Math.floor(bodyRows * 0.55)) &&
                        (col >= Math.floor(bodyCols * 0.35) && col <= Math.floor(bodyCols * 0.65));

      // Border dots (always filled dark)
      const isBorder = row === 0 || row === bodyRows - 1 || col === 0 || col === bodyCols - 1;

      // Fill level (bottom-up)
      const rowFromBottom = bodyRows - 1 - row;
      const isFilled = rowFromBottom < filledRows;

      let fill, opacity;
      if (isKeyhole) {
        fill = '#E5E7EB';
        opacity = 0.4;
      } else if (isBorder) {
        fill = '#374151';
        opacity = 0.8;
      } else if (isFilled) {
        fill = '#374151';
        opacity = 0.9;
      } else {
        fill = '#E5E7EB';
        opacity = 0.3;
      }

      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" fill="${fill}" opacity="${opacity}"/>`;
    }
  }

  svg += '</svg>';

  container.innerHTML = `
    <div style="text-align:center;padding:8px 0;">
      <div class="trust-lock-container" title="Trust: ${trustPct}% verified. Hover for details." style="cursor:default;position:relative;">
        ${svg}
      </div>
      <p style="font:700 16px 'JetBrains Mono',monospace;color:#374151;margin:8px 0 2px;">${trustPct}% VERIFIED</p>
      <p style="font:11px 'JetBrains Mono',monospace;color:#9CA3AF;margin:0;">${riskCount} fragility risk${riskCount !== 1 ? 's' : ''} detected</p>
    </div>
  `;
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3 — COMPACT VIEW PANEL
// ═══════════════════════════════════════════════════════════════════════════

const TrustEvidencePanel = {
  render(container) {
    if (container.querySelector('.trust-panel-wrap')) return;

    const gd = window._graphLoader?._graphData;
    if (!gd) {
      container.innerHTML = '<p style="color:#9CA3AF;font-size:0.8rem;text-align:center;padding:40px">Loading trust data...</p>';
      return;
    }

    const data = TrustComputer.compute(gd);
    const wrap = document.createElement('div');
    wrap.className = 'trust-panel-wrap';
    renderTrustLock(wrap, data.trustPct, data.risks.length);
    container.appendChild(wrap);
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4 — WINDOW (Initial Detail View)
// ═══════════════════════════════════════════════════════════════════════════

const TrustEvidenceWindow = {
  populate(body) {
    const gd = window._graphLoader?._graphData;
    if (!gd) {
      body.innerHTML = '<p style="padding:40px;color:#9CA3AF;">No graph data available.</p>';
      return;
    }

    const data = TrustComputer.compute(gd);
    let html = '<div style="padding:16px;">';

    // Header
    html += '<p style="font:600 11px \'JetBrains Mono\',monospace;letter-spacing:0.1em;color:#6B7280;margin:0 0 4px;">HOW RELIABLE IS THIS ANALYSIS?</p>';
    html += `<p style="font:12px 'Inter',sans-serif;color:#9CA3AF;margin:0 0 16px;">${data.totalEdges} edges across ${data.totalNodes} papers analyzed</p>`;

    // ── Trust Overview Split View ──
    html += '<div style="font:600 10px \'JetBrains Mono\',monospace;letter-spacing:0.1em;color:#374151;margin:0 0 8px;border-bottom:1px solid #E5E7EB;padding-bottom:4px;">TRUST OVERVIEW</div>';
    html += '<div style="display:flex;gap:16px;margin-bottom:16px;">';

    // Left: fill grid
    html += '<div style="flex:0 0 140px;text-align:center;">';
    html += '<p style="font:600 10px \'JetBrains Mono\',monospace;color:#6B7280;margin:0 0 6px;">TRUST LEVEL</p>';
    html += _renderFillGrid(data.trustPct, 8, 10);
    html += `<p style="font:700 14px 'JetBrains Mono',monospace;color:#374151;margin:6px 0 2px;">${data.trustPct}% TRUSTED</p>`;
    html += '<p style="font:10px \'JetBrains Mono\',monospace;color:#6B7280;margin:0;">Comparable:</p>';
    html += _renderDotBar(data.comparablePct, 10, '#374151') + ` <span style="font:10px 'JetBrains Mono',monospace;color:#374151;">${data.comparablePct}%</span>`;
    html += '</div>';

    // Right: confidence breakdown
    html += '<div style="flex:1;">';
    html += '<p style="font:600 10px \'JetBrains Mono\',monospace;color:#6B7280;margin:0 0 8px;">CONFIDENCE BREAKDOWN</p>';

    const tierInfo = [
      { name: 'HIGH', count: data.tiers.HIGH, color: '#22C55E', desc: 'Full text + structural validation. Gold standard.' },
      { name: 'MEDIUM', count: data.tiers.MEDIUM, color: '#3B82F6', desc: 'Abstract matching with LLM classification confirmed.' },
      { name: 'LOW', count: data.tiers.LOW, color: '#F59E0B', desc: 'Some text overlap but weak confidence score.' },
      { name: 'SPECULATIVE', count: data.tiers.SPECULATIVE, color: '#9333EA', desc: 'Title-only matching. Lowest reliability.' },
    ];

    tierInfo.forEach(t => {
      const pct = Math.round((t.count / data.totalEdges) * 100);
      html += `<div class="trust-tier-row" data-tier="${t.name}" style="margin-bottom:10px;cursor:pointer;padding:4px;border-radius:4px;" title="Click to highlight ${t.name} edges in graph">`;
      html += `<span style="font:600 10px 'JetBrains Mono',monospace;color:${t.color};">${t.name}</span>`;
      html += `<div style="display:flex;align-items:center;gap:6px;">`;
      html += _renderDotBar(pct, 10, t.count > 0 ? '#374151' : '#E5E7EB');
      html += `<span style="font:11px 'JetBrains Mono',monospace;color:#374151;">${t.count}</span>`;
      html += '</div>';
      html += `<p style="font:11px 'Inter',sans-serif;color:#9CA3AF;margin:2px 0 0;">${t.desc}</p>`;
      html += '</div>';
    });

    html += '</div></div>';

    // AI Analysis for trust overview (async from Groq)
    html += _renderAsyncAIAnalysis('trust-ai-crosstab', 'cross-tab');

    // ── Evidence Depth Cascade ──
    html += '<div style="font:600 10px \'JetBrains Mono\',monospace;letter-spacing:0.1em;color:#374151;margin:20px 0 8px;border-bottom:1px solid #E5E7EB;padding-bottom:4px;">EVIDENCE DEPTH CASCADE</div>';

    html += '<div style="padding:12px;border:1px solid #E5E7EB;border-radius:8px;margin-bottom:8px;">';
    html += '<p style="font:11px \'Inter\',sans-serif;color:#6B7280;margin:0 0 10px;">How evidence thins with depth:</p>';

    const depths = Object.keys(data.depthData).map(Number).sort();
    const maxPapersAtDepth = Math.max(...depths.map(d => data.depthData[d].total), 1);

    depths.forEach((d, i) => {
      const dd = data.depthData[d];
      const barWidth = Math.round((dd.total / maxPapersAtDepth) * 30); // max 30 dots
      const indent = i * 2; // cascade indent

      html += `<div class="trust-cascade-row" data-depth="${d}" style="margin:6px 0;padding-left:${indent * 8}px;cursor:pointer;" title="Click to highlight depth ${d} papers">`;
      html += `<span style="font:600 10px 'JetBrains Mono',monospace;color:#6B7280;margin-right:8px;">D${d}</span>`;

      // Dot bar with color coding
      for (let dot = 0; dot < barWidth; dot++) {
        const ratio = dot / barWidth;
        let fill;
        if (ratio < dd.fullText / dd.total) fill = '#1F2937'; // full text (darkest)
        else if (ratio < (dd.fullText + dd.abstract) / dd.total) fill = '#374151'; // abstract
        else fill = '#D1D5DB'; // title only
        html += `<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${fill};margin:0 1px;"></span>`;
      }
      // Second row
      html += '<br>';
      html += `<span style="display:inline-block;width:${10 * 2 + 8}px;"></span>`; // indent for D label
      for (let dot = 0; dot < barWidth; dot++) {
        const ratio = dot / barWidth;
        let fill;
        if (ratio < dd.fullText / dd.total) fill = '#1F2937';
        else if (ratio < (dd.fullText + dd.abstract) / dd.total) fill = '#374151';
        else fill = '#D1D5DB';
        html += `<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${fill};margin:0 1px;"></span>`;
      }

      const depthLabel = d === 0 ? '(seed)' : d === 1 ? '(parents)' : d === 2 ? '(grandparents)' : '';
      html += `<span style="font:10px 'Inter',sans-serif;color:#9CA3AF;margin-left:8px;">${dd.total} papers ${depthLabel}</span>`;
      html += '</div>';
    });

    html += '<p style="font:10px \'JetBrains Mono\',monospace;color:#9CA3AF;margin:8px 0 0;">████ full text · ●●●● abstract · ○○○○ title only · Click depth to highlight</p>';
    html += '</div>';

    // AI Analysis for cascade
    const d0 = data.depthData[0] || { total: 0, fullText: 0, abstract: 0, titleOnly: 0 };
    const d1 = data.depthData[1] || { total: 0, fullText: 0, abstract: 0, titleOnly: 0 };
    const d2 = data.depthData[2] || { total: 0, fullText: 0, abstract: 0, titleOnly: 0 };
    html += _renderAIAnalysis(`The cascade reveals a clear evidence gradient. At depth 0 (the seed paper), ${d0.fullText > 0 ? 'full text is available, enabling the strongest classifications' : 'only abstract text is available'}. At depth 1, ${d1.total} papers are present with ${d1.abstract} using abstract matching. By depth 2, ${d2.titleOnly} of ${d2.total} papers drop to title-only matching. The further a paper is from the seed, the less reliable its mutation type classification.`);

    // ── Fragility Network ──
    html += '<div style="font:600 10px \'JetBrains Mono\',monospace;letter-spacing:0.1em;color:#374151;margin:20px 0 8px;border-bottom:1px solid #E5E7EB;padding-bottom:4px;">FRAGILITY NETWORK</div>';

    html += _renderFragilityNetwork(data, gd);

    // AI Analysis for fragility (async from Groq — comprehensive report)
    html += _renderAsyncAIAnalysis('trust-ai-fragility', 'fragility report');

    // ── Fragility Risk Cards ──
    html += '<div style="font:600 10px \'JetBrains Mono\',monospace;letter-spacing:0.1em;color:#374151;margin:20px 0 8px;border-bottom:1px solid #E5E7EB;padding-bottom:4px;">FRAGILITY RISKS</div>';
    html += `<p style="font:11px 'Inter',sans-serif;color:#9CA3AF;margin:0 0 8px;">${data.risks.length} risk${data.risks.length !== 1 ? 's' : ''} detected</p>`;

    data.risks.forEach((risk, i) => {
      html += _renderRiskCard(risk, i, false);
    });

    // Read more button
    html += '<div style="margin:20px 0;text-align:center;">';
    html += '<button class="trust-readmore-btn" style="padding:10px 24px;border:1px solid #D1D5DB;border-radius:6px;background:transparent;font:600 12px \'JetBrains Mono\',monospace;cursor:pointer;color:#374151;letter-spacing:0.05em;">Read more — Full analysis →</button>';
    html += '</div>';

    html += '</div>';
    body.innerHTML = html;

    // Wire interactions
    _wireInitialDetailInteractions(body, data);
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5 — FULL DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════════════

const TrustEvidenceFullAnalysis = {
  show(body, data) {
    if (!data) {
      const gd = window._graphLoader?._graphData;
      if (!gd) return;
      data = TrustComputer.compute(gd);
    }

    let html = '<div style="padding:16px;">';

    // Back button + title
    html += '<div style="margin-bottom:16px;display:flex;align-items:center;gap:12px;">';
    html += '<button class="trust-back-btn" style="padding:4px 12px;border:1px solid #D1D5DB;border-radius:4px;background:#F9FAFB;font:11px \'JetBrains Mono\',monospace;cursor:pointer;color:#374151;">← Back</button>';
    html += '<span style="font:600 13px \'JetBrains Mono\',monospace;color:#374151;">TRUST & EVIDENCE — FULL ANALYSIS</span>';
    html += '</div>';

    // ── Evidence Quality Cross-Tab ──
    html += '<div style="font:600 10px \'JetBrains Mono\',monospace;letter-spacing:0.1em;color:#374151;margin:16px 0 8px;border-bottom:1px solid #E5E7EB;padding-bottom:4px;">EVIDENCE QUALITY CROSS-TAB</div>';

    html += '<div style="padding:12px;border:1px solid #E5E7EB;border-radius:8px;margin-bottom:8px;">';
    html += '<p style="font:11px \'Inter\',sans-serif;color:#6B7280;margin:0 0 10px;">How much text did the NLP pipeline have to work with?</p>';

    const textRows = [
      { label: 'Full text + methods', count: data.textTiers.fullText, pct: Math.round(data.textTiers.fullText / data.totalNodes * 100) },
      { label: 'Introduction', count: data.textTiers.intro, pct: Math.round(data.textTiers.intro / data.totalNodes * 100) },
      { label: 'Abstract only', count: data.textTiers.abstract, pct: Math.round(data.textTiers.abstract / data.totalNodes * 100) },
      { label: 'Title only', count: data.textTiers.titleOnly, pct: Math.round(data.textTiers.titleOnly / data.totalNodes * 100) },
    ];

    textRows.forEach(r => {
      html += '<div style="display:flex;align-items:center;gap:8px;margin:6px 0;padding:4px 0;border-bottom:1px solid #F3F4F6;">';
      html += `<span style="flex:0 0 120px;font:11px 'Inter',sans-serif;color:#374151;">${r.label}</span>`;
      html += `<span style="flex:1;">${_renderDotBar(r.pct, 20, r.count > 0 ? '#374151' : '#E5E7EB')}</span>`;
      html += `<span style="flex:0 0 70px;font:11px 'JetBrains Mono',monospace;color:#374151;text-align:right;">${r.count} (${r.pct}%)</span>`;
      html += '</div>';
    });

    // Key insight
    html += `<div style="margin:12px 0;padding:10px 14px;background:#FEF9C3;border:1px solid #F59E0B;border-radius:6px;">`;
    html += `<p style="font:600 10px 'JetBrains Mono',monospace;color:#92400E;margin:0 0 4px;">KEY INSIGHT</p>`;
    html += `<p style="font:12px/1.5 'Inter',sans-serif;color:#374151;margin:0;">${data.textTiers.abstract > 0 ? data.textTiers.abstract + ' papers (' + Math.round(data.textTiers.abstract/data.totalNodes*100) + '%) had only abstract text.' : ''} ${data.textTiers.fullText === 0 ? 'No papers had full text + methods sections. The NLP pipeline matched from abstracts, not methodology descriptions where real influence is described.' : ''}</p>`;
    html += '</div>';

    // Cross-reference
    html += '<p style="font:10px \'JetBrains Mono\',monospace;color:#6B7280;margin:4px 0;">CROSS-REFERENCE:</p>';
    html += `<p style="font:11px 'Inter',sans-serif;color:#374151;margin:2px 0;">· ${data.crossRef.highMedWithTextPct}% of HIGH/MEDIUM edges had text for analysis</p>`;
    html += `<p style="font:11px 'Inter',sans-serif;color:#374151;margin:2px 0;">· ${data.crossRef.lowSpecTitleOnlyPct}% of LOW/SPECULATIVE had only title matching</p>`;
    html += `<p style="font:11px 'Inter',sans-serif;color:#374151;margin:2px 0;">· ${data.crossRef.incomparable} edges incomparable (language mismatch or no text)</p>`;
    html += '</div>';

    // AI Analysis
    html += _renderAIAnalysis(`The cross-tab reveals the root cause of low trust: text depth, not text availability. ${data.textTiers.abstract} papers (${Math.round(data.textTiers.abstract/data.totalNodes*100)}%) provided abstracts, which give the NLP pipeline enough to detect topic similarity but not enough to confirm methodological inheritance. The ${data.crossRef.incomparable} incomparable edges (${Math.round(data.crossRef.incomparable/data.totalEdges*100)}%) represent language mismatches or papers where no text was extractable.`);

    // ── Sentence Evidence Gallery ──
    html += '<div style="font:600 10px \'JetBrains Mono\',monospace;letter-spacing:0.1em;color:#374151;margin:20px 0 8px;border-bottom:1px solid #E5E7EB;padding-bottom:4px;">SENTENCE EVIDENCE GALLERY</div>';
    html += `<p style="font:11px 'Inter',sans-serif;color:#9CA3AF;margin:0 0 8px;">${data.evidencePairs.length} verifiable evidence pairs</p>`;

    // Category tabs
    const categories = Object.entries(data.mutationCounts).sort((a, b) => b[1] - a[1]);
    html += '<div class="trust-category-tabs" style="display:flex;gap:6px;margin-bottom:12px;overflow-x:auto;">';
    categories.forEach(([cat, count], i) => {
      const selected = i === 0;
      html += `<button class="trust-cat-tab" data-category="${cat}" style="padding:6px 10px;border:1px solid ${selected ? '#374151' : '#D1D5DB'};border-radius:6px;background:${selected ? '#374151' : '#F3F4F6'};color:${selected ? 'white' : '#374151'};font:600 10px 'JetBrains Mono',monospace;cursor:pointer;white-space:nowrap;">${cat.toUpperCase().substring(0, 12)} (${count})</button>`;
    });
    html += '</div>';

    // Evidence carousel container
    html += '<div id="trust-evidence-carousel" style="margin-bottom:12px;"></div>';

    // Navigation
    html += '<div style="text-align:center;margin:8px 0;">';
    html += '<button class="trust-ev-prev" style="padding:4px 12px;border:1px solid #D1D5DB;border-radius:4px;background:transparent;font:14px monospace;cursor:pointer;">←</button>';
    html += '<span class="trust-ev-counter" style="font:11px \'JetBrains Mono\',monospace;color:#6B7280;margin:0 12px;">1 / 1</span>';
    html += '<button class="trust-ev-next" style="padding:4px 12px;border:1px solid #D1D5DB;border-radius:4px;background:transparent;font:14px monospace;cursor:pointer;">→</button>';
    html += '</div>';

    // ── Fragility Report (expanded) ──
    html += '<div style="font:600 10px \'JetBrains Mono\',monospace;letter-spacing:0.1em;color:#374151;margin:20px 0 8px;border-bottom:1px solid #E5E7EB;padding-bottom:4px;">FRAGILITY REPORT</div>';
    html += `<p style="font:11px 'Inter',sans-serif;color:#9CA3AF;margin:0 0 8px;">${data.risks.length} risk${data.risks.length !== 1 ? 's' : ''} detected</p>`;

    data.risks.forEach((risk, i) => {
      html += _renderRiskCard(risk, i, true); // expanded = true
    });

    // ── Overall Trust Assessment ──
    html += '<div style="font:600 10px \'JetBrains Mono\',monospace;letter-spacing:0.1em;color:#374151;margin:20px 0 8px;border-bottom:1px solid #E5E7EB;padding-bottom:4px;">OVERALL TRUST ASSESSMENT</div>';

    const singleThreadCount = data.risks.filter(r => r.type === 'SINGLE-THREAD DEPENDENCY').length;
    const topRisks = data.risks.filter(r => r.type === 'SINGLE-THREAD DEPENDENCY').slice(0, 2);
    const combinedImpact = topRisks.reduce((sum, r) => sum + r.impact, 0);

    html += '<div style="padding:14px;border:1px solid #E5E7EB;border-radius:8px;margin-bottom:12px;">';
    html += `<p style="font:13px/1.6 'Inter',sans-serif;color:#374151;margin:0 0 8px;">This lineage has a trust score of ${data.trustPct}%, driven primarily by the absence of full-text analysis. ${Math.round(data.textTiers.abstract/data.totalNodes*100)}% of papers provided only abstract text, meaning the NLP pipeline matched sentences from summaries rather than methodology sections where the actual influence happens.</p>`;
    html += `<p style="font:13px/1.6 'Inter',sans-serif;color:#374151;margin:0 0 8px;">The ${singleThreadCount} single-thread dependencies are concentrated in the foundational layer (depth 1-2).${topRisks.length >= 2 ? ` [${topRisks[0].paper.title}] and [${topRisks[1].paper.title}] together affect up to ${combinedImpact}% of the graph.` : ''} This is ${combinedImpact > 50 ? 'an unusually high' : 'a moderate'} concentration of structural risk.</p>`;
    html += `<p style="font:13px/1.6 'Inter',sans-serif;color:#374151;margin:0;">The comparable rate (${data.comparablePct}%) is a positive signal: most edge pairs had text in the same language and could be meaningfully compared. The bottleneck is text depth, not text availability.</p>`;

    // Takeaway
    html += `<div style="margin:12px 0 0;padding:10px 14px;background:#FEF9C3;border:1px solid #D4A843;border-radius:6px;">`;
    html += `<p style="font:600 10px 'JetBrains Mono',monospace;color:#92400E;margin:0 0 4px;">TAKEAWAY</p>`;
    html += `<p style="font:12px/1.5 'Inter',sans-serif;color:#374151;margin:0;">The analysis is structurally sound (${data.comparablePct}% comparable) but evidence-thin (${data.textTiers.fullText === 0 ? '0%' : Math.round(data.textTiers.fullText/data.totalNodes*100)+'%'} full text). Treat mutation type classifications as directionally correct but not definitive.${topRisks.length > 0 ? ` The single-thread dependencies at [${topRisks[0].paper.title}]${topRisks.length > 1 ? ' and [' + topRisks[1].paper.title + ']' : ''} are the biggest reliability risks.` : ''}</p>`;
    html += '</div></div>';

    // Discuss button
    html += '<div style="text-align:center;margin:16px 0;">';
    html += '<button class="trust-discuss-btn" style="padding:10px 24px;background:#374151;color:white;border:none;border-radius:6px;font:600 12px \'JetBrains Mono\',monospace;cursor:pointer;">Discuss with AI</button>';
    html += '</div>';

    html += '</div>';
    body.innerHTML = html;

    // Wire full detail interactions
    _wireFullDetailInteractions(body, data);
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6 — HELPER RENDERERS
// ═══════════════════════════════════════════════════════════════════════════

function _renderFillGrid(pct, cols, rows) {
  const filled = Math.round((pct / 100) * (cols * rows));
  let html = '<div style="display:inline-block;border:1px solid #E5E7EB;border-radius:6px;padding:4px;">';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = (rows - 1 - r) * cols + c; // bottom-up fill
      const isFilled = idx < filled;
      html += `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${isFilled ? '#374151' : '#E5E7EB'};margin:1px;"></span>`;
    }
    html += '<br>';
  }
  html += '</div>';
  return html;
}

function _renderDotBar(pct, totalDots, fillColor) {
  const filled = Math.round((pct / 100) * totalDots);
  let html = '<span style="display:inline-flex;gap:2px;">';
  for (let i = 0; i < totalDots; i++) {
    html += `<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${i < filled ? fillColor : '#E5E7EB'};"></span>`;
  }
  html += '</span>';
  return html;
}

function _renderAIAnalysis(text, takeaway) {
  let html = '<div style="padding:12px;border:1px solid #E5E7EB;border-radius:8px;margin:8px 0 16px;background:#FAFAFA;">';
  html += `<p style="font:600 10px 'JetBrains Mono',monospace;color:#6B7280;margin:0 0 6px;">AI ANALYSIS</p>`;
  html += `<p style="font:12px/1.6 'Inter',sans-serif;color:#374151;margin:0;">${text}</p>`;
  if (takeaway) {
    html += `<div style="margin:8px 0 0;padding:8px 12px;background:#FEF9C3;border:1px solid #D4A843;border-radius:4px;">`;
    html += `<p style="font:600 9px 'JetBrains Mono',monospace;color:#92400E;margin:0 0 2px;">TAKEAWAY</p>`;
    html += `<p style="font:11px/1.4 'Inter',sans-serif;color:#374151;margin:0;">${takeaway}</p>`;
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function _renderAsyncAIAnalysis(containerId, section) {
  return `<div id="${containerId}" style="padding:12px;border:1px solid #E5E7EB;border-radius:8px;margin:8px 0 16px;background:#FAFAFA;">
    <p style="font:600 10px 'JetBrains Mono',monospace;color:#6B7280;margin:0 0 6px;">AI ANALYSIS</p>
    <p style="font:12px/1.6 'Inter',sans-serif;color:#9CA3AF;margin:0;"><em>Generating ${section} analysis...</em></p>
  </div>`;
}

function _loadAIAnalysis(containerId, graphId, section, contextData) {
  fetch(`/api/graph/${encodeURIComponent(graphId)}/trust-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, context: contextData }),
  })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      const container = document.getElementById(containerId);
      if (!container) return;
      if (data?.analysis) {
        container.innerHTML = `
          <p style="font:600 10px 'JetBrains Mono',monospace;color:#6B7280;margin:0 0 6px;">AI ANALYSIS</p>
          <p style="font:12px/1.6 'Inter',sans-serif;color:#374151;margin:0;">${data.analysis.replace(/\n/g, '<br>')}</p>
        `;
      } else {
        container.querySelector('em').textContent = 'Analysis generation failed. Template analysis shown below.';
      }
    })
    .catch(() => {
      const container = document.getElementById(containerId);
      if (container) container.querySelector('em').textContent = 'Analysis unavailable.';
    });
}

function _renderFragilityNetwork(data, graphData) {
  const risks = data.risks.filter(r => r.type === 'SINGLE-THREAD DEPENDENCY');
  if (!risks.length) return '<p style="font:11px \'Inter\',sans-serif;color:#9CA3AF;padding:20px;text-align:center;">No single-thread dependencies detected.</p>';

  const W = 400, H = 200;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;max-width:${W}px;margin:0 auto;border:1px solid #E5E7EB;border-radius:8px;background:#FAFAFA;">`;

  // Position bottleneck nodes
  const cx = W / 2, cy = H / 2;
  const bottleneckPositions = [];

  risks.forEach((risk, i) => {
    const angle = (i / risks.length) * Math.PI * 2 - Math.PI / 2;
    const dist = 60;
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    bottleneckPositions.push({ x, y, risk });

    // Draw bottleneck node (large dot matrix circle)
    const r = Math.max(10, Math.min(20, 8 + risk.impact / 5));
    for (let ring = 0; ring <= 2; ring++) {
      const ringR = ring * 4;
      const ringDots = ring === 0 ? 1 : ring * 6;
      for (let d = 0; d < ringDots; d++) {
        const a = (d / ringDots) * Math.PI * 2;
        const dx = x + Math.cos(a) * ringR;
        const dy = y + Math.sin(a) * ringR;
        svg += `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="2.2" fill="#EF4444" class="trust-frag-node" data-paper-id="${risk.paper.id}" style="cursor:pointer"/>`;
      }
    }

    // Impact label
    svg += `<text x="${x}" y="${y + r + 14}" text-anchor="middle" fill="#374151" font-size="9" font-family="JetBrains Mono,monospace" font-weight="600">${risk.impact}%</text>`;

    // Paper name (truncated)
    const shortTitle = (risk.paper.title || '').substring(0, 18) + ((risk.paper.title || '').length > 18 ? '...' : '');
    svg += `<text x="${x}" y="${y + r + 24}" text-anchor="middle" fill="#6B7280" font-size="7" font-family="JetBrains Mono,monospace">${shortTitle}</text>`;
  });

  // Draw connections between bottlenecks (single-thread lines)
  for (let i = 0; i < bottleneckPositions.length; i++) {
    for (let j = i + 1; j < bottleneckPositions.length; j++) {
      const a = bottleneckPositions[i];
      const b = bottleneckPositions[j];
      // Dashed line between bottlenecks
      const dist = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
      const dots = Math.floor(dist / 6);
      for (let d = 0; d < dots; d++) {
        const t = d / dots;
        const dx = a.x + (b.x - a.x) * t;
        const dy = a.y + (b.y - a.y) * t;
        svg += `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="1" fill="#FCA5A5"/>`;
      }
    }
  }

  // Draw some dependent nodes around each bottleneck
  bottleneckPositions.forEach(bp => {
    const numDeps = Math.min(5, bp.risk.dependentCount);
    for (let i = 0; i < numDeps; i++) {
      const angle = (i / numDeps) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 30 + Math.random() * 15;
      const x = bp.x + Math.cos(angle) * dist;
      const y = bp.y + Math.sin(angle) * dist;
      if (x > 10 && x < W - 10 && y > 10 && y < H - 10) {
        svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#9CA3AF" opacity="0.5"/>`;
        // Line to bottleneck
        svg += `<line x1="${bp.x}" y1="${bp.y}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#E5E7EB" stroke-width="0.5"/>`;
      }
    }
  });

  // Legend
  svg += `<text x="10" y="${H - 10}" fill="#9CA3AF" font-size="7" font-family="JetBrains Mono,monospace">◉ bottleneck · ○ dependent · ━━ single-thread · hover for details</text>`;

  svg += '</svg>';

  return `<div style="padding:8px;margin-bottom:8px;">${svg}</div>`;
}

function _renderRiskCard(risk, index, expanded) {
  const isLowConf = risk.type === 'LOW-CONFIDENCE FOUNDATIONS';
  const borderColor = isLowConf ? '#FCA5A5' : '#FCA5A5';
  const bgColor = '#FEF2F2';

  let html = `<div class="trust-risk-card" style="border:1px solid ${borderColor};border-radius:8px;padding:14px;margin-bottom:10px;background:${bgColor};">`;

  html += `<p style="font:600 11px 'JetBrains Mono',monospace;color:#EF4444;margin:0 0 6px;">⚠ ${risk.type}${index !== undefined ? '  #' + (index + 1) : ''}</p>`;

  if (risk.paper) {
    html += `<p style="font:600 13px 'JetBrains Mono',monospace;color:#374151;margin:0 0 4px;"><a class="pf-paper-link" data-id="${risk.paper.id}" style="cursor:pointer;text-decoration:underline;">${risk.paper.title}</a></p>`;
    html += `<p style="font:10px 'Inter',sans-serif;color:#9CA3AF;margin:0 0 8px;">${(risk.paper.citation_count || 0).toLocaleString()} citations · Depth ${risk.paper.depth ?? '?'}${risk.paper.is_bottleneck ? ' · Bottleneck' : ''}</p>`;

    // Impact bar
    html += '<p style="font:600 10px \'JetBrains Mono\',monospace;color:#6B7280;margin:0 0 4px;">IMPACT IF FLAWED:</p>';
    const impactDots = Math.round(risk.impact / 5); // 20 dots max
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 20; i++) {
        html += `<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${i < impactDots ? '#EF4444' : '#FCA5A5'};margin:0 1px;"></span>`;
      }
      html += `${row === 0 ? '<span style="font:11px \'JetBrains Mono\',monospace;color:#374151;margin-left:6px;">' + risk.impact + '%</span>' : ''}<br>`;
    }
  }

  // Description
  html += `<p style="font:12px/1.5 'Inter',sans-serif;color:#374151;margin:8px 0;">${risk.description}</p>`;

  if (expanded && risk.paper) {
    html += `<p style="font:10px 'JetBrains Mono',monospace;color:#6B7280;margin:4px 0;">DEPENDENT PAPERS:</p>`;
    html += `<button class="trust-show-deps" data-paper-id="${risk.paper.id}" style="font:11px 'JetBrains Mono',monospace;color:#374151;background:none;border:none;cursor:pointer;text-decoration:underline;padding:0;">show ${risk.dependentCount} papers ▾</button>`;
  }

  // Buttons
  html += '<div style="display:flex;gap:8px;margin-top:8px;">';
  if (risk.paper) {
    html += `<button class="trust-prune-btn" data-paper-id="${risk.paper.id}" style="padding:4px 10px;border:1px solid #D1D5DB;border-radius:4px;background:transparent;font:10px 'JetBrains Mono',monospace;cursor:pointer;color:#374151;">Prune to see collapse →</button>`;
    html += `<button class="trust-show-btn" data-paper-id="${risk.paper.id}" style="padding:4px 10px;border:1px solid #D1D5DB;border-radius:4px;background:transparent;font:10px 'JetBrains Mono',monospace;cursor:pointer;color:#374151;">Show in graph →</button>`;
  }
  if (risk.weakEdges) {
    html += `<button class="trust-weak-edges-btn" style="padding:4px 10px;border:1px solid #D1D5DB;border-radius:4px;background:transparent;font:10px 'JetBrains Mono',monospace;cursor:pointer;color:#374151;">Show weak edges in graph →</button>`;
  }
  html += '</div>';

  html += '</div>';
  return html;
}

function _renderEvidencePair(pair) {
  const tierColors = { HIGH: '#DCFCE7', MEDIUM: '#DBEAFE', LOW: '#FEF3C7', SPECULATIVE: '#F3E8FF' };
  const tierTextColors = { HIGH: '#166534', MEDIUM: '#1E40AF', LOW: '#92400E', SPECULATIVE: '#6B21A8' };
  const bg = tierColors[pair.confidenceTier] || '#F3E8FF';
  const txtColor = tierTextColors[pair.confidenceTier] || '#6B21A8';

  let html = '<div style="border:1px solid #E5E7EB;border-radius:8px;padding:14px;">';

  // Citing paper
  html += '<p style="font:600 10px \'JetBrains Mono\',monospace;color:#6B7280;margin:0 0 4px;">CITING PAPER:</p>';
  html += `<div style="border-left:3px solid #3B82F6;padding:8px 12px;background:#F0F9FF;border-radius:0 6px 6px 0;margin-bottom:10px;">`;
  html += `<p style="font:12px/1.5 'Inter',sans-serif;color:#374151;margin:0;font-style:italic;">"${pair.citingSentence}"</p>`;
  html += `<p style="font:11px 'Inter',sans-serif;color:#9CA3AF;margin:4px 0 0;">— <a class="pf-paper-link" data-id="${pair.citingId}" style="cursor:pointer;text-decoration:underline;">${pair.citingPaper}</a></p>`;
  html += '</div>';

  // Cited paper
  html += '<p style="font:600 10px \'JetBrains Mono\',monospace;color:#6B7280;margin:0 0 4px;">CITED PAPER:</p>';
  html += `<div style="border-left:3px solid #6B7280;padding:8px 12px;background:#F9FAFB;border-radius:0 6px 6px 0;margin-bottom:10px;">`;
  html += `<p style="font:12px/1.5 'Inter',sans-serif;color:#374151;margin:0;font-style:italic;">"${pair.citedSentence}"</p>`;
  html += `<p style="font:11px 'Inter',sans-serif;color:#9CA3AF;margin:4px 0 0;">— <a class="pf-paper-link" data-id="${pair.citedId}" style="cursor:pointer;text-decoration:underline;">${pair.citedPaper}</a></p>`;
  html += '</div>';

  // Metrics
  html += `<div style="padding:8px 12px;background:#F9FAFB;border-radius:6px;display:flex;flex-wrap:wrap;gap:12px;">`;
  html += `<span style="font:10px 'JetBrains Mono',monospace;color:#6B7280;">CONFIDENCE: ${_renderDotBar(pair.similarity * 100, 10, '#374151')} <span style="padding:2px 6px;background:${bg};color:${txtColor};border-radius:3px;font-weight:600;">${pair.confidenceTier}</span></span>`;
  html += `<span style="font:10px 'JetBrains Mono',monospace;color:#6B7280;">SIMILARITY: ${pair.similarity.toFixed(2)}</span>`;
  html += `<span style="font:10px 'JetBrains Mono',monospace;color:#6B7280;">COMPARABLE: ${pair.comparable ? 'Yes' : 'No'}</span>`;
  html += `<span style="font:10px 'JetBrains Mono',monospace;color:#6B7280;">TEXT: ${pair.citingTextSource} → ${pair.citedTextSource}</span>`;
  html += '</div>';

  // Per-pair AI analysis container
  const pairAnalysisId = `trust-pair-analysis-${Date.now()}`;
  html += `<div id="${pairAnalysisId}" style="padding:10px 12px;border:1px solid #E5E7EB;border-radius:6px;margin-top:10px;background:#FAFAFA;">
    <p style="font:600 9px 'JetBrains Mono',monospace;color:#6B7280;margin:0 0 4px;">WHY THIS MATTERS</p>
    <p style="font:11px/1.5 'Inter',sans-serif;color:#9CA3AF;margin:0;"><em>Generating analysis...</em></p>
  </div>`;

  // Actions
  html += '<div style="display:flex;gap:8px;margin-top:8px;">';
  html += `<button class="trust-show-both-btn" data-citing-id="${pair.citingId}" data-cited-id="${pair.citedId}" style="padding:4px 10px;border:1px solid #D1D5DB;border-radius:4px;background:transparent;font:10px 'JetBrains Mono',monospace;cursor:pointer;color:#374151;">Show both in graph →</button>`;
  html += '</div>';

  html += '</div>';

  // Schedule async load for this pair's analysis
  setTimeout(() => {
    const graphId = window._graphLoader?._graphData?.metadata?.graph_id;
    if (graphId) {
      _loadAIAnalysis(pairAnalysisId, graphId, 'evidence_pair', {
        seed_title: window._graphLoader?._graphData?.metadata?.seed_paper_title || '',
        citing_paper: pair.citingPaper,
        cited_paper: pair.citedPaper,
        citing_sentence: pair.citingSentence,
        cited_sentence: pair.citedSentence,
        mutation_type: pair.mutationType,
        confidence_tier: pair.confidenceTier,
        similarity: pair.similarity,
      });
    }
  }, 100);

  return html;
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7 — INTERACTION WIRING
// ═══════════════════════════════════════════════════════════════════════════

function _wireInitialDetailInteractions(body, data) {
  // Tier row clicks
  body.querySelectorAll('.trust-tier-row').forEach(row => {
    row.addEventListener('click', () => {
      const tier = row.dataset.tier;
      _highlightEdgesByTier(tier);
    });
    row.addEventListener('mouseenter', () => { row.style.background = '#F9FAFB'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });
  });

  // Cascade depth clicks
  body.querySelectorAll('.trust-cascade-row').forEach(row => {
    row.addEventListener('click', () => {
      const depth = parseInt(row.dataset.depth);
      _highlightPapersByDepth(depth);
    });
  });

  // Fragility network node clicks
  body.querySelectorAll('.trust-frag-node').forEach(node => {
    node.addEventListener('click', () => {
      const paperId = node.dataset.paperId;
      if (typeof window._zoomToNode === 'function') window._zoomToNode(paperId);
    });
  });

  // Risk card buttons — Prune to see collapse
  body.querySelectorAll('.trust-prune-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const paperId = btn.dataset.paperId;
      // Try to trigger the actual pruning system
      const g = window._arivuGraph;
      if (g && g.selectedNodes) {
        g.selectedNodes.clear();
        g.selectedNodes.add(paperId);
        // Find and click the prune execute button
        const pruneExecBtn = document.getElementById('prune-execute-btn');
        if (pruneExecBtn) {
          // First show the prune pill
          const prunePill = document.getElementById('prune-pill');
          if (prunePill) prunePill.classList.remove('hidden');
          const pruneCount = document.getElementById('prune-pill-count');
          if (pruneCount) pruneCount.textContent = '1';
          // Click execute
          pruneExecBtn.click();
        } else {
          // Fallback: dispatch prune event
          window.dispatchEvent(new CustomEvent('arivu:prune-request', { detail: { paperIds: [paperId] } }));
          if (typeof window._zoomToNode === 'function') window._zoomToNode(paperId);
        }
      } else {
        if (typeof window._zoomToNode === 'function') window._zoomToNode(paperId);
      }
    });
  });

  // Show dependent papers (expandable list)
  body.querySelectorAll('.trust-show-deps').forEach(btn => {
    btn.addEventListener('click', () => {
      const paperId = btn.dataset.paperId;
      const nodes = window._graphLoader?._graphData?.nodes || [];
      const edges = window._graphLoader?._graphData?.edges || [];

      // Check if already expanded
      const existing = btn.nextElementSibling;
      if (existing?.classList?.contains('trust-deps-list')) {
        existing.remove();
        btn.textContent = btn.textContent.replace('▴', '▾');
        return;
      }

      // Find dependent papers via edges
      const dependentIds = new Set();
      edges.forEach(e => {
        const src = typeof e.source === 'object' ? e.source.id : e.source;
        const tgt = typeof e.target === 'object' ? e.target.id : e.target;
        if (src === paperId) dependentIds.add(tgt);
        if (tgt === paperId) dependentIds.add(src);
      });

      const depList = document.createElement('div');
      depList.className = 'trust-deps-list';
      depList.style.cssText = 'margin:6px 0;padding:8px 12px;border-left:2px solid #FCA5A5;max-height:200px;overflow-y:auto;background:#FFF5F5;border-radius:0 6px 6px 0;';

      let listHtml = '';
      dependentIds.forEach(depId => {
        const node = nodes.find(n => n.id === depId);
        if (node) {
          listHtml += `<p style="margin:3px 0;font:11px 'Inter',sans-serif;color:#374151;cursor:pointer;text-decoration:underline;" class="pf-paper-link" data-id="${depId}">${node.title || 'Unknown'} (${node.year || '?'}) · ${(node.citation_count || 0).toLocaleString()} cites</p>`;
        }
      });

      depList.innerHTML = listHtml || '<p style="font:11px \'Inter\',sans-serif;color:#9CA3AF;">No dependent papers found in graph data.</p>';
      btn.parentNode.insertBefore(depList, btn.nextSibling);
      btn.textContent = btn.textContent.replace('▾', '▴');

      // Wire paper links in the expanded list
      depList.querySelectorAll('.pf-paper-link').forEach(link => {
        link.addEventListener('click', () => {
          if (typeof window._zoomToNode === 'function') window._zoomToNode(link.dataset.id);
        });
      });
    });
  });

  body.querySelectorAll('.trust-show-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const paperId = btn.dataset.paperId;
      if (typeof window._zoomToNode === 'function') window._zoomToNode(paperId);
    });
  });

  body.querySelectorAll('.trust-weak-edges-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _highlightWeakBottleneckEdges(data);
    });
  });

  // Paper links
  body.querySelectorAll('.pf-paper-link').forEach(link => {
    link.addEventListener('click', () => {
      const paperId = link.dataset.id;
      if (typeof window._zoomToNode === 'function') window._zoomToNode(paperId);
    });
  });

  // Read more button
  const readMoreBtn = body.querySelector('.trust-readmore-btn');
  if (readMoreBtn) {
    readMoreBtn.addEventListener('click', () => {
      TrustEvidenceFullAnalysis.show(body, data);
    });
  }

  // Load async AI analyses
  const graphId = window._graphLoader?._graphData?.metadata?.graph_id;
  if (graphId) {
    const seedTitle = window._graphLoader?._graphData?.metadata?.seed_paper_title || 'Unknown';

    // Cross-tab analysis
    _loadAIAnalysis('trust-ai-crosstab', graphId, 'cross_tab', {
      seed_title: seedTitle,
      total_nodes: data.totalNodes,
      total_edges: data.totalEdges,
      trust_pct: data.trustPct,
      comparable_pct: data.comparablePct,
      tiers: data.tiers,
      text_tiers: data.textTiers,
      cross_ref: data.crossRef,
    });

    // Fragility report
    _loadAIAnalysis('trust-ai-fragility', graphId, 'fragility_report', {
      seed_title: seedTitle,
      total_nodes: data.totalNodes,
      total_edges: data.totalEdges,
      risks: data.risks.map(r => ({
        type: r.type,
        paper_title: r.paper?.title || 'Unknown',
        year: r.paper?.year,
        impact: r.impact,
        dependent_count: r.dependentCount,
      })),
      weak_edge_count: data.weakBottleneckEdges?.length || 0,
    });
  }
}

function _wireFullDetailInteractions(body, data) {
  // Wire same interactions as initial detail
  _wireInitialDetailInteractions(body, data);

  // Back button
  const backBtn = body.querySelector('.trust-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      TrustEvidenceWindow.populate(body);
    });
  }

  // Category tabs
  const categories = Object.keys(data.mutationCounts).sort((a, b) => data.mutationCounts[b] - data.mutationCounts[a]);
  let currentCategory = categories[0] || '';
  let currentEvidenceIndex = 0;

  const updateEvidence = () => {
    const filtered = data.evidencePairs.filter(p => p.mutationType === currentCategory);
    const carousel = body.querySelector('#trust-evidence-carousel');
    const counter = body.querySelector('.trust-ev-counter');
    if (carousel && filtered.length > 0) {
      carousel.innerHTML = _renderEvidencePair(filtered[currentEvidenceIndex] || filtered[0]);
      // Wire paper links in evidence
      carousel.querySelectorAll('.pf-paper-link').forEach(link => {
        link.addEventListener('click', () => {
          if (typeof window._zoomToNode === 'function') window._zoomToNode(link.dataset.id);
        });
      });
      // Wire show both button
      carousel.querySelectorAll('.trust-show-both-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const citingId = btn.dataset.citingId;
          const citedId = btn.dataset.citedId;
          _highlightTwoPapers(citingId, citedId);
        });
      });
    } else if (carousel) {
      carousel.innerHTML = '<p style="font:11px \'Inter\',sans-serif;color:#9CA3AF;text-align:center;padding:20px;">No evidence pairs for this category.</p>';
    }
    if (counter) counter.textContent = `${currentEvidenceIndex + 1} / ${filtered.length}`;
  };

  body.querySelectorAll('.trust-cat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentCategory = tab.dataset.category;
      currentEvidenceIndex = 0;
      body.querySelectorAll('.trust-cat-tab').forEach(t => {
        t.style.background = t.dataset.category === currentCategory ? '#374151' : '#F3F4F6';
        t.style.color = t.dataset.category === currentCategory ? 'white' : '#374151';
        t.style.borderColor = t.dataset.category === currentCategory ? '#374151' : '#D1D5DB';
      });
      updateEvidence();
    });
  });

  const prevBtn = body.querySelector('.trust-ev-prev');
  const nextBtn = body.querySelector('.trust-ev-next');
  if (prevBtn) prevBtn.addEventListener('click', () => {
    const filtered = data.evidencePairs.filter(p => p.mutationType === currentCategory);
    currentEvidenceIndex = (currentEvidenceIndex - 1 + filtered.length) % filtered.length;
    updateEvidence();
  });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    const filtered = data.evidencePairs.filter(p => p.mutationType === currentCategory);
    currentEvidenceIndex = (currentEvidenceIndex + 1) % filtered.length;
    updateEvidence();
  });

  // Discuss button
  const discussBtn = body.querySelector('.trust-discuss-btn');
  if (discussBtn) {
    discussBtn.addEventListener('click', () => {
      const chatBtn = document.querySelector('[data-panel="panel-chat"]') || document.querySelector('[data-panel="chat"]');
      if (chatBtn) chatBtn.click();
    });
  }

  // Initialize evidence carousel
  updateEvidence();
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8 — GRAPH INTERACTION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function _highlightEdgesByTier(tier) {
  const g = window._arivuGraph;
  if (!g?.svg) return;
  g.svg.selectAll('.node-group').style('opacity', 0.15);
  g.svg.selectAll('line, .edge-line').style('opacity', 0.03);

  // Highlight edges matching this tier
  const edges = window._graphLoader?._graphData?.edges || [];
  const edgeEls = g.svg.selectAll('line, .edge-line').nodes();
  edgeEls.forEach(el => {
    const d = d3.select(el).datum();
    if (d) {
      const edgeTier = (d.confidence_tier || '').toUpperCase();
      if (edgeTier === tier) {
        d3.select(el).style('opacity', 0.8).attr('stroke', '#D4A843').attr('stroke-width', 2);
        // Also highlight connected nodes
        const src = typeof d.source === 'object' ? d.source.id : d.source;
        const tgt = typeof d.target === 'object' ? d.target.id : d.target;
        g.svg.select(`.node-group[data-id="${src}"]`).style('opacity', 1);
        g.svg.select(`.node-group[data-id="${tgt}"]`).style('opacity', 1);
      }
    }
  });

  setTimeout(() => {
    g.svg.selectAll('.node-group').style('opacity', null);
    g.svg.selectAll('line, .edge-line').style('opacity', null).attr('stroke', null).attr('stroke-width', null);
  }, 4000);
}

function _highlightPapersByDepth(depth) {
  const g = window._arivuGraph;
  const nodes = window._graphLoader?._graphData?.nodes || [];
  if (!g?.svg) return;

  g.svg.selectAll('.node-group').style('opacity', 0.1);
  g.svg.selectAll('line, .edge-line').style('opacity', 0.03);

  nodes.filter(n => n.depth === depth).forEach(n => {
    g.svg.select(`.node-group[data-id="${n.id}"]`).style('opacity', 1);
  });

  setTimeout(() => {
    g.svg.selectAll('.node-group').style('opacity', null);
    g.svg.selectAll('line, .edge-line').style('opacity', null);
  }, 4000);
}

function _highlightWeakBottleneckEdges(data) {
  const g = window._arivuGraph;
  if (!g?.svg) return;

  g.svg.selectAll('.node-group').style('opacity', 0.15);
  g.svg.selectAll('line, .edge-line').style('opacity', 0.03);

  const edgeEls = g.svg.selectAll('line, .edge-line').nodes();
  edgeEls.forEach(el => {
    const d = d3.select(el).datum();
    if (d) {
      const tier = (d.confidence_tier || '').toUpperCase();
      if (['LOW', 'SPECULATIVE'].includes(tier)) {
        const src = typeof d.source === 'object' ? d.source.id : d.source;
        const tgt = typeof d.target === 'object' ? d.target.id : d.target;
        const nodes = window._graphLoader?._graphData?.nodes || [];
        const srcNode = nodes.find(n => n.id === src);
        const tgtNode = nodes.find(n => n.id === tgt);
        if (srcNode?.is_bottleneck || tgtNode?.is_bottleneck) {
          d3.select(el).style('opacity', 0.9).attr('stroke', '#EF4444').attr('stroke-width', 2);
          g.svg.select(`.node-group[data-id="${src}"]`).style('opacity', 1);
          g.svg.select(`.node-group[data-id="${tgt}"]`).style('opacity', 1);
        }
      }
    }
  });

  setTimeout(() => {
    g.svg.selectAll('.node-group').style('opacity', null);
    g.svg.selectAll('line, .edge-line').style('opacity', null).attr('stroke', null).attr('stroke-width', null);
  }, 5000);
}

function _highlightTwoPapers(id1, id2) {
  const g = window._arivuGraph;
  if (!g?.svg) return;

  g.svg.selectAll('.node-group').style('opacity', 0.1);
  g.svg.selectAll('line, .edge-line').style('opacity', 0.03);
  g.svg.select(`.node-group[data-id="${id1}"]`).style('opacity', 1);
  g.svg.select(`.node-group[data-id="${id2}"]`).style('opacity', 1);

  setTimeout(() => {
    g.svg.selectAll('.node-group').style('opacity', null);
    g.svg.selectAll('line, .edge-line').style('opacity', null);
  }, 4000);
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 9 — WINDOW MANAGER INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

// Export for window-manager.js and deep-intelligence.js
window.TrustEvidencePanel = TrustEvidencePanel;
window.TrustEvidenceWindow = TrustEvidenceWindow;
window.TrustEvidenceFullAnalysis = TrustEvidenceFullAnalysis;
