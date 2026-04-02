/**
 * athena-blocks.js -- Feature #002 Rich Response Formatting
 *
 * BlockFactory: registry of block renderers for Athena responses.
 * Phase A supports: prose (inline in engine), stat_grid, paper_card, warning.
 * Phase B Group 1 adds: paper_card (upgraded), stat_grid (upgraded), data_table,
 *   comparison_card, timeline, quote, warning (upgraded), expandable, code_block, equation.
 *
 * Per ATHENA_CLAUDE.md Part 4.2: Block Rendering Contract.
 * Per ATHENA_PHASE_B.md Section 4: Block Registration Protocol.
 */

'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const CHART_PALETTE = [
  '#D4A843', '#3B82F6', '#06B6D4', '#22C55E',
  '#F59E0B', '#9333EA', '#EF4444', '#64748B',
];

const FIELD_COLORS = {
  'Computer Science': '#648FFF',
  'Biology': '#785EF0',
  'Physics': '#DC267F',
  'Chemistry': '#FE6100',
  'Economics': '#FFB000',
  'Mathematics': '#009E73',
  'Other': '#56B4E9',
};

// Text tier labels per spec
const TEXT_TIER_LABELS = {
  1: 'Full text',
  2: 'Intro',
  3: 'Abstract',
  4: 'Title only',
};

// ── Syntax Highlighting Tokenizer (Section 2.1.9) ───────────────────────────

const TOKENIZERS = {
  python: [
    { pattern: /(#.*$)/gm, cls: 'tok-comment' },
    { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, cls: 'tok-string' },
    { pattern: /\b(def|class|import|from|return|if|elif|else|for|while|try|except|with|as|yield|lambda|True|False|None|and|or|not|in|is|raise|pass|break|continue|async|await)\b/g, cls: 'tok-keyword' },
    { pattern: /\b(\d+\.?\d*)\b/g, cls: 'tok-number' },
    { pattern: /(@\w+)/g, cls: 'tok-decorator' },
  ],
  sql: [
    { pattern: /(--.*$)/gm, cls: 'tok-comment' },
    { pattern: /('(?:[^'\\]|\\.)*')/g, cls: 'tok-string' },
    { pattern: /\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|JOIN|LEFT|RIGHT|INNER|ON|AND|OR|NOT|IN|IS|NULL|AS|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|TABLE|INDEX|INTO|VALUES|SET|COUNT|SUM|AVG|MAX|MIN|DISTINCT|UNION|EXISTS|BETWEEN|LIKE|CASE|WHEN|THEN|ELSE|END)\b/gi, cls: 'tok-keyword' },
  ],
  json: [
    { pattern: /("(?:[^"\\]|\\.)*")\s*:/g, cls: 'tok-key' },
    { pattern: /:\s*("(?:[^"\\]|\\.)*")/g, cls: 'tok-string' },
    { pattern: /:\s*(\d+\.?\d*)/g, cls: 'tok-number' },
    { pattern: /:\s*(true|false|null)/g, cls: 'tok-keyword' },
  ],
  javascript: [
    { pattern: /(\/\/.*$)/gm, cls: 'tok-comment' },
    { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, cls: 'tok-string' },
    { pattern: /\b(const|let|var|function|class|return|if|else|for|while|switch|case|break|continue|new|this|import|export|from|default|async|await|try|catch|throw|typeof|instanceof|true|false|null|undefined|yield)\b/g, cls: 'tok-keyword' },
    { pattern: /\b(\d+\.?\d*)\b/g, cls: 'tok-number' },
  ],
};

/**
 * Apply syntax highlighting via regex tokenizer.
 * Per ATHENA_PHASE_B.md Section 2.1.9.
 */
function tokenize(code, language) {
  const rules = TOKENIZERS[language];
  if (!rules) return escapeHtml(code);

  let result = escapeHtml(code);
  const placeholders = [];

  for (const rule of rules) {
    result = result.replace(rule.pattern, (match) => {
      const idx = placeholders.length;
      placeholders.push('<span class="' + rule.cls + '">' + match + '</span>');
      return '\x00' + idx + '\x00';
    });
  }

  for (let i = 0; i < placeholders.length; i++) {
    result = result.replace('\x00' + i + '\x00', placeholders[i]);
  }
  return result;
}

// ── Copy to Clipboard (Section 2.1.10) ──────────────────────────────────────

async function copyToClipboard(text, buttonEl) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
  const originalText = buttonEl.textContent;
  buttonEl.textContent = 'Copied';
  buttonEl.classList.add('copied');
  setTimeout(() => {
    buttonEl.textContent = originalText;
    buttonEl.classList.remove('copied');
  }, 2000);
}

// ── Tooltip System (Section 2.1.7) ──────────────────────────────────────────

class AthenaTooltip {
  static instance = null;

  static show(targetEl, content) {
    AthenaTooltip.hide();

    const tooltip = document.createElement('div');
    tooltip.className = 'athena-tooltip';
    tooltip.setAttribute('role', 'tooltip');

    if (typeof content === 'string') {
      tooltip.textContent = content;
    } else if (content instanceof HTMLElement) {
      tooltip.appendChild(content);
    }

    document.body.appendChild(tooltip);

    const rect = targetEl.getBoundingClientRect();
    let top = rect.top - tooltip.offsetHeight - 8;
    let left = rect.left + (rect.width - tooltip.offsetWidth) / 2;

    if (top < 8) {
      top = rect.bottom + 8;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - tooltip.offsetWidth - 8));

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';

    AthenaTooltip.instance = tooltip;
  }

  static hide() {
    if (AthenaTooltip.instance) {
      AthenaTooltip.instance.remove();
      AthenaTooltip.instance = null;
    }
  }
}

// ── BlockFactory ─────────────────────────────────────────────────────────────

class BlockFactory {
  static renderers = {};

  // FIX #10/#11/#18/#19: CSS class override map for types whose auto-generated
  // CSS class (block-{type_with_hyphens}) doesn't match the actual CSS selectors.
  static CSS_CLASS_MAP = {
    'comparison_card': 'block-comparison',
    'code_block': 'block-code',
    'network_snippet': 'block-network',  // R3-02: CSS uses .block-network not .block-network-snippet
    'citation_evidence': 'block-citation', // Phase C #020
    'relationship_explainer': 'block-relationship', // Phase C #026
    'pathfinder_handoff': 'block-pathfinder-handoff', // Phase C #008
    'terminal_suggest': 'block-terminal-suggest', // Phase C #012
  };

  /**
   * Render a block from SSE event data.
   * Per ATHENA_CLAUDE.md Part 4.2: accepts {type, data, provenance}.
   * Per ATHENA_PHASE_B.md Section 2.1.22: depth param for nested block limit.
   */
  static render(blockJson, depth) {
    if (depth === undefined) depth = 0;
    if (depth > 3) {
      const el = document.createElement('div');
      el.className = 'block-empty-state';
      el.textContent = 'Content nested too deeply';
      return el;
    }

    const type = blockJson?.type || 'unknown';
    const renderer = this.renderers[type];

    if (!renderer) {
      console.warn('BlockFactory: unknown block type "' + type + '"');
      const el = document.createElement('div');
      el.className = 'block block-unknown';
      el.innerHTML = '<span style="font-size:11px;color:#94A3B8">[' + escapeHtml(type) + ']</span>';
      return el;
    }

    try {
      const el = renderer(blockJson.data || {}, depth);
      const cssClass = this.CSS_CLASS_MAP[type] || ('block-' + type.replace(/_/g, '-'));
      el.classList.add('block', cssClass);
      el.dataset.provenance = blockJson.provenance || 'computed';
      return el;
    } catch (err) {
      console.error('BlockFactory: render failed for "' + type + '":', err);
      const el = document.createElement('div');
      el.className = 'block block-error';
      el.textContent = '[Block render error: ' + type + ']';
      return el;
    }
  }

  /**
   * Register a new block renderer.
   * Renderer function: (data, depth) => HTMLElement
   */
  static register(type, rendererFn) {
    this.renderers[type] = rendererFn;
  }
}

// ── B-01: Paper Citation Card (#058) ────────────────────────────────────────
// SSE shape: {paper_id, title, authors[], year, citation_count, fields[], url, text_tier}

BlockFactory.register('paper_card', (data) => {
  const el = document.createElement('div');

  if (!data || !data.title) {
    el.className = 'block-empty-state';
    el.textContent = 'Paper data unavailable';
    return el;
  }

  el.setAttribute('role', 'article');
  el.setAttribute('aria-label', 'Paper: ' + (data.title || 'Unknown'));
  if (data.paper_id) el.dataset.paperId = data.paper_id; // B2-08: needed for quick actions

  // Title row
  const titleEl = document.createElement('div');
  titleEl.className = 'paper-title';
  if (data.url) {
    const link = document.createElement('a');
    link.href = data.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = data.title || 'Unknown';
    link.className = 'paper-title-link';
    titleEl.appendChild(link);
  } else {
    titleEl.textContent = data.title || 'Unknown';
  }
  el.appendChild(titleEl);

  // Authors and year
  const authors = (data.authors || []).slice(0, 3);
  const authStr = authors.map(a => escapeHtml(a)).join(', ');
  const more = (data.authors || []).length > 3 ? ' +' + (data.authors.length - 3) : '';
  const metaEl = document.createElement('div');
  metaEl.className = 'paper-authors';
  metaEl.innerHTML = authStr + escapeHtml(more) + (data.year ? ' (' + data.year + ')' : '');
  el.appendChild(metaEl);

  // Bottom row: citations, fields, text_tier
  const bottomRow = document.createElement('div');
  bottomRow.className = 'paper-bottom-row';

  // Citation count
  const citSpan = document.createElement('span');
  citSpan.className = 'paper-citation-count';
  citSpan.textContent = 'Citations: ' + (data.citation_count || 0).toLocaleString();
  bottomRow.appendChild(citSpan);

  // Field dots
  if (data.fields && data.fields.length > 0) {
    const fieldSpan = document.createElement('span');
    fieldSpan.className = 'paper-fields';
    const fieldColor = FIELD_COLORS[data.fields[0]] || FIELD_COLORS['Other'];
    fieldSpan.innerHTML = '<span class="paper-field-dot" style="background:' + fieldColor + '"></span>' + escapeHtml(data.fields[0]);
    bottomRow.appendChild(fieldSpan);
  }

  // Text tier badge
  if (data.text_tier && data.text_tier < 4) {
    const tierSpan = document.createElement('span');
    tierSpan.className = 'paper-tier-badge';
    tierSpan.textContent = TEXT_TIER_LABELS[data.text_tier] || '';
    bottomRow.appendChild(tierSpan);
  }

  el.appendChild(bottomRow);

  return el;
});


// ── B-02: Stat Dashboard (#063) ─────────────────────────────────────────────
// SSE shape: {stats: [{label, value, detail, source}]}

BlockFactory.register('stat_grid', (data) => {
  const el = document.createElement('div');
  const stats = data.stats || [];

  if (!stats.length) {
    el.className = 'block-empty-state';
    el.textContent = 'No statistics available';
    return el;
  }

  el.setAttribute('role', 'list');

  for (const stat of stats) {
    const item = document.createElement('div');
    item.className = 'stat-grid-item';
    item.setAttribute('role', 'listitem');
    item.setAttribute('aria-label', (stat.label || '') + ': ' + (stat.value || ''));

    const labelDiv = document.createElement('div');
    labelDiv.className = 'stat-label';
    labelDiv.textContent = stat.label || '';
    item.appendChild(labelDiv);

    const valueDiv = document.createElement('div');
    valueDiv.className = 'stat-value';
    valueDiv.textContent = String(stat.value != null ? stat.value : '');
    item.appendChild(valueDiv);

    if (stat.detail) {
      const detailDiv = document.createElement('div');
      detailDiv.className = 'stat-detail';
      detailDiv.textContent = stat.detail;
      item.appendChild(detailDiv);
    }

    if (stat.source) {
      const srcDiv = document.createElement('div');
      srcDiv.className = 'stat-source';
      srcDiv.innerHTML = '<span class="provenance-dot"></span>' + escapeHtml(stat.source);
      item.appendChild(srcDiv);
    }

    el.appendChild(item);
  }

  return el;
});


