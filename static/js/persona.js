/**
 * static/js/persona.js
 * PersonaPanel — Shows 4 persona cards (Explorer, Critic, Innovator, Historian).
 * Clicking a card sets the active persona via POST /api/persona.
 * The selection persists visually until changed.
 *
 * Dependencies: none (vanilla JS)
 */

class PersonaPanel {
  /**
   * @param {string} containerId - ID of the DOM element to render into
   * @param {string} [activePersona='explorer'] - Currently active persona
   */
  constructor(containerId, activePersona) {
    this.container = document.getElementById(containerId);
    this.activePersona = activePersona || 'explorer';
    this._destroyed = false;

    /** @type {Array<{id: string, label: string, icon: string, description: string, color: string}>} */
    this.personas = [
      {
        id: 'explorer',
        label: 'Explorer',
        icon: '\uD83D\uDD2D',
        description: 'Discover connections and hidden patterns across the research landscape.',
        color: 'var(--accent-blue)',
      },
      {
        id: 'critic',
        label: 'Critic',
        icon: '\uD83D\uDD0D',
        description: 'Challenge assumptions, find weaknesses, and test robustness of claims.',
        color: 'var(--danger)',
      },
      {
        id: 'innovator',
        label: 'Innovator',
        icon: '\uD83D\uDCA1',
        description: 'Identify white space, novel combinations, and untested hypotheses.',
        color: 'var(--accent-gold)',
      },
      {
        id: 'historian',
        label: 'Historian',
        icon: '\uD83D\uDCDC',
        description: 'Trace the intellectual lineage and understand how ideas evolved over time.',
        color: 'var(--accent-teal)',
      },
    ];
  }

  /** Render the persona selection cards. */
  render() {
    if (!this.container || this._destroyed) return;
    this.container.innerHTML = '';

    var panel = document.createElement('div');
    panel.className = 'persona-panel';
    panel.setAttribute('role', 'radiogroup');
    panel.setAttribute('aria-label', 'Research persona');
    panel.style.cssText = 'padding:12px;';

    var heading = document.createElement('h3');
    heading.style.cssText = 'color:var(--text-primary);font-size:14px;font-weight:600;margin:0 0 10px 0;';
    heading.textContent = 'Research Persona';
    panel.appendChild(heading);

    var subtitle = document.createElement('p');
    subtitle.style.cssText = 'color:var(--text-muted);font-size:11px;margin:0 0 12px 0;';
    subtitle.textContent = 'Choose a lens to shape how Arivu presents insights.';
    panel.appendChild(subtitle);

    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';

    var self = this;
    this.personas.forEach(function(persona) {
      var card = document.createElement('button');
      card.className = 'persona-card';
      card.dataset.personaId = persona.id;
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', persona.id === self.activePersona ? 'true' : 'false');
      card.setAttribute('aria-label', persona.label + ' persona: ' + persona.description);

      var isActive = persona.id === self.activePersona;
      card.style.cssText = [
        'display:flex;flex-direction:column;align-items:center;gap:4px;',
        'padding:14px 10px;border-radius:8px;cursor:pointer;',
        'border:2px solid ' + (isActive ? persona.color : 'var(--bg-elevated)') + ';',
        'background:' + (isActive ? 'var(--bg-elevated)' : 'var(--bg-surface)') + ';',
        'transition:all 0.2s;text-align:center;',
      ].join('');

      card.innerHTML =
        '<span style="font-size:28px;" aria-hidden="true">' + persona.icon + '</span>' +
        '<span style="color:' + (isActive ? persona.color : 'var(--text-primary)') + ';font-size:13px;font-weight:600;">' + persona.label + '</span>' +
        '<span style="color:var(--text-muted);font-size:10px;line-height:1.3;">' + persona.description + '</span>';

      card.addEventListener('mouseenter', function() {
        if (persona.id !== self.activePersona) {
          card.style.borderColor = persona.color;
          card.style.background = 'var(--bg-elevated)';
        }
      });
      card.addEventListener('mouseleave', function() {
        if (persona.id !== self.activePersona) {
          card.style.borderColor = 'var(--bg-elevated)';
          card.style.background = 'var(--bg-surface)';
        }
      });
      card.addEventListener('click', function() { self._selectPersona(persona.id); });

      grid.appendChild(card);
    });

    panel.appendChild(grid);

    // Active persona indicator
    var indicator = document.createElement('div');
    indicator.id = 'persona-active-indicator';
    indicator.style.cssText = 'margin-top:10px;padding:8px;border-radius:6px;background:var(--bg-surface);text-align:center;';
    var activeDef = this._getPersonaDef(this.activePersona);
    indicator.innerHTML =
      '<span style="color:var(--text-muted);font-size:11px;">Active: </span>' +
      '<span style="color:' + activeDef.color + ';font-size:12px;font-weight:600;">' + activeDef.icon + ' ' + activeDef.label + '</span>';
    panel.appendChild(indicator);

    this.container.appendChild(panel);
  }

  /**
   * Select a persona and persist it via API.
   * @param {string} personaId - Persona to activate
   */
  async _selectPersona(personaId) {
    if (personaId === this.activePersona || this._destroyed) return;

    var previousPersona = this.activePersona;
    this.activePersona = personaId;
    this._updateCards();

    try {
      var resp = await fetch('/api/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: personaId }),
      });

      if (!resp.ok) {
        console.error('Failed to set persona:', resp.status);
        // Revert on failure
        this.activePersona = previousPersona;
        this._updateCards();
        return;
      }

      window.dispatchEvent(new CustomEvent('arivu:persona-changed', { detail: { persona: personaId } }));

    } catch (err) {
      console.error('Persona selection failed:', err);
      this.activePersona = previousPersona;
      this._updateCards();
    }
  }

  /** Update card visual states to match activePersona. */
  _updateCards() {
    var self = this;
    var cards = this.container.querySelectorAll('.persona-card');
    cards.forEach(function(card) {
      var id = card.dataset.personaId;
      var persona = self._getPersonaDef(id);
      var isActive = id === self.activePersona;
      card.setAttribute('aria-checked', isActive ? 'true' : 'false');
      card.style.borderColor = isActive ? persona.color : 'var(--bg-elevated)';
      card.style.background = isActive ? 'var(--bg-elevated)' : 'var(--bg-surface)';
      var label = card.querySelector('span:nth-child(2)');
      if (label) label.style.color = isActive ? persona.color : 'var(--text-primary)';
    });

    // Update indicator
    var indicator = document.getElementById('persona-active-indicator');
    if (indicator) {
      var activeDef = this._getPersonaDef(this.activePersona);
      indicator.innerHTML =
        '<span style="color:var(--text-muted);font-size:11px;">Active: </span>' +
        '<span style="color:' + activeDef.color + ';font-size:12px;font-weight:600;">' + activeDef.icon + ' ' + activeDef.label + '</span>';
    }
  }

  /**
   * Get persona definition by ID.
   * @param {string} id - Persona ID
   * @returns {object}
   */
  _getPersonaDef(id) {
    var found = this.personas.find(function(p) { return p.id === id; });
    return found || this.personas[0];
  }

  /** Tear down the panel. */
  destroy() {
    this._destroyed = true;
    if (this.container) this.container.innerHTML = '';
  }
}
