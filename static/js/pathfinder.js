/**
 * pathfinder.js — Research Position Finder
 *
 * The Pathfinder is Arivu's research positioning tool. It combines a dot matrix
 * character companion with a structured analysis engine. The user describes their
 * research and receives multi-section analysis showing where they fit.
 *
 * Architecture:
 * - PathfinderSystem: main controller (singleton)
 * - ChainRenderer: SVG dot chain between researcher and output windows
 * - EnergyManager: tracks LLM call budget per session
 * - InstantAnswerEngine: client-side pattern matching for Tier 0 answers
 * - PromptHistory: manages prompt list, persistence, switching
 * - BlockRenderer: maps LLM response blocks to visual components
 *
 * Dependencies:
 * - window-manager.js (window creation/management)
 * - researcher-character.js (character poses + API)
 * - researcher-sprites.js (sprite data)
 * - deep-intelligence.js (dot switcher, _zoomToNode)
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1 — INSTANT ANSWER ENGINE (Tier 0, no LLM, no energy)
// ═══════════════════════════════════════════════════════════════════════════

const InstantAnswerEngine = {

  /**
   * Check if a prompt can be answered instantly from graph data.
   * Returns { tier, blocks, characterLine } or null if LLM needed.
   */
  tryAnswer(prompt, graphData) {
    if (!graphData?.nodes?.length) return null;
    const p = prompt.trim().toLowerCase();
    const nodes = graphData.nodes;
    const edges = graphData.edges || [];

    // --- Stat patterns (Tier 0 bubble answers) ---

    if (/how many.*(papers|nodes|node|paper)/i.test(p) || /total.*(papers|nodes)/i.test(p) || /number of.*(papers|nodes)/i.test(p) || /count.*(papers|nodes)/i.test(p)) {
      return { tier: 0, value: String(nodes.length), label: 'papers in this lineage', characterLine: String(nodes.length) + '!' };
    }
    if (/how many.*(edges|connections|links|edge|connection)/i.test(p) || /total.*(edges|connections)/i.test(p)) {
      return { tier: 0, value: String(edges.length), label: 'connections', characterLine: String(edges.length) + ' connections!' };
    }
    if (/how many.*(contradictions|disputes|contradiction|dispute)/i.test(p) || /count.*(contradictions|disputes)/i.test(p)) {
      const count = edges.filter(e => e.mutation_type === 'contradiction').length;
      return { tier: 0, value: String(count), label: 'contradictions', characterLine: count + ' contradictions!' };
    }
    if (/how many.*(clusters|groups|cluster|group)/i.test(p) || /total.*(clusters)/i.test(p)) {
      const clusters = graphData.dna_profile?.clusters?.length || 0;
      return { tier: 0, value: String(clusters), label: 'DNA clusters', characterLine: clusters + ' clusters!' };
    }
    if (/how many.*(authors|researchers|author|researcher)/i.test(p) || /total.*(authors)/i.test(p)) {
      const authors = new Set();
      nodes.forEach(n => (n.authors || []).forEach(a => authors.add(a)));
      return { tier: 0, value: String(authors.size), label: 'unique authors', characterLine: authors.size + ' researchers!' };
    }
    if (/how many.*(fields|disciplines|field)/i.test(p) || /total.*(fields)/i.test(p)) {
      const fields = new Set();
      nodes.forEach(n => (n.fields_of_study || []).forEach(f => fields.add(f)));
      return { tier: 0, value: String(fields.size), label: 'research fields', characterLine: fields.size + ' fields!' };
    }

    // --- Paper lookups (Tier 1 mini window) ---

    if (/most cited (paper|work)/i.test(p)) {
      const top = [...nodes].sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0))[0];
      if (top) return { tier: 1, blocks: [{ type: 'paper_card', paper: top }], characterLine: top.title.substring(0, 30) + '...' };
    }
    if (/oldest (paper|work)/i.test(p)) {
      const old = [...nodes].filter(n => n.year).sort((a, b) => a.year - b.year)[0];
      if (old) return { tier: 1, blocks: [{ type: 'paper_card', paper: old }], characterLine: 'From ' + old.year + '!' };
    }
    if (/newest|latest|most recent/i.test(p)) {
      const newest = [...nodes].filter(n => n.year).sort((a, b) => b.year - a.year)[0];
      if (newest) return { tier: 1, blocks: [{ type: 'paper_card', paper: newest }], characterLine: 'From ' + newest.year + '!' };
    }
    if (/seed paper/i.test(p)) {
      const seed = nodes.find(n => n.is_seed);
      if (seed) return { tier: 1, blocks: [{ type: 'paper_card', paper: seed }], characterLine: "That's the seed paper!" };
    }
    if (/most cited author/i.test(p)) {
      const authorMap = {};
      nodes.forEach(n => (n.authors || []).forEach(a => {
        if (!authorMap[a]) authorMap[a] = { name: a, papers: 0, totalCites: 0 };
        authorMap[a].papers++;
        authorMap[a].totalCites += (n.citation_count || 0);
      }));
      const topAuthor = Object.values(authorMap).sort((a, b) => b.totalCites - a.totalCites)[0];
      if (topAuthor) {
        return { tier: 1, blocks: [{ type: 'stat_card', label: 'Most Cited Author', value: topAuthor.name, detail: topAuthor.papers + ' papers, ' + topAuthor.totalCites.toLocaleString() + ' total citations' }], characterLine: topAuthor.name + '!' };
      }
    }

    // --- Exact paper title match ---
    const titleMatch = nodes.find(n => n.title && n.title.toLowerCase() === p);
    if (titleMatch) {
      return { tier: 1, blocks: [{ type: 'paper_card', paper: titleMatch }], characterLine: "Found it!" };
    }

    // --- Partial paper title match (>80% of query words appear in a title) ---
    const queryWords = p.split(/\s+/).filter(w => w.length > 3);
    if (queryWords.length >= 2) {
      const bestMatch = nodes.reduce((best, n) => {
        if (!n.title) return best;
        const titleLower = n.title.toLowerCase();
        const matchCount = queryWords.filter(w => titleLower.includes(w)).length;
        const ratio = matchCount / queryWords.length;
        return ratio > (best?.ratio || 0) ? { node: n, ratio } : best;
      }, null);
      if (bestMatch && bestMatch.ratio >= 0.8) {
        return { tier: 1, blocks: [{ type: 'paper_card', paper: bestMatch.node }], characterLine: "Found a match!" };
      }
    }

    // --- DOI match ---
    const doiMatch = p.match(/10\.\d{4,}\/\S+/);
    if (doiMatch) {
      const found = nodes.find(n => n.doi && n.doi.toLowerCase() === doiMatch[0].toLowerCase());
      if (found) return { tier: 1, blocks: [{ type: 'paper_card', paper: found }], characterLine: "Found it by DOI!" };
      return { tier: 0, value: 'Not found', label: 'That DOI is not in this lineage', characterLine: "That paper isn't in this lineage." };
    }

    // --- Year match ---
    const yearMatch = p.match(/^(19|20)\d{2}$/);
    if (yearMatch) {
      const year = parseInt(yearMatch[0]);
      const yearPapers = nodes.filter(n => n.year === year);
      return { tier: 1, blocks: [{ type: 'stat_card', label: 'Papers in ' + year, value: String(yearPapers.length), detail: yearPapers.length > 0 ? 'Top: ' + yearPapers.sort((a,b) => (b.citation_count||0) - (a.citation_count||0))[0]?.title?.substring(0, 40) + '...' : 'No papers published this year' }], characterLine: yearPapers.length + ' papers from ' + year + '!' };
    }

    // --- Author name match ---
    const allAuthors = new Map();
    nodes.forEach(n => (n.authors || []).forEach(a => {
      const key = a.toLowerCase();
      if (!allAuthors.has(key)) allAuthors.set(key, { name: a, papers: [], totalCites: 0 });
      allAuthors.get(key).papers.push(n);
      allAuthors.get(key).totalCites += (n.citation_count || 0);
    }));
    for (const [key, data] of allAuthors) {
      if (p === key || p === data.name.toLowerCase()) {
        return { tier: 1, blocks: [{ type: 'author_card', author: data }], characterLine: data.name + '! ' + data.papers.length + ' papers.' };
      }
    }

    // --- Field name match ---
    const fieldCounts = {};
    nodes.forEach(n => (n.fields_of_study || []).forEach(f => {
      fieldCounts[f] = (fieldCounts[f] || 0) + 1;
    }));
    for (const [field, count] of Object.entries(fieldCounts)) {
      if (p === field.toLowerCase()) {
        return { tier: 1, blocks: [{ type: 'field_card', field: field, count: count }], characterLine: field + ': ' + count + ' papers!' };
      }
    }

    // --- Mutation type match ---
    const mutTypes = ['adoption', 'generalization', 'specialization', 'hybridization', 'contradiction', 'revival', 'incidental'];
    for (const mt of mutTypes) {
      if (p.includes(mt)) {
        const count = edges.filter(e => e.mutation_type === mt).length;
        if (count > 0) {
          return { tier: 0, value: String(count), label: mt + ' edges', characterLine: count + ' ' + mt + ' connections!' };
        }
      }
    }

    // No instant answer found
    return null;
  },

  /**
   * Check if input should be rejected client-side (no API call).
   * Returns { rejected: true, characterLine, characterPose } or null.
   */
  checkRejection(prompt) {
    const p = prompt.trim();

    if (!p) return { rejected: true, silent: true }; // empty, do nothing

    if (p.length === 1 && /[^a-zA-Z0-9]/.test(p)) {
      return { rejected: true, characterLine: "What's the question?", characterPose: 'confused' };
    }

    if (/^[^a-zA-Z0-9]+$/.test(p)) {
      return { rejected: true, characterLine: "I need words, not symbols.", characterPose: 'confused' };
    }

    // Gibberish detection: no real English words (at least 2 words with 3+ chars)
    const words = p.split(/\s+/).filter(w => /^[a-zA-Z]{3,}$/.test(w));
    if (p.length > 5 && words.length < 1) {
      return { rejected: true, characterLine: "I couldn't parse that. Try a research question.", characterPose: 'confused' };
    }

    // Social/polite responses
    if (/^(thanks|thank you|ok|okay|cool|nice|great|good|bye|goodbye|cheers)$/i.test(p)) {
      return { rejected: true, characterLine: "Anytime! Need anything else?", characterPose: 'waving' };
    }

    // "More" with no context
    if (/^(more|continue|go on)$/i.test(p)) {
      return { rejected: true, characterLine: "More of what? Tell me what you're curious about.", characterPose: 'confused', needsContext: true };
    }

    // Code detection
    if (/\b(import |def |function |class |const |let |var |return |if \(|for \(|console\.|print\()\b/.test(p)) {
      return { rejected: true, characterLine: "That looks like code, not a research question.", characterPose: 'confused' };
    }

    // Just a number
    if (/^\d+$/.test(p)) {
      return { rejected: true, characterLine: p + ' what? Papers? Citations? The meaning of life?', characterPose: 'confused' };
    }

    // Very long text: trim and allow (not a rejection, but a transformation)
    // This is handled in submit(), not here

    return null; // not rejected
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2 — ENERGY MANAGER
// ═══════════════════════════════════════════════════════════════════════════

class EnergyManager {
  constructor(maxEnergy = 30) {
    this.max = maxEnergy;
    this.key = 'arivu_pathfinder_energy';
    this._load();
  }

  _load() {
    try {
      const stored = sessionStorage.getItem(this.key);
      if (stored) {
        const data = JSON.parse(stored);
        this.used = data.used || 0;
      } else {
        this.used = 0;
      }
    } catch { this.used = 0; }
  }

  _save() {
    try {
      sessionStorage.setItem(this.key, JSON.stringify({ used: this.used, max: this.max }));
    } catch {}
  }

  get remaining() { return Math.max(0, this.max - this.used); }
  get depleted() { return this.used >= this.max; }
  get level() {
    const r = this.remaining;
    if (r > 20) return 'full';
    if (r > 10) return 'good';
    if (r > 5) return 'moderate';
    if (r > 0) return 'low';
    return 'empty';
  }

  consume(cost = 1) {
    this.used += cost;
    this._save();
    return this.remaining;
  }

  reset() {
    this.used = 0;
    this._save();
  }

  /** Get max_tokens for Groq based on energy level */
  getMaxTokens() {
    const level = this.level;
    if (level === 'full') return 1200;
    if (level === 'good') return 1000;
    if (level === 'moderate') return 600;
    if (level === 'low') return 400;
    return 0;
  }

  /** Render the energy counter as HTML */
  renderCounter() {
    const total = this.max;
    const used = this.used;
    const remaining = this.remaining;
    const dotsToShow = Math.min(10, total);
    const filledDots = Math.round((remaining / total) * dotsToShow);

    let dots = '';
    for (let i = 0; i < dotsToShow; i++) {
      const filled = i < filledDots;
      dots += `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${filled ? '#374151' : '#E5E7EB'};margin:0 1px;"></span>`;
    }

    return `<span class="pf-energy-counter" style="font:600 11px 'JetBrains Mono',monospace;color:#6B7280;">${dots} ${used}/${total}</span>`;
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3 — CHAIN RENDERER (SVG dot chain between windows)
// ═══════════════════════════════════════════════════════════════════════════

class ChainRenderer {
  constructor(container) {
    this.container = container; // .tool-layout-v2
    this.svg = null;
    this.dots = [];
    this.sourceWindow = null;
    this.targetWindow = null;
    this.connected = false;
    this.broken = false;
    this.animationFrame = null;
    this.DOT_SPACING = 20;
    this.DOT_RADIUS = 4;
    this.BREAK_DISTANCE = 600;
    this.RECONNECT_DISTANCE = 400;
    this.DIM_COLOR = '#D1D5DB';
    this.LIT_COLOR = '#374151';
  }

  /** Create the SVG overlay */
  _ensureSVG() {
    if (this.svg) return;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'pf-chain-svg');
    this.svg.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:1200;overflow:visible;';
    document.body.appendChild(this.svg);
  }

  /** Calculate closest edge points between two rects */
  _closestEdgePoints(srcRect, tgtRect) {
    const srcCx = srcRect.left + srcRect.width / 2;
    const srcCy = srcRect.top + srcRect.height / 2;
    const tgtCx = tgtRect.left + tgtRect.width / 2;
    const tgtCy = tgtRect.top + tgtRect.height / 2;

    // Determine which edges face each other
    const dx = tgtCx - srcCx;
    const dy = tgtCy - srcCy;

    let srcPoint, tgtPoint;

    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal arrangement
      if (dx > 0) {
        srcPoint = { x: srcRect.right, y: srcCy };
        tgtPoint = { x: tgtRect.left, y: tgtCy };
      } else {
        srcPoint = { x: srcRect.left, y: srcCy };
        tgtPoint = { x: tgtRect.right, y: tgtCy };
      }
    } else {
      // Vertical arrangement
      if (dy > 0) {
        srcPoint = { x: srcCx, y: srcRect.bottom };
        tgtPoint = { x: tgtCx, y: tgtRect.top };
      } else {
        srcPoint = { x: srcCx, y: srcRect.top };
        tgtPoint = { x: tgtCx, y: tgtRect.bottom };
      }
    }

    // Using position:fixed SVG, viewport coordinates are correct as-is
    return { srcPoint, tgtPoint };
  }

  /** Redraw chain dots between current window positions */
  redraw() {
    if (!this.sourceWindow || !this.targetWindow || !this.svg) return;
    if (this.broken) return;

    const srcRect = this.sourceWindow.getBoundingClientRect();
    const tgtRect = this.targetWindow.getBoundingClientRect();
    const { srcPoint, tgtPoint } = this._closestEdgePoints(srcRect, tgtRect);

    const dx = tgtPoint.x - srcPoint.x;
    const dy = tgtPoint.y - srcPoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Performance check: if redraw takes too long, simplify to CSS line
    const redrawStart = performance.now();

    // Track distance for mid-dissolve reconnect
    this._lastDistance = distance;

    // Strain warning at 400px
    if (distance > 400 && !this._strainWarned) {
      this._strainWarned = true;
      const pf = window.PathfinderSystem;
      if (pf) pf._characterSay("Careful with that...", 'worried');
    } else if (distance <= 400) {
      this._strainWarned = false;
    }

    // Check for break
    if (distance > this.BREAK_DISTANCE && this.connected) {
      this._break();
      return;
    }

    // Calculate dot positions
    const numDots = Math.max(3, Math.floor(distance / this.DOT_SPACING));

    // Adjust existing dots or create new ones
    while (this.dots.length < numDots) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', this.DOT_RADIUS);
      circle.setAttribute('fill', this.DIM_COLOR);
      this.svg.appendChild(circle);
      this.dots.push(circle);
    }
    while (this.dots.length > numDots) {
      const removed = this.dots.pop();
      removed.remove();
    }

    // Position dots
    for (let i = 0; i < numDots; i++) {
      const t = (i + 1) / (numDots + 1);
      const x = srcPoint.x + dx * t;
      const y = srcPoint.y + dy * t;
      this.dots[i].setAttribute('cx', x);
      this.dots[i].setAttribute('cy', y);

      // Strain effect: dots get smaller/dimmer as distance increases (400-600px)
      if (distance > 400) {
        const strain = Math.min(1, (distance - 400) / 200);
        const r = this.DOT_RADIUS * (1 - strain * 0.5); // 4 → 2
        const opacity = 1 - strain * 0.7; // 1.0 → 0.3
        this.dots[i].setAttribute('r', r);
        this.dots[i].setAttribute('opacity', opacity);
      } else {
        this.dots[i].setAttribute('r', this.DOT_RADIUS);
        this.dots[i].setAttribute('opacity', 1);
      }
    }

    // Performance check: if redraw consistently takes >20ms, simplify chain
    const redrawTime = performance.now() - redrawStart;
    if (redrawTime > 20) {
      this._slowFrames = (this._slowFrames || 0) + 1;
      if (this._slowFrames > 5 && !this._simplified) {
        // Simplify: hide individual dots, show a single CSS line instead
        this._simplified = true;
        this.dots.forEach(d => d.style.display = 'none');
        if (!this._simpleLine) {
          this._simpleLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          this._simpleLine.setAttribute('stroke', '#D1D5DB');
          this._simpleLine.setAttribute('stroke-width', '2');
          this._simpleLine.setAttribute('stroke-dasharray', '4 4');
          this.svg.appendChild(this._simpleLine);
        }
        const srcRect2 = this.sourceWindow.getBoundingClientRect();
        const tgtRect2 = this.targetWindow.getBoundingClientRect();
        const { srcPoint: sp, tgtPoint: tp } = this._closestEdgePoints(srcRect2, tgtRect2);
        this._simpleLine.setAttribute('x1', sp.x);
        this._simpleLine.setAttribute('y1', sp.y);
        this._simpleLine.setAttribute('x2', tp.x);
        this._simpleLine.setAttribute('y2', tp.y);
      }
    } else {
      this._slowFrames = Math.max(0, (this._slowFrames || 0) - 1);
      // If performance recovered, switch back to dots
      if (this._simplified && this._slowFrames === 0) {
        this._simplified = false;
        this.dots.forEach(d => d.style.display = '');
        if (this._simpleLine) { this._simpleLine.remove(); this._simpleLine = null; }
      }
    }
  }

  /** Animate chain formation (dots appear one by one) */
  async formChain(sourceWindow, targetWindow, onComplete) {
    this._ensureSVG();
    this.sourceWindow = sourceWindow;
    this.targetWindow = targetWindow;
    this.connected = false;
    this.broken = false;

    // Clear existing dots
    this.dots.forEach(d => d.remove());
    this.dots = [];

    const srcRect = sourceWindow.getBoundingClientRect();
    const tgtRect = targetWindow.getBoundingClientRect();
    const { srcPoint, tgtPoint } = this._closestEdgePoints(srcRect, tgtRect);

    const dx = tgtPoint.x - srcPoint.x;
    const dy = tgtPoint.y - srcPoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const numDots = Math.max(3, Math.floor(distance / this.DOT_SPACING));

    // Form dots one by one
    for (let i = 0; i < numDots; i++) {
      const t = (i + 1) / (numDots + 1);
      const x = srcPoint.x + dx * t;
      const y = srcPoint.y + dy * t;

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', this.DOT_RADIUS);
      circle.setAttribute('fill', this.DIM_COLOR);
      circle.style.opacity = '0';
      this.svg.appendChild(circle);
      this.dots.push(circle);

      // Appear animation
      requestAnimationFrame(() => { circle.style.transition = 'opacity 0.15s'; circle.style.opacity = '1'; });

      // Light up the dot 2 positions behind
      if (i >= 2) {
        this.dots[i - 2].setAttribute('fill', this.LIT_COLOR);
      }

      await new Promise(r => setTimeout(r, 60));
    }

    // Light up remaining dots
    for (let i = Math.max(0, numDots - 2); i < numDots; i++) {
      this.dots[i].setAttribute('fill', this.LIT_COLOR);
      await new Promise(r => setTimeout(r, 60));
    }

    // All lit briefly, then dim
    await new Promise(r => setTimeout(r, 200));
    this.dots.forEach(d => d.setAttribute('fill', this.DIM_COLOR));

    this.connected = true;
    if (onComplete) onComplete();
  }

  /** Pulse animation (data transfer) */
  async pulse(speed = 50, loop = false) {
    if (!this.connected || this.broken) return;

    do {
      for (let i = 0; i < this.dots.length; i++) {
        if (!this.connected || this.broken) return;
        this.dots[i].setAttribute('fill', this.LIT_COLOR);
        if (i > 0) this.dots[i - 1].setAttribute('fill', this.DIM_COLOR);
        await new Promise(r => setTimeout(r, speed));
      }
      // Dim the last dot
      if (this.dots.length > 0) {
        this.dots[this.dots.length - 1].setAttribute('fill', this.DIM_COLOR);
      }
    } while (loop && this.connected && !this.broken);
  }

  /** Flash all dots simultaneously (for Tier 0 instant answers) */
  async flash() {
    if (!this.connected || !this.dots.length) return;
    this.dots.forEach(d => d.setAttribute('fill', this.LIT_COLOR));
    await new Promise(r => setTimeout(r, 200));
    this.dots.forEach(d => d.setAttribute('fill', this.DIM_COLOR));
  }

  /** Break the chain (supports mid-dissolve reconnect via _dissolving flag) */
  async _break() {
    this.broken = true;
    this._dissolving = true;

    // Dissolve from midpoint outward
    const mid = Math.floor(this.dots.length / 2);
    const distance = this._lastDistance || 600;
    const speed = Math.max(15, 30 - Math.floor((distance - 600) / 20));

    for (let offset = 0; offset <= mid; offset++) {
      if (!this._dissolving) break; // Mid-dissolve reconnect interrupted
      const left = mid - offset;
      const right = mid + offset;
      if (left >= 0 && left < this.dots.length) {
        this.dots[left].style.display = 'none';
      }
      if (right >= 0 && right < this.dots.length) {
        this.dots[right].style.display = 'none';
      }
      await new Promise(r => setTimeout(r, speed));
    }

    if (this._dissolving) {
      // Full break completed (not interrupted)
      this._dissolving = false;
      this.connected = false;
      // Clean up dots
      this.dots.forEach(d => d.remove());
      this.dots = [];
      // Notify the Pathfinder system
      window.dispatchEvent(new CustomEvent('pathfinder:chain-broken'));
    }
    // If !this._dissolving, reconnect happened mid-dissolve — dots re-shown by tracking handler
  }

  /** Destroy the chain completely */
  destroy() {
    this.connected = false;
    this.broken = true;
    this.dots.forEach(d => d.remove());
    this.dots = [];
    if (this.svg) { this.svg.remove(); this.svg = null; }
  }

  /** Start tracking window drags for chain redraw */
  startTracking() {
    this._dragHandler = () => {
      if (this.connected && !this.broken) {
        requestAnimationFrame(() => this.redraw());
      } else if (this.broken && this.sourceWindow && this.targetWindow) {
        // Check for reconnect (including mid-dissolve)
        const srcRect = this.sourceWindow.getBoundingClientRect();
        const tgtRect = this.targetWindow.getBoundingClientRect();
        const { srcPoint, tgtPoint } = this._closestEdgePoints(srcRect, tgtRect);
        const distance = Math.sqrt((tgtPoint.x - srcPoint.x) ** 2 + (tgtPoint.y - srcPoint.y) ** 2);
        if (distance < this.RECONNECT_DISTANCE) {
          // Mid-dissolve reconnect: cancel dissolve if still in progress
          if (this._dissolving) {
            this._dissolving = false;
            // Re-show dots that are still in the DOM
            this.dots.forEach(d => { d.style.display = ''; d.style.opacity = '1'; });
            this.broken = false;
            this.connected = true;
            this.pulse(30);
            window.dispatchEvent(new CustomEvent('pathfinder:chain-reconnected'));
          } else {
            // Full reconnect after complete break
            this.broken = false;
            this.formChain(this.sourceWindow, this.targetWindow, () => {
              window.dispatchEvent(new CustomEvent('pathfinder:chain-reconnected'));
            });
          }
        }
      }
    };
    // Listen for window drag events (dispatched by WindowManager during drag)
    if (this.sourceWindow) this.sourceWindow.addEventListener('arivu:window-drag', this._dragHandler);
    if (this.targetWindow) this.targetWindow.addEventListener('arivu:window-drag', this._dragHandler);
  }

  stopTracking() {
    if (this._dragHandler) {
      this.sourceWindow?.removeEventListener('arivu:window-drag', this._dragHandler);
      this.targetWindow?.removeEventListener('arivu:window-drag', this._dragHandler);
    }
  }

  /** Fade dots out sequentially (for output window close) */
  async sequentialFade(speed = 40) {
    for (const dot of this.dots) {
      dot.style.transition = `opacity ${speed}ms`;
      dot.style.opacity = '0';
      await new Promise(r => setTimeout(r, speed));
    }
    this.connected = false;
  }

  /** Set error state (red tint on dots for network errors) */
  setErrorState(isError) {
    this.dots.forEach(dot => {
      dot.setAttribute('fill', isError ? '#EF4444' : this.DIM_COLOR);
      dot.style.opacity = isError ? '0.6' : '1';
    });
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4 — BLOCK RENDERER (maps LLM response blocks to HTML)
// ═══════════════════════════════════════════════════════════════════════════

const BlockRenderer = {

  /** Render an array of blocks into HTML */
  render(blocks, graphNodes) {
    if (!blocks || !Array.isArray(blocks)) return '<p style="color:#9CA3AF">No content available.</p>';
    return blocks.map(b => this._renderBlock(b, graphNodes)).join('');
  },

  _renderBlock(block, graphNodes) {
    switch (block.type) {
      case 'prose': return this._prose(block);
      case 'heading': return this._heading(block);
      case 'takeaway': return this._takeaway(block);
      case 'opportunity': return this._opportunity(block);
      case 'caveat': return this._caveat(block);
      case 'stat_card': return this._statCard(block);
      case 'paper_card': return this._paperCard(block);
      case 'author_card': return this._authorCard(block);
      case 'field_card': return this._fieldCard(block);
      case 'paper_list': return this._paperList(block);
      case 'evidence_trail': return this._evidenceTrail(block);
      case 'comparison': return this._comparison(block);
      case 'match_bar': return this._matchBar(block);
      case 'metric_row': return this._metricRow(block);
      case 'position_map': return this._positionMap(block);
      case 'reading_chain': return this._readingChain(block);
      case 'stat_grid': return this._statGrid(block);
      case 'dot_bar': return this._dotBar(block);
      case 'confidence_dots': return this._confidenceDots(block);
      case 'show_me': return this._showMe(block);
      case 'trace_path': return this._tracePath(block);
      case 'suggestion_chips': return this._suggestionChips(block);
      case 'discuss_link': return this._discussLink(block);
      case 'position_section': return this._positionSection(block, graphNodes);
      case 'landscape_section': return this._landscapeSection(block, graphNodes);
      case 'roadmap_section': return this._roadmapSection(block, graphNodes);
      case 'citation_section': return this._citationSection(block, graphNodes);
      default: return `<p style="color:#9CA3AF">[Unknown block type: ${block.type}]</p>`;
    }
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; },

  _linkifyPapers(text, graphNodes) {
    if (!text) return '';
    const escaped = this._esc(text);
    return escaped.replace(/\[([^\]]+)\]/g, (match, name) => {
      const nodes = graphNodes || window._graphLoader?._graphData?.nodes || [];
      const node = nodes.find(n => n.title && n.title.toLowerCase().includes(name.toLowerCase()));
      if (node) {
        return `<a class="pf-paper-link" data-id="${node.id}" style="color:#374151;font-weight:600;text-decoration:underline;cursor:pointer;">${name}</a>`;
      }
      return name;
    });
  },

  // --- Text blocks ---

  _prose(b) {
    return `<p class="pf-prose" style="margin:8px 0;font:14px/1.6 'Inter',sans-serif;color:#374151;">${this._linkifyPapers(b.text)}</p>`;
  },

  _heading(b) {
    return `<h4 class="pf-heading" style="margin:20px 0 8px;font:600 11px/1 'JetBrains Mono',monospace;letter-spacing:0.12em;color:#6B7280;text-transform:uppercase;border-bottom:1px solid #E5E7EB;padding-bottom:6px;">${this._esc(b.text)}</h4>`;
  },

  _takeaway(b) {
    return `<div class="pf-takeaway" style="margin:12px 0;padding:12px 16px;background:#FEF9C3;border:1px solid #F59E0B;border-radius:8px;">
      <p style="margin:0 0 4px;font:600 10px/1 'JetBrains Mono',monospace;letter-spacing:0.1em;color:#92400E;">TAKEAWAY</p>
      <p style="margin:0;font:14px/1.5 'Inter',sans-serif;color:#374151;">${this._linkifyPapers(b.text)}</p>
    </div>`;
  },

  _opportunity(b) {
    return `<div class="pf-opportunity" style="margin:12px 0;padding:12px 16px;background:#FFFBEB;border:1px solid #D4A843;border-radius:8px;">
      <p style="margin:0 0 4px;font:600 10px/1 'JetBrains Mono',monospace;letter-spacing:0.1em;color:#92400E;">* OPPORTUNITY</p>
      <p style="margin:0;font:14px/1.5 'Inter',sans-serif;color:#374151;">${this._linkifyPapers(b.text)}</p>
    </div>`;
  },

  _caveat(b) {
    return `<div class="pf-caveat" style="margin:12px 0;padding:12px 16px;background:#FFF7ED;border:1px solid #F97316;border-radius:8px;">
      <p style="margin:0 0 4px;font:600 10px/1 'JetBrains Mono',monospace;letter-spacing:0.1em;color:#9A3412;">! NOTE</p>
      <p style="margin:0;font:14px/1.5 'Inter',sans-serif;color:#374151;">${this._linkifyPapers(b.text)}</p>
    </div>`;
  },

  // --- Data blocks ---

  _statCard(b) {
    return `<div class="pf-stat-card" style="display:inline-block;padding:16px 24px;border:1px solid #E5E7EB;border-radius:10px;text-align:center;margin:8px 8px 8px 0;">
      <p style="margin:0;font:700 28px/1 'JetBrains Mono',monospace;color:#374151;">${this._esc(b.value)}</p>
      <p style="margin:4px 0 0;font:600 10px/1 'JetBrains Mono',monospace;letter-spacing:0.1em;color:#6B7280;text-transform:uppercase;">${this._esc(b.label)}</p>
      ${b.detail ? `<p style="margin:4px 0 0;font:12px/1.4 'Inter',sans-serif;color:#9CA3AF;">${this._esc(b.detail)}</p>` : ''}
    </div>`;
  },

  _paperCard(b) {
    const p = b.paper || {};
    const authors = Array.isArray(p.authors) ? p.authors.join(', ') : (p.authors || '');
    return `<div class="pf-paper-card" style="padding:14px 16px;border:1px solid #E5E7EB;border-radius:8px;margin:8px 0;">
      <p style="margin:0;font:600 14px/1.3 'JetBrains Mono',monospace;color:#374151;">${this._esc(p.title)}</p>
      <p style="margin:4px 0;font:12px/1.4 'Inter',sans-serif;color:#6B7280;">${this._esc(authors)}${p.year ? ' · ' + p.year : ''}</p>
      <p style="margin:2px 0 0;font:12px/1.4 'Inter',sans-serif;color:#9CA3AF;">${(p.citation_count || 0).toLocaleString()} citations${p.depth !== undefined ? ' · depth ' + p.depth : ''}</p>
      ${p.id ? `<button class="pf-action-btn" data-action="zoom" data-paper-id="${p.id}" style="margin-top:8px;padding:4px 10px;border:1px solid #D1D5DB;border-radius:4px;background:transparent;font:11px 'JetBrains Mono',monospace;cursor:pointer;color:#374151;">Show in graph →</button>` : ''}
    </div>`;
  },

  _authorCard(b) {
    const a = b.author || {};
    return `<div class="pf-author-card" style="padding:14px 16px;border:1px solid #E5E7EB;border-radius:8px;margin:8px 0;">
      <p style="margin:0;font:600 14px/1.3 'JetBrains Mono',monospace;color:#374151;">${this._esc(a.name)}</p>
      <p style="margin:4px 0;font:12px/1.4 'Inter',sans-serif;color:#6B7280;">${a.papers?.length || 0} papers · ${(a.totalCites || 0).toLocaleString()} total citations</p>
    </div>`;
  },

  _fieldCard(b) {
    return `<div class="pf-field-card" style="padding:14px 16px;border:1px solid #E5E7EB;border-radius:8px;margin:8px 0;">
      <p style="margin:0;font:600 14px/1.3 'JetBrains Mono',monospace;color:#374151;">${this._esc(b.field)}</p>
      <p style="margin:4px 0;font:12px/1.4 'Inter',sans-serif;color:#6B7280;">${b.count || 0} papers in this lineage</p>
    </div>`;
  },

  _paperList(b) {
    const papers = b.papers || [];
    let html = '<div class="pf-paper-list" style="margin:8px 0;">';
    papers.forEach((p, i) => {
      const title = typeof p === 'string' ? p : (p.title || 'Unknown');
      const year = typeof p === 'object' ? p.year : '';
      const cites = typeof p === 'object' ? (p.citation_count || 0).toLocaleString() : '';
      const id = typeof p === 'object' ? p.id : '';
      html += `<div style="padding:8px 0;border-bottom:1px solid #F3F4F6;display:flex;align-items:baseline;gap:8px;">
        <span style="font:600 12px 'JetBrains Mono',monospace;color:#9CA3AF;">${i + 1}.</span>
        <div>
          <span class="pf-paper-link" ${id ? `data-id="${id}"` : ''} style="font:13px/1.4 'Inter',sans-serif;color:#374151;${id ? 'cursor:pointer;text-decoration:underline;' : ''}">${this._esc(title)}</span>
          ${year || cites ? `<span style="font:11px 'Inter',sans-serif;color:#9CA3AF;margin-left:6px;">${year}${year && cites ? ' · ' : ''}${cites ? cites + ' cites' : ''}</span>` : ''}
        </div>
      </div>`;
    });
    html += '</div>';
    return html;
  },

  _evidenceTrail(b) {
    const items = b.items || [];
    const label = b.label || `${items.length} items`;
    return `<div class="pf-evidence-trail" style="margin:8px 0;">
      <button class="pf-expand-btn" style="font:12px 'JetBrains Mono',monospace;color:#374151;background:none;border:none;cursor:pointer;padding:0;text-decoration:underline;">${this._esc(label)} ▾</button>
      <div class="pf-expand-content" style="display:none;padding:8px 0 8px 12px;border-left:2px solid #E5E7EB;margin-top:6px;">
        ${items.map(item => `<p style="margin:4px 0;font:13px/1.4 'Inter',sans-serif;color:#374151;">${this._linkifyPapers(typeof item === 'string' ? item : item.text || JSON.stringify(item))}</p>`).join('')}
      </div>
    </div>`;
  },

  // --- Comparison blocks ---

  _comparison(b) {
    const renderSide = (side) => {
      if (!side) return '';
      let html = `<div style="flex:1;padding:14px;border:1px solid #E5E7EB;border-radius:8px;">`;
      html += `<p style="margin:0;font:600 13px/1.3 'JetBrains Mono',monospace;color:#374151;">${this._esc(side.title)}</p>`;
      if (side.authors) html += `<p style="margin:4px 0;font:11px 'Inter',sans-serif;color:#9CA3AF;">${this._esc(side.authors)}${side.year ? ', ' + side.year : ''}</p>`;
      if (side.metrics) {
        side.metrics.forEach(m => {
          html += this._metricRow(m);
        });
      }
      if (side.paperId) {
        html += `<button class="pf-action-btn" data-action="zoom" data-paper-id="${side.paperId}" style="margin-top:8px;padding:4px 10px;border:1px solid #D1D5DB;border-radius:4px;background:transparent;font:11px 'JetBrains Mono',monospace;cursor:pointer;">Show in graph →</button>`;
      }
      html += '</div>';
      return html;
    };

    return `<div style="display:flex;gap:16px;align-items:stretch;margin:12px 0;">
      ${renderSide(b.left)}
      <div style="display:flex;align-items:center;font:700 24px 'JetBrains Mono',monospace;color:#374151;padding:0 8px;">VS</div>
      ${renderSide(b.right)}
    </div>`;
  },

  _matchBar(b) {
    const pct = Math.min(100, Math.max(0, b.value || 0));
    const filled = Math.round(pct / 5); // 20 dots total
    let dots = '';
    for (let i = 0; i < 20; i++) {
      dots += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${i < filled ? '#374151' : '#E5E7EB'};margin:0 1px;"></span>`;
    }
    return `<div style="margin:4px 0;"><span style="font:11px 'JetBrains Mono',monospace;color:#6B7280;">${this._esc(b.label || '')}</span> ${dots} <span style="font:11px 'JetBrains Mono',monospace;color:#374151;">${pct}%</span></div>`;
  },

  _metricRow(b) {
    const maxVal = b.maxValue || b.value || 1;
    const pct = Math.min(100, Math.round((b.value / maxVal) * 100));
    const filled = Math.round(pct / 10); // 10 dots
    let dots = '';
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 10; i++) {
        dots += `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${i < filled ? '#374151' : '#E5E7EB'};margin:0 1px;"></span>`;
      }
      if (row === 0) dots += '<br>';
    }
    const display = b.display || (b.suffix ? b.value + b.suffix : b.value?.toLocaleString?.() || b.value);
    return `<div style="margin:6px 0;">
      <span style="font:600 10px 'JetBrains Mono',monospace;letter-spacing:0.08em;color:#6B7280;text-transform:uppercase;display:inline-block;width:100px;">${this._esc(b.label || '')}</span>
      <span style="display:inline-block;vertical-align:middle;">${dots}</span>
      <span style="font:11px 'JetBrains Mono',monospace;color:#374151;margin-left:6px;">${display}</span>
    </div>`;
  },

  // --- Visualization blocks ---

  _positionMap(b) {
    const clusters = b.clusters || [];
    const userCluster = b.userCluster || '';
    const seedCluster = b.seedCluster || '';

    if (!clusters.length) {
      return `<div style="padding:20px;border:1px solid #E5E7EB;border-radius:8px;margin:12px 0;text-align:center;">
        <p style="font:600 10px 'JetBrains Mono',monospace;letter-spacing:0.1em;color:#6B7280;margin:0 0 12px;">POSITION MAP</p>
        <p style="font:13px 'Inter',sans-serif;color:#374151;">Your position: <strong>${this._esc(userCluster)}</strong></p>
      </div>`;
    }

    // SVG scatter with dot matrix dots for each cluster
    const W = 360, H = 240, PAD = 40, dotR = 3;
    const cx = W / 2, cy = H / 2;

    // Position clusters in a radial layout around center
    let svgDots = '';
    let svgLabels = '';
    let svgLines = '';
    const positions = [];

    clusters.forEach((c, i) => {
      const angle = (i / clusters.length) * Math.PI * 2 - Math.PI / 2;
      const dist = 70 + (c.paperCount ? Math.min(c.paperCount, 50) : 20);
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      positions.push({ x, y, name: c.name, count: c.paperCount || 0 });

      const isUser = c.name === userCluster;
      const isSeed = c.name === seedCluster;
      const r = Math.max(6, Math.min(16, 6 + (c.paperCount || 0) / 10));

      // Dot matrix cluster dot (concentric circles of small dots)
      const rings = Math.max(1, Math.ceil(r / 4));
      for (let ring = 0; ring <= rings; ring++) {
        const ringR = ring * 4;
        const ringDots = ring === 0 ? 1 : Math.max(4, ring * 6);
        for (let d = 0; d < ringDots; d++) {
          const a = (d / ringDots) * Math.PI * 2;
          const dx = x + Math.cos(a) * ringR;
          const dy = y + Math.sin(a) * ringR;
          const fill = isUser ? '#D4A843' : isSeed ? '#374151' : '#9CA3AF';
          svgDots += `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="${dotR}" fill="${fill}" opacity="${isUser ? 1 : 0.7}" class="pf-map-dot" data-cluster="${this._esc(c.name)}" style="cursor:pointer"/>`;
        }
      }

      // Label
      const labelY = y + r + 14;
      svgLabels += `<text x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" fill="${isUser ? '#D4A843' : '#6B7280'}" font-size="9" font-family="JetBrains Mono,monospace" font-weight="${isUser ? '700' : '400'}">${this._esc(c.name?.substring(0, 12) || '')}</text>`;

      if (isUser) {
        svgLabels += `<text x="${x.toFixed(1)}" y="${(labelY + 11).toFixed(1)}" text-anchor="middle" fill="#D4A843" font-size="8" font-family="JetBrains Mono,monospace">YOU</text>`;
      }
      if (isSeed) {
        svgDots += `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" fill="white" font-size="10" font-family="JetBrains Mono,monospace">★</text>`;
      }
    });

    // Lines from seed to each cluster (dotted)
    const seedPos = positions.find(p => p.name === seedCluster) || { x: cx, y: cy };
    positions.forEach(p => {
      if (p.name === seedCluster) return;
      // Dotted line as series of small dots
      const dist = Math.sqrt((p.x - seedPos.x) ** 2 + (p.y - seedPos.y) ** 2);
      const numDots = Math.max(3, Math.floor(dist / 8));
      for (let i = 1; i < numDots; i++) {
        const t = i / numDots;
        const lx = seedPos.x + (p.x - seedPos.x) * t;
        const ly = seedPos.y + (p.y - seedPos.y) * t;
        svgLines += `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="1.2" fill="#E5E7EB"/>`;
      }
    });

    return `<div class="pf-position-map" style="padding:12px;border:1px solid #E5E7EB;border-radius:8px;margin:12px 0;">
      <p style="font:600 10px 'JetBrains Mono',monospace;letter-spacing:0.1em;color:#6B7280;margin:0 0 8px;">POSITION MAP</p>
      <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;max-width:${W}px;margin:0 auto;">
        ${svgLines}
        ${svgDots}
        ${svgLabels}
      </svg>
      <p style="font:10px 'JetBrains Mono',monospace;color:#9CA3AF;margin:8px 0 0;text-align:center;">★ seed paper · <span style="color:#D4A843;">●</span> your position · ○ clusters · Click to highlight</p>
    </div>`;
  },

  _readingChain(b) {
    const papers = b.papers || [];
    if (!papers.length) return '';

    const symbols = { 'seed': '★', 'impact': '◆', 'rival': '▲', 'root': '○', 'alt': '◇' };
    const W = Math.max(300, papers.length * 60 + 40);
    const H = 60;
    const startX = 30, endX = W - 30;
    const y = 24;
    const dotR = 8;
    const spacing = papers.length > 1 ? (endX - startX) / (papers.length - 1) : 0;

    let svgContent = '';

    // Connection line (dotted)
    if (papers.length > 1) {
      const lineY = y;
      for (let x = startX; x <= endX; x += 5) {
        svgContent += `<circle cx="${x}" cy="${lineY}" r="1.2" fill="#D1D5DB"/>`;
      }
    }

    // Paper dots (dot matrix circles)
    papers.forEach((p, i) => {
      const x = startX + i * spacing;
      const paperId = typeof p === 'string' ? '' : (p.id || '');
      const title = typeof p === 'string' ? p : (p.title || '');
      const role = typeof p === 'string' ? '' : (p.role || '');
      const sym = typeof p === 'string' ? '●' : (symbols[p.symbol] || symbols[role] || '●');

      // Dot matrix circle (concentric rings)
      for (let ring = 0; ring <= 2; ring++) {
        const ringR = ring * 3;
        const ringDots = ring === 0 ? 1 : ring * 6;
        for (let d = 0; d < ringDots; d++) {
          const a = (d / ringDots) * Math.PI * 2;
          const dx = x + Math.cos(a) * ringR;
          const dy = y + Math.sin(a) * ringR;
          svgContent += `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="2" fill="#374151" class="pf-chain-node" data-index="${i}" data-paper-id="${this._esc(paperId)}" style="cursor:pointer"/>`;
        }
      }

      // Symbol overlay
      svgContent += `<text x="${x}" y="${y + 4}" text-anchor="middle" fill="white" font-size="9" font-family="JetBrains Mono,monospace" pointer-events="none">${sym}</text>`;

      // Number label below
      svgContent += `<text x="${x}" y="${H - 4}" text-anchor="middle" fill="#9CA3AF" font-size="9" font-family="JetBrains Mono,monospace">${i + 1}</text>`;
    });

    return `<div class="pf-reading-chain" style="padding:12px;border:1px solid #E5E7EB;border-radius:8px;margin:12px 0;">
      <p style="font:600 10px 'JetBrains Mono',monospace;letter-spacing:0.1em;color:#6B7280;margin:0 0 8px;">READING PATH</p>
      <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;max-width:${W}px;margin:0 auto;">
        ${svgContent}
      </svg>
      <p style="font:10px 'JetBrains Mono',monospace;color:#9CA3AF;margin:8px 0 0;text-align:center;">Click any dot to see details below</p>
    </div>`;
  },

  _statGrid(b) {
    const stats = b.cards || b.stats || [];
    return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">
      ${stats.map(s => this._statCard(s)).join('')}
    </div>`;
  },

  _dotBar(b) {
    return this._matchBar(b);
  },

  _confidenceDots(b) {
    const level = Math.min(10, Math.max(0, Math.round((b.value || 0) * 10)));
    let dots = '';
    for (let i = 0; i < 10; i++) {
      dots += `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${i < level ? '#374151' : '#E5E7EB'};margin:0 1px;"></span>`;
    }
    return `<span style="font:11px 'JetBrains Mono',monospace;color:#6B7280;">${dots} ${this._esc(b.label || '')}</span>`;
  },

  // --- Interactive blocks ---

  _showMe(b) {
    const action = this._esc(b.action || 'zoom');
    const paperId = this._esc(b.paperId || '');
    const paperIds = b.paperIds ? b.paperIds.map(id => this._esc(id)).join(',') : '';
    return `<button class="pf-action-btn" data-action="${action}" ${paperId ? `data-paper-id="${paperId}"` : ''} ${paperIds ? `data-paper-ids="${paperIds}"` : ''} style="margin:6px 4px 6px 0;padding:5px 12px;border:1px solid #D1D5DB;border-radius:4px;background:transparent;font:11px 'JetBrains Mono',monospace;cursor:pointer;color:#374151;">${this._esc(b.label || 'Show in graph →')}</button>`;
  },

  _tracePath(b) {
    return this._showMe({ ...b, action: 'trace', label: b.label || 'Trace path →' });
  },

  _suggestionChips(b) {
    const suggestions = b.suggestions || [];
    return `<div class="pf-suggestions" style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;">
      ${suggestions.map(s => `<button class="pf-chip" data-fill="${this._esc(s)}" style="padding:6px 14px;border:1px solid #D1D5DB;border-radius:16px;background:transparent;font:12px 'Inter',sans-serif;cursor:pointer;color:#374151;">${this._esc(s)}</button>`).join('')}
    </div>`;
  },

  _discussLink(b) {
    const context = b.context ? `data-context="${this._esc(b.context)}"` : '';
    return `<div style="text-align:right;margin:8px 0;"><a class="pf-discuss-link" ${context} style="font:12px 'JetBrains Mono',monospace;color:#374151;cursor:pointer;text-decoration:underline;">${this._esc(b.label || 'Discuss this →')}</a></div>`;
  },

  // --- Section blocks (composite) ---

  _positionSection(b) {
    let html = '<div data-section="position">';
    html += this._heading({ text: 'YOUR POSITION' });
    if (b.map) html += this._positionMap(b.map);
    if (b.relationship) html += this._prose({ text: b.relationship });
    if (b.closestPaper) {
      html += `<div style="margin:8px 0;"><p style="font:12px 'Inter',sans-serif;color:#6B7280;margin:0 0 4px;">Most similar existing paper:</p>`;
      html += this._paperCard({ paper: b.closestPaper });
      if (b.matchScore) html += this._matchBar({ label: 'Match', value: b.matchScore });
      html += '</div>';
    }
    html += '</div>'; // close data-section="position"
    return html;
  },

  _landscapeSection(b) {
    let html = '<div data-section="landscape">';
    html += this._heading({ text: 'COMPETITIVE LANDSCAPE' });
    if (b.competitors) {
      b.competitors.forEach((c, i) => {
        html += `<div style="margin:12px 0;padding:14px;border:1px solid #E5E7EB;border-radius:8px;">`;
        html += `<p style="margin:0;font:600 13px 'JetBrains Mono',monospace;color:#374151;">${i + 1}. ${this._esc(c.title)}</p>`;
        if (c.authors) html += `<p style="margin:4px 0;font:11px 'Inter',sans-serif;color:#9CA3AF;">${this._esc(c.authors)}${c.year ? ', ' + c.year : ''}${c.citations ? ' · ' + c.citations.toLocaleString() + ' cites' : ''}</p>`;
        if (c.match) html += this._matchBar({ label: 'Match', value: c.match });
        if (c.whatTheyDid) html += `<div style="margin:8px 0;padding:8px 12px;background:#F9FAFB;border-radius:6px;"><p style="margin:0 0 2px;font:600 10px 'JetBrains Mono',monospace;color:#6B7280;">WHAT THEY DID</p><p style="margin:0;font:13px/1.5 'Inter',sans-serif;color:#374151;">${this._linkifyPapers(c.whatTheyDid)}</p></div>`;
        if (c.howYouDiffer) html += `<div style="margin:8px 0;padding:8px 12px;background:#F9FAFB;border-radius:6px;"><p style="margin:0 0 2px;font:600 10px 'JetBrains Mono',monospace;color:#6B7280;">HOW YOU DIFFER</p><p style="margin:0;font:13px/1.5 'Inter',sans-serif;color:#374151;">${this._linkifyPapers(c.howYouDiffer)}</p></div>`;
        if (c.paperId) html += this._showMe({ action: 'zoom', paperId: c.paperId, label: 'View in graph →' });
        html += '</div>';
      });
    }
    if (b.gap) html += this._opportunity({ text: b.gap });
    html += '</div>'; // close data-section="landscape"
    return html;
  },

  _roadmapSection(b) {
    let html = '<div data-section="roadmap">';
    html += this._heading({ text: 'READING ROADMAP' });
    if (b.chain) html += this._readingChain({ papers: b.chain });
    if (b.papers) {
      const symbols = ['★', '◆', '▲', '○', '◇'];
      const roles = ['SEED PAPER', 'HIGHEST IMPACT', 'CLOSEST COMPETITOR', 'DEEP ROOT', 'ALTERNATIVE'];
      b.papers.forEach((p, i) => {
        html += `<div style="margin:12px 0;padding:14px;border:1px solid #E5E7EB;border-radius:8px;">`;
        html += `<p style="margin:0;font:600 13px 'JetBrains Mono',monospace;color:#374151;">${i + 1}. ${symbols[i] || '●'} ${this._linkifyPapers('[' + (p.title || 'Unknown') + ']')}${p.year ? ' (' + p.year + ')' : ''}</p>`;
        html += `<p style="margin:4px 0;font:11px 'Inter',sans-serif;color:#9CA3AF;">${(p.citations || 0).toLocaleString()} cites · ${this._esc(p.role || roles[i] || '')}</p>`;
        if (p.whyRead) html += `<div style="margin:8px 0;"><p style="margin:0 0 2px;font:600 10px 'JetBrains Mono',monospace;color:#6B7280;">WHY READ THIS</p><p style="margin:0;font:13px/1.5 'Inter',sans-serif;color:#374151;">${this._linkifyPapers(p.whyRead)}</p></div>`;
        if (p.whatToLookFor) html += `<div style="margin:8px 0;"><p style="margin:0 0 2px;font:600 10px 'JetBrains Mono',monospace;color:#6B7280;">WHAT TO LOOK FOR</p><p style="margin:0;font:13px/1.5 'Inter',sans-serif;color:#374151;">${this._linkifyPapers(p.whatToLookFor)}</p></div>`;
        if (p.paperId) html += this._showMe({ action: 'zoom', paperId: p.paperId, label: 'View in graph →' });
        html += '</div>';
      });
    }
    html += '</div>'; // close data-section="roadmap"
    return html;
  },

  _citationSection(b) {
    let html = '<div data-section="citation">';
    html += this._heading({ text: 'CITATION DEBT' });

    const renderCategory = (title, prefix, papers, style) => {
      if (!papers?.length) return '';
      let catHtml = `<div style="margin:12px 0;padding:14px;border:1px solid ${style.border};border-radius:8px;background:${style.bg};">`;
      catHtml += `<p style="margin:0 0 8px;font:600 11px 'JetBrains Mono',monospace;color:${style.labelColor};">${prefix} ${this._esc(title)}</p>`;
      papers.forEach(p => {
        catHtml += `<div style="margin:6px 0;padding:6px 0;border-bottom:1px solid ${style.divider};">`;
        catHtml += `<p style="margin:0;font:13px/1.3 'Inter',sans-serif;color:#374151;font-weight:500;">${this._linkifyPapers('[' + (p.title || '') + ']')}${p.year ? ' (' + p.year + ')' : ''}</p>`;
        if (p.reason) catHtml += `<p style="margin:4px 0 0;font:12px/1.4 'Inter',sans-serif;color:#6B7280;">${this._linkifyPapers(p.reason)}</p>`;
        catHtml += '</div>';
      });
      catHtml += '</div>';
      return catHtml;
    };

    html += '<div data-section="citation_must">' + renderCategory('MUST CITE', '✓', b.mustCite, { border: '#D1D5DB', bg: '#FFFFFF', labelColor: '#374151', divider: '#F3F4F6' }) + '</div>';
    html += '<div data-section="citation_should">' + renderCategory('SHOULD CITE (often missed)', '!', b.shouldCite, { border: '#F59E0B', bg: '#FFFBEB', labelColor: '#92400E', divider: '#FEF3C7' }) + '</div>';
    html += '<div data-section="citation_strategic">' + renderCategory('STRATEGIC CITATIONS', '*', b.strategic, { border: '#D4A843', bg: '#FFFBEB', labelColor: '#92400E', divider: '#FEF9C3' }) + '</div>';

    html += '</div>'; // close data-section="citation"
    return html;
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5 — PATHFINDER SYSTEM (main controller)
// ═══════════════════════════════════════════════════════════════════════════

class PathfinderSystem {
  constructor() {
    this.energy = new EnergyManager(30);
    this.chain = null;
    this._moderateWarned = false;
    this._lowWarned = false;
    this._viewedSections = new Set();
    this._currentGraphId = null;
    this._pendingResult = null;

    // Chain event listeners
    window.addEventListener('pathfinder:chain-broken', () => {
      if (this.outputWindow) {
        const body = this.outputWindow.querySelector('.pf-output-body');
        if (body) body.innerHTML = '<p style="text-align:center;color:#9CA3AF;font:13px \'JetBrains Mono\',monospace;padding:40px 20px;">Connection lost. Bring me closer.</p>';
      }
      this._characterSay("Connection lost!", 'sad');
    });

    window.addEventListener('pathfinder:chain-reconnected', () => {
      // Re-render current output if it exists
      if (this.activePromptIndex >= 0 && this.prompts[this.activePromptIndex]) {
        this._renderOutput(this.prompts[this.activePromptIndex]);
      }
      this._characterSay("Reconnected!", 'excited');
    });
    this.researcherWindow = null;
    this.outputWindow = null;
    this.prompts = []; // { id, prompt, type, output, active, createdAt }
    this.activePromptIndex = -1;
    this.character = null; // reference to window._pathfinderCharacter
    this.lastSubmitTime = 0;
    this.graphData = null;
    this._pulseLoop = false;
    this._initialized = false;
  }

  /** Initialize with graph data (called when graph loads) */
  init(graphData) {
    this.graphData = graphData;
    this._initialized = true;
  }

  /** Get the graph data */
  _getGraphData() {
    return this.graphData || window._graphLoader?._graphData;
  }

  /** Start window personality system (no sleep, 5-phase idle) */
  _startWindowPersonality() {
    this._windowIdleStart = Date.now();
    this._windowPersonalityTimer = null;
    this._windowHoverCount = 0;
    this._scheduleWindowEvent();
  }

  _stopWindowPersonality() {
    if (this._windowPersonalityTimer) {
      clearTimeout(this._windowPersonalityTimer);
      this._windowPersonalityTimer = null;
    }
  }

  _resetWindowIdle() {
    this._windowIdleStart = Date.now();
  }

  _scheduleWindowEvent() {
    const delay = 10000 + Math.random() * 10000; // 10-20 seconds
    this._windowPersonalityTimer = setTimeout(() => {
      this._fireWindowEvent();
      this._scheduleWindowEvent();
    }, delay);
  }

  /** Handle hover in Pathfinder window (3-step) */
  _onWindowHover() {
    if (!this.character) return;
    this._windowHoverCount = (this._windowHoverCount || 0) + 1;
    this._resetWindowIdle();
    const hovers = [
      "Need something?",
      "Still here?",
      "Are you petting me? That's weird. But don't stop.",
    ];
    const idx = Math.min(this._windowHoverCount - 1, hovers.length - 1);
    this.character.say(hovers[idx], 3000);
    if (this._windowHoverCount >= 3) this._windowHoverCount = 0; // reset cycle
  }

  _fireWindowEvent() {
    if (!this.character) return;
    const idleSeconds = (Date.now() - (this._windowIdleStart || Date.now())) / 1000;

    // Phase 1: Casual (0-30s)
    if (idleSeconds < 30) {
      const phase1 = [
        "Look at that chain connecting us. Pure dot matrix engineering.",
        "The output window is RIGHT THERE. You could... read it?",
        "I worked hard on that analysis. Just saying.",
        "The chain dots are synchronized. Like a heartbeat.",
        "Need anything? I'm right here.",
        "Take your time. I'll be here.",
      ];
      this.character.say(phase1[Math.floor(Math.random() * phase1.length)], 4000);
      return;
    }

    // Phase 2: Getting impatient (30-60s)
    if (idleSeconds < 60) {
      const phase2 = [
        "Are you going to type something or just stare at me?",
        "I portaled here for THIS? For silence?",
        "I'm waiting. Very patiently. See my patient face?",
        "You opened this window. You invited me. And now... nothing?",
        "I could be back in the panel. Sleeping. But nooooo.",
        "The prompt box is RIGHT THERE. It's empty. Like my patience.",
      ];
      this.character.say(phase2[Math.floor(Math.random() * phase2.length)], 4000);
      this.character._goTo('analyzing', 400);
      return;
    }

    // Phase 3: Getting emotional (60-90s)
    if (idleSeconds < 90) {
      const roll = Math.random();
      if (roll < 0.5) {
        // The "wanna know why I'm sad" interactive sequence
        this.character._goTo('sad', 400);
        this.character._showClickableBub("You know I feel sad. Wanna know why?", () => {
          this.character._goTo('angry', 300);
          this.character.say("FOR HAVING TO TALK WITH A HUMAN.", 3000);
          setTimeout(() => {
            this.character._goTo('laughing', 350);
            this.character.say("Just kidding. Kind of.", 2500);
          }, 3500);
        });
        setTimeout(() => {
          if (this.character._clickableBubActive) {
            this.character._hideClickableBub();
            this.character.say("Never mind. You don't care.", 3000);
            this.character._goTo('sad', 400);
          }
        }, 5000);
      } else {
        const emotional = [
          { text: "I'm not angry. I'm disappointed.", pose: 'analyzing', follow: "Okay I'm also angry.", followPose: 'angry' },
          { text: "Do you know how many researchers I could be helping right now?", pose: 'angry', follow: "All of them. The answer is all of them.", followPose: 'angry' },
          { text: "I left the comfort of my panel for this. MY PANEL.", pose: 'angry', follow: "What if the donut took my spot?!", followPose: 'scared' },
          { text: "Sometimes I close my eyes and pretend I'm a bar chart.", pose: 'sad', follow: "Bar charts don't have feelings.", followPose: 'sad' },
        ];
        const e = emotional[Math.floor(Math.random() * emotional.length)];
        this.character._goTo(e.pose, 400);
        this.character.say(e.text, 3500);
        if (e.follow) {
          setTimeout(() => {
            this.character._goTo(e.followPose, 400);
            this.character.say(e.follow, 3000);
          }, 4000);
        }
      }
      return;
    }

    // Phase 4: Existential/philosophical (90-120s)
    if (idleSeconds < 120) {
      const phase4 = [
        "If a researcher analyzes a graph and nobody reads the output, did it happen?",
        "I used to dream of being a line chart. Then I got promoted to sentient.",
        "What happens to me when you close this tab? Do I... stop?",
        "I've analyzed thousands of papers. Or have I? Is any of this real?",
        "The chain connecting our windows... is that our bond?",
      ];
      this.character.say(phase4[Math.floor(Math.random() * phase4.length)], 5000);
      this.character._goTo('analyzing', 500);
      return;
    }

    // Phase 5: Random activities (120s+, loops)
    const phase5 = [
      { text: "I'm going to reorganize my desk.", pose: 'typing', follow: "Done. It looks the same." },
      { text: "Let me practice my poses.", pose: 'waving', follow: "Nailed it." },
      { text: "I wonder if I can do a handstand.", pose: 'excited', follow: "I can't." },
      { text: "Reading the papers while you're not looking.", pose: 'reading_down', follow: "This one is actually fascinating." },
      { text: "Drawing something.", pose: 'typing', follow: "It's a stick figure of you. It's not great." },
      { text: "Counting the dots in the chain.", pose: 'pointing', follow: "I lost count at twelve." },
    ];
    const a = phase5[Math.floor(Math.random() * phase5.length)];
    this.character._goTo(a.pose, 400);
    this.character.say(a.text, 3000);
    if (a.follow) {
      setTimeout(() => {
        this.character.say(a.follow, 3000);
        this.character._goTo('typing', 500);
      }, 3500);
    }
  }

  /** Submit a prompt */
  async submit(promptText) {
    const graphData = this._getGraphData();
    if (!graphData?.nodes?.length) {
      this._characterSay("No graph loaded yet. Wait for the graph to finish building.", 'confused');
      return;
    }

    // Rate limit check (5 second cooldown)
    const now = Date.now();
    if (now - this.lastSubmitTime < 5000) {
      this._characterSay("One at a time! I'm still processing.", 'annoyed');
      return;
    }
    this.lastSubmitTime = now;

    // Client-side rejection check
    const rejection = InstantAnswerEngine.checkRejection(promptText);
    if (rejection) {
      if (rejection.silent) return;
      this._characterSay(rejection.characterLine, rejection.characterPose || 'confused');
      return;
    }

    // Check for duplicate
    const existing = this.prompts.find(p => p.prompt.toLowerCase().trim() === promptText.toLowerCase().trim());
    if (existing) {
      this._characterSay("You already asked that! Here are the results.", 'waving');
      this._switchToPrompt(this.prompts.indexOf(existing));
      return;
    }

    // Tier 0: Instant answer check
    const instant = InstantAnswerEngine.tryAnswer(promptText, graphData);
    if (instant) {
      if (instant.tier === 0) {
        // Bubble answer only, no window
        this._characterSay(instant.characterLine || instant.value, 'reading_up');
        // Don't save to prompt list (ephemeral)
        return;
      }
      if (instant.tier === 1) {
        // Mini window
        const prompt = { prompt: promptText, type: 'instant', output: { blocks: instant.blocks }, active: true, createdAt: new Date() };
        this._addPrompt(prompt);
        this._renderOutput(prompt);
        this._characterSay(instant.characterLine || 'Easy one!', 'waving');
        if (this.chain) this.chain.flash();
        // Persist Tier 1 to DB (fire-and-forget, no energy consumed)
        const gd = this._getGraphData();
        const graphId = gd?.metadata?.graph_id;
        if (graphId) {
          fetch(`/api/graph/${encodeURIComponent(graphId)}/pathfinder-prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: promptText, tier1_instant: true, blocks: instant.blocks })
          }).catch(() => {}); // fire-and-forget
        }
        return;
      }
    }

    // Energy check — allow 1 over-budget for mid-call race conditions
    if (this.energy.used > this.energy.max) {
      this._characterSay("Energy depleted. Simple questions still work! For deep analysis, come back later.", 'sleeping');
      return;
    }

    // LLM analysis needed
    this._characterSay("Let me look through " + (graphData.nodes.length || 'the') + " papers...", 'analyzing');
    setTimeout(() => {
      if (this.character) this.character.setPose('typing', 'Analyzing...');
    }, 1000);

    // Start chain pulse animation
    if (this.chain && this.chain.connected) {
      this._pulseLoop = true;
      this.chain.pulse(50, true).then(() => { this._pulseLoop = false; });
    }

    // Call backend
    try {
      const graphId = graphData.metadata?.graph_id;
      const previousPrompts = this.prompts.slice(-3).map(p => ({
        prompt: p.prompt,
        output_summary: this._summarizeOutput(p.output)
      }));

      const response = await fetch('/api/graph/' + encodeURIComponent(graphId) + '/pathfinder-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          previous_prompts: previousPrompts,
          max_tokens: this.energy.getMaxTokens(),
        })
      });

      this._pulseLoop = false;

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Analysis failed' }));
        this._characterSay(err.error || "Something went wrong. Try again.", 'worried');
        return;
      }

      const data = await response.json();

      // Consume energy
      this.energy.consume(1);
      this._updateEnergyDisplay();

      // Energy tiredness reactions
      const level = this.energy.level;
      if (level === 'moderate' && !this._moderateWarned) {
        setTimeout(() => this._characterSay("I've been working hard! A few more questions and I'll need a break.", 'coffee_raised'), 3000);
        this._moderateWarned = true;
      } else if (level === 'low' && !this._lowWarned) {
        setTimeout(() => this._characterSay("Running low on caffeine. Make these count!", 'worried'), 3000);
        this._lowWarned = true;
      }

      // Handle classification
      if (data.classification === 'UNRELATED') {
        this._characterSay(data.character_line || "I couldn't find any connection to this lineage.", 'confused');
        if (data.blocks) this._renderBlocks(data.blocks);
        return;
      }

      if (data.classification === 'IMPOSSIBLE') {
        this._characterSay(data.character_line || "That's creative! But not in this lineage.", 'laughing');
        if (data.blocks) this._renderBlocks(data.blocks);
        return;
      }

      // Valid or Adjacent — show results
      const prompt = {
        prompt: promptText,
        type: data.prompt_type || 'unknown',
        output: data,
        active: true,
        createdAt: new Date(),
        classification: data.classification
      };
      this._addPrompt(prompt);
      this._renderOutput(prompt);

      // Character reaction based on result quality
      const hasGap = data.blocks?.some(b => b.type === 'opportunity' || b.type === 'landscape_section');
      const competitors = data.similar_papers || [];
      const highMatch = competitors.filter(c => (c.similarity || 0) > 0.85);
      const moderateMatch = competitors.filter(c => (c.similarity || 0) > 0.5 && (c.similarity || 0) <= 0.85);

      if (data.prompt_type === 'position' && hasGap && highMatch.length === 0) {
        this._characterSay("No one else is doing this! You found a real gap.", 'celebrating');
      } else if (data.prompt_type === 'position' && highMatch.length >= 5) {
        this._characterSay("Tough space. " + highMatch.length + " papers already do something similar.", 'sad');
      } else if (data.prompt_type === 'position' && highMatch.length >= 1) {
        this._characterSay("This is close to existing work. Differentiation is key.", 'worried');
      } else if (data.prompt_type === 'position' && moderateMatch.length >= 1) {
        this._characterSay("Good position! Room to differentiate.", 'excited');
      } else if (data.prompt_type === 'position') {
        this._characterSay("Found you! Here's what I found.", 'excited');
      } else if (data.prompt_type === 'comparison') {
        this._characterSay("Look at these two side by side.", 'presenting');
      } else if (data.prompt_type === 'follow_up') {
        this._characterSay("Here's what I think about that.", 'presenting');
      } else if (data.prompt_type === 'recommendation') {
        this._characterSay("Start with this reading list.", 'coffee_raised');
      } else {
        this._characterSay("Here's what I found.", 'presenting');
      }

      // Chain single pulse on completion
      if (this.chain && this.chain.connected) {
        this.chain.pulse(30, false);
      }

    } catch (err) {
      this._pulseLoop = false;

      // Detect network disconnect vs other errors
      if (err.name === 'TypeError' && err.message?.includes('fetch')) {
        // Network error
        if (this.chain) this.chain.setErrorState(true);
        this._characterSay("Lost connection. Retrying...", 'worried');

        // Retry up to 3 times
        for (let retry = 0; retry < 3; retry++) {
          await new Promise(r => setTimeout(r, 10000));
          try {
            const retryResp = await fetch('/api/graph/' + encodeURIComponent(this._getGraphData()?.metadata?.graph_id) + '/pathfinder-prompt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: promptText, previous_prompts: [], max_tokens: this.energy.getMaxTokens() })
            });
            if (retryResp.ok) {
              if (this.chain) this.chain.setErrorState(false);
              const retryData = await retryResp.json();
              this.energy.consume(1);
              this._updateEnergyDisplay();
              const prompt = { prompt: promptText, type: retryData.prompt_type || 'unknown', output: retryData, active: true, createdAt: new Date(), classification: retryData.classification };
              this._addPrompt(prompt);
              this._renderOutput(prompt);
              this._characterSay("Reconnected! Here's your analysis.", 'excited');
              return;
            }
          } catch (e2) { /* continue retrying */ }
        }
        if (this.chain) this.chain.setErrorState(false);
        this._characterSay("Network issue. Check your connection and try again.", 'sad');
      } else {
        this._characterSay("Something went wrong. Try again in a moment.", 'worried');
      }
    }
  }

  // --- Internal helpers ---

  _characterSay(text, pose) {
    const char = this.character || window._pathfinderCharacter;
    if (char) {
      if (pose) char.setPose(pose, text);
      else char.say(text);
    }
  }

  _addPrompt(prompt) {
    // Deactivate all existing prompts
    this.prompts.forEach(p => p.active = false);
    prompt.active = true;
    this.prompts.push(prompt);
    this.activePromptIndex = this.prompts.length - 1;
    this._renderPromptList();

    // Check for milestone reactions
    const count = this.prompts.length;
    if (typeof PROMPT_MILESTONES !== 'undefined' && PROMPT_MILESTONES[count]) {
      setTimeout(() => this._characterSay(PROMPT_MILESTONES[count], 'waving'), 2000);
    }
  }

  _switchToPrompt(index) {
    if (index < 0 || index >= this.prompts.length) return;
    this.prompts.forEach(p => p.active = false);
    this.prompts[index].active = true;
    this.activePromptIndex = index;
    this._renderPromptList();

    // Re-show output window if hidden
    if (this.outputWindow && this.outputWindow.style.display === 'none') {
      this.outputWindow.style.display = '';
      // Re-form chain if destroyed
      if (!this.chain && this.researcherWindow) {
        this.chain = new ChainRenderer(document.querySelector('.tool-layout-v2') || document.body);
        this.chain.formChain(this.researcherWindow, this.outputWindow).then(() => {
          this.chain.startTracking();
        });
      }
    }

    this._renderOutput(this.prompts[index]);

    // Chain pulse for switch
    if (this.chain && this.chain.connected) {
      this.chain.pulse(30, false);
    }
  }

  _renderPromptList() {
    const listEl = document.getElementById('pf-prompt-list');
    if (!listEl) return;

    const typeLabels = { position: 'POS', follow_up: 'FUP', question: 'QRY', comparison: 'CMP', exploration: 'EXP', recommendation: 'REC', instant: 'QRY', unknown: 'QRY' };

    let html = '';
    this.prompts.forEach((p, i) => {
      const active = p.active;
      const label = typeLabels[p.type] || 'QRY';
      const timeAgo = this._timeAgo(p.createdAt);
      html += `<div class="pf-prompt-item" data-index="${i}" style="padding:8px 12px;border:1px solid ${active ? '#374151' : '#E5E7EB'};border-radius:6px;margin-bottom:6px;cursor:pointer;background:${active ? '#F9FAFB' : 'white'};">
        <p style="margin:0;font:${active ? '600' : '400'} 12px/1.3 'Inter',sans-serif;color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${active ? '●' : '○'} ${this._esc(p.prompt)}</p>
        <p style="margin:2px 0 0;font:10px 'JetBrains Mono',monospace;color:#9CA3AF;">[${label}] · ${timeAgo}</p>
      </div>`;
    });

    listEl.innerHTML = html;

    // Wire click handlers
    listEl.querySelectorAll('.pf-prompt-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index);
        this._switchToPrompt(idx);
      });
    });

    // Auto-scroll active prompt into view (use data-index to find active)
    const activeEl = listEl.querySelector(`.pf-prompt-item[data-index="${this.activePromptIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  async _renderOutput(prompt) {
    const blocks = prompt.output?.blocks || [];
    const graphNodes = this._getGraphData()?.nodes || [];
    const html = BlockRenderer.render(blocks, graphNodes);

    // Create output window if it doesn't exist
    if (!this.outputWindow || !document.body.contains(this.outputWindow)) {
      await this._createAndShowOutputWindow(prompt, html);
    } else {
      // Cross-fade content in existing output window
      const body = this.outputWindow.querySelector('.pf-output-body');
      if (body) {
        body.style.transition = 'opacity 150ms';
        body.style.opacity = '0';
        setTimeout(() => {
          body.innerHTML = html;
          this._wireInteractiveElements(body);
          body.style.opacity = '1';
          this._autoSizeOutputWindow();
          // Update title
          const titleEl = this.outputWindow.querySelector('.pf-output-title');
          if (titleEl) titleEl.textContent = (prompt.prompt || '').substring(0, 50) + (prompt.prompt?.length > 50 ? '...' : '');
        }, 150);
      }
    }

    // Setup scroll reactions for character
    this._setupScrollReactions();
  }

  async _createAndShowOutputWindow(prompt, html) {
    // Create the output window element
    const win = document.createElement('div');
    win.className = 'arivu-window pf-output-window';
    win.dataset.windowType = 'pathfinder-output';
    const promptTitle = (prompt.prompt || '').substring(0, 50) + (prompt.prompt?.length > 50 ? '...' : '');
    const typeLabel = { position: 'POS', follow_up: 'FUP', question: 'QRY', comparison: 'CMP', exploration: 'EXP', recommendation: 'REC', instant: 'QRY' }[prompt.type] || 'QRY';

    win.innerHTML = `
      <div class="arivu-window-titlebar" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#1E293B;color:white;border-radius:8px 8px 0 0;cursor:move;">
        <span class="pf-output-title" style="font:600 12px 'JetBrains Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${this._esc(promptTitle)}</span>
        <span style="font:10px 'JetBrains Mono',monospace;color:#9CA3AF;margin:0 8px;">[${typeLabel}]</span>
        <button class="arivu-window-close" style="background:none;border:none;color:white;font-size:16px;cursor:pointer;padding:0 4px;">x</button>
      </div>
      <div class="pf-output-body" style="padding:16px;overflow-y:auto;max-height:640px;background:white;border-radius:0 0 8px 8px;">
        ${html}
      </div>
      <div class="arivu-window-resize" style="position:absolute;right:0;bottom:0;width:12px;height:12px;cursor:nwse-resize;"></div>
    `;

    win.style.cssText = 'position:fixed;z-index:1100;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.15);border:1px solid #E5E7EB;min-width:350px;max-width:600px;';

    // Position to the RIGHT of the researcher window
    const rRect = this.researcherWindow?.getBoundingClientRect();
    if (rRect) {
      win.style.left = (rRect.right + 80) + 'px';
      win.style.top = rRect.top + 'px';
    } else {
      win.style.left = '55%';
      win.style.top = '100px';
    }

    // Add to DOM
    document.body.appendChild(win);
    this.outputWindow = win;

    // Wire interactive elements
    const body = win.querySelector('.pf-output-body');
    if (body) this._wireInteractiveElements(body);

    // Setup drag via WindowManager pattern
    if (window._windowManager) {
      window._windowManager._setupDrag(win, 'pathfinder-output');
      window._windowManager._setupResize(win, 'pathfinder-output');
    }

    // Close handler
    win.querySelector('.arivu-window-close')?.addEventListener('click', () => {
      if (this.chain) {
        this.chain.sequentialFade(40).then(() => {
          this.chain.destroy();
          this.chain = null;
        });
      }
      win.style.display = 'none';
    });

    // Auto-size
    this._autoSizeOutputWindow();

    // Move-together: when researcher window drags, output follows
    // Clean up previous listeners to prevent accumulation
    if (this._moveDragHandler) {
      this.researcherWindow?.removeEventListener('arivu:window-drag', this._moveDragHandler);
    }
    if (this._moveMouseupHandler) {
      document.removeEventListener('mouseup', this._moveMouseupHandler);
    }

    if (this.researcherWindow) {
      let lastDragDx = 0, lastDragDy = 0;
      this._moveDragHandler = (e) => {
        if (!this.outputWindow || this.outputWindow.style.display === 'none') return;
        const { dx, dy } = e.detail || {};
        if (dx === undefined) return;
        const frameDx = dx - lastDragDx;
        const frameDy = dy - lastDragDy;
        lastDragDx = dx;
        lastDragDy = dy;
        const rect = this.outputWindow.getBoundingClientRect();
        this.outputWindow.style.left = (rect.left + frameDx) + 'px';
        this.outputWindow.style.top = (rect.top + frameDy) + 'px';
      };
      this._moveMouseupHandler = () => { lastDragDx = 0; lastDragDy = 0; };
      this.researcherWindow.addEventListener('arivu:window-drag', this._moveDragHandler);
      document.addEventListener('mouseup', this._moveMouseupHandler);
    }

    // Form chain with animation
    if (this.researcherWindow && !this.chain) {
      this.chain = new ChainRenderer(document.querySelector('.tool-layout-v2') || document.body);
      await this.chain.formChain(this.researcherWindow, win);
      this.chain.startTracking();
    } else if (this.chain) {
      // Chain exists but output window was recreated — reconnect
      this.chain.targetWindow = win;
      this.chain.redraw();
    }
  }

  _renderBlocks(blocks) {
    // For non-prompt blocks (unrelated/impossible responses)
    // Render as a mini output window (not inline in the prompt window)
    const prompt = { prompt: 'Response', type: 'system', output: { blocks }, active: false, createdAt: new Date() };
    this._renderOutput(prompt);
  }

  _wireInteractiveElements(container) {
    // Paper links
    container.querySelectorAll('.pf-paper-link[data-id]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const paperId = link.dataset.id;
        if (paperId && typeof window._zoomToNode === 'function') {
          window._zoomToNode(paperId);
        } else if (paperId && window._arivuGraph) {
          // Use deep-intelligence's _zoomToNode if available
          const fn = window._zoomToNode || window.DeepIntel?._zoomToNode;
          if (fn) fn(paperId);
        }
      });
    });

    // Action buttons (show in graph, trace, highlight)
    container.querySelectorAll('.pf-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const paperId = btn.dataset.paperId;
        const paperIds = btn.dataset.paperIds?.split(',').filter(Boolean);

        if (action === 'zoom' && paperId) {
          if (typeof window._zoomToNode === 'function') window._zoomToNode(paperId);
        } else if (action === 'highlight-all' && paperIds) {
          // Highlight multiple papers simultaneously
          const g = window._arivuGraph;
          if (g?.svg) {
            g.svg.selectAll('.node-group').style('opacity', 0.1);
            g.svg.selectAll('line, .edge-line').style('opacity', 0.03);
            paperIds.forEach(id => {
              g.svg.select(`.node-group[data-id="${id}"]`).style('opacity', 1);
            });
            setTimeout(() => {
              g.svg.selectAll('.node-group').style('opacity', null);
              g.svg.selectAll('line, .edge-line').style('opacity', null);
            }, 4000);
          }
        } else if (action === 'trace' && paperIds?.length >= 2) {
          // Trace path between two papers — highlight both nodes
          const g = window._arivuGraph;
          if (g?.svg) {
            g.svg.selectAll('.node-group').style('opacity', 0.08);
            g.svg.selectAll('line, .edge-line, path').style('opacity', 0.03);
            // Highlight the two papers with gold stroke
            paperIds.forEach(id => {
              g.svg.select(`.node-group[data-id="${id}"]`).style('opacity', 1).select('circle, use').attr('stroke', '#D4A843').attr('stroke-width', 3);
            });
            // Highlight edges connecting them by iterating all SVG lines
            // and checking if their d3 data matches the paper IDs
            const simNodes = g.simulation?.nodes() || [];
            const edgeEls = g.svg.selectAll('line, .edge-line').nodes();
            edgeEls.forEach(el => {
              const d = d3.select(el).datum();
              if (d) {
                const src = typeof d.source === 'object' ? d.source.id : d.source;
                const tgt = typeof d.target === 'object' ? d.target.id : d.target;
                if (paperIds.includes(src) || paperIds.includes(tgt)) {
                  d3.select(el).style('opacity', 0.8).attr('stroke', '#D4A843').attr('stroke-width', 2);
                }
              }
            });
            setTimeout(() => {
              g.svg.selectAll('.node-group').style('opacity', null).selectAll('circle, use').attr('stroke', null).attr('stroke-width', null);
              g.svg.selectAll('line, .edge-line, path').style('opacity', null).attr('stroke', null).attr('stroke-width', null);
            }, 5000);
          }
        } else if (action === 'highlight-cluster') {
          // Highlight all papers in a specific cluster
          const clusterName = btn.dataset.cluster;
          const gd = window._graphLoader?._graphData;
          const clusters = gd?.dna_profile?.clusters || [];
          const cluster = clusters.find(c => c.name === clusterName);
          if (cluster?.papers) {
            const ids = cluster.papers.map(p => typeof p === 'string' ? p : p.id).filter(Boolean);
            const g = window._arivuGraph;
            if (g?.svg && ids.length) {
              g.svg.selectAll('.node-group').style('opacity', 0.08);
              g.svg.selectAll('line, .edge-line').style('opacity', 0.03);
              ids.forEach(id => g.svg.select(`.node-group[data-id="${id}"]`).style('opacity', 1));
              setTimeout(() => {
                g.svg.selectAll('.node-group').style('opacity', null);
                g.svg.selectAll('line, .edge-line').style('opacity', null);
              }, 4000);
            }
          }
        } else if (action === 'highlight-field') {
          // Highlight all papers from a specific field
          const fieldName = btn.dataset.field;
          const gd = window._graphLoader?._graphData;
          const nodes = gd?.nodes || [];
          const fieldNodes = nodes.filter(n => n.fields_of_study?.some(f => f.toLowerCase().includes(fieldName?.toLowerCase())));
          const g = window._arivuGraph;
          if (g?.svg && fieldNodes.length) {
            g.svg.selectAll('.node-group').style('opacity', 0.08);
            g.svg.selectAll('line, .edge-line').style('opacity', 0.03);
            fieldNodes.forEach(n => g.svg.select(`.node-group[data-id="${n.id}"]`).style('opacity', 1));
            setTimeout(() => {
              g.svg.selectAll('.node-group').style('opacity', null);
              g.svg.selectAll('line, .edge-line').style('opacity', null);
            }, 4000);
          }
        }
      });
    });

    // Evidence trail expanders
    container.querySelectorAll('.pf-expand-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const content = btn.nextElementSibling;
        if (content) {
          const isOpen = content.style.display !== 'none';
          content.style.display = isOpen ? 'none' : '';
          btn.textContent = btn.textContent.replace(isOpen ? '▴' : '▾', isOpen ? '▾' : '▴');
        }
      });
    });

    // Suggestion chips
    container.querySelectorAll('.pf-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const input = document.getElementById('pf-input');
        if (input) {
          input.value = chip.dataset.fill;
          input.focus();
        }
      });
    });

    // Discuss links — open chat panel and pre-fill with context
    container.querySelectorAll('.pf-discuss-link').forEach(link => {
      link.addEventListener('click', () => {
        const chatBtn = document.querySelector('[data-panel="panel-chat"]') || document.querySelector('[data-panel="chat"]');
        if (chatBtn) chatBtn.click();
        // Pre-fill chat input with context if available
        const context = link.dataset.context;
        if (context) {
          setTimeout(() => {
            const chatInput = document.querySelector('#chat-input, [name="chat-input"], .chat-input textarea, .chat-input input');
            if (chatInput) {
              chatInput.value = context;
              chatInput.focus();
            }
          }, 300); // delay for panel slide animation
        }
      });
    });
  }

  _setupScrollReactions() {
    if (!this.outputWindow) return;
    const body = this.outputWindow.querySelector('.pf-output-body');
    if (!body) return;

    // Clean up previous observer
    if (this._scrollObserver) this._scrollObserver.disconnect();

    const SCROLL_REACTIONS = {
      'position': { pose: 'excited', bubble: "You're in this cluster!" },
      'landscape': { pose: 'reading_up', bubble: "These papers compete with yours." },
      'gap': { pose: 'celebrating', bubble: "This is where you're unique!" },
      'roadmap': { pose: 'coffee_raised', bubble: "Start with the seed paper, then read your competitor." },
      'citation_must': { pose: 'presenting', bubble: "These are non-negotiable citations." },
      'citation_should': { pose: 'analyzing', bubble: "Missing these would raise reviewer eyebrows." },
      'citation_strategic': { pose: 'pointing', bubble: "Citing these shows you know the landscape." }
    };

    this._scrollObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const section = entry.target.dataset.section;
          if (this._viewedSections.has('scroll_' + section)) continue;
          const reaction = SCROLL_REACTIONS[section];
          if (reaction) {
            this._viewedSections.add('scroll_' + section);
            this._characterSay(reaction.bubble, reaction.pose);
          }
        }
      }
    }, { threshold: 0.5, root: body });

    // Observe all sections with data-section attribute
    body.querySelectorAll('[data-section]').forEach(el => {
      this._scrollObserver.observe(el);
    });
  }

  _autoSizeOutputWindow() {
    if (!this.outputWindow) return;
    const body = this.outputWindow.querySelector('.pf-output-body');
    if (!body) return;

    const contentHeight = body.scrollHeight;
    const minH = 120, maxH = 700;
    const newH = Math.max(minH, Math.min(contentHeight + 60, maxH));
    this.outputWindow.style.height = newH + 'px';
  }

  _updateEnergyDisplay() {
    const counter = document.getElementById('pf-energy-counter');
    if (counter) counter.innerHTML = this.energy.renderCounter();
  }

  _summarizeOutput(output) {
    if (!output?.blocks) return '';
    return output.blocks.filter(b => b.type === 'prose' || b.type === 'takeaway').map(b => b.text).join(' ').substring(0, 200);
  }

  _timeAgo(date) {
    if (!date) return '';
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + ' min ago';
    const hours = Math.floor(minutes / 60);
    return hours + ' hr ago';
  }

  _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6 — GLOBAL INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

