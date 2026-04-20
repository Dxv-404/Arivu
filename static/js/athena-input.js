/**
 * athena-input.js -- Feature #050 Rich Input Area
 *
 * Auto-expanding textarea with Send button, Shift+Enter for newlines,
 * Enter to send, character count (appears after 200 chars), placeholder text.
 * Dispatches 'athena:send' custom event for AthenaEngine to catch.
 *
 * Per ATHENA_CLAUDE.md Part 6.1: class name is AthenaInput.
 * Per ATHENA_PHASE_A.md Section 2.1.11: Input-to-Engine connection via events.
 * Per ATHENA_PHASE_A.md Section 2.1.7: Send button state machine.
 */

'use strict';

class AthenaInput {
  constructor() {
    this.inputArea = document.querySelector('.athena-input-area');
    if (!this.inputArea) return;

    this.MAX_LENGTH = 2000;
    this.state = 'IDLE'; // IDLE | SENDING | STREAMING | COMPLETE

    this._build();
    this._listen();
  }

  _build() {
    // Build the input UI inside .athena-input-area
    this.inputArea.innerHTML = `
      <div class="athena-context-chips" role="status" aria-live="polite"></div>
      <div class="athena-input-row">
        <div class="athena-input-wrapper">
          <textarea class="athena-textarea"
                    placeholder="Ask Athena about this research lineage..."
                    rows="1"
                    maxlength="${this.MAX_LENGTH}"
                    aria-label="Message Athena"></textarea>
          <span class="athena-char-count" style="display:none"></span>
        </div>
        <button class="athena-send-btn" disabled aria-label="Send message" title="Send">
          <svg class="athena-send-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/>
          </svg>
          <div class="athena-stop-icon" style="display:none"></div>
        </button>
      </div>
    `;

    this.textarea = this.inputArea.querySelector('.athena-textarea');
    this.sendBtn = this.inputArea.querySelector('.athena-send-btn');
    this.charCount = this.inputArea.querySelector('.athena-char-count');
    this.sendIcon = this.inputArea.querySelector('.athena-send-icon');
    this.stopIcon = this.inputArea.querySelector('.athena-stop-icon');
    this.chipBar = this.inputArea.querySelector('.athena-context-chips');
  }

