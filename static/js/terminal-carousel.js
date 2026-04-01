/**
 * terminal-carousel.js — 3D Rolodex Carousel for Terminal Sessions
 *
 * Displays saved terminal sessions in a 3D rotating carousel.
 * Pure black/white + gold accent design.
 */

class TerminalSessionCarousel {
  constructor() {
    this.sessions = [];
    this.activeIndex = 0;
    this.el = null;
    this.isOpen = false;
    this.activeTab = 'sessions'; // 'sessions' or 'scripts'
    this._loadSessions();
  }

  // ── Session Storage ───────────────────────────────────────────────────

  _loadSessions() {
    try {
      this.sessions = JSON.parse(localStorage.getItem('arivu_terminal_sessions') || '[]');
    } catch { this.sessions = []; }
  }

  _saveSessions() {
    try {
      localStorage.setItem('arivu_terminal_sessions', JSON.stringify(this.sessions));
    } catch {}
  }

  saveSession(name, terminalData) {
    const session = {
      id: 's_' + Date.now().toString(36),
      name: name || `Session ${this.sessions.length + 1}`,
      created: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      graphId: window._arivuGraph?.metadata?.graph_id || '',
      graphTitle: window._arivuGraph?.metadata?.seed_paper_title || 'Unknown',
      commands: terminalData.history || [],
      log: terminalData.log || [],
      annotations: {},
    };

    // Capture current annotations
    const graphId = window._arivuGraph?.metadata?.graph_id || 'default';
    try {
      session.annotations = JSON.parse(sessionStorage.getItem(`athena_annotations_${graphId}`) || '{}');
    } catch {}

    // Stats
    session.totalCommands = session.log.length;
    session.successCount = session.log.filter(l => l.status === 'success').length;
    session.errorCount = session.log.filter(l => l.status === 'error').length;
    session.annotationCount = Object.keys(session.annotations).length;

    this.sessions.unshift(session); // newest first
    this._saveSessions();
    return session;
  }

  deleteSession(id) {
    this.sessions = this.sessions.filter(s => s.id !== id);
    this._saveSessions();
  }

  renameSession(id, newName) {
    const s = this.sessions.find(s => s.id === id);
    if (s) { s.name = newName; this._saveSessions(); }
  }

  getSession(nameOrId) {
    return this.sessions.find(s => s.id === nameOrId || s.name.toLowerCase() === nameOrId.toLowerCase());
  }

  // ── Carousel UI ───────────────────────────────────────────────────────

  open() {
    if (this.isOpen) return;
    this._loadSessions();
    // Merge active terminals that aren't saved yet
    this._mergeActiveTerminals();
    this._buildDOM();
    this.isOpen = true;
    requestAnimationFrame(() => {
      this.el.classList.add('visible');
    });
  }

  /**
   * Add active (unsaved) terminals to the sessions list so they appear in the carousel.
   * These are marked with _isActive=true and don't persist in localStorage.
   */
  _mergeActiveTerminals() {
    const tm = window.terminalManager;
    if (!tm) return;
    // Remove old active-only entries
    this.sessions = this.sessions.filter(s => !s._isActive);
    // Add current active terminals
    for (const [id, term] of Object.entries(tm.terminals)) {
      // Check if this terminal is already saved
      const alreadySaved = this.sessions.some(s =>
        s.commands?.length && term.history?.length &&
        s.commands[s.commands.length - 1] === term.history[term.history.length - 1]
      );
      if (!alreadySaved) {
        this.sessions.unshift({
          id: id,
          name: `Terminal ${id.replace('term_', '#')}`,
          created: new Date().toISOString(),
          lastActive: new Date().toISOString(),
          graphId: window._arivuGraph?.metadata?.graph_id || '',
          graphTitle: window._arivuGraph?.metadata?.seed_paper_title || '',
          commands: term.history || [],
          log: term.log || [],
          annotations: {},
          totalCommands: (term.log || []).length,
          successCount: (term.log || []).filter(l => l.status === 'success').length,
          errorCount: (term.log || []).filter(l => l.status === 'error').length,
          annotationCount: 0,
          _isActive: true, // Flag: this is a live terminal, not saved
          _terminalId: id,
        });
      }
    }
  }

