/**
 * Researcher Character — Dot Matrix Interactive Mascot
 * Embeds directly into any container (no iframe needed).
 * Requires researcher-sprites.js to be loaded first (window.RESEARCHER_SPRITES).
 */
window.ResearcherCharacter = (function() {
  'use strict';

  const W = 360, H = 480;
  const STEP = 6, DOT_R = 2.3, THRESH = 230;

  class ResearcherCharacter {
    constructor(container, opts = {}) {
      this.container = container;
      this.scale = opts.scale || 0.48;
      this.imgs = {};
      this.loaded = 0;
      this.total = 0;
      this.curP = 'typing'; // Start in sitting/typing pose
      this.nxtP = null;
      this.tS = 0;
      this.tD = 500;
      this.state = 'sitting'; // Start sitting at laptop
      this.clicks = 0;
      this.hovered = false;
      this.angryLock = false;
      this.cTimer = null;
      this.idleTimer = null;
      this.bTimer = null;
      this.lastSwitch = 0;
      this.running = false;

      this.GREET = ['Hello there!', 'Oh, hi!', 'Welcome!', 'Good to see you!', 'Need something?'];
      this.ANNOY = ['Hmm.', 'Excuse me?', "I'm working.", 'Please stop.', '...seriously?'];
      this.RAGE = ["THAT'S ENOUGH!!", "I'm trying to WORK!", 'STOP IT NOW.', 'WHY?!'];
      this.WAKE = ['Wh—what?!', "I'm awake!", 'I was resting my eyes!', 'Huh?!'];
      this.CALM = ['...fine.', 'Totally fine.', "Don't do that again."];
      this.CONFUSED_LINES = ["I can't find any connection to this lineage.", "That doesn't match anything here.", "Hmm, try something related to this field."];
      this.EXCITED_LINES = ['Found you!', 'Eureka! Here are your results.', 'I see where you fit!'];
      this.ANALYZING_LINES = ['Let me look through this...', 'Analyzing...', 'Searching the lineage...'];
      this.SAD_LINES = ['That space is pretty crowded.', 'Tough competition in that area.', 'The landscape is dense here.'];
      this.CELEBRATING_LINES = ['No one else is doing this!', 'You found a real gap!', 'This is a unique position!'];

      this._buildDOM();
      this._loadImages();
    }

    _pick(a) { return a[Math.random() * a.length | 0]; }

    _buildDOM() {
      const c = this.container;
      c.innerHTML = '';

      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;';

      // Speech bubble — in normal document flow ABOVE the character
      this.bub = document.createElement('div');
      this.bub.style.cssText = 'background:#111;color:#f5f5f0;font:600 11px/1.4 "JetBrains Mono",monospace;padding:8px 12px;border-radius:8px;max-width:220px;min-height:0;overflow:hidden;max-height:0;opacity:0;text-align:center;transition:all 0.25s cubic-bezier(.34,1.56,.64,1);box-shadow:0 4px 16px rgba(0,0,0,0.18);margin-bottom:4px;';

      // Bubble arrow pointing down (centered)
      const bubArrow = document.createElement('div');
      bubArrow.style.cssText = 'width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:6px solid #111;margin:0 auto;';

      // Bubble text span
      this.bubText = document.createElement('span');
      this.bub.appendChild(this.bubText);

      wrap.appendChild(this.bub);
      wrap.appendChild(bubArrow);
      this.bubArrow = bubArrow;
      this.bubArrow.style.opacity = '0';
      this.bubArrow.style.transition = 'opacity 0.2s';

      // Zzz container — in normal flow, above canvas but below bubble
      this.zzzWrap = document.createElement('div');
      this.zzzWrap.style.cssText = 'display:flex;gap:3px;align-items:baseline;justify-content:center;height:20px;';
      this.zzz = [];
      for (let i = 0; i < 3; i++) {
        const z = document.createElement('span');
        z.textContent = 'z';
        z.style.cssText = `font:bold ${14 - i * 3}px "JetBrains Mono",monospace;color:#555;opacity:0;`;
        this.zzz.push(z);
        this.zzzWrap.appendChild(z);
      }
      wrap.appendChild(this.zzzWrap);

      // Scene container for canvas
      const scene = document.createElement('div');
      scene.style.cssText = 'position:relative;display:inline-block;';

      // Scaled wrapper
      const scaleWrap = document.createElement('div');
      const sw = Math.round(W * this.scale);
      const sh = Math.round(H * this.scale);
      scaleWrap.style.cssText = `width:${sw}px;height:${sh}px;overflow:hidden;`;

      const inner = document.createElement('div');
      inner.style.cssText = `width:${W}px;height:${H}px;transform:scale(${this.scale});transform-origin:top left;position:relative;`;

      // Canvas
      this.cv = document.createElement('canvas');
      this.cv.width = W;
      this.cv.height = H;
      this.cv.style.cssText = 'display:block;cursor:pointer;border-radius:14px;background:transparent;transition:transform 0.12s;';
      this.ctx = this.cv.getContext('2d', { willReadFrequently: true });

      // Offscreen canvas for compositing
      this.off = document.createElement('canvas');
      this.off.width = W;
      this.off.height = H;
      this.oct = this.off.getContext('2d', { willReadFrequently: true });

      // Loading overlay
      this.loadEl = document.createElement('div');
      this.loadEl.style.cssText = 'position:absolute;inset:0;background:transparent;display:flex;align-items:center;justify-content:center;font:12px "JetBrains Mono",monospace;color:#aaa;border-radius:14px;';
      this.loadEl.textContent = 'loading...';

      inner.appendChild(this.cv);
      inner.appendChild(this.loadEl);
      scaleWrap.appendChild(inner);
      scene.appendChild(scaleWrap);
      wrap.appendChild(scene);

      // Hint text
      this.hintEl = document.createElement('p');
      this.hintEl.style.cssText = 'font:11px "JetBrains Mono",monospace;color:#9CA3AF;text-align:center;letter-spacing:0.07em;';
      this.hintEl.textContent = 'hover to say hello · click to interact';
      wrap.appendChild(this.hintEl);

      // Anger meter
      const meter = document.createElement('div');
      meter.style.cssText = 'display:flex;gap:5px;';
      this.meters = [];
      for (let i = 0; i < 8; i++) {
        const md = document.createElement('div');
        md.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#ddd;transition:background 0.25s;';
        this.meters.push(md);
        meter.appendChild(md);
      }
      wrap.appendChild(meter);

      c.appendChild(wrap);
      this._bindEvents(scene);
    }

    _loadImages() {
      const sprites = window.RESEARCHER_SPRITES;
      if (!sprites) {
        this.loadEl.textContent = 'sprites not loaded';
        return;
      }
      this.total = Object.keys(sprites).length;
      for (const [k, src] of Object.entries(sprites)) {
        const img = new Image();
        img.onload = () => {
          this.imgs[k] = img;
          if (++this.loaded === this.total) this._start();
        };
        img.onerror = () => {
          if (++this.loaded === this.total) this._start();
        };
        img.src = src;
      }
    }

    _start() {
      this.loadEl.style.display = 'none';
      this.lastSwitch = performance.now();
      this._idleStart = Date.now();
      this._resetIdle();
      this._startPersonalityEngine();
      this.running = true;
      this._loop = (ts) => {
        if (!this.running) return;
        requestAnimationFrame(this._loop);
        this._tickIdle(ts);
        this._blendSrc(ts);
        this._render();
      };
      requestAnimationFrame(this._loop);

      // Performance: pause rendering when character is off-screen
      if (typeof IntersectionObserver !== 'undefined') {
        this._visObserver = new IntersectionObserver(([entry]) => {
          if (entry.isIntersecting) {
            if (!this.running) {
              this.running = true;
              requestAnimationFrame(this._loop);
            }
          } else {
            this.running = false;
          }
        }, { threshold: 0.1 });
        this._visObserver.observe(this.cv);
      }
    }

    // ── Public API for Pathfinder and other features ──

    /** Show a custom speech bubble with optional auto-hide duration */
    say(text, duration = 0) {
      this._showBub(text, duration);
    }

    /** Transition to a specific pose with optional speech bubble */
    setPose(stateName, bubble = null, bubbleDuration = 0) {
      this._resetIdle();
      this.angryLock = false;
      this._setZzz(false);
      this.state = stateName;
      this._setState(stateName);
      if (bubble) this._showBub(bubble, bubbleDuration);
    }

    /** Convenience: set to analyzing state with custom message */
    analyze(message) {
      this.setPose('analyzing', message || this._pick(this.ANALYZING_LINES));
    }

    /** Convenience: set to typing (long processing) state */
    setTyping(message) {
      this.setPose('typing', message || 'Working on it...');
    }

    /** Convenience: show excitement with results */
    showExcitement(message) {
      this.setPose('excited', message || this._pick(this.EXCITED_LINES));
    }

    /** Convenience: show confusion for bad input */
    showConfusion(message) {
      this.setPose('confused', message || this._pick(this.CONFUSED_LINES));
    }

    /** Convenience: celebrate great results */
    celebrate(message) {
      this.setPose('celebrating', message || this._pick(this.CELEBRATING_LINES));
    }

    /** Convenience: show sadness for bad news */
    showSad(message) {
      this.setPose('sad', message || this._pick(this.SAD_LINES));
    }

    /** Convenience: point toward graph (left side of screen) */
    pointToGraph(message) {
      this.setPose('pointing', message || 'Look at the graph!');
    }

    /** Convenience: present results (point at content) */
    presentResults(message) {
      this.setPose('presenting', message || 'Here are your results.');
    }

    /** Convenience: show worry for risky findings */
    showWorry(message) {
      this.setPose('worried', message || 'This looks concerning...');
    }

    /** Convenience: laugh at funny/impossible input */
    laugh(message) {
      this.setPose('laughing', message || "That's creative!");
    }

    /** Return to idle (sitting/reading/coffee) state */
    returnToIdle() {
      this.state = 'sitting';
      this.lastSwitch = performance.now();
      this._idleStart = Date.now();
      this._goTo('typing', 600);
      this._hideBub();
      this.hintEl.textContent = 'hover to say hello · click to interact';
      this._resetIdle();
      this._startPersonalityEngine();
    }

    destroy() {
      this.running = false;
      if (this.idleTimer) clearTimeout(this.idleTimer);
      if (this.cTimer) clearTimeout(this.cTimer);
      if (this.bTimer) clearTimeout(this.bTimer);
      if (this._visObserver) { this._visObserver.disconnect(); this._visObserver = null; }
      this._stopPersonalityEngine();
      this._hideClickableBub();
    }

    // ── Drawing ──
    _drawFit(img, alpha = 1) {
      if (!img) return;
      const PAD = 20;
      const scale = Math.min((W - PAD * 2) / img.naturalWidth, (H - PAD * 2) / img.naturalHeight);
      const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
      this.oct.globalAlpha = alpha;
      this.oct.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }

    _goTo(pose, dur = 500) {
      if (pose === this.curP && !this.nxtP) return;
      if (pose === this.nxtP) return;
      this.nxtP = pose; this.tD = dur; this.tS = performance.now();
    }

    _blendSrc(ts) {
      this.oct.clearRect(0, 0, W, H);
      this.oct.globalAlpha = 1; this.oct.fillStyle = '#fff'; this.oct.fillRect(0, 0, W, H);
      let p = 1;
      if (this.nxtP) { p = Math.min(1, (ts - this.tS) / this.tD); if (p >= 1) { this.curP = this.nxtP; this.nxtP = null; p = 1; } }
      if (this.imgs[this.curP]) this._drawFit(this.imgs[this.curP], 1);
      if (this.nxtP && this.imgs[this.nxtP]) this._drawFit(this.imgs[this.nxtP], p);
      this.oct.globalAlpha = 1;
    }

    _render() {
      const px = this.oct.getImageData(0, 0, W, H).data;
      // Match the panel card background — clear to transparent so container bg shows through
      this.ctx.clearRect(0, 0, W, H);

      for (let y = STEP / 2; y < H - STEP / 2; y += STEP) {
        for (let x = STEP / 2; x < W - STEP / 2; x += STEP) {
          let sum = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const sy = Math.min(Math.max(Math.round(y + dy), 0), H - 1);
              const sx = Math.min(Math.max(Math.round(x + dx), 0), W - 1);
              const i = (sy * W + sx) * 4;
              sum += (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
              n++;
            }
          }
          const lum = sum / n;
          if (lum < THRESH) {
            const ink = lum < 50 ? 12 : lum < 130 ? 80 : 148;
            this.ctx.fillStyle = `rgb(${ink},${ink},${ink})`;
            this.ctx.beginPath();
            this.ctx.arc(Math.round(x), Math.round(y), DOT_R, 0, Math.PI * 2);
            this.ctx.fill();
          }
        }
      }
    }

    // ── State machine ──
    _showBub(txt, dur = 0) {
      this.bubText.textContent = txt;
      this.bub.style.opacity = '1';
      this.bub.style.maxHeight = '80px';
      this.bub.style.padding = '8px 12px';
      this.bub.style.marginBottom = '4px';
      this.bubArrow.style.opacity = '1';
      if (this.bTimer) clearTimeout(this.bTimer);
      if (dur > 0) this.bTimer = setTimeout(() => this._hideBub(), dur);
    }
    _hideBub() {
      this.bub.style.opacity = '0';
      this.bub.style.maxHeight = '0';
      this.bub.style.padding = '0 12px';
      this.bub.style.marginBottom = '0';
      this.bubArrow.style.opacity = '0';
    }
    _setZzz(on) {
      this.zzz.forEach((z, i) => {
        if (on) {
          z.style.animation = `resCharFloatZ 2.1s ease-in-out infinite ${i * 0.7}s`;
          z.style.opacity = '';
        } else {
          z.style.animation = 'none';
          z.style.opacity = '0';
        }
      });
    }
    _syncMeter() { this.meters.forEach((m, i) => m.style.background = i < this.clicks ? '#b03020' : '#ddd'); }
    _resetIdle() {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this._idleStart = Date.now();
      // Sleep after 180 seconds (3 minutes) of no interaction
      this.idleTimer = setTimeout(() => {
        if (['reading', 'coffee', 'sitting'].includes(this.state)) this._setState('sleeping');
      }, 180000);
    }

    /** Start the personality event engine */
    _startPersonalityEngine() {
      if (this._personalityTimer) return;
      this._personalityEventIndex = 0;
      this._schedulePersonalityEvent();
    }

    _schedulePersonalityEvent() {
      const delay = 8000 + Math.random() * 7000; // 8-15 seconds
      this._personalityTimer = setTimeout(() => {
        this._firePersonalityEvent();
        this._schedulePersonalityEvent();
      }, delay);
    }

    _stopPersonalityEngine() {
      if (this._personalityTimer) {
        clearTimeout(this._personalityTimer);
        this._personalityTimer = null;
      }
    }

    _firePersonalityEvent() {
      // Only fire when in idle state and visible
      if (!['sitting', 'reading', 'coffee'].includes(this.state)) return;
      if (this.angryLock || this.hovered) return;
      if (window._researcherInWindow) return;
      if (this._selfPortalActive) return;

      // Check for self-portal adventure opportunity
      this._trySelfPortal();
      if (this._selfPortalActive) return;

      // Check idle duration for drowsy/sleep phases
      const idleDuration = Date.now() - (this._idleStart || Date.now());

      // Phase 1: 60-120s — events slow down, show drowsy hints
      if (idleDuration > 60000 && idleDuration <= 120000) {
        if (Math.random() < 0.5) return; // 50% chance to skip (slowing down)
        const drowsy = [
          "Getting a bit sleepy...",
          "These papers are heavy reading... literally.",
          "If you're not going to interact, I might take a nap.",
          "*yawn* ...still here though.",
          "My eyes are getting heavy. The papers or the boredom?",
        ];
        this.say(drowsy[Math.floor(Math.random() * drowsy.length)], 4000);
        this._goTo('reading_mid', 500);
        return;
      }

      // Phase 2: 120s+ — very slow, character is fading
      if (idleDuration > 120000) {
        if (Math.random() < 0.7) return; // 70% chance to skip
        this.say("Almost... asleep...", 3000);
        return;
      }

      // Normal personality events — weighted random selection
      const roll = Math.random();
      if (roll < 0.40) {
        // Calm/working — just let the idle cycle handle it, no bubble
        return;
      } else if (roll < 0.60) {
        // Random fact/tangent
        this._fireRandomFact();
      } else if (roll < 0.65) {
        // Made-up fact
        this._fireMadeUpFact();
      } else if (roll < 0.80) {
        // Emotional outburst
        this._fireEmotionalOutburst();
      } else if (roll < 0.90) {
        // Self-referential
        this._fireSelfReferential();
      } else {
        // Interactive bait
        this._fireInteractiveBait();
      }
    }

    _fireRandomFact() {
      const facts = [
        { text: "Did you know the Avatar font was made in Papyrus? PAPYRUS!", pose: 'angry', duration: 5000 },
        { text: "Fun fact: the first computer bug was an actual moth.", pose: 'excited', duration: 4000 },
        { text: "Researchers spend 40% of their time on formatting.", pose: 'sad', duration: 4000 },
        { text: "The word 'algorithm' comes from a 9th century mathematician.", pose: 'presenting', duration: 4000 },
        { text: "Comic Sans was designed for children's software.", pose: 'confused', duration: 4000 },
        { text: "Peer review was invented in 1731.", pose: 'analyzing', duration: 4000 },
        { text: "The average PhD takes 8.2 years.", pose: 'scared', duration: 4000 },
        { text: "More papers are published daily than you could read in a lifetime.", pose: 'worried', duration: 4000 },
        { text: "Einstein's most cited paper isn't about relativity.", pose: 'confused', duration: 4000 },
        { text: "The h-index was invented by a physicist, not a librarian.", pose: 'presenting', duration: 4000 },
        { text: "The longest paper title ever published had 2,629 characters.", pose: 'scared', duration: 5000 },
        { text: "About 2.5 million papers are published every year.", pose: 'worried', duration: 4000 },
      ];
      const fact = facts[Math.floor(Math.random() * facts.length)];
      this._goTo(fact.pose, 400);
      this.say(fact.text, fact.duration);
      // Return to idle after the fact
      setTimeout(() => {
        if (['sitting', 'reading', 'coffee'].includes(this.state) || this.state === fact.pose) {
          this.state = 'sitting';
          this._goTo('typing', 500);
        }
      }, fact.duration + 500);
    }

    _fireMadeUpFact() {
      const fakes = [
        { fake: "Did you know 73% of citations are never actually read?", reveal: "I made that up." },
        { fake: "Studies show researchers who use Arivu write 50% better papers.", reveal: "Okay I definitely made that up." },
        { fake: "The word 'thesis' originally meant 'suffering' in Latin.", reveal: "That's not true but it should be." },
        { fake: "90% of PhD students talk to their houseplants about research.", reveal: "I completely fabricated that. But it feels true." },
        { fake: "The first academic paper was written on a napkin.", reveal: "Not true. But wouldn't that be great?" },
      ];
      const f = fakes[Math.floor(Math.random() * fakes.length)];
      this._goTo('presenting', 400);
      this.say(f.fake, 3000);
      setTimeout(() => {
        this._goTo('laughing', 350);
        this.say(f.reveal, 3000);
        setTimeout(() => {
          this.state = 'sitting';
          this._goTo('typing', 500);
        }, 3500);
      }, 3000);
    }

    _fireEmotionalOutburst() {
      const outbursts = [
        // Angry
        { text: "WHY does every paper say 'future work' and then NEVER do it?!", pose: 'angry', followUp: null },
        { text: "Who decided conference deadlines should be at midnight?!", pose: 'angry', followUp: "WHO." },
        { text: "Reviewer 2 is not a person. Reviewer 2 is a concept. A nightmare.", pose: 'angry', followUp: "Sorry. Trauma.", followPose: 'scared' },
        // Sad
        { text: "Sometimes I wonder if anyone reads the papers in this lineage.", pose: 'sad', followUp: "Anyway back to work.", followPose: 'sitting' },
        { text: "I've been in this panel for... how long? What year is it?", pose: 'sad', followUp: null },
        // Excited
        { text: "Wait wait wait. I just noticed something in this graph.", pose: 'excited', followUp: "Never mind. False alarm.", followPose: 'sitting' },
        { text: "What if someone combined TWO clusters?", pose: 'celebrating', followUp: "Someone write that down!" },
        // Scared
        { text: "What if someone prunes the seed paper? What happens to ME?", pose: 'scared', followUp: "Don't do it.", followPose: 'worried' },
        { text: "Is that a citation loop?! Oh wait, no. Never mind.", pose: 'scared', followUp: null },
      ];
      const o = outbursts[Math.floor(Math.random() * outbursts.length)];
      this._goTo(o.pose, 300);
      this.say(o.text, 4000);
      if (o.followUp) {
        setTimeout(() => {
          if (o.followPose) this._goTo(o.followPose === 'sitting' ? 'typing' : o.followPose, 400);
          this.say(o.followUp, 3000);
          setTimeout(() => { this.state = 'sitting'; this._goTo('typing', 500); }, 3500);
        }, 4500);
      } else {
        setTimeout(() => { this.state = 'sitting'; this._goTo('typing', 500); }, 5000);
      }
    }

    _fireSelfReferential() {
      const lines = [
        { text: "I've been watching you scroll for a while now.", pose: 'analyzing' },
        { text: "The donut chart doesn't have existential thoughts.", pose: 'sad' },
        { text: "If I had legs I'd walk out of this panel.", pose: 'pointing' },
        { text: "I wonder what the researcher in the OTHER tab is doing.", pose: 'confused' },
        { text: "My coffee is cold. Has been for hours. Pixel coffee.", pose: 'coffee_raised' },
        { text: "I'm the only feature here with FEELINGS.", pose: 'presenting' },
        { text: "The eye from Blind Spots blinked at me. I blinked back.", pose: 'worried' },
        { text: "None of the other charts can talk. Think about that.", pose: 'analyzing' },
        { text: "I should charge rent for this dot position.", pose: 'presenting' },
        { text: "The constellation in Architects is pretty. But can it wave?", pose: 'waving' },
      ];
      const l = lines[Math.floor(Math.random() * lines.length)];
      this._goTo(l.pose, 400);
      this.say(l.text, 4000);
      setTimeout(() => { this.state = 'sitting'; this._goTo('typing', 500); }, 5000);
    }

    _fireInteractiveBait() {
      const baits = [
        { text: "Hey. Hey. You. Click me.", pose: 'waving', giveUp: "Fine. Ignore me." },
        { text: "Quick question: is this paper actually good or just well-cited?", pose: 'analyzing', giveUp: "Asking for a friend." },
        { text: "On a scale of 1 to 10, how confused are you by this graph?", pose: 'confused', giveUp: "I'm at a 7. On a good day." },
        { text: "I have a secret about this lineage.", pose: 'excited', giveUp: "I lied. But hi!" },
      ];
      const b = baits[Math.floor(Math.random() * baits.length)];
      this._goTo(b.pose, 400);

      // Show clickable bubble
      this._showClickableBub(b.text, () => {
        this.say("Ha! You actually clicked.", 3000);
        this._goTo('laughing', 350);
        setTimeout(() => { this.state = 'sitting'; this._goTo('typing', 500); }, 3500);
      });

      // Give up after 5 seconds if not clicked
      setTimeout(() => {
        if (this._clickableBubActive) {
          this._hideClickableBub();
          this._goTo('sad', 400);
          this.say(b.giveUp, 3000);
          setTimeout(() => { this.state = 'sitting'; this._goTo('typing', 500); }, 3500);
        }
      }, 5000);
    }

    /** Show a clickable speech bubble */
    _showClickableBub(text, onClick) {
      this._clickableBubActive = true;
      this._showBub(text, 0);
      if (this.bubText) {
        this.bubText.style.cursor = 'pointer';
        this.bubText.style.textDecoration = 'underline';
        this._clickHandler = () => {
          this._clickableBubActive = false;
          this.bubText.style.cursor = '';
          this.bubText.style.textDecoration = '';
          this.bubText.removeEventListener('click', this._clickHandler);
          onClick();
        };
        this.bubText.addEventListener('click', this._clickHandler);
      }
    }

    _hideClickableBub() {
      this._clickableBubActive = false;
      if (this.bubText && this._clickHandler) {
        this.bubText.style.cursor = '';
        this.bubText.style.textDecoration = '';
        this.bubText.removeEventListener('click', this._clickHandler);
      }
      this._hideBub();
    }

    /** Random self-portal adventure — character leaves on its own when bored */
    _trySelfPortal() {
      if (window._researcherInWindow) return;
      if (this.state !== 'sitting' && this.state !== 'reading' && this.state !== 'coffee') return;

      const idleDuration = Date.now() - (this._idleStart || Date.now());
      if (idleDuration < 90000 || idleDuration > 150000) return; // only in 90-150s window
      if (Math.random() > 0.10) return; // 10% chance

      this._selfPortalActive = true;
      this.say("I'm bored. Going on a trip.", 2500);
      this._goTo('excited', 300);

      // Trigger portal exit
      setTimeout(() => {
        // Guard: abort if user already opened the pathfinder window
        if (window._researcherInWindow) { this._selfPortalActive = false; return; }
        if (window._windowManager?._portalCharacterToWindow) {
          window._windowManager._portalCharacterToWindow();

          // Update gone sign message
          setTimeout(() => {
            const msg = document.querySelector('.pf-gone-message');
            if (msg) msg.textContent = "Left of his own will. He'll be back.";
          }, 3600);

          // Auto-return after 15-30 seconds
          const returnDelay = 15000 + Math.random() * 15000;
          setTimeout(() => {
            if (!this._selfPortalActive) return; // user already brought them back
            // Guard: don't return if pathfinder window is open
            if (window._windowManager?.windows?.has('pathfinder')) { this._selfPortalActive = false; return; }
            this._selfPortalActive = false;

            // Pop back instantly (no reverse animation per spec)
            if (window._windowManager?._portalCharacterBack) {
              window._windowManager._portalCharacterBack();
            }

            const returnLines = [
              "I went to check on the other graphs. They're boring.",
              "Came back. The portal smells like old papers.",
              "I visited the donut chart's dimension. It's just colors.",
              "Went to Blind Spots. The eye is... intense.",
              "I tried to leave the website entirely. Didn't work.",
              "Back. Did you miss me? Of course you did.",
              "Went for a walk. There's nothing outside this panel.",
              "The other tabs are overrated.",
            ];
            setTimeout(() => {
              this.say(returnLines[Math.floor(Math.random() * returnLines.length)], 4000);
            }, 500);
          }, returnDelay);
        }
      }, 3000);
    }

    _setState(ns) {
      this.state = ns; this._setZzz(ns === 'sleeping');
      switch (ns) {
        case 'reading': case 'coffee': break;
        case 'greeting': this._goTo('waving', 320); this._showBub(this._pick(this.GREET)); this.hintEl.textContent = 'click me · keep clicking...'; break;
        case 'annoyed': this._goTo('annoyed', 280); this._showBub(this._pick(this.ANNOY)); break;
        case 'angry':
          this._goTo('angry', 180); this._showBub(this._pick(this.RAGE));
          this.cv.style.animation = 'resCharShake 0.07s linear infinite';
          setTimeout(() => {
            this.cv.style.animation = ''; this.angryLock = false; this.clicks = 0; this._syncMeter();
            if (this.hovered) this._setState('greeting');
            else { this._setState('calming'); this._showBub(this._pick(this.CALM), 3500); setTimeout(() => { if (this.state === 'calming') { this.state = 'sitting'; this._goTo('typing', 600); } }, 4200); }
          }, 5000); break;
        case 'calming': this._goTo('calming', 500); break;
        case 'sleeping': this._goTo('sleeping', 900); this._hideBub(); this.hintEl.textContent = 'he fell asleep · click to wake him'; break;
        case 'startled': this._goTo('startled', 110); this._showBub(this._pick(this.WAKE), 2600); setTimeout(() => { this.state = 'sitting'; this._goTo('typing', 600); this._resetIdle(); this.hintEl.textContent = 'hover to say hello · click to interact'; }, 3100); break;
        // ── New Pathfinder states ──
        case 'analyzing': this._goTo('analyzing', 400); break;
        case 'typing': this._goTo('typing', 600); break;
        case 'confused': this._goTo('confused', 350); break;
        case 'excited': this._goTo('excited', 300); break;
        case 'laughing': this._goTo('laughing', 350); break;
        case 'pointing': this._goTo('pointing', 400); break;
        case 'presenting': this._goTo('presenting', 400); break;
        case 'sad': this._goTo('sad', 400); break;
        case 'worried': this._goTo('worried', 350); break;
        case 'celebrating': this._goTo('celebrating', 300); break;
      }
    }

    _tickIdle(ts) {
      if (this.angryLock) return;
      const RP = 5200, CP = 6200, SIT_DURATION = 10000;

      if (this.state === 'sitting') {
        // Sitting at laptop — typing pose
        if (this.curP !== 'typing' && !this.nxtP) this._goTo('typing', 600);
        if (ts - this.lastSwitch > SIT_DURATION) {
          this.lastSwitch = ts;
          this.state = 'reading';
          this._goTo('reading_down', 500); // stands up
        }
      } else if (this.state === 'reading') {
        const ph = (ts % RP) / RP;
        if (ph < 0.36) { if (this.curP !== 'reading_down' && !this.nxtP) this._goTo('reading_down', 750); }
        else if (ph < 0.50) { if (this.curP !== 'reading_mid' && !this.nxtP) this._goTo('reading_mid', 430); }
        else if (ph < 0.88) { if (this.curP !== 'reading_up' && !this.nxtP) this._goTo('reading_up', 750); }
        else { if (this.curP !== 'reading_mid' && !this.nxtP) this._goTo('reading_mid', 430); }
        if (ts - this.lastSwitch > 9000) { this.lastSwitch = ts; this.state = 'coffee'; }
      } else if (this.state === 'coffee') {
        const ph = (ts % CP) / CP;
        if (ph < 0.34) { if (this.curP !== 'coffee_lowered' && !this.nxtP) this._goTo('coffee_lowered', 750); }
        else if (ph < 0.66) { if (this.curP !== 'coffee_raised' && !this.nxtP) this._goTo('coffee_raised', 900); }
        else { if (this.curP !== 'coffee_lowered' && !this.nxtP) this._goTo('coffee_lowered', 750); }
        if (ts - this.lastSwitch > 9000) {
          this.lastSwitch = ts;
          this.state = 'sitting'; // sit back down
          this._goTo('typing', 600);
        }
      }
    }

    // ── Events ──
    _bindEvents(scene) {
      scene.addEventListener('mousemove', (e) => {
        const r = this.cv.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside && !this.hovered && this.state === 'reading' && !this.angryLock) {
          const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
          const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
          if (Math.sqrt(dx * dx + dy * dy) < 90) this._goTo('reading_up', 600);
        }
      });

      this.cv.addEventListener('mouseenter', () => {
        this.hovered = true;
        if (this.state === 'sleeping') return;
        if (this.angryLock || this.state === 'angry') return;

        // Multi-step greeting chain
        if (this.state === 'sitting' || this.curP === 'typing') {
          // From sitting: stand up → look → wave (~1.2s)
          this._goTo('reading_down', 500); // stand up
          setTimeout(() => {
            if (!this.hovered) return;
            this._goTo('reading_up', 300); // look at user
            setTimeout(() => {
              if (!this.hovered) return;
              this._setState('greeting'); // wave + greeting bubble
            }, 400);
          }, 600);
        } else {
          // Already standing: look → wave (~0.6s)
          this._goTo('reading_up', 300);
          setTimeout(() => {
            if (!this.hovered) return;
            this._setState('greeting');
          }, 400);
        }
        this._resetIdle();
      });

      this.cv.addEventListener('mouseleave', () => {
        this.hovered = false;
        if (this.state === 'greeting') {
          this._hideBub();
          this.state = 'sitting';
          this.lastSwitch = performance.now();
          // Multi-step leave: wave → stand → sit
          this._goTo('reading_mid', 400);
          setTimeout(() => { if (!this.hovered) this._goTo('reading_down', 500); }, 500);
          setTimeout(() => { if (!this.hovered && this.state === 'sitting') this._goTo('typing', 600); }, 3500);
        }
        if (this.state === 'annoyed' && !this.angryLock) {
          this._hideBub();
          this.state = 'sitting';
          this.lastSwitch = performance.now();
          this._goTo('reading_down', 600);
          setTimeout(() => { if (!this.hovered) this._goTo('typing', 600); }, 3000);
          this.clicks = 0;
          this._syncMeter();
        }
        this._resetIdle();
      });

      this.cv.addEventListener('click', () => {
        if (this.state === 'sleeping') {
          // Capture idle duration BEFORE resetting (otherwise it's always 0)
          const idleDuration = Date.now() - (this._idleStart || Date.now());
          this._resetIdle();
          if (idleDuration > 240000) { // 4+ minutes = deep sleep
            const deepWake = [
              "If you can go and come back why can't I?!",
              "FINE. I'm up. WHAT.",
              "DO YOU KNOW WHAT TIME IT IS?",
              "I was dreaming about a world without user clicks.",
            ];
            this._goTo('angry', 200);
            this.say(deepWake[Math.floor(Math.random() * deepWake.length)], 4000);
            this._setZzz(false);
            setTimeout(() => { this.state = 'sitting'; this._goTo('typing', 600); this._resetIdle(); this.hintEl.textContent = 'hover to say hello · click to interact'; }, 4500);
          } else {
            this._setState('startled');
          }
          return;
        }
        this._resetIdle(); // reset idle for non-sleeping clicks
        if (this.angryLock) return;
        this.clicks++; this._syncMeter();
        if (this.cTimer) clearTimeout(this.cTimer);
        this.cTimer = setTimeout(() => {
          this.clicks = Math.max(0, this.clicks - 2); this._syncMeter();
          if (this.clicks < 4 && this.state === 'annoyed') { this._hideBub(); if (this.hovered) this._setState('greeting'); else { this.state = 'sitting'; this.lastSwitch = performance.now(); this._goTo('typing', 600); } }
        }, 2800);
        if (this.clicks >= 8) { this.angryLock = true; this._setState('angry'); }
        else if (this.clicks >= 4) this._setState('annoyed');
        else if (this.state === 'greeting') this._showBub(this._pick(this.GREET));
      });
    }
  }

  return ResearcherCharacter;
})();