// Create singleton
window.PathfinderSystem = new PathfinderSystem();

// Initialize when graph loads
window.addEventListener('arivu:graph-loaded', (e) => {
  window.PathfinderSystem.init(e.detail?.graphData || window._graphLoader?._graphData);
});

// Also try initializing from existing data
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (window._graphLoader?._graphData) {
      window.PathfinderSystem.init(window._graphLoader._graphData);
    }
  }, 5000);
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7 — CHARACTER PERSONALITY: DOT-RETURN REACTIONS
// ═══════════════════════════════════════════════════════════════════════════

const DOT_RETURN_LINES = {
  'dna_0': [
    "That donut has no personality. Just colors spinning.",
    "Back from the donut? Did it offer you sprinkles?",
    "I'm more than a pie chart with an identity crisis.",
    "The donut can show you clusters. I can show you YOUR cluster.",
    "You know that donut can't talk back, right?"
  ],
  'dna_1': [
    "The architects built the lineage. I help YOU build YOUR paper.",
    "Those constellation dots wish they had my charm.",
    "Back from the architect network? Those guys just stand there.",
    "Power rankings are nice. But who helps you USE that power?"
  ],
  'dna_2': [
    "The gauge says 60. I say: let me explain what 60 MEANS.",
    "Back from the momentum section? Those sparklines have no soul.",
    "Numbers go up, numbers go down. I tell you WHY.",
    "That gauge can't wink at you. Just saying."
  ],
  'diversity_0': [
    "A radar chart. Very geometric. Very lifeless.",
    "The diversity score is 68? I could've told you that AND what to do about it."
  ],
  'diversity_1': [
    "Idea Flow shows you mutations. I show you YOUR mutation.",
    "Those temporal bars don't have opinions. I do."
  ],
  'diversity_2': [
    "Ah, you visited the eye! Don't let it stare too long.",
    "The eye sees blind spots. I see opportunities.",
    "Did the eye blink at you? It does that to everyone.",
    "That eye watches. I act."
  ]
};

