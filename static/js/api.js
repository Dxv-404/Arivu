/**
 * static/js/api.js
 * PaperSearch — debounced search with autocomplete dropdown and disambiguation.
 */

class PaperSearch {
  constructor() {
    this.input = document.getElementById('paper-search');
    this.results = document.getElementById('search-results');
    this.debounceTimer = null;
    if (!this.input) return;
    this.input.addEventListener('input', () => this._onInput());
    this.input.addEventListener('keydown', (e) => this._onKeydown(e));
    this._selectedIndex = -1;
  }

  _onInput() {
    clearTimeout(this.debounceTimer);
    const q = this.input.value.trim();
    if (q.length < 3) { this.results.classList.add('hidden'); return; }
    this.debounceTimer = setTimeout(() => this._search(q), 300);
  }

  async _search(query) {
    this.results.innerHTML = '<div class="search-result"><div class="result-title">Searching…</div></div>';
    this.results.classList.remove('hidden');

    try {
      const resp = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await resp.json();
      this._renderResults(data.results || []);
    } catch (e) {
      this.results.innerHTML = '<div class="search-result"><div class="result-title" style="color:var(--danger)">Search failed. Please try again.</div></div>';
    }
  }

  _renderResults(papers) {
    if (!papers.length) {
      this.results.innerHTML = '<div class="search-result"><div class="result-title" style="color:var(--text-muted)">No results. Try a DOI or arXiv ID.</div></div>';
      return;
    }

    this.results.innerHTML = papers.slice(0, 8).map((p, i) => `
      <div class="search-result" role="option" data-id="${p.paper_id}" tabindex="${i+1}" aria-selected="false">
        <div class="result-title">${this._highlight(p.title || '')}</div>
        <div class="result-meta">${(p.authors||[]).slice(0,2).join(', ')} · ${p.year||'?'} · ${(p.citation_count||0).toLocaleString()} citations</div>
        <div class="result-abstract-preview">${(p.abstract||'').slice(0,120)}…</div>
        <div class="result-action">
          <button class="btn-this-one" onclick="window._selectPaper('${p.paper_id}')">Trace ancestry →</button>
        </div>
      </div>
    `).join('');

    this.results.classList.remove('hidden');
  }

  _onKeydown(e) {
    const items = this.results.querySelectorAll('.search-result');
    if (e.key === 'ArrowDown') { this._selectedIndex = Math.min(this._selectedIndex + 1, items.length - 1); this._focusResult(items); }
    else if (e.key === 'ArrowUp') { this._selectedIndex = Math.max(this._selectedIndex - 1, -1); this._focusResult(items); }
    else if (e.key === 'Escape') { this.results.classList.add('hidden'); this._selectedIndex = -1; }
  }

  _focusResult(items) {
    items.forEach((el, i) => el.setAttribute('aria-selected', i === this._selectedIndex ? 'true' : 'false'));
    if (this._selectedIndex >= 0) items[this._selectedIndex]?.focus();
  }

  _highlight(title) {
    const q = this.input.value.trim();
    if (!q) return this._esc(title);
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
    return this._esc(title).replace(re, '<mark>$1</mark>');
  }

  _esc(s) { return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}

window._selectPaper = function(paperId) {
  window.location.href = `/tool?paper_id=${encodeURIComponent(paperId)}`;
};
