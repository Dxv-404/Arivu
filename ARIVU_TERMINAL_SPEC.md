# ARIVU TERMINAL & SCRIPT SYSTEM — Implementation Reference v2.1

> **Purpose:** Implementation reference documenting the CURRENT STATE of the Arivu Terminal: what IS built, how it works, exact code references, bugs, edge cases, and data flows. This is NOT the target spec — the target spec is the user's handwritten **ARIVU TERMINAL & SCRIPT SYSTEM — COMPLETE SPECIFICATION v1.0** (the canonical design document).
>
> **Relationship to target spec:** The target spec describes ~105 features. This document tracks which are built (✅), partial (🔨), or not started (❌). When building, read the TARGET SPEC for what to build, then this document for current implementation details.
>
> **Last audited:** 2026-04-02 · **Gaps found in v1:** 76 · **All addressed in v2**
>
> **Rule:** Update this doc after building. Update the TARGET SPEC before building.

---

## BUILD STATUS TRACKER

### Overall: ~35 of ~105 features built (33%)

| Category | Built | Partial | Not Built | Total |
|----------|-------|---------|-----------|-------|
| Graph Navigation | 4 | 0 | 1 ($VAR) | 5 |
| Annotations | 5 | 0 | 1 ($VAR) | 6 |
| Info Commands | 4 | 0 | 0 | 4 |
| `ls` Subcommands | 2 | 0 | 3 | 5 |
| Session Commands | 7 | 0 | 0 | 7 |
| Script CRUD | 7 | 0 | 0 | 7 |
| Script Run Flags | 0 | 0 | 8 | 8 |
| Script Advanced (diff/edit/history/revert/from-history) | 0 | 0 | 5 | 5 |
| Script Chaining | 0 | 0 | 2 | 2 |
| Script Templates | 0 | 0 | 4 | 4 |
| Variable System | 0 | 0 | 8 | 8 |
| Type System | 0 | 0 | 6 | 6 |
| Editor (:commands) | 0 | 0 | 35 | 35 |
| Hooks | 0 | 0 | 4 | 4 |
| Syntax Highlighting | 6 | 1 | 7 | 14 |
| Autocomplete | 15 | 0 | 3 | 18 |
| Error System | 20 | 1 | 3 | 24 |
| Carousel | 8 | 1 | 1 | 10 |
| DB Sync | 0 | 0 | 4 | 4 |
| **TOTAL** | **~35** | **~3** | **~70** | **~105** |

### Detailed Feature Checklist

```
✅ = Built and working     🔨 = Partial     ❌ = Not built

GRAPH NAVIGATION
  ✅ zoom <paper>
  ✅ highlight <paper>
  ✅ filter <type> (6 types)
  ✅ reset
  ❌ $VARIABLE support in graph commands

ANNOTATIONS
  ✅ annotate <paper> as "<label>"
  ✅ annotate <paper> (default "noted")
  ✅ remove annotation (all/value/paper modes)
  ✅ clear annotations
  ✅ ls annotations
  ❌ $VARIABLE support in annotations

INFO / ANALYSIS
  ✅ info <paper>
  ✅ compare <paper1> and <paper2>
  ✅ path <paper1> to <paper2>
  ✅ find "<search>"

LS EXPANSIONS
  ✅ ls annotations
  ✅ ls papers
  ❌ ls scripts
  ❌ ls variables
  ❌ ls sessions

SESSION MANAGEMENT
  ✅ save session "<name>"
  ✅ load session "<name>"
  ✅ sessions (list + carousel)
  ✅ rename "<new name>"
  ✅ delete session "<name>"
  ✅ export session as text
  ✅ export session as script "<name>"

SCRIPT CRUD
  ✅ script save "<name>" [--desc "..."]
  ✅ script list / scripts
  ✅ script info "<name>"
  ✅ script delete "<name>"
  ✅ script copy "<name>" as "<new>"
  ✅ script export "<name>"
  ✅ script run "<name>" / run "<name>"

SCRIPT RUN FLAGS
  ❌ --verbose
  ❌ --replace
  ❌ --dry
  ❌ --top N
  ❌ --from N
  ❌ --range N-M
  ❌ --set KEY="VALUE"
  ❌ then (chaining)

SCRIPT ADVANCED
  ❌ script from-history N-M as "<name>"
  ❌ script diff "<name1>" "<name2>"
  ❌ script edit "<name>"
  ❌ script history "<name>"
  ❌ script revert "<name>" vN

SCRIPT TEMPLATES
  ❌ script list --templates
  ❌ script copy --template "<name>" as "<new>"
  ❌ 4 built-in templates
  ❌ Template read-only rule

VARIABLE SYSTEM
  ❌ :var (list all)
  ❌ :var $NAME : type = "value"
  ❌ :var $NAME = "value" (inferred type)
  ❌ :var delete $NAME
  ❌ :var clear
  ❌ $VARIABLE substitution in commands
  ❌ $$ escape (literal $)
  ❌ @param declarations in scripts

TYPE SYSTEM
  ❌ paper type + validation
  ❌ label type + validation
  ❌ filter type + validation
  ❌ number type + validation
  ❌ string type
  ❌ bool type

EDITOR (:commands) — 0/35 built
  ❌ :save / :save as "<name>"
  ❌ :quit / :q / :quit!
  ❌ :run N / :run N-M / :runall / :runall --verbose
  ❌ :dry
  ❌ :add / :insert / :edit / :delete / :replace
  ❌ :move / :swap / :duplicate
  ❌ :undo / :redo / :history
  ❌ :N (jump) / :top / :bottom
  ❌ :help / :run-and-quit
  ❌ :var (in editor context)

HOOKS
  ❌ :on-graph-load "<script>"
  ❌ :before-deep-dive "<script>"
  ❌ :hooks (list)
  ❌ :hooks clear

SYNTAX HIGHLIGHTING
  ✅ Valid command keyword (gold)
  🔨 Invalid command keyword (red) — class emitted but NO CSS rule (BUG-003)
  ✅ Operators (teal)
  ✅ Quoted strings (amber)
  ✅ Numbers (teal)
  ✅ Flags --prefix (teal)
  ❌ Variables $NAME (purple)
  ❌ Editor commands :prefix (yellow)
  ❌ @param markers (gray)
  ❌ Context-dependent string colors (blue papers vs amber labels)
  ❌ Hook highlighting
  ❌ Sub-command highlighting
  ❌ Type annotation highlighting

AUTOCOMPLETE
  ✅ Command prefix (15+ commands)
  ✅ Filter types (6)
  ✅ ls targets (annotations, papers)
  ✅ clear targets
  ✅ remove annotation modes
  ✅ script subcommands (7)
  ✅ Script name suggestions
  ✅ Session name suggestions
  ✅ Paper name suggestions (8 contexts)
  ✅ Help command suggestions
  ✅ Compare/path paper suggestions
  ✅ delete session/script suggestions
  ❌ Variable autocomplete ($ prefix)
  ❌ Editor command autocomplete (: prefix)
  ❌ Flag autocomplete (-- prefix)

ERROR SYSTEM
  ✅ Parse errors with usage messages (20 types)
  ✅ Execution errors (14 types)
  🔨 Fuzzy command suggestion ("Did you mean")
  ❌ Formal [E001] error code display format
  ❌ Recovery action suggestions per error
  ❌ Error vs Warning vs Info formal classification

CAROUSEL
  ✅ Sessions tab (3D cards)
  ✅ Scripts tab (3D cards)
  ✅ Tab switching with gold indicator
  ✅ Session detail overlay
  ✅ Script detail overlay
  ✅ Card actions (Open/Run/Replay/Export/Delete)
  ✅ Dot navigation + keyboard
  🔨 Scripts tab design (currently 3D cards, target spec wants list view)
  ❌ ScriptListItem.commandFlow field

UTILITY
  ✅ help [command]
  ✅ history [--errors]
  ✅ clear / clear screen
  ✅ exit
  ✅ deep-dive <paper>
  ✅ pathfinder "<query>"
  ❌ clear variables

DB SYNC (Phase 7)
  ❌ POST /api/terminal/scripts
  ❌ GET /api/terminal/scripts
  ❌ DELETE /api/terminal/scripts/<id>
  ❌ POST /api/terminal/sync
```

---

## TABLE OF CONTENTS

