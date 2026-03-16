/**
 * static/js/graph-memory.js — GraphMemory (F5.5)
 *
 * Tracks which papers the user has seen across sessions.
 * Seen papers render at 45% opacity with grayscale filter.
 */
(function () {
  'use strict';

  class GraphMemory {
    constructor(graphId) {
      this.graphId = graphId;
      this.seenPaperIds = new Set();
      this._hoverTimers = {};
      this._destroyed = false;
    }

    async load() {
      if (this._destroyed) return;
      try {
        const resp = await fetch(`/api/memory/${this.graphId}`);
        if (!resp.ok) return;
        const data = await resp.json();
        (data.seen_papers || []).forEach(id => this.seenPaperIds.add(id));
        this.applyVisuals();
      } catch { /* graceful degradation */ }
    }

    applyVisuals() {
      document.querySelectorAll('.node').forEach(el => {
        const paperId = el.dataset.paperId || el.id;
        if (this.seenPaperIds.has(paperId)) {
          el.classList.add('node-seen');
          const circle = el.querySelector('circle');
          if (circle) {
            circle.style.opacity = '0.45';
            circle.style.filter = 'grayscale(60%)';
          }
        }
      });
    }

    /**
     * Attach hover listeners — marks paper as seen after 3s hover.
     */
    attachHoverListeners() {
      document.querySelectorAll('.node').forEach(el => {
        const paperId = el.dataset.paperId || el.id;
        if (!paperId || this.seenPaperIds.has(paperId)) return;

        el.addEventListener('mouseenter', () => {
          this._hoverTimers[paperId] = setTimeout(() => {
            this._markSeen([paperId]);
          }, 3000);
        });

        el.addEventListener('mouseleave', () => {
          if (this._hoverTimers[paperId]) {
            clearTimeout(this._hoverTimers[paperId]);
            delete this._hoverTimers[paperId];
          }
        });
      });
    }

    /**
     * Record a navigation event (user clicked to open paper panel).
     */
    recordNavigation(paperId) {
      if (this._destroyed || !paperId) return;
      this._markSeen([paperId]);
      fetch(`/api/memory/${this.graphId}/navigation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper_id: paperId }),
      }).catch(() => {});
    }

    /**
     * Record time machine slider position.
     */
    recordTimeMachinePosition(year) {
      if (this._destroyed) return;
      fetch(`/api/memory/${this.graphId}/time-machine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year }),
      }).catch(() => {});
    }

    async _markSeen(paperIds) {
      if (this._destroyed) return;
      paperIds.forEach(id => this.seenPaperIds.add(id));
      this.applyVisuals();
      try {
        await fetch(`/api/memory/${this.graphId}/seen`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paper_ids: paperIds }),
        });
      } catch { /* non-fatal */ }
    }

    destroy() {
      this._destroyed = true;
      Object.values(this._hoverTimers).forEach(t => clearTimeout(t));
      this._hoverTimers = {};
    }
  }

  window.GraphMemory = GraphMemory;
})();
