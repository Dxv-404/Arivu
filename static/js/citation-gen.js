/**
 * static/js/citation-gen.js
 * CitationGeneratorUI — Manages the citation generator panel.
 * Provides style selector (apa/mla/chicago/bibtex/ieee/harvard),
 * paper selection, and copy-to-clipboard functionality.
 *
 * Dependencies: none (vanilla JS)
 */

class CitationGeneratorUI {
  /**
   * @param {string} containerId - ID of the DOM element to render into
   * @param {Array} papers - Array of paper objects from the graph (nodes)
   */
  constructor(containerId, papers) {
    this.container = document.getElementById(containerId);
    this.papers = papers || [];
    this.selectedPaperIds = new Set();
    this.currentStyle = 'apa';
    this._generatedCitations = {};

    /** @type {Array<{id: string, label: string}>} */
    this.styles = [
      { id: 'apa',     label: 'APA' },
      { id: 'mla',     label: 'MLA' },
      { id: 'chicago', label: 'Chicago' },
      { id: 'bibtex',  label: 'BibTeX' },
      { id: 'ieee',    label: 'IEEE' },
      { id: 'harvard', label: 'Harvard' },
    ];
  }

  /** Render the full citation generator panel. */
  render() {
    if (!this.container) return;
    this.container.innerHTML = '';

    var panel = document.createElement('div');
    panel.className = 'citation-gen-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Citation generator');
    panel.style.cssText = 'padding:12px;';

    // Header
    var heading = document.createElement('h3');
    heading.style.cssText = 'color:var(--text-primary);font-size:14px;font-weight:600;margin:0 0 12px 0;';
    heading.textContent = 'Citation Generator';
    panel.appendChild(heading);

    // Style selector
    var styleBar = document.createElement('div');
    styleBar.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;';
    var self = this;
    this.styles.forEach(function(style) {
      var btn = document.createElement('button');
      btn.className = 'citation-style-btn';
      btn.dataset.style = style.id;
      btn.textContent = style.label;
      var isActive = style.id === self.currentStyle;
      btn.style.cssText = [
        'padding:4px 10px;border-radius:4px;border:1px solid var(--bg-elevated);',
        'cursor:pointer;font-size:11px;font-weight:500;font-family:Inter,sans-serif;',
        'transition:all 0.2s;',
        isActive ? 'background:var(--accent-gold);color:var(--bg-primary);border-color:var(--accent-gold);' : 'background:var(--bg-surface);color:var(--text-secondary);',
      ].join('');
      btn.addEventListener('click', function() { self._selectStyle(style.id); });
      styleBar.appendChild(btn);
    });
    panel.appendChild(styleBar);

    // Paper list for selection
    var paperList = document.createElement('div');
    paperList.id = 'citation-paper-list';
    paperList.style.cssText = 'max-height:200px;overflow-y:auto;margin-bottom:12px;border:1px solid var(--bg-elevated);border-radius:6px;';

    if (this.papers.length === 0) {
      paperList.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:10px;">No papers available.</p>';
    } else {
      this.papers.slice(0, 50).forEach(function(paper) {
        var row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-bottom:1px solid var(--bg-elevated);cursor:pointer;';

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = paper.id || paper.paper_id || '';
        checkbox.style.cssText = 'margin-top:2px;accent-color:var(--accent-gold);';
        checkbox.addEventListener('change', function() {
          if (this.checked) {
            self.selectedPaperIds.add(this.value);
          } else {
            self.selectedPaperIds.delete(this.value);
          }
        });

        var info = document.createElement('div');
        info.style.cssText = 'flex:1;';
        info.innerHTML =
          '<div style="color:var(--text-primary);font-size:12px;">' + self._esc(self._truncate(paper.title || 'Untitled', 60)) + '</div>' +
          '<div style="color:var(--text-muted);font-size:10px;margin-top:1px;">' +
          self._esc((paper.authors || []).slice(0, 2).join(', ')) + (paper.year ? ' (' + paper.year + ')' : '') +
          '</div>';

        row.appendChild(checkbox);
        row.appendChild(info);
        paperList.appendChild(row);
      });
    }
    panel.appendChild(paperList);

    // Select all / deselect all
    var selectRow = document.createElement('div');
    selectRow.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;';

    var selectAllBtn = document.createElement('button');
    selectAllBtn.textContent = 'Select All';
    selectAllBtn.style.cssText = 'background:none;border:1px solid var(--bg-elevated);color:var(--text-secondary);border-radius:4px;padding:3px 10px;font-size:11px;cursor:pointer;';
    selectAllBtn.addEventListener('click', function() {
      var checkboxes = document.getElementById('citation-paper-list').querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(function(cb) { cb.checked = true; self.selectedPaperIds.add(cb.value); });
    });

    var deselectBtn = document.createElement('button');
    deselectBtn.textContent = 'Deselect All';
    deselectBtn.style.cssText = 'background:none;border:1px solid var(--bg-elevated);color:var(--text-secondary);border-radius:4px;padding:3px 10px;font-size:11px;cursor:pointer;';
    deselectBtn.addEventListener('click', function() {
      var checkboxes = document.getElementById('citation-paper-list').querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(function(cb) { cb.checked = false; });
      self.selectedPaperIds.clear();
    });

    selectRow.appendChild(selectAllBtn);
    selectRow.appendChild(deselectBtn);
    panel.appendChild(selectRow);

