/**
 * static/js/panels.js
 * RightPanel — DNA donut chart, diversity radar, pruning stats, orphan cards.
 */

class RightPanel {
  constructor() {
    this._dnaChart = null;
    this._diversityChart = null;
  }

  renderDNAProfile(dnaProfile) {
    if (!dnaProfile || !dnaProfile.clusters || !dnaProfile.clusters.length) return;
    window._dnaChart = new DNAChart('dna-donut-chart');
    window._dnaChart.render(dnaProfile);
  }

  renderDiversityScore(diversityScore) {
    if (!diversityScore) return;
    const ctx = document.getElementById('diversity-radar-chart');
    if (!ctx) return;

    if (this._diversityChart) this._diversityChart.destroy();

    // Detect light vs dark theme for correct chart colors
    const isLight = !!document.querySelector('.tool-layout-v2');
    const accentColor = isLight ? '#111827' : '#D4A843';
    const accentBg = isLight ? 'rgba(17,24,39,0.08)' : 'rgba(212,168,67,0.15)';
    const gridColor = isLight ? '#E5E7EB' : '#263548';
    const tickColor = isLight ? '#9CA3AF' : '#64748B';
    const labelColor = isLight ? '#6B7280' : '#94A3B8';

    this._diversityChart = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: ['Field Diversity', 'Temporal Span', 'Concept Clusters', 'Citation Balance'],
        datasets: [{
          label: 'Intellectual Diversity',
          data: [
            diversityScore.field_diversity,
            diversityScore.temporal_span,
            diversityScore.concept_diversity,
            diversityScore.citation_entropy
          ],
          backgroundColor: accentBg,
          borderColor: accentColor,
          pointBackgroundColor: accentColor,
          pointRadius: 4,
        }]
      },
      options: {
        responsive: true,
        scales: {
          r: {
            min: 0, max: 100,
            ticks: { stepSize: 25, color: tickColor, font: { size: 10 } },
            grid: { color: gridColor },
            pointLabels: { color: labelColor, font: { size: 11 } }
          }
        },
        plugins: { legend: { display: false } }
      }
    });

    const scoreEl = document.getElementById('diversity-score-number');
    if (scoreEl) scoreEl.textContent = Math.round(diversityScore.overall);
    const noteEl = document.getElementById('diversity-context-note');
    if (noteEl) noteEl.textContent = diversityScore.contextual_note || '';
  }

  renderPruningStats(result) {
    const panel = document.getElementById('prune-stats-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    document.getElementById('prune-impact-pct').textContent = `${result.impact_percentage?.toFixed(1)}%`;
    document.getElementById('prune-collapsed-count').textContent = result.collapsed_count;
    document.getElementById('prune-survived-count').textContent = result.survived_count;
  }

  populateLeaderboard(leaderboard) {
    const list = document.getElementById('leaderboard-list');
    if (!list || !leaderboard) return;
    list.innerHTML = leaderboard.slice(0, 10).map((entry, i) => `
      <li>
        <span class="leaderboard-rank">#${i+1}</span>
        <div class="leaderboard-info">
          <div class="leaderboard-title">${entry.title || entry.paper_id}</div>
          <div class="leaderboard-impact">${entry.collapse_count} papers depend on this (${entry.impact_pct}%)</div>
        </div>
      </li>
    `).join('');
  }

  populateOrphans(orphans) {
    const container = document.getElementById('orphan-cards-container');
    if (!container) return;
    container.innerHTML = '';
    if (!orphans || orphans.length === 0) {
      container.innerHTML = '<p style="padding:12px;color:var(--text-muted);font-size:0.85rem">No orphan ideas detected in this graph.</p>';
      return;
    }
    for (const orphan of orphans) {
      container.appendChild(createOrphanCard(orphan));
    }
  }
}

class DNAChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.chart = null;
    this.beforeSnapshot = null;
  }

  render(dnaProfile) {
    const labels = dnaProfile.clusters.map(c => c.name);
    const data = dnaProfile.clusters.map(c => c.percentage);
    const colors = dnaProfile.clusters.map(c => c.color);

    if (this.chart) {
      this.chart.data.labels = labels;
      this.chart.data.datasets[0].data = data;
      this.chart.data.datasets[0].backgroundColor = colors;
      this.chart.update('active');
    } else {
      const isLight = !!document.querySelector('.tool-layout-v2');
      const borderCol = isLight ? '#FFFFFF' : '#0a0e17';
      const legendColor = isLight ? '#6B7280' : '#94A3B8';

      this.chart = new Chart(this.canvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: borderCol, borderWidth: 2, hoverOffset: 8 }] },
        options: {
          responsive: true,
          cutout: '65%',
          animation: { duration: 600, easing: 'easeInOutQuart' },
          plugins: {
            legend: { position: 'bottom', labels: { color: legendColor, boxWidth: 12, padding: 8, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed.toFixed(1)}%` } }
          },
          onHover: (event, elements) => {
            if (elements.length) {
              const name = this.chart.data.labels[elements[0].index];
              window.dispatchEvent(new CustomEvent('arivu:highlight-cluster', { detail: { clusterName: name } }));
            }
          }
        }
      });
    }
  }

  takeSnapshot() {
    if (!this.chart) return;
    this.beforeSnapshot = {
      labels: [...this.chart.data.labels],
      data: [...this.chart.data.datasets[0].data],
      colors: [...this.chart.data.datasets[0].backgroundColor]
    };
  }

  renderComparison(afterProfileClusters) {
    const panel = document.getElementById('dna-comparison');
    if (panel) panel.style.display = 'flex';
    const beforeCtx = document.getElementById('dna-before-chart');
    if (beforeCtx && this.beforeSnapshot) {
      // Destroy any previous comparison chart on this canvas
      if (this._beforeCompChart) { try { this._beforeCompChart.destroy(); } catch(e) {} }
      this._beforeCompChart = new Chart(beforeCtx, {
        type: 'doughnut',
        data: { labels: this.beforeSnapshot.labels, datasets: [{ data: this.beforeSnapshot.data, backgroundColor: this.beforeSnapshot.colors }] },
        options: { responsive: true, plugins: { legend: { display: false } }, animation: false }
      });
    }
    if (afterProfileClusters) {
      this.render({ clusters: Object.entries(afterProfileClusters).map(([name, pct], i) => ({
        name, percentage: pct, color: this.beforeSnapshot?.colors[i] || '#648FFF'
      })) });
    }
  }

  resetComparison() {
    const panel = document.getElementById('dna-comparison');
    if (panel) panel.style.display = 'none';

    // Restore the original donut chart data.
    // renderComparison() updates the main donut with "after" pruning data,
    // so we must revert it from the snapshot taken before pruning.
    if (this.beforeSnapshot && this.chart) {
      this.chart.data.labels = this.beforeSnapshot.labels;
      this.chart.data.datasets[0].data = this.beforeSnapshot.data;
      this.chart.data.datasets[0].backgroundColor = this.beforeSnapshot.colors;
      this.chart.update('active');
    }
    this.beforeSnapshot = null;
  }
}

// ─── Orphan card + sparkline ────────────────────────────────────────────────

function createOrphanCard(orphan) {
  const card = document.createElement('div');
  card.className = 'orphan-card';
  // Support both flat (backend) and nested (paper.paper_id) formats
  const paperId = orphan.paper_id || orphan.paper?.paper_id || '';
  card.dataset.paperId = paperId;

  const relevancePct = Math.round((orphan.relevance_score || 0) * 100);
  const declinePct = Math.round((orphan.decline_rate || 0) * 100);

  const esc = s => String(s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const title = orphan.title || orphan.paper?.title || 'Unknown';
  const year = orphan.year || orphan.paper?.year || '';
  const citations = orphan.citation_count || 0;

  card.innerHTML = `
    <div class="orphan-concept">"${esc(truncate(title, 60))}"</div>
    <div class="orphan-meta">
      <span class="orphan-paper">${year} · ${citations} citations</span>
      <span class="orphan-peak">Peak: ${orphan.peak_year || '?'} · Decline: ${declinePct}%</span>
    </div>
    <div class="orphan-sparkline"></div>
    <div class="orphan-stats">
      <span>Fields: ${(orphan.fields_of_study || []).join(', ') || 'N/A'}</span>
      <span class="orphan-relevance" title="Orphan relevance score">Relevance: ${relevancePct}%</span>
    </div>
    <button class="orphan-highlight-btn">Highlight in graph</button>
  `;

  // Sparkline only renders if trajectory data is provided
  renderSparkline(card.querySelector('.orphan-sparkline'), orphan.trajectory || []);

  card.querySelector('.orphan-highlight-btn').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('arivu:highlight-node', {
      detail: { paperId }
    }));
  });

  return card;
}

function renderSparkline(container, trajectoryData) {
  if (!container || !trajectoryData.length) return;
  const width = 200, height = 40, padding = 4;
  const counts = trajectoryData.map(d => d.count || 0);
  const maxCount = Math.max(...counts, 1);

  // Theme-aware sparkline colors
  const isLight = !!document.querySelector('.tool-layout-v2');
  const lineColor = isLight ? '#374151' : '#D4A843';
  const areaColor = isLight ? '#37415115' : '#D4A84320';

  const xScale = i => padding + (i / Math.max(counts.length - 1, 1)) * (width - 2*padding);
  const yScale = v => height - padding - (v / maxCount) * (height - 2*padding);
  const points = counts.map((c,i) => `${xScale(i)},${yScale(c)}`).join(' ');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width); svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');

  const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  area.setAttribute('points', `${xScale(0)},${height} ${points} ${xScale(counts.length-1)},${height}`);
  area.setAttribute('fill', areaColor); svg.appendChild(area);

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points); line.setAttribute('fill', 'none');
  line.setAttribute('stroke', lineColor); line.setAttribute('stroke-width', '1.5');
  svg.appendChild(line); container.appendChild(svg);
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}
