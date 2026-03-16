/**
 * static/js/insight-feed.js
 * InsightFeed — Fetches insights from /api/insights/<seedPaperId>,
 * renders insight cards with severity badges (high=red, medium=blue, low=gray).
 * Each card has action text and optional metadata.
 *
 * Dependencies: none (vanilla JS)
 */

class InsightFeed {
  /**
   * @param {string} containerId - ID of the DOM element to render into
   * @param {string} seedPaperId - Seed paper Semantic Scholar ID
   */
  constructor(containerId, seedPaperId) {
    this.container = document.getElementById(containerId);
    this.seedPaperId = seedPaperId || '';
    this.insights = [];
    this._destroyed = false;
  }

  /**
   * Fetch insights and render them.
   * @param {string} [seedPaperId] - Override seed paper ID
   */
  async render(seedPaperId) {
    if (this._destroyed) return;
    if (seedPaperId) this.seedPaperId = seedPaperId;
    if (!this.container) return;

    this.container.innerHTML = '';

    // Loading state
    var loading = document.createElement('div');
    loading.style.cssText = 'padding:16px;text-align:center;color:var(--text-muted);font-size:12px;';
    loading.textContent = 'Loading insights...';
    this.container.appendChild(loading);

    try {
      var resp = await fetch('/api/insights/' + encodeURIComponent(this.seedPaperId));
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      this.insights = data.insights || data.items || [];
      if (Array.isArray(data) && !data.insights) this.insights = data;
    } catch (err) {
      console.error('InsightFeed: fetch failed', err);
      this.container.innerHTML = '<p style="color:var(--text-muted);padding:16px;font-size:12px;">Could not load insights.</p>';
      return;
    }

    this._renderInsights();
  }

  /** Render the list of insight cards. */
  _renderInsights() {
    if (!this.container || this._destroyed) return;
    this.container.innerHTML = '';

    if (!this.insights || this.insights.length === 0) {
      this.container.innerHTML = '<p style="color:var(--text-muted);padding:16px;font-size:12px;">No insights available for this graph.</p>';
      return;
    }

    var panel = document.createElement('div');
    panel.className = 'insight-feed';
    panel.setAttribute('role', 'feed');
    panel.setAttribute('aria-label', 'Research insights');
    panel.style.cssText = 'padding:8px;';

    var heading = document.createElement('h3');
    heading.style.cssText = 'color:var(--text-primary);font-size:14px;font-weight:600;margin:0 0 10px 4px;';
    heading.textContent = 'Insights (' + this.insights.length + ')';
    panel.appendChild(heading);

    // Filter bar
    var filterBar = document.createElement('div');
    filterBar.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;padding:0 4px;';
    var self = this;
    var severities = ['all', 'high', 'medium', 'low'];
    severities.forEach(function(sev) {
      var btn = document.createElement('button');
      btn.className = 'insight-filter-btn';
      btn.dataset.severity = sev;
      btn.textContent = sev.charAt(0).toUpperCase() + sev.slice(1);
      btn.style.cssText = 'padding:3px 10px;border-radius:4px;border:1px solid var(--bg-elevated);background:var(--bg-surface);color:var(--text-secondary);font-size:11px;cursor:pointer;transition:all 0.2s;';
      btn.addEventListener('click', function() { self._filterBySeverity(sev); });
      filterBar.appendChild(btn);
    });
    panel.appendChild(filterBar);

    // Insight cards container
    var cardsContainer = document.createElement('div');
    cardsContainer.id = 'insight-cards-container';
    panel.appendChild(cardsContainer);

    this.container.appendChild(panel);
    this._renderCards(this.insights, cardsContainer);
  }