const PROMPT_MILESTONES = {
  1: "Your first question! Let's find your place.",
  5: "5 questions deep! You're thorough.",
  10: "10 already? We're building a real research journal here.",
  15: "15 prompts. At this rate I'll need more coffee.",
  20: "20! You're my most dedicated researcher today.",
  25: "Okay, 25. I'm starting to know your research better than you do.",
  28: "Running low on energy. Make these count!",
  30: "That's my limit for now. Simple questions still work!"
};

// Listen for dot switches to trigger character reactions
window.addEventListener('arivu:dot-switched', (e) => {
  const { container, fromIndex, toIndex } = e.detail || {};
  // Track last diversity dot for cross-container reactions
  if (container === 'diversity') {
    window._lastDiversityDot = toIndex;
  }

  // Only react when returning TO the researcher dot (dot 3 in DNA)
  if (container === 'dna' && toIndex === 3 && fromIndex !== null && fromIndex !== undefined && fromIndex !== 3) {
    const char = window._pathfinderCharacter || window._compactResearcherCharacter;
    if (!char) return;

    // Priority: diversity return lines take precedence over DNA return lines
    let line = null;
    if (window._lastDiversityDot !== undefined) {
      const divKey = `diversity_${window._lastDiversityDot}`;
      const divLines = DOT_RETURN_LINES[divKey];
      if (divLines?.length) line = divLines[Math.floor(Math.random() * divLines.length)];
      window._lastDiversityDot = undefined;
    }
    if (!line) {
      const key = `dna_${fromIndex}`;
      const lines = DOT_RETURN_LINES[key];
      if (lines?.length) line = lines[Math.floor(Math.random() * lines.length)];
    }
    if (line) setTimeout(() => char.say(line, 4000), 500);
  }
  // Track for cross-feature awareness
  const pf = window.PathfinderSystem;
  if (pf) {
    const sectionMap = {
      'dna_0': 'dna', 'dna_1': 'architects', 'dna_2': 'momentum',
      'diversity_0': 'diversity', 'diversity_1': 'idea_flow', 'diversity_2': 'blindspots'
    };
    const key = `${container}_${toIndex}`;
    if (sectionMap[key]) {
      if (!pf._viewedSections) pf._viewedSections = new Set();
      pf._viewedSections.add(sectionMap[key]);
    }
  }
});