    // Generate button
    var generateBtn = document.createElement('button');
    generateBtn.id = 'citation-generate-btn';
    generateBtn.textContent = 'Generate Citations';
    generateBtn.style.cssText = 'background:var(--accent-blue);color:#fff;border:none;border-radius:6px;padding:8px 20px;font-size:13px;font-weight:500;cursor:pointer;width:100%;transition:opacity 0.2s;';
    generateBtn.addEventListener('click', function() { self._generate(); });
    panel.appendChild(generateBtn);

    // Results area
    var results = document.createElement('div');
    results.id = 'citation-results';
    results.style.cssText = 'margin-top:12px;';
    panel.appendChild(results);

    this.container.appendChild(panel);
  }

  /**
   * Switch citation style.
   * @param {string} styleId - One of apa/mla/chicago/bibtex/ieee/harvard
   */
  _selectStyle(styleId) {
    this.currentStyle = styleId;
    var buttons = this.container.querySelectorAll('.citation-style-btn');
    buttons.forEach(function(btn) {
      var isActive = btn.dataset.style === styleId;
      btn.style.background = isActive ? 'var(--accent-gold)' : 'var(--bg-surface)';
      btn.style.color = isActive ? 'var(--bg-primary)' : 'var(--text-secondary)';
      btn.style.borderColor = isActive ? 'var(--accent-gold)' : 'var(--bg-elevated)';
    });
  }

  /** Call the API to generate citations for selected papers. */
  async _generate() {
    var btn = document.getElementById('citation-generate-btn');
    var results = document.getElementById('citation-results');
    if (!btn || !results) return;

    if (this.selectedPaperIds.size === 0) {
      results.innerHTML = '<p style="color:var(--warning);font-size:12px;">Select at least one paper.</p>';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Generating...';
    results.innerHTML = '<p style="color:var(--text-muted);font-size:12px;">Generating citations...</p>';

    try {
      var resp = await fetch('/api/workflow/citation-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paper_ids: Array.from(this.selectedPaperIds),
          style: this.currentStyle,
        }),
      });

      if (!resp.ok) {
        var errData = await resp.json().catch(function() { return {}; });
        throw new Error(errData.error || 'HTTP ' + resp.status);
      }

      var data = await resp.json();
      this._renderCitations(results, data);

    } catch (err) {
      console.error('Citation generation failed:', err);
      results.innerHTML = '<p style="color:var(--danger);font-size:12px;">Error: ' + this._esc(err.message) + '</p>';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate Citations';
    }
  }

  /**
   * Render generated citations with copy buttons.
   * @param {HTMLElement} container - Results container
   * @param {object} data - API response
   */
  _renderCitations(container, data) {
    container.innerHTML = '';
    var citations = data.citations || data.items || [];
    if (typeof data === 'string') {
      citations = [{ text: data }];
    }
    if (!Array.isArray(citations) || citations.length === 0) {
      if (data.text) citations = [{ text: data.text }];
      else { container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;">No citations generated.</p>'; return; }
    }

    var self = this;
    citations.forEach(function(cit, i) {
      var card = document.createElement('div');
      card.style.cssText = 'background:var(--bg-surface);border-radius:6px;padding:10px;margin-bottom:6px;position:relative;';

      var text = document.createElement('div');
      text.style.cssText = 'color:var(--text-primary);font-size:12px;line-height:1.5;font-family:' + (self.currentStyle === 'bibtex' ? 'JetBrains Mono, monospace' : 'Inter, sans-serif') + ';white-space:pre-wrap;padding-right:32px;';
      text.textContent = cit.text || cit.citation || cit;
      card.appendChild(text);

      var copyBtn = document.createElement('button');
      copyBtn.style.cssText = 'position:absolute;top:8px;right:8px;background:var(--bg-elevated);border:none;border-radius:4px;padding:3px 8px;color:var(--text-muted);font-size:11px;cursor:pointer;';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', function() {
        var content = cit.text || cit.citation || cit;
        self._copyToClipboard(content, copyBtn);
      });
      card.appendChild(copyBtn);

      container.appendChild(card);
    });

    // Copy all button
    var copyAllBtn = document.createElement('button');
    copyAllBtn.style.cssText = 'background:var(--bg-surface);border:1px solid var(--bg-elevated);color:var(--text-secondary);border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;margin-top:6px;';
    copyAllBtn.textContent = 'Copy All';
    copyAllBtn.addEventListener('click', function() {
      var allText = citations.map(function(c) { return c.text || c.citation || c; }).join('\n\n');
      self._copyToClipboard(allText, copyAllBtn);
    });
    container.appendChild(copyAllBtn);
  }

  /**
   * Copy text to clipboard and show feedback.
   * @param {string} text - Text to copy
   * @param {HTMLElement} btn - Button to show feedback on
   */
  _copyToClipboard(text, btn) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        var orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.color = 'var(--success)';
        setTimeout(function() { btn.textContent = orig; btn.style.color = 'var(--text-muted)'; }, 1500);
      }).catch(function() {
        btn.textContent = 'Failed';
        setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
      });
    } else {
      // Fallback for older browsers
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.cssText = 'position:fixed;left:-9999px;';
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); btn.textContent = 'Copied!'; }
      catch (e) { btn.textContent = 'Failed'; }
      document.body.removeChild(textarea);
      setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
    }
  }

  /**
   * Escape HTML special characters.
   * @param {string} str
   * @returns {string}
   */
  _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Truncate string with ellipsis.
   * @param {string} str
   * @param {number} n
   * @returns {string}
   */
  _truncate(str, n) {
    return str.length > n ? str.slice(0, n) + '...' : str;
  }

  /** Tear down the panel. */
  destroy() {
    if (this.container) this.container.innerHTML = '';
    this.selectedPaperIds.clear();
  }
}
