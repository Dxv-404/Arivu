/**
 * static/js/confidence-layer.js — ConfidenceLayer (F7.1 + F7.2)
 *
 * Renders confidence badges on graph edges and insight cards.
 * Evidence Trail (F7.2): expandable panel showing raw data behind every LLM claim.
 */
(function () {
  'use strict';

  const TIERS = {
    HIGH:        { color: 'var(--conf-high)',   dots: 4, label: 'High confidence' },
    MEDIUM:      { color: 'var(--conf-medium)', dots: 3, label: 'Medium confidence' },
    LOW:         { color: 'var(--conf-low)',    dots: 2, label: 'Low confidence' },
    SPECULATIVE: { color: 'var(--conf-specul)', dots: 1, label: 'Speculative' },
  };

  function tierFor(score) {
    if (typeof score === 'string') return TIERS[score.toUpperCase()] || TIERS.MEDIUM;
    if (score >= 0.75) return TIERS.HIGH;
    if (score >= 0.55) return TIERS.MEDIUM;
    if (score >= 0.35) return TIERS.LOW;
    return TIERS.SPECULATIVE;
  }

  function createBadge(tier) {
    const info = typeof tier === 'string' ? (TIERS[tier.toUpperCase()] || TIERS.MEDIUM) : tier;
    const el = document.createElement('span');
    el.className = 'confidence-badge';
    el.title = info.label;
    const dots = document.createElement('span');
    dots.className = 'conf-dots';
    for (let i = 0; i < 4; i++) {
      const dot = document.createElement('span');
      dot.style.background = i < info.dots ? info.color : 'var(--bg-elevated)';
      dot.style.width = '6px';
      dot.style.height = '6px';
      dot.style.borderRadius = '50%';
      dot.style.display = 'inline-block';
      dot.style.marginRight = '2px';
      dots.appendChild(dot);
    }
    el.appendChild(dots);
    return el;
  }

  function createEvidenceTrail(data) {
    const trail = document.createElement('div');
    trail.className = 'evidence-trail';
    trail.style.display = 'none';

    if (data.explanation) {
      const exp = document.createElement('div');
      exp.className = 'et-explanation';
      exp.textContent = data.explanation;
      trail.appendChild(exp);
    }
    if (data.signals && data.signals.length) {
      const sig = document.createElement('div');
      sig.className = 'et-signals';
      sig.textContent = 'Signals: ' + data.signals.join(', ');
      trail.appendChild(sig);
    }
    if (data.similarity_score != null) {
      const sc = document.createElement('div');
      sc.className = 'et-scores';
      sc.textContent = `Similarity: ${(data.similarity_score * 100).toFixed(1)}%`;
      trail.appendChild(sc);
    }
    if (data.citing_sentence) {
      const q = document.createElement('blockquote');
      q.className = 'et-quote';
      q.textContent = data.citing_sentence;
      trail.appendChild(q);
    }
    return trail;
  }

  const ConfidenceLayer = {
    /**
     * Apply confidence badges to all edges in the rendered graph.
     */
    applyToGraph(graphData) {
      if (!graphData || !graphData.edges) return;
      const edges = graphData.edges;
      document.querySelectorAll('.edge-label, .link-label').forEach(el => {
        const edgeId = el.dataset.edgeId;
        if (!edgeId) return;
        const edge = edges.find(e =>
          (e.edge_id === edgeId) ||
          (`${e.source || e.citing_paper_id}:${e.target || e.cited_paper_id}` === edgeId)
        );
        if (!edge) return;
        const tier = tierFor(edge.base_confidence || edge.mutation_confidence || 0);
        const badge = createBadge(tier);
        el.prepend(badge);
      });
    },

    /**
     * Inject a confidence badge + expandable evidence trail into an insight card.
     */
    inject(cardEl, confidenceTier, explanation, evidence) {
      if (!cardEl) return;
      const tier = TIERS[(confidenceTier || 'medium').toUpperCase()] || TIERS.MEDIUM;
      const badge = createBadge(tier);

      const expandBtn = document.createElement('button');
      expandBtn.className = 'conf-expand-btn';
      expandBtn.textContent = 'Evidence';
      expandBtn.setAttribute('aria-expanded', 'false');

      const trail = createEvidenceTrail({
        explanation: explanation || '',
        signals: evidence?.signals || [],
        similarity_score: evidence?.similarity_score,
        citing_sentence: evidence?.citing_sentence,
      });

      expandBtn.addEventListener('click', () => {
        const open = trail.style.display !== 'none';
        trail.style.display = open ? 'none' : 'block';
        expandBtn.setAttribute('aria-expanded', String(!open));
      });

      const header = cardEl.querySelector('.insight-header') || cardEl.firstElementChild || cardEl;
      header.appendChild(badge);
      header.appendChild(expandBtn);
      cardEl.appendChild(trail);
    },
  };

  window.ConfidenceLayer = ConfidenceLayer;
})();