- [Part 1 — Architecture & Design Language](#part-1)
- [Part 2 — File Inventory, Load Order & Versioning](#part-2)
- [Part 3 — DOM Structure (Exact HTML)](#part-3)
- [Part 4 — CSS Architecture (Every Value)](#part-4)
- [Part 5 — Classes & Complete API](#part-5)
- [Part 6 — Command Reference (All 27 Commands)](#part-6)
- [Part 7 — Syntax, Grammar & Tokenization](#part-7)
- [Part 8 — Paper Resolution Algorithm](#part-8)
- [Part 9 — Syntax Highlighting (Exact Color Map)](#part-9)
- [Part 10 — Autocomplete System (Every Context)](#part-10)
- [Part 11 — Error Catalog (34 Error Codes)](#part-11)
- [Part 12 — Data Structures & Storage Schemas](#part-12)
- [Part 13 — Data Flows (Step-by-Step)](#part-13)
- [Part 14 — Graph Integration (4 Annotation Paths)](#part-14)
- [Part 15 — Athena Integration](#part-15)
- [Part 16 — Carousel System (3D, Tabs, Detail Views)](#part-16)
- [Part 17 — Script System](#part-17)
- [Part 18 — Event Listeners & Lifecycle](#part-18)
- [Part 19 — Window Globals](#part-19)
- [Part 20 — Hardcoded Limits & Configuration](#part-20)
- [Part 21 — Edge Cases (Comprehensive)](#part-21)
- [Part 22 — Known Bugs (19 Items, Audited)](#part-22)
- [Part 23 — Z-Index Stacking Order](#part-23)
- [Part 24 — Planned: Phase 2 — Run Flags & Chaining](#part-24)
- [Part 25 — Planned: Phase 3 — Notebook Script Editor](#part-25)
- [Part 26 — Planned: Phase 4 — Type System & Variables](#part-26)
- [Part 27 — Planned: Phase 5 — Smart Autocomplete](#part-27)
- [Part 28 — Planned: Phase 6 — Versioning, Diff, Templates, Hooks](#part-28)
- [Part 29 — Planned: Phase 7 — DB Sync & Polish](#part-29)

---

<a id="part-1"></a>
## Part 1 — Architecture & Design Language

### 1.1 What the Terminal Is

A **domain-specific shell** for interacting with academic paper lineage graphs. NOT a general-purpose terminal. Commands are graph-aware: they resolve paper names, manipulate visualizations, and delegate to Athena AI.

### 1.2 Component Map

```
┌──────────────────────────────────────────────────────────────────────┐
│  tool.html (host page)                                               │
│                                                                      │
│  ┌──────────────────┐   ┌──────────────────────────────────────────┐│
│  │ ArivuTerminal    │   │ TerminalSessionCarousel                  ││
│  │ (window on body) │   │ (overlay on body)                        ││
│  │                  │   │                                          ││
│  │ ┌──────────────┐ │   │ ┌────────────┐  ┌─────────────────────┐ ││
│  │ │ Parser       │ │   │ │ Sessions   │  │ Scripts Tab         │ ││
│  │ │              │ │   │ │ Tab (3D)   │  │ (3D cards)          │ ││
│  │ │ ArivuTerminal│ │   │ └────────────┘  └─────────────────────┘ ││
│  │ │ Parser       │ │   │                                          ││
│  │ └──────────────┘ │   │ ┌─────────────────────────────────────┐ ││
│  │                  │   │ │ Detail Overlay (session OR script)  │ ││
│  └──────┬───────────┘   │ └─────────────────────────────────────┘ ││
│         │               └──────────────────────────────────────────┘│
│  ┌──────┴───────────┐   ┌──────────────────────────────────────────┐│
│  │ TerminalManager  │   │ ArivuScriptStorage                      ││
│  │ (registry)       │   │ (localStorage CRUD)                     ││
│  └──────────────────┘   └──────────────────────────────────────────┘│
│                                                                      │
│  EXTERNAL DEPS (not owned):                                          │
│  window._arivuGraph     │ window.athenaGraphCommands                │
│  window.athenaEngine    │ window._treeLayout                        │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 Design Language

| Attribute | Actual Value (from CSS) |
|-----------|------------------------|
| Terminal font | `'JetBrains Mono', 'Fira Code', 'Consolas', monospace` |
| Carousel/card font | `'VT323', 'JetBrains Mono', monospace` |
| Annotation font | `'Array', 'JetBrains Mono', monospace` (from Fontshare) |
| Terminal background | `#0D1117` (`--term-bg`) |
| Terminal surface | `#161B22` (title bar, autocomplete) |
| Carousel backdrop | `rgba(0, 0, 0, 0.88)` |
| Primary accent | `#D4A843` (gold — commands, cursor, active indicators) |
| Prompt color | `#22C55E` (green — NOT gold) |
| Window chrome | macOS-style dots: red `#EF4444`, yellow `#F59E0B`, green `#22C55E` |
| Terminal font size | `12px` everywhere (output, input, highlight) |
| Card font size | `16px` (VT323 — larger because VT323 renders small) |

---

<a id="part-2"></a>
## Part 2 — File Inventory, Load Order & Versioning

### 2.1 Source Files

| File | Lines | Purpose |
|------|-------|---------|
| `static/js/arivu-terminal-parser.js` | ~670 | Parsing, highlighting, autocomplete, paper resolution |
| `static/js/arivu-terminal.js` | ~1400 | ArivuScriptStorage + ArivuTerminal + TerminalManager |
| `static/js/terminal-carousel.js` | ~975 | 3D carousel, tabs, session/script detail views |
| `static/css/arivu-terminal.css` | 318 | Terminal window styling, all syntax colors |
| `static/css/terminal-carousel.css` | ~680 | Carousel 3D, cards, tabs, detail overlays |

### 2.2 Load Order (CRITICAL — order matters)

```html
<!-- 1. CSS (in <head>) -->
<link href="arivu-terminal.css?v=2">
<link href="terminal-carousel.css?v=9">
<link href="https://fonts.googleapis.com/css2?family=VT323">        <!-- External -->
<link href="https://api.fontshare.com/v2/css?f[]=array@400,700">    <!-- External -->

<!-- 2. JS (deferred, MUST be in this order) -->
<script src="arivu-terminal-parser.js?v=4" defer>   <!-- 1st: no deps -->
<script src="arivu-terminal.js?v=8" defer>           <!-- 2nd: uses Parser -->
<script src="terminal-carousel.js?v=4" defer>        <!-- 3rd: uses TerminalManager -->
```

**Why order matters:** Terminal constructor creates `new ArivuTerminalParser()`. Carousel reads `window.terminalManager`. If loaded out of order → `ReferenceError`.

### 2.3 Cache Version Table

Bump the `?v=N` parameter when modifying a file.

| File | Current | Last Changed |
|------|---------|-------------|
| `arivu-terminal-parser.js` | v=4 | Phase 1 Scripts |
| `arivu-terminal.js` | v=8 | Phase 1 Scripts |
| `terminal-carousel.js` | v=4 | Phase 1 Scripts |
| `arivu-terminal.css` | v=2 | Initial build |
| `terminal-carousel.css` | v=9 | Phase 1 Scripts (tabs) |

---

<a id="part-3"></a>
## Part 3 — DOM Structure (Exact HTML)

### 3.1 Terminal Window

Created by `_buildDOM()`. Appended to `document.body` (NOT inside any layout container).

```html
<div class="arivu-terminal-window" id="term_1">
  <!-- Title Bar -->
  <div class="term-titlebar">
    <div class="term-title-left">
      <div class="term-dots">
        <span class="term-dot term-dot--close" title="Close"></span>
        <span class="term-dot term-dot--minimize" title="Minimize"></span>
        <span class="term-dot term-dot--maximize" title="Maximize"></span>
      </div>
      <span class="term-title-text">Arivu Terminal — #1</span>
    </div>
    <div class="term-title-right">
      <button class="term-btn-icon" title="Toggle auto-complete" data-action="toggle-ac">⇥</button>
      <button class="term-btn-icon" title="New terminal" data-action="new-term">+</button>
    </div>
  </div>

  <!-- Scrollable Output Area -->
  <div class="term-output">
    <!-- Lines appended here by _print() and _printRaw() -->
    <div class="term-line term-line--welcome">╔═══...═══╗</div>
    <div class="term-line term-line--info">Graph: Deep Residual...</div>
    <!-- ... -->
  </div>

  <!-- Input Area -->
  <div class="term-input-row" style="position:relative;">
    <span class="term-prompt-text">arivu:deep-residual-learni$</span>
    <div class="term-input-wrapper">
      <div class="term-input-highlight" aria-hidden="true">
        <!-- Syntax-highlighted HTML mirror of input value -->
      </div>
      <input class="term-input" type="text"
             placeholder="type 'help' to start..."
             spellcheck="false" autocomplete="off">
    </div>
    <div class="term-autocomplete">
      <!-- AC items appear here when visible -->
    </div>
  </div>
</div>
```

### 3.2 Prompt Format

The input prompt is: `arivu:${slug}$` where:
```javascript
slug = seedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 20)
```
Example: `arivu:deep-residual-learni$`

The **echoed prompt** in output uses a simpler format: `arivu$` (no slug).

### 3.3 Welcome Banner (Exact ASCII Art)

```
╔═══════════════════════════════════════════════╗
║                                               ║
║     █████╗ ██████╗ ██╗██╗   ██╗██╗   ██╗     ║
║    ██╔══██╗██╔══██╗██║██║   ██║██║   ██║     ║
║    ███████║██████╔╝██║██║   ██║██║   ██║     ║
║    ██╔══██║██╔══██╗██║╚██╗ ██╔╝██║   ██║     ║
║    ██║  ██║██║  ██║██║ ╚████╔╝ ╚██████╔╝     ║
║    ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═════╝     ║
║                                               ║
║        Research Intelligence Terminal          ║
║           v1.0 · type 'help' to start         ║
╚═══════════════════════════════════════════════╝

Graph: Deep Residual Learning for Image Recogn
601 papers · 847 edges
3 annotations active
```

### 3.4 Window Dimensions & Positions

| State | Width | Height | Position | Resize |
|-------|-------|--------|----------|--------|
| Default (initial CSS) | 560px | 380px | `bottom:80px; left:20px` | `resize:both` (browser-native) |
| Minimized | (unchanged) | 32px (forced) | (unchanged) | `resize:none` |
| Maximized | 100vw | 60vh | `left:0; bottom:0; right:0` | (unchanged) |
| Restored from max | 560px | 380px | `right:20px; bottom:60px` | (unchanged) |
| Min constraints | 380px min-width | 220px min-height | — | — |

**Known inconsistency:** Initial position is `left:20px; bottom:80px` but restore-from-maximize sets `right:20px; bottom:60px`. Different corners.

**Drag behavior:** No viewport boundary clamping. Terminal can be dragged completely off-screen.

---

<a id="part-4"></a>
## Part 4 — CSS Architecture (Every Value)

### 4.1 CSS Custom Properties (ACTUAL values from code)

```css
:root {
  --term-bg:        #0D1117;   /* Terminal background */
  --term-surface:   #161B22;   /* Title bar, AC dropdown */
  --term-border:    #30363D;   /* All borders */
  --term-text:      #E6EDF3;   /* Default text — NOTE: NOT #C9D1D9 */
  --term-prompt:    #22C55E;   /* Prompt text — NOTE: GREEN, not gold */
  --term-cmd:       #D4A843;   /* Command keywords (gold) */
  --term-paper:     #3B82F6;   /* Paper references (blue) */
  --term-string:    #F59E0B;   /* String values (amber) */
  --term-data:      #06B6D4;   /* Data values + operators (teal) */
  --term-error:     #EF4444;   /* Error text (red) — NOTE: NOT #F85149 */
  --term-warning:   #F59E0B;   /* Warning text (amber) */
  --term-success:   #22C55E;   /* Success text (green) */
  --term-comment:   #64748B;   /* Comment text (gray) */
  --term-cursor:    #D4A843;   /* Cursor + blink (gold) */
  --term-selection: #264F78;   /* Text selection background — NOTE: NOT rgba() */
  --term-scrollbar: #30363D;   /* Scrollbar thumb */
}
```

### 4.2 Animations

| Name | Duration | Easing | Effect |
|------|----------|--------|--------|
| `termOpen` | 200ms | ease | `opacity:0 + translateY(20px) scale(0.95)` → normal |
| `termBlink` | 1s | step-end infinite | Cursor opacity 1→0 at 50% |
| `detailIn` (carousel) | 300ms | ease | `opacity:0 + scale(0.92)` → normal |
| Card delete (inline JS) | 300ms | ease | `opacity:0 + scale(0.8)` |
| Carousel overlay | 300ms | CSS transition | `opacity:0` → `opacity:1` |

### 4.3 Scrollbar Styling

```css
.term-output {
  scrollbar-width: thin;                            /* Firefox */
  scrollbar-color: var(--term-scrollbar) transparent;
}
.term-output::-webkit-scrollbar { width: 6px; }
.term-output::-webkit-scrollbar-track { background: transparent; }
.term-output::-webkit-scrollbar-thumb { background: #30363D; border-radius: 3px; }
```

### 4.4 The Highlight Overlay Technique

The input uses a "hidden input + visible overlay" trick:
1. `<input class="term-input">` has `color: transparent` — text invisible
2. `<div class="term-input-highlight">` sits behind it with identical font metrics
3. Input has `z-index: 1` so caret and selection work
4. Highlight overlay has `pointer-events: none` so clicks pass through
5. Both use identical: `font-family, font-size: 12px, line-height: 1.5, padding: 0`
6. `::selection` on input uses `background: var(--term-selection); color: var(--term-text)` to make selection visible

### 4.5 Unused CSS Classes

| Class | Exists In CSS | Used In JS | Status |
|-------|--------------|-----------|--------|
| `.term-info-box` | Yes (lines 159-165) | No | **Dead CSS** — remove or use |
| `.term-typewriter` | Yes (lines 298-304) | No | **Dead CSS** — planned for future |
| `.term-error` (as standalone) | **No rule** | Yes (parser highlight) | **BUG — needs rule** |

### 4.6 Paper Reference Visual Affordance

`.term-paper-ref` has `cursor: pointer; text-decoration: underline dotted` suggesting clickability, but **no click handler exists**. Clicking paper names in output does nothing. This is a visual lie.

---

<a id="part-5"></a>
## Part 5 — Classes & Complete API

### 5.1 ArivuScriptStorage

**File:** `arivu-terminal.js` (lines 14-135) · **Global:** `window.arivuScriptStorage`

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `_load()` | `()` | `Script[]` | Parse localStorage, `[]` on error |
| `_save(scripts)` | `(Script[])` | void | Write localStorage. **Silent failure on quota exceeded.** |
| `list()` | `()` | `Script[]` | All scripts |
| `get(name)` | `(string)` | `Script \| undefined` | Case-insensitive name match |
| `save(name, commands, meta?)` | `(string, string[], {description?, tags?})` | `Script` | Create or update. **Auto-bumps version.** Max 20 version history. |
| `delete(name)` | `(string)` | `boolean` | true if found and removed |
| `copy(srcName, newName)` | `(string, string)` | `Script \| null` | null if source not found |
| `recordRun(name)` | `(string)` | void | Increment runCount + set lastRun |
| `toArivuFormat(script)` | `(Script)` | `string` | `.arivu` formatted text |

### 5.2 ArivuTerminal

**File:** `arivu-terminal.js` (lines 142-1345) · **Global:** `window.ArivuTerminal`

**Constructor:** `new ArivuTerminal(id?, graphData?)`
- `id`: defaults to `'term_' + Date.now().toString(36)`
- `graphData`: defaults to `window._arivuGraph?.graphData || {}`

**Key Properties:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `id` | string | auto-generated | Terminal instance ID |
| `parser` | ArivuTerminalParser | new instance | Parser with graph data snapshot |
| `history` | string[] | `[]` | ALL raw inputs (including meta commands) |
| `historyIndex` | number | -1 | Arrow-key navigation position |
| `log` | LogEntry[] | `[]` | Structured execution log |
| `autoCompleteEnabled` | boolean | true | AC toggle |
| `isAnimating` | boolean | false | Typewriter in progress |
| `animSpeed` | number | 40 | ms per character (3 on dblclick) |
| `linkedSessionId` | string \| null | null | Auto-save target |
| `_pendingConfirm` | function \| null | null | y/n confirmation callback |
| `el` | HTMLElement | — | Root `.arivu-terminal-window` |
| `outputEl` | HTMLElement | — | `.term-output` |
| `inputEl` | HTMLInputElement | — | `.term-input` |
| `highlightEl` | HTMLElement | — | `.term-input-highlight` |
| `acDropdown` | HTMLElement | — | `.term-autocomplete` |

**All Methods:** (47 total)

| Category | Methods |
|----------|---------|
| DOM | `_buildDOM`, `_attachEvents`, `_initDrag`, `_showWelcome` |
| Execution | `_execute`, `_executeCommand`, `_runScript` |
| Output | `_print`, `_printRaw`, `_showPaperInfo`, `_showCompare`, `_showHelp` |
| Paper | `_suggestPapers`, `_getPaperRank` |
| Annotation | `_removeAnnotationFromGraph`, `_fallbackAnnotate` |
| Session | `_updateTitle`, `_autoSave` |
| Input | `_updateHighlight`, `_showACSuggestions`, `_navigateAC`, `_handleTab`, `_hideAC` |
| Animation | `typeAndExecute` |
| Window | `close`, `toggleMinimize`, `toggleMaximize`, `focus` |

### 5.3 ArivuTerminalParser

**File:** `arivu-terminal-parser.js` (lines 9-668) · **Global:** `window.ArivuTerminalParser`

**Constructor:** `new ArivuTerminalParser(graphData?)`
- Stores `this.nodes = graphData?.nodes || []`
- **NOTE:** This is a SNAPSHOT at creation time, not a live reference

**Command Registry:** 22 commands with `{args, desc}` metadata.

**Operator Set:** `as, to, from, in, by, and, or, not, value, paper`

**Filter Types:** `bottlenecks, most-cited, least-cited, contradictions, highest-impact, all`

### 5.4 TerminalSessionCarousel

**File:** `terminal-carousel.js` · **Global:** `window.terminalCarousel`

**Key State:**

| Property | Type | Default |
|----------|------|---------|
| `sessions` | Session[] | loaded from localStorage |
| `activeIndex` | number | 0 |
| `activeTab` | string | `'sessions'` |
| `isOpen` | boolean | false |
| `el` | HTMLElement \| null | null |

### 5.5 TerminalManager

**File:** `arivu-terminal.js` (lines 1350-1391) · **Global:** `window.terminalManager`

| Method | Description |
|--------|-------------|
| `create()` | Creates terminal, augments graphData from live `_arivuGraph`, registers in `this.terminals` map |
| `remove(id)` | Delete from map (does NOT close the terminal DOM) |
| `getActive()` | Returns last (most recently created) terminal |
| `closeAll()` | Calls `close()` on each terminal |

**Data augmentation on create():** Copies `metadata`, `allNodes`, `allEdges` from `window._arivuGraph` onto graphData. This means the parser gets a snapshot, not live data.

---

<a id="part-6"></a>
## Part 6 — Command Reference (All 27 Commands)

### 6.1 Graph Navigation Commands

#### `zoom <paper>`
```
Syntax:    zoom resnet
           zoom "Deep Residual Learning"
Resolves:  Fuzzy paper resolution (see Part 8)
Delegates: athenaGraphCommands.executeCommand({action:'zoom', target:<resolved title>})
Output:    ✓ Zoomed to "Deep Residual Learning for Image Recognition"
Error:     ✗ Paper not found: 'xyz' + "Did you mean:" suggestions
⚠ BUG:    Prints success even if athenaGraphCommands is null (nothing happens on graph)
```

#### `highlight <paper>`
```
Syntax:    highlight resnet
Delegates: athenaGraphCommands.executeCommand({action:'highlight', target:<title>})
Output:    ✓ Highlighted "..."
⚠ BUG:    Same null-delegation issue as zoom
```

#### `filter <type>`
```
Syntax:    filter bottlenecks
Types:     bottlenecks | most-cited | least-cited | contradictions | highest-impact | all
Delegates: athenaGraphCommands.executeCommand({action:'filter', target:<type>})
Output:    ✓ Filter applied: bottlenecks
⚠ BUG:    Same null-delegation issue
```

#### `reset`
```
Syntax:    reset
Delegates: athenaGraphCommands.executeCommand({action:'reset', target:''})
Output:    ✓ Graph reset
⚠ BUG:    Same null-delegation issue
```

### 6.2 Annotation Commands

#### `annotate <paper> as "<label>"`
```
Syntax:    annotate resnet as "key paper"
           annotate resnet              (defaults label to "noted")
Label:     Max 20 characters (silently truncated to 18 + "..")
Graph:     graph.addAnnotation(id, label, 'gold') — or _fallbackAnnotate if unavailable
Tree:      _treeLayout.addAnnotation(id, label, 'gold') — if available
Storage:   sessionStorage[athena_annotations_{graphId}]
Output:    ✓ Annotated "..." as "key paper"
           PageRank: #1 · Citations: 216,943
⚠ NOTE:   "PageRank" label is misleading — actually citation-count rank (BUG-012)
⚠ LIMIT:  graph.addAnnotation silently rejects if 15 annotations already exist
```

#### `remove annotation [mode]`
```
4 modes:
  remove annotation               → remove ALL annotations
  remove annotation value "label" → remove by label text (case-insensitive)
  remove annotation paper "name"  → remove by paper name
  remove annotation "name"        → treated as "by paper" (default)

Storage: Reads/writes sessionStorage[athena_annotations_{graphId}]
Graph:   Calls _removeAnnotationFromGraph() which handles force graph + tree layout
```

#### `clear annotations`
```
Syntax:  clear annotations
Action:  graph.getAnnotations() → graph.removeAnnotation(pid) for each
⚠ NOTE:  Different code path than "remove annotation" (all mode). May not clean
          sessionStorage consistently.
```

#### `clear` / `clear screen`
```
Syntax:  clear   OR   clear screen
Action:  outputEl.innerHTML = ''
```

#### `ls annotations`
```
Output:  ● Paper Title → "label"     (for each annotation)
Source:  graph.getAnnotations() with sessionStorage fallback
Empty:   "No annotations active."
```

#### `ls papers`
```
Output:  Top 10 papers sorted by citation count
Format:  <citations>  <title> (<year>)
```

### 6.3 Analysis Commands

#### `info <paper>`
```
Syntax:  info resnet
Output:  ASCII box:
┌─────────────────────────────────────────────────┐
│ Deep Residual Learning for Image Recognition     │
│ Year: 2016     Citations: 216,943               │
│ PageRank: #1 · Depth: 0                         │
│ Bottleneck: Yes · Impact: 600%                  │
│ Fields: Computer science, Artificial intelligence│
└─────────────────────────────────────────────────┘
⚠ "PageRank" is actually citation rank (BUG-012)
```

#### `compare <paper1> , <paper2>`
```
Syntax:  compare resnet , alexnet
         compare resnet and alexnet
Separator: comma or "and" keyword
Output:  ASCII comparison table (year, citations, bottleneck)
```

#### `path <paper1> to <paper2>`
```
Syntax:    path resnet to alexnet
Delegates: athenaEngine.handleUserMessage('trace the path from "<title1>" to "<title2>"')
⚠ NOTE:   Exact message string matters — Athena's intent detection depends on it
```

#### `deep-dive <paper>`
```
Syntax:    deep-dive resnet
Delegates: athenaEngine.handleUserMessage('deep dive on "<title>"')
```

#### `pathfinder "<query>"`
```
Syntax:    pathfinder "what makes this paper unique"
Delegates: athenaEngine.handleUserMessage(<raw query>)
```

#### `find "<search>"`
```
Syntax:  find "convolutional"
Output:  Up to 10 papers with title containing substring
Format:  <title> (<year>) · <citations> cites
```

### 6.4 Session Commands

#### `save session "<name>"`
```
Saves:    history[], log[], annotations snapshot → carousel localStorage
Links:    Sets linkedSessionId for auto-save
Output:   ✓ Session saved: <name>  +  N commands, M annotations
```

#### `load session "<name>"`
```
Loads:    history, log from session → terminal state
Restores: Annotations to graph (calls _arivuGraph.restoreAnnotations if available)
Links:    Sets linkedSessionId
Updates:  session.lastActive → triggers carousel._saveSessions()
Output:   ✓ Loaded: <name>  +  N commands, M annotations
```

#### `sessions`
```
Output:   ASCII table: #, Name, Date, Cmds, Status
Action:   Opens carousel after 800ms delay
```

#### `rename "<new name>"`
```
Target:   linkedSessionId OR most recent session
Output:   ✓ Renamed: "old" → "new"
```

#### `delete session "<name>"`
```
Prompt:   ⚠ Delete "name"? This cannot be undone.
Confirm:  y/yes → delete; anything else → cancel
⚠ NOTE:   No visual indicator that y/n is expected (BUG-007)
```

### 6.5 Script Commands

#### `script save "<name>" [--desc "<description>"]`
```
Filters:   Removes meta commands from history: save, load, sessions, help, history,
           export, clear, exit, rename, delete, scripts, run, script
           Also removes lines starting with #
Version:   Auto-increments on overwrite. Max 20 version history entries.
Output:    ✓ Script saved: "name" (v1)  +  N commands
```

#### `script list` (alias: `scripts`)
```
Output:   ASCII table: #, Name (22 chars), Cmds, Ver, Runs, Graph
```

#### `script info "<name>"`
```
Output:   Boxed display: name, description, version, commands count, dates, runs,
          graph, first 6 commands preview
```

#### `script delete "<name>"`
```
Prompt:   ⚠ Delete script "name" (v1, 4 commands)?
Confirm:  y/yes → delete; anything else → cancel
```

#### `script copy "<name>" as "<new-name>"`
```
Output:   ✓ Copied: "name" → "new-name"  +  N commands
Desc:     New script description: "Copy of: <original description>"
```

#### `script run "<name>"` (alias: `run "<name>"`)
```
Execution: Sequential with 150ms delay between commands
Progress:  [1/N] <highlighted command>
           ✓ or ✗ result
Summary:   Complete: X/Y OK, Z errors (Ns)
```

#### `script export "<name>"`
```
Output:   .arivu format → clipboard
Format:   See Part 12.8
```

#### `export session as script "<name>"`
```
Action:   Saves session commands as new script in ArivuScriptStorage
Filter:   DIFFERENT from script save — does NOT filter "script" keyword
⚠ BUG:   Meta filter inconsistency (BUG-019)
```

#### `export session as text`
```
Action:   Copies session log to clipboard as plain text
Format:   "Arivu Terminal Session\n═══...\n✓ cmd1\n✗ cmd2\n..."
```

### 6.6 Utility Commands

#### `help [command]`
```
No args:   Categorized list (6 sections):
           Graph Navigation | Annotations | Analysis | Sessions | Scripts | Utility
With arg:  Single command usage + description
```

#### `history [--errors]`
```
Output:   Last 20 log entries
Format:   ✓/✗  HH:MM:SS  <command>
--errors: Only show error entries
```

#### `exit`
```
Action:  el.remove() + terminalManager.remove(id)
⚠ NOTE:  Does NOT clean up document-level event listeners (BUG-002)
```

#### `# comment`
```
Action:  Prints comment in gray italic
Logged:  Yes (status: 'success', parsed: 'comment')
```

---

<a id="part-7"></a>
## Part 7 — Syntax, Grammar & Tokenization

### 7.1 Tokenization Rules (`_tokenize`)

1. Skip whitespace
2. If current char is `"` or `'`: consume until matching quote (or end of input). Token includes quotes.
3. Otherwise: consume until next space. Token is the non-space run.
4. Unclosed quotes consume to end of input.

Examples:
```
Input:  annotate "my paper" as "key"
Tokens: ["annotate", '"my paper"', "as", '"key"']

Input:  filter most-cited
Tokens: ["filter", "most-cited"]

Input:  find "unclosed quote
Tokens: ["find", '"unclosed quote']
```

### 7.2 Complete EBNF Grammar

```ebnf
(* Terminal commands *)
<input>          ::= <comment> | <command-line>
<comment>        ::= "#" <any-text>
<command-line>   ::= <command> <arguments>?

(* Commands *)
<command>        ::= "annotate" | "remove" | "clear" | "zoom" | "highlight"
                   | "filter" | "reset" | "info" | "compare" | "path"
                   | "deep-dive" | "pathfinder" | "ls" | "find"
                   | "help" | "history" | "export" | "save" | "load"
                   | "sessions" | "scripts" | "run" | "script"
                   | "rename" | "delete" | "exit"

(* Argument patterns per command *)
<annotate-args>  ::= <paper-ref> ["as" <label>]
<remove-args>    ::= "annotation" [<remove-mode>]
<remove-mode>    ::= "value" <quoted-string>
                   | "paper" <paper-ref>
                   | <paper-ref>
<clear-args>     ::= "annotations" | "screen" | ε
<zoom-args>      ::= <paper-ref>
<highlight-args> ::= <paper-ref>
<filter-args>    ::= <filter-type>
<info-args>      ::= <paper-ref>
<compare-args>   ::= <paper-ref> ("," | "and") <paper-ref>
<path-args>      ::= <paper-ref> "to" <paper-ref>
<deepdive-args>  ::= <paper-ref>
<pathfinder-args>::= <quoted-string>
<ls-args>        ::= "annotations" | "papers"
<find-args>      ::= <quoted-string>
<help-args>      ::= <command>?
<history-args>   ::= ["--errors"]
<export-args>    ::= "session" "as" ("script" <quoted-string> | "text")
<save-args>      ::= "session" <quoted-string>
<load-args>      ::= "session" <quoted-string>
<rename-args>    ::= <quoted-string>
<delete-args>    ::= ("session" | "script") <quoted-string>
<run-args>       ::= <quoted-string>
<script-args>    ::= <script-sub> <sub-args>
<script-sub>     ::= "save" | "list" | "info" | "delete" | "copy" | "run" | "export"
<script-save>    ::= <quoted-string> ["--desc" <quoted-string>]
<script-copy>    ::= <quoted-string> "as" <quoted-string>

(* Primitives *)
<paper-ref>      ::= <word>+ | <quoted-string>
<label>          ::= <quoted-string> | <word>+
<filter-type>    ::= "bottlenecks" | "most-cited" | "least-cited"
                   | "contradictions" | "highest-impact" | "all"
<quoted-string>  ::= '"' <any-char>* '"' | "'" <any-char>* "'"
<word>           ::= <non-space-char>+
```

### 7.3 Operator Keywords

These are highlighted with `term-operator` class when not the first token:
```
as  to  from  in  by  and  or  not  value  paper
```

### 7.4 Flag Syntax

Tokens starting with `--` are highlighted as operators:
```
--errors    (history command)
--desc      (script save command)
```

---

<a id="part-8"></a>
## Part 8 — Paper Resolution Algorithm

`ArivuTerminalParser.resolvePaper(name)` — 5-step fuzzy matching with early return:

### Step 1: Normalize
```javascript
lower = name.toLowerCase().trim().replace(/^["']|["']$/g, '')
```

### Step 2: Exact Title Match
- Iterate all nodes: `node.title.toLowerCase() === lower`
- **Return first match** (order-dependent)

### Step 3: Alias Expansion
| Input | Expands To |
|-------|-----------|
| `resnet` | `residual` |
| `vgg` / `vggnet` | `very deep convolutional` |
| `alexnet` | `imagenet classification with deep` |
| `googlenet` / `inception` | `going deeper` |
| `lstm` | `long short-term` |
| `batch norm` | `batch normalization` |
| `faster rcnn` | `faster r-cnn` |
| `r-cnn` | `rich feature hierarchies` |

**Limitation:** Only covers CV/NLP papers. No aliases for biology, physics, etc.

### Step 4: Substring Match
- Find all nodes where `title.toLowerCase().includes(expandedQuery)`
- Return the one with **shortest title** (most specific match)

**Edge case:** If query is "the", every paper containing "the" matches.

### Step 5: Word Overlap Scoring
- Split query into words with `length > 2`
- For each node, count query words that appear as substrings in title words
- Return highest-scoring node if score >= 1

**Edge case:** A single 3-character match (e.g., "net") can return a paper.

### Step 6: Return null

---

<a id="part-9"></a>
## Part 9 — Syntax Highlighting (Exact Color Map)

### 9.1 Token → Color Mapping

| Token Type | Detection | CSS Class | Color |
|-----------|-----------|-----------|-------|
| Valid command (1st token) | `token.toLowerCase() in this.commands` | `term-cmd-keyword` | `#D4A843` gold |
| Invalid command (1st token) | NOT in commands | `term-error` | **⚠ UNSTYLED — needs CSS rule** |
| Operator | token in `this.operators` set | `term-operator` | `#06B6D4` teal |
| Quoted string | starts with `"` or `'` | `term-string-val` | `#F59E0B` amber |
| Number | matches `/^\d+(\.\d+)?$/` | `term-data-val` | `#06B6D4` teal |
| Flag | starts with `--` | `term-operator` | `#06B6D4` teal |
| Other (paper names, etc.) | none of above | (no class) | inherit `#E6EDF3` white |

### 9.2 Output Line Colors

| Line Type | CSS Class | Color |
|-----------|-----------|-------|
| Welcome banner | `term-line--welcome` | `#D4A843` gold |
| Success (✓) | `term-line--success` | `#22C55E` green |
| Error (✗) | `term-line--error` | `#EF4444` red |
| Warning (⚠) | `term-line--warning` | `#F59E0B` amber |
| Info | `term-line--info` | `#06B6D4` teal |
| Comment | `term-line--comment` | `#64748B` gray italic |
| Command echo | `term-line--cmd` | `#64748B` gray |

---

<a id="part-10"></a>
## Part 10 — Autocomplete System (Every Context)

### 10.1 Trigger & Navigation

| Action | Key | Behavior |
|--------|-----|----------|
| Auto-trigger | any `input` event | Shows AC if `autoCompleteEnabled` and input non-empty |
| Manual trigger | Tab (no AC visible) | Calls `_showACSuggestions()` |
| Navigate | ArrowUp/ArrowDown | Move selection in AC dropdown |
| Select | Tab (AC visible) | Fills input with selected item + trailing space |
| Select | Click on item | Same as Tab select |
| Dismiss | Escape | Hides AC dropdown |
| Toggle | Click ⇥ button | Toggles `autoCompleteEnabled` |

### 10.2 Context → Suggestion Mapping (Complete)

| Input State | What Is Suggested | Max Items | Source |
|-------------|-------------------|-----------|--------|
| Empty input | All commands with descriptions | **ALL (22+)** | Commands registry |
| Partial 1st word (`zo`) | Commands starting with prefix | All matches | Commands registry |
| `filter ` | bottlenecks, most-cited, least-cited, contradictions, highest-impact, all | 6 | Hardcoded list |
| `ls ` | annotations, papers | 2 | Hardcoded |
| `clear ` | annotations, screen | 2 | Hardcoded |
| `remove ` | `remove annotation` | 1 | Hardcoded |
| `remove annotation ` | value, paper | 2 | Hardcoded |
| `remove annotation paper ` | Paper names | 8 | Graph nodes |
| `remove annotation value ` | Existing annotation labels | All | sessionStorage |
| `script ` | save, list, info, delete, copy, run, export | 7 | Hardcoded |
| `script info\|delete\|copy\|run\|export ` | Script names | 8 | localStorage |
| `run ` | Script names | 8 | localStorage |
| `delete ` | session, script | 2 | Hardcoded |
| `delete script ` | Script names | 8 | localStorage |
| `delete session ` | Session names | 8 | localStorage |
| `help ` | Command names | All | Commands registry |
| `compare ` (before separator) | Papers by citations | 8 | Graph nodes |
| `compare X and ` | Papers | 8 | Graph nodes |
| `path ` (before "to") | Papers | 8 | Graph nodes |
| `path X to ` | Papers | 8 | Graph nodes |
| `annotate ` | Papers (if matches exist) | 8 | Graph nodes |
| `zoom\|highlight\|info\|deep-dive\|find ` | Papers | 8 | Graph nodes |
| Everything else | (empty) | 0 | — |

**Display limit:** `_showACSuggestions` slices to 8 items for the dropdown.
**But:** Empty input shows ALL commands (no slice). This is inconsistent.

---

<a id="part-11"></a>
## Part 11 — Error Catalog (34 Error Codes)

### 11.1 Parse Errors (displayed as `✗ <message>`)

| ID | Trigger | Message |
|----|---------|---------|
| P01 | Unknown command | `Unknown command: '<cmd>'. Did you mean: <suggestion>? Type 'help' for available commands.` |
| P02 | `annotate` no args | `Usage: annotate <paper> as "<label>"` |
| P03 | `annotate` no label after `as` | `Missing label. Usage: annotate <paper> as "<label>"` |
| P04 | `remove` bad syntax | `Usage: remove annotation [value "<label>" \| paper "<name>"]` |
| P05 | `remove annotation value` no label | `Usage: remove annotation value "<label>"` |
| P06 | `remove annotation paper` no name | `Usage: remove annotation paper "<name>"` |
| P07 | `filter` no type | `Usage: filter <type>\nTypes: bottlenecks, most-cited, ...` |
| P08 | `compare` no separator | `Usage: compare <paper1> , <paper2>` |
| P09 | `path` no "to" | `Usage: path <paper1> to <paper2>` |
| P10 | `pathfinder` empty | `Usage: pathfinder "<query>"` |
| P11 | `find` empty | `Usage: find "<search>"` |
| P12 | `export` bad syntax | `Usage: export session as script "<name>" \| export session as text` |
| P13 | `save` bad syntax | `Usage: save session "<name>"` |
| P14 | `load` bad syntax | `Usage: load session "<name>"` |
| P15 | `rename` no name | `Usage: rename "<new name>"` |
| P16 | `delete` bad syntax | `Usage: delete session\|script "<name>"` |
| P17 | `script` no subcommand | `Usage: script save\|list\|info\|delete\|copy\|run "<name>"` |
| P18 | `script <sub>` bad args | Various `Usage: script <sub> ...` |
| P19 | Unknown script subcommand | `Unknown script subcommand: '<sub>'. Options: save, list, info, delete, copy, run, export` |
| P20 | `run` no name | `Usage: run "<script-name>"` |

### 11.2 Execution Errors

| ID | Trigger | Message |
|----|---------|---------|
| E01 | Paper not in graph | `✗ Paper not found: '<paper>'` |
| E02 | Graph not loaded | `✗ Graph not loaded yet` |
| E03 | No annotation on paper | `✗ No annotation on "<title>"` |
| E04 | No annotation with label | `✗ No annotation with value "<label>" found` |
| E05 | Script storage unavailable | `✗ Script storage not available` |
| E06 | Session manager unavailable | `✗ Session manager not available` |
| E07 | No executable commands in history | `✗ No executable commands in history to save as script` |
| E08 | Script not found | `✗ Script not found: "<name>"` |
| E09 | Script empty | `✗ Script "<name>" has no commands` |
| E10 | Session not found | `✗ Session not found: "<name>"` |
| E11 | No sessions to rename | `✗ No sessions to rename. Save first with: save session "<name>"` |
| E12 | Clipboard failure | `✗ Failed to copy to clipboard` |
| E13 | Unhandled command | `✗ Command not implemented: <command>` |
| E14 | Catch-all exception | `✗ Execution error: <err.message>` |

---

<a id="part-12"></a>
## Part 12 — Data Structures & Storage Schemas

### 12.1 localStorage Keys

| Key | Owner | Content |
|-----|-------|---------|
| `arivu_terminal_scripts` | ArivuScriptStorage | `Script[]` |
| `arivu_terminal_sessions` | TerminalSessionCarousel | `Session[]` |

**No collision risk.** Both keys are unique.
**Quota risk:** No size management. Heavy use could exceed 5-10MB browser limit. Failures are silently swallowed.

### 12.2 sessionStorage Keys

| Key Pattern | Owner | Content |
|-------------|-------|---------|
| `athena_annotations_{graphId}` | Terminal + Graph + Loader | `{paperId: {label, color}}` |

**Scope:** Tab-scoped (different tabs get independent annotation sets).
**Fallback:** `graphId` defaults to `'default'` if graph hasn't loaded → annotations go to shared bucket.

### 12.3 Script Schema

```javascript
{
  id:          "scr_<base36>",     // Unique ID
  name:        "my-script",        // Display name (case-insensitive lookup)
  description: "A test script",    // Optional description
  commands:    ["zoom resnet", "filter bottlenecks"],  // Executable commands only
  version:     1,                  // Auto-incremented on update
  versions: [                      // Max 20 entries (trimmed by slice(-20))
    { version: 1, commands: [...], savedAt: "ISO" }
  ],
  graphId:     "abc123",           // Graph ID at save time
  graphTitle:  "Deep Residual...", // Human-readable
  created:     "2026-04-02T...",   // ISO timestamp
  modified:    "2026-04-02T...",   // ISO timestamp
  runCount:    0,                  // Times executed
  lastRun:     null,               // ISO timestamp or null
  tags:        []                  // Reserved for future use
}
```

### 12.4 Session Schema

```javascript
{
  id:              "s_<base36>",      // Unique ID
  name:            "My Session",      // Display name
  created:         "ISO",             // When first saved
  lastActive:      "ISO",             // Updated on every use
  graphId:         "abc123",          // Graph ID
  graphTitle:      "Deep Residual..", // Seed paper title
  commands:        ["zoom resnet", "help", "save session x"],  // ALL inputs including meta
  log: [
    { timestamp: "ISO", command: "zoom resnet", status: "success", parsed: "zoom" }
  ],
  annotations:     { "paperId": { label: "key", color: "gold" } },  // Snapshot
  totalCommands:   3,                 // = log.length
  successCount:    2,                 // Derived
  errorCount:      1,                 // Derived
  annotationCount: 1,                 // Derived
  _isActive:       false,             // Only for live unsaved terminals
  _terminalId:     null               // Only for live terminals
}
```

### 12.5 LogEntry Schema

```javascript
{ timestamp: "ISO", command: "raw input", status: "success"|"error", parsed: "command-name"|null }
```

### 12.6 ParseResult Schema

```javascript
{ command: "zoom"|null, args: {paper: "resnet"}, error: null|"Usage...", raw: "zoom resnet" }
```

### 12.7 ResolvedPaper Schema

```javascript
{ id: "2c03df8b...", title: "Deep Residual...", node: { /* full graph node object */ } }
```

### 12.8 .arivu Export Format (Script)

```
# ═══════════════════════════════════════════════
# Arivu Script: <name>
# Description: <description>              (if present)
# Version: <version>
# Created: <ISO timestamp>
# Modified: <ISO timestamp>
# Graph: <seed_paper_title>               (if present)
# Commands: <count>
# ═══════════════════════════════════════════════

<command1>
<command2>
```

### 12.9 Legacy Session Export Format (Carousel Detail View)

```
# ═══════════════════════════════════════════════
# Arivu Terminal Script — <session name>
# Exported: <locale date string>
# Graph: <title> (<nodeCount> papers)
# Session: <count> commands
# ═══════════════════════════════════════════════

<commands with meta filtered out>
```

**⚠ These two formats are different (BUG-010).** Different headers, different filtering. Should be unified.

---

<a id="part-13"></a>
## Part 13 — Data Flows (Step-by-Step)

### 13.1 Enter Key → Command Execution

```
1. keydown 'Enter' fires on inputEl
2. e.preventDefault()
3. _hideAC() — dismiss autocomplete
4. input = inputEl.value
5. if (input.trim()):
   a. _execute(input)
      → if _pendingConfirm: call _pendingConfirm(input), RETURN
      → else: print echoed command with syntax highlight
      → parser.parse(input) → result
      → push to this.log[]
      → _autoSave() (if linkedSessionId set)
      → if result.error: print error, RETURN
      → if result.command: _executeCommand(result) inside try/catch
   b. history.push(input)        ← AFTER execute, BEFORE input clear
   c. historyIndex = history.length
6. inputEl.value = ''
7. _updateHighlight() — clear overlay
```

### 13.2 Annotation Creation (End-to-End)

```
1. Parser resolves paper name → {id, title, node}
2. Check graph exists: if (!graph) → error
3. PATH A: graph.addAnnotation exists?
   YES → graph.addAnnotation(id, label, 'gold')
         → graph checks: 15 annotation cap (SILENT REJECTION if exceeded)
         → graph removes existing annotation on same node
         → graph creates SVG badge (rect + polygon + text)
         → graph writes to sessionStorage[athena_annotations_{graphId}]
   NO  → _fallbackAnnotate(graph, id, label)
         → creates SVG badge with DIFFERENT geometry (6.5px per char)
         → writes to sessionStorage independently
4. PATH B (parallel): if _treeLayout.addAnnotation exists
   → tree creates SVG badge BELOW node (different from force graph ABOVE)
5. Print success message
```

**There are 4 independent annotation code paths:**
1. `graph.addAnnotation()` — primary
2. `_fallbackAnnotate()` — when graph.js is stale
3. `_treeLayout.addAnnotation()` — tree layout sync
4. `loader.js` retry loop — page reload restore (bypasses all above, uses direct D3)

### 13.3 Script Execution Flow

```
1. Look up script by name in ArivuScriptStorage
2. Record run: storage.recordRun(name)
3. Print header: "Running: <name> (N commands)"
4. For each command (idx 0..N-1):
   a. Skip blank lines and lines starting with #
   b. Print: [idx/total] <highlighted command>
   c. parser.parse(cmd) → result
   d. Push to this.log[]
   e. if error → print error, increment errorCount, continue
   f. if valid → _executeCommand(result), increment successCount
   g. setTimeout(runNext, 150) — 150ms delay between commands
5. Print summary: "Complete: X/Y OK, Z errors (Ns)"
```

**⚠ User can type during execution** (input not disabled). Commands interleave.
**⚠ Closing terminal during execution** causes errors (DOM removed but callbacks persist).

### 13.4 Carousel Open Flow

```
1. _loadSessions() — read localStorage
2. _mergeActiveTerminals() — add unsaved live terminals
3. _buildDOM() — create full overlay HTML with tabs
4. _renderCards() — build session OR script cards based on activeTab
5. _updatePositions() — apply 3D transforms
6. _renderDots() — dot navigation
7. Add event listeners (close, nav, tabs, keyboard, wheel)
8. Append to document.body
9. requestAnimationFrame → add 'visible' class (triggers CSS transition)
```

### 13.5 Auto-Save Flow

```
Triggered: Inside _execute(), on EVERY command (even errors)
Condition: linkedSessionId is set AND carousel exists
Action:
  1. Find session by linkedSessionId
  2. Copy: history, log, lastActive, totalCommands, successCount, errorCount
  3. Snapshot annotations from sessionStorage
  4. carousel._saveSessions() → write to localStorage
```

---

<a id="part-14"></a>
## Part 14 — Graph Integration (4 Annotation Paths)

### 14.1 graph.addAnnotation(paperId, label, color)

**File:** `graph.js` line 871
**Cap:** Max 15 annotations (silent rejection beyond 15)
**Color map:** `'teal'` → `#06B6D4`, everything else → `#D4A843`
**Behavior:** Removes existing annotation on same node first, then creates SVG badge, then writes sessionStorage.
**Badge geometry:** `textWidth = textBBox.width; rectW = textWidth + padX * 2 + 12`

### 14.2 _fallbackAnnotate(graph, paperId, label)

**File:** `arivu-terminal.js` line 1062
**When used:** `graph.addAnnotation` is not a function (stale cached graph.js)
**Badge geometry:** `rectW = truncLabel.length * 6.5 + 24` (character-count estimate, NOT text measurement)
**Difference:** Produces different-width badges than graph.addAnnotation for same text

### 14.3 _treeLayout.addAnnotation(paperId, label, color)

**File:** `tree-layout.js` line 601
**Renders:** Annotations BELOW nodes with dashed line extending downward
**vs Force graph:** Force graph renders ABOVE nodes with pointer triangle

### 14.4 loader.js Retry Restore

**File:** `loader.js` line 332
**Mechanism:** 10 attempts, 500ms apart, using direct D3 manipulation
**Bypasses:** graph.addAnnotation entirely (comment: "Direct D3 annotation -- bypass the addAnnotation method in case it's stale")

### 14.5 Graph Command Delegation

| Terminal Command | Delegates To | Object Shape |
|-----------------|-------------|--------------|
| zoom | `athenaGraphCommands.executeCommand()` | `{action:'zoom', target:<title>}` |
| highlight | `athenaGraphCommands.executeCommand()` | `{action:'highlight', target:<title>}` |
| filter | `athenaGraphCommands.executeCommand()` | `{action:'filter', target:<type>}` |
| reset | `athenaGraphCommands.executeCommand()` | `{action:'reset', target:''}` |
| deep-dive | `athenaEngine.handleUserMessage()` | `'deep dive on "<title>"'` |
| pathfinder | `athenaEngine.handleUserMessage()` | `<raw query>` |
| path | `athenaEngine.handleUserMessage()` | `'trace the path from "<t1>" to "<t2>"'` |

---

<a id="part-15"></a>
## Part 15 — Athena Integration

### 15.1 Slash Commands

| Command | Engine Location | Action |
|---------|----------------|--------|
| `/terminal` | athena-engine.js | `window.terminalManager.create()` |
| `/cmd` | athena-engine.js | Same |

### 15.2 terminal_suggest Block

Rendered by `athena-blocks.js` BlockFactory type `'terminal_suggest'`.

**Visual structure:**
```
┌────────────────────────────────────────────┐
│ > annotate "ResNet" as "key paper"         │  (dark bg, monospace)
│                                             │
│ [Execute]  [Open Terminal]  [No thanks]     │
└────────────────────────────────────────────┘
```

**Button behaviors:**
- **Execute:** Gets/creates terminal → `typeAndExecute(cmd)` (typewriter animation)
- **Open Terminal:** Gets/creates terminal → sets `inputEl.value = cmd` **⚠ does NOT update highlight overlay**
- **No thanks:** Replaces buttons with "Dismissed" text

**History restoration:** Messages starting with `[Terminal suggestion: <cmd>]` are re-rendered as terminal_suggest blocks.

**CSS:** All inline styles (no CSS classes). Uses `style.cssText` directly. Class `block-terminal-suggest` exists in mapping but has no CSS rule.

---

<a id="part-16"></a>
## Part 16 — Carousel System

### 16.1 3D Transform Table

| Position | CSS Class | rotateY | translateZ | translateX | Opacity | z-index |
|----------|-----------|---------|-----------|-----------|---------|---------|
| Active | `pos-0` | none | none | none | 1.0 | 100 |
| Right 1 | `pos-1` | 35deg | -80px | +200px | 0.55 | 5 |
| Left 1 | `pos--1` | -35deg | -80px | -200px | 0.55 | 5 |
| Right 2 | `pos-2` | 60deg | -160px | +350px | 0.3 | 2 |
| Left 2 | `pos--2` | -60deg | -160px | -350px | 0.3 | 2 |
| Hidden | `pos-hidden` | 85deg | -200px | **+450px** | 0 | 0 |

**Scene:** `perspective: 1200px; perspective-origin: 50% 45%`
**Card:** `width: 320px; height: 500px; border: 1px solid #333; border-radius: 8px`
**Transition:** `all 0.6s cubic-bezier(0.4, 0, 0.2, 1)`

**⚠ BUG-009:** `pos-hidden` always uses +450px translateX. Cards hidden to the LEFT should use negative.

### 16.2 Tab System

| Tab | Storage | Card Content | "New" Card |
|-----|---------|-------------|-----------|
| Sessions | `arivu_terminal_sessions` | Session cards (name, date, cmds, annotations, success, errors) | "New Session" (+) |
| Scripts | `arivu_terminal_scripts` | Script cards (name, date, version, cmds, runs, graph) | "New Script" ({ }) |

Active tab: gold `#D4A843` underline. Tab counts shown as badges.

### 16.3 Detail View Differences

| Feature | Session Detail | Script Detail |
|---------|---------------|---------------|
| Stat 1 | Commands (gold) | Commands (gold) |
| Stat 2 | Annotations (green) | Version (blue) |
| Stat 3 | Success (blue) | Runs (green) |
| Stat 4 | Errors (red) | History (default) |
| Button 1 | Open | ▶ Run |
| Button 2 | ▶ Replay | ↓ Export |
| Button 3 | ↓ Export | ✎ Copy |
| Button 4 | ✕ Delete | ✕ Delete |
| Delete confirm | Two-click (3s timeout) | Two-click (3s timeout) |

### 16.4 Navigation

| Input | Action |
|-------|--------|
| ← Arrow | prev() (wraps) |
| → Arrow | next() (wraps) |
| Enter | Open detail view of active card |
| Escape | Close carousel |
| Scroll wheel | prev/next |
| Click non-active card | Rotate to it |
| Click active card | Open detail view |
| Click dot | Jump to index |
| Click backdrop | Close |

---

<a id="part-17"></a>
## Part 17 — Script System

### 17.1 Script vs Session

| Property | Session | Script |
|----------|---------|--------|
| Storage | `arivu_terminal_sessions` | `arivu_terminal_scripts` |
| Contains | ALL inputs (help, save, etc.) | Executable commands only |
| Graph-bound | Yes (captures annotations) | Stores graph title but works on any graph |
| Version history | No | Yes (max 20) |
| Run count | No | Yes |
| Auto-save | Yes (if linked) | No (explicit only) |
| Meta filter on save | N/A | Filters: save, load, sessions, help, history, export, clear, exit, rename, delete, scripts, run, script, # comments |

### 17.2 Meta Command Filter Inconsistency

`export session as script` (export_script handler) uses a **different filter** than `script save`:
- `export_script` does NOT include `'script'` in filter → includes `script info` etc.
- `script_save` DOES include `'script'` in filter → excludes `script info` etc.

**This is BUG-019.** Both should use the same filter.

---

<a id="part-18"></a>
## Part 18 — Event Listeners & Lifecycle

### 18.1 Terminal Listeners

| Event | Target | Handler | Cleanup on close? |
|-------|--------|---------|-------------------|
| keydown | inputEl | Enter/Tab/Arrow/Escape | ✅ (element removed) |
| input | inputEl | highlight + AC | ✅ (element removed) |
| click | title dots | close/min/max | ✅ (element removed) |
| click | action buttons | toggle-ac, new-term | ✅ (element removed) |
| mousedown | titlebar | start drag | ✅ (element removed) |
| **mousemove** | **document** | continue drag | **❌ NEVER REMOVED** |
| **mouseup** | **document** | end drag | **❌ NEVER REMOVED** |
| dblclick | this.el | speed up animation | ✅ (element removed) |
| click | outputEl | focus input | ✅ (element removed) |

### 18.2 Carousel Listeners

| Event | Target | Handler | Cleanup on close? |
|-------|--------|---------|-------------------|
| click | close/nav/tab buttons | various | ✅ (element removed) |
| click | backdrop | close | ✅ (element removed) |
| **keydown** | **document** | Escape/Arrow/Enter | **❌ NEVER REMOVED** |
| wheel | overlay | prev/next | ✅ (element removed) |
| click | card buttons | open/replay/delete | ✅ (element removed) |

---

<a id="part-19"></a>
## Part 19 — Window Globals

### 19.1 Created by Terminal System

| Global | Type | Source |
|--------|------|--------|
| `window.arivuScriptStorage` | ArivuScriptStorage | arivu-terminal.js |
| `window.terminalManager` | TerminalManager | arivu-terminal.js |
| `window.terminalCarousel` | TerminalSessionCarousel | terminal-carousel.js |
| `window.ArivuTerminal` | class | arivu-terminal.js |
| `window.TerminalManager` | class | arivu-terminal.js |
| `window.ArivuTerminalParser` | class | arivu-terminal-parser.js |

### 19.2 External Globals Read

| Global | Properties Used |
|--------|----------------|
| `window._arivuGraph` | `.graphData`, `.metadata`, `.allNodes`, `.allEdges`, `.nodeElements` |
| | `.addAnnotation()`, `.removeAnnotation()`, `.getAnnotations()`, `.restoreAnnotations()` |
| `window.athenaGraphCommands` | `.executeCommand({action, target})` |
| `window.athenaEngine` | `.handleUserMessage(string)` |
| `window._treeLayout` | `.addAnnotation()`, `.removeAnnotation()` |

---

<a id="part-20"></a>
## Part 20 — Hardcoded Limits & Configuration

| Limit | Value | Location | Configurable? |
|-------|-------|----------|---------------|
| Annotation label max | 20 chars (truncated to 18 + "..") | terminal.js, graph.js | No |
| Annotation max count | 15 (silent rejection) | graph.js line 877 | No |
| Typewriter speed | 40ms/char (3ms on dblclick) | terminal.js line 19 | No |
| AC dropdown max items | 8 (but empty input shows all) | terminal.js line 1239 | No |
| History display | last 20 entries | terminal.js line 621 | No |
| Script version history | max 20 | terminal.js line 76 | No |
| Detail preview commands | max 20 | carousel.js line 428 | No |
| Card preview entries | 4 | carousel.js line 278 | No |
| "Did you mean" suggestions | 3 | terminal.js line 1022 | No |
| `ls papers` display | top 10 | terminal.js line 554 | No |
| Script run delay | 150ms between commands | terminal.js line 1207 | No |
| Carousel close animation | 300ms | carousel.js line 132 | No |
| `sessions` command → carousel delay | 800ms | terminal.js line 886 | No |
| Terminal window z-index base | 9000 | CSS + JS | No |
| Carousel overlay z-index | 9500 | CSS | No |
| Detail overlay z-index | 9600 | CSS | No |
| Terminal slug max length | 20 chars | terminal.js line 174 | No |
| localStorage scripts key | `arivu_terminal_scripts` | terminal.js line 16 | No |
| localStorage sessions key | `arivu_terminal_sessions` | carousel.js line 22 | No |
| Clipboard API | Requires HTTPS (fails silently on HTTP) | Browser restriction | No |

---

<a id="part-21"></a>
## Part 21 — Edge Cases (Comprehensive)

### Paper Resolution
- Empty graph → all paper commands return E01
- Paper name matches multiple → shortest-title substring match wins
- 3-character word matches hundreds → returns first high-scorer (may be wrong)
- Quotes in paper name → outer quotes stripped, inner quotes kept
- Alias maps to non-existent paper → falls through to substring/overlap

### Script Execution
- Script contains `script run` (recursive) → inner run starts, commands interleave
- Script contains `exit` → terminal closes mid-script, remaining callbacks error silently
- Script on wrong graph → paper commands fail with E01
- Script contains comments → skipped (no output)
- Script contains blank lines → skipped
- User types during script execution → commands interleave with script commands
- Close terminal during execution → DOM removed, callback errors

### Confirmation Prompts
- User types a command during y/n → consumed as answer (command lost)
- No visual indicator that y/n is expected
- Multiple deletes rapidly → new _pendingConfirm overwrites old
- Tab/autocomplete still works during confirmation (shows normal suggestions)

### Carousel
- 0 sessions → only "New Session" card
- 0 scripts → only "New Script" card
- Very long name → truncated to 22 chars in card, 38 chars in detail
- Open/close/open → accumulates keydown listeners
- Switching tabs resets activeIndex to 0

### Annotations
- Annotating when graph not loaded → annotations go to `default` key in sessionStorage
- Graph loads later with different graphId → annotations invisible
- 16th annotation silently rejected (graph.addAnnotation cap)
- Annotation on same paper twice → replaces (graph.addAnnotation calls removeAnnotation first)
- _fallbackAnnotate produces different badge width than graph.addAnnotation

### Storage
- localStorage quota exceeded → save silently fails, data lost
- sessionStorage is tab-scoped → different tabs have independent annotations
- Multiple terminals in same tab share the same history array (by reference if loaded from session)

---

<a id="part-22"></a>
## Part 22 — Known Bugs (19 Items, Audited 2026-04-02)

### CRITICAL

| ID | Bug | Location |
|----|-----|----------|
| BUG-001 | Carousel `keydown` listener never removed on `close()`. Accumulates. | carousel.js:205 |
| BUG-002 | Terminal `mousemove`/`mouseup` on document never removed on `close()`. Accumulates. | terminal.js:313,323 |
| BUG-003 | `.term-error` CSS class has no rule. Invalid commands unstyled in highlight. | parser.js:589 / CSS missing |

### HIGH

| ID | Bug | Location |
|----|-----|----------|
| BUG-004 | zoom/highlight/filter/reset print "✓" even if athenaGraphCommands is null. | terminal.js:498-523 |
| BUG-005 | No localStorage quota management. Silent data loss. | Storage classes |
| BUG-006 | terminal_suggest "Open Terminal" button doesn't call `_updateHighlight()`. | athena-blocks.js:2019 |
| BUG-007 | Confirmation prompt has no visual indicator (y/n vs normal prompt). | terminal.js |
| BUG-017 | 15-annotation cap silently rejects. User sees "✓ Annotated" but badge doesn't appear. | graph.js:877 |

### MODERATE

| ID | Bug | Location |
|----|-----|----------|
| BUG-008 | `export script` parses as `export_text` (wrong command). | parser.js:91-93 |
| BUG-009 | `pos-hidden` always translates +X. Wrong animation path for left-side cards. | carousel.css:250 |
| BUG-010 | Two different .arivu export formats (session vs script). | carousel.js vs terminal.js |
| BUG-011 | `clear annotations` and `remove annotation` (all) use different code paths. | terminal.js |
| BUG-012 | `_getPaperRank` uses citations but label says "PageRank". | terminal.js:1031 |
| BUG-013 | `.carousel-subtitle` referenced in JS but element doesn't exist in DOM. | carousel.js:649 |
| BUG-018 | Default position (left:20px) differs from restore-from-maximize (right:20px). | terminal.js vs CSS |
| BUG-019 | `export_script` and `script_save` have different meta-command filters. | terminal.js:636 vs 672 |

### LOW

| ID | Bug | Location |
|----|-----|----------|
| BUG-014 | `_parseFilter` no-op regex `.replace(/-/g, '-')`. | parser.js:255 |
| BUG-015 | Session dedup in carousel compares only last command. | carousel.js:102-104 |
| BUG-016 | `focus()` z-index wraps every second (`Date.now() % 1000`). | terminal.js:1342 |

---

<a id="part-23"></a>
## Part 23 — Z-Index Stacking Order

| Layer | z-index | Element |
|-------|---------|---------|
| Normal page content | auto | — |
| Terminal window (default) | 9000 | `.arivu-terminal-window` |
| Terminal focused | 9000-9999 | `focus()` → 9000 + Date.now() % 1000 |
| AC dropdown | 9000 + 10 (relative) | `.term-autocomplete` (z-index:10 within input-row) |
| Carousel overlay | 9500 | `.carousel-overlay` |
| Detail overlay | 9600 | `.detail-overlay` |
| Input over highlight | 1 (relative) | `.term-input` (z-index:1 within input-wrapper) |

---

<a id="part-24"></a>
## Part 24 — Planned: Phase 2 — Run Flags & Chaining

### 24.1 Run Flags

| Flag | Syntax | Behavior |
|------|--------|----------|
| `--verbose` | `run "script" --verbose` | Print extra detail: show parse result, timing per command |
| `--replace` | `run "script" --replace` | Overwrite existing annotations instead of skipping duplicates |
| `--dry` | `run "script" --dry` | Parse and validate only, do NOT execute. Print what WOULD happen. |
| `--top N` | `run "script" --top 5` | Execute only first N commands |
| `--from N` | `run "script" --from 3` | Start execution from command #N (1-indexed) |
| `--range N:M` | `run "script" --range 3:7` | Execute commands #N through #M inclusive |

**Flag parsing rules:**
- Flags appear AFTER the script name: `run "<name>" <flags>`
- Flags can be combined: `run "x" --verbose --top 5`
- `--top` and `--from` together: `--from 3 --top 5` → commands 3,4,5,6,7
- `--range` overrides `--top` and `--from`
- Invalid flag → error: `Unknown flag: --xyz. Valid: --verbose, --replace, --dry, --top, --from, --range`
- Missing flag value → error: `--top requires a number. Usage: --top N`

### 24.2 Script Chaining

```
Syntax:    run "script-a" && run "script-b"
Meaning:   Run script-b ONLY IF script-a has 0 errors
Alt:       run "script-a" ; run "script-b"
Meaning:   Run script-b regardless of script-a result
NOT:       || is not supported in Phase 2
```

### 24.3 From-History

```
Syntax:    from-history 5
Meaning:   Take the last 5 NON-META commands from history and create a script
Output:    Opens "script save" flow with pre-populated commands
Filter:    Same meta filter as script save (Part 17.1)
```

---

<a id="part-25"></a>
## Part 25 — Planned: Phase 3 — Notebook Script Editor

### 25.1 Editor Concept

A **cell-based editor** (Jupyter/Colab style) opened via `script edit "<name>"` or from carousel detail view "Edit" button.

### 25.2 Cell Types

| Type | Marker | Behavior |
|------|--------|----------|
| Code | (default) | Executable terminal command. Syntax highlighted. |
| Comment | `# ` prefix | Non-executable. Displayed in gray italic. |
| Section | `## ` prefix | Visual separator. Bold heading. |

### 25.3 Editor Toolbar

```
[▶ Run Cell] [▶▶ Run All] [+ Add Cell] [↑ Move Up] [↓ Move Down] [✕ Delete Cell]
[Save] [Export .arivu]
```

### 25.4 Editor :Commands

| Command | Action |
|---------|--------|
| `:run` | Run current cell |
| `:run-all` | Run all cells top-to-bottom |
| `:save` | Save script |
| `:clear` | Clear all cell outputs |
| `:exit` | Close editor, return to terminal |
| `:undo` | Undo last change (max 50 levels) |
| `:redo` | Redo |

### 25.5 Cell Execution

Each code cell runs via `parser.parse()` → `_executeCommand()`. Output appears inline below the cell (like Jupyter). Errors show red, success shows green.

### 25.6 DOM Structure (Planned)

```html
<div class="script-editor-overlay">
  <div class="script-editor">
    <div class="editor-toolbar">...</div>
    <div class="editor-cells">
      <div class="editor-cell" data-index="0">
        <div class="cell-gutter">1</div>
        <div class="cell-input"><input ...></div>
        <div class="cell-output">...</div>
      </div>
      ...
    </div>
    <div class="editor-statusbar">Script: "name" · 4 cells · v2</div>
  </div>
</div>
```

---

<a id="part-26"></a>
## Part 26 — Planned: Phase 4 — Type System & Variables

### 26.1 Types

| Type | Literal | Example |
|------|---------|---------|
| `paper` | resolved paper reference | `$p = resnet` |
| `label` | quoted string ≤20 chars | `$l = "key paper"` |
| `filter` | filter type keyword | `$f = bottlenecks` |
| `number` | integer or float | `$n = 42` |
| `string` | quoted text | `$s = "hello world"` |
| `bool` | true/false | `$b = true` |

### 26.2 Variable Declaration

```
# Explicit type
$myPaper: paper = resnet
$label: label = "important"

# Inferred type (from context)
$p = resnet              → paper (if resolvable)
$n = 42                  → number
$s = "hello"             → string
$b = true                → bool
```

### 26.3 @param Declarations (Script Headers)

```
# @param $paper: paper "The paper to analyze"
# @param $depth: number = 2 "How deep to go"
# @param $verbose: bool = false "Show extra detail"

zoom $paper
filter bottlenecks
info $paper
```

**Rules:**
- `@param` lines must be in comments at the top of the script
- Default values are optional: `= <value>`
- Description is optional: `"text"`
- Missing required params at runtime → error: `Missing required parameter: $paper (type: paper)`

### 26.4 --set Flag

```
run "my-script" --set paper=resnet --set depth=3
```

### 26.5 Variable Substitution

```
zoom $myPaper              → zoom <resolved value>
annotate $paper as $label  → annotate resnet as "important"
```

**Rules:**
- `$name` is substituted before parsing
- `$$` is literal `$` (escape)
- Undefined variable → error: `Undefined variable: $xyz`
- Type mismatch → error: `Type error: $n is number, expected paper`
- Variables in quoted strings are NOT substituted: `"$name"` stays literal

### 26.6 Variable Scope

- **Script scope:** Variables live for the duration of a script execution
- **Session scope:** Variables set in terminal persist until terminal closes
- **No global scope across terminals**

---

<a id="part-27"></a>
## Part 27 — Planned: Phase 5 — Smart Autocomplete

Enhanced autocomplete that is:
- **Type-aware:** Only suggest papers for `zoom $`, only filters for `filter $`
- **Variable-aware:** Suggest `$myPaper` when typing `$m`
- **Recent-aware:** Boost recently used commands/papers
- **Context-sensitive:** After `annotate <paper> as` suggest common labels

### Priority Stack (highest to lowest):
1. Exact prefix matches
2. Recently used items (last 10)
3. Type-compatible suggestions
4. General fuzzy matches

---

<a id="part-28"></a>
## Part 28 — Planned: Phase 6 — Versioning, Diff, Templates, Hooks

### 28.1 Script Versioning

Already built: max 20 versions stored in `script.versions[]`. Phase 6 adds UI:

```
script history "<name>"   → show version list with dates + command counts
script diff "<name>" 2 3  → line-by-line diff between v2 and v3
script revert "<name>" 2  → revert to v2 (creates v(N+1) with v2's commands)
```

### 28.2 Diff Output Format

```
─── diff: my-script v2 → v3 ─────────────
  zoom resnet                    (unchanged)
- filter bottlenecks             (removed in v3)
+ filter most-cited              (added in v3)
  info resnet                    (unchanged)
+ compare resnet and alexnet     (added in v3)
──────────────────────────────────────────
2 additions, 1 removal
```

### 28.3 Built-in Templates

| Template | Name | Commands |
|----------|------|----------|
| 1 | `annotate-bottlenecks` | Annotate all bottleneck papers |
| 2 | `full-exploration` | Filter bottlenecks → zoom each → info each |
| 3 | `compare-top-5` | Compare top 5 papers pairwise |
| 4 | `clean-slate` | Reset → clear annotations → clear screen |

**Storage:** Templates are hardcoded in `ArivuScriptStorage`, not in localStorage.
**User templates:** Users can save any script; templates are just pre-built scripts.

### 28.4 Script Hooks

| Hook | Fires When | Example Use |
|------|-----------|-------------|
| `:on-graph-load` | Graph finishes loading | Auto-annotate key papers |
| `:before-deep-dive` | Before deep-dive request | Highlight the paper first |
| `:on-annotation` | After annotation created | Log annotation to session |

**Registration:**
```
# In a script:
:on-graph-load
annotate resnet as "seed"
filter bottlenecks
```

**Execution model:**
- Hooks run synchronously
- Errors in hooks are caught (do not block the triggering action)
- Hooks do NOT receive arguments (they access the current graph state)
- Max 1 hook per hook point (last registration wins)

---

<a id="part-29"></a>
## Part 29 — Planned: Phase 7 — DB Sync & Polish

### 29.1 DB Sync

**Endpoints needed:**
```
POST /api/terminal/scripts/sync    — upload local scripts
GET  /api/terminal/scripts/sync    — download remote scripts
POST /api/terminal/sessions/sync   — upload local sessions
GET  /api/terminal/sessions/sync   — download remote sessions
```

### 29.2 Conflict Resolution

- **Last-write-wins** by `modified` timestamp
- If same script modified on two devices → newer `modified` wins
- Deleted scripts are tombstoned (kept with `_deleted: true` for 30 days)

### 29.3 Sync Frequency

- On page load (download)
- On script/session save (upload)
- No background polling

### 29.4 Offline Behavior

- localStorage is always the primary store
- Sync failures are queued and retried on next page load
- No data loss: localStorage survives offline

---

*End of ARIVU_TERMINAL_SPEC.md v2.0. 76 gaps from v1 addressed. Every claim verified against code. Update before building.*