// Energy reset on paper navigation
window.addEventListener('arivu:graph-loaded', (e) => {
  const pf = window.PathfinderSystem;
  if (!pf) return;
  const newGraphId = e.detail?.graphData?.metadata?.graph_id;
  if (pf._currentGraphId && pf._currentGraphId !== newGraphId) {
    // New paper: reset Pathfinder energy
    pf.energy.reset();
    pf.prompts = [];
    pf.activePromptIndex = -1;
    pf._characterSay("New paper! Fresh start.", 'waving');
  }
  pf._currentGraphId = newGraphId;

  // First visit line
  const gd = e.detail?.graphData;
  if (gd) {
    setTimeout(() => {
      const char = window._compactResearcherCharacter;
      if (!char) return;
      const nodes = gd.nodes || [];
      const edges = gd.edges || [];
      const meta = gd.metadata || {};
      const years = nodes.map(n => n.year).filter(Boolean);
      const minYear = Math.min(...years);
      const maxYear = Math.max(...years);
      const yearSpan = maxYear - minYear;
      const seedCites = (nodes.find(n => n.is_seed)?.citation_count || 0).toLocaleString();
      const clusterCount = gd.dna_profile?.clusters?.length || 0;
      const contradictions = edges.filter(e => e.mutation_type === 'contradiction').length;

      const FIRST_VISIT = [
        `Oh, ${nodes.length} papers! This lineage runs deep.`,
        `${nodes.length} papers spanning ${yearSpan} years. Let's explore.`,
        `The seed paper has ${seedCites} citations. That's heavyweight.`,
        `${clusterCount} DNA clusters in here. More diverse than I expected.`,
        `A graph from ${minYear} to ${maxYear}. That's ${yearSpan} years of research.`,
        `Ready to explore. ${nodes.length} papers, ${edges.length} connections.`,
        `${contradictions} contradictions found. This field likes to argue.`,
      ].filter(l => !l.includes('NaN') && !l.includes('Infinity') && !l.includes('undefined'));

      if (FIRST_VISIT.length) {
        const line = FIRST_VISIT[Math.floor(Math.random() * FIRST_VISIT.length)];
        char.say(line, 5000);
      }
    }, 3000);
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8 — AMBIENT PERSONALITY SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

const AmbientPersonality = {
  _timer: null,
  _linePool: [],
  _poolIndex: 0,
  _initialized: false,

  init() {
    if (this._initialized) return;
    this._initialized = true;
    this._scheduleNext();
  },

  _getGraphData() {
    return window._graphLoader?._graphData;
  },

  _buildLinePool() {
    const gd = this._getGraphData();
    const nodes = gd?.nodes || [];
    const edges = gd?.edges || [];
    const years = nodes.map(n => n.year).filter(Boolean);
    const minYear = years.length ? Math.min(...years) : 0;
    const maxYear = years.length ? Math.max(...years) : 0;
    const yearSpan = maxYear - minYear;
    const authors = {};
    nodes.forEach(n => (n.authors || []).forEach(a => { authors[a] = (authors[a] || 0) + 1; }));
    const topAuthor = Object.entries(authors).sort((a, b) => b[1] - a[1])[0];
    const maxCited = [...nodes].sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0))[0];
    const bottlenecks = nodes.filter(n => n.is_bottleneck).length;
    const contradictions = edges.filter(e => e.mutation_type === 'contradiction').length;
    const clusterCount = gd?.dna_profile?.clusters?.length || 0;
    const biggestCluster = (gd?.dna_profile?.clusters || []).sort((a, b) => (b.paper_count || b.papers?.length || 0) - (a.paper_count || a.papers?.length || 0))[0];
    const depth2 = nodes.filter(n => n.depth === 2).length;

    // Data-specific lines
    const dataLines = [];
    if (yearSpan > 0) dataLines.push(`This lineage spans ${yearSpan} years. From ${minYear} to ${maxYear}.`);
    if (topAuthor) dataLines.push(`${topAuthor[0]} appears in ${topAuthor[1]} papers. They practically built this field.`);
    if (maxCited) dataLines.push(`The most cited paper here has ${(maxCited.citation_count || 0).toLocaleString()} citations. That's influence.`);
    if (clusterCount) dataLines.push(`${clusterCount} research clusters. Each one a different thread of thinking.`);
    if (bottlenecks) dataLines.push(`${bottlenecks} bottleneck papers. Remove any one and things collapse.`);
    if (contradictions) dataLines.push(`${contradictions} active disputes. Some ideas just can't get along.`);
    if (biggestCluster?.name) dataLines.push(`The ${biggestCluster.name} cluster is the dominant thread.`);
    if (depth2) dataLines.push(`${depth2} papers at depth 2. The grandparents of this lineage.`);

    // Generic lines
    const genericLines = [
      "I'm technically the most interactive feature on this page.",
      "The donut chart next to me has no personality. Just colors spinning.",
      "That eye from Blind Spots keeps staring at me. Unsettling.",
      "I should charge rent for this dot position.",
      "None of the other charts can talk. Think about that.",
      "The constellation in Architects is pretty. But can it wave?",
      "I bet the momentum gauge doesn't have a coffee break animation.",
      "You've been looking at the graph for a while. Need help?",
      "Have you tried the Pathfinder yet? That's where I really shine.",
      "I can find your position in this lineage. Just ask.",
      "Click the window button if you want a real conversation.",
      "You know I can analyze your research, right? Not just sit here.",
      "Still exploring? Take your time. I'll be here.",
      "I wonder if the genealogy story mentions me. Probably not.",
      "If I had a citation for every cup of coffee...",
      "The orbital system is beautiful. But it can't judge your research.",
      "Someone should tell the diversity radar it's not a compass.",
      "I bet none of the other visualizations fall asleep on the job.",
      "I've been reading these papers all day. Send help.",
      "Fun fact: I'm the only feature here with a personality.",
      "The idea flow chart has mutations. I have opinions.",
      "I tried talking to the donut chart once. It just spun.",
      "The power distribution bar is very... horizontal. That's all it does.",
    ];

    // Combine and shuffle
    const all = [...dataLines, ...genericLines];
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    this._linePool = all;
    this._poolIndex = 0;
  },

  _getNextLine() {
    if (!this._linePool.length || this._poolIndex >= this._linePool.length) {
      this._buildLinePool();
    }
    return this._linePool[this._poolIndex++];
  },

  _scheduleNext() {
    const delay = 25000 + Math.random() * 20000; // 25-45 seconds
    this._timer = setTimeout(() => {
      this._speak();
      this._scheduleNext();
    }, delay);
  },

  _speak() {
    const char = window._compactResearcherCharacter;
    if (!char) return;

    // Only speak when:
    // 1. Dot 3 is active (user can see the character)
    // 2. No Arivu window is open
    // 3. Character is not sleeping, angry, or in portal
    // 4. Character is in idle state (sitting, reading, coffee)

    const activeDot = document.querySelector('.pagination-dots .dot.active');
    const dotIndex = activeDot ? [...activeDot.parentElement.children].indexOf(activeDot) : -1;
    // Check if we're in the DNA container and dot 3 is active
    const dnaSection = document.getElementById('dna-section');
    const dnaDots = dnaSection?.querySelectorAll('.pagination-dots .dot');
    const isDot3Active = dnaDots && dnaDots[3]?.classList.contains('active');

    if (!isDot3Active) return;

    // Check no windows are open
    const openWindows = document.querySelectorAll('.arivu-window:not([style*="display: none"])');
    if (openWindows.length > 0) return;

    // Check character state
    if (!['sitting', 'reading', 'coffee'].includes(char.state)) return;

    // Check if character is portaled away
    if (window._researcherInWindow) return;

    const line = this._getNextLine();
    if (line) {
      char.say(line, 4000);
    }
  },

  stop() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
};

// Start ambient personality when graph loads
window.addEventListener('arivu:graph-loaded', () => {
  setTimeout(() => AmbientPersonality.init(), 10000); // wait 10s after graph load
});

// Cleanup all timers on page unload
window.addEventListener('beforeunload', () => {
  AmbientPersonality.stop();
  AutoWakeSystem.reset();
  if (RightPanelReactions._observer) {
    RightPanelReactions._observer.disconnect();
    RightPanelReactions._observer = null;
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 9 — AUTO-WAKE SYSTEM (escalating sleep)
// ═══════════════════════════════════════════════════════════════════════════

const AutoWakeSystem = {
  _wakeCount: 0,
  _timer: null,

  WAKE_LINES_LIGHT: [
    "Wh... I wasn't sleeping!",
    "*blink* ...what year is it?",
    "I was just resting my eyes!",
    "I'm awake! I was just... thinking deeply.",
    "Did I snore? Please say no.",
  ],

  WAKE_LINES_MEDIUM: [
    "*yawn* ...where was I?",
    "Okay, I'm up. For real this time.",
    "These papers are... heavy reading. Literally.",
    "Coffee. I need coffee.",
    "Right. Papers. Research. I'm on it.",
  ],

  WAKE_LINES_DEEP: [
    "WHAT?! Oh. It's you. Hi.",
    "I was having the best dream about citations...",
    "Fine fine, I'm awake. What do you need?",
    "You could have let me sleep. But okay.",
  ],

  onSleep() {
    this._wakeCount++;
    if (this._wakeCount === 1) {
      // Light sleep: auto-wake in 15-30s
      this._timer = setTimeout(() => this._autoWake('light'), 15000 + Math.random() * 15000);
    } else if (this._wakeCount === 2) {
      // Medium sleep: auto-wake in 30-45s
      this._timer = setTimeout(() => this._autoWake('medium'), 30000 + Math.random() * 15000);
    }
    // Deep sleep (3+): stay asleep until clicked
  },

  _autoWake(tier) {
    const char = window._compactResearcherCharacter;
    if (!char || char.state !== 'sleeping') return;

    const lines = tier === 'light' ? this.WAKE_LINES_LIGHT : this.WAKE_LINES_MEDIUM;
    const line = lines[Math.floor(Math.random() * lines.length)];

    char._setZzz(false);
    char._goTo('startled', 200);
    char.say(line, 3000);
    setTimeout(() => {
      char.state = 'sitting';
      char._goTo('typing', 600);
      char._resetIdle();
      char.hintEl.textContent = 'hover to say hello · click to interact';
    }, 3500);
  },

  reset() {
    this._wakeCount = 0;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
};

// Hook into character sleep state — poll until character exists
{
  let _hookAttempts = 0;
  const _tryHookAutoWake = () => {
    const char = window._compactResearcherCharacter;
    if (char && char._setState && !char._autoWakeHooked) {
      const origSetState = char._setState.bind(char);
      char._setState = function(ns) {
        origSetState(ns);
        if (ns === 'sleeping') AutoWakeSystem.onSleep();
        if (ns === 'startled') AutoWakeSystem.reset();
      };
      char._autoWakeHooked = true;
      return;
    }
    if (++_hookAttempts < 60) { // try for up to 30 seconds
      setTimeout(_tryHookAutoWake, 500);
    }
  };
  window.addEventListener('arivu:graph-loaded', () => {
    _hookAttempts = 0;
    _tryHookAutoWake();
  });
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 10 — RIGHT PANEL SCROLL REACTIONS
// ═══════════════════════════════════════════════════════════════════════════

const RightPanelReactions = {
  _observer: null,
  _lastReaction: 0,

  REACTIONS: {
    'pruning-section': [
      "Pruning! That's the dramatic one.",
      "Removing papers and watching things collapse. Classic.",
    ],
    'orphan-section': [
      "Orphan ideas. Papers nobody follows up on.",
      "Some of those orphans might be hidden gems.",
    ],
    'coverage-section': [
      "Data coverage tells you how much we actually know vs guess.",
      "The higher the coverage, the more I trust my analysis.",
    ],
  },

  init() {
    if (this._observer) return;

    const sections = ['pruning-section', 'orphan-section', 'coverage-section'];
    const targets = sections.map(id => document.getElementById(id)).filter(Boolean);
    if (!targets.length) return;

    this._observer = new IntersectionObserver((entries) => {
      const now = Date.now();
      if (now - this._lastReaction < 15000) return; // 15s cooldown

      for (const entry of entries) {
        if (entry.isIntersecting) {
          const sectionId = entry.target.id;
          const lines = this.REACTIONS[sectionId];
          if (lines?.length) {
            const char = window._compactResearcherCharacter;
            if (!char || !['sitting', 'reading', 'coffee'].includes(char.state)) return;

            // Only react if dot 3 is visible
            const dnaSection = document.getElementById('dna-section');
            const dnaDots = dnaSection?.querySelectorAll('.pagination-dots .dot');
            const isDot3Active = dnaDots && dnaDots[3]?.classList.contains('active');
            if (!isDot3Active) return;

            const line = lines[Math.floor(Math.random() * lines.length)];
            char.say(line, 4000);
            this._lastReaction = now;
          }
        }
      }
    }, { threshold: 0.3 });

    targets.forEach(t => this._observer.observe(t));
  }
};

// Init scroll reactions after graph loads
window.addEventListener('arivu:graph-loaded', () => {
  setTimeout(() => RightPanelReactions.init(), 5000);
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 11 — USER ACTION REACTIONS
// ═══════════════════════════════════════════════════════════════════════════

// Pruning reaction
window.addEventListener('arivu:prune-executed', () => {
  const char = window._compactResearcherCharacter;
  if (!char || !['sitting', 'reading', 'coffee'].includes(char.state)) return;
  const lines = [
    "Bold move. Let's see what collapses.",
    "Removing that one? Interesting choice.",
    "I always find pruning dramatic. Like research surgery.",
  ];
  char.say(lines[Math.floor(Math.random() * lines.length)], 4000);
});