  _listen() {
    // Auto-expand textarea
    this.textarea.addEventListener('input', () => {
      this._resize();
      this._updateCharCount();
      this._updateSendButton();
    });

    // Enter to send, Shift+Enter for newline
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });

    // Send button click
    this.sendBtn.addEventListener('click', () => {
      if (this.state === 'STREAMING') {
        this.stop();
      } else {
        this.send();
      }
    });

    // Listen for stream events to manage button state
    document.addEventListener('athena:stream-start', () => this._setState('STREAMING'));
    document.addEventListener('athena:stream-end', () => this._setState('IDLE'));
    document.addEventListener('athena:error', () => this._setState('IDLE'));

    // Phase C #105: Context chip events
    document.addEventListener('athena:context-chip-update', (e) => {
      this._renderContextChip(e.detail);
    });
    document.addEventListener('athena:click-context-cleared', () => {
      this._clearContextChips();
    });
    // Phase C #108: Prune chip cleared
    document.addEventListener('athena:prune-context-cleared', () => {
      this._clearContextChips();
    });
  }

  // ── Phase C #105: Context Chip Rendering ──────────────────────────────

  _renderContextChip(ctx) {
    if (!this.chipBar) return;
    this.chipBar.innerHTML = '';

    const chip = document.createElement('div');
    chip.className = 'athena-context-chip';

    // Dot-matrix style icon (SVG)
    const icon = document.createElement('span');
    icon.className = 'athena-chip-icon';

    if (ctx.type === 'node' && ctx.node) {
      chip.classList.add('athena-context-chip--node');
      chip.dataset.paperId = ctx.node.paper_id || '';
      icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="currentColor" opacity="0.7"/><circle cx="6" cy="6" r="2" fill="currentColor"/></svg>';
      const title = ctx.node.title || 'Unknown';
      const year = ctx.node.year ? ` (${ctx.node.year})` : '';
      const label = (title.length > 40 ? title.slice(0, 37) + '...' : title) + year;

      const labelEl = document.createElement('span');
      labelEl.className = 'athena-chip-label';
      labelEl.textContent = label;
      labelEl.title = title + year;

      chip.appendChild(icon);
      chip.appendChild(labelEl);

    } else if (ctx.type === 'edge' && ctx.edge) {
      chip.classList.add('athena-context-chip--edge');
      icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="3" cy="6" r="2" fill="currentColor" opacity="0.5"/><line x1="5" y1="6" x2="9" y2="6" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="6" r="2" fill="currentColor"/></svg>';
      const citing = ctx.edge.citing_title || 'Source';
      const cited = ctx.edge.cited_title || 'Target';
      const mut = ctx.edge.mutation_type || '';
      const shortCiting = citing.length > 20 ? citing.slice(0, 17) + '...' : citing;
      const shortCited = cited.length > 20 ? cited.slice(0, 17) + '...' : cited;
      const label = `${shortCiting} -> ${shortCited}${mut ? ` (${mut})` : ''}`;

      const labelEl = document.createElement('span');
      labelEl.className = 'athena-chip-label';
      labelEl.textContent = label;
      labelEl.title = `${citing} -> ${cited} (${mut})`;

      chip.appendChild(icon);
      chip.appendChild(labelEl);
    } else if (ctx.type === 'prune-start' && ctx.prune) {
      // Phase C #108: Prune starting — show loading chip
      chip.classList.add('athena-context-chip--prune');
      icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.6"/><line x1="4" y1="4" x2="8" y2="8" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="4" x2="4" y2="8" stroke="currentColor" stroke-width="1.5"/></svg>';
      const labelEl = document.createElement('span');
      labelEl.className = 'athena-chip-label';
      labelEl.textContent = `Pruning: ${ctx.prune.title || 'paper'}...`;
      chip.appendChild(icon);
      chip.appendChild(labelEl);

    } else if (ctx.type === 'prune' && ctx.prune) {
      // Phase C #108: Prune complete — show result chip
      chip.classList.add('athena-context-chip--prune');
      icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.5" fill="none"/><line x1="4" y1="4" x2="8" y2="8" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="4" x2="4" y2="8" stroke="currentColor" stroke-width="1.5"/></svg>';
      const p = ctx.prune;
      const title = p.pruned_paper_title || 'paper';
      const shortTitle = title.length > 25 ? title.slice(0, 22) + '...' : title;
      const pct = typeof p.impact_percentage === 'number' ? p.impact_percentage.toFixed(1) : '?';
      const count = p.collapsed_count || '?';
      const labelEl = document.createElement('span');
      labelEl.className = 'athena-chip-label';
      labelEl.textContent = `Pruned: ${shortTitle} - ${pct}% collapsed, ${count} removed`;
      labelEl.title = `Pruned: ${title} - ${pct}% collapsed, ${count} papers removed`;
      chip.appendChild(icon);
      chip.appendChild(labelEl);

    } else {
      return; // Unknown type
    }

    // Dismiss button
    const dismiss = document.createElement('button');
    dismiss.className = 'athena-chip-dismiss';
    dismiss.setAttribute('aria-label', 'Clear context');
    dismiss.innerHTML = '&times;';
    dismiss.addEventListener('click', (e) => {
      e.stopPropagation();
      // Dispatch appropriate clear event based on chip type
      if (ctx.type === 'prune' || ctx.type === 'prune-start') {
        document.dispatchEvent(new CustomEvent('athena:prune-context-cleared'));
      } else {
        document.dispatchEvent(new CustomEvent('athena:click-context-cleared'));
      }
    });
    chip.appendChild(dismiss);

    this.chipBar.appendChild(chip);
  }

  _clearContextChips() {
    if (this.chipBar) this.chipBar.innerHTML = '';
  }

  send() {
    if (this.state !== 'IDLE') return;

    const text = this.textarea.value.trim();
    if (!text) return;
    if (text.length > this.MAX_LENGTH) return;

    // Clear input
    this.textarea.value = '';
    this._resize();
    this._updateCharCount();
    this._updateSendButton();

    // Set sending state briefly
    this._setState('SENDING');

    // Dispatch event for AthenaEngine (Feature #037)
    document.dispatchEvent(new CustomEvent('athena:send', {
      detail: { message: text }
    }));
  }

  stop() {
    if (this.state !== 'STREAMING') return;

    // Dispatch stop event for AthenaEngine (Feature #041)
    document.dispatchEvent(new CustomEvent('athena:stop-generation'));
    this._setState('IDLE');
  }

  // Programmatic API for template prompts (Feature #123)
  setText(text) {
    this.textarea.value = text;
    this._resize();
    this._updateCharCount();
    this._updateSendButton();
    this.textarea.focus();
  }

  _resize() {
    const ta = this.textarea;
    ta.style.height = 'auto';
    const newHeight = Math.min(ta.scrollHeight, parseInt(getComputedStyle(ta).maxHeight));
    ta.style.height = newHeight + 'px';
  }

  _updateCharCount() {
    const len = this.textarea.value.length;
    if (len > 200) {
      this.charCount.style.display = 'block';
      this.charCount.textContent = `${len}/${this.MAX_LENGTH}`;
      this.charCount.classList.toggle('over-limit', len > this.MAX_LENGTH);
    } else {
      this.charCount.style.display = 'none';
    }
  }

  _updateSendButton() {
    const hasText = this.textarea.value.trim().length > 0;
    const withinLimit = this.textarea.value.length <= this.MAX_LENGTH;
    this.sendBtn.disabled = !hasText || !withinLimit || this.state === 'SENDING';
  }

  _setState(state) {
    this.state = state;

    switch (state) {
      case 'IDLE':
        this.sendBtn.disabled = !this.textarea.value.trim();
        this.sendBtn.classList.remove('stop-mode');
        this.sendBtn.setAttribute('aria-label', 'Send message');
        this.sendIcon.style.display = '';
        this.stopIcon.style.display = 'none';
        this.textarea.disabled = false;
        this.textarea.focus();
        break;

      case 'SENDING':
        this.sendBtn.disabled = true;
        this.sendBtn.setAttribute('aria-label', 'Sending...');
        this.textarea.disabled = true;
        // Safety: re-enable after 15s if stuck in SENDING state
        if (this._sendingSafety) clearTimeout(this._sendingSafety);
        this._sendingSafety = setTimeout(() => {
          if (this.state === 'SENDING') {
            console.warn('[AthenaInput] Stuck in SENDING state — forcing IDLE');
            this._setState('IDLE');
          }
        }, 15000);
        break;

      case 'STREAMING':
        this.sendBtn.disabled = false;
        this.sendBtn.classList.add('stop-mode');
        this.sendBtn.setAttribute('aria-label', 'Stop generating');
        this.sendIcon.style.display = 'none';
        this.stopIcon.style.display = '';
        this.textarea.disabled = false; // Allow typing next message
        break;
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.athenaInput = new AthenaInput();
  });
} else {
  window.athenaInput = new AthenaInput();
}
