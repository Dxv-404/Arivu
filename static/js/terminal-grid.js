/**
 * terminal-grid.js — Terminal Management System
 *
 * The Pill (header indicator) + Grid Menu (dropdown with terminal cards)
 * + Genie Warp Animation + Pin System + Right-Click Context Menu
 *
 * Architecture:
 *   Pill lives in header bar → click opens Grid Menu
 *   Grid Menu shows terminal cards (icon or normal mode)
 *   Minimize warps terminal into grid card (genie effect)
 *   Pin persists terminals across graph changes (localStorage)
 *   Right-click on cards opens context menu
 */

class TerminalGridManager {
  constructor() {
    this.isGridOpen = false;
    this.gridEl = null;
    this.pillEl = null;
    this.columns = parseInt(localStorage.getItem('arivu_grid_columns') || '3');
    this.iconMode = localStorage.getItem('arivu_grid_icon_mode') === 'true';
    this.cardOrder = []; // ordered terminal IDs for rearrangement
    this.contextMenuEl = null;

    this._createPill();
    this._attachGlobalEvents();
  }

  // ═════════════════════════════════════════════════════════════════════
  // PILL — Header indicator
  // ═════════════════════════════════════════════════════════════════════

  _createPill() {
    const pill = document.createElement('span');
    pill.className = 'term-pill';
    pill.style.display = 'none'; // hidden until terminals exist
    pill.innerHTML = `<span class="term-pill-dot">○</span> <span class="term-pill-text"></span>`;
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleGrid();
    });

    // Insert pill in header, before ATHENA button
    const headerRight = document.querySelector('.header-right-v2');
    if (headerRight) {
      const athenaBtn = headerRight.querySelector('#athena-toggle');
      if (athenaBtn) {
        headerRight.insertBefore(pill, athenaBtn);
      } else {
        headerRight.prepend(pill);
      }
    } else {
      // Fallback: fixed position
      document.body.appendChild(pill);
      pill.style.position = 'fixed';
      pill.style.top = '12px';
      pill.style.right = '180px';
      pill.style.zIndex = '9999';
    }

    this.pillEl = pill;
  }

  /**
   * Update pill visibility and count with typewriter animation.
   */
  updatePill() {
    const tm = window.terminalManager;
    if (!tm) return;

    const count = Object.keys(tm.terminals).length + this._getPinnedCount();
    const minimizedCount = this._getMinimizedIds().length;
    const totalVisible = count;

    if (totalVisible === 0) {
      // No terminals — hide pill with reverse typewriter
      if (this.pillEl.style.display !== 'none') {
        this._typewriterOut();
      }
      return;
    }

    if (this.pillEl.style.display === 'none') {
      // First terminal — show pill with typewriter
      this.pillEl.style.display = '';
      this._typewriterIn(totalVisible);
    } else {
      // Update count
      const textEl = this.pillEl.querySelector('.term-pill-text');
      if (textEl) textEl.textContent = `${totalVisible} active`;
    }
  }

  _typewriterIn(count) {
    const textEl = this.pillEl.querySelector('.term-pill-text');
    if (!textEl) return;

    const fullText = `${count} active`;
    textEl.textContent = '';
    textEl.classList.add('typing');

    let i = 0;
    const type = () => {
      if (i < fullText.length) {
        textEl.textContent = fullText.substring(0, i + 1);
        i++;
        setTimeout(type, 60);
      } else {
        // Remove cursor after typing
        setTimeout(() => textEl.classList.remove('typing'), 500);
      }
    };
    setTimeout(type, 200);
  }

  _typewriterOut() {
    const textEl = this.pillEl.querySelector('.term-pill-text');
    if (!textEl) return;

    const text = textEl.textContent;
    let i = text.length;
    const untype = () => {
      if (i > 0) {
        i--;
        textEl.textContent = text.substring(0, i);
        setTimeout(untype, 40);
      } else {
        this.pillEl.style.display = 'none';
      }
    };
    untype();
  }

  // ═════════════════════════════════════════════════════════════════════
  // GRID MENU — Dropdown from pill
  // ═════════════════════════════════════════════════════════════════════

  toggleGrid() {
    if (this.isGridOpen) this.closeGrid();
    else this.openGrid();
  }

  openGrid() {
    if (this.isGridOpen) return;
    this.isGridOpen = true;
    this._buildGrid();
  }

  closeGrid() {
    if (!this.isGridOpen || !this.gridEl) return;
    this.gridEl.classList.remove('visible');
    setTimeout(() => {
      this.gridEl?.remove();
      this.gridEl = null;
      this.isGridOpen = false;
    }, 200);
  }

  _buildGrid() {
    if (this.gridEl) this.gridEl.remove();

    const menu = document.createElement('div');
    menu.className = 'term-grid-menu';

    const cards = this._getGridCards();

    menu.innerHTML = `
      <div class="term-grid-cards" style="grid-template-columns: repeat(${this.columns}, 1fr);">
        ${cards.map(c => this._renderCard(c)).join('')}
        ${this._renderNewCard()}
      </div>
    `;

    // Position below pill
    if (this.pillEl) {
      const rect = this.pillEl.getBoundingClientRect();
      menu.style.top = (rect.bottom + 8) + 'px';
      menu.style.right = (window.innerWidth - rect.right) + 'px';
    }

    // Close on backdrop click
    const backdrop = document.createElement('div');
    backdrop.className = 'term-grid-backdrop';
    backdrop.addEventListener('click', () => this.closeGrid());

    document.body.appendChild(backdrop);
    document.body.appendChild(menu);
    this.gridEl = menu;
    this._gridBackdrop = backdrop;

    // Wire card events
    this._wireCardEvents(menu);

    requestAnimationFrame(() => {
      menu.classList.add('visible');
      backdrop.classList.add('visible');
    });
  }

  _getGridCards() {
    const cards = [];
    const tm = window.terminalManager;

    // Active terminals
    if (tm) {
      for (const [id, term] of Object.entries(tm.terminals)) {
        cards.push({
          type: 'active',
          id,
          name: term.el?.querySelector('.term-title-text')?.textContent || `Terminal ${id.replace('term_', '#')}`,
          cmdCount: term.log?.length || 0,
          errorCount: term.log?.filter(l => l.status === 'error').length || 0,
          isMinimized: term.el?.classList.contains('minimized') || false,
          icon: term._gridIcon || 'terminal',
          isPinned: term._isPinned || false,
          term,
        });
      }
    }

    // Pinned terminals (not currently active)
    const pinned = this._getPinnedTerminals();
    for (const pin of pinned) {
      // Skip if already active
      if (cards.some(c => c.id === pin.id)) continue;
      cards.push({
        type: 'pinned',
        id: pin.id,
        name: pin.name,
        cmdCount: pin.log?.length || 0,
        errorCount: 0,
        isMinimized: true,
        icon: pin.icon || 'terminal',
        isPinned: true,
        pinData: pin,
      });
    }

    return cards;
  }

  _renderCard(card) {
    if (this.iconMode) {
      return `
        <div class="term-grid-card term-grid-card--icon ${card.isPinned ? 'pinned' : ''}"
             data-card-id="${card.id}" data-card-type="${card.type}">
          ${renderDotMatrixIcon(card.icon, 4, '#ffffff')}
          ${card.isPinned ? '<span class="term-grid-pin-badge">⊞</span>' : ''}
        </div>
      `;
    }

    const successRate = card.cmdCount > 0
      ? Math.round(((card.cmdCount - card.errorCount) / card.cmdCount) * 5)
      : 0;
    const dots = '●'.repeat(successRate) + '○'.repeat(5 - successRate);

    return `
      <div class="term-grid-card ${card.isPinned ? 'pinned' : ''} ${card.isMinimized ? 'minimized' : ''}"
           data-card-id="${card.id}" data-card-type="${card.type}">
        <div class="term-grid-card-name">${this._esc(card.name.substring(0, 16))}</div>
        <div class="term-grid-card-stats">${card.cmdCount} cmds</div>
        <div class="term-grid-card-dots">${dots}</div>
        ${card.isPinned ? '<span class="term-grid-pin-badge">⊞</span>' : ''}
      </div>
    `;
  }

  _renderNewCard() {
    return `
      <div class="term-grid-card term-grid-card--new" data-card-id="new">
        <div class="term-grid-card-new-icon">+</div>
      </div>
    `;
  }

  _wireCardEvents(menu) {
    menu.querySelectorAll('.term-grid-card').forEach(card => {
      const cardId = card.dataset.cardId;
      const cardType = card.dataset.cardType;

      // Left click: open/focus terminal
      card.addEventListener('click', (e) => {
        if (cardId === 'new') {
          this.closeGrid();
          if (window.terminalManager) window.terminalManager.create();
          this.updatePill();
          return;
        }

        if (cardType === 'pinned') {
          this._restorePinnedTerminal(cardId);
          this.closeGrid();
          return;
        }

        // Active terminal — unminimize and focus
        const tm = window.terminalManager;
        const term = tm?.terminals[cardId];
        if (term) {
          if (term.el?.classList.contains('minimized')) {
            this._genieMaximize(term, card);
          } else {
            term.focus();
          }
          this.closeGrid();
        }
      });

      // Right click: context menu
      if (cardId !== 'new') {
        card.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this._showContextMenu(e, cardId, cardType);
        });
      }

      // Hover: show preview tooltip
      if (cardId !== 'new') {
        card.addEventListener('mouseenter', (e) => {
          this._showHoverPreview(e, cardId, cardType);
        });
        card.addEventListener('mouseleave', () => {
          this._hideHoverPreview();
        });
      }
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // HOVER PREVIEW
  // ═════════════════════════════════════════════════════════════════════

  _showHoverPreview(e, cardId, cardType) {
    this._hideHoverPreview();

    let name = '', stats = '', cmds = [];
    const tm = window.terminalManager;
    const term = tm?.terminals[cardId];

    if (term) {
      name = term.el?.querySelector('.term-title-text')?.textContent || cardId;
      stats = `Commands: ${term.log?.length || 0} · Errors: ${term.log?.filter(l => l.status === 'error').length || 0}`;
      cmds = (term.log || []).slice(-8).map(l => ({
        icon: l.status === 'error' ? '✗' : '✓',
        cls: l.status === 'error' ? 'err' : 'ok',
        cmd: l.command?.substring(0, 35) || '',
      }));
    } else {
      const pin = this._getPinnedTerminals().find(p => p.id === cardId);
      if (pin) {
        name = pin.name;
        stats = `Commands: ${pin.history?.length || 0} · Pinned`;
        cmds = (pin.log || []).slice(-8).map(l => ({
          icon: l.status === 'error' ? '✗' : 'ok',
          cls: l.status === 'error' ? 'err' : 'ok',
          cmd: l.command?.substring(0, 35) || '',
        }));
      }
    }

    const preview = document.createElement('div');
    preview.className = 'term-grid-hover';
    preview.innerHTML = `
      <div class="term-grid-hover-name">${this._esc(name)}</div>
      <div class="term-grid-hover-stats">${stats}</div>
      <div class="term-grid-hover-cmds">
        ${cmds.map(c => `<div class="term-grid-hover-cmd"><span class="term-grid-hover-${c.cls}">${c.icon}</span> ${this._esc(c.cmd)}</div>`).join('')}
        ${!cmds.length ? '<div class="term-grid-hover-empty">No commands yet</div>' : ''}
      </div>
    `;

    // Position near the card
    const rect = e.currentTarget.getBoundingClientRect();
    preview.style.top = (rect.bottom + 8) + 'px';
    preview.style.left = Math.max(10, rect.left - 60) + 'px';

    document.body.appendChild(preview);
    this._hoverEl = preview;
    requestAnimationFrame(() => preview.classList.add('visible'));
  }

  _hideHoverPreview() {
    if (this._hoverEl) {
      this._hoverEl.remove();
      this._hoverEl = null;
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // CONTEXT MENU
  // ═════════════════════════════════════════════════════════════════════

  _showContextMenu(e, cardId, cardType) {
    this._hideContextMenu();

    const tm = window.terminalManager;
    const term = tm?.terminals[cardId];
    const isPinned = term?._isPinned || cardType === 'pinned';

    const menu = document.createElement('div');
    menu.className = 'term-grid-ctx';
    menu.innerHTML = `
      <div class="term-grid-ctx-item" data-action="open">Open</div>
      <div class="term-grid-ctx-sep"></div>
      <div class="term-grid-ctx-item" data-action="${isPinned ? 'unpin' : 'pin'}">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M6 1L7.5 4H10.5L8 6.5L9 10L6 8L3 10L4 6.5L1.5 4H4.5L6 1Z"/></svg>
        ${isPinned ? 'Unpin' : 'Pin terminal'}
      </div>
      <div class="term-grid-ctx-item" data-action="icon">
        Pick icon <span style="float:right;opacity:0.5">▸</span>
      </div>
      <div class="term-grid-ctx-item" data-action="rename">Rename</div>
      <div class="term-grid-ctx-sep"></div>
      <div class="term-grid-ctx-item" data-action="save-session">Save as session</div>
      <div class="term-grid-ctx-item" data-action="export-script">Export as script</div>
      <div class="term-grid-ctx-sep"></div>
      <div class="term-grid-ctx-item" data-action="close">Close</div>
      <div class="term-grid-ctx-item" data-action="close-others">Close all others</div>
      <div class="term-grid-ctx-sep"></div>
      <div class="term-grid-ctx-item" data-action="grid-cols">
        Grid: ${this.columns} columns <span style="float:right;opacity:0.5">▸</span>
      </div>
      <div class="term-grid-ctx-item" data-action="toggle-icons">
        Icon view: ${this.iconMode ? 'ON' : 'OFF'}
      </div>
    `;

    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    // Wire actions
    menu.querySelectorAll('.term-grid-ctx-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        this._handleContextAction(action, cardId, cardType);
        this._hideContextMenu();
      });
    });

    // Close on click outside
    const closer = (evt) => {
      if (!menu.contains(evt.target)) {
        this._hideContextMenu();
        document.removeEventListener('click', closer);
      }
    };
    setTimeout(() => document.addEventListener('click', closer), 0);

    document.body.appendChild(menu);
    this.contextMenuEl = menu;
  }

  _hideContextMenu() {
    this.contextMenuEl?.remove();
    this.contextMenuEl = null;
    // Also hide icon picker if open
    document.querySelector('.term-icon-picker')?.remove();
  }

  _handleContextAction(action, cardId, cardType) {
    const tm = window.terminalManager;
    const term = tm?.terminals[cardId];

    switch (action) {
      case 'open':
        if (term) { term.focus(); if (term.el?.classList.contains('minimized')) term.toggleMinimize(); }
        else this._restorePinnedTerminal(cardId);
        this.closeGrid();
        break;

      case 'pin':
        if (term) { term._isPinned = true; this._savePinnedTerminal(term); }
        this._rebuildGrid();
        break;

      case 'unpin':
        if (term) term._isPinned = false;
        this._removePinnedTerminal(cardId);
        this._rebuildGrid();
        break;

      case 'icon':
        this._showIconPicker(cardId);
        break;

      case 'rename': {
        const newName = prompt('Rename terminal:', term?.el?.querySelector('.term-title-text')?.textContent || '');
        if (newName && term) term._updateTitle(newName);
        this._rebuildGrid();
        break;
      }

      case 'save-session':
        if (term && window.terminalCarousel) {
          window.terminalCarousel.saveSession(
            term.el?.querySelector('.term-title-text')?.textContent || 'Terminal Session',
            { history: term.history, log: term.log }
          );
        }
        break;

      case 'export-script':
        if (term && window.arivuScriptStorage) {
          const name = term.el?.querySelector('.term-title-text')?.textContent || 'exported';
          const cmds = term.history.filter(cmd => {
            const first = cmd.trim().split(/\s+/)[0].toLowerCase();
            return !window.SCRIPT_META_COMMANDS?.has(first) && !cmd.startsWith('#');
          });
          if (cmds.length) window.arivuScriptStorage.save(name, cmds);
        }
        break;

      case 'close':
        if (term) term.close();
        else this._removePinnedTerminal(cardId);
        this.updatePill();
        this._rebuildGrid();
        break;

      case 'close-others':
        if (tm) {
          for (const [id, t] of Object.entries(tm.terminals)) {
            if (id !== cardId) t.close();
          }
        }
        this.updatePill();
        this._rebuildGrid();
        break;

      case 'grid-cols': {
        const options = [2, 3, 4, 5];
        const nextIdx = (options.indexOf(this.columns) + 1) % options.length;
        this.columns = options[nextIdx];
        localStorage.setItem('arivu_grid_columns', String(this.columns));
        this._rebuildGrid();
        break;
      }

      case 'toggle-icons':
        this.iconMode = !this.iconMode;
        localStorage.setItem('arivu_grid_icon_mode', String(this.iconMode));
        this._rebuildGrid();
        break;
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ICON PICKER
  // ═════════════════════════════════════════════════════════════════════

  _showIconPicker(cardId) {
    document.querySelector('.term-icon-picker')?.remove();

    const picker = document.createElement('div');
    picker.className = 'term-icon-picker';

    const icons = getIconNames();
    picker.innerHTML = `
      <div class="term-icon-picker-title">Pick Icon</div>
      <div class="term-icon-picker-grid">
        ${icons.map(name => `
          <div class="term-icon-picker-item" data-icon="${name}" title="${TERMINAL_ICONS[name].name}">
            ${renderDotMatrixIcon(name, 3, '#ffffff')}
          </div>
        `).join('')}
      </div>
    `;

    picker.querySelectorAll('.term-icon-picker-item').forEach(item => {
      item.addEventListener('click', () => {
        const iconName = item.dataset.icon;
        const tm = window.terminalManager;
        const term = tm?.terminals[cardId];
        if (term) term._gridIcon = iconName;
        // Update pinned data if pinned
        if (term?._isPinned) this._savePinnedTerminal(term);
        picker.remove();
        this._rebuildGrid();
      });
    });

    document.body.appendChild(picker);

    // Position near context menu
    if (this.contextMenuEl) {
      const rect = this.contextMenuEl.getBoundingClientRect();
      picker.style.left = (rect.right + 4) + 'px';
      picker.style.top = rect.top + 'px';
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // GENIE WARP ANIMATION
  // ═════════════════════════════════════════════════════════════════════

  /**
   * Minimize: terminal warps into grid card (genie effect).
   */
  genieMinimize(term) {
    if (!term?.el) return;

    // Ensure grid is briefly visible
    const wasOpen = this.isGridOpen;
    if (!wasOpen) this.openGrid();

    const termRect = term.el.getBoundingClientRect();

    // Apply warp animation
    term.el.style.transformOrigin = 'bottom center';
    term.el.classList.add('term-genie-minimize');

    setTimeout(() => {
      term.el.classList.remove('term-genie-minimize');
      term.el.classList.add('minimized');
      // Rebuild grid to show the minimized card
      this._rebuildGrid();
      // Close grid after brief delay if it wasn't open
      if (!wasOpen) {
        setTimeout(() => this.closeGrid(), 600);
      }
    }, 400);
  }

  /**
   * Maximize: terminal warps out from grid card (reverse genie).
   */
  _genieMaximize(term, cardEl) {
    if (!term?.el) return;

    term.el.classList.remove('minimized');
    term.el.classList.add('term-genie-maximize');

    setTimeout(() => {
      term.el.classList.remove('term-genie-maximize');
      term.focus();
    }, 400);
  }

  // ═════════════════════════════════════════════════════════════════════
  // PIN SYSTEM — localStorage persistence
  // ═════════════════════════════════════════════════════════════════════

  _getPinKey() {
    const graphId = window._arivuGraph?.metadata?.graph_id || 'default';
    return `arivu_pinned_terminals_${graphId}`;
  }

  _getPinnedTerminals() {
    try { return JSON.parse(localStorage.getItem(this._getPinKey()) || '[]'); }
    catch { return []; }
  }

  _getPinnedCount() {
    return this._getPinnedTerminals().filter(p => {
      // Don't count pinned terminals that are currently active
      const tm = window.terminalManager;
      return !tm?.terminals[p.id];
    }).length;
  }

  _getMinimizedIds() {
    const tm = window.terminalManager;
    if (!tm) return [];
    return Object.entries(tm.terminals)
      .filter(([, t]) => t.el?.classList.contains('minimized'))
      .map(([id]) => id);
  }

  _savePinnedTerminal(term) {
    const pins = this._getPinnedTerminals().filter(p => p.id !== term.id);
    pins.push({
      id: term.id,
      name: term.el?.querySelector('.term-title-text')?.textContent || term.id,
      icon: term._gridIcon || 'terminal',
      graphId: window._arivuGraph?.metadata?.graph_id || '',
      history: [...term.history],
      log: [...term.log],
      inputValue: term.inputEl?.value || '',
      outputHtml: term.outputEl?.innerHTML || '',
      scrollPosition: term.outputEl?.scrollTop || 0,
      linkedSessionId: term.linkedSessionId,
      pinnedAt: new Date().toISOString(),
    });
    try { localStorage.setItem(this._getPinKey(), JSON.stringify(pins)); } catch {}
  }

  _removePinnedTerminal(id) {
    const pins = this._getPinnedTerminals().filter(p => p.id !== id);
    try { localStorage.setItem(this._getPinKey(), JSON.stringify(pins)); } catch {}
  }

  _restorePinnedTerminal(pinId) {
    const pins = this._getPinnedTerminals();
    const pin = pins.find(p => p.id === pinId);
    if (!pin) return;

    const tm = window.terminalManager;
    if (!tm) return;

    const term = tm.create();
    term.id = pin.id; // Restore original ID
    term._gridIcon = pin.icon;
    term._isPinned = true;
    term.history = pin.history || [];
    term.log = pin.log || [];
    term.historyIndex = term.history.length;
    term.linkedSessionId = pin.linkedSessionId;
    term._updateTitle(pin.name);

    // Restore output HTML directly (no replay)
    if (pin.outputHtml) {
      term.outputEl.innerHTML = pin.outputHtml;
      term.outputEl.scrollTop = pin.scrollPosition || 0;
    }

    // Restore input value
    if (pin.inputValue) {
      term.inputEl.value = pin.inputValue;
      term._updateHighlight();
    }

    this.updatePill();
  }

  /**
   * Save all pinned terminals before leaving the graph.
   * Called on page unload or graph navigation.
   */
  savePinnedState() {
    const tm = window.terminalManager;
    if (!tm) return;

    for (const [id, term] of Object.entries(tm.terminals)) {
      if (term._isPinned) {
        this._savePinnedTerminal(term);
      }
    }
  }

  /**
   * Restore pinned terminals when returning to a graph.
   */
  restorePinnedState() {
    this.updatePill();
    // Pinned terminals appear in grid but don't auto-open
    // User clicks to restore them
  }

  // ═════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═════════════════════════════════════════════════════════════════════

  _rebuildGrid() {
    if (!this.isGridOpen) return;
    const wasOpen = true;
    this.closeGrid();
    setTimeout(() => { if (wasOpen) this.openGrid(); }, 50);
  }

  _attachGlobalEvents() {
    // Close grid on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isGridOpen) {
        this.closeGrid();
      }
    });

    // Save pinned state before page unload
    window.addEventListener('beforeunload', () => {
      this.savePinnedState();
    });
  }

  _esc(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// GLOBAL INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════

// Initialize after DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.terminalGrid = new TerminalGridManager();
  });
} else {
  window.terminalGrid = new TerminalGridManager();
}

// Also make SCRIPT_META_COMMANDS available globally for the grid's export
window.SCRIPT_META_COMMANDS = window.SCRIPT_META_COMMANDS || new Set([
  'save', 'load', 'sessions', 'help', 'history', 'export', 'clear',
  'exit', 'rename', 'delete', 'scripts', 'run', 'script', 'session',
]);
