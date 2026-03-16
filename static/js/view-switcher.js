/**
 * static/js/view-switcher.js
 * ViewSwitcher — manages switching between visualization modes.
 * Modes: force (default ArivuGraph), constellation, geological, river.
 * Renders a radio-button bar and instantiates the relevant view class.
 *
 * Dependencies: D3.js v7, ArivuGraph, ConstellationView, GeologicalView, RiverView
 *               (all loaded globally via script tags in base.html / tool.html)
 */

class ViewSwitcher {
  /**
   * @param {HTMLElement} controlContainer - Where to render the switcher UI
   * @param {HTMLElement} graphContainer - The main graph viewport element
   * @param {object} graphData - Full graph JSON (nodes, edges, metadata)
   */
  constructor(controlContainer, graphContainer, graphData) {
    this.controlContainer = controlContainer;
    this.graphContainer = graphContainer;
    this.graphData = graphData;
    this.currentMode = 'force';
    this.activeView = null;

    /** @type {Object<string, {label: string, description: string}>} */
    this.modes = {
      force:         { label: 'Force',         description: 'Default force-directed layout' },
      constellation: { label: 'Constellation', description: 'Papers as stars in deep space' },
      geological:    { label: 'Geological',    description: 'Horizontal strata by year' },
      river:         { label: 'River',         description: 'Papers flowing along a time river' },
    };

    this._render();
  }

  /** Build the radio-button switcher bar. */
  _render() {
    if (!this.controlContainer) return;
    this.controlContainer.innerHTML = '';

    const bar = document.createElement('div');
    bar.className = 'view-switcher-bar';
    bar.setAttribute('role', 'radiogroup');
    bar.setAttribute('aria-label', 'Visualization mode');
    bar.style.cssText = 'display:flex;gap:4px;padding:6px;background:var(--bg-surface);border-radius:8px;';

    Object.keys(this.modes).forEach(mode => {
      const btn = document.createElement('button');
      btn.className = 'view-switch-btn' + (mode === this.currentMode ? ' active' : '');
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', mode === this.currentMode ? 'true' : 'false');
      btn.setAttribute('aria-label', this.modes[mode].description);
      btn.dataset.mode = mode;
      btn.textContent = this.modes[mode].label;
      btn.style.cssText = `
        padding:6px 14px;border:none;border-radius:6px;cursor:pointer;
        font-size:12px;font-weight:500;font-family:Inter,sans-serif;
        transition:background 0.2s,color 0.2s;
        background:${mode === this.currentMode ? 'var(--accent-gold)' : 'transparent'};
        color:${mode === this.currentMode ? 'var(--bg-primary)' : 'var(--text-secondary)'};
      `;
      btn.addEventListener('click', () => this.switchTo(mode));
      bar.appendChild(btn);
    });

    this.controlContainer.appendChild(bar);
  }

  /**
   * Switch to a new visualization mode.
   * @param {string} mode - One of 'force', 'constellation', 'geological', 'river'
   */
  switchTo(mode) {
    if (!this.modes[mode] || mode === this.currentMode) return;

    // Destroy the current view
    this._destroyCurrent();

    this.currentMode = mode;
    this._updateButtons();

    // Clear the graph container for non-force views
    if (mode !== 'force') {
      this.graphContainer.innerHTML = '';
    }

    // Instantiate the new view
    switch (mode) {
      case 'force':
        this.activeView = new ArivuGraph(this.graphContainer, this.graphData);
        break;
      case 'constellation':
        this.activeView = new ConstellationView(this.graphContainer, this.graphData);
        this.activeView.render();
        break;
      case 'geological':
        this.activeView = new GeologicalView(this.graphContainer, this.graphData);
        this.activeView.render();
        break;
      case 'river':
        this.activeView = new RiverView(this.graphContainer, this.graphData);
        this.activeView.render();
        break;
    }

    window.dispatchEvent(new CustomEvent('arivu:view-changed', { detail: { mode } }));
  }

  /** Destroy the currently active view. */
  _destroyCurrent() {
    if (!this.activeView) return;
    if (typeof this.activeView.destroy === 'function') {
      this.activeView.destroy();
    }
    this.activeView = null;
    this.graphContainer.innerHTML = '';
  }

  /** Update button styles to reflect current selection. */
  _updateButtons() {
    const buttons = this.controlContainer.querySelectorAll('.view-switch-btn');
    buttons.forEach(btn => {
      const isActive = btn.dataset.mode === this.currentMode;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
      btn.style.background = isActive ? 'var(--accent-gold)' : 'transparent';
      btn.style.color = isActive ? 'var(--bg-primary)' : 'var(--text-secondary)';
    });
  }

  /**
   * Get the currently active view instance.
   * @returns {object|null}
   */
  getActiveView() {
    return this.activeView;
  }

  /**
   * Get the current mode name.
   * @returns {string}
   */
  getMode() {
    return this.currentMode;
  }

  /** Tear down all views and the switcher UI. */
  destroy() {
    this._destroyCurrent();
    if (this.controlContainer) this.controlContainer.innerHTML = '';
  }
}
