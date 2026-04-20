/**
 * athena-layout.js -- Feature #007 Visual Redesign
 *
 * Manages Athena panel layout modes: Panel (380px sidebar), Split (50/50),
 * Full (graph minimized). Persists mode in sessionStorage. Handles toggle
 * open/close. Keyboard shortcut: Ctrl+Shift+A / Cmd+Shift+A.
 *
 * Per ATHENA_CLAUDE.md Part 6.1: class name is AthenaLayout.
 * Per ATHENA_PHASE_A.md Section 2.1.14: grid template updates.
 */

'use strict';

class AthenaLayout {
  constructor() {
    this.panel = document.getElementById('athena-panel');
    this.toggleBtn = document.getElementById('athena-toggle');
    this.toolLayout = document.querySelector('.tool-layout-v2') || document.querySelector('.tool-layout');

    // State from sessionStorage
    this.mode = sessionStorage.getItem('athena-mode') || 'panel';
    this.isOpen = sessionStorage.getItem('athena-open') === 'true';

    // Mode dropdown
    this.dropdown = null;
    this.dropdownVisible = false;

    this._init();
  }

  _init() {
    if (!this.panel || !this.toolLayout) return;

    // Toggle button
    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', () => this.toggle());
    }

    // Keyboard shortcut: Ctrl+Shift+A / Cmd+Shift+A
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        this.toggle();
      }
    });

    // Mode button in header
    const modeBtn = this.panel.querySelector('.athena-mode-btn');
    if (modeBtn) {
      modeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleDropdown();
      });
    }

    // Close dropdown on outside click
    document.addEventListener('click', () => this._hideDropdown());

    // Auto-open on first visit with loaded graph
    if (this.isOpen || this._isFirstVisitWithGraph()) {
      this._open(false); // false = no animation on initial load
    }

    // Apply mode
    this._applyMode();
  }

  toggle() {
    if (this.isOpen) {
      this._close();
    } else {
      this._open(true);
    }
  }

  _open(animate = true) {
    this.isOpen = true;
    sessionStorage.setItem('athena-open', 'true');

    this.panel.style.display = 'flex';
    if (animate) {
      this.panel.style.animation = 'panelSlideIn 300ms ease-out';
    }

    this._applyMode();

    if (this.toggleBtn) {
      this.toggleBtn.classList.add('active');
    }

    // Notify graph to resize
    window.dispatchEvent(new Event('resize'));

    // Dispatch event for other modules
    document.dispatchEvent(new CustomEvent('athena:open'));
  }

  _close() {
    this.isOpen = false;
    sessionStorage.setItem('athena-open', 'false');

    this.panel.style.display = 'none';

    // Remove athena layout classes
    this.toolLayout.classList.remove('athena-panel', 'athena-split', 'athena-full');

    if (this.toggleBtn) {
      this.toggleBtn.classList.remove('active');
    }

    // Notify graph to reclaim full width
    window.dispatchEvent(new Event('resize'));

    document.dispatchEvent(new CustomEvent('athena:close'));
  }

  setMode(mode) {
    if (!['panel', 'split', 'full'].includes(mode)) return;
    this.mode = mode;
    sessionStorage.setItem('athena-mode', mode);
    this._applyMode();

    // Resize graph after transition
    setTimeout(() => window.dispatchEvent(new Event('resize')), 350);
  }

  _applyMode() {
    if (!this.isOpen) return;

    // Remove all mode classes
    this.toolLayout.classList.remove('athena-panel', 'athena-split', 'athena-full');

    // Apply current mode class
    this.toolLayout.classList.add(`athena-${this.mode}`);

    // Update dropdown active states
    this._updateDropdownStates();
  }

  _toggleDropdown() {
    if (this.dropdownVisible) {
      this._hideDropdown();
    } else {
      this._showDropdown();
    }
  }

  _showDropdown() {
    if (!this.dropdown) {
      this._createDropdown();
    }
    this.dropdown.classList.add('visible');
    this.dropdownVisible = true;
  }

  _hideDropdown() {
    if (this.dropdown) {
      this.dropdown.classList.remove('visible');
    }
    this.dropdownVisible = false;
  }

  _createDropdown() {
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'athena-mode-dropdown';

    const modes = [
      { id: 'panel', label: 'Panel', desc: '380px sidebar' },
      { id: 'split', label: 'Split', desc: '50/50 view' },
      { id: 'full', label: 'Full', desc: 'Graph minimized' },
    ];

    modes.forEach(m => {
      const opt = document.createElement('div');
      opt.className = 'athena-mode-option' + (m.id === this.mode ? ' active' : '');
      opt.dataset.mode = m.id;
      opt.innerHTML = `<span class="mode-dot">${m.id === this.mode ? '●' : '○'}</span>${m.label}`;
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setMode(m.id);
        this._hideDropdown();
      });
      this.dropdown.appendChild(opt);
    });

    this.panel.appendChild(this.dropdown);
  }

  _updateDropdownStates() {
    if (!this.dropdown) return;
    this.dropdown.querySelectorAll('.athena-mode-option').forEach(opt => {
      const isActive = opt.dataset.mode === this.mode;
      opt.classList.toggle('active', isActive);
      opt.querySelector('.mode-dot').textContent = isActive ? '●' : '○';
    });
  }

  _isFirstVisitWithGraph() {
    // Auto-open if graph is loaded and user hasn't explicitly closed
    const hasGraph = window.arivuGraph?.graphId;
    const explicitlyClosed = sessionStorage.getItem('athena-open') === 'false';
    return hasGraph && !explicitlyClosed;
  }
}

// ── Panel Slide Animation ───────────────────────────────────────────────────
// CSS animation defined inline (also in athena-chat.css)
const panelAnim = document.createElement('style');
panelAnim.textContent = `
  @keyframes panelSlideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
`;
document.head.appendChild(panelAnim);

// ── Initialize ──────────────────────────────────────────────────────────────
// Wait for DOM ready, then create layout manager
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.athenaLayout = new AthenaLayout();
  });
} else {
  window.athenaLayout = new AthenaLayout();
}
