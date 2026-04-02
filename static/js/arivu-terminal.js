/**
 * arivu-terminal.js — Arivu Research Intelligence Terminal
 *
 * A domain-specific shell for graph operations: annotations, navigation,
 * filtering, analysis. Linux-terminal aesthetic with syntax highlighting,
 * auto-complete, command history, and typewriter animations.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Script Storage — localStorage-backed CRUD for .arivu scripts
// Separate from sessions: scripts are portable, sessions are graph-bound.
// ═══════════════════════════════════════════════════════════════════════════

class ArivuScriptStorage {
  constructor() {
    this.STORAGE_KEY = 'arivu_terminal_scripts';
  }

  _load() {
    try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]'); }
    catch { return []; }
  }

  _save(scripts) {
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(scripts)); }
    catch {}
  }

  /** Get all scripts */
  list() { return this._load(); }

  /** Get a script by name (case-insensitive) */
  get(name) {
    return this._load().find(s => s.name.toLowerCase() === name.toLowerCase());
  }

  /** Validate script name. Returns error string or null. */
  validateName(name) {
    if (!name || !name.trim()) return 'Script name cannot be empty';
    if (name.length > 50) return 'Script name too long (max 50 characters)';
    if (/[\x00-\x1F\x7F]/.test(name)) return 'Script name contains invalid characters';
    return null;
  }

  /** Save a new script. Returns the created script object. */
  save(name, commands, meta = {}) {
    const nameError = this.validateName(name);
    if (nameError) return { error: nameError };

    const scripts = this._load();
    // Overwrite if exists
    const idx = scripts.findIndex(s => s.name.toLowerCase() === name.toLowerCase());

    const script = {
      id: 'scr_' + Date.now().toString(36),
      name,
      description: meta.description || '',
      commands: commands || [],
      version: 1,
      versions: [{
        version: 1,
        commands: [...(commands || [])],
        savedAt: new Date().toISOString(),
      }],
      graphId: window._arivuGraph?.metadata?.graph_id || '',
      graphTitle: window._arivuGraph?.metadata?.seed_paper_title || '',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      runCount: 0,
      lastRun: null,
      tags: meta.tags || [],
    };

    if (idx >= 0) {
      // Update existing — bump version
      const existing = scripts[idx];
      script.id = existing.id;
      script.created = existing.created;
      script.version = (existing.version || 1) + 1;
      script.runCount = existing.runCount || 0;
      script.lastRun = existing.lastRun;
      // Append to version history (max 20)
      script.versions = [...(existing.versions || []), {
        version: script.version,
        commands: [...(commands || [])],
        savedAt: new Date().toISOString(),
      }].slice(-20);
      scripts[idx] = script;
    } else {
      scripts.unshift(script);
    }

    this._save(scripts);
    return script;
  }

  /** Delete a script by name. Returns true if found. */
  delete(name) {
    const scripts = this._load();
    const idx = scripts.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
    if (idx === -1) return false;
    scripts.splice(idx, 1);
    this._save(scripts);
    return true;
  }

  /** Copy a script. Returns the new script or null. */
  copy(srcName, newName) {
    const src = this.get(srcName);
    if (!src) return null;
    return this.save(newName, [...src.commands], {
      description: src.description ? `Copy of: ${src.description}` : `Copy of ${srcName}`,
      tags: [...(src.tags || [])],
    });
  }

  /** Record that a script was run */
  recordRun(name) {
    const scripts = this._load();
    const s = scripts.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (s) {
      s.runCount = (s.runCount || 0) + 1;
      s.lastRun = new Date().toISOString();
      this._save(scripts);
    }
  }

  /** Generate .arivu formatted text for export */
  toArivuFormat(script) {
    const lines = [];
    lines.push(`# ═══════════════════════════════════════════════`);
    lines.push(`# Arivu Script: ${script.name}`);
    if (script.description) lines.push(`# Description: ${script.description}`);
    lines.push(`# Version: ${script.version || 1}`);
    lines.push(`# Created: ${script.created || new Date().toISOString()}`);
    lines.push(`# Modified: ${script.modified || new Date().toISOString()}`);
    if (script.graphTitle) lines.push(`# Graph: ${script.graphTitle}`);
    lines.push(`# Commands: ${(script.commands || []).length}`);
    lines.push(`# ═══════════════════════════════════════════════`);
    lines.push('');
    for (const cmd of (script.commands || [])) {
      lines.push(cmd);
    }
    return lines.join('\n');
  }
}

// Global script storage instance
window.arivuScriptStorage = new ArivuScriptStorage();

// Canonical meta-command filter — used everywhere scripts are saved from history.
// Commands in this set are NOT executable graph operations, so they're excluded.
const SCRIPT_META_COMMANDS = new Set([
  'save', 'load', 'sessions', 'help', 'history', 'export', 'clear',
  'exit', 'rename', 'delete', 'scripts', 'run', 'script',
]);

// ═══════════════════════════════════════════════════════════════════════════

class ArivuTerminal {
  constructor(id, graphData) {
    this.id = id || 'term_' + Date.now().toString(36);
    this.graphData = graphData || window._arivuGraph?.graphData || {};
    this.parser = new ArivuTerminalParser(this.graphData);
    this.history = [];
    this.historyIndex = -1;
    this.log = [];
    this.autoCompleteEnabled = true;
    this.isAnimating = false;
    this.animSpeed = 40; // ms per char
    this.linkedSessionId = null; // If opened from a saved session, auto-save back
    this.el = null;
    this.outputEl = null;
    this.inputEl = null;
    this.acDropdown = null;
    this.acSelectedIndex = -1;

    this._buildDOM();
    this._attachEvents();
    this._showWelcome();
  }

  // ── DOM Construction ──────────────────────────────────────────────────

  _buildDOM() {
    const win = document.createElement('div');
    win.className = 'arivu-terminal-window';
    win.id = this.id;

    const seedTitle = this.graphData?.metadata?.seed_paper_title
      || window._arivuGraph?.metadata?.seed_paper_title || 'graph';
    const slug = seedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 20);

    win.innerHTML = `
      <div class="term-titlebar">
        <div class="term-title-left">
          <div class="term-dots">
            <span class="term-dot term-dot--close" title="Close"></span>
            <span class="term-dot term-dot--minimize" title="Minimize"></span>
            <span class="term-dot term-dot--maximize" title="Maximize"></span>
          </div>
          <span class="term-title-text">Arivu Terminal — ${this.id.replace('term_', '#')}</span>
        </div>
        <div class="term-title-right">
          <button class="term-btn-icon" title="Toggle auto-complete" data-action="toggle-ac">⇥</button>
          <button class="term-btn-icon" title="New terminal" data-action="new-term">+</button>
        </div>
      </div>
      <div class="term-output"></div>
      <div class="term-input-row" style="position:relative;">
        <span class="term-prompt-text">arivu:${slug}$</span>
        <div class="term-input-wrapper">
          <div class="term-input-highlight" aria-hidden="true"></div>
          <input class="term-input" type="text" placeholder="type 'help' to start..." spellcheck="false" autocomplete="off">
        </div>
        <div class="term-autocomplete"></div>
      </div>
    `;

    this.el = win;
    this.outputEl = win.querySelector('.term-output');
    this.inputEl = win.querySelector('.term-input');
    this.acDropdown = win.querySelector('.term-autocomplete');

    this.highlightEl = win.querySelector('.term-input-highlight');