// ── B-03: Data Table (#060) ─────────────────────────────────────────────────
// SSE shape: {headers: [], rows: [[]], sortable, paginated}

BlockFactory.register('data_table', (data) => {
  const el = document.createElement('div');
  const headers = data.headers || [];
  const rows = data.rows || [];

  if (!headers.length && !rows.length) {
    el.className = 'block-empty-state';
    el.textContent = 'No data';
    return el;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'data-table-wrapper';

  const table = document.createElement('table');
  table.className = 'data-table';
  table.setAttribute('role', 'table');

  // Header
  if (headers.length) {
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (let i = 0; i < headers.length; i++) {
      const th = document.createElement('th');
      th.textContent = headers[i] || '';
      if (data.sortable) {
        th.setAttribute('data-sortable', 'true');
        th.style.cursor = 'pointer';
        th.setAttribute('tabindex', '0');
      }
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
  }

  // Body
  const tbody = document.createElement('tbody');
  const pageSize = 20;
  const totalRows = rows.length;
  const isPaginated = data.paginated && totalRows > pageSize;
  const displayRows = isPaginated ? rows.slice(0, pageSize) : rows;

  if (!displayRows.length) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.setAttribute('colspan', String(headers.length || 1));
    emptyCell.className = 'data-table-empty';
    emptyCell.textContent = 'No data';
    emptyRow.appendChild(emptyCell);
    tbody.appendChild(emptyRow);
  } else {
    for (const row of displayRows) {
      const tr = document.createElement('tr');
      for (let ci = 0; ci < (headers.length || row.length); ci++) {
        const td = document.createElement('td');
        const val = (row[ci] != null) ? String(row[ci]) : '';
        td.textContent = val;
        // Numeric sort value
        const parsed = parseFloat(val.replace(/,/g, ''));
        if (!isNaN(parsed)) {
          td.dataset.sortValue = String(parsed);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  table.appendChild(tbody);
  wrapper.appendChild(table);

  // Sortable: attach click handlers
  if (data.sortable && headers.length) {
    const ths = table.querySelectorAll('th[data-sortable]');
    ths.forEach((th, index) => {
      const handler = () => {
        const currentSort = th.getAttribute('aria-sort');
        const direction = currentSort === 'ascending' ? 'desc' : 'asc';
        sortDataTable(table, index, direction);
      };
      th.addEventListener('click', handler);
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handler();
      });
    });
  }

  // Pagination controls
  if (isPaginated) {
    let currentPage = 0;
    const maxPage = Math.ceil(totalRows / pageSize) - 1;

    const pager = document.createElement('div');
    pager.className = 'data-table-pager';

    const info = document.createElement('span');
    info.className = 'data-table-pager-info';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'data-table-pager-btn';
    prevBtn.textContent = 'Prev';
    prevBtn.disabled = true;

    const nextBtn = document.createElement('button');
    nextBtn.className = 'data-table-pager-btn';
    nextBtn.textContent = 'Next';

    function renderPage(page) {
      currentPage = page;
      const start = page * pageSize;
      const end = Math.min(start + pageSize, totalRows);
      tbody.innerHTML = '';
      for (let ri = start; ri < end; ri++) {
        const row = rows[ri];
        const tr = document.createElement('tr');
        for (let ci = 0; ci < (headers.length || row.length); ci++) {
          const td = document.createElement('td');
          const val = (row[ci] != null) ? String(row[ci]) : '';
          td.textContent = val;
          const parsed = parseFloat(val.replace(/,/g, ''));
          if (!isNaN(parsed)) td.dataset.sortValue = String(parsed);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      info.textContent = (start + 1) + '-' + end + ' of ' + totalRows;
      prevBtn.disabled = page === 0;
      nextBtn.disabled = page >= maxPage;
    }

    prevBtn.addEventListener('click', () => { if (currentPage > 0) renderPage(currentPage - 1); });
    nextBtn.addEventListener('click', () => { if (currentPage < maxPage) renderPage(currentPage + 1); });

    pager.appendChild(prevBtn);
    pager.appendChild(info);
    pager.appendChild(nextBtn);
    wrapper.appendChild(pager);

    // Initial info text
    info.textContent = '1-' + Math.min(pageSize, totalRows) + ' of ' + totalRows;
  }

  el.appendChild(wrapper);
  return el;
});

/**
 * Sort a data table by column index.
 * Per ATHENA_PHASE_B.md Section 2.1.27.
 */
function sortDataTable(tableEl, columnIndex, direction) {
  const tbody = tableEl.querySelector('tbody');
  if (!tbody) return;
  const rowEls = Array.from(tbody.querySelectorAll('tr'));

  rowEls.sort((a, b) => {
    const aCell = a.cells[columnIndex];
    const bCell = b.cells[columnIndex];
    if (!aCell || !bCell) return 0;
    const aVal = aCell.dataset.sortValue || aCell.textContent.trim();
    const bVal = bCell.dataset.sortValue || bCell.textContent.trim();

    const aNum = parseFloat(aVal);
    const bNum = parseFloat(bVal);

    if (!isNaN(aNum) && !isNaN(bNum)) {
      return direction === 'asc' ? aNum - bNum : bNum - aNum;
    }
    return direction === 'asc'
      ? aVal.localeCompare(bVal)
      : bVal.localeCompare(aVal);
  });

  rowEls.forEach(row => tbody.appendChild(row));

  const allHeaders = tableEl.querySelectorAll('th[data-sortable]');
  allHeaders.forEach((th, i) => {
    if (i === columnIndex) {
      th.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
    } else {
      th.removeAttribute('aria-sort');
    }
  });
}


// ── B-04: Comparison Card (#061) ────────────────────────────────────────────
// SSE shape: {papers: [{paper_id, title, metrics:{}}], diff_summary}

BlockFactory.register('comparison_card', (data) => {
  const el = document.createElement('div');
  const papers = data.papers || [];

  if (!papers.length) {
    el.className = 'block-empty-state';
    el.textContent = 'Unable to compare: paper data missing';
    return el;
  }

  const names = papers.map(p => p.title || 'Unknown').join(' and ');
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Comparison of ' + names);

  // Paper headers row
  const headerRow = document.createElement('div');
  headerRow.className = 'comparison-header';
  for (const paper of papers) {
    const col = document.createElement('div');
    col.className = 'comparison-paper-header';
    const titleDiv = document.createElement('div');
    titleDiv.className = 'comparison-paper-title';
    titleDiv.textContent = paper.title || 'Unknown';
    col.appendChild(titleDiv);
    if (paper.year) {
      const yearDiv = document.createElement('div');
      yearDiv.className = 'comparison-paper-year';
      yearDiv.textContent = String(paper.year);
      col.appendChild(yearDiv);
    }
    headerRow.appendChild(col);
  }
  el.appendChild(headerRow);

  // Collect all unique metric keys
  const metricKeys = new Set();
  for (const paper of papers) {
    if (paper.metrics) {
      for (const key of Object.keys(paper.metrics)) {
        metricKeys.add(key);
      }
    }
  }

  // Metric rows
  for (const key of metricKeys) {
    const metricRow = document.createElement('div');
    metricRow.className = 'comparison-metric-row';

    const labelCell = document.createElement('div');
    labelCell.className = 'comparison-metric-label';
    labelCell.textContent = key;
    metricRow.appendChild(labelCell);

    // Find the best (highest numeric) value for highlighting
    let bestVal = -Infinity;
    let bestIdx = -1;
    const values = papers.map((p, i) => {
      const v = p.metrics ? p.metrics[key] : null;
      const num = parseFloat(v);
      if (!isNaN(num) && num > bestVal) {
        bestVal = num;
        bestIdx = i;
      }
      return v;
    });

    for (let i = 0; i < papers.length; i++) {
      const valCell = document.createElement('div');
      valCell.className = 'comparison-metric-value';
      valCell.textContent = values[i] != null ? String(values[i]) : '-';
      if (i === bestIdx && papers.length > 1) {
        valCell.classList.add('comparison-winner');
      }
      metricRow.appendChild(valCell);
    }

    el.appendChild(metricRow);
  }

  // Diff summary
  if (data.diff_summary) {
    const summary = document.createElement('div');
    summary.className = 'comparison-summary';
    summary.textContent = data.diff_summary;
    el.appendChild(summary);
  }

  return el;
});


// ── B-05: Timeline (#062) ───────────────────────────────────────────────────
// SSE shape: {events: [{year, paper_id, title, type}]}

BlockFactory.register('timeline', (data) => {
  const el = document.createElement('div');
  const events = data.events || [];

  if (!events.length) {
    el.className = 'block-empty-state';
    el.textContent = 'No timeline events';
    return el;
  }

  el.setAttribute('role', 'list');

  // Sort events by year ascending
  const sorted = [...events].sort((a, b) => (a.year || 0) - (b.year || 0));

  const line = document.createElement('div');
  line.className = 'timeline-line';

  for (const evt of sorted) {
    const item = document.createElement('div');
    item.className = 'timeline-event';
    item.setAttribute('role', 'listitem');
    item.setAttribute('aria-label', (evt.year || '?') + ': ' + (evt.title || 'Unknown'));

    const dot = document.createElement('div');
    dot.className = 'timeline-dot';
    if (evt.type === 'seed') {
      dot.classList.add('timeline-dot-seed');
    }
    item.appendChild(dot);

    const content = document.createElement('div');
    content.className = 'timeline-content';

    const yearSpan = document.createElement('span');
    yearSpan.className = 'timeline-year';
    yearSpan.textContent = evt.year || '?';
    content.appendChild(yearSpan);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'timeline-title';
    titleSpan.textContent = evt.title || 'Unknown';
    content.appendChild(titleSpan);

    item.appendChild(content);
    line.appendChild(item);
  }

  el.appendChild(line);
  return el;
});


// ── B-06: Quote Block (#065) ────────────────────────────────────────────────
// SSE shape: {text, source, paper_id}

BlockFactory.register('quote', (data) => {
  const el = document.createElement('div');

  if (!data || !data.text) {
    el.className = 'block-empty-state';
    el.style.fontStyle = 'italic';
    el.textContent = 'Quote unavailable';
    return el;
  }

  const quoteText = document.createElement('blockquote');
  quoteText.className = 'quote-text';
  quoteText.textContent = data.text;
  el.appendChild(quoteText);

  if (data.source || data.paper_id) {
    const attribution = document.createElement('div');
    attribution.className = 'quote-source';
    if (data.source) {
      attribution.textContent = data.source;
    }
    if (data.paper_id) {
      const link = document.createElement('button');
      link.className = 'quote-graph-link';
      link.textContent = 'View in graph';
      link.dataset.paperId = data.paper_id;
      link.addEventListener('click', () => {
        const evt = new CustomEvent('athena:focus-node', { detail: { paper_id: data.paper_id } });
        document.dispatchEvent(evt);
      });
      attribution.appendChild(link);
    }
    el.appendChild(attribution);
  }

  return el;
});


// ── B-07: Warning/Alert Block (#066) ────────────────────────────────────────
// SSE shape: {level: "info"|"warn"|"error", message, detail}
// Upgraded from Phase A: adds SVG icons, detail text, ARIA attributes.

BlockFactory.register('warning', (data) => {
  const el = document.createElement('div');

  const configs = {
    info:  { border: '#3B82F6', bg: '#EFF6FF', color: '#3B82F6', ariaLive: 'polite',
             icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="4" x2="8" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.75" fill="currentColor"/></svg>' },
    warn:  { border: '#F59E0B', bg: '#FFFBEB', color: '#F59E0B', ariaLive: 'polite',
             icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5L14.5 13.5H1.5L8 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><line x1="8" y1="6" x2="8" y2="9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.75" fill="currentColor"/></svg>' },
    error: { border: '#EF4444', bg: '#FEF2F2', color: '#EF4444', ariaLive: 'assertive',
             icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><line x1="5.5" y1="5.5" x2="10.5" y2="10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="10.5" y1="5.5" x2="5.5" y2="10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
  };

  const cfg = configs[data.level] || configs.info;

  el.setAttribute('role', 'alert');
  el.setAttribute('aria-live', cfg.ariaLive);
  el.style.borderLeftColor = cfg.border;
  el.style.background = cfg.bg;

  const iconSpan = document.createElement('span');
  iconSpan.className = 'warning-icon';
  iconSpan.style.color = cfg.color;
  iconSpan.innerHTML = cfg.icon;
  el.appendChild(iconSpan);

  const textWrap = document.createElement('div');
  textWrap.className = 'warning-text-wrap';

  const msgEl = document.createElement('div');
  msgEl.className = 'warning-message';
  msgEl.textContent = data.message || '';
  textWrap.appendChild(msgEl);

  if (data.detail) {
    const detailEl = document.createElement('div');
    detailEl.className = 'warning-detail';
    detailEl.textContent = data.detail;
    textWrap.appendChild(detailEl);
  }

  el.appendChild(textWrap);
  return el;
});


// ── B-08: Expandable Section (#067) ─────────────────────────────────────────
// SSE shape: {title, content, expanded_default}

BlockFactory.register('expandable', (data, depth) => {
  const el = document.createElement('div');
  el.setAttribute('role', 'region');

  const expanded = data.expanded_default !== false;

  const toggle = document.createElement('button');
  toggle.className = 'expandable-toggle';
  toggle.setAttribute('aria-expanded', String(expanded));

  const arrow = document.createElement('span');
  arrow.className = 'expandable-arrow';
  arrow.textContent = expanded ? '\u25BC' : '\u25B6';
  toggle.appendChild(arrow);

  const titleSpan = document.createElement('span');
  titleSpan.textContent = data.title || 'Details';
  toggle.appendChild(titleSpan);

  const content = document.createElement('div');
  content.className = 'expandable-content';
  if (!expanded) {
    content.style.display = 'none';
  }

  // Detect diagram-type expandables and auto-generate computed visualizations
  const titleLower = (data.title || '').toLowerCase();
  const isDiagram = /timeline|diagram|network|chart|distribution|flow|tree|hierarchy|graph/i.test(titleLower);

  if (isDiagram && window._arivuGraph) {
    // Render a computed visualization based on the title keyword
    try {
      let diagramBlock = null;

      if (/timeline|chronolog|history/i.test(titleLower)) {
        // Generate a computed timeline from graph nodes
        const nodes = (window._arivuGraph.allNodes || [])
          .filter(n => n.year)
          .sort((a, b) => (a.year || 0) - (b.year || 0));
        const events = nodes.slice(0, 15).map(n => ({
          year: n.year, paper_id: n.id,
          title: (n.title || '').substring(0, 40),
          type: n.is_seed ? 'seed' : 'regular',
        }));
        if (events.length > 0) {
          diagramBlock = BlockFactory.render({
            type: 'timeline', provenance: 'computed',
            data: { events },
          });
        }
      } else if (/network|diagram|graph|connection/i.test(titleLower)) {
        // Generate a mini network snippet around the seed paper
        const seed = (window._arivuGraph.allNodes || []).find(n => n.is_seed);
        if (seed) {
          const edges = (window._arivuGraph.allEdges || []).slice(0, 20);
          const nodeIds = new Set();
          nodeIds.add(seed.id);
          edges.forEach(e => {
            const src = typeof e.source === 'object' ? e.source.id : e.source;
            const tgt = typeof e.target === 'object' ? e.target.id : e.target;
            nodeIds.add(src); nodeIds.add(tgt);
          });
          const visNodes = (window._arivuGraph.allNodes || [])
            .filter(n => nodeIds.has(n.id))
            .slice(0, 20)
            .map((n, i) => ({
              id: n.id, label: (n.title || '').substring(0, 20),
              x: 30 + (i % 5) * 55, y: 20 + Math.floor(i / 5) * 50,
              highlighted: n.is_seed,
            }));
          const visEdges = edges.slice(0, 15).map(e => ({
            from: typeof e.source === 'object' ? e.source.id : e.source,
            to: typeof e.target === 'object' ? e.target.id : e.target,
            mutation_type: e.mutation_type || 'incidental',
          }));
          diagramBlock = BlockFactory.render({
            type: 'network_snippet', provenance: 'computed',
            data: { nodes: visNodes, edges: visEdges },
          });
        }
      } else if (/distribution|donut|pie|field/i.test(titleLower)) {
        // Generate a field distribution donut
        const fieldCounts = {};
        (window._arivuGraph.allNodes || []).forEach(n => {
          (n.fields_of_study || []).forEach(f => {
            fieldCounts[f] = (fieldCounts[f] || 0) + 1;
          });
        });
        const segments = Object.entries(fieldCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([label, value], i) => ({
            label, value,
            color: (CHART_PALETTE || ['#3B82F6','#8B5CF6','#EC4899','#F59E0B','#22C55E','#06B6D4','#64748B','#D4A843'])[i % 8],
          }));
        const total = segments.reduce((s, seg) => s + seg.value, 0);
        if (segments.length > 0) {
          diagramBlock = BlockFactory.render({
            type: 'mini_chart_donut', provenance: 'computed',
            data: { segments, total },
          });
        }
      } else if (/tree|hierarchy|ancestor/i.test(titleLower)) {
        // Generate citation hierarchy tree
        const seed = (window._arivuGraph.allNodes || []).find(n => n.is_seed);
        if (seed) {
          const buildTree = (nodeId, d) => {
            if (d > 3) return null;
            const n = (window._arivuGraph.allNodes || []).find(x => x.id === nodeId);
            const label = n ? (n.title || '').substring(0, 25) : nodeId.substring(0, 10);
            const children = [];
            if (d < 3) {
              const childEdges = (window._arivuGraph.allEdges || [])
                .filter(e => (typeof e.target === 'object' ? e.target.id : e.target) === nodeId)
                .slice(0, 4);
              for (const e of childEdges) {
                const cid = typeof e.source === 'object' ? e.source.id : e.source;
                const child = buildTree(cid, d + 1);
                if (child) children.push(child);
              }
            }
            return { label, children, year: n?.year };
          };
          const root = buildTree(seed.id, 0);
          if (root) {
            diagramBlock = BlockFactory.render({
              type: 'tree', provenance: 'computed',
              data: { root },
            });
          }
        }
      }

      if (diagramBlock) {
        content.appendChild(diagramBlock);
        // Also add the text description below the diagram
        if (data.content && typeof data.content === 'string') {
          const desc = document.createElement('div');
          desc.className = 'expandable-description';
          desc.style.cssText = 'margin-top:8px;font-size:12px;color:#64748B;';
          desc.textContent = data.content;
          content.appendChild(desc);
        }
      } else {
        // Fallback to text if diagram generation failed
        if (data.content) content.textContent = data.content;
      }
    } catch (e) {
      // On error, fall back to text content
      if (data.content) content.textContent = data.content;
    }
  } else if (typeof data.content === 'string') {
    // Non-diagram expandable: render as markdown
    if (window.athenaEngine && typeof window.athenaEngine._renderMarkdownFull === 'function') {
      content.innerHTML = window.athenaEngine._renderMarkdownFull(data.content);
    } else {
      content.textContent = data.content;
    }
  } else if (Array.isArray(data.content)) {
    for (const child of data.content) {
      if (child && child.type) {
        content.appendChild(BlockFactory.render(child, (depth || 0) + 1));
      }
    }
  } else if (!data.content) {
    // Empty: show header only per spec
  }

  toggle.addEventListener('click', () => {
    const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!isExpanded));
    content.style.display = isExpanded ? 'none' : '';
    arrow.textContent = isExpanded ? '\u25B6' : '\u25BC';
  });

  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle.click();
    }
  });

  el.appendChild(toggle);
  el.appendChild(content);
  return el;
});


// ── B-09: Code Block with Copy (#039) ───────────────────────────────────────
// SSE shape: {language, code, filename}

BlockFactory.register('code_block', (data) => {
  const el = document.createElement('div');
  el.setAttribute('role', 'code');
  el.setAttribute('aria-label', 'Code: ' + (data.language || 'plain text'));

  if (!data.code && data.code !== '') {
    el.className = 'block-empty-state';
    el.textContent = 'No code provided';
    return el;
  }

  // Header row: language label / filename + copy button
  const header = document.createElement('div');
  header.className = 'code-block-header';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'code-block-lang';
  labelSpan.textContent = data.filename || data.language || 'text';
  header.appendChild(labelSpan);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'block-copy-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => {
    copyToClipboard(data.code || '', copyBtn);
  });
  header.appendChild(copyBtn);

  el.appendChild(header);

  // Code body with line numbers
  const codeBody = document.createElement('div');
  codeBody.className = 'code-block-body';

  const codeStr = data.code || '';
  const lines = codeStr.split('\n');
  const lang = (data.language || '').toLowerCase();

  const pre = document.createElement('pre');
  const codeEl = document.createElement('code');

  // Build line-numbered content
  const lineNumbersDiv = document.createElement('div');
  lineNumbersDiv.className = 'code-line-numbers';
  const codeContentDiv = document.createElement('div');
  codeContentDiv.className = 'code-content';

  for (let i = 0; i < lines.length; i++) {
    const numSpan = document.createElement('div');
    numSpan.className = 'code-line-num';
    numSpan.textContent = String(i + 1);
    lineNumbersDiv.appendChild(numSpan);

    const lineDiv = document.createElement('div');
    lineDiv.className = 'code-line';
    lineDiv.innerHTML = tokenize(lines[i], lang);
    codeContentDiv.appendChild(lineDiv);
  }

  codeBody.appendChild(lineNumbersDiv);
  codeBody.appendChild(codeContentDiv);
  el.appendChild(codeBody);

  return el;
});


// ── B-10: Equation/Formula Block (#064) ─────────────────────────────────────
// SSE shape: {latex, display_mode}

BlockFactory.register('equation', (data) => {
  const el = document.createElement('div');

  if (!data.latex) {
    el.className = 'block-empty-state';
    el.textContent = 'No equation provided';
    return el;
  }

  if (typeof katex !== 'undefined') {
    try {
      const inner = document.createElement('div');
      inner.className = 'block-equation-inner';
      katex.render(data.latex, inner, {
        displayMode: data.display_mode !== false,
        throwOnError: false,
        errorColor: '#EF4444',
      });
      el.appendChild(inner);
    } catch {
      const fallback = document.createElement('div');
      fallback.className = 'block-equation-fallback';
      fallback.textContent = data.latex;
      el.appendChild(fallback);
    }
  } else {
    // KaTeX not loaded -- render fallback
    const fallback = document.createElement('div');
    fallback.className = 'block-equation-fallback';
    fallback.textContent = data.latex;
    el.appendChild(fallback);
  }

  return el;
});


// ── Utility ─────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 3: CODE VARIANT BLOCKS (B-19 through B-22)
// ══════════════════════════════════════════════════════════════════════════════

// B-19: #101 Python Code Block
BlockFactory.register('python_code', (data) => {
  const el = document.createElement('div');
  el.setAttribute('role', 'code');
  el.setAttribute('aria-label', 'Code: Python');
  if (!data || !data.code) {
    el.className = 'block-empty-state';
    el.textContent = 'No code provided';
    return el;
  }
  el.style.position = 'relative';

  const header = document.createElement('div');
  header.className = 'code-block-header';
  header.innerHTML = `<span class="code-lang-badge code-lang-python">Python</span>${data.filename ? `<span class="code-filename">${escapeHtml(data.filename)}</span>` : ''}`;
  el.appendChild(header);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'block-copy-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => copyToClipboard(data.code, copyBtn));
  el.appendChild(copyBtn);

  const pre = document.createElement('pre');
  pre.className = 'code-block';
  const codeEl = document.createElement('code');
  codeEl.innerHTML = tokenize(data.code, 'python');
  pre.appendChild(codeEl);
  el.appendChild(pre);
  return el;
});

// B-20: #102 SQL Query Block
BlockFactory.register('sql_query', (data) => {
  const el = document.createElement('div');
  el.setAttribute('role', 'code');
  el.setAttribute('aria-label', 'Code: SQL');
  if (!data || !data.code) {
    el.className = 'block-empty-state';
    el.textContent = 'No SQL query provided';
    return el;
  }
  el.style.position = 'relative';

  const header = document.createElement('div');
  header.className = 'code-block-header';
  header.innerHTML = '<span class="code-lang-badge code-lang-sql">SQL</span>';
  el.appendChild(header);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'block-copy-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => copyToClipboard(data.code, copyBtn));
  el.appendChild(copyBtn);

  const pre = document.createElement('pre');
  pre.className = 'code-block';
  const codeEl = document.createElement('code');
  codeEl.innerHTML = tokenize(data.code, 'sql');
  pre.appendChild(codeEl);
  el.appendChild(pre);

  if (data.explain_text) {
    const section = document.createElement('div');
    section.className = 'code-explain-section';
    const btn = document.createElement('button');
    btn.className = 'code-explain-btn';
    btn.textContent = 'Explain Query';
    btn.setAttribute('aria-expanded', 'false');
    const content = document.createElement('div');
    content.className = 'code-explain-content';
    content.style.display = 'none';
    content.textContent = data.explain_text;
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      content.style.display = expanded ? 'none' : 'block';
      btn.textContent = expanded ? 'Explain Query' : 'Hide Explanation';
    });
    section.appendChild(btn);
    section.appendChild(content);
    el.appendChild(section);
  }
  return el;
});

