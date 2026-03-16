/**
 * static/js/time-machine.js
 * TimeMachineController — D3.js timeline showing field evolution year-by-year.
 * Fetches data from /api/time-machine/<seedPaperId>, renders interactive
 * timeline with play/pause, year slider, vocabulary heatmap, extinction events.
 *
 * Dependencies: D3.js v7 (loaded globally in base.html)
 */

class TimeMachineController {
  /**
   * @param {HTMLElement} container - DOM element for the timeline
   * @param {string} seedPaperId - Seed paper Semantic Scholar ID
   */
  constructor(container, seedPaperId) {
    this.container = container;
    this.seedPaperId = seedPaperId;
    this.data = null;
    this.svg = null;
    this.playing = false;
    this.currentYear = null;
    this.minYear = null;
    this.maxYear = null;
    this._playInterval = null;
    this._destroyed = false;
  }

  /**
   * Initialize: fetch data and render the full timeline UI.
   * @param {HTMLElement} graphContainer - Graph container (used for sizing)
   * @param {string} seedPaperId - Seed paper ID
   */
  async init(graphContainer, seedPaperId) {
    this.container = graphContainer || this.container;
    this.seedPaperId = seedPaperId || this.seedPaperId;

    try {
      const resp = await fetch(`/api/time-machine/${this.seedPaperId}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.data = await resp.json();
    } catch (err) {
      console.error('TimeMachine: fetch failed', err);
      this.container.innerHTML = '<p style="color:var(--text-muted);padding:24px;">Could not load Time Machine data.</p>';
      return;
    }

    if (!this.data || !this.data.snapshots || !this.data.snapshots.length) {
      this.container.innerHTML = '<p style="color:var(--text-muted);padding:24px;">No temporal data available.</p>';
      return;
    }

    this.minYear = this.data.snapshots[0].year;
    this.maxYear = this.data.snapshots[this.data.snapshots.length - 1].year;
    this.currentYear = this.minYear;

    this._buildUI();
    this._renderTimeline();
    this._renderSnapshot(this.currentYear);
  }

  /** Build the control panel and SVG containers. */
  _buildUI() {
    this.container.innerHTML = '';
    this.container.style.position = 'relative';

    const controls = document.createElement('div');
    controls.className = 'tm-controls';
    controls.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg-surface);border-radius:8px;margin-bottom:12px;';
    controls.innerHTML = `
      <button id="tm-play-btn" class="tm-btn" aria-label="Play timeline" style="background:var(--accent-gold);color:var(--bg-primary);border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-weight:600;font-size:13px;">
        Play
      </button>
      <input id="tm-slider" type="range" min="${this.minYear}" max="${this.maxYear}" value="${this.minYear}" step="1"
        style="flex:1;accent-color:var(--accent-gold);cursor:pointer;" aria-label="Year slider" />
      <span id="tm-year-label" style="color:var(--accent-gold);font-weight:600;font-size:15px;min-width:40px;text-align:center;">
        ${this.minYear}
      </span>
    `;
    this.container.appendChild(controls);

    const timelineWrap = document.createElement('div');
    timelineWrap.id = 'tm-timeline';
    timelineWrap.style.cssText = 'width:100%;height:120px;';
    this.container.appendChild(timelineWrap);

    const heatmapWrap = document.createElement('div');
    heatmapWrap.id = 'tm-heatmap';
    heatmapWrap.style.cssText = 'width:100%;margin-top:12px;';
    this.container.appendChild(heatmapWrap);

    const extinctionWrap = document.createElement('div');
    extinctionWrap.id = 'tm-extinctions';
    extinctionWrap.style.cssText = 'margin-top:12px;';
    this.container.appendChild(extinctionWrap);

    // Wire controls
    document.getElementById('tm-play-btn').addEventListener('click', () => this._togglePlay());
    document.getElementById('tm-slider').addEventListener('input', (e) => {
      this.currentYear = parseInt(e.target.value, 10);
      document.getElementById('tm-year-label').textContent = this.currentYear;
      this._renderSnapshot(this.currentYear);
    });
  }

  /** Render the main timeline bar chart showing paper counts per year. */
  _renderTimeline() {
    const wrap = document.getElementById('tm-timeline');
    if (!wrap) return;
    const snapshots = this.data.snapshots;
    const width = wrap.clientWidth || 600;
    const height = 110;
    const margin = { top: 10, right: 16, bottom: 24, left: 40 };

    const svg = d3.select(wrap).append('svg')
      .attr('width', width).attr('height', height)
      .attr('role', 'img').attr('aria-label', 'Papers per year timeline');

    const x = d3.scaleBand()
      .domain(snapshots.map(s => s.year))
      .range([margin.left, width - margin.right])
      .padding(0.2);

    const maxCount = d3.max(snapshots, s => s.paper_count || 0) || 1;
    const y = d3.scaleLinear()
      .domain([0, maxCount])
      .range([height - margin.bottom, margin.top]);

    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).tickValues(
        snapshots.filter((_, i) => i % Math.max(1, Math.floor(snapshots.length / 10)) === 0).map(s => s.year)
      ))
      .selectAll('text').attr('fill', 'var(--text-muted)').attr('font-size', '10px');

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(4))
      .selectAll('text').attr('fill', 'var(--text-muted)').attr('font-size', '10px');

    svg.selectAll('.tm-bar')
      .data(snapshots)
      .join('rect')
      .attr('class', 'tm-bar')
      .attr('x', d => x(d.year))
      .attr('y', d => y(d.paper_count || 0))
      .attr('width', x.bandwidth())
      .attr('height', d => height - margin.bottom - y(d.paper_count || 0))
      .attr('fill', d => d.year === this.currentYear ? 'var(--accent-gold)' : 'var(--accent-blue)')
      .attr('rx', 2)
      .attr('opacity', 0.7);

    // Mark extinction events
    const extinctions = (this.data.extinction_events || []);
    svg.selectAll('.tm-extinction-marker')
      .data(extinctions)
      .join('line')
      .attr('class', 'tm-extinction-marker')
      .attr('x1', d => (x(d.year) || 0) + x.bandwidth() / 2)
      .attr('x2', d => (x(d.year) || 0) + x.bandwidth() / 2)
      .attr('y1', margin.top)
      .attr('y2', height - margin.bottom)
      .attr('stroke', 'var(--danger)')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,3')
      .attr('opacity', 0.6);

    this._timelineSvg = svg;
    this._timelineX = x;
  }

  /** Update the highlighted bar and details for a given year. */
  _renderSnapshot(year) {
    if (this._timelineSvg) {
      this._timelineSvg.selectAll('.tm-bar')
        .attr('fill', d => d.year === year ? 'var(--accent-gold)' : 'var(--accent-blue)');
    }

    const snap = (this.data.snapshots || []).find(s => s.year === year);
    this._renderVocabHeatmap(snap);
    this._renderExtinctions(year);
  }

  /** Render vocabulary heatmap for the current snapshot. */
  _renderVocabHeatmap(snapshot) {
    const wrap = document.getElementById('tm-heatmap');
    if (!wrap) return;
    wrap.innerHTML = '';

    const terms = (snapshot && snapshot.vocabulary) ? snapshot.vocabulary : [];
    if (!terms.length) {
      wrap.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:4px 0;">No vocabulary data for this year.</p>';
      return;
    }

    const heading = document.createElement('div');
    heading.style.cssText = 'color:var(--text-secondary);font-size:12px;font-weight:600;margin-bottom:6px;';
    heading.textContent = 'Key Terms';
    wrap.appendChild(heading);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
    const maxFreq = Math.max(...terms.map(t => t.frequency || 1), 1);

    terms.slice(0, 20).forEach(term => {
      const chip = document.createElement('span');
      const intensity = Math.min((term.frequency || 0) / maxFreq, 1);
      const alpha = (0.2 + intensity * 0.8).toFixed(2);
      chip.style.cssText = `padding:3px 8px;border-radius:4px;font-size:11px;color:var(--text-primary);background:rgba(59,130,246,${alpha});`;
      chip.textContent = term.term || term;
      grid.appendChild(chip);
    });
    wrap.appendChild(grid);
  }

  /** Show extinction events near the current year. */
  _renderExtinctions(year) {
    const wrap = document.getElementById('tm-extinctions');
    if (!wrap) return;
    wrap.innerHTML = '';

    const events = (this.data.extinction_events || []).filter(e => Math.abs(e.year - year) <= 2);
    if (!events.length) return;

    const heading = document.createElement('div');
    heading.style.cssText = 'color:var(--danger);font-size:12px;font-weight:600;margin-bottom:6px;';
    heading.textContent = 'Extinction Events';
    wrap.appendChild(heading);

    events.forEach(evt => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--bg-surface);border-left:3px solid var(--danger);border-radius:4px;padding:8px 12px;margin-bottom:6px;';
      card.innerHTML = `
        <div style="font-size:13px;color:var(--text-primary);font-weight:500;">${this._esc(evt.description || 'Paradigm extinction')}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${evt.year} &mdash; ${evt.affected_papers || 0} papers affected</div>
      `;
      wrap.appendChild(card);
    });
  }

  /** Toggle play/pause animation through years. */
  _togglePlay() {
    const btn = document.getElementById('tm-play-btn');
    if (this.playing) {
      this.playing = false;
      clearInterval(this._playInterval);
      if (btn) btn.textContent = 'Play';
    } else {
      this.playing = true;
      if (btn) btn.textContent = 'Pause';
      if (this.currentYear >= this.maxYear) this.currentYear = this.minYear;
      this._playInterval = setInterval(() => {
        if (this._destroyed) { clearInterval(this._playInterval); return; }
        this.currentYear++;
        if (this.currentYear > this.maxYear) {
          this.currentYear = this.maxYear;
          this._togglePlay();
          return;
        }
        const slider = document.getElementById('tm-slider');
        if (slider) slider.value = this.currentYear;
        document.getElementById('tm-year-label').textContent = this.currentYear;
        this._renderSnapshot(this.currentYear);
      }, 600);
    }
  }

  /** Escape HTML to prevent XSS. */
  _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Tear down all DOM and intervals. */
  destroy() {
    this._destroyed = true;
    if (this._playInterval) clearInterval(this._playInterval);
    if (this.container) this.container.innerHTML = '';
    this.svg = null;
    this.data = null;
  }
}