  close() {
    if (!this.isOpen || !this.el) return;
    this.el.classList.remove('visible');
    setTimeout(() => {
      this.el?.remove();
      this.el = null;
      this.isOpen = false;
    }, 300);
  }

  _buildDOM() {
    if (this.el) this.el.remove();

    const scripts = window.arivuScriptStorage?.list() || [];
    const overlay = document.createElement('div');
    overlay.className = 'carousel-overlay';
    overlay.innerHTML = `
      <button class="carousel-close" title="Close">✕</button>
      <div class="carousel-header">
        <div class="carousel-tabs">
          <button class="carousel-tab ${this.activeTab === 'sessions' ? 'carousel-tab--active' : ''}" data-tab="sessions">
            Sessions <span class="carousel-tab-count">${this.sessions.length}</span>
          </button>
          <button class="carousel-tab ${this.activeTab === 'scripts' ? 'carousel-tab--active' : ''}" data-tab="scripts">
            Scripts <span class="carousel-tab-count">${scripts.length}</span>
          </button>
        </div>
      </div>
      <div class="carousel-scene">
        <button class="carousel-nav carousel-nav--left">‹</button>
        <div class="carousel-track"></div>
        <button class="carousel-nav carousel-nav--right">›</button>
      </div>
      <div class="carousel-dots"></div>
      <div class="carousel-hint">← → NAVIGATE  ·  ENTER OPEN  ·  ESC CLOSE</div>
    `;

    this.el = overlay;
    this.trackEl = overlay.querySelector('.carousel-track');
    this.dotsEl = overlay.querySelector('.carousel-dots');

    // Build cards (sessions + "new session" card at the end)
    this._renderCards();
    this._updatePositions();
    this._renderDots();

    // Event listeners
    overlay.querySelector('.carousel-close').addEventListener('click', () => this.close());
    overlay.querySelector('.carousel-nav--left').addEventListener('click', () => this.prev());
    overlay.querySelector('.carousel-nav--right').addEventListener('click', () => this.next());

    // Tab switching
    overlay.querySelectorAll('.carousel-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.activeTab = tab.dataset.tab;
        this.activeIndex = 0;
        overlay.querySelectorAll('.carousel-tab').forEach(t => t.classList.remove('carousel-tab--active'));
        tab.classList.add('carousel-tab--active');
        this._renderCards();
        this._updatePositions();
        this._renderDots();
      });
    });

    // Click backdrop to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    // Keyboard
    this._keyHandler = (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') this.close();
      if (e.key === 'ArrowLeft') this.prev();
      if (e.key === 'ArrowRight') this.next();
      if (e.key === 'Enter') this._openActiveSession();
    };
    document.addEventListener('keydown', this._keyHandler);

    // Scroll wheel
    overlay.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY > 0 || e.deltaX > 0) this.next();
      else this.prev();
    }, { passive: false });

    document.body.appendChild(overlay);
  }

  _renderCards() {
    this.trackEl.innerHTML = '';

    if (this.activeTab === 'scripts') {
      this._renderScriptCards();
      return;
    }

    const allItems = [...this.sessions, { _isNew: true }];

    allItems.forEach((session, i) => {
      const card = document.createElement('div');
      card.className = 'carousel-card';
      card.dataset.index = i;

      if (session._isNew) {
        card.classList.add('card-new');
        card.innerHTML = `
          <div class="card-new-inner">
            <div class="card-new-icon">+</div>
            <div class="card-new-text">New Session</div>
          </div>
        `;
        card.addEventListener('click', () => {
          if (card.classList.contains('pos-0')) {
            this.close();
            if (window.terminalManager) window.terminalManager.create();
          }
        });
      } else {
        const date = new Date(session.created);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const lastActive = session.lastActive
          ? this._timeAgo(new Date(session.lastActive))
          : 'unknown';

        // Build mini preview from last 4 log entries
        let previewHtml = '';
        const previewItems = (session.log || []).slice(-4);
        for (const entry of previewItems) {
          const cmd = (entry.command || '').substring(0, 32);
          const icon = entry.status === 'error' ? '✗' : '✓';
          const cls = entry.status === 'error' ? 'card-preview-out' : 'card-preview-out';
          previewHtml += `<div class="card-preview-cmd">$ ${this._esc(cmd)}</div>`;
          previewHtml += `<div class="${cls}">  ${icon} ${entry.parsed || 'ok'}</div>`;
        }
        if (!previewItems.length) {
          previewHtml = '<div class="card-preview-out" style="color:#333">Empty session</div>';
        }

        card.innerHTML = `
          <div class="card-header">
            <div class="card-name">${this._esc(session.name)}</div>
            <div class="card-date">${dateStr} · ${lastActive} ${session._isActive ? '<span style="color:#D4A843;font-weight:700">· ACTIVE</span>' : ''}</div>
          </div>
          <div class="card-stats">
            <div class="card-stat">
              <div class="card-stat-val">${session.totalCommands || 0}</div>
              <div class="card-stat-label">Cmds</div>
            </div>
            <div class="card-stat">
              <div class="card-stat-val">${session.annotationCount || 0}</div>
              <div class="card-stat-label">Ann</div>
            </div>
            <div class="card-stat">
              <div class="card-stat-val">${session.successCount || 0}</div>
              <div class="card-stat-label">OK</div>
            </div>
            <div class="card-stat">
              <div class="card-stat-val">${session.errorCount || 0}</div>
              <div class="card-stat-label">Err</div>
            </div>
          </div>
          <div class="card-preview">${previewHtml}</div>
          <div class="card-actions">
            <button class="card-btn card-btn--open" data-session-id="${session.id}">Open</button>
            <button class="card-btn card-btn--replay" data-session-id="${session.id}">▶</button>
            <button class="card-btn card-btn--delete" data-session-id="${session.id}">✕</button>
          </div>
        `;

        // Wire action buttons
        card.querySelector('.card-btn--open')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this._openSession(session);
        });
        card.querySelector('.card-btn--replay')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this._replaySession(session);
        });
        card.querySelector('.card-btn--delete')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this._deleteSessionCard(session.id, card);
        });

        // Click card: non-active → rotate to it, active → open detail view
        card.addEventListener('click', () => {
          if (!card.classList.contains('pos-0')) {
            const idx = parseInt(card.dataset.index);
            this.activeIndex = idx;
            this._updatePositions();
            this._renderDots();
          } else {
            // Active card clicked — open detail view
            this._showDetail(session);
          }
        });
      }

      this.trackEl.appendChild(card);
    });
  }

  _updatePositions() {
    const cards = this.trackEl.querySelectorAll('.carousel-card');
    cards.forEach((card, i) => {
      // Remove all position classes
      card.className = card.className.replace(/pos-[-\d]+|pos-hidden/g, '').trim();
      if (!card.classList.contains('carousel-card')) card.classList.add('carousel-card');
      if (card.dataset.isNew) card.classList.add('card-new');

      const offset = i - this.activeIndex;
      if (offset === 0) card.classList.add('pos-0');
      else if (offset === 1) card.classList.add('pos-1');
      else if (offset === -1) card.classList.add('pos--1');
      else if (offset === 2) card.classList.add('pos-2');
      else if (offset === -2) card.classList.add('pos--2');
      else card.classList.add('pos-hidden');
    });
  }

  _getItemCount() {
    if (this.activeTab === 'scripts') {
      return (window.arivuScriptStorage?.list()?.length || 0) + 1;
    }
    return this.sessions.length + 1;
  }

  _renderDots() {
    const total = this._getItemCount();
    this.dotsEl.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('div');
      dot.className = `carousel-dot${i === this.activeIndex ? ' active' : ''}`;
      dot.addEventListener('click', () => {
        this.activeIndex = i;
        this._updatePositions();
        this._renderDots();
      });
      this.dotsEl.appendChild(dot);
    }
  }

  prev() {
    const total = this._getItemCount();
    this.activeIndex = (this.activeIndex - 1 + total) % total;
    this._updatePositions();
    this._renderDots();
  }

  next() {
    const total = this._getItemCount();
    this.activeIndex = (this.activeIndex + 1) % total;
    this._updatePositions();
    this._renderDots();
  }

  // ── Session Actions ───────────────────────────────────────────────────

  _openActiveSession() {
    if (this.activeTab === 'scripts') {
      const scripts = window.arivuScriptStorage?.list() || [];
      const script = scripts[this.activeIndex];
      if (script) {
        this._showScriptDetail(script);
      } else {
        // "New Script" card
        this.close();
        const tm = window.terminalManager;
        if (tm) {
          const term = tm.create();
          term._print(` Create commands, then: script save "<name>"`, 'comment');
        }
      }
      return;
    }
    const session = this.sessions[this.activeIndex];
    if (session && !session._isNew) {
      this._showDetail(session);
    } else if (!session || session._isNew || this.activeIndex === this.sessions.length) {
      this.close();
      if (window.terminalManager) window.terminalManager.create();
    }
  }

  // ── STATE 3: Detail View ──────────────────────────────────────────────

  _showDetail(session) {
    // Remove existing detail overlay if any
    document.querySelector('.detail-overlay')?.remove();

    const date = new Date(session.created);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const lastActive = session.lastActive ? this._timeAgo(new Date(session.lastActive)) : 'unknown';
    const isActive = !!session._isActive;

    // Build command preview HTML
    let previewHtml = '';
    const logEntries = session.log || [];
    const maxPreview = 20;
    for (let i = 0; i < Math.min(logEntries.length, maxPreview); i++) {
      const entry = logEntries[i];
      const cmd = this._esc(entry.command || '');
      // Highlight the command keyword
      const firstWord = cmd.split(' ')[0];
      const rest = cmd.substring(firstWord.length);
      const icon = entry.status === 'error' ? '✗' : '✓';
      const iconCls = entry.status === 'error' ? 'detail-out-err' : 'detail-out-ok';
      previewHtml += `<div class="detail-cmd"><span class="detail-cmd-keyword">${firstWord}</span>${rest}</div>`;
      previewHtml += `<div class="detail-out"><span class="${iconCls}">${icon}</span> ${entry.parsed || 'ok'}</div>`;
    }
    if (logEntries.length > maxPreview) {
      previewHtml += `<div class="detail-more">... ${logEntries.length - maxPreview} more commands</div>`;
    }
    if (!logEntries.length) {
      previewHtml = '<div class="detail-out" style="color:#333">Empty session</div>';
    }

    const overlay = document.createElement('div');
    overlay.className = 'detail-overlay';
    overlay.innerHTML = `
      <div class="detail-panel">
        <div class="detail-header">
          <span class="detail-name">${this._esc(session.name)}</span>
          <button class="detail-close" title="Close">✕</button>
        </div>
        <div class="detail-meta">
          Created: ${dateStr} · Last active: ${lastActive}
          ${isActive ? '<span class="detail-meta-active"> · ACTIVE</span>' : ''}
        </div>
        <div class="detail-stats">
          <div class="detail-stat">
            <div class="detail-stat-val detail-stat-val--gold">${session.totalCommands || 0}</div>
            <div class="detail-stat-label">Commands</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat-val detail-stat-val--green">${session.annotationCount || 0}</div>
            <div class="detail-stat-label">Annotations</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat-val detail-stat-val--blue">${session.successCount || 0}</div>
            <div class="detail-stat-label">Success</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat-val detail-stat-val--red">${session.errorCount || 0}</div>
            <div class="detail-stat-label">Errors</div>
          </div>
        </div>
        <div class="detail-preview">
          <div class="detail-preview-label">Session Preview</div>
          ${previewHtml}
        </div>
        <div class="detail-actions">
          <button class="detail-btn detail-btn--open">Open</button>
          <button class="detail-btn detail-btn--replay">▶ Replay</button>
          <button class="detail-btn detail-btn--export">↓ Export</button>
          <button class="detail-btn detail-btn--delete">✕ Delete</button>
        </div>
      </div>
    `;

    // Wire buttons
    overlay.querySelector('.detail-close').addEventListener('click', () => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 300);
    });

    overlay.querySelector('.detail-btn--open').addEventListener('click', () => {
      overlay.remove();
      this._openSession(session);
    });

    overlay.querySelector('.detail-btn--replay').addEventListener('click', () => {
      overlay.remove();
      this._replaySession(session);
    });

    overlay.querySelector('.detail-btn--export').addEventListener('click', () => {
      // Generate .arivu script
      const graphTitle = window._arivuGraph?.metadata?.seed_paper_title || 'Unknown';
      const nodeCount = window._arivuGraph?.allNodes?.length || 0;
      const now = new Date().toLocaleString();
      const commands = session.commands || [];

      let script = `# ═══════════════════════════════════════════════\n`;
      script += `# Arivu Terminal Script — ${session.name}\n`;
      script += `# Exported: ${now}\n`;
      script += `# Graph: ${graphTitle} (${nodeCount} papers)\n`;
      script += `# Session: ${commands.length} commands\n`;
      script += `# ═══════════════════════════════════════════════\n\n`;
      for (const cmd of commands) {
        const first = cmd.trim().split(/\s+/)[0].toLowerCase();
        if (['save', 'load', 'sessions', 'help', 'history', 'export', 'clear', 'exit', 'rename', 'delete'].includes(first)) continue;
        script += cmd + '\n';
      }

      navigator.clipboard?.writeText(script).then(() => {
        const btn = overlay.querySelector('.detail-btn--export');
        btn.textContent = '✓ Copied';
        btn.style.color = '#22c55e';
        btn.style.borderColor = '#22c55e';
        setTimeout(() => { btn.textContent = '↓ Export'; btn.style.color = ''; btn.style.borderColor = ''; }, 2000);
      }).catch(() => {});
    });

    overlay.querySelector('.detail-btn--delete').addEventListener('click', () => {
      const btn = overlay.querySelector('.detail-btn--delete');
      if (btn.dataset.confirmed) {
        // Second click — actually delete
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 300);
        this.deleteSession(session.id);
        this._renderCards();
        this._updatePositions();
        this._renderDots();
      } else {
        // First click — ask for confirmation
        btn.textContent = 'Confirm Delete?';
        btn.style.color = '#ef4444';
        btn.style.borderColor = '#ef4444';
        btn.dataset.confirmed = 'true';
        setTimeout(() => {
          btn.textContent = '✕ Delete';
          btn.style.color = '';
          btn.style.borderColor = '';
          delete btn.dataset.confirmed;
        }, 3000);
      }
    });

    // Click backdrop to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 300);
      }
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
  }

  _openSession(session) {
    this.close();

    // If this is an active terminal, just focus it
    if (session._isActive && session._terminalId) {
      const tm = window.terminalManager;
      if (tm?.terminals[session._terminalId]) {
        tm.terminals[session._terminalId].focus();
        return;
      }
    }

    // Restore annotations
    if (session.annotations && Object.keys(session.annotations).length) {
      const graphId = window._arivuGraph?.metadata?.graph_id || 'default';
      sessionStorage.setItem(`athena_annotations_${graphId}`, JSON.stringify(session.annotations));
      if (window._arivuGraph?.restoreAnnotations) {
        window._arivuGraph.restoreAnnotations();
      }
    }

    // Open terminal with session data loaded + link it for auto-save
    const tm = window.terminalManager;
    if (!tm) return;
    const term = tm.create();
    term.history = session.commands || [];
    term.log = session.log || [];
    term.linkedSessionId = session.id; // Link for auto-save
    term._updateTitle(session.name); // Set terminal title to session name

    // Show session loaded message
    term._print('');
    term._print(` Session loaded: ${session.name}`, 'success');
    term._print(` ${session.totalCommands} commands, ${session.annotationCount} annotations`, 'info');
    term._print('');

    // Update last active
    session.lastActive = new Date().toISOString();
    this._saveSessions();
  }

  _replaySession(session) {
    this.close();
    const tm = window.terminalManager;
    if (!tm) return;
    const term = tm.create();

    term._print(` Replaying: ${session.name}`, 'info');
    term._print('');

    // Replay commands with typewriter delay
    const commands = session.commands || [];
    let i = 0;
    const replayNext = () => {
      if (i >= commands.length) {
        term._print('');
        term._print(' Replay complete.', 'success');
        return;
      }
      term.typeAndExecute(commands[i]).then(() => {
        i++;
        setTimeout(replayNext, 500);
      });
    };
    setTimeout(replayNext, 500);
  }

  _deleteSessionCard(id, cardEl) {
    cardEl.style.transition = 'all 0.3s ease';
    cardEl.style.opacity = '0';
    cardEl.style.transform += ' scale(0.8)';
    setTimeout(() => {
      this.deleteSession(id);
      if (this.activeIndex >= this.sessions.length) {
        this.activeIndex = Math.max(0, this.sessions.length - 1);
      }
      this._renderCards();
      this._updatePositions();
      this._renderDots();
      // Update subtitle
      const sub = this.el?.querySelector('.carousel-subtitle');
      if (sub) sub.textContent = `${this.sessions.length} saved session${this.sessions.length !== 1 ? 's' : ''}`;
    }, 300);
  }

  // ── Script Cards ───────────────────────────────────────────────────────

  _renderScriptCards() {
    const storage = window.arivuScriptStorage;
    const scripts = storage?.list() || [];
    const allItems = [...scripts, { _isNewScript: true }];

    allItems.forEach((script, i) => {
      const card = document.createElement('div');
      card.className = 'carousel-card';
      card.dataset.index = i;

      if (script._isNewScript) {
        card.classList.add('card-new');
        card.innerHTML = `
          <div class="card-new-inner">
            <div class="card-new-icon">{ }</div>
            <div class="card-new-text">New Script</div>
          </div>
        `;
        card.addEventListener('click', () => {
          if (card.classList.contains('pos-0')) {
            this.close();
            // Open terminal with hint about script save
            const tm = window.terminalManager;
            if (tm) {
              const term = tm.create();
              term._print(` Create commands, then: script save "<name>"`, 'comment');
            }
          }
        });
      } else {
        const date = new Date(script.created);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const modified = script.modified ? this._timeAgo(new Date(script.modified)) : 'unknown';

        // Build mini preview from first 4 commands
        let previewHtml = '';
        const previewCmds = (script.commands || []).slice(0, 4);
        for (const cmd of previewCmds) {
          previewHtml += `<div class="card-preview-cmd">  ${this._esc(cmd.substring(0, 36))}</div>`;
        }
        if ((script.commands || []).length > 4) {
          previewHtml += `<div class="card-preview-out" style="color:#333">  ... ${script.commands.length - 4} more</div>`;
        }
        if (!previewCmds.length) {
          previewHtml = '<div class="card-preview-out" style="color:#333">Empty script</div>';
        }

        card.innerHTML = `
          <div class="card-header">
            <div class="card-name">${this._esc(script.name)}</div>
            <div class="card-date">${dateStr} · ${modified} · v${script.version || 1}</div>
          </div>
          <div class="card-stats">
            <div class="card-stat">
              <div class="card-stat-val">${script.commands?.length || 0}</div>
              <div class="card-stat-label">Cmds</div>
            </div>
            <div class="card-stat">
              <div class="card-stat-val">v${script.version || 1}</div>
              <div class="card-stat-label">Ver</div>
            </div>
            <div class="card-stat">
              <div class="card-stat-val">${script.runCount || 0}</div>
              <div class="card-stat-label">Runs</div>
            </div>
            <div class="card-stat">
              <div class="card-stat-val">${(script.graphTitle || '—').substring(0, 6)}</div>
              <div class="card-stat-label">Graph</div>
            </div>
          </div>
          <div class="card-preview">${previewHtml}</div>
          <div class="card-actions">
            <button class="card-btn card-btn--open" data-script-name="${this._esc(script.name)}">▶ Run</button>
            <button class="card-btn card-btn--replay" data-script-name="${this._esc(script.name)}">↓</button>
            <button class="card-btn card-btn--delete" data-script-id="${script.id}">✕</button>
          </div>
        `;

        // Wire action buttons
        card.querySelector('.card-btn--open')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this._runScriptFromCarousel(script);
        });
        card.querySelector('.card-btn--replay')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this._exportScriptFromCarousel(script);
        });
        card.querySelector('.card-btn--delete')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this._deleteScriptCard(script.name, card);
        });

        // Click card: non-active → rotate, active → show detail
        card.addEventListener('click', () => {
          if (!card.classList.contains('pos-0')) {
            const idx = parseInt(card.dataset.index);
            this.activeIndex = idx;
            this._updatePositions();
            this._renderDots();
          } else {
            this._showScriptDetail(script);
          }
        });
      }

      this.trackEl.appendChild(card);
    });
  }

  _runScriptFromCarousel(script) {
    this.close();
    const tm = window.terminalManager;
    if (!tm) return;
    const term = tm.create();
    const storage = window.arivuScriptStorage;
    if (storage) storage.recordRun(script.name);
    term._runScript(script);
  }

  _exportScriptFromCarousel(script) {
    const storage = window.arivuScriptStorage;
    if (!storage) return;
    const formatted = storage.toArivuFormat(script);
    navigator.clipboard?.writeText(formatted).then(() => {
      // Brief visual feedback on the button
      const btn = this.el?.querySelector(`[data-script-name="${this._esc(script.name)}"].card-btn--replay`);
      if (btn) {
        btn.textContent = '✓';
        btn.style.color = '#22c55e';
        btn.style.borderColor = '#22c55e';
        setTimeout(() => { btn.textContent = '↓'; btn.style.color = ''; btn.style.borderColor = ''; }, 1500);
      }
    });
  }

  _deleteScriptCard(name, cardEl) {
    const storage = window.arivuScriptStorage;
    if (!storage) return;
    cardEl.style.transition = 'all 0.3s ease';
    cardEl.style.opacity = '0';
    cardEl.style.transform += ' scale(0.8)';
    setTimeout(() => {
      storage.delete(name);
      const scripts = storage.list();
      if (this.activeIndex >= scripts.length) {
        this.activeIndex = Math.max(0, scripts.length - 1);
      }
      this._renderCards();
      this._updatePositions();
      this._renderDots();
    }, 300);
  }

  _showScriptDetail(script) {
    // Remove existing detail overlay
    document.querySelector('.detail-overlay')?.remove();

    const date = new Date(script.created);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const modified = new Date(script.modified).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // Build command preview
    let previewHtml = '';
    const cmds = script.commands || [];
    const maxPreview = 20;
    for (let i = 0; i < Math.min(cmds.length, maxPreview); i++) {
      const cmd = this._esc(cmds[i]);
      const firstWord = cmd.split(' ')[0];
      const rest = cmd.substring(firstWord.length);
      previewHtml += `<div class="detail-cmd"><span class="detail-cmd-keyword">${firstWord}</span>${rest}</div>`;
    }
    if (cmds.length > maxPreview) {
      previewHtml += `<div class="detail-more">... ${cmds.length - maxPreview} more commands</div>`;
    }
    if (!cmds.length) {
      previewHtml = '<div class="detail-out" style="color:#333">Empty script</div>';
    }

    const overlay = document.createElement('div');
    overlay.className = 'detail-overlay';
    overlay.innerHTML = `
      <div class="detail-panel">
        <div class="detail-header">
          <span class="detail-name">${this._esc(script.name)}</span>
          <button class="detail-close" title="Close">✕</button>
        </div>
        <div class="detail-meta">
          ${script.description ? this._esc(script.description) + ' · ' : ''}Created: ${dateStr} · Modified: ${modified}
        </div>
        <div class="detail-stats">
          <div class="detail-stat">
            <div class="detail-stat-val detail-stat-val--gold">${cmds.length}</div>
            <div class="detail-stat-label">Commands</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat-val detail-stat-val--blue">v${script.version || 1}</div>
            <div class="detail-stat-label">Version</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat-val detail-stat-val--green">${script.runCount || 0}</div>
            <div class="detail-stat-label">Runs</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat-val">${script.versions?.length || 1}</div>
            <div class="detail-stat-label">History</div>
          </div>
        </div>
        <div class="detail-preview">
          <div class="detail-preview-label">Script Commands</div>
          ${previewHtml}
        </div>
        <div class="detail-actions">
          <button class="detail-btn detail-btn--open">▶ Run</button>
          <button class="detail-btn detail-btn--replay">↓ Export</button>
          <button class="detail-btn detail-btn--export">✎ Copy</button>
          <button class="detail-btn detail-btn--delete">✕ Delete</button>
        </div>
      </div>
    `;

    // Wire buttons
    overlay.querySelector('.detail-close').addEventListener('click', () => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 300);
    });

    overlay.querySelector('.detail-btn--open').addEventListener('click', () => {
      overlay.remove();
      this._runScriptFromCarousel(script);
    });

    overlay.querySelector('.detail-btn--replay').addEventListener('click', () => {
      // Export as .arivu
      const storage = window.arivuScriptStorage;
      if (!storage) return;
      const formatted = storage.toArivuFormat(script);
      navigator.clipboard?.writeText(formatted).then(() => {
        const btn = overlay.querySelector('.detail-btn--replay');
        btn.textContent = '✓ Copied';
        btn.style.color = '#22c55e';
        btn.style.borderColor = '#22c55e';
        setTimeout(() => { btn.textContent = '↓ Export'; btn.style.color = ''; btn.style.borderColor = ''; }, 2000);
      });
    });

    overlay.querySelector('.detail-btn--export').addEventListener('click', () => {
      // Copy script — prompt-style inline
      overlay.remove();
      const storage = window.arivuScriptStorage;
      if (storage) {
        const copy = storage.copy(script.name, `${script.name} (copy)`);
        if (copy) {
          // Refresh carousel
          this._renderCards();
          this._updatePositions();
          this._renderDots();
        }
      }
    });

    overlay.querySelector('.detail-btn--delete').addEventListener('click', () => {
      const btn = overlay.querySelector('.detail-btn--delete');
      if (btn.dataset.confirmed) {
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 300);
        const storage = window.arivuScriptStorage;
        if (storage) storage.delete(script.name);
        this._renderCards();
        this._updatePositions();
        this._renderDots();
      } else {
        btn.textContent = 'Confirm Delete?';
        btn.style.color = '#ef4444';
        btn.style.borderColor = '#ef4444';
        btn.dataset.confirmed = 'true';
        setTimeout(() => {
          btn.textContent = '✕ Delete';
          btn.style.color = '';
          btn.style.borderColor = '';
          delete btn.dataset.confirmed;
        }, 3000);
      }
    });

    // Click backdrop
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 300);
      }
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  _timeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  _esc(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// ── Global Instance ──────────────────────────────────────────────────────

window.terminalCarousel = new TerminalSessionCarousel();