// B-21: #103 JSON Data Block
BlockFactory.register('json_data', (data) => {
  const el = document.createElement('div');
  el.setAttribute('role', 'code');
  el.setAttribute('aria-label', 'Code: JSON');
  if (!data || data.data === undefined) {
    el.className = 'block-empty-state';
    el.textContent = 'No JSON data provided';
    return el;
  }
  el.style.position = 'relative';

  const header = document.createElement('div');
  header.className = 'code-block-header';
  header.innerHTML = '<span class="code-lang-badge code-lang-json">JSON</span>';
  el.appendChild(header);

  const jsonStr = typeof data.data === 'string' ? data.data : JSON.stringify(data.data, null, 2);
  const copyBtn = document.createElement('button');
  copyBtn.className = 'block-copy-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => copyToClipboard(jsonStr, copyBtn));
  el.appendChild(copyBtn);

  if (data.collapsible && typeof data.data === 'object' && data.data !== null) {
    const treeContainer = document.createElement('div');
    treeContainer.className = 'json-tree';
    _buildJsonTree(treeContainer, data.data, 0);
    el.appendChild(treeContainer);
  } else {
    const pre = document.createElement('pre');
    pre.className = 'code-block';
    const codeEl = document.createElement('code');
    codeEl.innerHTML = tokenize(jsonStr, 'json');
    pre.appendChild(codeEl);
    el.appendChild(pre);
  }
  return el;
});

