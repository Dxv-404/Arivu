/**
 * static/js/accessibility.js
 * Keyboard shortcuts modal and screen-reader accessible graph navigation.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch(e.key) {
      case 'f': case 'F':
        document.getElementById('paper-search')?.focus();
        e.preventDefault();
        break;
      case 'h': case 'H':
        toggleShortcutsModal();
        break;
      case 'l': case 'L':
        document.getElementById('leaderboard-toggle')?.click();
        break;
    }
  });

  // Shortcuts modal (create if not present)
  function toggleShortcutsModal() {
    let modal = document.getElementById('shortcuts-modal');
    if (!modal) {
      modal = document.createElement('dialog');
      modal.id = 'shortcuts-modal';
      modal.innerHTML = `
        <h2>Keyboard Shortcuts</h2>
        <table>
          <tr><td><kbd>Click node</kbd></td><td>Select for pruning</td></tr>
          <tr><td><kbd>Enter</kbd></td><td>Execute pruning</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>Reset / cancel</td></tr>
          <tr><td><kbd>F</kbd></td><td>Focus search</td></tr>
          <tr><td><kbd>H</kbd></td><td>This help panel</td></tr>
          <tr><td><kbd>L</kbd></td><td>Toggle leaderboard</td></tr>
          <tr><td><kbd>→</kbd> on node</td><td>Navigate to child</td></tr>
          <tr><td><kbd>←</kbd> on node</td><td>Navigate to parent</td></tr>
          <tr><td><kbd>Double-click</kbd></td><td>Open paper in new tab</td></tr>
        </table>
        <button onclick="document.getElementById('shortcuts-modal').close()">Close</button>
      `;
      modal.style.cssText = 'background:var(--bg-surface);color:var(--text-primary);border:1px solid var(--bg-elevated);border-radius:8px;padding:24px;max-width:420px';
      document.body.appendChild(modal);
    }
    modal.open ? modal.close() : modal.showModal();
  }

  // Tab panel switching in bottom bar
  document.querySelectorAll('[role="tab"]').forEach(tab => {
    tab.addEventListener('click', () => {
      const panelId = tab.getAttribute('aria-controls');
      document.querySelectorAll('[role="tab"]').forEach(t => t.setAttribute('aria-selected', 'false'));
      document.querySelectorAll('[role="tabpanel"]').forEach(p => { p.hidden = true; });
      tab.setAttribute('aria-selected', 'true');
      const panel = document.getElementById(panelId);
      if (panel) panel.hidden = false;
    });
  });

  // Animation toggle
  const animToggle = document.getElementById('disable-animations-toggle');
  if (animToggle) {
    const stored = localStorage.getItem('arivu-no-animations') === 'true';
    animToggle.checked = stored;
    if (stored) document.body.classList.add('no-animations');
    animToggle.addEventListener('change', (e) => {
      document.body.classList.toggle('no-animations', e.target.checked);
      localStorage.setItem('arivu-no-animations', e.target.checked);
    });
  }
});
