/**
 * static/js/blindspots-battles.js
 * Blind Spots & Battles — Disputes, Gaps, and Missing Citations.
 * All visualizations use pure SVG dot matrix circles (Nothing OS aesthetic).
 *
 * Layer 1 (compact): Dot matrix eye with blink + cursor follow + 3 stat cards
 * Layer 2 (window): Battle carousel + blind spot cards
 * Layer 3 (full): All disputes + coverage matrix + missing citations
 */

/* ═══════════════════════════════════════════════════════════════════════════
   GLOBAL INTEL REQUEST QUEUE — prevents connection pool exhaustion
   All intel API calls go through this queue (max 1 concurrent request)
   ═══════════════════════════════════════════════════════════════════════════ */
const _intelQueue = {
  _queue: [],
  _running: false,

  async enqueue(url, body) {
    return new Promise((resolve, reject) => {
      this._queue.push({ url, body, resolve, reject });
      this._process();
    });
  },

  async _process() {
    if (this._running || this._queue.length === 0) return;
    this._running = true;

    while (this._queue.length > 0) {
      const { url, body, resolve, reject } = this._queue.shift();
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (resp.ok) {
          resolve(await resp.json());
        } else {
          resolve(null);
        }
      } catch (e) {
        resolve(null);
      }
      // Small delay between requests to give the pool breathing room
      await new Promise(r => setTimeout(r, 100));
    }

    this._running = false;
  },

  // Clear pending requests (e.g., when window closes)
  clear() {
    this._queue.forEach(item => item.resolve(null));
    this._queue = [];
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 1 — BLINDSPOT ANALYZER (pure client-side computation)
   ═══════════════════════════════════════════════════════════════════════════ */

class BlindspotAnalyzer {
  constructor(graphData) {
    this._graphData = graphData;
    this._nodes = graphData?.nodes || [];
    this._edges = (graphData?.edges || []).map(e => ({
      ...e,
      source: typeof e.source === 'object' ? e.source.id : e.source,
      target: typeof e.target === 'object' ? e.target.id : e.target,
    }));
    this._result = null;
  }

  analyze() {
    if (this._result) return this._result;

    const disputes = this._computeDisputes();
    const blindSpots = this._computeBlindSpots();
    const missingCitations = this._computeMissingCitations();
    const stats = this._computeStats(disputes, blindSpots, missingCitations);

    this._result = { disputes, blindSpots, missingCitations, stats };
    return this._result;
  }

  // ── Disputes: contradiction edges with multi-metric comparison ──────────

  _computeDisputes() {
    const contradictions = this._edges.filter(e => e.mutation_type === 'contradiction');
    if (!contradictions.length) return [];

    const nodeMap = new Map(this._nodes.map(n => [n.id, n]));

    // Build adjacency for local use computation
    const incomingAdoptions = new Map(); // paper_id -> count of papers that adopted it
    this._edges.forEach(e => {
      if (e.mutation_type === 'adoption' || e.mutation_type === 'generalization' || e.mutation_type === 'specialization') {
        incomingAdoptions.set(e.target, (incomingAdoptions.get(e.target) || 0) + 1);
      }
    });

    // Build quality count: non-incidental edges targeting each paper
    const qualityCount = new Map();
    this._edges.forEach(e => {
      if (e.mutation_type !== 'incidental') {
        qualityCount.set(e.target, (qualityCount.get(e.target) || 0) + 1);
      }
    });

    return contradictions.map(edge => {
      const paperA = nodeMap.get(edge.source);
      const paperB = nodeMap.get(edge.target);
      if (!paperA || !paperB) return null;

      const citesA = paperA.citation_count || 0;
      const citesB = paperB.citation_count || 0;
      const localA = incomingAdoptions.get(paperA.id) || 0;
      const localB = incomingAdoptions.get(paperB.id) || 0;
      const impactA = paperA.pruning_impact || 0;
      const impactB = paperB.pruning_impact || 0;
      const qualityA = qualityCount.get(paperA.id) || 0;
      const qualityB = qualityCount.get(paperB.id) || 0;

      // Determine if resolved (one has >2x citations of the other)
      const ratio = citesA > 0 && citesB > 0 ? Math.max(citesA, citesB) / Math.min(citesA, citesB) : 1;
      const isResolved = ratio > 2;
      const winner = isResolved ? (citesA > citesB ? 'A' : 'B') : null;

      return {
        paperA: {
          id: paperA.id,
          title: paperA.title,
          authors: (paperA.authors || []).slice(0, 2).join(', '),
          year: paperA.year,
          citations: citesA,
          localUse: localA,
          pruneImpact: Math.min(100, Math.round(impactA * 100) / 100),
          quality: qualityA,
        },
        paperB: {
          id: paperB.id,
          title: paperB.title,
          authors: (paperB.authors || []).slice(0, 2).join(', '),
          year: paperB.year,
          citations: citesB,
          localUse: localB,
          pruneImpact: Math.min(100, Math.round(impactB * 100) / 100),
          quality: qualityB,
        },
        isResolved,
        winner,
        similarity: edge.similarity_score || 0,
        confidence: edge.final_confidence || 0,
        edge,
      };
    }).filter(Boolean).sort((a, b) => {
      // Active first, then by combined citations
      if (a.isResolved !== b.isResolved) return a.isResolved ? 1 : -1;
      return (b.paperA.citations + b.paperB.citations) - (a.paperA.citations + a.paperB.citations);
    });
  }

  // ── Blind Spots: fields with papers but weak connections ────────────────

  _computeBlindSpots() {
    const fieldMap = new Map();
    const nodeMap = new Map(this._nodes.map(n => [n.id, n]));

    // Count papers per field
    this._nodes.forEach(node => {
      (node.fields_of_study || []).forEach(field => {
        if (!field?.trim()) return;
        if (!fieldMap.has(field)) {
          fieldMap.set(field, { name: field, papers: [], edges: 0, depthSpread: {}, paperIds: new Set() });
        }
        const f = fieldMap.get(field);
        f.papers.push(node);
        f.paperIds.add(node.id);
        const d = node.depth ?? 0;
        f.depthSpread[d] = (f.depthSpread[d] || 0) + 1;
      });
    });

    // Count edges per field: meaningful edges count full, incidental count 0.3
    this._edges.forEach(edge => {
      const weight = edge.mutation_type === 'incidental' ? 0.3 : 1;
      fieldMap.forEach(f => {
        if (f.paperIds.has(edge.source) || f.paperIds.has(edge.target)) {
          f.edges += weight;
        }
      });
    });

    // Compute coverage ratio (use all edges with weighting, not just non-incidental)
    const totalEdges = this._edges.reduce((sum, e) => sum + (e.mutation_type === 'incidental' ? 0.3 : 1), 0);
    const totalPapers = this._nodes.length;
    const avgRatio = totalPapers > 0 ? Math.max(0.1, totalEdges / totalPapers) : 1; // min 0.1 prevents div-by-zero

    const results = [];
    fieldMap.forEach(f => {
      if (f.papers.length < 2) return; // Skip single-paper fields
      const coverage = avgRatio > 0 ? (f.edges / f.papers.length) / avgRatio : 0;
      const status = coverage < 0.2 ? 'UNDEREXPLORED' : coverage < 0.4 ? 'WEAK' : coverage < 0.7 ? 'MODERATE' : 'WELL-COVERED';

      results.push({
        name: f.name,
        paperCount: f.papers.length,
        edgeCount: Math.round(f.edges),
        depthSpread: f.depthSpread,
        coverage: Math.round(coverage * 100) / 100,
        status,
        topPapers: f.papers.sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0)).slice(0, 3).map(p => ({
          id: p.id, title: p.title, year: p.year, citations: p.citation_count || 0,
        })),
      });
    });

    // Sort by coverage ascending (worst blind spots first), filter only underexplored
    return results.filter(f => f.coverage < 0.7).sort((a, b) => a.coverage - b.coverage);
  }

  // ── Missing Citations: paper pairs that should cite each other ──────────

  _computeMissingCitations() {
    const nodeMap = new Map(this._nodes.map(n => [n.id, n]));
    const edgeSet = new Set(this._edges.map(e => `${e.source}:${e.target}`));

    // Build reference map for shared references
    const refMap = new Map();
    this._edges.forEach(e => {
      if (!refMap.has(e.source)) refMap.set(e.source, new Set());
      refMap.get(e.source).add(e.target);
    });

    const pairs = [];

    // Guard: cap at 200 nodes to avoid O(n²) freeze on large graphs
    const nodesToCheck = this._nodes.length > 200
      ? this._nodes.slice().sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0)).slice(0, 200)
      : this._nodes;

    nodesToCheck.forEach(nodeA => {
      nodesToCheck.forEach(nodeB => {
        if (nodeA.id >= nodeB.id) return; // avoid duplicates

        // Skip if edge already exists
        if (edgeSet.has(`${nodeA.id}:${nodeB.id}`) || edgeSet.has(`${nodeB.id}:${nodeA.id}`)) return;

        // Check conditions: same field, close years, shared references
        const fieldsA = new Set(nodeA.fields_of_study || []);
        const fieldsB = new Set(nodeB.fields_of_study || []);
        const sharedFields = [...fieldsA].filter(f => fieldsB.has(f));
        if (sharedFields.length === 0) return;

        const yearGap = Math.abs((nodeA.year || 0) - (nodeB.year || 0));
        if (yearGap > 3) return;

        const refsA = refMap.get(nodeA.id) || new Set();
        const refsB = refMap.get(nodeB.id) || new Set();
        const sharedRefs = [...refsA].filter(r => refsB.has(r));
        if (sharedRefs.length < 2) return;

        // Resolve shared ref details (titles) for Venn diagram
        const sharedRefDetails = sharedRefs.map(refId => {
          const refNode = nodeMap.get(refId);
          return refNode ? { id: refId, title: refNode.title, year: refNode.year } : { id: refId, title: refId.substring(0, 20), year: null };
        });
        // Count unique refs per paper for Venn
        const onlyA = [...refsA].filter(r => !refsB.has(r)).length;
        const onlyB = [...refsB].filter(r => !refsA.has(r)).length;

        pairs.push({
          paperA: { id: nodeA.id, title: nodeA.title, year: nodeA.year, authors: (nodeA.authors || []).slice(0, 3), citations: nodeA.citation_count || 0, field: sharedFields[0], depth: nodeA.depth, pruning_impact: nodeA.pruning_impact || 0 },
          paperB: { id: nodeB.id, title: nodeB.title, year: nodeB.year, authors: (nodeB.authors || []).slice(0, 3), citations: nodeB.citation_count || 0, field: sharedFields[0], depth: nodeB.depth, pruning_impact: nodeB.pruning_impact || 0 },
          sharedFields,
          yearGap,
          sharedRefCount: sharedRefs.length,
          sharedRefDetails: sharedRefDetails.slice(0, 10),
          refsOnlyA: onlyA,
          refsOnlyB: onlyB,
        });
      });
    });

    // Sort by shared refs descending (most suspicious first), limit to top 20
    return pairs.sort((a, b) => b.sharedRefCount - a.sharedRefCount).slice(0, 20);
  }

  _computeStats(disputes, blindSpots, missingCitations) {
    const active = disputes.filter(d => !d.isResolved).length;
    const resolved = disputes.filter(d => d.isResolved).length;
    return {
      contradictions: disputes.length,
      activeDisputes: active,
      resolvedDisputes: resolved,
      blindSpotCount: blindSpots.length,
      missingCitationCount: missingCitations.length,
    };
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 2 — DOT MATRIX EYE (compact view hero visual)
   ═══════════════════════════════════════════════════════════════════════════ */

class DotMatrixEye {
  static render(container) {
    // Algorithmic eye: dots placed along mathematical curves for smooth shapes
    // Matches wireframe: almond eyelids, concentric iris ring, solid pupil cluster
    const dotR = 2.8;
    const svgW = 220;
    const svgH = 180;
    const cx = svgW / 2;
    const cy = svgH / 2;
    const circleR = Math.min(svgW, svgH) * 0.52;

    // --- Generate eyelid dots along elliptical arcs ---
    const eyeW = 82;  // half-width of eye
    const upperH = 45; // how high the upper lid curves (increased for more arc)
    const lowerH = 35; // how low the lower lid curves (increased for more arc)
    const numLidDots = 42; // dots per lid arc

    let outlineDots = '';
    let eyeballDots = '';

    // Upper eyelid: elliptical arc from left corner to right corner curving upward
    for (let i = 0; i <= numLidDots; i++) {
      const t = i / numLidDots; // 0 to 1
      const angle = Math.PI * t; // π to 0 (left to right)
      const x = cx + eyeW * Math.cos(Math.PI - angle);
      const y = cy - upperH * Math.sin(angle);
      outlineDots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" fill="#374151" />`;
    }

    // Lower eyelid: elliptical arc curving downward
    for (let i = 0; i <= numLidDots; i++) {
      const t = i / numLidDots;
      const angle = Math.PI * t;
      const x = cx + eyeW * Math.cos(Math.PI - angle);
      const y = cy + lowerH * Math.sin(angle);
      outlineDots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" fill="#374151" />`;
    }

    // --- Inner lid line (second arc slightly inside, creates thickness matching wireframe) ---
    const innerOffset = 6;
    const numInnerDots = 32;
    for (let i = 1; i < numInnerDots; i++) {
      const t = i / numInnerDots;
      const angle = Math.PI * t;
      const x = cx + (eyeW - innerOffset) * Math.cos(Math.PI - angle);
      const y = cy - (upperH - innerOffset * 0.7) * Math.sin(angle);
      outlineDots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR * 0.85}" fill="#6B7280" opacity="0.5" />`;
    }
    for (let i = 1; i < numInnerDots; i++) {
      const t = i / numInnerDots;
      const angle = Math.PI * t;
      const x = cx + (eyeW - innerOffset) * Math.cos(Math.PI - angle);
      const y = cy + (lowerH - innerOffset * 0.7) * Math.sin(angle);
      outlineDots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR * 0.85}" fill="#6B7280" opacity="0.5" />`;
    }

    // --- Iris: concentric ring of dots ---
    const irisR = 22; // radius of iris ring
    const numIrisDots = 24;
    for (let i = 0; i < numIrisDots; i++) {
      const angle = (2 * Math.PI * i) / numIrisDots;
      const x = cx + irisR * Math.cos(angle);
      const y = cy + irisR * Math.sin(angle);
      eyeballDots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" fill="#6B7280" />`;
    }

    // Second iris ring (slightly smaller, creates the double-ring look from wireframe)
    const irisR2 = 16;
    const numIrisDots2 = 18;
    for (let i = 0; i < numIrisDots2; i++) {
      const angle = (2 * Math.PI * i) / numIrisDots2;
      const x = cx + irisR2 * Math.cos(angle);
      const y = cy + irisR2 * Math.sin(angle);
      eyeballDots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR * 0.9}" fill="#9CA3AF" />`;
    }

    // --- Pupil: solid filled circle (concentric filled dots) ---
    // Center dot
    eyeballDots += `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="#1E293B" />`;
    // Inner ring (R=5)
    for (let i = 0; i < 6; i++) {
      const angle = (2 * Math.PI * i) / 6;
      const x = cx + 5 * Math.cos(angle);
      const y = cy + 5 * Math.sin(angle);
      eyeballDots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" fill="#1E293B" />`;
    }
    // Outer pupil ring (R=9)
    for (let i = 0; i < 10; i++) {
      const angle = (2 * Math.PI * i) / 10;
      const x = cx + 9 * Math.cos(angle);
      const y = cy + 9 * Math.sin(angle);
      eyeballDots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" fill="#374151" />`;
    }

    const eyeId = 'bs-eye-' + Date.now();
    const svg = `<svg id="${eyeId}" viewBox="0 0 ${svgW} ${svgH}" width="160" class="dm-eye-svg" style="display:block;margin:0 auto;">
      <!-- Outer circle border -->
      <circle cx="${cx}" cy="${cy}" r="${circleR}" fill="none" stroke="#D1D5DB" stroke-width="1.2" />
      <g class="eye-blink-group">
        <!-- Static eyelid outline -->
        <g class="eye-outline-group">${outlineDots}</g>
        <!-- Movable eyeball (iris + pupil) — moves as one unit -->
        <g class="eye-eyeball-group">${eyeballDots}</g>
      </g>
    </svg>`;

    container.innerHTML = svg;

    const svgEl = container.querySelector(`#${eyeId}`);
    if (svgEl) {
      DotMatrixEye._setupBlink(svgEl);
      DotMatrixEye._setupCursorFollow(svgEl, container);
    }
  }

  static _setupBlink(svgEl) {
    const blinkGroup = svgEl.querySelector('.eye-blink-group');
    if (!blinkGroup) return;

    const doBlink = () => {
      blinkGroup.style.transition = 'transform 0.1s ease-in';
      blinkGroup.style.transformOrigin = '50% 50%';
      blinkGroup.style.transform = 'scaleY(0.05)';

      setTimeout(() => {
        blinkGroup.style.transition = 'transform 0.14s ease-out';
        blinkGroup.style.transform = 'scaleY(1)';
      }, 110);

      const next = 3000 + Math.random() * 5000;
      svgEl._blinkTimer = setTimeout(doBlink, next);
    };

    svgEl._blinkTimer = setTimeout(doBlink, 2000 + Math.random() * 3000);
  }

  static _setupCursorFollow(svgEl, container) {
    const eyeball = svgEl.querySelector('.eye-eyeball-group');
    if (!eyeball) return;

    // Max shift in SVG units — constrained like a real eyeball in its socket
    // The iris+pupil group can move up to 8 SVG units from center (within the eye white)
    const maxShift = 8;
    let targetX = 0, targetY = 0;
    let currentX = 0, currentY = 0;
    let animFrame = null;

    // Smooth interpolation for realistic physics
    const lerp = (a, b, t) => a + (b - a) * t;
    const animate = () => {
      currentX = lerp(currentX, targetX, 0.12); // Damping factor for smooth motion
      currentY = lerp(currentY, targetY, 0.12);

      // Clamp to circular boundary (eyeball can't leave the socket)
      const dist = Math.sqrt(currentX * currentX + currentY * currentY);
      if (dist > maxShift) {
        currentX = (currentX / dist) * maxShift;
        currentY = (currentY / dist) * maxShift;
      }

      eyeball.setAttribute('transform', `translate(${currentX.toFixed(2)}, ${currentY.toFixed(2)})`);

      if (Math.abs(currentX - targetX) > 0.05 || Math.abs(currentY - targetY) > 0.05) {
        animFrame = requestAnimationFrame(animate);
      } else {
        animFrame = null;
      }
    };

    const onMove = (e) => {
      const rect = svgEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      // Direction from eye center to cursor, normalized
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = Math.max(rect.width, rect.height);

      // Scale: closer = less shift, farther = more (up to max)
      const scale = Math.min(1, dist / maxDist) * maxShift;
      targetX = dist > 0 ? (dx / dist) * scale : 0;
      targetY = dist > 0 ? (dy / dist) * scale : 0;

      if (!animFrame) animFrame = requestAnimationFrame(animate);
    };

    const onLeave = () => {
      targetX = 0;
      targetY = 0;
      if (!animFrame) animFrame = requestAnimationFrame(animate);
    };

    // Listen on document for broader tracking (eye follows cursor even outside panel)
    document.addEventListener('mousemove', onMove);
    container.addEventListener('mouseleave', onLeave);

    // Store cleanup refs
    svgEl._eyeCleanup = () => {
      document.removeEventListener('mousemove', onMove);
      container.removeEventListener('mouseleave', onLeave);
      if (animFrame) cancelAnimationFrame(animFrame);
    };
  }

  static cleanup(container) {
    const svg = container.querySelector('.dm-eye-svg');
    if (svg?._blinkTimer) clearTimeout(svg._blinkTimer);
    if (svg?._eyeCleanup) svg._eyeCleanup();
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 3 — DOT MATRIX BATTLE BARS (2-row tall metric bars)
   ═══════════════════════════════════════════════════════════════════════════ */

class BattleBars {
  /**
   * Render a 2-row-tall dot matrix bar.
   * @param {number} value - The value for this paper
   * @param {number} maxValue - Max between both papers (for normalization)
   * @param {number} dotCount - Number of dot columns (default 10)
   * @returns {string} SVG markup
   */
  static render(value, maxValue, dotCount = 10) {
    const filled = maxValue > 0 ? (value > 0 ? Math.max(1, Math.round((value / maxValue) * dotCount)) : 0) : 0;
    const dotR = 3.2;
    const gapX = 10;
    const gapY = 10;
    const svgW = dotCount * gapX + 4;
    const svgH = 2 * gapY + 4;

    let circles = '';
    for (let col = 0; col < dotCount; col++) {
      const isFilled = col < filled;
      for (let row = 0; row < 2; row++) {
        const cx = col * gapX + gapX / 2 + 2;
        const cy = row * gapY + gapY / 2 + 2;
        if (isFilled) {
          circles += `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="#374151" />`;
        } else {
          // Empty dots: visible outlined circles matching wireframe
          circles += `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="none" stroke="#CBD5E1" stroke-width="0.8" />`;
        }
      }
    }

    return `<svg viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" style="display:inline-block;vertical-align:middle;">${circles}</svg>`;
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 4 — BLINDSPOT PANEL (compact view in diversity dot 2)
   ═══════════════════════════════════════════════════════════════════════════ */

const BlindspotPanel = {
  render(container) {
    const graphData = window._graphLoader?._graphData;
    if (!graphData?.nodes?.length) {
      container.innerHTML = '<p style="color:#9CA3AF;font-size:0.8rem;text-align:center;padding:40px">No graph data</p>';
      return;
    }

    // Cleanup previous blink timer to prevent memory leak
    DotMatrixEye.cleanup(container);

    // Reuse cached result if available
    const result = window._blindspotResult || new BlindspotAnalyzer(graphData).analyze();
    window._blindspotResult = result;

    const { stats } = result;

    container.innerHTML = `
      <div class="bs-compact-view" style="text-align:center;padding:8px 0;">
        <div class="bs-eye-container" style="margin:0 auto;width:200px;height:140px;display:flex;align-items:center;justify-content:center;"></div>
        <div class="bs-stat-cards" style="display:flex;justify-content:center;gap:12px;margin-top:12px;">
          <div class="bs-stat-card">
            <div class="bs-stat-number">${stats.contradictions}</div>
            <div class="bs-stat-label">CONTRADICTIONS</div>
          </div>
          <div class="bs-stat-card">
            <div class="bs-stat-number">${stats.blindSpotCount}</div>
            <div class="bs-stat-label">BLIND SPOTS</div>
          </div>
          <div class="bs-stat-card">
            <div class="bs-stat-number">${stats.missingCitationCount}</div>
            <div class="bs-stat-label">MISSING CITES</div>
          </div>
        </div>
      </div>
    `;

    const eyeContainer = container.querySelector('.bs-eye-container');
    if (eyeContainer) DotMatrixEye.render(eyeContainer);
  }
};


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 5 — BLINDSPOT WINDOW (initial detail view)
   ═══════════════════════════════════════════════════════════════════════════ */

const BlindspotWindow = {
  populate(body) {
    const graphData = window._graphLoader?._graphData;
    if (!graphData?.nodes?.length) {
      body.innerHTML = '<p style="padding:40px;color:#9CA3AF">No data available.</p>';
      return;
    }

    // Reuse cached result if available (avoids re-running O(n²) missing citations)
    const result = window._blindspotResult || new BlindspotAnalyzer(graphData).analyze();
    window._blindspotResult = result;

    const { disputes, blindSpots, stats } = result;

    // Build badges
    const badgesHTML = `
      <div class="bs-badges" style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;">
        <span class="bs-badge bs-badge-active">${stats.activeDisputes} active disputes</span>
        <span class="bs-badge bs-badge-resolved">${stats.resolvedDisputes} resolved disputes</span>
        <span class="bs-badge bs-badge-spots">${stats.blindSpotCount} blind spots</span>
      </div>
    `;

    // Build battle carousel
    let battleHTML = '';
    if (disputes.length > 0) {
      battleHTML = `
        <div class="bs-section-title">BATTLES</div>
        <div class="bs-battle-carousel" data-current="0">
          <button class="bs-carousel-arrow bs-arrow-left" aria-label="Previous dispute">&larr;</button>
          <div class="bs-battle-container"></div>
          <button class="bs-carousel-arrow bs-arrow-right" aria-label="Next dispute">&rarr;</button>
        </div>
        <div class="bs-battle-analysis" style="margin-top:16px;">
          <div class="bs-analysis-content" style="color:#9CA3AF;font-size:0.85rem;font-style:italic;">Click a battle to see analysis</div>
        </div>
      `;
    } else {
      battleHTML = '<div class="bs-section-title">BATTLES</div><p style="color:#9CA3AF;font-size:0.85rem;padding:20px 0;">No contradictions found in this lineage.</p>';
    }

    // Build blind spots section
    let spotsHTML = '';
    if (blindSpots.length > 0) {
      const cardsHTML = blindSpots.slice(0, 15).map((spot, idx) => {
        const depthStr = Object.entries(spot.depthSpread).map(([d, count]) => {
          const dots = '●'.repeat(Math.min(count, 4));
          return `D${d}:${dots}`;
        }).join(' ');

        const covPct = Math.round(spot.coverage * 100);
        const covDots = Math.max(1, Math.round(spot.coverage * 10));
        const covBar = '●'.repeat(covDots) + '○'.repeat(10 - covDots);

        return `
          <div class="bs-spot-card" data-field="${this._esc(spot.name)}" data-index="${idx}">
            <div class="bs-spot-name">${this._esc(spot.name)}</div>
            <div class="bs-spot-papers">${spot.paperCount} papers</div>
            <div class="bs-spot-metric">
              <span class="bs-spot-metric-label">Connections:</span>
              <span class="bs-spot-metric-bar">${BattleBars.render(spot.edgeCount, blindSpots[0].edgeCount || 100, 8)}</span>
              <span class="bs-spot-metric-value">${spot.edgeCount}e</span>
            </div>
            <div class="bs-spot-depth">
              <span class="bs-spot-metric-label">Depth:</span>
              <span style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;color:#6B7280;">${depthStr}</span>
            </div>
            <div class="bs-spot-coverage">
              <span class="bs-spot-metric-label">Coverage:</span>
              <span style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;letter-spacing:1px;color:#6B7280;">${covBar}</span>
              <span class="bs-spot-coverage-value">${covPct}%</span>
              <span class="bs-spot-status bs-status-${spot.status.toLowerCase().replace(/\s/g, '-')}">${spot.status}</span>
            </div>
            <div class="bs-spot-llm" data-field="${this._esc(spot.name)}" style="margin-top:8px;">
              <div class="bs-spot-why" style="font-size:0.75rem;color:#6B7280;font-style:italic;">Loading analysis...</div>
            </div>
            <button class="bs-explore-btn" data-field="${this._esc(spot.name)}">Explore &rarr;</button>
          </div>
        `;
      }).join('');

      spotsHTML = `
        <div class="bs-section-title" style="margin-top:24px;">BLIND SPOTS</div>
        <div class="bs-spots-scroll">
          ${cardsHTML}
        </div>
      `;
    }

    body.innerHTML = `
      ${badgesHTML}
      ${battleHTML}
      ${spotsHTML}
      <div style="margin-top:24px;text-align:center;">
        <button class="bs-readmore-btn">View full analysis &rarr;</button>
      </div>
    `;

    // Wire up battle carousel
    if (disputes.length > 0) {
      this._setupCarousel(body, disputes);
      this._renderBattle(body, disputes, 0);
      this._loadBattleAnalysis(body, disputes, 0);
    }

    // Wire up blind spot explore buttons
    body.querySelectorAll('.bs-explore-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.field;
        this._highlightFieldInGraph(field);
      });
    });

    // Wire read more button
    const readMoreBtn = body.querySelector('.bs-readmore-btn');
    if (readMoreBtn) {
      readMoreBtn.addEventListener('click', () => {
        BlindspotFullAnalysis.show(body.closest('.arivu-window'), result);
      });
    }

    // Load blind spot LLM analyses
    this._loadBlindSpotAnalyses(body, blindSpots);
  },

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  },

  _setupCarousel(body, disputes) {
    const carousel = body.querySelector('.bs-battle-carousel');
    if (!carousel) return;

    const leftBtn = carousel.querySelector('.bs-arrow-left');
    const rightBtn = carousel.querySelector('.bs-arrow-right');
    if (!leftBtn || !rightBtn) return;

    // Hide arrows when only 1 dispute
    if (disputes.length <= 1) {
      leftBtn.style.visibility = 'hidden';
      rightBtn.style.visibility = 'hidden';
    }

    leftBtn.addEventListener('click', () => {
      let cur = parseInt(carousel.dataset.current || '0', 10);
      cur = (cur - 1 + disputes.length) % disputes.length;
      carousel.dataset.current = cur;
      this._renderBattle(body, disputes, cur);
      this._loadBattleAnalysis(body, disputes, cur);
    });

    rightBtn.addEventListener('click', () => {
      let cur = parseInt(carousel.dataset.current || '0', 10);
      cur = (cur + 1) % disputes.length;
      carousel.dataset.current = cur;
      this._renderBattle(body, disputes, cur);
      this._loadBattleAnalysis(body, disputes, cur);
    });
  },

  _renderBattle(body, disputes, index) {
    const container = body.querySelector('.bs-battle-container');
    if (!container || !disputes[index]) return;

    const d = disputes[index];
    const maxCites = Math.max(d.paperA.citations, d.paperB.citations, 1);
    const maxLocal = Math.max(d.paperA.localUse, d.paperB.localUse, 1);
    const maxImpact = Math.max(d.paperA.pruneImpact, d.paperB.pruneImpact, 1);
    const maxQuality = Math.max(d.paperA.quality, d.paperB.quality, 1);

    const statusClass = d.isResolved ? 'bs-status-resolved' : 'bs-status-active';
    const statusText = d.isResolved ? 'RESOLVED' : 'ACTIVE';

    const renderMetric = (label, value, maxVal, displayVal) => {
      const barSvg = BattleBars.render(value, maxVal, 10);
      return `
        <div class="bs-metric-row">
          <span class="bs-metric-label">${label}</span>
          <div class="bs-metric-right">
            <span class="bs-metric-value">${displayVal}</span>
            <span class="bs-metric-bar">${barSvg}</span>
          </div>
        </div>`;
    };

    const renderCard = (paper, side) => `
      <div class="bs-battle-paper bs-paper-${side}${d.isResolved && d.winner === side.toUpperCase()[0] ? ' bs-winner' : ''}">
        <div class="bs-paper-title">${this._esc(paper.title.length > 55 ? paper.title.substring(0, 55) + '...' : paper.title)}</div>
        <div class="bs-paper-meta">${this._esc(paper.authors)}${paper.year ? ', ' + paper.year : ''}</div>
        <div class="bs-paper-metrics">
          ${renderMetric('CITATIONS', paper.citations, maxCites, paper.citations.toLocaleString())}
          ${renderMetric('LOCAL USE', paper.localUse, maxLocal, paper.localUse + ' Adopted')}
          ${renderMetric('PRUNE IMPACT', paper.pruneImpact, maxImpact, paper.pruneImpact + '% Collapsed')}
          ${renderMetric('PAPER QUALITY', paper.quality, maxQuality, paper.quality + ' Adoptions')}
        </div>
        <button class="bs-show-graph-btn" data-paper-id="${paper.id}">SHOW IN GRAPH</button>
      </div>
    `;

    container.innerHTML = `
      <div class="bs-battle-outer">
        <div class="bs-battle-status ${statusClass}">● ${statusText}</div>
        <div class="bs-battle-papers">
          ${renderCard(d.paperA, 'left')}
          <div class="bs-vs-text">VS</div>
          ${renderCard(d.paperB, 'right')}
        </div>
      </div>
      <div class="bs-battle-counter">${index + 1} / ${disputes.length}</div>
    `;

    // Wire show in graph buttons
    container.querySelectorAll('.bs-show-graph-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const paperId = btn.dataset.paperId;
        if (paperId && window._zoomToNode) window._zoomToNode(paperId);
        else if (paperId) {
          // Use the deep-intelligence _zoomToNode
          const fn = window._diZoomToNode || window._zoomToNode;
          if (fn) fn(paperId);
        }
      });
    });
  },

  _loadBattleAnalysis(body, disputes, index) {
    const analysisEl = body.querySelector('.bs-analysis-content');
    if (!analysisEl || !disputes[index]) return;

    const d = disputes[index];
    analysisEl.innerHTML = '<span style="color:#9CA3AF;font-style:italic;">Generating analysis...</span>';

    // Use structured /intel endpoint
    const graphId = window._graphLoader?._graphData?.metadata?.graph_id;
    if (graphId && window.IntelContentRenderer) {
      fetch(`/api/graph/${encodeURIComponent(graphId)}/intel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'dispute_analysis',
          cache_key: `dispute_${index}`,
          data: {
            paperA: d.paperA,
            paperB: d.paperB,
            isResolved: d.isResolved,
            winner: d.winner,
          },
        }),
      })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.blocks?.length) {
            analysisEl.innerHTML = IntelContentRenderer.render(data.blocks);
            IntelContentRenderer.wireInteractions(analysisEl);
          } else {
            this._templateBattleAnalysis(analysisEl, d);
          }
        })
        .catch(() => this._templateBattleAnalysis(analysisEl, d));
    } else {
      this._templateBattleAnalysis(analysisEl, d);
    }
  },

  _templateBattleAnalysis(el, d) {
    const a = d.paperA;
    const b = d.paperB;
    const citesWinner = a.citations > b.citations ? a : b;
    const localWinner = a.localUse > b.localUse ? a : b;
    const impactWinner = a.pruneImpact > b.pruneImpact ? a : b;

    let text = '';
    if (citesWinner.id === localWinner.id && citesWinner.id === impactWinner.id) {
      text = `${citesWinner.title.substring(0, 30)}... leads across all four metrics: citations (${citesWinner.citations.toLocaleString()}), local adoption (${citesWinner.localUse}), structural impact (${citesWinner.pruneImpact}%), and quality (${citesWinner.quality} adoptions). This is a clear dominance in this lineage.`;
    } else {
      text = `The metrics tell a split story. ${citesWinner.title.substring(0, 25)}... leads on citations (${citesWinner.citations.toLocaleString()}) but ${localWinner.title.substring(0, 25)}... has more local adoptions (${localWinner.localUse}). Structurally, ${impactWinner.title.substring(0, 25)}... is more embedded (${impactWinner.pruneImpact}% collapse on removal). Together these metrics suggest the field values different aspects of each approach.`;
    }

    el.innerHTML = `<div style="font-size:0.85rem;color:#374151;line-height:1.6;">${text}</div>`;
  },

  _loadBlindSpotAnalyses(body, blindSpots) {
    const graphId = window._graphLoader?._graphData?.metadata?.graph_id;
    if (!graphId || !blindSpots.length) return;

    // Load each blind spot field analysis individually via structured /intel endpoint
    blindSpots.slice(0, 10).forEach((spot, idx) => {
      const el = [...body.querySelectorAll('.bs-spot-llm')].find(e => e.dataset.field === spot.name);
      if (!el) return;

      el.innerHTML = '<div class="bs-spot-why" style="font-size:0.75rem;color:#9CA3AF;font-style:italic;">Loading...</div>';

      fetch(`/api/graph/${encodeURIComponent(graphId)}/intel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'blindspot_field',
          cache_key: `blindspot_${spot.name}`,
          data: {
            field: {
              name: spot.name,
              paperCount: spot.paperCount,
              edgeCount: spot.edgeCount,
              coverage: spot.coverage,
              status: spot.status,
              topPapers: spot.topPapers,
            },
          },
        }),
      })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.blocks?.length && window.IntelContentRenderer) {
            el.innerHTML = IntelContentRenderer.render(data.blocks);
            IntelContentRenderer.wireInteractions(el);
          } else {
            this._templateBlindSpotAnalysis(el, spot);
          }
        })
        .catch(() => this._templateBlindSpotAnalysis(el, spot));
    });
  },

  _templateBlindSpotAnalysis(el, spot) {
    el.innerHTML = `
      <div class="bs-spot-why"><strong>Why it matters:</strong> ${spot.paperCount} papers from this field appear with only ${spot.edgeCount} meaningful connections.</div>
      <div class="bs-spot-gap" style="margin-top:4px;"><strong>⚠ Gap:</strong> Coverage of ${(spot.coverage * 100).toFixed(0)}% is ${spot.coverage < 0.2 ? 'severely' : 'significantly'} below average.</div>
      <div class="bs-spot-opportunity" style="margin-top:4px;"><strong>💡 Opportunity:</strong> Explore methodological connections between ${spot.name} and the core clusters.</div>
    `;
  },

  _highlightFieldInGraph(fieldName) {
    const graphData = window._graphLoader?._graphData;
    if (!graphData) return;

    const paperIds = graphData.nodes
      .filter(n => (n.fields_of_study || []).includes(fieldName))
      .map(n => n.id);

    if (!paperIds.length) return;

    const modeLabel = document.getElementById('mode-label');
    const isTreeMode = modeLabel?.textContent?.toLowerCase()?.includes('tree');

    if (isTreeMode && window._treeLayout?.svg) {
      const svg = window._treeLayout.svg;
      svg.selectAll('.tree-node').style('opacity', 0.1);
      svg.selectAll('path.tree-link, line.cross-edge').style('opacity', 0.03);
      paperIds.forEach(id => {
        svg.select(`.tree-node[data-id="${id}"]`).style('opacity', 1);
      });
      setTimeout(() => {
        svg.selectAll('.tree-node').style('opacity', null);
        svg.selectAll('path.tree-link, line.cross-edge').style('opacity', null);
      }, 4000);
    } else if (window._arivuGraph?.svg) {
      const g = window._arivuGraph;
      g.svg.selectAll('.node-group').style('opacity', 0.1);
      g.svg.selectAll('line, .edge-line, .edge-path').style('opacity', 0.03);
      paperIds.forEach(id => {
        g.svg.select(`.node-group[data-id="${id}"]`).style('opacity', 1);
      });
      setTimeout(() => {
        g.svg.selectAll('.node-group').style('opacity', null);
        g.svg.selectAll('line, .edge-line, .edge-path').style('opacity', null);
      }, 4000);
    }
  },
};


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 6 — FULL ANALYSIS (Layer 3)
   ═══════════════════════════════════════════════════════════════════════════ */