function _buildJsonTree(parent, obj, depth) {
  if (depth > 8) return;
  const isArray = Array.isArray(obj);
  const entries = isArray ? obj.map((v, i) => [String(i), v]) : Object.entries(obj || {});
  for (const [key, value] of entries) {
    const row = document.createElement('div');
    row.className = 'json-tree-row';
    row.style.paddingLeft = `${depth * 16 + 8}px`;
    if (value !== null && typeof value === 'object') {
      const toggle = document.createElement('button');
      toggle.className = 'json-tree-toggle';
      toggle.textContent = '\u2212';
      toggle.setAttribute('aria-expanded', 'true');
      const childContainer = document.createElement('div');
      const keySpan = document.createElement('span');
      keySpan.className = 'tok-key';
      keySpan.textContent = isArray ? `[${key}]` : `"${key}"`;
      const bracketSpan = document.createElement('span');
      bracketSpan.className = 'tok-comment';
      bracketSpan.textContent = Array.isArray(value) ? ` [${value.length}]` : ` {${Object.keys(value).length}}`;
      row.appendChild(toggle);
      row.appendChild(keySpan);
      row.appendChild(bracketSpan);
      parent.appendChild(row);
      _buildJsonTree(childContainer, value, depth + 1);
      parent.appendChild(childContainer);
      toggle.addEventListener('click', () => {
        const exp = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!exp));
        toggle.textContent = exp ? '+' : '\u2212';
        childContainer.style.display = exp ? 'none' : '';
      });
    } else {
      const keySpan = document.createElement('span');
      keySpan.className = 'tok-key';
      keySpan.textContent = isArray ? `[${key}]: ` : `"${key}": `;
      const valSpan = document.createElement('span');
      if (typeof value === 'string') { valSpan.className = 'tok-string'; valSpan.textContent = `"${value}"`; }
      else if (typeof value === 'number') { valSpan.className = 'tok-number'; valSpan.textContent = String(value); }
      else { valSpan.className = 'tok-keyword'; valSpan.textContent = String(value); }
      row.appendChild(keySpan);
      row.appendChild(valSpan);
      parent.appendChild(row);
    }
  }
}