    document.body.appendChild(win);
    this.inputEl.focus();
  }

  // ── Event Handlers ────────────────────────────────────────────────────

  _attachEvents() {
    // Input: Enter to execute, Tab for autocomplete, Up/Down for history
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._hideAC();
        const input = this.inputEl.value;
        if (input.trim()) {
          const wasPendingConfirm = !!this._pendingConfirm;
          this._execute(input);
          // Don't push y/n confirmation responses to history
          if (!wasPendingConfirm) {
            this.history.push(input);
            this.historyIndex = this.history.length;
          }
        }
        this.inputEl.value = '';
        this._updateHighlight();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this._handleTab();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.acDropdown.classList.contains('visible')) {
          this._navigateAC(-1);
        } else if (this.historyIndex > 0) {
          this.historyIndex--;
          this.inputEl.value = this.history[this.historyIndex];
          this._updateHighlight();
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.acDropdown.classList.contains('visible')) {
          this._navigateAC(1);
        } else if (this.historyIndex < this.history.length - 1) {
          this.historyIndex++;
          this.inputEl.value = this.history[this.historyIndex];
          this._updateHighlight();
        } else {
          this.historyIndex = this.history.length;
          this.inputEl.value = '';
          this._updateHighlight();
        }
      } else if (e.key === 'Escape') {
        this._hideAC();
      }
    });

    // Input change: show autocomplete
    this.inputEl.addEventListener('input', () => {
      // Live syntax highlighting overlay
      this._updateHighlight();
      if (this.autoCompleteEnabled) {
        this._showACSuggestions();
      }
    });

    // Title bar buttons
    this.el.querySelector('.term-dot--close')?.addEventListener('click', () => this.close());
    this.el.querySelector('.term-dot--minimize')?.addEventListener('click', () => this.toggleMinimize());
    this.el.querySelector('.term-dot--maximize')?.addEventListener('click', () => this.toggleMaximize());
    this.el.querySelector('[data-action="toggle-ac"]')?.addEventListener('click', () => {
      this.autoCompleteEnabled = !this.autoCompleteEnabled;
      this._print(`Auto-complete: ${this.autoCompleteEnabled ? 'ON' : 'OFF'}`, 'comment');
    });
    this.el.querySelector('[data-action="new-term"]')?.addEventListener('click', () => {
      if (window.terminalManager) window.terminalManager.create();
    });

    // Drag support
    this._initDrag();

    // Double-click to speed up animation
    this.el.addEventListener('dblclick', (e) => {
      if (this.isAnimating) {
        this.animSpeed = 3;
      }
    });

    // Click on terminal output area to focus terminal input
    this.outputEl.addEventListener('click', () => {
      this.inputEl.focus();
    });
  }

  // ── Drag Support ──────────────────────────────────────────────────────

  _initDrag() {
    const titlebar = this.el.querySelector('.term-titlebar');
    let isDragging = false, startX, startY, startLeft, startTop;

    titlebar.addEventListener('mousedown', (e) => {
      if (e.target.closest('.term-dot') || e.target.closest('.term-btn-icon')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.el.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      this.el.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      this.el.style.left = (startLeft + dx) + 'px';
      this.el.style.top = (startTop + dy) + 'px';
      this.el.style.right = 'auto';
      this.el.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        this.el.style.transition = '';
      }
    });
  }

  // ── Welcome Banner ────────────────────────────────────────────────────

  _showWelcome() {
    const nodeCount = this.graphData?.nodes?.length || window._arivuGraph?.allNodes?.length || 0;
    const edgeCount = this.graphData?.edges?.length || window._arivuGraph?.allEdges?.length || 0;
    const seedTitle = this.graphData?.metadata?.seed_paper_title
      || window._arivuGraph?.metadata?.seed_paper_title || 'Unknown';

    const banner = [
      '╔═══════════════════════════════════════════════╗',
      '║                                               ║',
      '║     █████╗ ██████╗ ██╗██╗   ██╗██╗   ██╗     ║',
      '║    ██╔══██╗██╔══██╗██║██║   ██║██║   ██║     ║',
      '║    ███████║██████╔╝██║██║   ██║██║   ██║     ║',
      '║    ██╔══██║██╔══██╗██║╚██╗ ██╔╝██║   ██║     ║',
      '║    ██║  ██║██║  ██║██║ ╚████╔╝ ╚██████╔╝     ║',
      '║    ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═════╝     ║',
      '║                                               ║',
      '║        Research Intelligence Terminal          ║',
      '║           v1.0 · type \'help\' to start         ║',
      '╚═══════════════════════════════════════════════╝',
    ];

    for (const line of banner) {
      this._print(line, 'welcome');
    }
    this._print('');
    this._print(`Graph: ${seedTitle.substring(0, 45)}`, 'info');
    this._print(`${nodeCount} papers · ${edgeCount} edges`, 'info');

    // Show annotation count
    const annotations = window._arivuGraph?.getAnnotations?.() || {};
    const annCount = Object.keys(annotations).length;
    if (annCount > 0) {
      this._print(`${annCount} annotation${annCount > 1 ? 's' : ''} active`, 'info');
    }
    this._print('');
  }

  // ── Command Execution ─────────────────────────────────────────────────

  _execute(input) {
    // Handle pending confirmation (e.g., delete y/n)
    if (this._pendingConfirm) {
      this._printRaw(`<span class="term-prompt-text">&gt;</span> ${this.parser._esc(input)}`, 'cmd');
      this._pendingConfirm(input);
      return;
    }

    // Show the command in output (with syntax highlighting)
    const promptHtml = `<span class="term-prompt-text">arivu$</span> ${this.parser.highlight(input)}`;
    this._printRaw(promptHtml, 'cmd');

    const result = this.parser.parse(input);

    // Log
    this.log.push({
      timestamp: new Date().toISOString(),
      command: input,
      status: result.error ? 'error' : 'success',
      parsed: result.command,
    });

    // Auto-save to linked session if this terminal was opened from a saved session
    this._autoSave();

    if (result.error) {
      this._print(` ✗ ${result.error}`, 'error');
      return;
    }

    if (!result.command) return;

    // Dispatch to handler
    try {
      this._executeCommand(result);
    } catch (err) {
      this._print(` ✗ Execution error: ${err.message}`, 'error');
    }
  }

  _executeCommand(result) {
    const { command, args } = result;
    const graph = window._arivuGraph;
    const commands = window.athenaGraphCommands;

    switch (command) {
      case 'annotate': {
        const resolved = this.parser.resolvePaper(args.paper);
        if (!resolved) {
          this._print(` ✗ Paper not found: '${args.paper}'`, 'error');
          this._suggestPapers(args.paper);
          return;
        }
        if (!graph) {
          this._print(` ✗ Graph not loaded yet`, 'error');
          return;
        }
        // Call addAnnotation on force graph
        if (typeof graph.addAnnotation === 'function') {
          graph.addAnnotation(resolved.id, args.label, 'gold');
        } else {
          this._fallbackAnnotate(graph, resolved.id, args.label);
        }
        // Also annotate tree layout if available
        if (window._treeLayout?.addAnnotation) {
          window._treeLayout.addAnnotation(resolved.id, args.label, 'gold');
        }
        this._print(` ✓ Annotated "${resolved.title.substring(0, 45)}" as "${args.label}"`, 'success');
        this._print(`   PageRank: #${this._getPaperRank(resolved.id)} · Citations: ${(resolved.node?.citation_count || 0).toLocaleString()}`, 'info');
        break;
      }

      case 'remove_annotation': {
        const graphId = graph?.metadata?.graph_id || 'default';
        let annotations = {};
        try { annotations = JSON.parse(sessionStorage.getItem(`athena_annotations_${graphId}`) || '{}'); } catch {}

        if (args.mode === 'all') {
          const count = Object.keys(annotations).length;
          for (const pid of Object.keys(annotations)) {
            this._removeAnnotationFromGraph(graph, pid);
          }
          sessionStorage.setItem(`athena_annotations_${graphId}`, '{}');
          this._print(` ✓ Removed ${count} annotation${count !== 1 ? 's' : ''}`, 'success');
        } else if (args.mode === 'value') {
          // Remove by annotation label
          let found = false;
          for (const [pid, ann] of Object.entries(annotations)) {
            if (ann.label === args.label || ann.label.toLowerCase() === args.label.toLowerCase()) {
              this._removeAnnotationFromGraph(graph, pid);
              delete annotations[pid];
              found = true;
              const node = this.parser.resolvePaper(pid);
              this._print(` ✓ Removed annotation "${args.label}" from "${(node?.title || pid).substring(0, 40)}"`, 'success');
            }
          }
          if (!found) this._print(` ✗ No annotation with value "${args.label}" found`, 'error');
          sessionStorage.setItem(`athena_annotations_${graphId}`, JSON.stringify(annotations));
        } else {
          // Remove by paper name
          const resolved = this.parser.resolvePaper(args.paper);
          if (resolved && annotations[resolved.id]) {
            this._removeAnnotationFromGraph(graph, resolved.id);
            delete annotations[resolved.id];
            sessionStorage.setItem(`athena_annotations_${graphId}`, JSON.stringify(annotations));
            this._print(` ✓ Removed annotation from "${resolved.title.substring(0, 45)}"`, 'success');
          } else if (resolved) {
            this._print(` ✗ No annotation on "${resolved.title.substring(0, 45)}"`, 'error');
          } else {
            this._print(` ✗ Paper not found: '${args.paper}'`, 'error');
          }
        }
        break;
      }

      case 'clear_annotations': {
        const all = graph?.getAnnotations?.() || {};
        for (const pid of Object.keys(all)) graph?.removeAnnotation?.(pid);
        this._print(` ✓ All annotations cleared`, 'success');
        break;
      }

      case 'clear_screen':
        this.outputEl.innerHTML = '';
        break;

      case 'zoom': {
        const resolved = this.parser.resolvePaper(args.paper);
        if (!resolved) { this._print(` ✗ Paper not found: '${args.paper}'`, 'error'); this._suggestPapers(args.paper); return; }
        if (commands) commands.executeCommand({ action: 'zoom', target: resolved.title });
        this._print(` ✓ Zoomed to "${resolved.title.substring(0, 45)}"`, 'success');
        break;
      }

      case 'highlight': {
        const resolved = this.parser.resolvePaper(args.paper);
        if (!resolved) { this._print(` ✗ Paper not found: '${args.paper}'`, 'error'); this._suggestPapers(args.paper); return; }
        if (commands) commands.executeCommand({ action: 'highlight', target: resolved.title });
        this._print(` ✓ Highlighted "${resolved.title.substring(0, 45)}"`, 'success');
        break;
      }

      case 'filter': {
        if (commands) commands.executeCommand({ action: 'filter', target: args.type });
        this._print(` ✓ Filter applied: ${args.type}`, 'success');
        break;
      }

      case 'reset': {
        if (commands) commands.executeCommand({ action: 'reset', target: '' });
        this._print(` ✓ Graph reset`, 'success');
        break;
      }

      case 'info': {
        const resolved = this.parser.resolvePaper(args.paper);
        if (!resolved) { this._print(` ✗ Paper not found: '${args.paper}'`, 'error'); this._suggestPapers(args.paper); return; }
        this._showPaperInfo(resolved);
        break;
      }

      case 'ls': {
        if (args.what === 'annotations') {
          // Read from both graph method and sessionStorage fallback
          let all = {};
          if (typeof graph?.getAnnotations === 'function') {
            all = graph.getAnnotations();
          } else {
            const graphId = graph?.metadata?.graph_id || 'default';
            try { all = JSON.parse(sessionStorage.getItem(`athena_annotations_${graphId}`) || '{}'); } catch(e) {}
          }
          const entries = Object.entries(all);
          if (!entries.length) { this._print(' No annotations active.', 'comment'); return; }
          this._print(` ${entries.length} annotation${entries.length > 1 ? 's' : ''}:`, 'info');
          for (const [pid, { label, color }] of entries) {
            const node = this.parser.resolvePaper(pid);
            const title = node?.title || pid.substring(0, 20) + '...';
            this._printRaw(`   <span class="term-${color === 'teal' ? 'data-val' : 'string-val'}">●</span> ${this.parser._esc(title.substring(0, 40))} → <span class="term-string-val">"${this.parser._esc(label)}"</span>`);
          }
        } else if (args.what === 'papers') {
          const nodes = window._arivuGraph?.allNodes || [];
          this._print(` ${nodes.length} papers in graph. Showing top 10 by citations:`, 'info');
          const sorted = [...nodes].sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0));
          for (const n of sorted.slice(0, 10)) {
            this._printRaw(`   <span class="term-data-val">${(n.citation_count || 0).toLocaleString().padStart(8)}</span>  <span class="term-paper-ref">${this.parser._esc((n.title || '').substring(0, 50))}</span> (${n.year || '?'})`);
          }
        }
        break;
      }

      case 'find': {
        const query = args.query.toLowerCase();
        const matches = (window._arivuGraph?.allNodes || [])
          .filter(n => (n.title || '').toLowerCase().includes(query))
          .slice(0, 10);
        if (!matches.length) { this._print(` No papers found matching '${args.query}'`, 'warning'); return; }
        this._print(` Found ${matches.length} paper${matches.length > 1 ? 's' : ''}:`, 'info');
        for (const n of matches) {
          this._printRaw(`   <span class="term-paper-ref">${this.parser._esc((n.title || '').substring(0, 50))}</span> (${n.year || '?'}) · ${(n.citation_count || 0).toLocaleString()} cites`);
        }
        break;
      }

      case 'deep-dive': {
        const resolved = this.parser.resolvePaper(args.paper);
        if (!resolved) { this._print(` ✗ Paper not found: '${args.paper}'`, 'error'); return; }
        this._print(` → Sending deep-dive request to Athena...`, 'info');
        if (window.athenaEngine) {
          window.athenaEngine.handleUserMessage(`deep dive on "${resolved.title}"`);
        }
        break;
      }

      case 'pathfinder': {
        this._print(` → Sending to Pathfinder...`, 'info');
        if (window.athenaEngine) {
          window.athenaEngine.handleUserMessage(args.query);
        }
        break;
      }

      case 'compare': {
        const r1 = this.parser.resolvePaper(args.paper1);
        const r2 = this.parser.resolvePaper(args.paper2);
        if (!r1) { this._print(` ✗ Paper not found: '${args.paper1}'`, 'error'); return; }
        if (!r2) { this._print(` ✗ Paper not found: '${args.paper2}'`, 'error'); return; }
        this._showCompare(r1, r2);
        break;
      }

      case 'path': {
        const r1 = this.parser.resolvePaper(args.from);
        const r2 = this.parser.resolvePaper(args.to);
        if (!r1 || !r2) { this._print(` ✗ One or both papers not found`, 'error'); return; }
        this._print(` → Finding path from "${r1.title.substring(0, 30)}" to "${r2.title.substring(0, 30)}"...`, 'info');
        // Delegate to Athena for path finding
        if (window.athenaEngine) {
          window.athenaEngine.handleUserMessage(`trace the path from "${r1.title}" to "${r2.title}"`);
        }
        break;
      }

      case 'help':
        this._showHelp(args.topic);
        break;

      case 'history': {
        if (!this.log.length) { this._print(' No commands in history.', 'comment'); return; }
        const items = args.errors ? this.log.filter(l => l.status === 'error') : this.log;
        this._print(` ${items.length} command${items.length > 1 ? 's' : ''} in history:`, 'info');
        for (const entry of items.slice(-20)) {
          const ts = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const icon = entry.status === 'error' ? '✗' : '✓';
          const cls = entry.status === 'error' ? 'error' : 'success';
          this._printRaw(`   <span class="term-${cls}-icon">${icon}</span> <span class="term-comment">${ts}</span> ${this.parser._esc(entry.command)}`);
        }
        break;
      }

      case 'export_script': {
        // export session as script "name" — saves current session commands as a reusable script
        const storage = window.arivuScriptStorage;
        if (!storage) { this._print(` ✗ Script storage not available`, 'error'); break; }
        const scriptCmds = this.history.filter(cmd => {
          const first = cmd.trim().split(/\s+/)[0].toLowerCase();
          return !SCRIPT_META_COMMANDS.has(first) && !cmd.startsWith('#');
        });
        if (!scriptCmds.length) {
          this._print(` ✗ No executable commands in history to save as script`, 'error');
          break;
        }
        const nameErr = storage.validateName(args.name);
        if (nameErr) { this._print(` ✗ ${nameErr}`, 'error'); break; }
        const script = storage.save(args.name, scriptCmds);
        if (script.error) { this._print(` ✗ ${script.error}`, 'error'); break; }
        this._print(` ✓ Script saved: "${script.name}" (v${script.version})`, 'success');
        this._print(`   ${script.commands.length} commands`, 'info');
        break;
      }

      case 'export_text': {
        // export session as text — copy session to clipboard as plain text
        let text = `Arivu Terminal Session\n`;
        text += `${'═'.repeat(40)}\n`;
        for (const entry of this.log) {
          const icon = entry.status === 'error' ? '✗' : '✓';
          text += `${icon} ${entry.command}\n`;
        }
        navigator.clipboard?.writeText(text).then(() => {
          this._print(` ✓ Session copied to clipboard (${this.log.length} commands)`, 'success');
        }).catch(() => {
          this._print(` ✗ Failed to copy to clipboard`, 'error');
        });
        break;
      }

      // ── Script Commands ────────────────────────────────────────────────

      case 'script_save': {
        const storage = window.arivuScriptStorage;
        if (!storage) { this._print(` ✗ Script storage not available`, 'error'); break; }
        const nameErr = storage.validateName(args.name);
        if (nameErr) { this._print(` ✗ ${nameErr}`, 'error'); break; }

        const { kept, removedTotal, removedSummary } = this._filterHistory();
        if (!kept.length) {
          this._print(` ✗ No executable commands in history to save`, 'error');
          if (removedTotal > 0) this._print(`   (${removedTotal} meta commands filtered: ${removedSummary})`, 'comment');
          break;
        }

        // Show filter summary
        this._print(` Filtering ${this.history.length} commands: ${kept.length} kept, ${removedTotal} removed`, 'info');
        if (removedTotal > 0) this._print(`   removed: ${removedSummary}`, 'comment');

        // Check for overwrite
        const existing = storage.get(args.name);
        if (existing) {
          this._print(` ⚠ Script "${args.name}" already exists (v${existing.version}, ${existing.commands?.length || 0} commands).`, 'warning');
          this._print(`   Overwrite? [y/n]`, 'warning');
          this._pendingConfirm = (input) => {
            const answer = input.trim().toLowerCase();
            if (answer === 'y' || answer === 'yes') {
              const script = storage.save(args.name, kept, { description: args.desc || '' });
              if (script.error) { this._print(` ✗ ${script.error}`, 'error'); }
              else {
                this._print(` ✓ Script saved: "${script.name}" (v${script.version})`, 'success');
                this._print(`   ${script.commands.length} commands${args.desc ? ' · ' + args.desc : ''}`, 'info');
              }
            } else {
              this._print(` Cancelled. Tip: use script append("${args.name}", all) to add commands.`, 'comment');
            }
            this._pendingConfirm = null;
          };
          break;
        }

        // New script — save directly
        const script = storage.save(args.name, kept, { description: args.desc || '' });
        if (script.error) { this._print(` ✗ ${script.error}`, 'error'); break; }
        this._print(` ✓ Script saved: "${script.name}" (v${script.version})`, 'success');
        this._print(`   ${script.commands.length} commands${args.desc ? ' · ' + args.desc : ''}`, 'info');
        break;
      }

      case 'script_list': {
        const storage = window.arivuScriptStorage;
        if (!storage) { this._print(` ✗ Script storage not available`, 'error'); break; }
        const scripts = storage.list();
        if (!scripts.length) {
          this._print(` No saved scripts.`, 'comment');
          this._print(` Use: script save "<name>" or export session as script "<name>"`, 'comment');
          break;
        }
        this._print(` ${scripts.length} script${scripts.length > 1 ? 's' : ''}:`, 'info');
        this._printRaw(`   <span class="term-comment">#   Name                    Cmds  Ver   Runs  Last Run</span>`);
        this._printRaw(`   <span class="term-comment">${'─'.repeat(65)}</span>`);
        scripts.forEach((s, i) => {
          const name = (s.name || 'Untitled').substring(0, 22).padEnd(22);
          const cmds = String(s.commands?.length || 0).padEnd(5);
          const ver = ('v' + (s.version || 1)).padEnd(5);
          const runs = String(s.runCount || 0).padEnd(5);
          const lastRun = s.lastRun
            ? new Date(s.lastRun).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : 'never';
          this._printRaw(`   ${String(i + 1).padEnd(4)}${name}  ${cmds} ${ver} ${runs} <span class="term-comment">${this.parser._esc(lastRun)}</span>`);
        });
        break;
      }

      case 'script_info': {
        const storage = window.arivuScriptStorage;
        if (!storage) { this._print(` ✗ Script storage not available`, 'error'); break; }
        const script = storage.get(args.name);
        if (!script) {
          this._print(` ✗ Script not found: "${args.name}"`, 'error');
          const names = storage.list().map(s => s.name).slice(0, 5);
          if (names.length) this._print(`   Available: ${names.join(', ')}`, 'comment');
          break;
        }
        this._renderScriptInfoBox(script);
        break;
      }

      case 'script_delete': {
        const storage = window.arivuScriptStorage;
        if (!storage) { this._print(` ✗ Script storage not available`, 'error'); break; }
        const script = storage.get(args.name);
        if (!script) {
          this._print(` ✗ Script not found: "${args.name}"`, 'error');
          break;
        }
        this._print(` ⚠ Delete script "${script.name}" (v${script.version}, ${script.commands?.length || 0} commands)?`, 'warning');
        this._pendingConfirm = (input) => {
          const answer = input.trim().toLowerCase();
          if (answer === 'y' || answer === 'yes') {
            storage.delete(script.name);
            this._print(` ✓ Deleted: ${script.name}`, 'success');
          } else {
            this._print(` Cancelled.`, 'comment');
          }
          this._pendingConfirm = null;
        };
        break;
      }

      case 'script_copy': {
        const storage = window.arivuScriptStorage;
        if (!storage) { this._print(` ✗ Script storage not available`, 'error'); break; }
        const copy = storage.copy(args.name, args.newName);
        if (!copy) {
          this._print(` ✗ Source script not found: "${args.name}"`, 'error');
          break;
        }
        this._print(` ✓ Copied: "${args.name}" → "${args.newName}"`, 'success');
        this._print(`   ${copy.commands.length} commands`, 'info');
        break;
      }

      case 'script_run': {
        const storage = window.arivuScriptStorage;
        if (!storage) { this._print(` ✗ Script storage not available`, 'error'); break; }
        const script = storage.get(args.name);
        if (!script) {
          this._print(` ✗ Script not found: "${args.name}"`, 'error');
          const names = storage.list().map(s => s.name).slice(0, 5);
          if (names.length) this._print(`   Available: ${names.join(', ')}`, 'comment');
          break;
        }
        if (!script.commands?.length) {
          this._print(` ✗ Script "${script.name}" has no commands`, 'error');
          break;
        }
        storage.recordRun(script.name);
        this._runScript(script);
        break;
      }

      case 'script_export': {
        const storage = window.arivuScriptStorage;
        if (!storage) { this._print(` ✗ Script storage not available`, 'error'); break; }
        const script = storage.get(args.name);
        if (!script) {
          this._print(` ✗ Script not found: "${args.name}"`, 'error');
          break;
        }
        const formatted = storage.toArivuFormat(script);
        navigator.clipboard?.writeText(formatted).then(() => {
          this._print(` ✓ Exported: ${script.name.toLowerCase().replace(/\s+/g, '-')}.arivu`, 'success');
          this._print(`   ${script.commands.length} commands copied to clipboard`, 'info');
        }).catch(() => {
          this._print(` ✗ Failed to copy to clipboard`, 'error');
        });
        break;
      }

      case 'exit':
        this.close();
        break;

      case 'save_session': {
        const carousel = window.terminalCarousel;
        if (!carousel) { this._print(` ✗ Session manager not available`, 'error'); return; }
        const session = carousel.saveSession(args.name, {
          history: this.history,
          log: this.log,
        });
        this.linkedSessionId = session.id;
        this._updateTitle(session.name);
        this._print(` ✓ Session saved: ${session.name}`, 'success');
        this._print(`   ${session.totalCommands} commands, ${session.annotationCount} annotations`, 'info');
        break;
      }

      case 'load_session': {
        const carousel = window.terminalCarousel;
        if (!carousel) { this._print(` ✗ Session manager not available`, 'error'); return; }
        const session = carousel.getSession(args.name);
        if (!session) {
          this._print(` ✗ Session not found: "${args.name}"`, 'error');
          const names = carousel.sessions.map(s => s.name).slice(0, 5);
          if (names.length) this._print(`   Available: ${names.join(', ')}`, 'comment');
          return;
        }
        // Load session data into this terminal + link for auto-save
        this.history = session.commands || [];
        this.log = session.log || [];
        this.historyIndex = this.history.length;
        this.linkedSessionId = session.id;
        this._updateTitle(session.name);
        // Restore annotations
        if (session.annotations && Object.keys(session.annotations).length) {
          const graphId = window._arivuGraph?.metadata?.graph_id || 'default';
          sessionStorage.setItem(`athena_annotations_${graphId}`, JSON.stringify(session.annotations));
          if (window._arivuGraph?.restoreAnnotations) window._arivuGraph.restoreAnnotations();
        }
        this._print(` ✓ Loaded: ${session.name}`, 'success');
        this._print(`   ${session.totalCommands} commands, ${session.annotationCount} annotations`, 'info');
        session.lastActive = new Date().toISOString();
        carousel._saveSessions();
        break;
      }

      case 'sessions': {
        const carousel = window.terminalCarousel;
        if (!carousel) { this._print(` ✗ Session manager not available`, 'error'); break; }
        carousel._loadSessions();
        const sessions = carousel.sessions;
        if (!sessions.length) {
          this._print(` No saved sessions. Use: save session "<name>"`, 'comment');
          break;
        }
        // Show ASCII table
        this._print(` ${sessions.length} saved session${sessions.length > 1 ? 's' : ''}:`, 'info');
        this._printRaw(`   <span class="term-comment">#   Name                    Date       Cmds   Status</span>`);
        this._printRaw(`   <span class="term-comment">${'─'.repeat(55)}</span>`);
        sessions.forEach((s, i) => {
          const date = new Date(s.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const isLinked = s.id === this.linkedSessionId;
          const status = isLinked ? '<span style="color:#D4A843">ACTIVE</span>' : '<span class="term-comment">saved</span>';
          const name = (s.name || 'Untitled').substring(0, 22).padEnd(22);
          this._printRaw(`   ${String(i + 1).padEnd(4)}${name}  ${date.padEnd(10)} ${String(s.totalCommands || 0).padEnd(6)} ${status}`);
        });
        this._print('');
        this._print(' Tip: "sessions" opens carousel. "load session <name>" to restore.', 'comment');
        // Also open carousel after brief delay
        setTimeout(() => carousel.open(), 800);
        break;
      }

      case 'rename_session': {
        const carousel = window.terminalCarousel;
        // Rename the linked session, or the most recent one
        if (carousel) {
          const target = this.linkedSessionId
            ? carousel.sessions.find(s => s.id === this.linkedSessionId)
            : carousel.sessions[0];
          if (target) {
            const oldName = target.name;
            carousel.renameSession(target.id, args.name);
            this._updateTitle(args.name);
            this._print(` ✓ Renamed: "${oldName}" → "${args.name}"`, 'success');
          } else {
            this._print(` ✗ No sessions to rename. Save first with: save session "<name>"`, 'error');
          }
        }
        break;
      }

      case 'delete_session': {
        const carousel = window.terminalCarousel;
        if (!carousel) { this._print(` ✗ Session manager not available`, 'error'); return; }
        const session = carousel.getSession(args.name);
        if (!session) {
          this._print(` ✗ Session not found: "${args.name}"`, 'error');
          return;
        }
        this._print(` ⚠ Delete "${session.name}"? This cannot be undone.`, 'warning');
        // Set up a one-time confirmation handler
        this._pendingConfirm = (input) => {
          const answer = input.trim().toLowerCase();
          if (answer === 'y' || answer === 'yes') {
            carousel.deleteSession(session.id);
            if (this.linkedSessionId === session.id) this.linkedSessionId = null;
            this._print(` ✓ Deleted: ${session.name}`, 'success');
          } else {
            this._print(` Cancelled.`, 'comment');
          }
          this._pendingConfirm = null;
        };
        break;
      }

      case 'comment':
        this._print(` ${args.text}`, 'comment');
        break;

      default:
        this._print(` ✗ Command not implemented: ${command}`, 'warning');
    }
  }

  // ── Output Helpers ────────────────────────────────────────────────────

  _print(text, type = '') {
    const line = document.createElement('div');
    line.className = `term-line${type ? ' term-line--' + type : ''}`;
    line.textContent = text;
    this.outputEl.appendChild(line);
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  _printRaw(html, type = '') {
    const line = document.createElement('div');
    line.className = `term-line${type ? ' term-line--' + type : ''}`;
    line.innerHTML = html;
    this.outputEl.appendChild(line);
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  _showPaperInfo(resolved) {
    const n = resolved.node || {};
    const rank = this._getPaperRank(resolved.id);
    const lines = [
      `┌─────────────────────────────────────────────────┐`,
      `│ ${(n.title || '').substring(0, 47).padEnd(47)} │`,
      `│ Year: ${(n.year || '?').toString().padEnd(8)} Citations: ${((n.citation_count || 0).toLocaleString()).padEnd(14)} │`,
      `│ PageRank: #${rank} · Depth: ${n.depth ?? '?'}`.padEnd(49) + ` │`,
      `│ Bottleneck: ${n.is_bottleneck ? 'Yes' : 'No'} · Impact: ${n.pruning_impact || 0}%`.padEnd(49) + ` │`,
      `│ Fields: ${(n.fields_of_study || []).slice(0, 2).join(', ') || '—'}`.padEnd(49) + ` │`,
      `└─────────────────────────────────────────────────┘`,
    ];
    for (const l of lines) this._print(l, 'info');
  }

  _showCompare(r1, r2) {
    const n1 = r1.node || {}, n2 = r2.node || {};
    this._print(` Comparing:`, 'info');
    this._printRaw(`   <span class="term-paper-ref">${this.parser._esc(r1.title.substring(0, 35))}</span> vs <span class="term-paper-ref">${this.parser._esc(r2.title.substring(0, 35))}</span>`);
    this._printRaw(`   ${'Metric'.padEnd(15)} ${'Paper A'.padEnd(15)} ${'Paper B'.padEnd(15)}`);
    this._printRaw(`   ${'─'.repeat(45)}`);
    this._printRaw(`   ${'Year'.padEnd(15)} <span class="term-data-val">${String(n1.year || '?').padEnd(15)}</span> <span class="term-data-val">${String(n2.year || '?')}</span>`);
    this._printRaw(`   ${'Citations'.padEnd(15)} <span class="term-data-val">${((n1.citation_count||0).toLocaleString()).padEnd(15)}</span> <span class="term-data-val">${(n2.citation_count||0).toLocaleString()}</span>`);
    this._printRaw(`   ${'Bottleneck'.padEnd(15)} <span class="term-data-val">${(n1.is_bottleneck ? 'Yes' : 'No').padEnd(15)}</span> <span class="term-data-val">${n2.is_bottleneck ? 'Yes' : 'No'}</span>`);
  }

  _helpSyntax(syntax, desc) {
    // Render help line with <param> tokens highlighted
    const colored = syntax.replace(/<([^>]+)>/g, '<span class="term-help-param">&lt;$1&gt;</span>');
    this._printRaw(`   ${colored.padEnd(55)} <span class="term-comment">${desc}</span>`);
  }

  _showHelp(topic) {
    // ── Expanded help for 'script' ──
    if (topic === 'script') {
      this._print(' SCRIPT COMMANDS', 'welcome');
      this._print(' ═══════════════', 'welcome');
      this._print('');
      const cmds = [
        ['script save <name> [--desc <text>]', 'Save history as script'],
        ['script list', 'List all saved scripts'],
        ['script info <name>', 'Show script details + commands'],
        ['script delete <name>', 'Delete script (with y/n)'],
        ['script copy <name> as <new-name>', 'Duplicate a script'],
        ['script run <name>', 'Run batch (fast)'],
        ['script run <name> --slow', 'Run with 500ms delay'],
        ['script run <name> --verbose', 'Run with typewriter'],
        ['script run <name> as sequence', 'Step-by-step (Enter to advance)'],
        ['script export <name>', 'Copy .arivu to clipboard'],
        ['script append(<name>, <selector>)', 'Append commands to script'],
      ];
      for (const [s, d] of cmds) this._helpSyntax(s, d);
      this._print('');
      this._print(' Selectors for append:', 'info');
      this._helpSyntax('  all', 'All filtered history commands');
      this._helpSyntax('  <N>', 'Single command #N');
      this._helpSyntax('  [<N>-<M>]', 'Range from #N to #M');
      this._helpSyntax('  from: <script>', 'All from another script');
      this._helpSyntax('  from: <script>, <N>', 'Single from another script');
      this._print('');
      this._print(' Aliases:', 'info');
      this._printRaw(`   <span class="term-cmd-keyword">scripts</span>            → script list`);
      this._printRaw(`   <span class="term-cmd-keyword">run <span class="term-help-param">&lt;name&gt;</span></span>       → script run <name>`);
      return;
    }

    // ── Expanded help for 'session' ──
    if (topic === 'session') {
      this._print(' SESSION COMMANDS', 'welcome');
      this._print(' ════════════════', 'welcome');
      this._print('');
      const cmds = [
        ['session save <name>', 'Save terminal state'],
        ['session load(<name>)', 'Load in new window'],
        ['session load(<name>, replace)', 'Replace current terminal'],
        ['session load(<name>, continue)', 'Load into current terminal'],
        ['session rename <old> <new>', 'Rename a session'],
        ['session delete <name>', 'Delete session (with y/n)'],
        ['session list', 'List all sessions'],
        ['session append(<name>, <selector>)', 'Append commands to session'],
      ];
      for (const [s, d] of cmds) this._helpSyntax(s, d);
      this._print('');
      this._print(' Selectors for append:', 'info');
      this._helpSyntax('  all', 'All filtered history commands');
      this._helpSyntax('  <N>', 'Single command #N');
      this._helpSyntax('  [<N>-<M>]', 'Range from #N to #M');
      return;
    }

    // ── Single command help ──
    if (topic && this.parser.commands[topic]) {
      const info = this.parser.commands[topic];
      const colored = info.args.replace(/<([^>]+)>/g, '<span class="term-help-param">&lt;$1&gt;</span>');
      this._printRaw(` <span class="term-cmd-keyword">${topic}</span> ${colored}`);
      this._print(`   ${info.desc}`, 'comment');
      return;
    }

    // ── Full help listing ──
    const helpData = [
      ['Graph Navigation', [
        ['zoom <paper>', 'Zoom graph to paper node'],
        ['highlight <paper>', 'Highlight node with gold pulse'],
        ['filter <type>', 'Apply graph filter'],
        ['reset', 'Reset all graph state'],
      ]],
      ['Annotations', [
        ['annotate <paper> as <label>', 'Add annotation badge'],
        ['remove annotation <paper>', 'Remove annotation'],
        ['clear annotations', 'Clear all annotations'],
        ['ls annotations', 'List active annotations'],
      ]],
      ['Analysis', [
        ['info <paper>', 'Show paper statistics'],
        ['compare <paper> and <paper>', 'Side-by-side comparison'],
        ['path <paper> to <paper>', 'Find path between papers'],
        ['deep-dive <paper>', 'Athena deep dive analysis'],
        ['pathfinder <query>', 'Pathfinder analysis'],
        ['find <search>', 'Search papers by name'],
      ]],
      ['Sessions', [
        ['session save <name>', 'Save terminal state'],
        ['session load(<name>)', 'Load session'],
        ['session list', 'List all sessions'],
        ['session delete <name>', 'Delete session'],
      ]],
      ['Scripts', [
        ['script save <name>', 'Save history as script'],
        ['script run <name> [flags]', 'Execute script'],
        ['script list', 'List all scripts'],
        ['script info <name>', 'Show script details'],
        ['script append(<name>, <sel>)', 'Append to script'],
      ]],
      ['Utility', [
        ['help [<command>]', 'Show help'],
        ['history [--errors]', 'Show command history'],
        ['clear [screen|annotations]', 'Clear terminal'],
        ['exit', 'Close terminal'],
      ]],
    ];

    this._print(' ARIVU TERMINAL COMMANDS', 'welcome');
    this._print(' ═══════════════════════', 'welcome');

    for (const [section, cmds] of helpData) {
      this._print('');
      this._print(` ${section}`, 'info');
      for (const [syntax, desc] of cmds) {
        this._helpSyntax(syntax, desc);
      }
    }
    this._print('');
    this._print(' Tip: Tab for autocomplete · help script · help session', 'comment');
  }

  _suggestPapers(query) {
    const q = query.toLowerCase();
    const matches = (window._arivuGraph?.allNodes || [])
      .filter(n => (n.title || '').toLowerCase().includes(q))
      .slice(0, 3);
    if (matches.length) {
      this._print(`   Did you mean:`, 'warning');
      for (const n of matches) {
        this._printRaw(`     <span class="term-paper-ref">${this.parser._esc((n.title || '').substring(0, 50))}</span>`);
      }
    }
  }

  _getPaperRank(paperId) {
    // Quick rank lookup from graph data
    const nodes = window._arivuGraph?.allNodes || [];
    const sorted = [...nodes].sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0));
    const idx = sorted.findIndex(n => n.id === paperId);
    return idx >= 0 ? idx + 1 : '?';
  }

  /**
   * Remove annotation badge from both force graph and tree layout.
   */
  _removeAnnotationFromGraph(graph, paperId) {
    // Force graph
    if (typeof graph?.removeAnnotation === 'function') {
      graph.removeAnnotation(paperId);
    } else if (graph?.nodeElements) {
      graph.nodeElements
        .filter(d => d.id === paperId)
        .selectAll('.annotation-badge')
        .remove();
    }
    // Tree layout
    if (window._treeLayout?.removeAnnotation) {
      window._treeLayout.removeAnnotation(paperId);
    }
  }

  /**
   * Fallback annotation when graph.addAnnotation method isn't available
   * (e.g., if graph.js cached version doesn't have the method yet).
   */
  _fallbackAnnotate(graph, paperId, label) {
    const truncLabel = label.length > 20 ? label.substring(0, 18) + '..' : label;
    const fillColor = '#0D1117';
    const borderColor = '#D4A843';

    if (graph.nodeElements) {
      graph.nodeElements
        .filter(d => d.id === paperId)
        .each(function() {
          d3.select(this).selectAll('.annotation-badge').remove();
          const badge = d3.select(this).append('g')
            .attr('class', 'annotation-badge')
            .attr('data-annotation-id', paperId)
            .style('pointer-events', 'none');

          const rectW = truncLabel.length * 6.5 + 24;
          const rectH = 18;

          badge.append('rect')
            .attr('x', -rectW / 2).attr('y', -rectH - 16)
            .attr('width', rectW).attr('height', rectH)
            .attr('rx', 4).attr('fill', fillColor)
            .attr('stroke', borderColor).attr('stroke-width', 1.5).attr('opacity', 0.95);
          badge.append('polygon')
            .attr('points', '-4,-16 4,-16 0,-11')
            .attr('fill', fillColor).attr('stroke', borderColor).attr('stroke-width', 0.5);
          badge.append('text')
            .attr('x', 0).attr('y', -rectH / 2 - 16 + 5)
            .attr('text-anchor', 'middle')
            .attr('font-size', '10px')
            .attr('font-family', "'Array', 'JetBrains Mono', monospace")
            .attr('font-weight', '700').attr('fill', '#fff')
            .text(truncLabel);
        });
    }

    // Save to sessionStorage
    const graphId = graph.metadata?.graph_id || 'default';
    try {
      const key = `athena_annotations_${graphId}`;
      const existing = JSON.parse(sessionStorage.getItem(key) || '{}');
      existing[paperId] = { label, color: 'gold' };
      sessionStorage.setItem(key, JSON.stringify(existing));
    } catch (e) {}
  }

  // ── Auto-Complete ─────────────────────────────────────────────────────

  /**
   * Update the terminal window title bar text.
   */
  _updateTitle(name) {
    const titleEl = this.el?.querySelector('.term-title-text');
    if (titleEl) {
      titleEl.textContent = `${name}`;
    }
  }

  /**
   * Auto-save terminal state back to linked session in localStorage.
   * Called after every command execution.
   */
  _autoSave() {
    if (!this.linkedSessionId || !window.terminalCarousel) return;
    const carousel = window.terminalCarousel;
    const session = carousel.sessions.find(s => s.id === this.linkedSessionId);
    if (!session) return;

    session.commands = [...this.history];
    session.log = [...this.log];
    session.lastActive = new Date().toISOString();
    session.totalCommands = session.log.length;
    session.successCount = session.log.filter(l => l.status === 'success').length;
    session.errorCount = session.log.filter(l => l.status === 'error').length;

    // Update annotations
    const graphId = window._arivuGraph?.metadata?.graph_id || 'default';
    try {
      session.annotations = JSON.parse(sessionStorage.getItem(`athena_annotations_${graphId}`) || '{}');
      session.annotationCount = Object.keys(session.annotations).length;
    } catch {}

    carousel._saveSessions();
  }

  /**
   * Run a script: execute each command in sequence with visual feedback.
   * Uses requestAnimationFrame pacing for smooth output.
   */
  _runScript(script) {
    // Recursion guard — prevent script from running itself
    if (!this._runningScripts) this._runningScripts = new Set();
    const scriptKey = (script.name || script.id || '').toLowerCase();
    if (this._runningScripts.has(scriptKey)) {
      this._print(` ✗ Recursive script detected: "${script.name}" is already running`, 'error');
      return;
    }
    this._runningScripts.add(scriptKey);

    const cmds = script.commands || [];
    this._print(`┌─ Running: ${script.name} (${cmds.length} commands) ────────`, 'info');
    this._print(`│`, 'comment');

    let idx = 0;
    let successes = 0;
    let errors = 0;
    const startTime = Date.now();

    const runNext = () => {
      if (idx >= cmds.length) {
        // Done — clear recursion guard
        this._runningScripts?.delete(scriptKey);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        this._print(`│`, 'comment');
        this._print(`└─ Complete: ${successes}/${cmds.length} OK, ${errors} errors (${elapsed}s)`, successes === cmds.length ? 'success' : 'warning');
        return;
      }

      const cmd = cmds[idx];
      idx++;

      // Skip blank lines and comments
      if (!cmd.trim() || cmd.trim().startsWith('#')) {
        setTimeout(runNext, 0);
        return;
      }

      // Show the command
      this._printRaw(`│ <span class="term-comment">[${idx}/${cmds.length}]</span> ${this.parser.highlight(cmd)}`);

      // Parse and execute
      const result = this.parser.parse(cmd);
      this.log.push({
        timestamp: new Date().toISOString(),
        command: cmd,
        status: result.error ? 'error' : 'success',
        parsed: result.command,
      });

      if (result.error) {
        this._print(`│   ✗ ${result.error}`, 'error');
        errors++;
        setTimeout(runNext, 10);
        return;
      }

      if (result.command) {
        try {
          this._executeCommand(result);
          successes++;
        } catch (err) {
          this._print(`│   ✗ ${err.message}`, 'error');
          errors++;
        }
      }

      // Batch mode: minimal delay for DOM rendering (fast summary)
      // Phase 2 --verbose flag will use 150ms+ for typewriter mode
      setTimeout(runNext, 10);
    };

    // Start with a brief delay
    setTimeout(runNext, 50);
  }

  // ── Filter Helper: shows what gets kept/removed before saving ──────────

  /**
   * Filter history through SCRIPT_META_COMMANDS and return filtered list.
   * Also builds a summary of what was removed for verbose display.
   */
  _filterHistory() {
    const kept = [];
    const removedCounts = {};
    for (const cmd of this.history) {
      const first = cmd.trim().split(/\s+/)[0].toLowerCase();
      if (SCRIPT_META_COMMANDS.has(first) || cmd.startsWith('#')) {
        removedCounts[first] = (removedCounts[first] || 0) + 1;
      } else {
        kept.push(cmd);
      }
    }
    const removedTotal = this.history.length - kept.length;
    const removedSummary = Object.entries(removedCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `${k} ×${v}`)
      .join(', ');
    return { kept, removedTotal, removedSummary };
  }

  // ── Box Renderer (MySQL-style, lavender) ──────────────────────────────

  /**
   * Render a box with header, data rows, and optional command listing.
   * All borders use lavender, labels gray, values white.
   * @param {string} title - Header text
   * @param {string} badge - Right-aligned badge (e.g., "v3")
   * @param {Array<[string,string]>} data - Key-value pairs for stats
   * @param {string[]} commands - Command list to show
   * @param {string} [description] - Optional description below header
   */
  _renderBox(title, badge, data, commands, description) {
    const W = 50; // inner width
    const B = (s) => `<span class="term-box-border">${s}</span>`;
    const H = (s) => `<span class="term-box-header">${s}</span>`;
    const L = (s) => `<span class="term-box-label">${s}</span>`;
    const V = (s) => `<span class="term-box-value">${s}</span>`;

    // Header line: ┌─ Title ────── badge ─┐
    const titleText = this.parser._esc(title.substring(0, W - (badge?.length || 0) - 6));
    const badgeText = badge ? ` ${this.parser._esc(badge)} ` : '';
    const dashesAfterTitle = W - titleText.length - badgeText.length - 2;
    this._printRaw(`${B('┌─')} ${H(titleText)} ${B('─'.repeat(Math.max(1, dashesAfterTitle)))}${badgeText ? H(badgeText) : ''}${B('─┐')}`);

    // Description (if present)
    if (description) {
      this._printRaw(`${B('│')} ${L(this.parser._esc(description.substring(0, W - 1)).padEnd(W))}${B('│')}`);
    }
    this._printRaw(`${B('│')}${' '.repeat(W + 1)}${B('│')}`);

    // Data rows (two columns)
    for (let i = 0; i < data.length; i += 2) {
      const [k1, v1] = data[i] || ['', ''];
      const [k2, v2] = data[i + 1] || ['', ''];
      const left = `${L((k1 + '').padEnd(12))} ${V((v1 + '').padEnd(12))}`;
      const right = k2 ? `${L((k2 + '').padEnd(12))} ${V(v2 + '')}` : '';
      this._printRaw(`${B('│')}  ${left}${right.padEnd(W - 25)}${B('│')}`);
    }

    // Commands section
    if (commands?.length) {
      this._printRaw(`${B('│')}${' '.repeat(W + 1)}${B('│')}`);
      this._printRaw(`${B('├')}${B('─'.repeat(W + 1))}${B('┤')}`);
      this._printRaw(`${B('│')}${' '.repeat(W + 1)}${B('│')}`);
      commands.forEach((cmd, i) => {
        const num = `${L(String(i + 1).padStart(3))}  `;
        const highlighted = this.parser.highlight(cmd.substring(0, W - 6));
        this._printRaw(`${B('│')} ${num}${highlighted}${''.padEnd(Math.max(0, W - 6 - cmd.substring(0, W - 6).length))}${B('│')}`);
      });
    }

    this._printRaw(`${B('│')}${' '.repeat(W + 1)}${B('│')}`);
    this._printRaw(`${B('└')}${B('─'.repeat(W + 1))}${B('┘')}`);
  }

  /**
   * Render script info using the box renderer.
   */
  _renderScriptInfoBox(script) {
    const created = new Date(script.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const modified = new Date(script.modified).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const lastRun = script.lastRun
      ? new Date(script.lastRun).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'never';

    this._renderBox(
      script.name,
      'v' + (script.version || 1),
      [
        ['Commands', String(script.commands?.length || 0)],
        ['Runs', String(script.runCount || 0)],
        ['Created', created],
        ['Last run', lastRun],
        ['Modified', modified],
        ['Graph', (script.graphTitle || '—').substring(0, 20)],
      ],
      script.commands || [],
      script.description || null
    );
  }

  /**
   * Update the live syntax highlight overlay to mirror the input text.
   * Uses the parser's highlight() method for consistent coloring.
   */
  _updateHighlight() {
    if (!this.highlightEl) return;
    const text = this.inputEl.value;
    if (!text) {
      this.highlightEl.innerHTML = '';
      return;
    }
    this.highlightEl.innerHTML = this.parser.highlight(text);
  }

  _showACSuggestions() {
    const input = this.inputEl.value;
    const suggestions = this.parser.getSuggestions(input);

    if (!suggestions.length || !input.trim()) {
      this._hideAC();
      return;
    }

    this.acDropdown.innerHTML = suggestions.slice(0, 8).map((s, i) =>
      `<div class="term-ac-item${i === 0 ? ' selected' : ''}" data-index="${i}" data-text="${this.parser._esc(s.text)}">
        <span class="term-ac-item-cmd">${this.parser._esc(s.text)}</span>
        <span class="term-ac-item-desc">${this.parser._esc(s.desc)}</span>
      </div>`
    ).join('');

    this.acSelectedIndex = 0;
    this.acDropdown.classList.add('visible');

    // Click to select
    this.acDropdown.querySelectorAll('.term-ac-item').forEach(item => {
      item.addEventListener('click', () => {
        this.inputEl.value = item.dataset.text + ' ';
        this._updateHighlight();
        this._hideAC();
        this.inputEl.focus();
      });
    });
  }

  _navigateAC(dir) {
    const items = this.acDropdown.querySelectorAll('.term-ac-item');
    if (!items.length) return;
    items[this.acSelectedIndex]?.classList.remove('selected');
    this.acSelectedIndex = Math.max(0, Math.min(items.length - 1, this.acSelectedIndex + dir));
    items[this.acSelectedIndex]?.classList.add('selected');
  }

  _handleTab() {
    const items = this.acDropdown.querySelectorAll('.term-ac-item');
    if (items.length && this.acDropdown.classList.contains('visible')) {
      const selected = items[this.acSelectedIndex];
      if (selected) {
        this.inputEl.value = selected.dataset.text + ' ';
        this._updateHighlight();
        this._hideAC();
      }
    } else {
      // Trigger autocomplete
      this._showACSuggestions();
    }
  }

  _hideAC() {
    this.acDropdown.classList.remove('visible');
    this.acSelectedIndex = -1;
  }

  // ── Typewriter Animation ──────────────────────────────────────────────

  async typeAndExecute(command) {
    this.isAnimating = true;
    this.animSpeed = 40;
    this.inputEl.value = '';
    this.inputEl.focus();

    for (let i = 0; i < command.length; i++) {
      this.inputEl.value += command[i];
      this._updateHighlight();
      await new Promise(r => setTimeout(r, this.animSpeed));
    }

    // Brief pause then execute
    await new Promise(r => setTimeout(r, 200));
    this._execute(command);
    this.history.push(command);
    this.historyIndex = this.history.length;
    this.inputEl.value = '';
    this._updateHighlight();

    this.isAnimating = false;
    this.animSpeed = 40;
  }

  // ── Window Controls ───────────────────────────────────────────────────

  close() {
    this.el.remove();
    if (window.terminalManager) window.terminalManager.remove(this.id);
  }

  toggleMinimize() {
    this.el.classList.toggle('minimized');
  }

  toggleMaximize() {
    if (this.el.style.width === '100vw') {
      this.el.style.width = '560px';
      this.el.style.height = '380px';
      this.el.style.left = '';
      this.el.style.top = '';
      this.el.style.right = '20px';
      this.el.style.bottom = '60px';
    } else {
      this.el.style.width = '100vw';
      this.el.style.height = '60vh';
      this.el.style.left = '0';
      this.el.style.bottom = '0';
      this.el.style.top = 'auto';
      this.el.style.right = '0';
    }
  }

  focus() {
    this.el.style.zIndex = 9000 + Date.now() % 1000;
    this.inputEl.focus();
  }
}


// ── Terminal Manager ────────────────────────────────────────────────────

class TerminalManager {
  constructor() {
    this.terminals = {};
    this.counter = 0;
  }

  create() {
    this.counter++;
    const id = `term_${this.counter}`;
    const graphData = window._arivuGraph?.graphData || {};
    // Augment with metadata from the live graph
    if (window._arivuGraph?.metadata) graphData.metadata = window._arivuGraph.metadata;
    if (window._arivuGraph?.allNodes) graphData.nodes = window._arivuGraph.allNodes;
    if (window._arivuGraph?.allEdges) graphData.edges = window._arivuGraph.allEdges;

    const term = new ArivuTerminal(id, graphData);
    this.terminals[id] = term;
    return term;
  }

  remove(id) {
    delete this.terminals[id];
  }

  getActive() {
    const ids = Object.keys(this.terminals);
    return ids.length ? this.terminals[ids[ids.length - 1]] : null;
  }

  closeAll() {
    for (const term of Object.values(this.terminals)) {
      term.close();
    }
  }
}

// Initialize global manager
window.terminalManager = new TerminalManager();

// Export
window.ArivuTerminal = ArivuTerminal;
window.TerminalManager = TerminalManager;