const BlindspotFullAnalysis = {
  show(windowEl, result) {
    if (!windowEl || !result) return;

    const body = windowEl.querySelector('.arivu-window-body');
    if (!body) return;

    const { disputes, blindSpots, missingCitations, stats } = result;

    // Dispute landscape
    const landscapeHTML = this._renderDisputeLandscape(disputes);

    // All disputes expanded
    const allDisputesHTML = disputes.map((d, idx) => this._renderExpandedDispute(d, idx)).join('');

    // Coverage matrix
    const coverageHTML = this._renderCoverageMatrix(blindSpots);

    // Missing citations
    const missingHTML = this._renderMissingCitations(missingCitations);

    body.innerHTML = `
      <div style="padding:0 4px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <button class="bs-back-btn" style="font-size:0.85rem;padding:4px 12px;border:1px solid #D1D5DB;border-radius:4px;background:white;cursor:pointer;font-family:'JetBrains Mono',monospace;">&larr; Back</button>
          <span style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:1rem;letter-spacing:0.5px;">BLIND SPOTS &amp; BATTLES &mdash; FULL ANALYSIS</span>
        </div>

        <div class="bs-full-section">
          <div class="bs-full-section-title">BATTLE OVERVIEW</div>
          ${landscapeHTML}
          <div class="bs-full-llm-box bs-overview-llm" style="margin-top:12px;">
            <span style="color:#9CA3AF;font-style:italic;">Generating overview...</span>
          </div>
        </div>

        <div class="bs-full-section" style="margin-top:32px;">
          <div class="bs-full-section-title">ALL DISPUTES (${disputes.length})</div>
          ${allDisputesHTML || '<p style="color:#9CA3AF;font-size:0.85rem;">No disputes found.</p>'}
        </div>

        <div class="bs-full-section" style="margin-top:32px;">
          <div class="bs-full-section-title">BLIND SPOT DEEP ANALYSIS</div>
          ${coverageHTML}
          <div class="bs-full-llm-box bs-blindspot-deep-llm" style="margin-top:12px;">
            <span style="color:#9CA3AF;font-style:italic;">Generating analysis...</span>
          </div>
        </div>

        <div class="bs-full-section" style="margin-top:32px;">
          <div class="bs-full-section-title">MISSING CITATIONS</div>
          ${missingHTML || '<p style="color:#9CA3AF;font-size:0.85rem;">No missing citation pairs detected.</p>'}
        </div>

        <div style="text-align:center;margin-top:24px;">
          <button class="bs-discuss-btn" style="font-family:'JetBrains Mono',monospace;padding:10px 24px;background:#1E293B;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.85rem;">Discuss with AI</button>
        </div>
      </div>
    `;

    // Wire back button
    body.querySelector('.bs-back-btn')?.addEventListener('click', () => {
      BlindspotWindow.populate(body);
    });

    // Wire show in graph buttons
    body.querySelectorAll('.bs-show-graph-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const paperId = btn.dataset.paperId;
        if (paperId) {
          const fn = window._diZoomToNode;
          if (fn) fn(paperId);
        }
      });
    });

    // Wire coverage matrix row clicks
    body.querySelectorAll('.bs-coverage-row[data-field]').forEach(row => {
      row.addEventListener('click', () => {
        BlindspotWindow._highlightFieldInGraph(row.dataset.field);
      });
    });

    // Wire battle landscape card clicks — scroll to corresponding dispute
    body.querySelectorAll('.bs-landscape-card[data-dispute-idx]').forEach(card => {
      card.addEventListener('click', () => {
        const idx = card.dataset.disputeIdx;
        const target = body.querySelector(`.bs-expanded-dispute[data-dispute-idx="${idx}"]`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Brief highlight effect
          target.style.boxShadow = '0 0 0 2px #D4A843';
          setTimeout(() => { target.style.boxShadow = ''; }, 2000);
        }
      });
      // Hover effect
      card.addEventListener('mouseenter', () => { card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'; });
      card.addEventListener('mouseleave', () => { card.style.boxShadow = ''; });
    });

    // Wire discuss button
    body.querySelector('.bs-discuss-btn')?.addEventListener('click', () => {
      const chatPanel = document.querySelector('[data-panel="panel-chat"]');
      if (chatPanel) chatPanel.click();
      const chatInput = document.getElementById('chat-input');
      if (chatInput) {
        chatInput.value = `Tell me about the disputes and blind spots in this research lineage. There are ${stats.contradictions} contradictions and ${stats.blindSpotCount} blind spots. What should a researcher know?`;
        chatInput.focus();
      }
    });

    // Setup missing citations carousel
    if (missingCitations?.length) {
      this._setupMissingCarousel(body, missingCitations);
    }

    // Wire IntelContentRenderer interactions on all content
    if (window.IntelContentRenderer) {
      IntelContentRenderer.wireInteractions(body);
    }

    // Load LLM analyses
    this._loadFullAnalyses(body, result);
  },

  _renderDisputeLandscape(disputes) {
    if (!disputes.length) return '<p style="color:#9CA3AF">No disputes to visualize.</p>';

    // Dot matrix battle cards grid (Idea C + clickable)
    const _esc = BlindspotWindow._esc;
    let cards = '';

    disputes.forEach((d, idx) => {
      const nameA = d.paperA.title.length > 15 ? d.paperA.title.substring(0, 15) + '...' : d.paperA.title;
      const nameB = d.paperB.title.length > 15 ? d.paperB.title.substring(0, 15) + '...' : d.paperB.title;
      const maxCites = Math.max(d.paperA.citations, d.paperB.citations, 1);
      const dotsA = Math.max(1, Math.round((d.paperA.citations / maxCites) * 8));
      const dotsB = Math.max(1, Math.round((d.paperB.citations / maxCites) * 8));

      const statusDot = d.isResolved ? '#22C55E' : '#EF4444';
      const statusLabel = d.isResolved ? 'RESOLVED' : 'ACTIVE';
      const borderColor = d.isResolved ? '#D1D5DB' : '#374151';

      // Dot matrix bar for relative strength
      const dotBarA = Array.from({length: 8}, (_, i) =>
        `<span style="display:inline-block;width:5px;height:5px;border-radius:50%;margin:0 1px;background:${i < dotsA ? '#374151' : '#E5E7EB'};"></span>`
      ).join('');
      const dotBarB = Array.from({length: 8}, (_, i) =>
        `<span style="display:inline-block;width:5px;height:5px;border-radius:50%;margin:0 1px;background:${i < dotsB ? '#374151' : '#E5E7EB'};"></span>`
      ).join('');

      cards += `
        <div class="bs-landscape-card" data-dispute-idx="${idx}" style="
          display:inline-flex;flex-direction:column;gap:4px;
          border:1px solid ${borderColor};border-radius:6px;padding:8px 10px;
          min-width:130px;cursor:pointer;background:white;
          transition:box-shadow 0.2s;vertical-align:top;
        ">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#9CA3AF;font-weight:600;">#${idx + 1}</span>
            <span style="display:inline-flex;align-items:center;gap:3px;font-family:'JetBrains Mono',monospace;font-size:0.55rem;color:${d.isResolved ? '#166534' : '#991B1B'};">
              <span style="width:5px;height:5px;border-radius:50%;background:${statusDot};"></span>
              ${statusLabel}
            </span>
          </div>
          <div style="font-size:0.68rem;color:#374151;font-weight:500;line-height:1.2;">${_esc(nameA)}</div>
          <div style="display:flex;align-items:center;gap:2px;">${dotBarA}</div>
          <div style="font-size:0.6rem;color:#9CA3AF;text-align:center;">vs</div>
          <div style="font-size:0.68rem;color:#374151;font-weight:500;line-height:1.2;">${_esc(nameB)}</div>
          <div style="display:flex;align-items:center;gap:2px;">${dotBarB}</div>
        </div>
      `;
    });

    return `
      <div class="bs-landscape-grid" style="
        display:flex;gap:10px;overflow-x:auto;padding:8px 0 12px;
        scrollbar-width:thin;scrollbar-color:#D1D5DB transparent;
      ">
        ${cards}
      </div>
      <div style="font-size:0.7rem;color:#9CA3AF;margin-top:4px;font-family:'JetBrains Mono',monospace;">
        Click any card to jump to its analysis
      </div>
    `;
  },

  _renderExpandedDispute(d, idx) {
    const maxCites = Math.max(d.paperA.citations, d.paperB.citations, 1);
    const maxLocal = Math.max(d.paperA.localUse, d.paperB.localUse, 1);
    const maxImpact = Math.max(d.paperA.pruneImpact, d.paperB.pruneImpact, 1);
    const maxQuality = Math.max(d.paperA.quality, d.paperB.quality, 1);

    const _esc = BlindspotWindow._esc;
    const statusText = d.isResolved ? `RESOLVED${d.winner ? ' — WINNER: ' + (d.winner === 'A' ? d.paperA.title.substring(0, 25) : d.paperB.title.substring(0, 25)) + '...' : ''}` : 'ACTIVE';
    const statusClass = d.isResolved ? 'bs-status-resolved' : 'bs-status-active';

    const renderCard = (paper) => `
      <div class="bs-battle-paper-full">
        <div class="bs-paper-title">${_esc(paper.title.length > 40 ? paper.title.substring(0, 40) + '...' : paper.title)}</div>
        <div class="bs-paper-meta">${_esc(paper.authors)}${paper.year ? ', ' + paper.year : ''}</div>
        <div class="bs-paper-metrics">
          <div class="bs-metric-row"><span class="bs-metric-label">CITATIONS</span>${BattleBars.render(paper.citations, maxCites, 10)}<span class="bs-metric-value">${paper.citations.toLocaleString()}</span></div>
          <div class="bs-metric-row"><span class="bs-metric-label">LOCAL USE</span>${BattleBars.render(paper.localUse, maxLocal, 10)}<span class="bs-metric-value">${paper.localUse}</span></div>
          <div class="bs-metric-row"><span class="bs-metric-label">PRUNE IMPACT</span>${BattleBars.render(paper.pruneImpact, maxImpact, 10)}<span class="bs-metric-value">${paper.pruneImpact}%</span></div>
          <div class="bs-metric-row"><span class="bs-metric-label">QUALITY</span>${BattleBars.render(paper.quality, maxQuality, 10)}<span class="bs-metric-value">${paper.quality}</span></div>
        </div>
        <button class="bs-show-graph-btn" data-paper-id="${paper.id}" style="margin-top:8px;">Show in graph</button>
      </div>
    `;

    return `
      <div class="bs-expanded-dispute" data-dispute-idx="${idx}" style="margin-bottom:24px;border:1px solid #E5E7EB;border-radius:8px;padding:16px;">
        <div class="bs-battle-status ${statusClass}" style="margin-bottom:12px;">● #${idx + 1} ${statusText}</div>
        <div class="bs-battle-papers" style="display:flex;gap:16px;align-items:flex-start;justify-content:center;flex-wrap:wrap;">
          ${renderCard(d.paperA)}
          <div class="bs-vs-text" style="font-weight:900;font-size:1.5rem;color:#1E293B;align-self:center;">VS</div>
          ${renderCard(d.paperB)}
        </div>
        <div class="bs-dispute-llm" data-dispute-idx="${idx}" style="margin-top:12px;padding:12px;background:#F9FAFB;border-radius:6px;">
          <span style="color:#9CA3AF;font-style:italic;font-size:0.85rem;">Generating analysis...</span>
        </div>
        <div style="text-align:right;margin-top:8px;">
          <button class="bs-discuss-dispute-btn" data-idx="${idx}" style="font-size:0.75rem;color:#3B82F6;background:none;border:none;cursor:pointer;font-family:'JetBrains Mono',monospace;">Discuss this dispute &rarr;</button>
        </div>
      </div>
    `;
  },

  _renderCoverageMatrix(blindSpots) {
    if (!blindSpots.length) return '<p style="color:#9CA3AF">No blind spots to analyze.</p>';

    const allDepths = new Set();
    blindSpots.forEach(s => Object.keys(s.depthSpread).forEach(d => allDepths.add(parseInt(d))));
    const depths = [...allDepths].sort();

    let rows = blindSpots.slice(0, 12).map(spot => {
      const cells = depths.map(d => {
        const count = spot.depthSpread[d] || 0;
        const dots = '●'.repeat(Math.min(count, 4)) + (count > 4 ? '+' : '');
        return `<td style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:#374151;padding:4px 8px;">${dots || '○'}</td>`;
      }).join('');

      const covPct = Math.round(spot.coverage * 100);
      const covDots = Math.max(0, Math.round(spot.coverage * 10));
      const covBar = '<span style="letter-spacing:1px;font-family:JetBrains Mono,monospace;font-size:0.7rem;color:#6B7280;">' + '●'.repeat(covDots) + '○'.repeat(10 - covDots) + '</span>';

      return `<tr class="bs-coverage-row" data-field="${BlindspotWindow._esc(spot.name)}" style="cursor:pointer;">
        <td style="font-size:0.8rem;font-weight:500;padding:4px 8px;color:#374151;">${BlindspotWindow._esc(spot.name)}</td>
        ${cells}
        <td style="padding:4px 8px;">${covBar} <span style="font-size:0.7rem;color:#9CA3AF;">${covPct}%</span></td>
      </tr>`;
    }).join('');

    const headerCells = depths.map(d => `<th style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;color:#9CA3AF;padding:4px 8px;">D${d}</th>`).join('');

    return `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding:4px 8px;font-size:0.75rem;color:#9CA3AF;">Field</th>
              ${headerCells}
              <th style="padding:4px 8px;font-size:0.75rem;color:#9CA3AF;">Coverage</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p style="font-size:0.7rem;color:#9CA3AF;margin-top:6px;">● = papers at depth · Coverage = edges / expected edges · Click row to highlight in graph</p>
    `;
  },

  _renderMissingCitations(pairs) {
    if (!pairs.length) return '';
    const _esc = BlindspotWindow._esc;

    // Horizontal carousel for missing citations (like battles carousel)
    return `
      <div class="bs-missing-carousel" data-current="0" data-total="${Math.min(pairs.length, 20)}">
        <button class="bs-carousel-arrow bs-arrow-left bs-missing-prev" aria-label="Previous">&larr;</button>
        <div class="bs-missing-container"></div>
        <button class="bs-carousel-arrow bs-arrow-right bs-missing-next" aria-label="Next">&rarr;</button>
      </div>
      <div style="text-align:center;margin-top:8px;font-size:0.8rem;color:#9CA3AF;font-family:'JetBrains Mono',monospace;">
        <span class="bs-missing-counter">1 / ${Math.min(pairs.length, 20)}</span>
      </div>
    `;
  },

  _renderMissingCitationCard(p, idx, _esc) {
    const authorsA = Array.isArray(p.paperA.authors) ? p.paperA.authors.join(', ') : (p.paperA.authors || '');
    const authorsB = Array.isArray(p.paperB.authors) ? p.paperB.authors.join(', ') : (p.paperB.authors || '');
    const sharedField = (p.sharedFields || [])[0] || 'Unknown';
    const sharedRefs = p.sharedRefDetails || [];
    const refsOnlyA = p.refsOnlyA || 0;
    const refsOnlyB = p.refsOnlyB || 0;

    // Compute "Would Citing Help?" metrics
    const avgImpact = ((p.paperA.pruning_impact || 0) + (p.paperB.pruning_impact || 0)) / 2;
    const citeDiff = Math.abs((p.paperA.citations || 0) - (p.paperB.citations || 0));
    const impactScore = Math.min(10, Math.round(
      (p.sharedRefCount / 3) * 2 + // more shared refs = higher impact
      (p.yearGap <= 1 ? 3 : 1) + // closer in time = higher impact
      (avgImpact > 5 ? 2 : 0) + // structural importance
      (citeDiff > 10000 ? 1 : 2) // similar citation counts = more meaningful
    ));
    const impactLabel = impactScore >= 7 ? 'HIGH' : impactScore >= 4 ? 'MODERATE' : 'LOW';

    // Render Venn diagram SVG
    const vennSVG = this._renderVennDiagram(refsOnlyA, refsOnlyB, p.sharedRefCount);

    // Render timeline SVG
    const timelineSVG = this._renderTimeline(p.paperA.year, p.paperB.year);

    // Render confidence dot bar
    const confDots = Array.from({length: 10}, (_, i) =>
      `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;margin:0 1px;background:${i < impactScore ? '#374151' : '#E5E7EB'};"></span>`
    ).join('');

    // Shared ref paper names (clickable)
    const sharedRefNames = sharedRefs.map(r =>
      `<span class="icr-paper-link" data-paper-id="${r.id}" style="cursor:pointer;color:#1D4ED8;font-size:0.78rem;">${_esc(r.title.length > 25 ? r.title.substring(0, 25) + '...' : r.title)}</span>`
    ).join(' · ');

    return `
      <div class="bs-missing-investigation" data-pair-idx="${idx}">

        <!-- Header: Investigation # + Classification badge -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <span style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:0.9rem;color:#374151;letter-spacing:0.5px;">INVESTIGATION #${idx + 1}</span>
          <div style="display:flex;gap:12px;align-items:center;">
            <span class="bs-missing-classification" style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;font-weight:600;padding:4px 12px;border-radius:4px;background:#F3F4F6;color:#6B7280;letter-spacing:0.3px;">ANALYZING...</span>
            <span class="bs-missing-confidence" style="font-family:'JetBrains Mono',monospace;font-size:0.65rem;color:#6B7280;display:flex;align-items:center;gap:4px;">
              ${confDots}
            </span>
          </div>
        </div>

        <!-- SUBJECTS: Two paper cards side by side -->
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;font-weight:600;color:#9CA3AF;letter-spacing:1px;margin-bottom:10px;">SUBJECTS</div>
        <div class="icr-subjects" style="display:flex;gap:16px;align-items:center;margin-bottom:20px;">
          <div class="icr-subject-card" style="flex:1;border:1px solid #E5E7EB;border-radius:8px;padding:14px;background:white;">
            <div style="font-family:'JetBrains Mono',monospace;font-weight:600;font-size:0.82rem;color:#1F2937;margin-bottom:6px;">${_esc(p.paperA.title.length > 50 ? p.paperA.title.substring(0, 50) + '...' : p.paperA.title)}</div>
            <div style="font-size:0.75rem;color:#6B7280;">${_esc(authorsA)} · ${p.paperA.year}</div>
            <div style="font-size:0.75rem;color:#6B7280;">${(p.paperA.citations || 0).toLocaleString()} cites</div>
          </div>
          <div style="font-family:'JetBrains Mono',monospace;color:#EF4444;font-size:0.75rem;font-weight:600;white-space:nowrap;">↛ no citation<br>edge</div>
          <div class="icr-subject-card" style="flex:1;border:1px solid #E5E7EB;border-radius:8px;padding:14px;background:white;">
            <div style="font-family:'JetBrains Mono',monospace;font-weight:600;font-size:0.82rem;color:#1F2937;margin-bottom:6px;">${_esc(p.paperB.title.length > 50 ? p.paperB.title.substring(0, 50) + '...' : p.paperB.title)}</div>
            <div style="font-size:0.75rem;color:#6B7280;">${_esc(authorsB)} · ${p.paperB.year}</div>
            <div style="font-size:0.75rem;color:#6B7280;">${(p.paperB.citations || 0).toLocaleString()} cites</div>
          </div>
        </div>

        <!-- Context line -->
        <div style="text-align:center;font-size:0.78rem;color:#6B7280;margin-bottom:20px;">
          Same field: ${_esc(sharedField)} · ${p.yearGap} year${p.yearGap !== 1 ? 's' : ''} apart · ${p.sharedRefCount} shared references
        </div>

        <!-- SHARED DNA: Venn diagram -->
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;font-weight:600;color:#9CA3AF;letter-spacing:1px;margin-bottom:10px;">SHARED DNA</div>
        <div style="border:1px solid #E5E7EB;border-radius:8px;padding:16px;background:#FAFAFA;margin-bottom:20px;">
          <div style="display:flex;justify-content:center;margin-bottom:12px;">
            ${vennSVG}
          </div>
          <div style="text-align:center;font-size:0.78rem;color:#374151;">
            ${p.sharedRefCount} shared: ${sharedRefNames || '<span style="color:#9CA3AF;">computing...</span>'}
          </div>
          <div style="text-align:center;margin-top:8px;">
            <button class="icr-show-shared-ancestry" data-refs='${JSON.stringify(sharedRefs.map(r => r.id))}' style="font-family:'JetBrains Mono',monospace;font-size:0.72rem;color:#1D4ED8;background:none;border:none;cursor:pointer;">[Show shared ancestry in graph →]</button>
          </div>
        </div>

        <!-- TIMELINE -->
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;font-weight:600;color:#9CA3AF;letter-spacing:1px;margin-bottom:10px;">TIMELINE</div>
        <div style="border:1px solid #E5E7EB;border-radius:8px;padding:16px;background:#FAFAFA;margin-bottom:20px;">
          ${timelineSVG}
        </div>

        <!-- THE ANALYSIS (LLM loaded async) -->
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;font-weight:600;color:#9CA3AF;letter-spacing:1px;margin-bottom:10px;">THE ANALYSIS</div>
        <div class="bs-missing-llm" data-pair-idx="${idx}" style="margin-bottom:20px;min-height:60px;">
          <span style="color:#9CA3AF;font-style:italic;font-size:0.82rem;">Loading analysis...</span>
        </div>

        <!-- WOULD CITING HELP? -->
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;font-weight:600;color:#9CA3AF;letter-spacing:1px;margin-bottom:10px;">WOULD CITING HELP?</div>
        <div style="border:1px solid #FDE68A;border-radius:8px;padding:16px;background:#FFFBEB;margin-bottom:20px;">
          <div style="font-size:0.82rem;color:#374151;margin-bottom:10px;">
            If <strong>${_esc(p.paperB.title.length > 30 ? p.paperB.title.substring(0, 30) + '...' : p.paperB.title)}</strong> cited <strong>${_esc(p.paperA.title.length > 30 ? p.paperA.title.substring(0, 30) + '...' : p.paperA.title)}</strong>:
          </div>
          <ul style="font-size:0.78rem;color:#374151;margin:0;padding-left:18px;list-style:disc;">
            <li>Creates 1 new meaningful edge in this lineage</li>
            <li>Strengthens the ${_esc(sharedField)} cluster connectivity</li>
            <li>${p.sharedRefCount} shared references become a recognized pathway</li>
            ${avgImpact > 5 ? `<li>Both papers have structural importance (combined ${Math.round(avgImpact)}% impact)</li>` : ''}
          </ul>
          <div style="margin-top:10px;font-family:'JetBrains Mono',monospace;font-size:0.75rem;display:flex;align-items:center;gap:8px;">
            Impact: ${confDots} <span style="font-weight:600;color:${impactScore >= 7 ? '#166534' : impactScore >= 4 ? '#92400E' : '#6B7280'}">${impactLabel}</span>
          </div>
        </div>

        <!-- CONNECT THE DOTS -->
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;font-weight:600;color:#9CA3AF;letter-spacing:1px;margin-bottom:10px;">CONNECT THE DOTS</div>
        <div style="border:1px solid #E5E7EB;border-radius:8px;padding:16px;background:#F9FAFB;margin-bottom:20px;">
          <div style="font-size:0.82rem;color:#374151;margin-bottom:8px;">If these papers were connected:</div>
          <ul style="font-size:0.78rem;color:#374151;margin:0;padding-left:18px;list-style:disc;">
            <li>Edge type: <strong style="font-family:'JetBrains Mono',monospace;">METHODOLOGICAL_PARALLEL</strong></li>
            <li>Estimated confidence: <strong>${impactScore >= 7 ? 'HIGH' : 'MEDIUM'}</strong></li>
            <li>${p.sharedRefCount >= 5 ? 'Would bridge two dense reference clusters' : 'Would create a local connection within the ' + _esc(sharedField) + ' cluster'}</li>
            <li>Reduces missing citation count by 1</li>
          </ul>
          <div style="margin-top:10px;">
            <button class="icr-simulate-connection" data-id-a="${p.paperA.id}" data-id-b="${p.paperB.id}" style="font-family:'JetBrains Mono',monospace;font-size:0.72rem;color:#1D4ED8;background:none;border:none;cursor:pointer;">[Simulate this connection in graph →]</button>
          </div>
        </div>

        <!-- Action buttons -->
        <div style="display:flex;gap:16px;margin-top:16px;padding-top:16px;border-top:1px solid #E5E7EB;">
          <button class="icr-show-both" data-id-a="${p.paperA.id}" data-id-b="${p.paperB.id}" style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;padding:8px 14px;border:1px solid #D1D5DB;border-radius:6px;background:white;cursor:pointer;">Show both in graph →</button>
          <button class="icr-discuss-btn" data-context="Tell me about why ${_esc(p.paperA.title.substring(0, 30))} and ${_esc(p.paperB.title.substring(0, 30))} don't cite each other despite being in the same field and sharing ${p.sharedRefCount} references." style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:#1D4ED8;background:none;border:none;cursor:pointer;text-decoration:underline;">Discuss this case →</button>
        </div>
      </div>
    `;
  },

  // ── Venn Diagram SVG for shared references ──────────────────────────────

  _renderVennDiagram(onlyA, onlyB, shared) {
    const w = 200, h = 100;
    const cx1 = 70, cx2 = 130, cy = 50, r = 45;
    return `
      <svg viewBox="0 0 ${w} ${h}" width="200" height="100" style="display:block;margin:0 auto;">
        <!-- Circle A (left) -->
        <circle cx="${cx1}" cy="${cy}" r="${r}" fill="none" stroke="#94A3B8" stroke-width="1.5" stroke-dasharray="3,3" />
        <!-- Circle B (right) -->
        <circle cx="${cx2}" cy="${cy}" r="${r}" fill="none" stroke="#94A3B8" stroke-width="1.5" stroke-dasharray="3,3" />
        <!-- Overlap region highlight -->
        <clipPath id="venn-clip-a-${onlyA}-${shared}"><circle cx="${cx1}" cy="${cy}" r="${r}" /></clipPath>
        <circle cx="${cx2}" cy="${cy}" r="${r}" fill="#E5E7EB" opacity="0.4" clip-path="url(#venn-clip-a-${onlyA}-${shared})" />
        <!-- Labels -->
        <text x="${cx1 - 18}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="#374151" font-family="JetBrains Mono, monospace">${onlyA}</text>
        <text x="${cx1 - 18}" y="${cy + 16}" text-anchor="middle" font-size="7" fill="#6B7280" font-family="JetBrains Mono, monospace">only</text>
        <text x="${(cx1 + cx2) / 2}" y="${cy + 4}" text-anchor="middle" font-size="13" font-weight="700" fill="#1F2937" font-family="JetBrains Mono, monospace">${shared}</text>
        <text x="${(cx1 + cx2) / 2}" y="${cy + 16}" text-anchor="middle" font-size="7" fill="#6B7280" font-family="JetBrains Mono, monospace">shared</text>
        <text x="${cx2 + 18}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="#374151" font-family="JetBrains Mono, monospace">${onlyB}</text>
        <text x="${cx2 + 18}" y="${cy + 16}" text-anchor="middle" font-size="7" fill="#6B7280" font-family="JetBrains Mono, monospace">only</text>
        <!-- Paper labels at top -->
        <text x="${cx1 - 10}" y="12" text-anchor="middle" font-size="7" fill="#9CA3AF" font-family="JetBrains Mono, monospace">Paper A refs</text>
        <text x="${cx2 + 10}" y="12" text-anchor="middle" font-size="7" fill="#9CA3AF" font-family="JetBrains Mono, monospace">Paper B refs</text>
      </svg>
    `;
  },

  // ── Timeline SVG for publication overlap ──────────────────────────────

  _renderTimeline(yearA, yearB) {
    if (!yearA || !yearB) return '<div style="color:#9CA3AF;font-size:0.78rem;text-align:center;">Timeline data unavailable</div>';

    const minYear = Math.min(yearA, yearB) - 1;
    const maxYear = Math.max(yearA, yearB) + 2;
    const w = 360, h = 80;
    const pad = 30;
    const axisY = 55;

    const yearToX = (y) => pad + ((y - minYear) / (maxYear - minYear)) * (w - pad * 2);

    const xA1 = yearToX(yearA - 0.5); // estimated submission
    const xA2 = yearToX(yearA);
    const xB1 = yearToX(yearB - 0.5);
    const xB2 = yearToX(yearB);

    // Overlap region
    const overlapStart = Math.max(xA1, xB1);
    const overlapEnd = Math.min(xA2, xB2);
    const hasOverlap = overlapStart < overlapEnd;

    let overlapRect = '';
    if (hasOverlap) {
      overlapRect = `<rect x="${overlapStart}" y="18" width="${overlapEnd - overlapStart}" height="38" fill="#FDE68A" opacity="0.3" rx="3" />
        <text x="${(overlapStart + overlapEnd) / 2}" y="72" text-anchor="middle" font-size="6" fill="#92400E" font-family="JetBrains Mono, monospace">overlap window</text>`;
    }

    // Year markers on axis
    let yearMarkers = '';
    for (let y = Math.ceil(minYear); y <= Math.floor(maxYear); y++) {
      const x = yearToX(y);
      yearMarkers += `
        <line x1="${x}" y1="${axisY - 3}" x2="${x}" y2="${axisY + 3}" stroke="#D1D5DB" stroke-width="1" />
        <text x="${x}" y="${axisY + 14}" text-anchor="middle" font-size="7" fill="#9CA3AF" font-family="JetBrains Mono, monospace">${y}</text>
      `;
    }

    return `
      <svg viewBox="0 0 ${w} ${h}" width="100%" height="80" style="display:block;">
        <!-- Axis -->
        <line x1="${pad}" y1="${axisY}" x2="${w - pad}" y2="${axisY}" stroke="#D1D5DB" stroke-width="1" />
        ${yearMarkers}

        <!-- Overlap highlight -->
        ${overlapRect}

        <!-- Paper A timeline bar -->
        <line x1="${xA1}" y1="28" x2="${xA2}" y2="28" stroke="#374151" stroke-width="3" stroke-linecap="round" />
        <circle cx="${xA1}" cy="28" r="3" fill="#374151" />
        <circle cx="${xA2}" cy="28" r="3" fill="#374151" />
        <text x="${xA1}" y="22" font-size="6.5" fill="#374151" font-family="JetBrains Mono, monospace">A submitted</text>

        <!-- Paper B timeline bar -->
        <line x1="${xB1}" y1="42" x2="${xB2}" y2="42" stroke="#6B7280" stroke-width="3" stroke-linecap="round" />
        <circle cx="${xB1}" cy="42" r="3" fill="#6B7280" />
        <circle cx="${xB2}" cy="42" r="3" fill="#6B7280" />
        <text x="${xB1}" y="50" font-size="6.5" fill="#6B7280" font-family="JetBrains Mono, monospace">B submitted</text>
      </svg>
    `;
  },

  _setupMissingCarousel(body, pairs) {
    const carousel = body.querySelector('.bs-missing-carousel');
    if (!carousel || !pairs.length) return;

    const container = carousel.querySelector('.bs-missing-container');
    const counter = body.querySelector('.bs-missing-counter');
    const prevBtn = carousel.querySelector('.bs-missing-prev');
    const nextBtn = carousel.querySelector('.bs-missing-next');
    const _esc = BlindspotWindow._esc;
    const maxPairs = Math.min(pairs.length, 20);

    // Render first card
    container.innerHTML = this._renderMissingCitationCard(pairs[0], 0, _esc);

    if (maxPairs <= 1) {
      if (prevBtn) prevBtn.style.visibility = 'hidden';
      if (nextBtn) nextBtn.style.visibility = 'hidden';
    }

    const navigate = (dir) => {
      let cur = parseInt(carousel.dataset.current || '0', 10);
      cur = (cur + dir + maxPairs) % maxPairs;
      carousel.dataset.current = cur;
      container.innerHTML = this._renderMissingCitationCard(pairs[cur], cur, _esc);
      if (counter) counter.textContent = `${cur + 1} / ${maxPairs}`;

      // Wire ALL interactions on the new card
      this._wireMissingCardInteractions(container);

      // Load LLM analysis for this card
      this._loadMissingCitationAnalysis(container, pairs[cur], cur);
    };

    prevBtn?.addEventListener('click', () => navigate(-1));
    nextBtn?.addEventListener('click', () => navigate(1));

    // Load analysis for the first card
    this._loadMissingCitationAnalysis(container, pairs[0], 0);

    // Wire interactions on first card
    this._wireMissingCardInteractions(container);
  },

  // Unified interaction wiring for missing citation cards
  _wireMissingCardInteractions(container) {
    const ICR = window.IntelContentRenderer;

    // Show both in graph
    container.querySelectorAll('.icr-show-both').forEach(btn => {
      btn.addEventListener('click', () => {
        const idA = btn.dataset.idA;
        const idB = btn.dataset.idB;
        if (idA && idB && ICR) ICR._highlightPair(idA, idB);
      });
    });

    // Discuss this case
    container.querySelectorAll('.icr-discuss-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (ICR) ICR._openDiscuss(btn.dataset.context || '');
      });
    });

    // Simulate connection (draw temporary dashed edge between two papers)
    container.querySelectorAll('.icr-simulate-connection').forEach(btn => {
      btn.addEventListener('click', () => {
        const idA = btn.dataset.idA;
        const idB = btn.dataset.idB;
        if (!idA || !idB) return;

        const modeLabel = document.getElementById('mode-label');
        const isTree = modeLabel?.textContent?.toLowerCase()?.includes('tree');

        if (isTree && window._treeLayout?.svg) {
          // Find both nodes in tree and draw a dashed line between them
          const svg = window._treeLayout.svg;
          let posA = null, posB = null;
          window._treeLayout.treeRoot?.each(d => {
            if (d.data?.id === idA) { const a = d.x - Math.PI/2; posA = { x: d.y * Math.cos(a), y: d.y * Math.sin(a) }; }
            if (d.data?.id === idB) { const a = d.x - Math.PI/2; posB = { x: d.y * Math.cos(a), y: d.y * Math.sin(a) }; }
          });
          if (posA && posB) {
            const g = svg.select('g');
            const line = g.append('line')
              .attr('x1', posA.x).attr('y1', posA.y)
              .attr('x2', posB.x).attr('y2', posB.y)
              .attr('stroke', '#D4A843').attr('stroke-width', 2)
              .attr('stroke-dasharray', '6,4').attr('opacity', 0)
              .transition().duration(500).attr('opacity', 0.8);
            setTimeout(() => { g.selectAll('line[stroke="#D4A843"]').transition().duration(500).attr('opacity', 0).remove(); }, 4000);
          }
        } else if (window._arivuGraph?.svg) {
          const g = window._arivuGraph;
          const simNodes = g.simulation?.nodes();
          const nodeA = simNodes?.find(n => n.id === idA);
          const nodeB = simNodes?.find(n => n.id === idB);
          if (nodeA && nodeB && g.zoomGroup) {
            const line = g.zoomGroup.append('line')
              .attr('x1', nodeA.x).attr('y1', nodeA.y)
              .attr('x2', nodeB.x).attr('y2', nodeB.y)
              .attr('stroke', '#D4A843').attr('stroke-width', 2)
              .attr('stroke-dasharray', '6,4').attr('opacity', 0)
              .transition().duration(500).attr('opacity', 0.8);
            setTimeout(() => { g.zoomGroup.selectAll('line[stroke="#D4A843"]').transition().duration(500).attr('opacity', 0).remove(); }, 4000);
          }
        }
      });
    });

    // Show shared ancestry (highlight multiple papers)
    container.querySelectorAll('.icr-show-shared-ancestry').forEach(btn => {
      btn.addEventListener('click', () => {
        try {
          const refIds = JSON.parse(btn.dataset.refs || '[]');
          if (!refIds.length) return;

          const modeLabel = document.getElementById('mode-label');
          const isTree = modeLabel?.textContent?.toLowerCase()?.includes('tree');

          if (isTree && window._treeLayout?.svg) {
            const svg = window._treeLayout.svg;
            svg.selectAll('.tree-node').style('opacity', 0.1);
            refIds.forEach(id => {
              svg.select(`.tree-node[data-id="${id}"]`).style('opacity', 1)
                .select('rect').transition().duration(300).attr('stroke', '#D4A843').attr('stroke-width', 2);
            });
            setTimeout(() => {
              svg.selectAll('.tree-node').style('opacity', null);
              svg.selectAll('.tree-node rect').attr('stroke', null).attr('stroke-width', null);
            }, 4000);
          } else if (window._arivuGraph?.svg) {
            const g = window._arivuGraph;
            g.svg.selectAll('.node-group').style('opacity', 0.1);
            refIds.forEach(id => {
              g.svg.select(`.node-group[data-id="${id}"]`).style('opacity', 1);
            });
            setTimeout(() => { g.svg.selectAll('.node-group').style('opacity', null); }, 4000);
          }
        } catch (e) { console.warn('Show shared ancestry failed:', e); }
      });
    });

    // Paper name links (click to zoom)
    container.querySelectorAll('.icr-paper-link').forEach(link => {
      link.addEventListener('click', () => {
        const paperId = link.dataset.paperId;
        if (paperId && window.DeepIntel?._zoomToNode) {
          window.DeepIntel._zoomToNode(paperId);
        } else if (paperId && window._zoomToNode) {
          window._zoomToNode(paperId);
        }
      });
    });

    // Wire IntelContentRenderer interactions on LLM content
    if (ICR) ICR.wireInteractions(container);
  },

  _loadMissingCitationAnalysis(container, pair, idx) {
    const el = container.querySelector(`.bs-missing-llm[data-pair-idx="${idx}"]`);
    if (!el) return;

    const graphId = window._graphLoader?._graphData?.metadata?.graph_id;
    if (!graphId) return;

    const authorsA = Array.isArray(pair.paperA.authors) ? pair.paperA.authors.join(', ') : (pair.paperA.authors || '');
    const authorsB = Array.isArray(pair.paperB.authors) ? pair.paperB.authors.join(', ') : (pair.paperB.authors || '');

    // Use global intel queue to prevent pool exhaustion
    const url = `/api/graph/${encodeURIComponent(graphId)}/intel`;
    const body = {
      section: 'missing_citation',
      cache_key: `missing_${idx}`,
      data: {
        pair: {
          paperA: { title: pair.paperA.title, year: pair.paperA.year, authors: authorsA, citations: pair.paperA.citations || pair.paperA.citation_count || 0 },
          paperB: { title: pair.paperB.title, year: pair.paperB.year, authors: authorsB, citations: pair.paperB.citations || pair.paperB.citation_count || 0 },
          sharedField: (pair.sharedFields || [])[0] || '',
          yearGap: pair.yearGap,
          sharedRefCount: pair.sharedRefCount,
        },
      },
    };
    _intelQueue.enqueue(url, body)
      .then(data => {
        if (data?.blocks?.length && window.IntelContentRenderer) {
          el.innerHTML = IntelContentRenderer.render(data.blocks);
          IntelContentRenderer.wireInteractions(el);
        } else {
          el.innerHTML = '<span style="color:#9CA3AF;font-size:0.82rem;">Analysis unavailable</span>';
        }

        // Update classification badge with actual classification from LLM
        const classEl = container.querySelector('.bs-missing-classification');
        if (classEl && data?.blocks) {
          const classBlock = data.blocks.find(b => b.type === 'classification');
          if (classBlock) {
            const classColors = {
              'INDEPENDENT_DISCOVERY': { bg: '#DCFCE7', color: '#166534', label: 'INDEPENDENT DISCOVERY' },
              'CITATION_OVERSIGHT':    { bg: '#FEF3C7', color: '#92400E', label: 'CITATION OVERSIGHT' },
              'METHODOLOGICAL_PARALLEL': { bg: '#DBEAFE', color: '#1E40AF', label: 'METHODOLOGICAL PARALLEL' },
              'DELIBERATE_OMISSION':   { bg: '#FEE2E2', color: '#991B1B', label: 'DELIBERATE OMISSION' },
              'TEMPORAL_GAP':          { bg: '#F3F4F6', color: '#4B5563', label: 'TEMPORAL GAP' },
            };
            const cls = classColors[classBlock.value] || classColors['TEMPORAL_GAP'];
            classEl.textContent = cls.label;
            classEl.style.background = cls.bg;
            classEl.style.color = cls.color;

            // Update confidence dots too
            const confEl = container.querySelector('.bs-missing-confidence');
            if (confEl) {
              const conf = Math.round((classBlock.confidence || 0.5) * 10);
              const confLabel = conf >= 7 ? 'HIGH' : conf >= 4 ? 'MODERATE' : 'LOW';
              confEl.innerHTML = Array.from({length: 10}, (_, i) =>
                `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;margin:0 1px;background:${i < conf ? '#374151' : '#E5E7EB'};"></span>`
              ).join('') + ` <span style="font-weight:600;margin-left:4px;">${confLabel}</span>`;
            }
          }
        }
      })
      .catch(() => {
        el.innerHTML = '<span style="color:#9CA3AF;font-size:0.82rem;">Analysis unavailable</span>';
      });
  },

  _loadFullAnalyses(body, result) {
    const graphId = window._graphLoader?._graphData?.metadata?.graph_id;
    if (!graphId) return;
    const ICR = window.IntelContentRenderer;

    // SERIALIZED queue: send one request at a time to avoid exhausting DB pool
    const queue = [];

    // 1. Battle overview
    const overviewEl = body.querySelector('.bs-overview-llm');
    if (overviewEl) {
      queue.push({
        el: overviewEl,
        body: {
          section: 'battle_overview',
          cache_key: 'battle_overview',
          data: {
            stats: result.stats,
            topDisputes: result.disputes.slice(0, 5).map(d => ({
              paperA: d.paperA.title, paperB: d.paperB.title, isResolved: d.isResolved,
            })),
          },
        },
        fallback: `<div class="icr-prose">This lineage has ${result.stats.contradictions} contradictions with ${result.stats.activeDisputes} still active.</div>`,
      });
    }

    // 2. Load ALL dispute analyses (serialized through global queue)
    result.disputes.forEach((d, idx) => {
      const disputeEl = body.querySelector(`.bs-dispute-llm[data-dispute-idx="${idx}"]`);
      if (disputeEl) {
        queue.push({
          el: disputeEl,
          body: {
            section: 'dispute_analysis',
            cache_key: `dispute_${idx}`,
            data: { paperA: d.paperA, paperB: d.paperB, isResolved: d.isResolved, winner: d.winner },
          },
        });
      }
    });

    // 3. Deep blind spot analysis
    const deepEl = body.querySelector('.bs-blindspot-deep-llm');
    if (deepEl) {
      queue.push({
        el: deepEl,
        body: {
          section: 'deep_blindspot',
          cache_key: 'deep_blindspot',
          data: {
            fields: result.blindSpots.slice(0, 8).map(s => ({
              name: s.name, paperCount: s.paperCount, coverage: s.coverage,
            })),
          },
        },
      });
    }

    // Process queue sequentially via global intel queue (prevents pool exhaustion)
    const processQueue = async () => {
      const url = `/api/graph/${encodeURIComponent(graphId)}/intel`;
      for (const item of queue) {
        try {
          const data = await _intelQueue.enqueue(url, item.body);
          if (data?.blocks?.length && ICR) {
            item.el.innerHTML = ICR.render(data.blocks);
            ICR.wireInteractions(item.el);
          } else if (item.fallback) {
            item.el.innerHTML = item.fallback;
          }
        } catch {
          if (item.fallback) item.el.innerHTML = item.fallback;
        }
      }
    };
    processQueue();

  },

  // (Removed dead _setupDisputeCarousel and _loadMissingCitationAnalysis_dispute - all disputes now loaded via serialized queue in _loadFullAnalyses)
};


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 7 — EXPORTS
   ═══════════════════════════════════════════════════════════════════════════ */

window.BlindspotAnalyzer = BlindspotAnalyzer;
window.BlindspotPanel = BlindspotPanel;
window.BlindspotWindow = BlindspotWindow;
window.BlindspotFullAnalysis = BlindspotFullAnalysis;
window.DotMatrixEye = DotMatrixEye;
window.BattleBars = BattleBars;

// Make _zoomToNode accessible globally for battle cards
// _zoomToNode is declared at file scope in deep-intelligence.js and is implicitly on window
// in non-module scripts. This ensures it's explicitly available.
if (!window._diZoomToNode) {
  window._diZoomToNode = function(nodeId) {
    if (window._zoomToNode) window._zoomToNode(nodeId);
    else if (typeof _zoomToNode === 'function') _zoomToNode(nodeId);
  };
}