// B-22: #104 API Endpoint Block
BlockFactory.register('api_endpoint', (data) => {
  const el = document.createElement('div');
  el.setAttribute('role', 'article');
  el.setAttribute('aria-label', `API Endpoint: ${data?.method || ''} ${data?.path || ''}`);
  if (!data || !data.method || !data.path) {
    el.className = 'block-empty-state';
    el.textContent = 'API endpoint data unavailable';
    return el;
  }
  const methodColors = { GET: '#22C55E', POST: '#3B82F6', PUT: '#F59E0B', DELETE: '#EF4444', PATCH: '#9333EA' };
  const color = methodColors[data.method.toUpperCase()] || '#64748B';

  const header = document.createElement('div');
  header.className = 'api-endpoint-header';
  header.innerHTML = `<span class="api-method-badge" style="background:${color}">${escapeHtml(data.method.toUpperCase())}</span><code class="api-path">${escapeHtml(data.path)}</code>`;
  el.appendChild(header);

  if (data.params && data.params.length) {
    const paramDiv = document.createElement('div');
    paramDiv.className = 'api-params';
    paramDiv.innerHTML = '<div class="api-section-label">Parameters</div>';
    const table = document.createElement('table');
    table.className = 'api-params-table';
    table.innerHTML = '<thead><tr><th>Name</th><th>Type</th><th>Req</th><th>Description</th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (const p of data.params) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="tok-key">${escapeHtml(p.name || '')}</td><td>${escapeHtml(p.type || 'string')}</td><td>${p.required ? 'Yes' : 'No'}</td><td>${escapeHtml(p.description || '')}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    paramDiv.appendChild(table);
    el.appendChild(paramDiv);
  }

  const curlStr = `curl -X ${data.method.toUpperCase()} "${data.base_url || 'https://api.example.com'}${data.path}"`;
  const curlDiv = document.createElement('div');
  curlDiv.className = 'api-curl-section';
  curlDiv.innerHTML = '<div class="api-section-label">Example</div>';
  const curlPre = document.createElement('pre');
  curlPre.className = 'code-block';
  curlPre.textContent = curlStr;
  curlPre.style.position = 'relative';
  const curlCopyBtn = document.createElement('button');
  curlCopyBtn.className = 'block-copy-btn';
  curlCopyBtn.textContent = 'Copy';
  curlCopyBtn.addEventListener('click', () => copyToClipboard(curlStr, curlCopyBtn));
  curlPre.appendChild(curlCopyBtn);
  curlDiv.appendChild(curlPre);
  el.appendChild(curlDiv);

  if (data.response_schema) {
    const schemaDiv = document.createElement('div');
    schemaDiv.className = 'api-schema-section';
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'code-explain-btn';
    toggleBtn.textContent = 'Response Schema';
    toggleBtn.setAttribute('aria-expanded', 'false');
    const schemaPre = document.createElement('pre');
    schemaPre.className = 'code-block';
    schemaPre.style.display = 'none';
    const schemaStr = typeof data.response_schema === 'string' ? data.response_schema : JSON.stringify(data.response_schema, null, 2);
    schemaPre.innerHTML = `<code>${tokenize(schemaStr, 'json')}</code>`;
    toggleBtn.addEventListener('click', () => {
      const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      toggleBtn.setAttribute('aria-expanded', String(!expanded));
      schemaPre.style.display = expanded ? 'none' : 'block';
      toggleBtn.textContent = expanded ? 'Response Schema' : 'Hide Schema';
    });
    schemaDiv.appendChild(toggleBtn);
    schemaDiv.appendChild(schemaPre);
    el.appendChild(schemaDiv);
  }
  return el;
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 4: CONVERSATION BLOCK RENDERERS (B-23, B-24, B-25)
// ══════════════════════════════════════════════════════════════════════════════

// B-23: #051 Inline Citation Reference
BlockFactory.register('citation_ref', (data) => {
  const el = document.createElement('sup');
  el.className = 'citation-ref';
  el.setAttribute('role', 'link');
  if (!data || !data.footnote_index) {
    el.textContent = '[?]';
    return el;
  }
  el.dataset.footnote = data.footnote_index;
  el.dataset.paperId = data.paper_id || '';
  el.id = `cite-ref-${data.footnote_index}`;
  el.setAttribute('aria-describedby', `footnote-${data.footnote_index}`);
  el.textContent = `[${data.footnote_index}]`;
  return el;
});

// B-24: #136 Footnote System
BlockFactory.register('footnote', (data) => {
  const el = document.createElement('div');
  el.className = 'block-footnotes';
  el.setAttribute('role', 'doc-endnotes');
  if (!data || !data.footnotes || !data.footnotes.length) {
    return document.createElement('span');
  }
  const divider = document.createElement('div');
  divider.className = 'footnote-divider';
  el.appendChild(divider);
  const ol = document.createElement('ol');
  ol.className = 'footnote-list';
  for (const fn of data.footnotes) {
    const li = document.createElement('li');
    li.id = `footnote-${fn.index}`;
    li.className = 'footnote-item';
    li.innerHTML = `<a href="#cite-ref-${fn.index}" class="footnote-backlink" aria-label="Back to citation ${fn.index}">&uarr;</a><span class="footnote-text">${escapeHtml(fn.title || 'Unknown')}</span>${fn.year || fn.authors ? `<span class="footnote-meta">${fn.year || ''}${fn.authors ? ' | ' + escapeHtml(fn.authors) : ''}</span>` : ''}`;
    ol.appendChild(li);
  }
  el.appendChild(ol);
  return el;
});

// B-25: #132 Confidence Thermometer
BlockFactory.register('confidence_bar', (data) => {
  const el = document.createElement('div');
  el.className = 'block-confidence';
  if (!data) {
    el.className = 'block-empty-state';
    el.textContent = 'Unknown confidence';
    return el;
  }
  const score = Math.max(0, Math.min(1, data.score || 0));
  const pct = Math.round(score * 100);
  el.setAttribute('role', 'progressbar');
  el.setAttribute('aria-valuenow', String(pct));
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '100');
  const colors = { HIGH: '#22C55E', MEDIUM: '#3B82F6', LOW: '#F59E0B', SPECULATIVE: '#9333EA' };
  const level = (data.level || 'MEDIUM').toUpperCase();
  const fillColor = colors[level] || colors.MEDIUM;
  el.innerHTML = `<div class="confidence-header"><span class="confidence-label">${escapeHtml(data.label || 'Confidence')}</span><span class="confidence-value" style="color:${fillColor}">${pct}% ${level}</span></div><div class="confidence-track"><div class="confidence-fill" style="width:${pct}%;background:${fillColor}"></div></div>`;
  return el;
});


// ══════════════════════════════════════════════════════════════════════════════
// ── Phase B Group 2: CHART BLOCKS ────────────────────────────────────────────
// Per ATHENA_PHASE_B.md Section 2.1.4 SVG Chart Rendering Guide
// All charts use INLINE SVG. No external charting libraries.
// ══════════════════════════════════════════════════════════════════════════════

// Mutation type colors for inline mini-graph edges
const MUTATION_COLORS = {
  'adoption': '#3B82F6',
  'generalization': '#06B6D4',
  'specialization': '#22C55E',
  'hybridization': '#9333EA',
  'contradiction': '#EF4444',
  'revival': '#F59E0B',
  'incidental': '#64748B',
};

// SVG arc helpers per ATHENA_PHASE_B.md Section 2.1.4
function polarToCartesian(cx, cy, radius, degrees) {
  const rad = (degrees - 90) * Math.PI / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function describeArc(cx, cy, radius, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function heatColor(value, min, max) {
  // Zero values get near-white background
  if (value === 0) return 'rgb(248,250,252)';
  // Nonzero values always get a visible color: min t is 0.2 so cells are never invisible
  const rawT = max === min ? 1 : (value - min) / (max - min);
  const t = 0.2 + rawT * 0.8; // Ensure minimum 20% intensity for nonzero
  const r = Math.round(248 + (212 - 248) * t);
  const g = Math.round(250 + (168 - 250) * t);
  const b = Math.round(252 + (67 - 252) * t);
  return `rgb(${r},${g},${b})`;
}

// ── B-11: #083 Mini Donut Chart ──────────────────────────────────────────────
// SSE shape: {segments: [{label, value, color}], total}
// viewBox: 200x200, radius 80, stroke-width 30
BlockFactory.register('mini_chart_donut', (data) => {
  const el = document.createElement('div');
  const segments = data.segments || [];
  const total = data.total || segments.reduce((s, seg) => s + (seg.value || 0), 0);

  if (!segments.length || total === 0) {
    el.className = 'block-empty-state';
    el.textContent = 'No field data available';
    return el;
  }

  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Donut chart: field distribution');

  const cx = 100, cy = 100, radius = 80;
  let currentAngle = 0;
  let paths = '';

  for (const seg of segments) {
    const segAngle = (seg.value / total) * 360;
    if (segAngle < 0.5) continue;
    const endAngle = currentAngle + segAngle;
    if (segAngle >= 359.9) {
      paths += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${escapeHtml(seg.color || '#64748B')}" stroke-width="30" aria-label="${escapeHtml(seg.label || '')}: ${seg.value}"/>`;
    } else {
      const d = describeArc(cx, cy, radius, currentAngle, endAngle);
      paths += `<path d="${d}" fill="none" stroke="${escapeHtml(seg.color || '#64748B')}" stroke-width="30" class="donut-segment" data-label="${escapeHtml(seg.label || '')}" data-value="${seg.value}" aria-label="${escapeHtml(seg.label || '')}: ${seg.value}"/>`;
    }
    currentAngle = endAngle;
  }

  let legendHtml = '<div class="chart-legend">';
  for (const seg of segments) {
    legendHtml += `<span class="chart-legend-item"><span class="chart-legend-dot" style="background:${escapeHtml(seg.color || '#64748B')}"></span>${escapeHtml(seg.label || '')} (${seg.value})</span>`;
  }
  legendHtml += '</div>';

  el.innerHTML = `
    <svg viewBox="0 0 200 200" class="chart-svg chart-donut-svg" aria-hidden="true">
      ${paths}
      <text x="100" y="105" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="20" fill="#1a1a2e">${total}</text>
    </svg>
    ${legendHtml}
  `;

  el.addEventListener('mouseover', (e) => {
    const seg = e.target.closest('.donut-segment');
    if (seg) AthenaTooltip.show(seg, `${seg.dataset.label}: ${seg.dataset.value}`);
  });
  el.addEventListener('mouseout', (e) => {
    if (e.target.closest('.donut-segment')) AthenaTooltip.hide();
  });

  return el;
});


// ── B-12: #084 Mini Bar Chart ────────────────────────────────────────────────
// SSE shape: {bars: [{label, value, color}], max}
// Horizontal bars, max 12
BlockFactory.register('mini_chart_bar', (data) => {
  const el = document.createElement('div');
  const bars = data.bars || [];
  const maxVal = data.max || Math.max(...bars.map(b => b.value || 0), 1);

  if (!bars.length) {
    el.className = 'block-empty-state';
    el.textContent = 'No data available';
    return el;
  }

  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Bar chart: top papers by citations');

  const barHeight = 24;
  const gap = 4;
  const svgHeight = bars.length * (barHeight + gap) + 8;
  const maxBarWidth = 180;
  const labelWidth = 100;

  let rects = '';
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const y = i * (barHeight + gap) + 4;
    const width = Math.max(2, (bar.value / maxVal) * maxBarWidth);
    const label = (bar.label || '').length > 20 ? bar.label.slice(0, 18) + '..' : (bar.label || '');
    const color = bar.color || CHART_PALETTE[i % CHART_PALETTE.length];

    rects += `
      <text x="0" y="${y + 16}" font-family="Inter, sans-serif" font-size="11" fill="#64748B">${escapeHtml(label)}</text>
      <rect x="${labelWidth}" y="${y}" width="${width}" height="${barHeight}" rx="4" fill="${escapeHtml(color)}" class="bar-segment" data-label="${escapeHtml(bar.label || '')}" data-value="${bar.value}" aria-label="${escapeHtml(bar.label || '')}: ${(bar.value || 0).toLocaleString()}"/>
      <text x="${labelWidth + width + 8}" y="${y + 16}" font-family="JetBrains Mono, monospace" font-size="11" fill="#1a1a2e">${(bar.value || 0).toLocaleString()}</text>
    `;
  }

  el.innerHTML = `
    <svg viewBox="0 0 300 ${svgHeight}" class="chart-svg chart-bar-svg" aria-hidden="true">
      ${rects}
    </svg>
  `;

  el.addEventListener('mouseover', (e) => {
    const seg = e.target.closest('.bar-segment');
    if (seg) AthenaTooltip.show(seg, `${seg.dataset.label}: ${Number(seg.dataset.value).toLocaleString()}`);
  });
  el.addEventListener('mouseout', (e) => {
    if (e.target.closest('.bar-segment')) AthenaTooltip.hide();
  });

  return el;
});


// ── B-13: #087 Sparkline ─────────────────────────────────────────────────────
// SSE shape: {values: [], label, trend}
// viewBox: 200x50 + trend indicator
BlockFactory.register('sparkline', (data) => {
  const el = document.createElement('div');
  const values = data.values || [];
  const label = data.label || '';
  const trend = data.trend || 'flat';

  if (values.length < 2) {
    el.className = 'block-empty-state';
    el.textContent = 'Insufficient data for sparkline';
    return el;
  }

  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `Sparkline: ${escapeHtml(label)}, trend ${trend}`);

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  const svgH = 80;
  const points = values.map((val, i) => {
    const x = i * (200 / (values.length - 1));
    const y = svgH - 8 - ((val - minVal) / range) * (svgH - 16);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  let trendSvg = '';
  const trendY = svgH / 2;
  if (trend === 'up') {
    trendSvg = `<polygon points="210,${trendY + 6} 215,${trendY - 6} 220,${trendY + 6}" fill="#22C55E"/>`;
  } else if (trend === 'down') {
    trendSvg = `<polygon points="210,${trendY - 6} 215,${trendY + 6} 220,${trendY - 6}" fill="#EF4444"/>`;
  } else {
    trendSvg = `<line x1="208" y1="${trendY}" x2="222" y2="${trendY}" stroke="#94A3B8" stroke-width="2"/>`;
  }

  el.innerHTML = `
    ${label ? `<div class="sparkline-label">${escapeHtml(label)}</div>` : ''}
    <svg viewBox="0 0 230 ${svgH}" class="chart-svg chart-sparkline-svg" aria-hidden="true">
      <polyline points="${points}" fill="none" stroke="#D4A843" stroke-width="2"/>
      ${trendSvg}
    </svg>
  `;

  return el;
});


// ── B-14: #088 Progress Ring ─────────────────────────────────────────────────
// SSE shape: {value, max, label, color}
// viewBox: 100x100, radius 40
BlockFactory.register('progress_ring', (data) => {
  const el = document.createElement('div');
  const value = data.value || 0;
  const max = data.max || 100;
  const label = data.label || '';
  const color = data.color || '#D4A843';

  const circumference = 2 * Math.PI * 40;
  const arcLength = (value / max) * circumference;
  const pct = Math.round((value / max) * 100);

  el.setAttribute('role', 'progressbar');
  el.setAttribute('aria-valuenow', String(pct));
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '100');
  el.setAttribute('aria-label', `${label}: ${pct}%`);

  el.innerHTML = `
    <svg viewBox="0 0 100 100" class="chart-svg chart-ring-svg" aria-hidden="true">
      <circle cx="50" cy="50" r="40" fill="none" stroke="#E2E8F0" stroke-width="8"/>
      <circle cx="50" cy="50" r="40" fill="none" stroke="${escapeHtml(color)}" stroke-width="8"
        stroke-dasharray="${arcLength.toFixed(1)} ${circumference.toFixed(1)}"
        stroke-linecap="round" transform="rotate(-90 50 50)"/>
      <text x="50" y="54" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="16" fill="#1a1a2e">${pct}%</text>
    </svg>
    ${label ? `<div class="progress-ring-label">${escapeHtml(label)}</div>` : ''}
  `;

  return el;
});


// ── B-15: #085 Heatmap ───────────────────────────────────────────────────────
// SSE shape: {rows: [], cols: [], values: [[]]}
// Grid of colored rects with tooltips
BlockFactory.register('heatmap', (data) => {
  const el = document.createElement('div');
  const rows = data.rows || [];
  const cols = data.cols || [];
  const values = data.values || [];

  if (!rows.length || !cols.length || !values.length) {
    el.className = 'block-empty-state';
    el.textContent = 'No heatmap data available';
    return el;
  }

  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Heatmap: mutation types by confidence tier');

  const maxRows = Math.min(rows.length, 20);
  const maxCols = Math.min(cols.length, 20);

  let allVals = [];
  for (let r = 0; r < maxRows; r++) {
    for (let c = 0; c < maxCols; c++) {
      allVals.push((values[r] && values[r][c]) || 0);
    }
  }
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);

  const labelOffset = 110;
  const topOffset = 50;
  const cellW = Math.max(28, Math.floor(200 / maxCols));
  const cellH = Math.max(22, Math.floor(160 / maxRows));
  const svgW = labelOffset + maxCols * cellW + 10;
  const svgH = topOffset + maxRows * cellH + 10;

  let cells = '';

  // Column headers (allow longer labels for confidence tiers)
  for (let c = 0; c < maxCols; c++) {
    const x = labelOffset + c * cellW + cellW / 2;
    const colLabel = (cols[c] || '').length > 12 ? cols[c].slice(0, 11) + '..' : (cols[c] || '');
    cells += `<text x="${x}" y="${topOffset - 10}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" fill="#64748B">${escapeHtml(colLabel)}</text>`;
  }

  // Rows (allow longer labels for mutation type names like "generalization")
  for (let r = 0; r < maxRows; r++) {
    const y = topOffset + r * cellH;
    const rowLabel = (rows[r] || '').length > 16 ? rows[r].slice(0, 15) + '..' : (rows[r] || '');
    cells += `<text x="${labelOffset - 4}" y="${y + cellH / 2 + 3}" text-anchor="end" font-family="Inter, sans-serif" font-size="9" fill="#64748B">${escapeHtml(rowLabel)}</text>`;

    for (let c = 0; c < maxCols; c++) {
      const x = labelOffset + c * cellW;
      const val = (values[r] && values[r][c]) || 0;
      const fill = heatColor(val, minV, maxV);
      cells += `<rect x="${x}" y="${y}" width="${cellW - 1}" height="${cellH - 1}" rx="2" fill="${fill}" class="heatmap-cell" data-row="${escapeHtml(rows[r] || '')}" data-col="${escapeHtml(cols[c] || '')}" data-value="${val}" aria-label="${escapeHtml(rows[r] || '')} x ${escapeHtml(cols[c] || '')}: ${val}"/>`;
    }
  }

  el.innerHTML = `
    <svg viewBox="0 0 ${svgW} ${svgH}" class="chart-svg chart-heatmap-svg" aria-hidden="true">
      ${cells}
    </svg>
  `;

  el.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('.heatmap-cell');
    if (cell) AthenaTooltip.show(cell, `${cell.dataset.row} / ${cell.dataset.col}: ${cell.dataset.value}`);
  });
  el.addEventListener('mouseout', (e) => {
    if (e.target.closest('.heatmap-cell')) AthenaTooltip.hide();
  });

  return el;
});


