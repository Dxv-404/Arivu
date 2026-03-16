/**
 * static/js/workflow.js
 * WorkflowPanel — UI panel for writing tools.
 * Provides buttons for: adversarial review, citation audit, citation generator,
 * reading prioritizer, paper positioning, rewrite suggester.
 * Each button calls the corresponding API endpoint and shows results inline.
 *
 * Dependencies: none (vanilla JS)
 */

class WorkflowPanel {
  /**
   * @param {string} containerId - ID of the DOM element to render into
   * @param {string} seedPaperId - Seed paper Semantic Scholar ID
   */
  constructor(containerId, seedPaperId) {
    this.container = document.getElementById(containerId);
    this.seedPaperId = seedPaperId || '';
    this._expanded = {};

    /** @type {Array<{id: string, label: string, icon: string, endpoint: string, description: string}>} */
    this.tools = [
      {
        id: 'adversarial-review',
        label: 'Adversarial Review',
        icon: '\u2694\uFE0F',
        endpoint: '/api/workflow/adversarial-review',
        description: 'Devil\'s advocate critique of the paper\'s methodology and claims.'
      },
      {
        id: 'citation-audit',
        label: 'Citation Audit',
        icon: '\uD83D\uDD0D',
        endpoint: '/api/workflow/citation-audit',
        description: 'Check for missing, misattributed, or over-cited references.'
      },
      {
        id: 'citation-generator',
        label: 'Citation Generator',
        icon: '\uD83D\uDCCB',
        endpoint: '/api/workflow/citation-generator',
        description: 'Generate formatted citations in multiple styles.'
      },
      {
        id: 'reading-prioritizer',
        label: 'Reading Prioritizer',
        icon: '\uD83D\uDCDA',
        endpoint: '/api/workflow/reading-prioritizer',
        description: 'Rank the most important papers to read next.'
      },
      {
        id: 'paper-positioning',
        label: 'Paper Positioning',
        icon: '\uD83C\uDFAF',
        endpoint: '/api/workflow/paper-positioning',
        description: 'Identify how to position your paper in this research landscape.'
      },
      {
        id: 'rewrite-suggester',
        label: 'Rewrite Suggester',
        icon: '\u270F\uFE0F',
        endpoint: '/api/workflow/rewrite-suggester',
        description: 'Suggest improvements to your paper\'s framing and narrative.'
      },
    ];
  }

  /** Render the workflow panel UI. */
  render() {
    if (!this.container) return;
    this.container.innerHTML = '';

    var panel = document.createElement('div');
    panel.className = 'workflow-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Writing tools');
    panel.style.cssText = 'padding:12px;';

    var heading = document.createElement('h3');
    heading.style.cssText = 'color:var(--text-primary);font-size:14px;font-weight:600;margin:0 0 12px 0;';
    heading.textContent = 'Writing Tools';
    panel.appendChild(heading);

    var self = this;
    this.tools.forEach(function(tool) {
      var section = document.createElement('div');
      section.className = 'workflow-tool-section';
      section.style.cssText = 'margin-bottom:8px;border:1px solid var(--bg-elevated);border-radius:8px;overflow:hidden;';

      // Header button (collapsible)
      var header = document.createElement('button');
      header.className = 'workflow-tool-header';
      header.style.cssText = [
        'display:flex;align-items:center;gap:8px;width:100%;padding:10px 12px;',
        'background:var(--bg-surface);border:none;cursor:pointer;text-align:left;',
        'transition:background 0.2s;'
      ].join('');
      header.innerHTML =
        '<span style="font-size:16px;" aria-hidden="true">' + tool.icon + '</span>' +
        '<span style="flex:1;color:var(--text-primary);font-size:13px;font-weight:500;">' + tool.label + '</span>' +
        '<span class="workflow-chevron" style="color:var(--text-muted);font-size:12px;transition:transform 0.2s;">&#9660;</span>';

      header.addEventListener('mouseenter', function() { this.style.background = 'var(--bg-elevated)'; });
      header.addEventListener('mouseleave', function() { this.style.background = 'var(--bg-surface)'; });

      // Content area (initially hidden)
      var content = document.createElement('div');
      content.id = 'workflow-content-' + tool.id;
      content.style.cssText = 'display:none;padding:10px 12px;background:var(--bg-primary);';

      var desc = document.createElement('p');
      desc.style.cssText = 'color:var(--text-muted);font-size:12px;margin:0 0 8px 0;';
      desc.textContent = tool.description;
      content.appendChild(desc);

      var runBtn = document.createElement('button');
      runBtn.className = 'workflow-run-btn';
      runBtn.id = 'workflow-run-' + tool.id;
      runBtn.style.cssText = [
        'background:var(--accent-blue);color:#fff;border:none;border-radius:6px;',
        'padding:6px 16px;font-size:12px;font-weight:500;cursor:pointer;',
        'transition:opacity 0.2s;'
      ].join('');
      runBtn.textContent = 'Run';
      runBtn.addEventListener('click', function() { self._runTool(tool); });
      content.appendChild(runBtn);

      var results = document.createElement('div');
      results.id = 'workflow-results-' + tool.id;
      results.style.cssText = 'margin-top:8px;';
      content.appendChild(results);

      // Toggle expand/collapse
      header.addEventListener('click', function() {
        var isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : 'block';
        var chevron = header.querySelector('.workflow-chevron');
        if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(-90deg)';
        self._expanded[tool.id] = !isOpen;
      });

      section.appendChild(header);
      section.appendChild(content);
      panel.appendChild(section);
    });

