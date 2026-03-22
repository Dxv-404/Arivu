/**
 * static/js/window-manager.js
 * WindowManager — OS-style draggable, resizable windows with z-ordering.
 * Supports: graph (YouTube miniplayer), DNA, diversity, orphans+coverage windows.
 * Each window type can contain AI interpretations, "Read more" transitions, and "Discuss" overlays.
 */

class WindowManager {
  constructor() {
    this.windows = new Map(); // id -> { el, type, state }
    this._maxZ = 1000;
    this._cascadeOffset = 0;
    this._graphOriginalParent = null; // For YouTube miniplayer pattern
    this._init();
  }

  _init() {
    // Listen for window icon clicks
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.window-icon-btn');
      if (!btn) return;
      const windowType = btn.dataset.window;
      if (windowType) this.openWindow(windowType);
    });
  }

  openWindow(type) {
    // If this window type already exists, bring to front (but not if closing)
    const existing = this.windows.get(type);
    if (existing) {
      if (existing.state === 'closing') return; // Prevent re-open during close animation
      this._bringToFront(type);
      return;
    }

    const windowEl = this._createWindowElement(type);
    document.body.appendChild(windowEl);

    // Position with cascading offset
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const sizes = this._getDefaultSize(type);
    const left = Math.min(Math.max(20, (vw - sizes.width) / 2 + this._cascadeOffset), vw - sizes.width - 20);
    const top = Math.min(Math.max(20, (vh - sizes.height) / 2 + this._cascadeOffset), vh - sizes.height - 20);

    windowEl.style.width = sizes.width + 'px';
    windowEl.style.height = sizes.height + 'px';
    windowEl.style.left = left + 'px';
    windowEl.style.top = top + 'px';
    windowEl.style.zIndex = ++this._maxZ;

    this._cascadeOffset = (this._cascadeOffset + 30) % 150;

    this.windows.set(type, { el: windowEl, type, state: 'normal', charts: [] });

    // Setup drag and resize
    this._setupDrag(windowEl, type);
    this._setupResize(windowEl, type);

    // Click to bring to front
    windowEl.addEventListener('mousedown', () => this._bringToFront(type));

    // Populate content based on type
    // For pathfinder: run portal animation FIRST, then show window AFTER
    if (type === 'pathfinder') {
      // Hide window initially (will be shown after portal animation)
      windowEl.style.opacity = '0';
      windowEl.style.transform = 'scale(0.95)';
      windowEl.style.visibility = 'hidden';

      // Run portal animation (takes ~3500ms)
      this._portalCharacterToWindow();

      // Populate content while hidden (so it's ready when revealed)
      this._populateWindow(type, windowEl);

      // Show window AFTER portal animation completes
      setTimeout(() => {
        windowEl.style.visibility = 'visible';
        windowEl.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        windowEl.style.opacity = '1';
        windowEl.style.transform = 'scale(1)';

        // Character greeting 500ms after window appears
        const pf = window.PathfinderSystem;
        if (pf?.character) {
          const tripCount = window._portalTripCount || 0;
          let greeting;
          if (tripCount <= 1) {
            const first = [
              "Here I am! Bet the donut chart can't do that.",
              "*emerges from portal* ...I might vomit. Worth it.",
              "Didn't expect that, did you? Portal travel.",
              "Made it! What are you working on?",
            ];
            greeting = first[Math.floor(Math.random() * first.length)];
          } else if (tripCount <= 3) {
            const repeat = [
              "Back again? I'm starting to charge for portal trips.",
              "The portal fees are adding up. This better be important.",
              "I don't get paid enough to portal travel for a 144p 'researcher'.",
            ];
            greeting = repeat[Math.floor(Math.random() * repeat.length)];
          } else {
            const frequent = [
              "How long do I have to keep doing this?",
              "You know there's a version of me that's just a static icon, right?",
              "Portal. Window. Questions. Portal. Window. Questions. My life.",
              "At this point the portal knows my name.",
            ];
            greeting = frequent[Math.floor(Math.random() * frequent.length)];
          }
          setTimeout(() => pf.character.say(greeting, 4000), 500);
        }
      }, 3600); // 3500ms animation + 100ms buffer

      // Track portal trips
      window._portalTripCount = (window._portalTripCount || 0) + 1;

    } else {
      // Non-pathfinder windows: normal behavior
      this._populateWindow(type, windowEl);

      // Animate in
      windowEl.style.opacity = '0';
      windowEl.style.transform = 'scale(0.95)';
      requestAnimationFrame(() => {
        windowEl.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        windowEl.style.opacity = '1';
        windowEl.style.transform = 'scale(1)';
      });
    }
  }

  closeWindow(type) {
    const win = this.windows.get(type);
    if (!win || win.state === 'closing') return;
    win.state = 'closing';

    // Destroy any Chart.js instances in this window
    if (win.charts) {
      win.charts.forEach(c => { try { c.destroy(); } catch(e) {} });
      win.charts = [];
    }

    // If graph window, return SVG to main page
    if (type === 'graph') {
      this._returnGraphToMain();
    }

    // If pathfinder window, portal character back to compact view
    if (type === 'pathfinder') {
      this._portalCharacterBack();
      // Destroy and null the window character to prevent stale references
      if (window._pathfinderCharacter?.destroy) {
        window._pathfinderCharacter.destroy();
      }
      window._pathfinderCharacter = null;
      // Also close the output window if it exists
      const pf = window.PathfinderSystem;
      if (pf?._scrollObserver) { pf._scrollObserver.disconnect(); pf._scrollObserver = null; }
      if (pf) { pf._stopWindowPersonality(); pf.character = null; }
      if (pf?.outputWindow) {
        pf.outputWindow.remove();
        pf.outputWindow = null;
      }
      if (pf?.chain) {
        pf.chain.destroy();
        pf.chain = null;
      }
      // Clean up move-together listeners to prevent accumulation
      if (pf?._moveMouseupHandler) {
        document.removeEventListener('mouseup', pf._moveMouseupHandler);
        pf._moveMouseupHandler = null;
      }
      if (pf?._moveDragHandler && pf?.researcherWindow) {
        pf.researcherWindow.removeEventListener('arivu:window-drag', pf._moveDragHandler);
        pf._moveDragHandler = null;
      }
      if (pf) pf.researcherWindow = null;
    }

    // Animate out
    win.el.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
    win.el.style.opacity = '0';
    win.el.style.transform = 'scale(0.95)';

    setTimeout(() => {
      win.el.remove();
      this.windows.delete(type);
    }, 150);
  }

  _getDefaultSize(type) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (type === 'graph') {
      return { width: Math.min(vw * 0.8, 1200), height: Math.min(vh * 0.85, 900) };
    }
    return { width: Math.min(vw * 0.5, 700), height: Math.min(vh * 0.6, 600) };
  }

  _getTitle(type) {
    const titles = {
      graph: 'LINEAGE GRAPH',
      dna: 'RESEARCH DNA',
      diversity: 'INTELLECTUAL DIVERSITY',
      'orphans-coverage': 'ORPHAN IDEAS & DATA COVERAGE',
      'graph-breakdown': 'LINEAGE GRAPH BREAKDOWN',
      'pruning-detail': 'PRUNING IMPACT',
      'architects': 'ARCHITECTS',
      'momentum': 'MOMENTUM TRACKER',
      'idea-flow': 'IDEA FLOW',
      'blindspots': 'BLIND SPOTS & BATTLES',
      'pathfinder': 'PATHFINDER',
    };
    return titles[type] || type.toUpperCase();
  }

  _createWindowElement(type) {
    const el = document.createElement('div');
    el.className = 'arivu-window';
    el.dataset.windowType = type;
    el.setAttribute('role', 'dialog');

    const titleId = `window-title-${type}-${Date.now()}`;
    el.setAttribute('aria-labelledby', titleId);

    el.innerHTML = `
      <div class="arivu-window-titlebar">
        <h3 id="${titleId}">${this._getTitle(type)}</h3>
        <button class="arivu-window-close" aria-label="Close window">&times;</button>
      </div>
      <div class="arivu-window-body"></div>
      <div class="arivu-window-resize arivu-window-resize-se"></div>
      <div class="arivu-window-resize arivu-window-resize-e"></div>
      <div class="arivu-window-resize arivu-window-resize-s"></div>
    `;

    // Close button
    el.querySelector('.arivu-window-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeWindow(type);
    });

    return el;
  }

  _bringToFront(type) {
    const win = this.windows.get(type);
    if (!win) return;
    win.el.style.zIndex = ++this._maxZ;
  }

  // ═══════ DRAG ═══════

  _setupDrag(windowEl, type) {
    const titlebar = windowEl.querySelector('.arivu-window-titlebar');

    titlebar.addEventListener('mousedown', (e) => {
      if (e.target.closest('.arivu-window-close')) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const origLeft = windowEl.offsetLeft;
      const origTop = windowEl.offsetTop;
      windowEl.style.transition = 'none';
      document.body.style.cursor = 'move';
      document.body.style.userSelect = 'none';
      e.preventDefault();

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        // Clamp to keep at least 40px of title bar visible on all edges
        const newLeft = Math.min(Math.max(0, origLeft + dx), window.innerWidth - 100);
        const newTop = Math.min(Math.max(0, origTop + dy), window.innerHeight - 40);
        windowEl.style.left = newLeft + 'px';
        windowEl.style.top = newTop + 'px';
        // Dispatch drag event for chain tracking
        windowEl.dispatchEvent(new CustomEvent('arivu:window-drag', {
          detail: { dx: ev.clientX - startX, dy: ev.clientY - startY }
        }));
      };

      const onUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ═══════ RESIZE ═══════

  _setupResize(windowEl, type) {
    const handles = windowEl.querySelectorAll('.arivu-window-resize');

    handles.forEach(handle => {
      let isResizing = false;
      let startX, startY, origW, origH;

      handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        origW = windowEl.offsetWidth;
        origH = windowEl.offsetHeight;
        windowEl.style.transition = 'none';
        document.body.style.userSelect = 'none';
        e.preventDefault();
        e.stopPropagation();

        const onMove = (ev) => {
          if (!isResizing) return;
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;

          if (handle.classList.contains('arivu-window-resize-se') ||
              handle.classList.contains('arivu-window-resize-e')) {
            windowEl.style.width = Math.max(400, origW + dx) + 'px';
          }
          if (handle.classList.contains('arivu-window-resize-se') ||
              handle.classList.contains('arivu-window-resize-s')) {
            windowEl.style.height = Math.max(300, origH + dy) + 'px';
          }
        };

        const onUp = () => {
          isResizing = false;
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  // ═══════ POPULATE WINDOW CONTENT ═══════

  _populateWindow(type, windowEl) {
    const body = windowEl.querySelector('.arivu-window-body');

    switch (type) {
      case 'graph':
        this._populateGraphWindow(body, windowEl);
        break;
      case 'dna':
        this._populateDNAWindow(body);
        break;
      case 'diversity':
        this._populateDiversityWindow(body);
        break;
      case 'orphans-coverage':
        this._populateOrphansWindow(body);
        break;
      case 'graph-breakdown':
        this._populateBreakdownWindow(body, 'graph');
        break;
      case 'pruning-detail':
        this._populatePruningDetailWindow(body);
        break;
      case 'architects':
        if (window.ArchitectsWindow) window.ArchitectsWindow.populate(body);
        break;
      case 'momentum':
        if (window.MomentumWindow) window.MomentumWindow.populate(body);
        break;
      case 'idea-flow':
        if (window.IdeaFlowWindow) window.IdeaFlowWindow.populate(body);
        break;
      case 'blindspots':
        if (window.BlindspotWindow) window.BlindspotWindow.populate(body);
        break;
      case 'trust-evidence':
        if (window.TrustEvidenceWindow) window.TrustEvidenceWindow.populate(body);
        break;
      case 'pathfinder':
        this._populatePathfinder(body);
        break;
    }
  }

  _populatePathfinder(body) {
    const pf = window.PathfinderSystem;
    const hasPrompts = pf && pf.prompts.length > 0;

    body.innerHTML = `
      <div style="padding:20px;">
        <div id="pf-energy-counter" style="position:absolute;top:8px;right:40px;">${pf ? pf.energy.renderCounter() : ''}</div>

        <div id="pf-intro-section" style="${hasPrompts ? 'display:none;' : ''}">
          <div style="display:flex;gap:16px;align-items:flex-start;padding:12px;background:#F9FAFB;border-radius:10px;margin-bottom:16px;">
            <div id="pathfinder-char-container" style="flex:0 0 140px;"></div>
            <div style="flex:1;">
              <p style="margin:0;font:14px/1.5 'Inter',sans-serif;color:#374151;" id="pf-char-bubble-text">Here I am! What are you working on? Type your research topic or paste your abstract and I'll find your place in this lineage.</p>
            </div>
          </div>
        </div>

        <div id="pf-explore-section" style="${hasPrompts ? '' : 'display:none;'}">
          <p style="font:600 11px 'JetBrains Mono',monospace;letter-spacing:0.1em;color:#6B7280;margin:0 0 8px;">EXPLORE MORE</p>
          <div style="display:flex;gap:12px;">
            <div id="pf-char-sidebar" style="flex:0 0 100px;"></div>
            <div style="flex:1;">
              <div id="pf-prompt-list" style="max-height:250px;overflow-y:auto;margin-bottom:8px;"></div>
              <div style="display:flex;gap:8px;align-items:flex-end;">
                <textarea id="pf-input" rows="2" placeholder="Type your new prompt here..."
                  style="flex:1;padding:8px 12px;border:1px solid #D1D5DB;border-radius:6px;font:13px 'JetBrains Mono',monospace;color:#374151;background:#FAFAFA;resize:none;outline:none;"></textarea>
                <button id="pf-submit-btn" style="padding:8px 16px;background:#374151;color:white;border:none;border-radius:6px;font:600 11px 'JetBrains Mono',monospace;cursor:pointer;white-space:nowrap;letter-spacing:0.05em;">
                  Analyze →
                </button>
              </div>
            </div>
          </div>
        </div>

        <div id="pf-initial-input" style="${hasPrompts ? 'display:none;' : ''}">
          <p style="font:600 12px 'JetBrains Mono',monospace;color:#374151;margin:0 0 6px;">WHAT ARE YOU WORKING ON?</p>
          <textarea id="pf-input-initial" rows="3" placeholder="Describe your research topic or paste your abstract..."
            style="width:100%;padding:10px 12px;border:1px solid #D1D5DB;border-radius:8px;font:13px 'JetBrains Mono',monospace;color:#374151;background:#FAFAFA;resize:vertical;outline:none;"></textarea>
          <p style="font:11px 'JetBrains Mono',monospace;color:#9CA3AF;margin:4px 0 12px;">Or paste your abstract for deeper analysis</p>
          <button id="pf-submit-initial" style="display:block;margin:0 auto;padding:8px 20px;background:#374151;color:white;border:none;border-radius:6px;font:600 12px 'JetBrains Mono',monospace;cursor:pointer;letter-spacing:0.05em;">
            Find my place →
          </button>
        </div>

      </div>
    `;

    // Store window reference for PathfinderSystem
    const windowEl = body.closest('.arivu-window');
    if (pf) {
      pf.researcherWindow = windowEl;
    }

    // Destroy previous character instance to prevent memory leaks
    if (window._pathfinderCharacter?.destroy) {
      window._pathfinderCharacter.destroy();
      window._pathfinderCharacter = null;
    }

    // Create character: intro mode (no prompts) OR sidebar mode (has prompts)
    if (!hasPrompts) {
      // Intro character with grow animation
      const charContainer = body.querySelector('#pathfinder-char-container');
      if (charContainer && window.ResearcherCharacter) {
        charContainer.style.transform = 'scale(0)';
        charContainer.style.opacity = '0';
        charContainer.style.transition = 'transform 0.4s cubic-bezier(.34,1.56,.64,1), opacity 0.3s ease-out';

        const windowChar = new ResearcherCharacter(charContainer, { scale: 0.5 });
        window._pathfinderCharacter = windowChar;
        // Disable sleep on window character (they never sleep in the window)
        if (windowChar.idleTimer) clearTimeout(windowChar.idleTimer);
        windowChar._resetIdle = function() {}; // no-op: no sleep in window
        windowChar._stopPersonalityEngine(); // stop compact personality
        if (pf) {
          pf.character = windowChar;
          pf._startWindowPersonality();
        }

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            charContainer.style.transform = 'scale(1)';
            charContainer.style.opacity = '1';
          });
        });

        setTimeout(() => {
          windowChar.say("Here I am! What are you working on?", 4000);
        }, 800);
      }
    } else {
      // Sidebar character for explore mode (skip intro character entirely)
      const sidebarChar = body.querySelector('#pf-char-sidebar');
      if (sidebarChar && window.ResearcherCharacter) {
        const sideChar = new ResearcherCharacter(sidebarChar, { scale: 0.35 });
        window._pathfinderCharacter = sideChar;
        if (sideChar.idleTimer) clearTimeout(sideChar.idleTimer);
        sideChar._resetIdle = function() {};
        sideChar._stopPersonalityEngine();
        if (pf) {
          pf.character = sideChar;
          pf._startWindowPersonality();
        }
      }
    }

    // Render existing prompts if any (but do NOT auto-open output window)
    if (hasPrompts && pf) {
      pf._renderPromptList();
      // Output window only opens when user clicks a prompt or types a new one
    }

    // Load prompt history from DB if no prompts in memory (page reload case)
    if (!hasPrompts && pf && pf._initialized) {
      const graphId = pf.graphData?.metadata?.graph_id || pf._getGraphData()?.metadata?.graph_id;
      if (graphId) {
        fetch(`/api/graph/${encodeURIComponent(graphId)}/pathfinder-history`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.prompts?.length) {
              pf.prompts = data.prompts.map(p => {
                let output = p.output || p.output_json || {};
                if (typeof output === 'string') try { output = JSON.parse(output); } catch(e) { output = {}; }
                return {
                  id: p.id,
                  prompt: p.prompt,
                  type: p.type || p.prompt_type || 'unknown',
                  output: output,
                  classification: p.classification,
                  active: false,
                  createdAt: new Date(p.createdAt || p.created_at)
                };
              });
              // Activate most recent
              pf.prompts[pf.prompts.length - 1].active = true;
              pf.activePromptIndex = pf.prompts.length - 1;
              // Update energy
              const llmPrompts = pf.prompts.filter(p => p.type !== 'instant');
              pf.energy.used = llmPrompts.length;
              pf._updateEnergyDisplay();
              // Switch to explore layout
              const introSection = body.querySelector('#pf-intro-section');
              const initialInput = body.querySelector('#pf-initial-input');
              const exploreSection = body.querySelector('#pf-explore-section');
              if (introSection) introSection.style.display = 'none';
              if (initialInput) initialInput.style.display = 'none';
              if (exploreSection) {
                exploreSection.style.display = '';
                const sidebarChar = body.querySelector('#pf-char-sidebar');
                if (sidebarChar && !sidebarChar.children.length && window.ResearcherCharacter) {
                  const sideChar = new ResearcherCharacter(sidebarChar, { scale: 0.35 });
                  window._pathfinderCharacter = sideChar;
                  pf.character = sideChar;
                }
              }
              pf._renderPromptList();
              // Do NOT auto-open output window — user clicks a prompt to see it
              // Character welcome back
              setTimeout(() => {
                pf._characterSay('Welcome back! You had ' + pf.prompts.length + ' questions.', 'waving');
              }, 4500);
            }
          })
          .catch(() => { /* silent */ });
      }
    }

    // Submit handlers
    const handleSubmit = (inputEl) => {
      const text = inputEl.value.trim();
      if (!text) return;

      // Transition from intro to explore mode
      const introSection = body.querySelector('#pf-intro-section');
      const initialInput = body.querySelector('#pf-initial-input');
      const exploreSection = body.querySelector('#pf-explore-section');

      if (introSection) introSection.style.display = 'none';
      if (initialInput) initialInput.style.display = 'none';
      if (exploreSection) {
        exploreSection.style.display = '';
        // Create sidebar character if not exists
        const sidebarChar = body.querySelector('#pf-char-sidebar');
        if (sidebarChar && !sidebarChar.children.length && window.ResearcherCharacter) {
          const sideChar = new ResearcherCharacter(sidebarChar, { scale: 0.35 });
          window._pathfinderCharacter = sideChar;
          if (pf) pf.character = sideChar;
        }
      }

      inputEl.value = '';

      // Submit via PathfinderSystem
      if (pf) {
        pf.submit(text);
      }
    };

    // Initial submit
    const initialSubmit = body.querySelector('#pf-submit-initial');
    const initialInput = body.querySelector('#pf-input-initial');
    if (initialSubmit && initialInput) {
      initialSubmit.addEventListener('click', () => handleSubmit(initialInput));
      initialInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(initialInput); } });
    }

    // Explore submit
    const exploreSubmit = body.querySelector('#pf-submit-btn');
    const exploreInput = body.querySelector('#pf-input');
    if (exploreSubmit && exploreInput) {
      exploreSubmit.addEventListener('click', () => handleSubmit(exploreInput));
      exploreInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(exploreInput); } });
    }

    // Typing reactions: character reacts when user types in the input
    const allInputs = [initialInput, exploreInput].filter(Boolean);
    let typingReactionTimeout = null;
    allInputs.forEach(inp => {
      inp.addEventListener('focus', () => {
        if (pf?.character) {
          pf._resetWindowIdle();
          pf.character._goTo('reading_up', 300);
          pf.character.say("Tell me more...", 2000);
        }
      });
      inp.addEventListener('input', () => {
        if (pf?.character && inp.value.length > 10) {
          pf._resetWindowIdle();
          pf.character._goTo('analyzing', 400);
          // Debounced "Interesting..." after 2s pause
          if (typingReactionTimeout) clearTimeout(typingReactionTimeout);
          typingReactionTimeout = setTimeout(() => {
            if (inp.value.length > 10 && pf?.character) {
              const lines = ["Interesting...", "Go on...", "I'm listening.", "Take your time."];
              pf.character.say(lines[Math.floor(Math.random() * lines.length)], 2000);
            }
          }, 2000);
        }
      });
    });

    // Update energy counter
    if (pf) pf._updateEnergyDisplay();

    // Cross-paper note: show if user has prompts on other papers
    if (pf && pf._initialized) {
      const graphId = pf.graphData?.metadata?.graph_id || pf._getGraphData()?.metadata?.graph_id;
      const noteKey = 'pathfinder_cross_note_shown_' + (graphId || '');
      if (graphId && !sessionStorage.getItem(noteKey)) {
        fetch('/api/pathfinder/cross-paper-summary?session_id=' + encodeURIComponent(document.cookie.match(/arivu_session=([^;]*)/)?.[1] || 'anon') + '&exclude_graph=' + encodeURIComponent(graphId))
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.papers?.length) {
              const noteHtml = '<div class="pf-cross-paper-note" style="padding:10px 14px;background:#F0FDF4;border:1px solid #86EFAC;border-radius:6px;margin-bottom:12px;font:12px \'JetBrains Mono\',monospace;color:#166534;position:relative;">'
                + '<button class="pf-cross-note-close" style="position:absolute;top:4px;right:8px;background:none;border:none;font-size:14px;color:#166534;cursor:pointer;">x</button>'
                + '<p style="margin:0 0 4px;font-weight:600;">You have analyses from other papers:</p>'
                + '<ul style="margin:4px 0 0;padding-left:16px;">' + data.papers.map(p => '<li>' + (p.title || 'Unknown') + ' (' + p.promptCount + ' prompts)</li>').join('') + '</ul>'
                + '<p style="margin:4px 0 0;color:#6B7280;font-size:11px;">Switch to those papers to view them.</p>'
                + '</div>';
              body.querySelector('#pf-intro-section, #pf-explore-section')?.insertAdjacentHTML('beforebegin', noteHtml);
              body.querySelector('.pf-cross-note-close')?.addEventListener('click', function() {
                this.closest('.pf-cross-paper-note')?.remove();
                sessionStorage.setItem(noteKey, '1');
              });
            }
          })
          .catch(() => {});
      }
    }

    // Portal animation is triggered in openWindow(), not here (avoid double call)
  }

  /** Portal: character leaves compact view via overlay animation */
  _portalCharacterToWindow() {
    const compactCharContainer = document.querySelector('[data-dot-view="3"] .pf-char-compact-container');
    const goneSign = document.querySelector('.pf-gone-sign');
    const compactChar = window._compactResearcherCharacter;

    // Stop compact character immediately
    if (compactChar) {
      compactChar._setZzz(false);
      compactChar._hideBub();
      compactChar.running = false;
      compactChar.state = 'sitting';
    }

    // Hide ZZZ and hints
    const parentWrap = compactCharContainer?.closest('.researcher-char-wrap');
    if (parentWrap) {
      parentWrap.querySelectorAll('.zzz').forEach(z => z.style.display = 'none');
      parentWrap.querySelectorAll('.hint, .meter').forEach(h => h.style.display = 'none');
    }

    // Create overlay window ON TOP of the panel card
    const panelCard = document.querySelector('#dna-section');
    if (!panelCard || !window.ResearcherCharacter || !window.RESEARCHER_SPRITES) {
      // Fallback: just hide compact character immediately
      if (compactCharContainer) {
        compactCharContainer.style.transform = 'scale(0)';
        compactCharContainer.style.opacity = '0';
      }
      this._showGoneSign(goneSign);
      return;
    }

    const panelRect = panelCard.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.className = 'pf-portal-overlay';
    overlay.style.cssText = `
      position:fixed; z-index:2000;
      left:${panelRect.left}px; top:${panelRect.top}px;
      width:${panelRect.width}px; height:${panelRect.height}px;
      background:white; border-radius:10px;
      box-shadow:0 4px 20px rgba(0,0,0,0.15);
      overflow:hidden; display:flex; align-items:center; justify-content:center;
      opacity:0; transition:opacity 0.2s;
    `;

    const charDiv = document.createElement('div');
    charDiv.style.cssText = 'position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;';
    overlay.appendChild(charDiv);

    document.body.appendChild(overlay);

    // Hide compact character under the overlay
    if (compactCharContainer) {
      compactCharContainer.style.transform = 'scale(0)';
      compactCharContainer.style.opacity = '0';
    }

    // Create overlay character at larger scale
    const overlayChar = new ResearcherCharacter(charDiv, { scale: 0.55 });
    // Start in whatever state the compact character was in
    const startPose = compactChar?.curP || 'typing';
    overlayChar._goTo(startPose, 0);

    // Fade in overlay
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });

    // Portal line
    overlayChar.say("Time to lock in!", 2000);

    // Animation sequence — increased gaps for smooth transitions
    const seq = [
      { pose: 'gettingup_seated', delay: 600, dur: 500 },
      { pose: 'gotup_seated', delay: 1200, dur: 500 },
      { pose: 'walking_chair', delay: 1800, dur: 500 },
      { pose: 'walking_chair_away', delay: 2400, dur: 500 },
    ];

    seq.forEach(step => {
      setTimeout(() => {
        if (overlay.parentNode) overlayChar._goTo(step.pose, step.dur);
      }, step.delay);
    });

    // Show portal on the right side at 2600ms (after walking_chair_away starts)
    setTimeout(() => {
      if (!overlay.parentNode) return;
      const portalImg = document.createElement('img');
      portalImg.src = window.RESEARCHER_SPRITES?.portal_static || '';
      portalImg.style.cssText = `
        position:absolute; right:10px; top:50%; transform:translateY(-50%) scale(0);
        width:120px; height:auto; opacity:0;
        transition:transform 0.4s cubic-bezier(.34,1.56,.64,1), opacity 0.3s;
      `;
      charDiv.appendChild(portalImg);
      requestAnimationFrame(() => {
        portalImg.style.transform = 'translateY(-50%) scale(1)';
        portalImg.style.opacity = '0.8';
      });
    }, 2600);

    // Character shrinks into portal at 3000ms
    setTimeout(() => {
      if (!overlay.parentNode) return;
      const canvas = overlay.querySelector('canvas');
      if (canvas) {
        canvas.style.transition = 'transform 0.4s ease-in, opacity 0.3s ease-in';
        canvas.style.transform = 'scale(0) translateX(60px)';
        canvas.style.opacity = '0';
      }
    }, 3000);

    // Portal shrinks at 3300ms
    setTimeout(() => {
      if (!overlay.parentNode) return;
      const portalImg = overlay.querySelector('img');
      if (portalImg) {
        portalImg.style.transform = 'translateY(-50%) scale(0)';
        portalImg.style.opacity = '0';
      }
    }, 3300);

    // Overlay fades out at 3500ms
    setTimeout(() => {
      if (!overlay.parentNode) return;
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlayChar.destroy();
        overlay.remove();
        this._showGoneSign(goneSign);
      }, 200);
    }, 3200);

    window._researcherInWindow = true;
  }

  _showGoneSign(goneSign) {
    if (goneSign) {
      goneSign.style.display = 'block';
      const GONE_MESSAGES = [
        "Gone to the window. Don't let the donut take my spot.",
        "Out for analysis. The eye is watching the place.",
        "BRB. If the gauge drops below 50, it wasn't me.",
        "Working in the big window. This spot is RESERVED.",
        "Stepped out. Do NOT replace me with another chart.",
        "At the Pathfinder window. Try not to miss me.",
        "Gone to help with research. The donut can't do that."
      ];
      const msg = goneSign.querySelector('.pf-gone-message');
      if (msg) msg.textContent = GONE_MESSAGES[Math.floor(Math.random() * GONE_MESSAGES.length)];
    }
  }

  /** Portal back: character returns to compact view when window closes */
  _portalCharacterBack() {
    window._researcherInWindow = false;

    const compactCharContainer = document.querySelector('[data-dot-view="3"] .pf-char-compact-container');
    const goneSign = document.querySelector('.pf-gone-sign');

    // Hide gone sign
    if (goneSign) {
      goneSign.style.display = 'none';
    }

    // Grow the compact character back with a bouncy spring animation
    if (compactCharContainer) {
      compactCharContainer.style.transition = 'transform 0.4s cubic-bezier(.34,1.56,.64,1), opacity 0.3s ease-out';
      compactCharContainer.style.transform = 'scale(1)';
      compactCharContainer.style.opacity = '1';
    }

    // Restore ZZZ element visibility
    const parentWrap = compactCharContainer?.closest('.researcher-char-wrap');
    if (parentWrap) {
      parentWrap.querySelectorAll('.zzz').forEach(z => z.style.display = '');
    }

    // Also restore hint/meter visibility
    if (parentWrap) {
      parentWrap.querySelectorAll('.hint, .meter').forEach(h => h.style.display = '');
    }

    // Restart the compact character
    const compactChar = window._compactResearcherCharacter;
    if (compactChar) {
      compactChar.running = true;
      compactChar.returnToIdle();
      if (compactChar._loop) requestAnimationFrame(compactChar._loop);
    }

    // Show hint text again
    const hintText = document.querySelector('[data-dot-view="3"] .researcher-char-wrap');
    if (hintText) {
      const hints = hintText.querySelectorAll('.hint, .meter');
      hints.forEach(h => h.style.display = '');
    }
  }

  // ── GRAPH WINDOW (YouTube miniplayer pattern) ──────────────────────────

  _populateGraphWindow(body, windowEl) {
    const meta = window._arivuGraph?.metadata || {};
    const seedNode = window._arivuGraph?.allNodes?.find(n => n.is_seed) || {};
    const year = seedNode.year || '';
    const title = meta.seed_paper_title || 'Unknown Paper';
    const authors = (seedNode.authors || []).slice(0, 3).join(', ');
    const suffix = (seedNode.authors || []).length > 3 ? ' et al.' : '';
    const citations = (seedNode.citation_count || 0).toLocaleString();

    body.style.padding = '0';
    body.innerHTML = `
      <div class="window-paper-info">
        <h2>${title}${year ? ` (${year})` : ''}</h2>
        <p>${authors}${suffix} &middot; ${citations} citations</p>
      </div>
      <div style="padding: 0 20px 20px;">
        <div class="window-graph-content">
          <div class="window-graph-area" id="window-graph-area"></div>
          <div class="window-pruning-panel" id="window-pruning-panel">
            <div class="window-pruning-inner">
              <h4>Pruning Impact</h4>
              <div class="window-prune-stats">
                <div class="window-prune-stat">
                  <span class="stat-value" id="win-prune-pct">&mdash;</span>
                  <span class="stat-desc">Collapsed</span>
                </div>
                <div class="window-prune-stat">
                  <span class="stat-value" id="win-prune-lost">&mdash;</span>
                  <span class="stat-desc">Lost foundation</span>
                </div>
                <div class="window-prune-stat">
                  <span class="stat-value survived" id="win-prune-survived">&mdash;</span>
                  <span class="stat-desc">Survived</span>
                </div>
              </div>
              <div class="window-prune-explanation">
                <h5>What this means?</h5>
                <div class="prune-ai-text" id="win-prune-ai">
                  <div class="ai-loading">
                    <div class="skeleton-line"></div>
                    <div class="skeleton-line"></div>
                    <div class="skeleton-line"></div>
                  </div>
                </div>
                <span class="read-more-link" id="win-prune-readmore">Read more &rarr;</span>
              </div>
            </div>
          </div>
        </div>
        <div class="ai-interpretation" id="window-graph-ai">
          <h4>What this graph shows</h4>
          <div id="window-graph-ai-content">
            <div class="ai-loading">
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
            </div>
          </div>
          <span class="read-more-link" id="window-graph-readmore">Read more &rarr;</span>
        </div>
      </div>
    `;

    // Move the graph SVG into the window (YouTube miniplayer pattern)
    this._moveGraphToWindow(windowEl);

    // Load AI interpretation
    if (window.ArivuAI) {
      window.ArivuAI.loadInterpretation('graph', 'short', document.getElementById('window-graph-ai-content'));
    }

    // "Read more" on graph interpretation opens a new breakdown window
    document.getElementById('window-graph-readmore')?.addEventListener('click', () => {
      this.openWindow('graph-breakdown');
    });

    // "Read more" on pruning opens a new pruning detail window
    document.getElementById('win-prune-readmore')?.addEventListener('click', () => {
      this.openWindow('pruning-detail');
    });

    // Listen for prune events to show pruning panel
    this._graphPruneListener = (e) => {
      const panel = document.getElementById('window-pruning-panel');
      if (!panel) return;
      panel.classList.add('visible');
      const { impact_percentage, collapsed_count, survived_count } = e.detail || {};
      const pctEl = document.getElementById('win-prune-pct');
      const lostEl = document.getElementById('win-prune-lost');
      const survEl = document.getElementById('win-prune-survived');
      if (pctEl) pctEl.textContent = `${(impact_percentage || 0).toFixed(1)}%`;
      if (lostEl) lostEl.textContent = collapsed_count || 0;
      if (survEl) survEl.textContent = survived_count || 0;

      // Load pruning AI interpretation
      if (window.ArivuAI) {
        window.ArivuAI.loadPruningInterpretation(e.detail, document.getElementById('win-prune-ai'));
      }
    };
    window.addEventListener('arivu:prune-result', this._graphPruneListener);

    // Listen for prune reset to hide panel
    this._graphResetListener = () => {
      const panel = document.getElementById('window-pruning-panel');
      if (panel) panel.classList.remove('visible');
    };
    window.addEventListener('arivu:prune-reset', this._graphResetListener);
  }

  _moveGraphToWindow(windowEl) {
    // Guard: only move if graph is fully loaded
    if (!window._arivuGraph) {
      const windowArea = windowEl.querySelector('.window-graph-area');
      if (windowArea) windowArea.innerHTML = '<div class="graph-placeholder"><span>Graph is still loading.<br>Please wait for the build to complete.</span></div>';
      return;
    }

    const mainContainer = document.getElementById('graph-svg-container');
    const windowArea = windowEl.querySelector('.window-graph-area');
    if (!mainContainer || !windowArea) return;

    // Save reference to return later
    this._graphOriginalParent = mainContainer.parentElement;

    // Move the actual SVG container into the window
    windowArea.appendChild(mainContainer);

    // Also move the prune-pill and keyboard-hint into the window graph area
    // so they remain visible and functional when the graph is in the window
    const prunePill = document.getElementById('prune-pill');
    const keyboardHint = document.getElementById('keyboard-hint');
    if (prunePill) windowArea.appendChild(prunePill);
    if (keyboardHint) windowArea.appendChild(keyboardHint);

    // Show placeholder in main page
    const mainGraph = document.getElementById('graph-container');
    if (mainGraph) {
      const placeholder = document.createElement('div');
      placeholder.className = 'graph-placeholder';
      placeholder.id = 'graph-window-placeholder';
      placeholder.innerHTML = `
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M3 9h6"/></svg>
        <span>Graph opened in window.<br>Close the window to return.</span>
      `;
      mainGraph.appendChild(placeholder);
    }

    // Trigger resize on the graph to adapt to new container
    setTimeout(() => {
      if (window._treeLayout && window._treeLayout.svg) {
        window._treeLayout.recenter();
      } else if (window._arivuGraph && window._arivuGraph.svg) {
        window._arivuGraph._zoomToFit();
      }
    }, 300);

    // If there's an existing prune result, show it in the window's pruning panel immediately
    if (window._lastPruneResult) {
      const panel = document.getElementById('window-pruning-panel');
      if (panel) {
        panel.classList.add('visible');
        const { impact_percentage, collapsed_count, survived_count } = window._lastPruneResult;
        const total = (collapsed_count || 0) + (survived_count || 0);
        const pctEl = document.getElementById('win-prune-pct');
        const lostEl = document.getElementById('win-prune-lost');
        const survEl = document.getElementById('win-prune-survived');
        if (pctEl) pctEl.textContent = `${(impact_percentage || 0).toFixed(1)}%`;
        if (lostEl) lostEl.textContent = collapsed_count || 0;
        if (survEl) survEl.textContent = survived_count || 0;
        if (window.ArivuAI) {
          window.ArivuAI.loadPruningInterpretation(window._lastPruneResult, document.getElementById('win-prune-ai'));
        }
      }
    }
  }

  _returnGraphToMain() {
    const mainContainer = document.getElementById('graph-svg-container');
    if (!mainContainer) return;

    // Move SVG container back to main graph area
    const mainGraph = document.getElementById('graph-container');
    if (mainGraph) {
      // Remove placeholder
      const placeholder = document.getElementById('graph-window-placeholder');
      if (placeholder) placeholder.remove();

      // Re-insert the SVG container
      mainGraph.appendChild(mainContainer);

      // Move prune-pill and keyboard-hint back to main graph area
      const prunePill = document.getElementById('prune-pill');
      const keyboardHint = document.getElementById('keyboard-hint');
      if (prunePill) mainGraph.appendChild(prunePill);
      if (keyboardHint) mainGraph.appendChild(keyboardHint);

      // Trigger resize on correct view
      setTimeout(() => {
        if (window._treeLayout && window._treeLayout.svg) {
          window._treeLayout.recenter();
        } else if (window._arivuGraph && window._arivuGraph.svg) {
          window._arivuGraph._zoomToFit();
        }
      }, 300);
    }

    // Clean up event listeners
    if (this._graphPruneListener) {
      window.removeEventListener('arivu:prune-result', this._graphPruneListener);
      this._graphPruneListener = null;
    }
    if (this._graphResetListener) {
      window.removeEventListener('arivu:prune-reset', this._graphResetListener);
      this._graphResetListener = null;
    }
    this._graphOriginalParent = null;
  }

  // ── DNA WINDOW ──────────────────────────────────────────────────────────

  _populateDNAWindow(body) {
    const dnaData = window._graphLoader?._graphData?.dna_profile;

    body.innerHTML = `
      <div class="window-chart-section" id="win-dna-chart">
        <canvas id="win-dna-donut" style="max-height:250px"></canvas>
      </div>
      <div class="ai-interpretation" id="win-dna-ai">
        <h4>What this graph shows</h4>
        <div id="win-dna-ai-content">
          <div class="ai-loading">
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
          </div>
        </div>
        <span class="read-more-link" id="win-dna-readmore">Read more &rarr;</span>
      </div>
    `;

    // Re-render DNA donut in window
    if (dnaData && dnaData.clusters) {
      const labels = dnaData.clusters.map(c => c.name);
      const data = dnaData.clusters.map(c => c.percentage);
      const colors = dnaData.clusters.map(c => c.color);

      const dnaChart = new Chart(document.getElementById('win-dna-donut'), {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{ data, backgroundColor: colors, borderColor: '#ffffff', borderWidth: 2, hoverOffset: 8 }]
        },
        options: {
          responsive: true,
          cutout: '65%',
          animation: { duration: 600, easing: 'easeInOutQuart' },
          plugins: {
            legend: {
              position: 'right',
              labels: { color: '#6B7280', boxWidth: 12, padding: 8, font: { size: 11 } }
            },
            tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed.toFixed(1)}%` } }
          }
        }
      });
      // Track chart for cleanup
      const win = this.windows.get('dna');
      if (win) win.charts.push(dnaChart);
    }

    // Load AI interpretation
    if (window.ArivuAI) {
      window.ArivuAI.loadInterpretation('dna', 'short', document.getElementById('win-dna-ai-content'));
    }

    // "Read more" — in-window transition
    document.getElementById('win-dna-readmore')?.addEventListener('click', () => {
      this._transitionToDetail(body, 'dna');
    });
  }

  // ── DIVERSITY WINDOW ────────────────────────────────────────────────────

  _populateDiversityWindow(body) {
    const divData = window._graphLoader?._graphData?.diversity_score;

    body.innerHTML = `
      <div class="window-chart-section" id="win-div-chart">
        <canvas id="win-div-radar" style="max-height:250px"></canvas>
      </div>
      <div class="ai-interpretation" id="win-div-ai">
        <h4>What this graph shows</h4>
        <div id="win-div-ai-content">
          <div class="ai-loading">
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
          </div>
        </div>
        <span class="read-more-link" id="win-div-readmore">Read more &rarr;</span>
      </div>
    `;

    // Re-render diversity radar in window
    if (divData) {
      const divChart = new Chart(document.getElementById('win-div-radar'), {
        type: 'radar',
        data: {
          labels: ['Field Diversity', 'Temporal Span', 'Concept Clusters', 'Citation Balance'],
          datasets: [{
            label: 'Intellectual Diversity',
            data: [divData.field_diversity, divData.temporal_span, divData.concept_diversity, divData.citation_entropy],
            backgroundColor: 'rgba(17,24,39,0.08)',
            borderColor: '#111827',
            pointBackgroundColor: '#111827',
            pointRadius: 4,
          }]
        },
        options: {
          responsive: true,
          scales: { r: { min: 0, max: 100, ticks: { stepSize: 25, color: '#9CA3AF' }, grid: { color: '#E5E7EB' }, pointLabels: { color: '#6B7280', font: { size: 12 } } } },
          plugins: { legend: { display: false } }
        }
      });
      // Track chart for cleanup
      const win = this.windows.get('diversity');
      if (win) win.charts.push(divChart);
    }

    // Load AI interpretation
    if (window.ArivuAI) {
      window.ArivuAI.loadInterpretation('diversity', 'short', document.getElementById('win-div-ai-content'));
    }

    // "Read more" — in-window transition
    document.getElementById('win-div-readmore')?.addEventListener('click', () => {
      this._transitionToDetail(body, 'diversity');
    });
  }

  // ── ORPHANS + COVERAGE WINDOW ──────────────────────────────────────────

  _populateOrphansWindow(body) {
    body.innerHTML = `
      <div class="window-tabs" style="display:flex;gap:0;border-bottom:1px solid var(--bg-elevated);margin-bottom:16px">
        <button class="window-tab active" data-tab="orphans" style="padding:8px 16px;border:none;border-bottom:2px solid #1a1a1a;background:transparent;cursor:pointer;font-weight:600;color:#1a1a1a">Orphan Ideas</button>
        <button class="window-tab" data-tab="coverage" style="padding:8px 16px;border:none;border-bottom:2px solid transparent;background:transparent;cursor:pointer;color:#9CA3AF">Data Coverage</button>
      </div>
      <div id="win-orphans-content"></div>
      <div id="win-coverage-content" style="display:none"></div>
      <div class="ai-interpretation">
        <h4>What this graph shows</h4>
        <div id="win-orphans-ai-content">
          <div class="ai-loading">
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
          </div>
        </div>
        <span class="read-more-link" id="win-orphans-readmore">Read more &rarr;</span>
      </div>
    `;

    // Clone orphan cards with horizontal scroll layout (matching wireframe)
    const srcOrphans = document.getElementById('orphan-cards-container');
    const destOrphans = document.getElementById('win-orphans-content');
    if (srcOrphans && destOrphans) {
      destOrphans.style.display = 'flex';
      destOrphans.style.gap = '12px';
      destOrphans.style.overflowX = 'auto';
      destOrphans.style.paddingBottom = '8px';
      destOrphans.innerHTML = srcOrphans.innerHTML;
      // Re-attach highlight-in-graph click handlers (innerHTML doesn't copy listeners)
      destOrphans.addEventListener('click', (e) => {
        const btn = e.target.closest('.orphan-highlight-btn');
        if (!btn) return;
        const paperId = btn.closest('[data-paper-id]')?.dataset.paperId;
        if (paperId) {
          window.dispatchEvent(new CustomEvent('arivu:highlight-node', { detail: { paperId } }));
        }
      });
    }

    // Clone coverage
    const srcCoverage = document.getElementById('coverage-details');
    const destCoverage = document.getElementById('win-coverage-content');
    if (srcCoverage && destCoverage) {
      destCoverage.innerHTML = srcCoverage.innerHTML;
    }

    // Track which tab is active for AI content switching
    let activeTab = 'orphans';

    // Tab switching — also reloads AI interpretation for the active tab
    body.querySelectorAll('.window-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        body.querySelectorAll('.window-tab').forEach(t => {
          t.classList.remove('active');
          t.style.borderBottomColor = 'transparent';
          t.style.color = '#9CA3AF';
        });
        tab.classList.add('active');
        tab.style.borderBottomColor = '#1a1a1a';
        tab.style.color = '#1a1a1a';

        const tabName = tab.dataset.tab;
        activeTab = tabName;
        document.getElementById('win-orphans-content').style.display = tabName === 'orphans' ? '' : 'none';
        document.getElementById('win-coverage-content').style.display = tabName === 'coverage' ? '' : 'none';

        // Reload AI interpretation for the active tab
        const aiTarget = document.getElementById('win-orphans-ai-content');
        if (window.ArivuAI && aiTarget) {
          window.ArivuAI.loadInterpretation(tabName, 'short', aiTarget);
        }
      });
    });

    // Load AI interpretation for initial tab (orphans)
    if (window.ArivuAI) {
      window.ArivuAI.loadInterpretation('orphans', 'short', document.getElementById('win-orphans-ai-content'));
    }

    // "Read more" — in-window transition for active tab (orphans or coverage)
    document.getElementById('win-orphans-readmore')?.addEventListener('click', () => {
      this._transitionToDetail(body, activeTab);
    });
  }

  // ── BREAKDOWN WINDOWS (opened from "Read more") ────────────────────────

  _populateBreakdownWindow(body, sourceType) {
    const meta = window._arivuGraph?.metadata || {};
    const seedNode = window._arivuGraph?.allNodes?.find(n => n.is_seed) || {};
    const totalNodes = window._arivuGraph?.allNodes?.length || 0;
    const bottleneckCount = (window._arivuGraph?.allNodes || []).filter(n => n.is_bottleneck).length;
    const fields = new Set((window._arivuGraph?.allNodes || []).map(n => (n.fields_of_study || [])[0]).filter(Boolean));

    body.innerHTML = `
      <div style="margin-bottom:16px">
        <h2 style="font-size:1.1rem;font-weight:700;margin:0">${meta.seed_paper_title || 'Paper'} (${seedNode.year || ''})</h2>
        <p style="font-size:0.8rem;color:var(--text-secondary);margin:2px 0 0">
          ${(seedNode.authors || []).slice(0, 3).join(', ')} &middot; ${(seedNode.citation_count || 0).toLocaleString()} citations
        </p>
        <p style="font-size:0.8rem;color:var(--text-muted);margin:6px 0 0">
          ${totalNodes} papers &middot; ${bottleneckCount} bottlenecks &middot; ${fields.size} fields
        </p>
      </div>
      <div id="breakdown-content">
        <div class="ai-loading">
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
        </div>
      </div>
    `;

    // Load detailed AI interpretation
    if (window.ArivuAI) {
      window.ArivuAI.loadInterpretation('graph', 'detailed', document.getElementById('breakdown-content'));
    }
  }

  _populatePruningDetailWindow(body) {
    body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h4 style="font-size:0.9rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin:0">Detailed Breakdown</h4>
      </div>
      <div id="pruning-detail-content">
        <div class="ai-loading">
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
        </div>
      </div>
    `;

    // Load detailed pruning AI interpretation
    if (window.ArivuAI) {
      window.ArivuAI.loadPruningInterpretation(null, document.getElementById('pruning-detail-content'), 'detailed');
    }
  }

  // ── IN-WINDOW "READ MORE" TRANSITION ───────────────────────────────────

  _transitionToDetail(body, containerType) {
    // Destroy any Chart.js instances tracked for this window before replacing body
    const win = this.windows.get(containerType);
    if (win && win.charts) {
      win.charts.forEach(c => { try { c.destroy(); } catch(e) {} });
      win.charts = [];
    }

    // Animate out
    body.style.transition = 'opacity 0.2s ease';
    body.style.opacity = '0';

    setTimeout(() => {
      body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <h4 style="font-size:0.9rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin:0">Detailed Breakdown</h4>
          <button class="detail-back-btn" id="detail-back-btn">Back</button>
        </div>
        <div class="detail-breakdown">
          <div class="detail-breakdown-text" id="detail-text">
            <div class="ai-loading">
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
            </div>
          </div>
          <div class="detail-breakdown-chart" id="detail-chart"></div>
        </div>
      `;

      // Re-render a small chart in the detail view
      this._renderSmallChart(containerType, document.getElementById('detail-chart'));

      // Load detailed AI content
      if (window.ArivuAI) {
        window.ArivuAI.loadInterpretation(containerType, 'detailed', document.getElementById('detail-text'));
      }

      // Back button — re-populate from scratch (don't restore stale HTML)
      document.getElementById('detail-back-btn')?.addEventListener('click', () => {
        body.style.opacity = '0';
        setTimeout(() => {
          if (containerType === 'dna') this._populateDNAWindow(body);
          else if (containerType === 'diversity') this._populateDiversityWindow(body);
          else if (containerType === 'orphans' || containerType === 'coverage') this._populateOrphansWindow(body);
          body.style.opacity = '1';
        }, 200);
      });

      body.style.opacity = '1';
    }, 200);
  }

  _renderSmallChart(type, container) {
    if (!container) return;

    // Find the window to track chart instances for cleanup
    const win = this.windows.get(type);

    if (type === 'dna') {
      const dnaData = window._graphLoader?._graphData?.dna_profile;
      if (!dnaData?.clusters) return;
      const canvas = document.createElement('canvas');
      canvas.style.maxHeight = '180px';
      container.appendChild(canvas);
      const chart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: dnaData.clusters.map(c => c.name),
          datasets: [{ data: dnaData.clusters.map(c => c.percentage), backgroundColor: dnaData.clusters.map(c => c.color), borderColor: '#fff', borderWidth: 1 }]
        },
        options: { responsive: true, cutout: '60%', animation: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, padding: 4, font: { size: 9 }, color: '#6B7280' } } } }
      });
      if (win) win.charts.push(chart);
    } else if (type === 'diversity') {
      const divData = window._graphLoader?._graphData?.diversity_score;
      if (!divData) return;
      const canvas = document.createElement('canvas');
      canvas.style.maxHeight = '180px';
      container.appendChild(canvas);
      const chart = new Chart(canvas, {
        type: 'radar',
        data: {
          labels: ['Field', 'Temporal', 'Concept', 'Citation'],
          datasets: [{ data: [divData.field_diversity, divData.temporal_span, divData.concept_diversity, divData.citation_entropy], backgroundColor: 'rgba(17,24,39,0.08)', borderColor: '#111827', pointRadius: 3 }]
        },
        options: { responsive: true, scales: { r: { min: 0, max: 100, ticks: { display: false }, grid: { color: '#E5E7EB' }, pointLabels: { font: { size: 9 }, color: '#6B7280' } } }, plugins: { legend: { display: false } } }
      });
      if (win) win.charts.push(chart);
    }
  }
}

// ═══════ INITIALIZE ═══════

document.addEventListener('DOMContentLoaded', () => {
  if (!document.querySelector('.tool-layout-v2')) return;
  window._windowManager = new WindowManager();
});