// ── B-16: #086 Network Snippet ───────────────────────────────────────────────
// SSE shape: {nodes: [{id, label, x, y, is_center}], edges: [{from, to}]}
// viewBox: 300x200, static SVG, no interactivity
BlockFactory.register('network_snippet', (data) => {
  const el = document.createElement('div');
  const nodes = data.nodes || [];
  const edges = data.edges || [];

  if (!nodes.length) {
    el.className = 'block-empty-state';
    el.textContent = 'No network data available';
    return el;
  }

  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Network: subgraph snippet');

  const nodeMap = {};
  for (const n of nodes) { nodeMap[n.id] = n; }

  let lines = '';
  for (const edge of edges) {
    const from = nodeMap[edge.from];
    const to = nodeMap[edge.to];
    if (from && to) {
      lines += `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#64748B" stroke-width="1" opacity="0.5"/>`;
    }
  }

  let circles = '';
  for (const n of nodes) {
    const isCenter = n.is_center;
    const r = isCenter ? 10 : 8;
    const stroke = isCenter ? '#D4A843' : '#64748B';
    const strokeW = isCenter ? 2 : 1;
    const fill = isCenter ? '#D4A843' : '#3B82F6';
    const label = (n.label || '').length > 20 ? n.label.slice(0, 18) + '..' : (n.label || '');

    circles += `
      <circle cx="${n.x}" cy="${n.y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" class="network-node" data-label="${escapeHtml(n.label || '')}"/>
      <text x="${n.x}" y="${n.y + r + 12}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" fill="#94A3B8">${escapeHtml(label)}</text>
    `;
  }

  el.innerHTML = `
    <svg viewBox="0 0 300 200" class="chart-svg chart-network-svg" aria-hidden="true">
      ${lines}
      ${circles}
    </svg>
  `;

  el.addEventListener('mouseover', (e) => {
    const node = e.target.closest('.network-node');
    if (node) AthenaTooltip.show(node, node.dataset.label);
  });
  el.addEventListener('mouseout', (e) => {
    if (e.target.closest('.network-node')) AthenaTooltip.hide();
  });

  return el;
});


// ── Phase C #020: Citation Sentence Viewer ──────────────────────────────────
// SSE shape: {edge_id, citing_paper, cited_paper, citing_sentence, cited_sentence,
//             citing_source, cited_source, mutation_type, confidence, confidence_tier,
//             citation_intent, mutation_evidence, similarity_score, citing_text_tier, cited_text_tier}
BlockFactory.register('citation_evidence', (data) => {
  const el = document.createElement('div');
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Citation evidence');

  const citingSentence = data.citing_sentence;
  const citedSentence = data.cited_sentence;
  const hasCiting = citingSentence && citingSentence.trim().length > 0;
  const hasCited = citedSentence && citedSentence.trim().length > 0;
  const hasBoth = hasCiting && hasCited;
  const hasNeither = !hasCiting && !hasCited;

  // Similarity bar color
  const sim = parseFloat(data.similarity_score || 0);
  let simColor = '#64748B'; // gray <0.25
  if (sim > 0.7) simColor = '#22C55E';      // green
  else if (sim > 0.5) simColor = '#3B82F6';  // blue
  else if (sim > 0.25) simColor = '#F59E0B'; // yellow

  // Confidence tier color
  const confTier = (data.confidence_tier || 'SPECULATIVE').toUpperCase();
  const confColors = { HIGH: '#22C55E', MEDIUM: '#3B82F6', LOW: '#F59E0B', SPECULATIVE: '#9333EA' };
  const confColor = confColors[confTier] || '#9333EA';

  // Source labels
  const citingSource = data.citing_source && data.citing_source !== 'none'
    ? data.citing_source : null;
  const citedSource = data.cited_source && data.cited_source !== 'none'
    ? data.cited_source : null;

  // Citing paper short name
  const citingPaper = (data.citing_paper || 'Citing paper').length > 35
    ? data.citing_paper.substring(0, 33) + '...' : (data.citing_paper || 'Citing paper');
  const citedPaper = (data.cited_paper || 'Cited paper').length > 35
    ? data.cited_paper.substring(0, 33) + '...' : (data.cited_paper || 'Cited paper');

  // Build the unavailable message for missing sentences
  const tierMsg = (tier) => tier <= 2 ? '' : tier === 3 ? 'abstract-only data' : 'title-only data';
  const citingUnavail = !hasCiting
    ? `<span class="citation-unavailable">Sentence not available${data.citing_text_tier ? ' — ' + tierMsg(data.citing_text_tier) : ''}</span>`
    : '';
  const citedUnavail = !hasCited
    ? `<span class="citation-unavailable">Sentence not available${data.cited_text_tier ? ' — ' + tierMsg(data.cited_text_tier) : ''}</span>`
    : '';

  // Mutation type human-readable descriptions
  const mutationDesc = {
    'adoption': 'directly adopted methods or techniques from',
    'generalization': 'generalized the approach of',
    'specialization': 'specialized or narrowed the methods of',
    'hybridization': 'combined ideas from this paper with other approaches',
    'contradiction': 'contradicts or challenges findings from',
    'revival': 'revived or rediscovered ideas from',
    'incidental': 'references but does not deeply engage with',
  };

  // Intent human-readable
  const intentDesc = {
    'methodological_adoption': 'Uses methods from this paper',
    'theoretical_foundation': 'Builds on theoretical foundations',
    'empirical_baseline': 'Compares against as baseline',
    'conceptual_inspiration': 'Draws conceptual inspiration',
    'direct_contradiction': 'Directly challenges findings',
    'incidental_mention': 'Brief reference without deep engagement',
    'negative_citation': 'Cites to critique or disagree',
  };

  if (hasNeither) {
    // No sentences — show a rich relationship summary card instead
    const mutType = (data.mutation_type || 'incidental').toLowerCase();
    const desc = mutationDesc[mutType] || 'references';
    const intentLabel = intentDesc[data.citation_intent] || '';

    el.innerHTML = `
      <div class="citation-header">
        <span class="citation-header-label">EDGE ANALYSIS</span>
      </div>
      <div class="citation-relationship">
        <div class="citation-rel-papers">
          <span class="citation-rel-citing" title="${escapeHtml(data.citing_paper || '')}">${escapeHtml(citingPaper)}</span>
          <span class="citation-rel-arrow">→</span>
          <span class="citation-rel-cited" title="${escapeHtml(data.cited_paper || '')}">${escapeHtml(citedPaper)}</span>
        </div>
        <p class="citation-rel-desc"><strong>${escapeHtml(citingPaper)}</strong> ${desc} <strong>${escapeHtml(citedPaper)}</strong>.</p>
        ${intentLabel ? `<p class="citation-rel-intent">${escapeHtml(intentLabel)}</p>` : ''}
      </div>
      <div class="citation-meta">
        <span class="citation-badge citation-badge--mutation">${escapeHtml(mutType.replace(/_/g, ' '))}</span>
        <span class="citation-badge citation-badge--confidence" style="border-color:${confColor};color:${confColor}">${confTier} ${data.confidence ? (parseFloat(data.confidence) * 100).toFixed(0) + '%' : ''}</span>
      </div>
      <div class="citation-data-note">
        <span class="citation-data-note-text">Sentence-level evidence unavailable — classified from structural analysis</span>
      </div>
      ${data.edge_id ? `<button class="citation-flag-btn" data-edge-id="${escapeHtml(data.edge_id)}">Flag if incorrect</button>` : ''}
    `;
  } else {
    // At least one sentence available — show full citation block
    el.innerHTML = `
      <div class="citation-header">
        <span class="citation-header-label">CITATION EVIDENCE</span>
        ${!hasNeither && sim > 0 ? `<span class="citation-sim-label">Similarity: ${sim.toFixed(2)}</span>` : ''}
      </div>
      <div class="citation-sentences">
        <div class="citation-sentence citation-sentence--citing">
          <div class="citation-sentence-label">CITING <span class="citation-paper-name">${escapeHtml(citingPaper)}</span>${citingSource ? ` <span class="citation-source-badge">${escapeHtml(citingSource)}</span>` : ''}</div>
          ${hasCiting
            ? `<blockquote class="citation-quote">"${escapeHtml(citingSentence)}"</blockquote>`
            : citingUnavail}
        </div>
        <div class="citation-sentence citation-sentence--cited">
          <div class="citation-sentence-label">CITED <span class="citation-paper-name">${escapeHtml(citedPaper)}</span>${citedSource ? ` <span class="citation-source-badge">${escapeHtml(citedSource)}</span>` : ''}</div>
          ${hasCited
            ? `<blockquote class="citation-quote">"${escapeHtml(citedSentence)}"</blockquote>`
            : citedUnavail}
        </div>
      </div>
      ${!hasNeither && sim > 0 ? `
      <div class="citation-sim-bar">
        <div class="citation-sim-fill" style="width:${Math.min(sim * 100, 100)}%;background:${simColor}"></div>
      </div>` : ''}
      <div class="citation-meta">
        <span class="citation-badge citation-badge--mutation">${escapeHtml((data.mutation_type || '').replace(/_/g, ' '))}</span>
        <span class="citation-badge citation-badge--confidence" style="border-color:${confColor};color:${confColor}">${confTier} ${data.confidence ? (parseFloat(data.confidence) * 100).toFixed(0) + '%' : ''}</span>
        <span class="citation-badge citation-badge--intent">${escapeHtml((data.citation_intent || '').replace(/_/g, ' '))}</span>
      </div>
      ${data.edge_id ? `<button class="citation-flag-btn" data-edge-id="${escapeHtml(data.edge_id)}">Flag if incorrect</button>` : ''}
    `;
  }

  // Wire up flag button
  const flagBtn = el.querySelector('.citation-flag-btn');
  if (flagBtn) {
    flagBtn.addEventListener('click', async () => {
      const edgeId = flagBtn.dataset.edgeId;
      const reason = prompt('Why is this classification incorrect?');
      if (!reason) return;
      try {
        const resp = await fetch('/api/flag-edge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            edge_id: edgeId,
            source_id: data.citing_paper_id,
            target_id: data.cited_paper_id,
            seed_paper_id: '',
            reason,
          }),
        });
        if (resp.ok) {
          flagBtn.textContent = '✓ Feedback submitted';
          flagBtn.disabled = true;
          flagBtn.classList.add('citation-flag-btn--submitted');
        }
      } catch (e) {
        console.error('Flag submission failed:', e);
      }
    });
  }

  return el;
});

// ── Phase C #012: Terminal Suggestion Block ──────────────────────────────────
// Shows when Athena detects an annotation/terminal command and suggests the syntax
BlockFactory.register('terminal_suggest', (data) => {
  const el = document.createElement('div');
  el.style.cssText = 'border:1px solid #30363D;border-radius:8px;overflow:hidden;margin:8px 0;';

  el.innerHTML = `
    <div style="padding:8px 12px;background:#161B22;border-bottom:1px solid #30363D;display:flex;align-items:center;gap:8px;">
      <span style="color:#22C55E;font-size:14px;">▶</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#64748B;letter-spacing:0.06em;text-transform:uppercase;">Terminal Command</span>
    </div>
    <div style="padding:12px;background:#0D1117;font-family:'JetBrains Mono',monospace;font-size:12px;color:#E6EDF3;">
      <span style="color:#22C55E;">arivu$</span> <span style="color:#D4A843;">${escapeHtml(data.command || '')}</span>
    </div>
    <div style="padding:8px 12px;background:#161B22;display:flex;gap:8px;flex-wrap:wrap;">
      <button class="term-suggest-btn term-suggest-btn--yes" data-cmd="${escapeHtml(data.command || '')}">Execute</button>
      <button class="term-suggest-btn term-suggest-btn--open" data-cmd="${escapeHtml(data.command || '')}">Open Terminal</button>
      <button class="term-suggest-btn term-suggest-btn--no">No thanks</button>
    </div>
  `;

  // Style buttons inline
  el.querySelectorAll('.term-suggest-btn').forEach(btn => {
    btn.style.cssText = 'padding:5px 12px;border-radius:4px;font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:600;cursor:pointer;border:1px solid;transition:all 150ms;';
  });
  const yesBtn = el.querySelector('.term-suggest-btn--yes');
  if (yesBtn) yesBtn.style.cssText += 'background:#22C55E;color:#fff;border-color:#22C55E;';
  const openBtn = el.querySelector('.term-suggest-btn--open');
  if (openBtn) openBtn.style.cssText += 'background:transparent;color:#D4A843;border-color:#D4A843;';
  const noBtn = el.querySelector('.term-suggest-btn--no');
  if (noBtn) noBtn.style.cssText += 'background:transparent;color:#64748B;border-color:#30363D;';

  // Execute button — open terminal + typewriter execute
  yesBtn?.addEventListener('click', function() {
    const cmd = this.dataset.cmd;
    const tm = window.terminalManager;
    if (!tm) return;
    let term = tm.getActive();
    if (!term) term = tm.create();
    term.focus();
    term.typeAndExecute(cmd);
    this.closest('div').innerHTML = '<span style="color:#22C55E;font-size:11px;font-style:italic;">✓ Executed in terminal</span>';
  });

  // Open Terminal button — open with command pre-filled
  openBtn?.addEventListener('click', function() {
    const cmd = this.dataset.cmd;
    const tm = window.terminalManager;
    if (!tm) return;
    let term = tm.getActive();
    if (!term) term = tm.create();
    term.focus();
    term.inputEl.value = cmd;
    if (typeof term._updateHighlight === 'function') term._updateHighlight();
    this.closest('div').innerHTML = '<span style="color:#D4A843;font-size:11px;font-style:italic;">Terminal opened with command</span>';
  });

  // No thanks — dismiss
  noBtn?.addEventListener('click', function() {
    this.closest('div').innerHTML = '<span style="color:#64748B;font-size:11px;font-style:italic;">Dismissed</span>';
  });

  return el;
});