    this.container.appendChild(panel);
  }

  /**
   * Execute a workflow tool API call and display results.
   * @param {object} tool - Tool definition object
   */
  async _runTool(tool) {
    var runBtn = document.getElementById('workflow-run-' + tool.id);
    var results = document.getElementById('workflow-results-' + tool.id);
    if (!runBtn || !results) return;

    runBtn.disabled = true;
    runBtn.textContent = 'Running...';
    results.innerHTML = '<p style="color:var(--text-muted);font-size:12px;">Generating analysis...</p>';

    try {
      var resp = await fetch(tool.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed_paper_id: this.seedPaperId }),
      });

      if (!resp.ok) {
        var errData = await resp.json().catch(function() { return {}; });
        throw new Error(errData.error || 'HTTP ' + resp.status);
      }

      var data = await resp.json();
      this._renderResults(results, data, tool.id);

    } catch (err) {
      console.error('Workflow tool failed:', tool.id, err);
      results.innerHTML = '<p style="color:var(--danger);font-size:12px;">Error: ' + this._esc(err.message) + '</p>';
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = 'Run';
    }
  }

  /**
   * Render the API response inside the results container.
   * @param {HTMLElement} container - Results div
   * @param {object} data - API response JSON
   * @param {string} toolId - Tool identifier
   */
  _renderResults(container, data, toolId) {
    container.innerHTML = '';

    // Handle structured items array
    if (data.items && Array.isArray(data.items)) {
      data.items.forEach(function(item) {
        var card = document.createElement('div');
        card.style.cssText = 'background:var(--bg-surface);border-radius:6px;padding:8px 10px;margin-bottom:6px;';
        card.innerHTML =
          '<div style="color:var(--text-primary);font-size:12px;font-weight:500;">' + (item.title || item.label || '') + '</div>' +
          '<div style="color:var(--text-secondary);font-size:11px;margin-top:3px;">' + (item.description || item.text || '') + '</div>';
        container.appendChild(card);
      });
      return;
    }

    // Handle plain text or summary
    if (data.summary || data.text || data.result) {
      var text = data.summary || data.text || data.result;
      var block = document.createElement('div');
      block.style.cssText = 'background:var(--bg-surface);border-radius:6px;padding:10px 12px;color:var(--text-primary);font-size:12px;line-height:1.6;white-space:pre-wrap;';
      block.textContent = text;
      container.appendChild(block);
      return;
    }

    // Fallback: render raw JSON
    var pre = document.createElement('pre');
    pre.style.cssText = 'background:var(--bg-surface);border-radius:6px;padding:10px;color:var(--text-secondary);font-size:11px;overflow-x:auto;max-height:300px;';
    pre.textContent = JSON.stringify(data, null, 2);
    container.appendChild(pre);
  }

  /**
   * Escape HTML special characters.
   * @param {string} str
   * @returns {string}
   */
  _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Tear down the panel. */
  destroy() {
    if (this.container) this.container.innerHTML = '';
  }
}
