/**
 * static/js/live-mode.js — LiveModePanel (F8.1)
 *
 * Manages alert subscriptions for graph updates.
 * Polls /api/live/alerts every 5 minutes when panel is visible.
 */
(function () {
  'use strict';

  class LiveModePanel {
    constructor(containerEl, graphId, seedPaperId) {
      this.container = containerEl;
      this.graphId = graphId;
      this.seedPaperId = seedPaperId;
      this._pollInterval = null;
      this._observer = null;
      this._destroyed = false;
    }

    async init() {
      if (this._destroyed) return;
      this.container.innerHTML = `
        <div class="live-header">
          <h3>Live Mode</h3>
          <span class="live-status" id="live-status">Checking...</span>
        </div>
        <div id="live-controls"></div>
        <div class="live-alerts-list" id="live-alerts"></div>
      `;
      await this._checkSubscription();
      this._setupVisibilityPolling();
    }

    async _checkSubscription() {
      try {
        const resp = await fetch('/api/live/subscriptions');
        const data = await resp.json();
        const sub = (data.subscriptions || []).find(
          s => s.graph_id === this.graphId && s.active
        );
        this._renderControls(!!sub);
        if (sub) this._loadAlerts();
      } catch {
        this._renderControls(false);
      }
    }

    _renderControls(isSubscribed) {
      const controls = this.container.querySelector('#live-controls');
      const status = this.container.querySelector('#live-status');
      if (isSubscribed) {
        status.textContent = 'Active';
        status.className = 'live-status live-active';
        controls.innerHTML = `<button id="live-cancel-btn" class="btn btn-small btn-danger">Unsubscribe</button>`;
        controls.querySelector('#live-cancel-btn').addEventListener('click', () => this._cancel());
      } else {
        status.textContent = 'Inactive';
        status.className = 'live-status';
        controls.innerHTML = `<button id="live-subscribe-btn" class="btn btn-small btn-gold">Subscribe to updates</button>`;
        controls.querySelector('#live-subscribe-btn').addEventListener('click', () => this._subscribe());
      }
    }

    async _subscribe() {
      try {
        await fetch('/api/live/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            graph_id: this.graphId,
            seed_paper_id: this.seedPaperId,
            alert_events: ['new_citation', 'paradigm_shift', 'gap_filled', 'retraction_alert'],
            digest_email: true,
          }),
        });
        this._renderControls(true);
        this._loadAlerts();
      } catch { /* ignore */ }
    }

    async _cancel() {
      try {
        await fetch('/api/live/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graph_id: this.graphId }),
        });
        this._renderControls(false);
        const alertsEl = this.container.querySelector('#live-alerts');
        if (alertsEl) alertsEl.innerHTML = '';
      } catch { /* ignore */ }
    }

    async _loadAlerts() {
      try {
        const resp = await fetch('/api/live/alerts');
        const data = await resp.json();
        const alertsEl = this.container.querySelector('#live-alerts');
        if (!alertsEl) return;
        if (!data.alerts || !data.alerts.length) {
          alertsEl.innerHTML = '<div class="live-no-alerts">No new alerts</div>';
          return;
        }
        alertsEl.innerHTML = data.alerts.map(a => `
          <div class="live-alert" data-alert-id="${a.alert_id}">
            <span class="live-alert-icon">${this._iconFor(a.event_type)}</span>
            <div class="live-alert-body">
              <strong>${a.event_type.replace(/_/g, ' ')}</strong>
              <small>${a.created_at || ''}</small>
            </div>
          </div>
        `).join('');
      } catch { /* ignore */ }
    }

    _iconFor(eventType) {
      const icons = {
        new_citation: '📄', paradigm_shift: '🔄',
        gap_filled: '✅', retraction_alert: '⚠️',
      };
      return icons[eventType] || '📌';
    }

    _setupVisibilityPolling() {
      if (typeof IntersectionObserver === 'undefined') {
        this._pollInterval = setInterval(() => this._loadAlerts(), 300000);
        return;
      }
      this._observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !this._pollInterval) {
            this._pollInterval = setInterval(() => this._loadAlerts(), 300000);
          } else if (!entry.isIntersecting && this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
          }
        });
      });
      this._observer.observe(this.container);
    }

    destroy() {
      this._destroyed = true;
      if (this._pollInterval) clearInterval(this._pollInterval);
      if (this._observer) this._observer.disconnect();
    }
  }

  window.LiveModePanel = LiveModePanel;
})();
