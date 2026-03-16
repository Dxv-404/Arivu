/**
 * static/js/disagreement-flag.js — DisagreementFlag (F7.3)
 *
 * Per-edge and per-insight flagging buttons.
 * Flags trigger auto-downgrade at 3+ distinct users, manual review at 5+.
 */
(function () {
  'use strict';

  const DisagreementFlag = {
    /**
     * Attach a flag button to an edge tooltip or card.
     */
    attachToEdge(containerEl, edgeId, graphId) {
      if (!containerEl || !edgeId) return;
      const btn = document.createElement('button');
      btn.className = 'flag-btn';
      btn.title = 'Flag this classification as incorrect';
      btn.innerHTML = '&#x1F44E;';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        try {
          const resp = await fetch('/api/flag-edge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              edge_id: edgeId,
              graph_id: graphId || '',
              feedback_type: 'disagreement',
            }),
          });
          const data = await resp.json();
          if (data.total_flags >= 3) {
            const warn = document.createElement('span');
            warn.className = 'flag-threshold-warn';
            warn.textContent = `${data.total_flags} users flagged`;
            btn.parentElement.appendChild(warn);
          }
          btn.textContent = 'Flagged';
        } catch {
          btn.disabled = false;
        }
      });
      containerEl.appendChild(btn);
    },

    /**
     * Attach a flag button to an insight card.
     */
    attachToInsight(cardEl, insightId) {
      if (!cardEl || !insightId) return;
      const btn = document.createElement('button');
      btn.className = 'insight-flag-btn';
      btn.title = 'Flag this insight as incorrect or unhelpful';
      btn.innerHTML = '&#x1F6A9;';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        try {
          const resp = await fetch('/api/flag-insight', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ insight_id: insightId }),
          });
          const data = await resp.json();
          btn.textContent = 'Flagged';
          if (data.auto_downgraded) {
            const warn = document.createElement('span');
            warn.className = 'flag-threshold-warn';
            warn.textContent = 'Auto-downgraded';
            btn.parentElement.appendChild(warn);
          }
        } catch {
          btn.disabled = false;
        }
      });
      cardEl.appendChild(btn);
    },
  };

  window.DisagreementFlag = DisagreementFlag;
})();