// ── Phase C #008: Pathfinder Handoff Card ────────────────────────────────────
BlockFactory.register('pathfinder_handoff', (data) => {
  const el = document.createElement('div');
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Pathfinder handoff suggestion');

  const compassSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0E7490" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polygon points="12,2 14.5,9.5 12,8 9.5,9.5" fill="#06B6D4" stroke="none"/><polygon points="12,22 9.5,14.5 12,16 14.5,14.5" fill="#0E7490" stroke="none"/><circle cx="12" cy="12" r="2" fill="#0E7490"/></svg>';

  el.innerHTML = `
    <div class="pathfinder-handoff-icon">${compassSvg}</div>
    <div class="pathfinder-handoff-body">
      <div class="pathfinder-handoff-title">Pathfinder Suggestion</div>
      <p class="pathfinder-handoff-msg">${escapeHtml(data.message || 'This question might be better answered by Pathfinder.')}</p>
      <div class="pathfinder-handoff-actions">
        <button class="pathfinder-btn pathfinder-btn--use" data-graph-id="${escapeHtml(data.graph_id || '')}" data-query="${escapeHtml(data.query || '')}">Use Pathfinder</button>
        <button class="pathfinder-btn pathfinder-btn--stay">Continue with Athena</button>
      </div>
    </div>
    <div class="pathfinder-result-container"></div>
  `;

  // Helper: render Pathfinder blocks into HTML
  function renderPathfinderBlocks(blocks) {
    let html = '<div class="pathfinder-result-header">PATHFINDER ANALYSIS</div>';
    for (const block of blocks) {
      if (block.type === 'position_section') {
        html += '<div class="pf-section"><div class="pf-section-title">Research Position</div>';
        if (block.closestPaper) html += `<p><strong>Closest paper:</strong> ${escapeHtml(block.closestPaper.title || '')} (${block.closestPaper.year || ''})</p>`;
        if (block.matchScore) html += `<p><strong>Match score:</strong> ${block.matchScore}</p>`;
        if (block.relationship) html += `<p>${escapeHtml(typeof block.relationship === 'string' ? block.relationship : JSON.stringify(block.relationship))}</p>`;
        html += '</div>';
      } else if (block.type === 'landscape_section') {
        html += '<div class="pf-section"><div class="pf-section-title">Research Landscape</div>';
        if (block.gap) html += `<p><strong>Gap identified:</strong> ${escapeHtml(typeof block.gap === 'string' ? block.gap : JSON.stringify(block.gap))}</p>`;
        if (block.competitors?.length) {
          html += '<p><strong>Related work:</strong></p><ul>';
          for (const c of block.competitors.slice(0, 5)) html += `<li>${escapeHtml(c.title || c.name || JSON.stringify(c))} ${c.year ? '(' + c.year + ')' : ''}</li>`;
          html += '</ul>';
        }
        html += '</div>';
      } else if (block.type === 'roadmap_section') {
        html += '<div class="pf-section"><div class="pf-section-title">Research Roadmap</div>';
        if (block.papers?.length) {
          html += '<ol>';
          for (const p of block.papers.slice(0, 8)) html += `<li><strong>${escapeHtml(p.title || '')}</strong> ${p.year ? '(' + p.year + ')' : ''} ${p.reason ? ' — ' + escapeHtml(p.reason) : ''}</li>`;
          html += '</ol>';
        }
        html += '</div>';
      } else if (block.type === 'citation_section') {
        html += '<div class="pf-section"><div class="pf-section-title">Citation Strategy</div>';
        if (block.mustCite?.length) {
          html += '<p><strong>Must cite:</strong></p><ul>';
          for (const p of block.mustCite.slice(0, 5)) html += `<li>${escapeHtml(p.title || p.name || JSON.stringify(p))}</li>`;
          html += '</ul>';
        }
        if (block.shouldCite?.length) {
          html += '<p><strong>Should cite:</strong></p><ul>';
          for (const p of block.shouldCite.slice(0, 5)) html += `<li>${escapeHtml(p.title || p.name || JSON.stringify(p))}</li>`;
          html += '</ul>';
        }
        html += '</div>';
      }
    }
    return html;
  }

  const resultContainer = el.querySelector('.pathfinder-result-container');

  // "Use Pathfinder" button
  el.querySelector('.pathfinder-btn--use')?.addEventListener('click', async function() {
    const graphId = this.dataset.graphId;
    const query = this.dataset.query;
    const actionsEl = this.closest('.pathfinder-handoff-actions');

    this.textContent = 'Loading...';
    this.disabled = true;

    try {
      const resp = await fetch(`/api/graph/${encodeURIComponent(graphId)}/pathfinder-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'athena', prompt: query }),
      });

      if (resp.ok) {
        const result = await resp.json();
        const html = renderPathfinderBlocks(result.blocks || []);

        // Remove buttons, show "Answered" note
        actionsEl.innerHTML = '<span class="pathfinder-handoff-done">✓ Answered by Pathfinder</span>';

        // Render result INSIDE the same block
        resultContainer.innerHTML = `<div class="pathfinder-result">${html}</div>`;

        // Store in DB so it persists after refresh
        fetch('/api/athena/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'assistant',
            content: '[PATHFINDER_RESULT]' + html,
            thread_id: window.athenaEngine?.threadId || 'main',
          }),
        }).catch(() => {});

        if (window.athenaEngine?.autoScroller) window.athenaEngine.autoScroller.scrollToBottom();
      } else {
        actionsEl.innerHTML = '<span class="pathfinder-handoff-unavail">Pathfinder is not available for this graph.</span>';
      }
    } catch (err) {
      actionsEl.innerHTML = '<span class="pathfinder-handoff-unavail">Could not reach Pathfinder.</span>';
    }
  });

  // "Continue with Athena" button
  el.querySelector('.pathfinder-btn--stay')?.addEventListener('click', function() {
    this.closest('.pathfinder-handoff-actions').innerHTML =
      '<span class="pathfinder-handoff-done">Continuing with Athena. Rephrase your question.</span>';
  });

  return el;
});

// ── Phase C #026: Relationship Explainer ─────────────────────────────────────
// SSE shape: {paper_a: {title, year, citation_count, pagerank_score, pagerank_rank, descendants, cluster},
//             paper_b: {...same...}, edge: {mutation_type, confidence, confidence_tier, ...},
//             shared_descendants, same_cluster, year_gap, total_papers}
BlockFactory.register('relationship_explainer', (data) => {
  const el = document.createElement('div');
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Paper relationship analysis');

  const a = data.paper_a || {};
  const b = data.paper_b || {};
  const edge = data.edge || {};

  // Short names for display
  const aName = (a.title || 'Paper A').length > 35 ? a.title.substring(0, 33) + '...' : (a.title || 'Paper A');
  const bName = (b.title || 'Paper B').length > 35 ? b.title.substring(0, 33) + '...' : (b.title || 'Paper B');

  // Mutation badge colors
  const mutType = (edge.mutation_type || 'unknown').toLowerCase();
  const mutColors = {
    'adoption': '#22C55E', 'generalization': '#3B82F6', 'specialization': '#8B5CF6',
    'hybridization': '#F59E0B', 'contradiction': '#EF4444', 'revival': '#06B6D4',
    'incidental': '#94A3B8',
  };
  const mutColor = mutColors[mutType] || '#94A3B8';

  // Confidence
  const confTier = (edge.confidence_tier || 'SPECULATIVE').toUpperCase();
  const confColors = { HIGH: '#22C55E', MEDIUM: '#3B82F6', LOW: '#F59E0B', SPECULATIVE: '#9333EA' };
  const confColor = confColors[confTier] || '#9333EA';
  const confPct = edge.confidence ? (parseFloat(edge.confidence) * 100).toFixed(0) + '%' : '';

  // Direction arrow
  const aIsSource = edge.source === a.paper_id;
  const citingName = aIsSource ? aName : bName;
  const citedName = aIsSource ? bName : aName;

  // Speculative warning
  const specWarning = confTier === 'SPECULATIVE'
    ? `<div class="rel-warning">⚠ This relationship has low confidence. The following analysis is speculative.</div>`
    : '';

  // Build comparison rows
  const rows = [
    { label: 'Year', a: a.year || '—', b: b.year || '—' },
    { label: 'Citations', a: (a.citation_count || 0).toLocaleString(), b: (b.citation_count || 0).toLocaleString() },
    { label: 'PageRank', a: `#${a.pagerank_rank || '?'} of ${data.total_papers || '?'}`, b: `#${b.pagerank_rank || '?'} of ${data.total_papers || '?'}` },
    { label: 'Descendants', a: a.descendants || 0, b: b.descendants || 0 },
    { label: 'Cluster', a: a.cluster || '—', b: b.cluster || '—' },
  ];

  const tableRows = rows.map(r =>
    `<tr><td class="rel-stat-label">${r.label}</td><td class="rel-stat-val">${escapeHtml(String(r.a))}</td><td class="rel-stat-val">${escapeHtml(String(r.b))}</td></tr>`
  ).join('');

  el.innerHTML = `
    <div class="rel-header">
      <span class="rel-header-label">RELATIONSHIP</span>
    </div>
    ${specWarning}
    <div class="rel-papers-row">
      <div class="rel-paper rel-paper--a" title="${escapeHtml(a.title || '')}">
        <div class="rel-paper-name">${escapeHtml(aName)}</div>
        <div class="rel-paper-year">${a.year || ''}</div>
      </div>
      <div class="rel-arrow">
        <div class="rel-arrow-line"></div>
        <div class="rel-arrow-badge" style="background:${mutColor}">${escapeHtml(mutType.replace(/_/g, ' '))}</div>
      </div>
      <div class="rel-paper rel-paper--b" title="${escapeHtml(b.title || '')}">
        <div class="rel-paper-name">${escapeHtml(bName)}</div>
        <div class="rel-paper-year">${b.year || ''}</div>
      </div>
    </div>
    <table class="rel-comparison">
      <thead><tr><th></th><th>${escapeHtml(aName.split(':')[0].substring(0, 20))}</th><th>${escapeHtml(bName.split(':')[0].substring(0, 20))}</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div class="rel-meta">
      <span class="rel-badge" style="background:${mutColor};color:#fff">${escapeHtml(mutType.replace(/_/g, ' '))}</span>
      <span class="rel-badge rel-badge--conf" style="border-color:${confColor};color:${confColor}">${confTier} ${confPct}</span>
      ${data.shared_descendants > 0 ? `<span class="rel-badge rel-badge--shared">${data.shared_descendants} shared descendants</span>` : ''}
      ${data.same_cluster === true ? '<span class="rel-badge rel-badge--cluster">Same cluster</span>' : ''}
      ${data.year_gap ? `<span class="rel-badge rel-badge--year">${data.year_gap}yr gap</span>` : ''}
    </div>
  `;

  return el;
});

// ── B-16b: #059 Inline Mini-Graph ────────────────────────────────────────────
// SSE shape: {nodes: [{id, label, x, y, highlighted}], edges: [{from, to, mutation_type}],
//             focus_path: [id1, id2, ...], context_nodes: [{id, x, y}]}
// Same inline SVG approach as network_snippet, with path highlighting + mutation colors
BlockFactory.register('inline_mini_graph', (data) => {
  const el = document.createElement('div');
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const focusPath = new Set(data.focus_path || []);

  if (!nodes.length) {
    el.className = 'block-empty-state';
    el.textContent = 'No graph data available';
    return el;
  }

  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Mini graph: focused path');

  const nodeMap = {};
  for (const n of nodes) { nodeMap[n.id] = n; }

  let lines = '';
  for (const edge of edges) {
    const from = nodeMap[edge.from];
    const to = nodeMap[edge.to];
    if (from && to) {
      const color = MUTATION_COLORS[edge.mutation_type] || '#64748B';
      const isPathEdge = focusPath.has(edge.from) && focusPath.has(edge.to);
      const opacity = isPathEdge ? 0.9 : 0.3;
      const width = isPathEdge ? 2 : 1;
      lines += `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`;
    }
  }

  let circles = '';
  for (const n of nodes) {
    const highlighted = n.highlighted;
    const r = highlighted ? 8 : 5;
    const fill = highlighted ? '#D4A843' : '#64748B';
    const opacity = highlighted ? 1 : 0.4;
    const label = highlighted ? ((n.label || '').length > 20 ? n.label.slice(0, 18) + '..' : (n.label || '')) : '';

    circles += `<circle cx="${n.x}" cy="${n.y}" r="${r}" fill="${fill}" opacity="${opacity}" class="mini-graph-node" data-label="${escapeHtml(n.label || '')}"/>`;
    if (label) {
      circles += `<text x="${n.x}" y="${n.y + r + 11}" text-anchor="middle" font-family="Inter, sans-serif" font-size="8" fill="#94A3B8">${escapeHtml(label)}</text>`;
    }
  }

  el.innerHTML = `
    <svg viewBox="0 0 300 200" class="chart-svg chart-mini-graph-svg" aria-hidden="true">
      ${lines}
      ${circles}
    </svg>
  `;

  el.addEventListener('mouseover', (e) => {
    const node = e.target.closest('.mini-graph-node');
    if (node && node.dataset.label) AthenaTooltip.show(node, node.dataset.label);
  });
  el.addEventListener('mouseout', (e) => {
    if (e.target.closest('.mini-graph-node')) AthenaTooltip.hide();
  });

  return el;
});


// ── B-17: #089 Sankey Flow ───────────────────────────────────────────────────
// SSE shape: {nodes: [{id, label, column}], links: [{source, target, value}]}
// viewBox: 400x300, nodes as rects in columns, links as bezier curves
BlockFactory.register('sankey', (data) => {
  const el = document.createElement('div');
  const nodes = data.nodes || [];
  const links = data.links || [];

  if (!nodes.length || !links.length) {
    el.className = 'block-empty-state';
    el.textContent = 'No flow data available';
    return el;
  }

  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Sankey: mutation type to citation intent flow');

  // Group nodes by column
  const columns = {};
  const nodeMap = {};
  for (const n of nodes) {
    const col = n.column || 0;
    if (!columns[col]) columns[col] = [];
    columns[col].push({ ...n });
    nodeMap[n.id] = columns[col][columns[col].length - 1];
  }

  const colKeys = Object.keys(columns).sort((a, b) => a - b);
  const numCols = colKeys.length;
  const svgW = 400;
  const svgH = 300;
  const nodeWidth = 20;
  const colSpacing = numCols > 1 ? (svgW - nodeWidth) / (numCols - 1) : 0;

  // Compute per-node total link value for height
  const nodeValues = {};
  for (const link of links) {
    nodeValues[link.source] = (nodeValues[link.source] || 0) + link.value;
    nodeValues[link.target] = (nodeValues[link.target] || 0) + link.value;
  }

  // Position nodes within each column
  for (const col of colKeys) {
    const colNodes = columns[col];
    const x = col * colSpacing;
    let yOffset = 10;
    const totalVal = colNodes.reduce((s, n) => s + (nodeValues[n.id] || 1), 0);
    const availH = svgH - 20;

    for (const n of colNodes) {
      const h = Math.max(14, ((nodeValues[n.id] || 1) / totalVal) * availH);
      n._x = x;
      n._y = yOffset;
      n._h = h;
      nodeMap[n.id] = n;
      yOffset += h + 4;
    }
  }

  // Render links as bezier curves
  let paths = '';
  const maxLinkVal = Math.max(...links.map(l => l.value), 1);
  for (const link of links) {
    const src = nodeMap[link.source];
    const tgt = nodeMap[link.target];
    if (!src || !tgt || src._x == null || tgt._x == null) continue;

    const x0 = src._x + nodeWidth;
    const y0 = src._y + src._h / 2;
    const x1 = tgt._x;
    const y1 = tgt._y + tgt._h / 2;
    const midX = (x0 + x1) / 2;
    const linkW = Math.max(2, Math.min(20, (link.value / maxLinkVal) * 20));

    paths += `<path d="M ${x0} ${y0} C ${midX} ${y0}, ${midX} ${y1}, ${x1} ${y1}" fill="none" stroke="#D4A843" stroke-width="${linkW}" opacity="0.3" class="sankey-link" data-source="${escapeHtml(src.label || '')}" data-target="${escapeHtml(tgt.label || '')}" data-value="${link.value}"/>`;
  }

  // Render node rects
  let rects = '';
  for (const n of nodes) {
    const nd = nodeMap[n.id];
    if (!nd || nd._x == null) continue;
    const color = CHART_PALETTE[nodes.indexOf(n) % CHART_PALETTE.length];
    const label = (nd.label || '').length > 15 ? nd.label.slice(0, 13) + '..' : (nd.label || '');
    rects += `<rect x="${nd._x}" y="${nd._y}" width="${nodeWidth}" height="${nd._h}" rx="3" fill="${color}"/>`;
    const labelX = (nd.column || 0) === 0 ? nd._x + nodeWidth + 6 : nd._x - 6;
    const anchor = (nd.column || 0) === 0 ? 'start' : 'end';
    rects += `<text x="${labelX}" y="${nd._y + nd._h / 2 + 4}" text-anchor="${anchor}" font-family="Inter, sans-serif" font-size="9" fill="#64748B">${escapeHtml(label)}</text>`;
  }

  el.innerHTML = `
    <svg viewBox="0 0 ${svgW} ${svgH}" class="chart-svg chart-sankey-svg" aria-hidden="true">
      ${paths}
      ${rects}
    </svg>
  `;

  el.addEventListener('mouseover', (e) => {
    const link = e.target.closest('.sankey-link');
    if (link) AthenaTooltip.show(link, `${link.dataset.source} -> ${link.dataset.target}: ${link.dataset.value}`);
  });
  el.addEventListener('mouseout', (e) => {
    if (e.target.closest('.sankey-link')) AthenaTooltip.hide();
  });

  return el;
});


// ── B-18: #090 Tree Block ────────────────────────────────────────────────────
// SSE shape: {root: {label, children: [{label, children:[]}]}}
// DOM-based (not SVG), indented list with expand/collapse, connector lines via CSS
BlockFactory.register('tree', (data) => {
  const el = document.createElement('div');
  const root = data.root;

  if (!root) {
    el.className = 'block-empty-state';
    el.textContent = 'No tree data available';
    return el;
  }

  el.setAttribute('role', 'tree');
  el.setAttribute('aria-label', 'Citation tree');

  function renderNode(node, depth) {
    const item = document.createElement('div');
    item.className = 'tree-node';
    item.setAttribute('role', 'treeitem');
    item.style.paddingLeft = (depth * 24) + 'px';

    const hasChildren = node.children && node.children.length > 0;
    const label = escapeHtml(node.label || 'Unknown');
    const year = node.year ? ' <span class="tree-year">(' + node.year + ')</span>' : '';

    let toggle = '';
    if (hasChildren) {
      toggle = '<button class="tree-toggle" aria-expanded="true" aria-label="Toggle">\u2212</button>';
    } else {
      toggle = '<span class="tree-leaf-dot"></span>';
    }

    const nodeContent = document.createElement('div');
    nodeContent.className = 'tree-node-content';
    nodeContent.innerHTML = toggle + '<span class="tree-label">' + label + year + '</span>';
    item.appendChild(nodeContent);

    if (hasChildren) {
      const childContainer = document.createElement('div');
      childContainer.className = 'tree-children';
      childContainer.setAttribute('role', 'group');
      for (const child of node.children) {
        childContainer.appendChild(renderNode(child, depth + 1));
      }
      item.appendChild(childContainer);

      const btn = nodeContent.querySelector('.tree-toggle');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const expanded = btn.getAttribute('aria-expanded') === 'true';
          btn.setAttribute('aria-expanded', String(!expanded));
          btn.textContent = expanded ? '+' : '\u2212';
          childContainer.style.display = expanded ? 'none' : 'block';
        });
      }
    }

    return item;
  }

  el.appendChild(renderNode(root, 0));
  return el;
});


