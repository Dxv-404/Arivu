/**
 * static/js/window-manager-intel.js
 * Intelligence window rendering — extends WindowManager with 6 new window types.
 * Reads computed data from DeepIntel (deep-intelligence.js) and renders HTML.
 *
 * Windows: architects, idea-flow, momentum, blind-spots, research-gps, trust-evidence
 */

(function () {
  'use strict';

  // Guard: WindowManager must exist before extending
  if (typeof WindowManager === 'undefined') {
    console.warn('[Intel] WindowManager not found — intel windows disabled');
    return;
  }

  const _origPopulate = WindowManager.prototype._populateWindow;
  const _origGetTitle = WindowManager.prototype._getTitle;
  const _origGetSize = WindowManager.prototype._getDefaultSize;

  // ═══════════════════════════════════════════════════════════════════════════
  //  EXTEND WINDOW MANAGER
  // ═══════════════════════════════════════════════════════════════════════════

  WindowManager.prototype._getTitle = function (type) {
    const intelTitles = {
      'architects': 'ARCHITECTS',
      'idea-flow': 'IDEA FLOW',
      'momentum': 'MOMENTUM TRACKER',
      'blind-spots': 'BLIND SPOTS & BATTLES',
      'research-gps': 'YOUR RESEARCH GPS',
      'trust-evidence': 'TRUST & EVIDENCE',
    };
    return intelTitles[type] || _origGetTitle.call(this, type);
  };

  WindowManager.prototype._getDefaultSize = function (type) {
    const intelTypes = ['architects', 'idea-flow', 'momentum', 'blind-spots', 'research-gps', 'trust-evidence'];
    if (intelTypes.includes(type)) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return { width: Math.min(vw * 0.55, 720), height: Math.min(vh * 0.7, 680) };
    }
    return _origGetSize.call(this, type);
  };

  WindowManager.prototype._populateWindow = function (type, windowEl) {
    const body = windowEl.querySelector('.arivu-window-body');

    switch (type) {
      case 'architects':
        if (window.ArchitectsWindow) { window.ArchitectsWindow.populate(body); return; }
        IntelRenderer.renderArchitects(body, this); return;
      case 'idea-flow':
        if (window.IdeaFlowWindow) { window.IdeaFlowWindow.populate(body); return; }
        IntelRenderer.renderIdeaFlow(body, this); return;
      case 'momentum':
        if (window.MomentumWindow) { window.MomentumWindow.populate(body); return; }
        IntelRenderer.renderMomentum(body, this); return;
      case 'blind-spots':    IntelRenderer.renderBlindSpots(body, this); return;
      case 'research-gps':   IntelRenderer.renderGPS(body, this); return;
      case 'trust-evidence':
        if (window.TrustEvidenceWindow) { window.TrustEvidenceWindow.populate(body); return; }
        IntelRenderer.renderTrust(body, this); return;
    }

    _origPopulate.call(this, type, windowEl);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  RENDERER
  // ═══════════════════════════════════════════════════════════════════════════

  const IntelRenderer = {

    // ── HELPERS ──────────────────────────────────────────────────────────────

    _esc(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    },

    _confBadge(tier) {
      const cls = { HIGH: 'conf-high', MEDIUM: 'conf-med', LOW: 'conf-low', SPECULATIVE: 'conf-spec' };
      return `<span class="intel-conf-badge ${cls[tier] || 'conf-spec'}">${tier || 'N/A'}</span>`;
    },

    _bar(value, max, color) {
      const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
      return `<div class="intel-bar"><div class="intel-bar-fill" style="width:${pct}%;background:${color || '#111827'}"></div></div>`;
    },

    _sparkline(data, width, height) {
      if (!data || data.length < 2) return '';
      const max = Math.max(...data, 1);
      const step = width / (data.length - 1);
      const points = data.map((v, i) => `${i * step},${height - (v / max) * height}`).join(' ');
      return `<svg class="intel-sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
        <polyline points="${points}" fill="none" stroke="#111827" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`;
    },

    _paperChip(title, id, year) {
      const short = (title || '').length > 40 ? title.substring(0, 38) + '...' : title;
      return `<button class="intel-paper-chip" data-paper-id="${this._esc(id)}" title="${this._esc(title)}">${this._esc(short)}${year ? ` (${year})` : ''}</button>`;
    },

    _statusBadge(status) {
      const map = {
        'EMERGING': '<span class="intel-status-badge emerging">EMERGING ▲</span>',
        'PEAKING': '<span class="intel-status-badge peaking">PEAKING ●</span>',
        'DECLINING': '<span class="intel-status-badge declining">DECLINING ▼</span>',
        'STABLE': '<span class="intel-status-badge stable">STABLE ─</span>',
        'ACTIVE': '<span class="intel-status-badge battle-active">ACTIVE</span>',
        'RESOLVED': '<span class="intel-status-badge battle-resolved">RESOLVED</span>',
      };
      return map[status] || `<span class="intel-status-badge">${status}</span>`;
    },

    _mutationVerb(type) {
      const verbs = {
        adoption: 'ADOPTED', generalization: 'GENERALIZED', specialization: 'SPECIALIZED',
        hybridization: 'HYBRIDIZED', contradiction: 'CONTRADICTED', revival: 'REVIVED', incidental: 'MENTIONED',
      };
      return verbs[type] || type?.toUpperCase() || '';
    },

    _loading() {
      return `<div class="ai-loading"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>`;
    },

    _attachPaperChipListeners(container) {
      container.addEventListener('click', (e) => {
        const chip = e.target.closest('.intel-paper-chip');
        if (!chip) return;
        const paperId = chip.dataset.paperId;
        if (paperId) {
          window.dispatchEvent(new CustomEvent('arivu:highlight-node', { detail: { paperId } }));
        }
      });
    },

    // ── 1. ARCHITECTS ────────────────────────────────────────────────────────

    renderArchitects(body, wm) {
      const data = window.DeepIntel?.computeArchitects();
      if (!data) { body.innerHTML = '<p class="intel-empty">Build a graph first to see architect analysis.</p>'; return; }

      const { topAuthors, top3Concentration, totalAuthors, generations, constellation } = data;
      const maxPower = topAuthors[0]?.powerScore || 1;

      body.innerHTML = `
        <div class="intel-section-header">
          <h4>WHO BUILT THIS LINEAGE</h4>
          <p class="intel-sub">${totalAuthors} unique authors across this graph</p>
        </div>

        <div class="intel-cards-scroll">
          ${topAuthors.slice(0, 6).map((a, i) => `
            <div class="intel-author-card">
              <div class="intel-author-rank">#${i + 1}</div>
              <div class="intel-author-name">${this._esc(a.name)}</div>
              <div class="intel-author-stats">
                <span>${a.paperCount} paper${a.paperCount !== 1 ? 's' : ''}</span>
                <span>${a.clusterCount} cluster${a.clusterCount !== 1 ? 's' : ''}</span>
                <span>${a.bottleneckCount > 0 ? a.bottleneckCount + ' bottleneck' + (a.bottleneckCount > 1 ? 's' : '') : ''}</span>
              </div>
              ${this._bar(a.powerScore, maxPower, '#111827')}
              <div class="intel-author-impact">${a.avgImpact.toFixed(1)}% avg impact</div>
            </div>
          `).join('')}
        </div>

        ${top3Concentration > 50 ? `
          <div class="intel-alert intel-alert-warning">
            <strong>High Author Concentration</strong> — Top 3 authors control ${top3Concentration}% of structural impact. Fragile lineage if any are disputed.
          </div>
        ` : ''}

        <button class="intel-readmore-btn" id="architects-readmore">Read more &rarr;</button>
      `;

      body.querySelector('#architects-readmore')?.addEventListener('click', () => {
        this._renderArchitectsDetail(body, data, wm);
      });

      this._attachPaperChipListeners(body);
    },

    _renderArchitectsDetail(body, data, wm) {
      const { topAuthors, generations, constellation, top3Concentration, totalAuthors } = data;
      const maxPower = topAuthors[0]?.powerScore || 1;

      body.style.transition = 'opacity 0.2s';
      body.style.opacity = '0';

      setTimeout(() => {
        body.innerHTML = `
          <div class="intel-detail-header">
            <button class="detail-back-btn" id="intel-back">Back</button>
            <h4>ARCHITECTS — Full Analysis</h4>
          </div>

          <div class="intel-detail-section">
            <h5>INFLUENCE ARCHAEOLOGY</h5>
            ${generations.map(gen => `
              <div class="intel-generation">
                <div class="intel-gen-label">${this._esc(gen.label)} (${gen.range[0]}–${gen.range[1]})</div>
                <div class="intel-gen-authors">
                  ${gen.authors.map(a => `
                    <span class="intel-gen-author">${this._esc(a.name)} <em>${a.paperCount}p</em></span>
                  `).join(' · ')}
                </div>
              </div>
            `).join('')}
          </div>

          <div class="intel-detail-section">
            <h5>POWER RANKING</h5>
            <div class="intel-table">
              <div class="intel-table-header">
                <span>Author</span><span>Papers</span><span>Bottleneck</span><span>Avg Impact</span>
              </div>
              ${topAuthors.slice(0, 10).map(a => `
                <div class="intel-table-row">
                  <span class="intel-author-link" data-author="${this._esc(a.name)}">${this._esc(a.name)}</span>
                  <span>${a.paperCount}</span>
                  <span>${a.bottleneckCount}</span>
                  <span>${a.avgImpact.toFixed(1)}%</span>
                </div>
              `).join('')}
            </div>
          </div>

          ${constellation.links.length > 0 ? `
          <div class="intel-detail-section">
            <h5>CO-AUTHORSHIP LINKS</h5>
            <div class="intel-constellation-list">
              ${constellation.links.map(l => `
                <div class="intel-coauthor-link">${this._esc(l.source)} ←→ ${this._esc(l.target)} <em>${l.count}×</em></div>
              `).join('')}
            </div>
          </div>
          ` : ''}
        `;

        body.style.opacity = '1';
        body.querySelector('#intel-back')?.addEventListener('click', () => {
          this.renderArchitects(body, wm);
        });

        // Author name click -> highlight their papers
        body.querySelectorAll('.intel-author-link').forEach(el => {
          el.addEventListener('click', () => {
            const authorName = el.dataset.author;
            const author = topAuthors.find(a => a.name === authorName);
            if (author) {
              author.papers.forEach(pid => {
                window.dispatchEvent(new CustomEvent('arivu:highlight-node', { detail: { paperId: pid } }));
              });
            }
          });
        });
      }, 200);
    },

    // ── 2. IDEA FLOW ─────────────────────────────────────────────────────────

    renderIdeaFlow(body, wm) {
      const data = window.DeepIntel?.computeIdeaFlow();
      if (!data) { body.innerHTML = '<p class="intel-empty">Build a graph first to see idea flow analysis.</p>'; return; }

      const { criticalPath, depthClassification, topology } = data;
      const pathLen = criticalPath.length;
      const span = pathLen > 1 ? Math.abs((criticalPath[0].year || 0) - (criticalPath[pathLen - 1].year || 0)) : 0;
      const avgConf = criticalPath.filter(s => s.confidence != null)
        .reduce((sum, s) => sum + (s.confidence || 0), 0) / Math.max(1, criticalPath.filter(s => s.confidence != null).length);

      body.innerHTML = `
        <div class="intel-section-header">
          <h4>THE CRITICAL PATH</h4>
          <p class="intel-sub">${pathLen - 1} transformation${pathLen - 1 !== 1 ? 's' : ''} · ${span} year span · Avg conf: ${Math.round(avgConf * 100)}%</p>
        </div>

        <div class="intel-critical-path">
          ${criticalPath.map((step, i) => `
            <div class="intel-path-step ${step.isSeed ? 'seed' : ''}">
              ${i > 0 ? `
                <div class="intel-path-connector">
                  <span class="intel-mutation-verb">${this._mutationVerb(step.mutationType)}</span>
                  <span class="intel-mutation-intent">${(step.citationIntent || '').replace(/_/g, ' ')}</span>
                </div>
              ` : ''}
              <div class="intel-path-node">
                ${this._paperChip(step.title, step.nodeId, step.year)}
                ${step.isSeed ? '<span class="intel-seed-star">★ SEED</span>' : ''}
              </div>
            </div>
          `).join('')}
        </div>

        <div class="intel-mini-stats">
          <div class="intel-mini-stat">
            <span class="stat-val">${depthClassification}</span>
            <span class="stat-desc">Foundation type</span>
          </div>
          <div class="intel-mini-stat">
            <span class="stat-val">${topology.type}</span>
            <span class="stat-desc">Topology</span>
          </div>
          <div class="intel-mini-stat">
            <span class="stat-val">${topology.branchPoints}</span>
            <span class="stat-desc">Branches</span>
          </div>
          <div class="intel-mini-stat">
            <span class="stat-val">${topology.deadEnds}</span>
            <span class="stat-desc">Dead ends</span>
          </div>
        </div>

        <button class="intel-readmore-btn" id="ideaflow-readmore">Read more &rarr;</button>
      `;

      body.querySelector('#ideaflow-readmore')?.addEventListener('click', () => {
        this._renderIdeaFlowDetail(body, data, wm);
      });

      this._attachPaperChipListeners(body);
    },

    _renderIdeaFlowDetail(body, data, wm) {
      const { criticalPath, depthImpact, depthClassification, topology } = data;

      body.style.transition = 'opacity 0.2s';
      body.style.opacity = '0';

      setTimeout(() => {
        body.innerHTML = `
          <div class="intel-detail-header">
            <button class="detail-back-btn" id="intel-back">Back</button>
            <h4>IDEA FLOW — Full Analysis</h4>
          </div>

          <div class="intel-detail-section">
            <h5>CRITICAL PATH — With Evidence</h5>
            <div class="intel-path-detailed">
              ${criticalPath.map((step, i) => `
                <div class="intel-path-detail-step">
                  <div class="intel-path-detail-node">
                    <strong>${this._esc((step.title || '').substring(0, 60))}${(step.title || '').length > 60 ? '...' : ''}</strong>
                    <span class="intel-path-year">${step.year || '?'}</span>
                    ${step.isSeed ? '<span class="intel-seed-star">★</span>' : ''}
                  </div>
                  ${i > 0 && step.citingSentence ? `
                    <div class="intel-evidence-block">
                      <div class="intel-evidence-quote">"${this._esc((step.citingSentence || '').substring(0, 150))}..."</div>
                      ${step.citedSentence ? `<div class="intel-evidence-quote cited">"${this._esc((step.citedSentence || '').substring(0, 150))}..."</div>` : ''}
                      <div class="intel-evidence-meta">
                        ${this._confBadge(step.confidenceTier)} · Sim: ${(step.similarity || 0).toFixed(2)}
                      </div>
                    </div>
                  ` : ''}
                  ${i < criticalPath.length - 1 ? '<div class="intel-path-arrow">↓</div>' : ''}
                </div>
              `).join('')}
            </div>
          </div>

          <div class="intel-detail-section">
            <h5>DEPTH × IMPACT</h5>
            <p class="intel-sub">${depthClassification}: highest impact at depth ${data.avgDepthOfTop5}</p>
            <div class="intel-depth-grid">
              ${[0, 1, 2, 3].map(d => {
                const atDepth = depthImpact.filter(n => n.depth === d);
                return `
                  <div class="intel-depth-col">
                    <div class="intel-depth-label">Depth ${d}</div>
                    ${atDepth.slice(0, 3).map(n => `
                      <div class="intel-depth-dot" style="--impact:${Math.min(100, n.impact * 3)}%"
                           title="${this._esc(n.title)} — ${n.impact.toFixed(1)}%">
                        ${n.impact.toFixed(0)}%
                      </div>
                    `).join('')}
                    ${atDepth.length === 0 ? '<div class="intel-depth-empty">—</div>' : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <div class="intel-detail-section">
            <h5>TOPOLOGY</h5>
            <div class="intel-topology-row">
              <div><span class="topo-val">${topology.branchPoints}</span> branch points (ideas diverged)</div>
              <div><span class="topo-val">${topology.mergePoints}</span> merge points (ideas converged)</div>
              <div><span class="topo-val">${topology.deadEnds}</span> dead ends (ideas abandoned)</div>
              <div>Type: <strong>${topology.type}</strong> ${topology.type === 'CONVERGING' ? '(field consolidating)' : topology.type === 'DIVERGING' ? '(field expanding)' : '(balanced)'}</div>
            </div>
          </div>
        `;

        body.style.opacity = '1';
        body.querySelector('#intel-back')?.addEventListener('click', () => {
          this.renderIdeaFlow(body, wm);
        });
        this._attachPaperChipListeners(body);
      }, 200);
    },

    // ── 3. MOMENTUM TRACKER ──────────────────────────────────────────────────

    renderMomentum(body, wm) {
      const data = window.DeepIntel?.computeMomentum();
      if (!data) { body.innerHTML = '<p class="intel-empty">Build a graph first to see momentum analysis.</p>'; return; }

      const { clusterLifecycle, sparklines, convergenceEvents } = data;

      body.innerHTML = `
        <div class="intel-section-header">
          <h4>FIELD PULSE</h4>
          <p class="intel-sub">Knowledge cluster vitality and citation momentum</p>
        </div>

        <div class="intel-lifecycle-list">
          ${clusterLifecycle.map(c => `
            <div class="intel-lifecycle-row">
              <div class="intel-lifecycle-info">
                <span class="intel-cluster-dot" style="background:${c.color}"></span>
                <span class="intel-cluster-name">${this._esc(c.name)}</span>
                ${c.isSeedCluster ? '<span class="intel-seed-star">★</span>' : ''}
              </div>
              <div class="intel-lifecycle-spark">
                ${this._sparkline(c.counts, 60, 20)}
              </div>
              ${this._statusBadge(c.status)}
            </div>
          `).join('')}
        </div>

        ${convergenceEvents.length > 0 ? `
          <div class="intel-convergence-summary">
            <strong>${convergenceEvents.length} convergence event${convergenceEvents.length > 1 ? 's' : ''}</strong>
            ${convergenceEvents.map(e => `<span class="intel-convergence-tag">${e.year}s (${e.edges} connections)</span>`).join('')}
          </div>
        ` : ''}

        <button class="intel-readmore-btn" id="momentum-readmore">Read more &rarr;</button>
      `;

      body.querySelector('#momentum-readmore')?.addEventListener('click', () => {
        this._renderMomentumDetail(body, data, wm);
      });
    },

    _renderMomentumDetail(body, data, wm) {
      const { sparklines, convergence, convergenceEvents, clusterLifecycle } = data;

      body.style.transition = 'opacity 0.2s';
      body.style.opacity = '0';

      setTimeout(() => {
        body.innerHTML = `
          <div class="intel-detail-header">
            <button class="detail-back-btn" id="intel-back">Back</button>
            <h4>MOMENTUM — Full Analysis</h4>
          </div>

          <div class="intel-detail-section">
            <h5>CITATION VELOCITY — Top Papers</h5>
            <div class="intel-velocity-list">
              ${sparklines.map(s => `
                <div class="intel-velocity-row">
                  <div class="intel-velocity-info">
                    ${this._paperChip(s.title, s.id, s.year)}
                    ${s.isSeed ? '<span class="intel-seed-star">★</span>' : ''}
                  </div>
                  <div class="intel-velocity-spark">${this._sparkline(s.sparkData, 50, 16)}</div>
                  <div class="intel-velocity-val">${s.velocity.toLocaleString()}/yr</div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="intel-detail-section">
            <h5>TEMPORAL CONVERGENCE</h5>
            <div class="intel-convergence-chart">
              ${convergence.map(c => {
                const maxP = Math.max(...convergence.map(x => x.papers), 1);
                const maxE = Math.max(...convergence.map(x => x.edges), 1);
                const isEvent = convergenceEvents.some(e => e.year === c.year);
                return `
                  <div class="intel-conv-bar ${isEvent ? 'event' : ''}">
                    <div class="intel-conv-col">
                      <div class="intel-conv-paper-bar" style="height:${(c.papers / maxP) * 50}px"></div>
                      <div class="intel-conv-edge-bar" style="height:${(c.edges / maxE) * 50}px"></div>
                    </div>
                    <span class="intel-conv-year">${c.year}</span>
                    ${isEvent ? '<span class="intel-conv-event-marker">▲</span>' : ''}
                  </div>
                `;
              }).join('')}
            </div>
            <div class="intel-conv-legend">
              <span><span class="legend-box paper"></span> Papers</span>
              <span><span class="legend-box edge"></span> Meaningful edges</span>
              <span><span class="legend-box event"></span> Convergence event</span>
            </div>
          </div>

          <div class="intel-detail-section">
            <h5>LIFECYCLE SUMMARY</h5>
            ${clusterLifecycle.map(c => `
              <div class="intel-lifecycle-detail">
                <span class="intel-cluster-dot" style="background:${c.color}"></span>
                <strong>${this._esc(c.name)}</strong> — ${c.paperCount} papers, ${c.status}
                ${c.isSeedCluster ? ' (your seed paper is here)' : ''}
              </div>
            `).join('')}
          </div>
        `;

        body.style.opacity = '1';
        body.querySelector('#intel-back')?.addEventListener('click', () => {
          this.renderMomentum(body, wm);
        });
        this._attachPaperChipListeners(body);
      }, 200);
    },

    // ── 4. BLIND SPOTS & BATTLES ─────────────────────────────────────────────

    renderBlindSpots(body, wm) {
      const data = window.DeepIntel?.computeBlindSpots();
      if (!data) { body.innerHTML = '<p class="intel-empty">Build a graph first to see blind spot analysis.</p>'; return; }

      const { battles, blindSpots, stats } = data;

      body.innerHTML = `
        <div class="intel-section-header">
          <h4>DISPUTES & GAPS</h4>
        </div>

        <div class="intel-battle-summary">
          ${stats.activeDisputes > 0 ? `<span class="intel-battle-stat active">${stats.activeDisputes} active dispute${stats.activeDisputes > 1 ? 's' : ''}</span>` : ''}
          ${stats.resolvedDisputes > 0 ? `<span class="intel-battle-stat resolved">${stats.resolvedDisputes} resolved</span>` : ''}
          ${stats.blindSpotCount > 0 ? `<span class="intel-battle-stat blind">${stats.blindSpotCount} blind spot${stats.blindSpotCount > 1 ? 's' : ''}</span>` : ''}
          ${stats.totalContradictions === 0 && stats.blindSpotCount === 0 ? '<span class="intel-battle-stat consensus">No disputes — consensus field</span>' : ''}
        </div>

        ${battles.slice(0, 2).map(b => `
          <div class="intel-battle-card ${b.status.toLowerCase()}">
            <div class="intel-battle-status">${this._statusBadge(b.status)}</div>
            <div class="intel-battle-sides">
              <div class="intel-battle-side">
                ${this._paperChip(b.source.title, b.source.id, b.source.year)}
                <span class="intel-cite-count">${(b.source.citations || 0).toLocaleString()} cites</span>
                ${this._bar(b.source.citations, Math.max(b.source.citations, b.target.citations), '#111827')}
              </div>
              <div class="intel-battle-vs">vs</div>
              <div class="intel-battle-side">
                ${this._paperChip(b.target.title, b.target.id, b.target.year)}
                <span class="intel-cite-count">${(b.target.citations || 0).toLocaleString()} cites</span>
                ${this._bar(b.target.citations, Math.max(b.source.citations, b.target.citations), '#6B7280')}
              </div>
            </div>
            ${b.winner ? `<div class="intel-battle-winner">Winner: ${this._esc(b.winner)}</div>` : ''}
          </div>
        `).join('')}

        ${blindSpots.length > 0 ? `
          <div class="intel-blindspot-section">
            <h5>BLIND SPOTS</h5>
            ${blindSpots.slice(0, 2).map(bs => `
              <div class="intel-blindspot-card">
                <strong>${this._esc(bs.field)}</strong>
                <p>${this._esc(bs.reason)}</p>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <button class="intel-readmore-btn" id="blindspots-readmore">Read more &rarr;</button>
      `;

      body.querySelector('#blindspots-readmore')?.addEventListener('click', () => {
        this._renderBlindSpotsDetail(body, data, wm);
      });

      // Fetch missing citations from backend (async, non-blocking)
      this._fetchMissingCitations(data);

      this._attachPaperChipListeners(body);
    },

    _renderBlindSpotsDetail(body, data, wm) {
      const { battles, blindSpots } = data;

      body.style.transition = 'opacity 0.2s';
      body.style.opacity = '0';

      setTimeout(() => {
        body.innerHTML = `
          <div class="intel-detail-header">
            <button class="detail-back-btn" id="intel-back">Back</button>
            <h4>BLIND SPOTS & BATTLES — Full</h4>
          </div>

          <div class="intel-detail-section">
            <h5>ALL CONTRADICTIONS (${battles.length})</h5>
            ${battles.length === 0 ? '<p class="intel-sub">No contradictions found — this is a consensus lineage.</p>' : ''}
            ${battles.map(b => `
              <div class="intel-battle-card-full ${b.status.toLowerCase()}">
                ${this._statusBadge(b.status)}
                <div class="intel-battle-full-sides">
                  <div>
                    ${this._paperChip(b.source.title, b.source.id, b.source.year)}
                    <span class="intel-cite-count">${(b.source.citations || 0).toLocaleString()} citations</span>
                  </div>
                  <span class="intel-vs">vs</span>
                  <div>
                    ${this._paperChip(b.target.title, b.target.id, b.target.year)}
                    <span class="intel-cite-count">${(b.target.citations || 0).toLocaleString()} citations</span>
                  </div>
                </div>
                ${b.citingSentence ? `<div class="intel-evidence-quote">"${this._esc((b.citingSentence || '').substring(0, 200))}"</div>` : ''}
                ${b.winner ? `<div class="intel-battle-winner">Clear winner: ${this._esc(b.winner)}</div>` : ''}
              </div>
            `).join('')}
          </div>

          <div class="intel-detail-section">
            <h5>ALL BLIND SPOTS (${blindSpots.length})</h5>
            ${blindSpots.length === 0 ? '<p class="intel-sub">No significant blind spots detected.</p>' : ''}
            ${blindSpots.map(bs => `
              <div class="intel-blindspot-card">
                <strong>${this._esc(bs.field)}</strong> — ${bs.paperCount} paper${bs.paperCount > 1 ? 's' : ''}, ${bs.edgeCount} connections
                <p>${this._esc(bs.reason)}</p>
              </div>
            `).join('')}
          </div>

          ${data.missingCitations && data.missingCitations.length > 0 ? `
          <div class="intel-detail-section">
            <h5>MISSING CITATIONS (${data.missingCitations.length})</h5>
            <p class="intel-sub">Papers with high semantic similarity but no citation link</p>
            ${data.missingCitations.map(mc => `
              <div class="intel-missing-cite-card">
                ${this._paperChip(mc.paper_a?.title, mc.paper_a?.id, mc.paper_a?.year)}
                <span class="intel-missing-arrow">↛</span>
                ${this._paperChip(mc.paper_b?.title, mc.paper_b?.id, mc.paper_b?.year)}
                <span class="intel-match-pct">${Math.round((mc.similarity || 0) * 100)}% similar</span>
              </div>
            `).join('')}
          </div>
          ` : ''}
        `;

        body.style.opacity = '1';
        body.querySelector('#intel-back')?.addEventListener('click', () => {
          this.renderBlindSpots(body, wm);
        });
        this._attachPaperChipListeners(body);
      }, 200);
    },

    // ── 5. YOUR RESEARCH GPS ─────────────────────────────────────────────────

    renderGPS(body, wm) {
      const roadmapData = window.DeepIntel?.computeReadingRoadmap();

      body.innerHTML = `
        <div class="intel-section-header">
          <h4>YOUR RESEARCH GPS</h4>
          <p class="intel-sub">Position yourself in this lineage</p>
        </div>

        <div class="intel-gps-input">
          <label for="gps-input">Describe your research (keywords or abstract):</label>
          <textarea id="gps-input" class="intel-textarea" rows="3" placeholder="e.g. efficient vision transformer attention pruning mobile"></textarea>
          <button class="intel-action-btn" id="gps-analyze">Analyze My Position</button>
        </div>

        <div id="gps-results" class="intel-gps-results" style="display:none">
          ${this._loading()}
        </div>

        <div class="intel-divider"></div>

        ${roadmapData ? `
          <div class="intel-detail-section">
            <h5>READING ROADMAP</h5>
            <div class="intel-roadmap">
              ${roadmapData.roadmap.map((r, i) => `
                <div class="intel-roadmap-item">
                  <span class="intel-roadmap-num">${i + 1}</span>
                  <div class="intel-roadmap-info">
                    ${this._paperChip(r.title, r.id, r.year)}
                    <span class="intel-roadmap-reason">${this._esc(r.reason)}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          ${roadmapData.citationDebt.length > 0 ? `
          <div class="intel-detail-section">
            <h5>CITATION DEBT</h5>
            <p class="intel-sub">Papers you'd be expected to cite but might miss</p>
            ${roadmapData.citationDebt.map(d => `
              <div class="intel-debt-item">
                ${this._paperChip(d.title, d.id, d.year)}
                <span class="intel-debt-reason">${this._esc(d.reason)}</span>
              </div>
            `).join('')}
          </div>
          ` : ''}
        ` : ''}
      `;

      // GPS analysis button
      body.querySelector('#gps-analyze')?.addEventListener('click', async () => {
        const input = body.querySelector('#gps-input');
        const text = input?.value?.trim();
        if (!text || text.length < 3) return;

        const resultsDiv = body.querySelector('#gps-results');
        resultsDiv.style.display = 'block';
        resultsDiv.innerHTML = this._loading();

        try {
          const graphId = window._graphLoader?._graphData?.metadata?.graph_id
                       || window._graphLoader?._graphData?.metadata?.seed_paper_id;
          if (!graphId) {
            resultsDiv.innerHTML = '<p class="intel-error">Graph ID not available. Please rebuild the graph.</p>';
            return;
          }
          const res = await fetch(`/api/graph/${graphId}/position`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: text }),
          });

          if (!res.ok) throw new Error('Analysis failed');
          const result = await res.json();

          resultsDiv.innerHTML = `
            <div class="intel-gps-result-card">
              <h5>YOUR POSITION</h5>
              <p><strong>Best fit cluster:</strong> ${this._esc(result.cluster || 'Unknown')}</p>
              <p><strong>Relationship to seed:</strong> ${this._esc(result.relationship || 'Similar research area')}</p>
              ${result.mostSimilar ? `
                <p><strong>Most similar paper:</strong></p>
                ${this._paperChip(result.mostSimilar.title, result.mostSimilar.id, result.mostSimilar.year)}
                <span class="intel-match-pct">${Math.round((result.mostSimilar.similarity || 0) * 100)}% match</span>
              ` : ''}
              ${result.gap ? `<p class="intel-gap-note"><strong>Gap you'd fill:</strong> ${this._esc(result.gap)}</p>` : ''}
              ${result.competitors && result.competitors.length > 0 ? `
                <div class="intel-competitors">
                  <h6>COMPETITIVE LANDSCAPE</h6>
                  ${result.competitors.map(c => `
                    <div class="intel-competitor-row">
                      ${this._paperChip(c.title, c.id, c.year)}
                      <span class="intel-match-pct">${Math.round((c.similarity || 0) * 100)}% match</span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `;
        } catch (err) {
          resultsDiv.innerHTML = `<p class="intel-error">Position analysis requires a running backend. Try the Reading Roadmap below for offline guidance.</p>`;
        }
      });

      this._attachPaperChipListeners(body);
    },

    // ── 6. TRUST & EVIDENCE ──────────────────────────────────────────────────

    renderTrust(body, wm) {
      const data = window.DeepIntel?.computeTrustEvidence();
      if (!data) { body.innerHTML = '<p class="intel-empty">Build a graph first to see trust analysis.</p>'; return; }

      const { confDist, textDist, trustedPct, comparablePct, fragility, totalEdges, totalNodes } = data;
      const maxConf = Math.max(confDist.HIGH, confDist.MEDIUM, confDist.LOW, confDist.SPECULATIVE, 1);

      body.innerHTML = `
        <div class="intel-section-header">
          <h4>HOW RELIABLE IS THIS ANALYSIS?</h4>
          <p class="intel-sub">${totalEdges} edges across ${totalNodes} papers analyzed</p>
        </div>

        <div class="intel-trust-bars">
          <div class="intel-trust-row">
            <span class="intel-trust-label">Confidence</span>
            <div class="intel-trust-bar-track">
              <div class="intel-trust-bar-fill trusted" style="width:${trustedPct}%"></div>
            </div>
            <span class="intel-trust-val">${trustedPct}% trusted</span>
          </div>
          <div class="intel-trust-row">
            <span class="intel-trust-label">Comparable</span>
            <div class="intel-trust-bar-track">
              <div class="intel-trust-bar-fill comparable" style="width:${comparablePct}%"></div>
            </div>
            <span class="intel-trust-val">${comparablePct}%</span>
          </div>
        </div>

        <div class="intel-conf-dist">
          ${['HIGH', 'MEDIUM', 'LOW', 'SPECULATIVE'].map(tier => {
            const count = confDist[tier] || 0;
            const pct = totalEdges > 0 ? Math.round((count / totalEdges) * 100) : 0;
            return `
              <div class="intel-conf-row">
                ${this._confBadge(tier)}
                <div class="intel-conf-bar-track">
                  <div class="intel-conf-bar-fill" style="width:${(count / maxConf) * 100}%"></div>
                </div>
                <span>${count} (${pct}%)</span>
              </div>
            `;
          }).join('')}
        </div>

        ${fragility.length > 0 ? `
          <div class="intel-fragility-section">
            <h5>${fragility.length} RISK${fragility.length > 1 ? 'S' : ''} DETECTED</h5>
            ${fragility.map(r => `
              <div class="intel-risk-card ${r.severity}">
                <strong>${this._esc(r.title)}</strong>
                <p>${this._esc(r.description)}</p>
                ${r.paperId ? this._paperChip(r.paperTitle, r.paperId) : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}

        <button class="intel-readmore-btn" id="trust-readmore">Read more &rarr;</button>
      `;

      body.querySelector('#trust-readmore')?.addEventListener('click', () => {
        this._renderTrustDetail(body, data, wm);
      });

      this._attachPaperChipListeners(body);
    },

    _renderTrustDetail(body, data, wm) {
      const { confDist, textDist, highConfTextPct, lowConfTitleOnlyPct, evidenceGallery, totalEdges, totalNodes, fragility, incomparableCount } = data;

      body.style.transition = 'opacity 0.2s';
      body.style.opacity = '0';

      setTimeout(() => {
        const textLabels = { 1: 'Full text + methods', 2: 'Introduction', 3: 'Abstract only', 4: 'Title only' };
        const maxText = Math.max(...Object.values(textDist), 1);

        // Build evidence gallery HTML
        const mutationTypes = Object.keys(evidenceGallery).sort((a, b) => (evidenceGallery[b]?.length || 0) - (evidenceGallery[a]?.length || 0));
        const totalEvidence = mutationTypes.reduce((s, t) => s + (evidenceGallery[t]?.length || 0), 0);

        body.innerHTML = `
          <div class="intel-detail-header">
            <button class="detail-back-btn" id="intel-back">Back</button>
            <h4>TRUST & EVIDENCE — Full</h4>
          </div>

          <div class="intel-detail-section">
            <h5>EVIDENCE QUALITY CROSS-TAB</h5>
            <div class="intel-crosstab">
              <p>${highConfTextPct}% of HIGH/MEDIUM confidence edges had text available for analysis</p>
              <p>${lowConfTitleOnlyPct}% of LOW/SPECULATIVE edges had only title-level matching</p>
              ${incomparableCount > 0 ? `<p>${incomparableCount} edges were incomparable (language mismatch or no text)</p>` : ''}
            </div>
          </div>

          <div class="intel-detail-section">
            <h5>TEXT DEPTH DISTRIBUTION</h5>
            ${[1, 2, 3, 4].map(tier => {
              const count = textDist[tier] || 0;
              const pct = totalNodes > 0 ? Math.round((count / totalNodes) * 100) : 0;
              return `
                <div class="intel-text-row">
                  <span class="intel-text-label">${textLabels[tier]}</span>
                  <div class="intel-conf-bar-track">
                    <div class="intel-conf-bar-fill" style="width:${(count / maxText) * 100}%"></div>
                  </div>
                  <span>${count} (${pct}%)</span>
                </div>
              `;
            }).join('')}
          </div>

          <div class="intel-detail-section">
            <h5>SENTENCE EVIDENCE GALLERY</h5>
            <p class="intel-sub">${totalEvidence} verifiable evidence pairs</p>
            ${mutationTypes.slice(0, 4).map(type => `
              <div class="intel-evidence-type">
                <h6>${type.toUpperCase()} (${evidenceGallery[type].length})</h6>
                ${evidenceGallery[type].slice(0, 2).map(e => `
                  <div class="intel-evidence-pair">
                    <div class="intel-evidence-quote">"${this._esc((e.citingSentence || '').substring(0, 180))}"</div>
                    <div class="intel-evidence-source">— ${this._esc((e.source?.title || '').substring(0, 50))}</div>
                    ${e.citedSentence ? `
                      <div class="intel-evidence-quote cited">"${this._esc((e.citedSentence || '').substring(0, 180))}"</div>
                      <div class="intel-evidence-source">— ${this._esc((e.target?.title || '').substring(0, 50))}</div>
                    ` : ''}
                    <div class="intel-evidence-meta">
                      ${this._confBadge(e.confidence)} · Sim: ${(e.similarity || 0).toFixed(2)}
                    </div>
                  </div>
                `).join('')}
              </div>
            `).join('')}
          </div>

          ${fragility.length > 0 ? `
          <div class="intel-detail-section">
            <h5>FRAGILITY REPORT</h5>
            ${fragility.map(r => `
              <div class="intel-risk-card ${r.severity}">
                <strong>${this._esc(r.title)}</strong>
                <p>${this._esc(r.description)}</p>
              </div>
            `).join('')}
          </div>
          ` : ''}
        `;

        body.style.opacity = '1';
        body.querySelector('#intel-back')?.addEventListener('click', () => {
          this.renderTrust(body, wm);
        });
        this._attachPaperChipListeners(body);
      }, 200);
    },

    async _fetchMissingCitations(blindSpotsData) {
      try {
        const graphId = window._graphLoader?._graphData?.metadata?.graph_id;
        if (!graphId) return;

        const res = await fetch(`/api/graph/${graphId}/missing-citations`);
        if (!res.ok) return;
        const result = await res.json();
        if (result.missing && result.missing.length > 0) {
          blindSpotsData.missingCitations = result.missing;
          // Update cache
          if (window.DeepIntel) {
            window.DeepIntel._setCache('blindSpots', blindSpotsData);
          }
        }
      } catch (err) {
        // Non-blocking — missing citations is a bonus feature
      }
    },

  }; // end IntelRenderer

  // Make renderer accessible for debugging
  window._IntelRenderer = IntelRenderer;

})();