  /**
   * Render individual insight cards.
   * @param {Array} insights - Filtered list of insights
   * @param {HTMLElement} container - Cards container element
   */
  _renderCards(insights, container) {
    if (!container) container = document.getElementById('insight-cards-container');
    if (!container) return;
    container.innerHTML = '';

    var self = this;
    insights.forEach(function(insight, index) {
      var card = document.createElement('div');
      card.className = 'insight-card';
      card.setAttribute('role', 'article');
      card.style.cssText = [
        'background:var(--bg-surface);border-radius:8px;padding:12px;margin-bottom:8px;',
        'border-left:3px solid ' + self._severityColor(insight.severity) + ';',
        'transition:background 0.2s;cursor:default;',
      ].join('');

      // Severity badge
      var badge = document.createElement('span');
      badge.className = 'insight-severity-badge';
      badge.style.cssText = [
        'display:inline-block;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:600;',
        'text-transform:uppercase;letter-spacing:0.5px;',
        'background:' + self._severityBg(insight.severity) + ';',
        'color:' + self._severityColor(insight.severity) + ';',
      ].join('');
      badge.textContent = insight.severity || 'low';

      // Type tag
      var typeTag = '';
      if (insight.type) {
        typeTag = '<span style="color:var(--text-muted);font-size:10px;margin-left:8px;">' + self._esc(insight.type) + '</span>';
      }

      // Title
      var title = document.createElement('div');
      title.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
      title.appendChild(badge);
      if (insight.type) {
        var typeSpan = document.createElement('span');
        typeSpan.style.cssText = 'color:var(--text-muted);font-size:10px;';
        typeSpan.textContent = insight.type;
        title.appendChild(typeSpan);
      }
      card.appendChild(title);

      // Description
      var desc = document.createElement('div');
      desc.style.cssText = 'color:var(--text-primary);font-size:12px;line-height:1.5;margin-bottom:6px;';
      desc.textContent = insight.description || insight.text || insight.message || '';
      card.appendChild(desc);

      // Action text
      if (insight.action) {
        var action = document.createElement('div');
        action.style.cssText = 'color:var(--accent-teal);font-size:11px;font-weight:500;';
        action.textContent = insight.action;
        card.appendChild(action);
      }

      // Affected papers
      if (insight.affected_papers && insight.affected_papers.length > 0) {
        var affected = document.createElement('div');
        affected.style.cssText = 'color:var(--text-muted);font-size:10px;margin-top:4px;';
        affected.textContent = 'Affects: ' + insight.affected_papers.slice(0, 3).join(', ');
        if (insight.affected_papers.length > 3) {
          affected.textContent += ' +' + (insight.affected_papers.length - 3) + ' more';
        }
        card.appendChild(affected);
      }

      card.addEventListener('mouseenter', function() { card.style.background = 'var(--bg-elevated)'; });
      card.addEventListener('mouseleave', function() { card.style.background = 'var(--bg-surface)'; });

      container.appendChild(card);
    });

    if (insights.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);padding:10px;font-size:12px;">No insights match this filter.</p>';
    }
  }

  /**
   * Filter insights by severity level.
   * @param {string} severity - 'all', 'high', 'medium', or 'low'
   */
  _filterBySeverity(severity) {
    var filtered = severity === 'all'
      ? this.insights
      : this.insights.filter(function(i) { return (i.severity || 'low') === severity; });

    // Update button states
    var buttons = this.container.querySelectorAll('.insight-filter-btn');
    buttons.forEach(function(btn) {
      var isActive = btn.dataset.severity === severity;
      btn.style.background = isActive ? 'var(--accent-blue)' : 'var(--bg-surface)';
      btn.style.color = isActive ? '#fff' : 'var(--text-secondary)';
      btn.style.borderColor = isActive ? 'var(--accent-blue)' : 'var(--bg-elevated)';
    });

    this._renderCards(filtered);
  }

  /**
   * Get color for a severity level.
   * @param {string} severity
   * @returns {string}
   */
  _severityColor(severity) {
    var colors = { high: 'var(--danger)', medium: 'var(--accent-blue)', low: 'var(--text-muted)' };
    return colors[severity] || colors.low;
  }

  /**
   * Get background color for severity badge.
   * @param {string} severity
   * @returns {string}
   */
  _severityBg(severity) {
    var bgs = { high: 'rgba(239,68,68,0.15)', medium: 'rgba(59,130,246,0.15)', low: 'rgba(100,116,139,0.15)' };
    return bgs[severity] || bgs.low;
  }

  /**
   * Escape HTML special characters.
   * @param {string} str
   * @returns {string}
   */
  _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Tear down the feed. */
  destroy() {
    this._destroyed = true;
    if (this.container) this.container.innerHTML = '';
    this.insights = [];
  }
}