// Expose globally for other modules
window.BlockFactory = BlockFactory;
window.AthenaTooltip = AthenaTooltip;
window.escapeHtml = escapeHtml;
// ── Path Flow Block ─────────────────────────────────────────────────────────
// SSE shape: {steps: [{title, year, paper_id}], label}
// Renders a horizontal/vertical flow of paper nodes connected by arrows

BlockFactory.register('path_flow', (data) => {
  const el = document.createElement('div');
  el.className = 'block-path-flow';

  if (!data.steps || !data.steps.length) {
    el.className = 'block-empty-state';
    el.textContent = 'No path found';
    return el;
  }

  if (data.label) {
    const label = document.createElement('div');
    label.className = 'path-flow-label';
    label.textContent = data.label;
    el.appendChild(label);
  }

  const track = document.createElement('div');
  track.className = 'path-flow-track';

  data.steps.forEach((step, i) => {
    // Node
    const node = document.createElement('div');
    node.className = 'path-flow-node';
    if (i === 0) node.classList.add('path-flow-start');
    if (i === data.steps.length - 1) node.classList.add('path-flow-end');

    const dot = document.createElement('div');
    dot.className = 'path-flow-dot';
    node.appendChild(dot);

    const info = document.createElement('div');
    info.className = 'path-flow-info';
    info.innerHTML = `<div class="path-flow-title">${escapeHtml(step.title || 'Unknown')}</div>` +
      (step.year ? `<div class="path-flow-year">${step.year}</div>` : '');
    node.appendChild(info);

    track.appendChild(node);

    // Arrow (except after last node)
    if (i < data.steps.length - 1) {
      const arrow = document.createElement('div');
      arrow.className = 'path-flow-arrow';
      arrow.innerHTML = `<svg width="24" height="16" viewBox="0 0 24 16"><path d="M0 8h20M16 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      track.appendChild(arrow);
    }
  });

  el.appendChild(track);
  return el;
});


// ── Phase C #005: Command Confirmation Block ────────────────────────────────
// Compact confirmation card shown after a graph command executes.
// No LLM response needed — just shows what was done.

BlockFactory.register('command_confirm', (data) => {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;' +
    'background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;margin:4px 0;' +
    'font-family:"JetBrains Mono",monospace;font-size:12px;color:#166534;';

  const iconMap = {
    'Zoom': '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="11" y1="11" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    'Highlight': '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>',
    'Filter': '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 3h12L9 8v5l-2-1V8L2 3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    'Reset': '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 8a5 5 0 0 1 9.5-2M13 8a5 5 0 0 1-9.5 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 3v3h-3M4 13v-3h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  const action = data.action || 'Command';
  const target = data.target || '';
  const icon = iconMap[action] || iconMap['Reset'];
  const checkmark = '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 7l3 3 5-6" fill="none" stroke="#22C55E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  el.innerHTML = `
    <span style="color:#22C55E;flex-shrink:0">${checkmark}</span>
    <span style="flex-shrink:0;color:#166534">${icon}</span>
    <span><strong>${action}</strong>${target ? ': ' + target : ''}</span>
  `;

  return el;
});


window.copyToClipboard = copyToClipboard;
window.tokenize = tokenize;
window.CHART_PALETTE = CHART_PALETTE;
window.FIELD_COLORS = FIELD_COLORS;
window.MUTATION_COLORS = MUTATION_COLORS;
