# ARIVU TERMINAL — COMPLETE BUILD PLAN
## All 16 Discussion Points + Terminal Management System

> **Status:** Pre-build specification. Do NOT code until this is approved.
> **Scope:** Everything discussed. No phases — build it all.
> **Date:** 2026-04-02

---

## TABLE OF CONTENTS

```
FIX-01:  Subcommand Syntax Highlighting
FIX-02:  Script Overwrite Confirmation + script append()
FIX-04:  MySQL-Style Box Renderer (Lavender)
FIX-05:  Run Modes (--slow, as sequence)
FIX-06:  Help Syntax Formatting
FIX-07:  Export Autocomplete
FIX-08:  Rich Comment/Markup Syntax
FIX-09:  Terminal Management System (Pill + Grid + Icons + Pin)
FIX-10:  Export Session Debug + Verbose Filter Log
FIX-11:  String Color Change (Sky Blue)
FIX-12:  Stop Saving y/n to History
FIX-13:  Two-Step Delete in Carousel Script Cards
FIX-14:  Session Command Namespace Restructure
FIX-15:  Quick Replay
FIX-16:  Session Save Overwrite + session append()
```

---

## FIX-01: Subcommand Syntax Highlighting

### Problem
Second token in compound commands (script save, session load, etc.) gets no color.

### Current Code (parser.js line 605-608)
Only the FIRST token is checked against `this.commands`. Second tokens fall through to default (white).

### Fix: Context-Aware Second Token

The highlighter needs to recognize that certain first-token commands have colored sub-keywords:

```
FIRST TOKEN         COLORED SECOND TOKENS
═══════════════════════════════════════════
script              save, list, info, delete, copy, run, export, append
session             save, load, rename, delete, list, append
export              session
save                session (deprecated, soft redirect)
load                session (deprecated, soft redirect)
delete              session, script
remove              annotation, annotations
clear               annotations, screen, variables
ls                  annotations, papers, scripts, variables, sessions
```

### Highlighting Rules

```javascript
// In highlight() method, after detecting first token as valid command:
if (i === 1) {
  const subCmds = SUBCOMMAND_MAP[tokens[0].toLowerCase()];
  if (subCmds && subCmds.includes(token.toLowerCase())) {
    html += `<span class="term-cmd-keyword">${esc(token)}</span>`;
    continue;
  }
}
```

Sub-commands get the same gold (`#D4A843`) as primary commands.

### Also Color These Tokens

```
MODE KEYWORDS (in bracket syntax):
  replace, continue, all         → green #22C55E (mode/action keywords)

STRUCTURAL TOKENS:
  ( ) , [ ]                      → white #E6EDF3 (as you specified)

SEQUENCE MODE KEYWORDS:
  as, sequence                   → green #22C55E when used as "as sequence"
```

### Complete Color Map (Updated)

```
TOKEN TYPE              COLOR        CSS CLASS
═══════════════════════════════════════════════════════
Command keyword         #D4A843      .hl-command (term-cmd-keyword)
Sub-command keyword     #D4A843      .hl-command (same as command)
Operator (as,to,and)    #06B6D4      .hl-operator (term-operator)
String literal          #38BDF8      .hl-string (NEW: sky blue)
Number                  #06B6D4      .hl-number (term-data-val)
Flag (--verbose)        #22C55E      .hl-flag (NEW: green)
Mode keyword            #22C55E      .hl-mode (replace,continue,all)
Brackets (),[],comma    #E6EDF3      .hl-bracket (white)
Comment #               #64748B      .hl-comment (gray italic)
Header ##               #A78BFA      .hl-header (lavender bold)
Rule ---/===            #64748B      .hl-rule (gray)
Metadata #!             #64748B      .hl-meta (gray + white value)
TODO marker             #F59E0B      .hl-todo (amber)
WARN marker             #EF4444      .hl-warn (red)
Invalid command         #EF4444      .hl-error (term-error)
Default text            #E6EDF3      (no class)
```

---

## FIX-02: Script Overwrite Confirmation + script append()

### Overwrite Confirmation

When `script save "name"` and name already exists:

```
arivu:resnet$ script save "bottleneck-scan"
 ⚠ Script "bottleneck-scan" already exists (v2, 5 commands).
   Overwrite? [y/n]
> y
 ✓ Script saved: "bottleneck-scan" (v3)
   3 commands
```

If `n`:
```
> n
 Cancelled. Tip: use script append("bottleneck-scan", all) to add commands.
```

### script append() Syntax

```
SYNTAX                                          DESCRIPTION
═══════════════════════════════════════════════════════════════════════

script append("name", all)                      Append ALL filtered history commands
script append("name", 5)                        Append command #5 from filtered list
script append("name", [3-7])                    Append commands 3 through 7
script append("name", from: "source-script")    Append all commands from another script
script append("name", from: "source", [3-7])    Append range from another script
script append("name", from: "source", 5)        Append single command from another script
```

### Argument Parsing

The bracket syntax `script append("name", ...)` requires special tokenization:

```
Input:  script append("bottleneck-scan", [3-7])
Tokens: ["script", "append", "(", '"bottleneck-scan"', ",", "[3-7]", ")"]

Step 1: Detect "append" sub-command after "script"
Step 2: Extract content between ( and )
Step 3: Split by comma
Step 4: First arg = script name (strip quotes)
Step 5: Second arg = selector:
        - "all" keyword → append all
        - /^\d+$/ number → single command index
        - /^\[(\d+)-(\d+)\]$/ → range
        - "from:" prefix → source script (with optional 3rd arg)
```

### Validation Rules

```
RULE                                    ERROR MESSAGE
═══════════════════════════════════════════════════════════════════════

Script "name" doesn't exist             "Script 'name' not found"
Command index < 1                       "Command number must be ≥ 1"
Command index > filtered history        "Command 5 doesn't exist (history has 3 commands)"
Range N2 < N1                           "Range end must be > start: [7-3]"
Range N2 > filtered history             "Range end 20 exceeds history (12 commands)"
Source script doesn't exist             "Source script 'name' not found"
Source script is empty                  "Source script 'name' has no commands"
No filtered commands to append          "No executable commands in history to append"
Missing closing parenthesis             "Missing closing ')'. Usage: script append(\"name\", all)"
```

### Edge Cases

```
- script append("name", 0) → error (must be ≥ 1)
- script append("name", all) when history empty → error
- script append("name", from: "same-name") → allowed (append script to itself = duplicate commands)
- script append("nonexistent", all) → error (script not found)
- script append("name", [5-5]) → valid (appends single command #5)
- After append, script version increments
- Appended commands are added to END of existing script commands
```

### Autocomplete

```
AFTER                           SUGGESTS
═════════════════════════════════════════════════
script append(                  Session/script names in quotes
script append("name",          all, from:, or wait for number
script append("name", from:    Script names in quotes
script append("name", from: "src",    all, or wait for number/range
```

---

## FIX-04: MySQL-Style Box Renderer (Lavender)

### Color Scheme

```
ELEMENT                 COLOR           CSS VAR
══════════════════════════════════════════════════
Box borders (─│┌┐└┘├┤) #A78BFA         --box-border (lavender)
Header text             #A78BFA         --box-header (lavender)
Labels (Created:, etc)  #94A3B8         --box-label (gray)
Values                  #E6EDF3         --box-value (white)
Command keywords        syntax colored  (reuse term-cmd-keyword etc)
Dividers (├───┤)        #A78BFA         --box-border
Version badge           #A78BFA         --box-header
```

### Box Rendering Algorithm

```javascript
function renderBox(sections) {
  // Step 1: Calculate max width across all content
  // Step 2: Draw top border: ┌─ Header ──── vN ─┐
  // Step 3: For each section:
  //         Draw content rows, pad to max width
  //         Draw section divider: ├───────────────┤
  // Step 4: Draw bottom border: └─────────────────┘
}
```

### script info Output (New Design)

```
┌─ Bottleneck Scanner ────────────────────── v3 ─┐
│                                                 │
│  Commands     8          Runs        12         │
│  Created      Apr 2      Last run    Apr 2 3pm  │
│  Graph        Deep Residual Learning for I...   │
│  Description  Scan and annotate bottleneck...   │
│                                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  1  filter bottlenecks                          │
│  2  ls papers                                   │
│  3  annotate "resnet" as "seed"                 │
│  4  info "resnet"                               │
│  5  zoom "resnet"                               │
│  6  highlight "resnet"                          │
│  7  compare "resnet" and "vgg"                  │
│  8  reset                                       │
│                                                 │
└─────────────────────────────────────────────────┘
```

- Header line: lavender script name + version on the right
- Stats section: gray labels, white values, two-column layout
- Divider: lavender ├──┤
- Commands section: numbered, syntax-highlighted
- ALL commands shown (no 6-command truncation)

### Also Apply To

- `session list` output (table with lavender borders)
- `script list` output (table with lavender borders)
- `info <paper>` output (paper info box)
- `compare` output (comparison table)
- Any future boxed output

---

## FIX-05: Run Modes (--slow, as sequence)

### Four Run Modes

```
SYNTAX                                      DELAY     ANIMATION
══════════════════════════════════════════════════════════════════

script run "name"                           10ms      none (batch)
script run "name" --slow                    500ms     none (visible)
script run "name" --verbose                 40ms/ch   typewriter
script run "name" as sequence               manual    user presses Enter
script run "name" as sequence --verbose     manual    typewriter per cmd
```

### Sequence Mode State Machine

```
STATES
══════

  IDLE → user types "script run X as sequence"
    │
    ▼
  SEQUENCE_ACTIVE
    │ Terminal enters sequence mode
    │ Prompt changes to: seq:name[1/8]>
    │ First command shown but NOT executed
    │
    ├── Enter → EXECUTE_STEP
    │     │ Execute current command
    │     │ Show result
    │     │ Advance to next
    │     │ If last → SEQUENCE_COMPLETE
    │     │ Else → show next command, wait
    │     └── back to SEQUENCE_ACTIVE
    │
    ├── "skip" → skip 1 command, advance
    ├── "skip N" → skip N commands
    ├── "stop" → SEQUENCE_COMPLETE (aborted)
    ├── "peek" → show next 3 commands (no execute)
    ├── "goto N" → jump FORWARD to command N (skip everything between)
    ├── "restart" → go back to command 1
    │
    ▼
  SEQUENCE_COMPLETE
    │ Print summary
    │ Restore normal prompt
    │ Terminal returns to IDLE
```

### Sequence Mode Prompt

```
seq:bottleneck-scan[1/8]> _

  Waiting. Commands: Enter=next  skip  stop  peek  goto N  restart
```

The prompt changes to show:
- `seq:` prefix (instead of `arivu:slug$`)
- Script name
- `[current/total]` progress
- Below: dim gray hint line showing available controls

### Sequence Mode Output

```
seq:bottleneck-scan[1/8]>
│ ▸ filter bottlenecks
│   (press Enter to execute)

  [Enter pressed]

│ ✓ Filter applied: bottlenecks
│
seq:bottleneck-scan[2/8]>
│ ▸ ls papers
│   (press Enter to execute)

  [User types "peek"]

│ ▸ Upcoming:
│   [3] annotate "resnet" as "seed"
│   [4] info "resnet"
│   [5] zoom "resnet"
│
seq:bottleneck-scan[2/8]>
│ ▸ ls papers
│   (press Enter to execute)

  [User types "skip 2"]

│ ⏭ [2] ls papers — skipped
│ ⏭ [3] annotate "resnet" as "seed" — skipped
│
seq:bottleneck-scan[4/8]>
│ ▸ info "resnet"
│   (press Enter to execute)

  [User types "stop"]

│
└─ Stopped at 4/8. 1 executed, 2 skipped, 5 remaining.
```

### Sequence Mode Controls

```
CONTROL         ACTION
══════════════════════════════════════════
Enter           Execute current command, advance to next
skip            Skip current command (mark as skipped)
skip N          Skip N commands ahead
stop            Abort sequence, print summary
peek            Show next 3 commands without executing
goto N          Jump forward to command N (skip all between)
restart         Go back to command 1 (re-execute from start)
```

### Edge Cases

```
- "goto 2" when already at 5 → error "Can only go forward. Use 'restart' to go back."
- "goto 99" when script has 8 → error "Command 99 doesn't exist (script has 8)"
- "skip 100" when 3 remaining → skips all, sequence completes
- Typing a normal command (not a control) → error "In sequence mode. Use Enter/skip/stop/peek/goto/restart"
- Closing terminal during sequence → sequence aborted, no cleanup issues (setTimeout chain stops when DOM removed)
- Recursive: script contains "script run X as sequence" → error (recursion guard catches it)
```

---

## FIX-06: Help Syntax Formatting

### Current Problem
Help shows raw arg strings like `session as script|text "<name>"`.

### New Format

```
arivu:resnet$ help

 ARIVU TERMINAL COMMANDS
 ═══════════════════════

 Graph Navigation
   zoom <paper>                      Zoom graph to paper node
   highlight <paper>                 Highlight node with gold pulse
   filter <type>                     Apply graph filter
   reset                             Reset all graph state

 Annotations
   annotate <paper> as <label>       Add annotation badge
   remove annotation <paper>         Remove annotation
   clear annotations                 Clear all annotations
   ls annotations                    List active annotations

 Analysis
   info <paper>                      Show paper statistics
   compare <paper> and <paper>       Side-by-side comparison
   path <paper> to <paper>           Find path between papers
   deep-dive <paper>                 Athena deep dive analysis
   pathfinder <query>                Pathfinder analysis
   find <search>                     Search papers by name

 Sessions
   session save <name>               Save terminal state
   session load(<name>)              Load session (new window)
   session load(<name>, replace)     Load, replace current terminal
   session load(<name>, continue)    Load into current terminal
   session rename <old> <new>        Rename a session
   session delete <name>             Delete session (with confirm)
   session list                      List all sessions
   session append(<name>, <sel>)     Append commands to session

 Scripts
   script save <name>                Save history as script
   script list                       List all scripts
   script info <name>                Show script details
   script delete <name>              Delete script (with confirm)
   script copy <name> as <new>       Duplicate a script
   script run <name> [flags]         Execute script
   script export <name>              Copy .arivu to clipboard
   script append(<name>, <sel>)      Append commands to script

 Utility
   help [command]                    Show help
   history [--errors]                Show command history
   clear [screen|annotations]        Clear terminal or annotations
   exit                              Close terminal
```

### help <command> Expanded

```
arivu:resnet$ help script

 SCRIPT COMMANDS
 ═══════════════

   script save <name> [--desc <text>]     Save current history as script
   script list                            List all saved scripts
   script info <name>                     Show script details + commands
   script delete <name>                   Delete script (with y/n)
   script copy <name> as <new-name>       Duplicate a script
   script run <name>                      Run in batch mode (fast)
   script run <name> --slow               Run with 500ms delay
   script run <name> --verbose            Run with typewriter animation
   script run <name> as sequence          Step-by-step (Enter to advance)
   script export <name>                   Copy .arivu to clipboard
   script append(<name>, <selector>)      Append commands to script

 Selectors for append:
   all                                    All filtered history commands
   N                                      Single command #N
   [N-M]                                  Range from #N to #M
   from: <script>                         All from another script
   from: <script>, N                      Single from another script
   from: <script>, [N-M]                  Range from another script

 Aliases:
   scripts          → script list
   run <name>       → script run <name>
   delete script    → script delete
```

### Highlighting in Help Output

```
- <paper>, <name>, <type>, <query> etc. → teal (#06B6D4)
- Command keywords → gold (#D4A843)
- Flags → green (#22C55E)
- Brackets/structural → white
- Descriptions → gray (#94A3B8)
```

---

## FIX-07: Export Autocomplete

### Missing Contexts to Add

```
AFTER                       SUGGESTS
═══════════════════════════════════════════
export                      "session"
export session              "as"
export session as           "script", "text"
export session as script    (free text for name)
```

---

## FIX-08: Rich Comment/Markup Syntax

### Detection Priority (Top to Bottom)

```
PATTERN     DETECTION                RENDERS AS           COLOR
════════════════════════════════════════════════════════════════════

===         /^={3,}$/                ═══════════════════  #64748B (gray)
---         /^-{2,}$/                ───────────────────  #64748B (gray)
##          /^## /                   Bold header text     #A78BFA (lavender) bold
#!          /^#! /                   key: value metadata  #64748B key, #E6EDF3 value
# TODO:     /^# TODO:/i             TODO text            #F59E0B (amber)
# WARN:     /^# WARN:/i             Warning text         #EF4444 (red)
#           /^# /                   Comment text         #64748B (gray italic)
```

### Examples in Terminal

```
arivu:resnet$ ## Bottleneck Analysis Workflow      ← lavender, bold
arivu:resnet$ # This script finds bottlenecks      ← gray, italic
arivu:resnet$ #! author: John                       ← gray "author:", white "John"
arivu:resnet$ # TODO: add error handling            ← amber
arivu:resnet$ # WARN: slow on large graphs          ← red
arivu:resnet$ ---                                    ← renders as: ─────────────────
arivu:resnet$ ===                                    ← renders as: ═════════════════
arivu:resnet$ filter bottlenecks                     ← normal command
```

### In Scripts (.arivu files)

```
#! name: Bottleneck Scanner
#! version: 3
#! graph: Deep Residual Learning

## Setup
filter bottlenecks
ls papers

---

## Annotation Phase
# TODO: make this dynamic based on results
annotate "resnet" as "seed"
annotate "vgg" as "baseline"

===

## Analysis
info "resnet"
compare "resnet" and "vgg"

# WARN: deep-dive takes 30+ seconds
deep-dive "resnet"
```

### Highlighter Changes

Add to the TOP of `highlight()` method, before tokenization:

```javascript
highlight(input) {
  if (!input) return '';
  const trimmed = input.trim();

  // Rich markup — check before tokenization
  if (/^={3,}$/.test(trimmed))
    return `<span class="hl-rule">${'═'.repeat(48)}</span>`;
  if (/^-{2,}$/.test(trimmed))
    return `<span class="hl-rule">${'─'.repeat(48)}</span>`;
  if (/^## /.test(trimmed))
    return `<span class="hl-header">${this._esc(trimmed)}</span>`;
  if (/^#!\s*(\w+):\s*(.*)/.test(trimmed)) {
    const [, key, val] = trimmed.match(/^#!\s*(\w+):\s*(.*)/);
    return `<span class="hl-meta">#! ${this._esc(key)}:</span> <span class="hl-meta-val">${this._esc(val)}</span>`;
  }
  if (/^# TODO:/i.test(trimmed))
    return `<span class="hl-todo">${this._esc(trimmed)}</span>`;
  if (/^# WARN:/i.test(trimmed))
    return `<span class="hl-warn">${this._esc(trimmed)}</span>`;
  if (/^#/.test(trimmed))
    return `<span class="hl-comment">${this._esc(trimmed)}</span>`;

  // Normal tokenization continues...
}
```

---

## FIX-09: Terminal Management System

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  HEADER BAR                                                  │
│  ARIVU                      ○ 3 active · ATHENA   Log in    │
│                             ↑                                │
│                         THE PILL                             │
│                        (click → grid)                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│              GRAPH AREA                                      │
│                                                              │
│     ┌──────────────────┐                                     │
│     │ Terminal #1      │  ← floating windows                 │
│     │ (draggable)      │    (position: fixed on body)        │
│     └──────────────────┘                                     │
│                         ┌──────────────────┐                 │
│                         │ Terminal #2      │                  │
│                         └──────────────────┘                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### The Pill

```
STATES
══════

State 0: No terminals       → pill invisible (display:none)
State 1: First terminal      → pill types in with typewriter animation:
                                ○ → ○ 1| → ○ 1 a| → ... → ○ 1 active
                                Blinking cursor during typing, disappears after
State 2: Count changes       → number updates with fade transition
State 3: Click              → grid menu opens below pill
State 4: All terminals closed → pill types out in reverse, disappears

VISUAL
══════
  ○ 3 active

  ○ = 10px circle outline, white stroke, no fill
  "3 active" = 12px, white, monospace
  Entire pill: no background, no border, just text
  Black and white ONLY
```

### The Grid Menu

```
STRUCTURE (3-column default, icon mode OFF)
═══════════════════════════════════════════

  ○ 3 active
  ┌──────────────────────────────────────┐
  │ ┌──────────┐ ┌──────────┐ ┌────────┐│
  │ │ T#1      │ │ T#2      │ │        ││
  │ │ ResNet   │ │ Analysis │ │   +    ││
  │ │ 47 cmds  │ │ 12 cmds  │ │        ││
  │ │ ●●●○○ 📌 │ │ ●●○○○    │ │        ││
  │ └──────────┘ └──────────┘ └────────┘│
  └──────────────────────────────────────┘

STRUCTURE (icon mode ON)
════════════════════════

  ○ 3 active
  ┌────────────────────────┐
  │ ┌────┐ ┌────┐ ┌────┐  │
  │ │⊞••│ │•?•│ │ + │  │
  │ │•⊞•│ │?•?│ │   │  │
  │ │••⊞│ │•?•│ │   │  │
  │ └────┘ └────┘ └────┘  │
  └────────────────────────┘
  hover on icon → expands to full info card
```

### Dot Matrix Icons (30 Icons)

Each icon is a 7×7 grid. 1 = white dot, 0 = empty.

```
ICON NAME       7x7 PATTERN (rows)
══════════════════════════════════════════════════

terminal        0111110 1000001 1011101 1000001 1011101 1000001 0111110
heart           0101010 1111111 1111111 0111110 0011100 0001000 0000000
pulse           0000000 0000100 0001010 1010001 0100000 0000000 0000000
arrows          0001000 0011100 0111110 0001000 0111110 0011100 0001000
diamond         0001000 0010100 0100010 1000001 0100010 0010100 0001000
question        0111110 1000001 0000010 0001100 0001000 0000000 0001000
exclaim         0001000 0001000 0001000 0001000 0001000 0000000 0001000
grid            1010101 0000000 1010101 0000000 1010101 0000000 1010101
compass         0011100 0100010 1001001 1010101 1001001 0100010 0011100
shield          0111110 1111111 1111111 1111111 0111110 0011100 0001000
code            0000000 0100010 1000100 0100010 0010001 0100010 0000000
atom            0011100 0100010 1010101 0111110 1010101 0100010 0011100
lightning       0000100 0001000 0011110 0001000 0111100 0010000 0100000
eye             0000000 0011100 0100010 1010101 0100010 0011100 0000000
lock            0011100 0100010 0100010 1111111 1111111 1111111 1111111
star            0001000 0001000 1111111 0011100 0101010 1000001 0000000
flag            0100000 0111100 0111100 0100000 0100000 0100000 0100000
home            0001000 0010100 0100010 1111111 1000001 1010101 1111111
music           0001100 0001010 0001000 0001000 0111000 1111000 0110000
bookmark        1111111 1111111 1111111 1111111 0111110 0011100 0001000
graph           1000000 1000100 1001010 1001010 1010010 1010010 1111111
beaker          0011100 0010100 0010100 0010100 0100010 1000001 1111111
gear            0010100 0111110 1101011 1111111 1101011 0111110 0010100
key             0000000 1100000 1011100 0001000 0001100 0001000 0001100
leaf            0001000 0010100 0100111 1111110 0100000 0010000 0001000
wave            0000000 0100010 1010101 0101010 1010101 0100010 0000000
circle          0011100 0100010 1000001 1000001 1000001 0100010 0011100
plus            0001000 0001000 0111110 0001000 0001000 0000000 0000000
minus           0000000 0000000 0111110 0000000 0000000 0000000 0000000
check           0000000 0000001 0000010 1000100 0101000 0010000 0000000
```

### Icon Picker UI (In Right-Click Menu)

```
Right-click on terminal card → "Pick icon" →

┌─ Pick Icon ─────────────────────────┐
│ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐  │
│ │⊞││♥ ││~││↕││◇││? ││! ││⊞││  │
│ └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘  │
│ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐  │
│ │◎ ││⊕ ││<>││⚛││⚡││👁││🔒││★ │  │
│ └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘  │
│ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐  │
│ │⚑││🏠││♪ ││🔖││📊││⚗ ││⚙ ││🔑│  │
│ └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘  │
│ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐          │
│ │🍃││〰││○ ││+ ││− ││✓ │          │
│ └──┘└──┘└──┘└──┘└──┘└──┘          │
└─────────────────────────────────────┘
```

Each icon rendered as actual dot-matrix (7×7 white dots on dark bg).

### Minimize Genie Warp Animation

```
MINIMIZE (terminal → grid card)
═══════════════════════════════

Frame 0:  Normal terminal window
          ┌────────────────────┐
          │                    │
          │     Terminal       │
          │                    │
          └────────────────────┘

Frame 1:  Bottom starts narrowing
          ┌────────────────────┐
          │                    │
          │     Terminal       │
           \                  /
            └────────────────┘

Frame 2:  Hourglass shape
          ┌────────────────────┐
          │                    │
           \    Terminal      /
            \                /
             └──────────────┘

Frame 3:  Sucking into point
          ┌────────────────────┐
            \                /
              \  Terminal  /
                \        /
                 └──────┘

Frame 4:  Almost gone
                │    │
                │term│
                └────┘

Frame 5:  Gone (absorbed into grid card)
                 ·

MAXIMIZE (grid card → terminal)
═══════════════════════════════

Exact reverse. Card expands with genie warp outward.
Spring overshoot at end: slightly overshoots size, bounces back.
```

### CSS Implementation Approach (clip-path)

```css
@keyframes genieMinimize {
  0%   { clip-path: polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%);
         transform: scale(1); opacity: 1; }
  30%  { clip-path: polygon(5% 0%, 95% 0%, 85% 100%, 15% 100%);
         transform: scale(0.8); }
  60%  { clip-path: polygon(15% 0%, 85% 0%, 65% 100%, 35% 100%);
         transform: scale(0.5); }
  85%  { clip-path: polygon(30% 0%, 70% 0%, 55% 100%, 45% 100%);
         transform: scale(0.2); }
  100% { clip-path: polygon(45% 0%, 55% 0%, 52% 100%, 48% 100%);
         transform: scale(0.05); opacity: 0; }
}
```

Duration: 400ms, easing: `cubic-bezier(0.4, 0, 0.6, 1)`

### Pin System Storage

```javascript
// localStorage key: arivu_pinned_terminals_{graphId}
[
  {
    id: "pin_abc123",
    name: "ResNet Analysis",
    icon: "terminal",                  // dot-matrix icon name
    graphId: "abc123",
    history: ["highlight resnet", ...],
    log: [{timestamp, command, status, parsed}, ...],
    inputValue: "zoom ",               // partially typed text
    scrollPosition: 1247,              // output scroll offset
    annotations: {...},
    pinnedAt: "2026-04-02T...",
    linkedSessionId: null,
    gridPosition: 0,                   // position in grid (for rearrangement)
  }
]
```

### Restore Algorithm (Opening a Pinned Terminal)

```
1. Create new ArivuTerminal instance
2. Set terminal.history = pin.history
3. Set terminal.log = pin.log
4. Replay last 50 commands from log at 0ms delay to rebuild output
5. Set terminal.inputEl.value = pin.inputValue
6. Call terminal._updateHighlight()
7. Set terminal.outputEl.scrollTop = pin.scrollPosition
8. Restore annotations from pin.annotations
9. Set terminal icon and grid position
10. Mark as no longer pinned-only (now active)
```

### Right-Click Context Menu

```
┌─────────────────────────┐
│  Open                   │
│  ─────────────────────  │
│  ⊞ Pin terminal         │  ← SVG pin icon
│  ⊞ Unpin                │  ← only if pinned
│  ⊟ Pick icon        ▸   │  → opens icon picker
│  ✎ Rename               │
│  ─────────────────────  │
│  💾 Save as session      │
│  📋 Export as script     │
│  ─────────────────────  │
│  ✕ Close                │
│  ✕ Close all others     │
│  ─────────────────────  │
│  Grid: 3 columns    ▸   │  → sub: 2, 3, 4, 5
│  □ Icon view             │  → checkbox toggle
└─────────────────────────┘
```

All icons are SVG, not emoji.

### Grid Navigation

- Arrow keys navigate between cards when grid is focused
- Enter opens selected card
- Delete closes selected terminal (with confirm)
- Escape closes grid menu
- Drag and drop to rearrange cards

### Graph Navigation Behavior

```
SCENARIO                              WHAT HAPPENS
══════════════════════════════════════════════════════════

Open new tab with different graph     Nothing happens to this tab
Same tab, navigate to new graph       Non-pinned terminals destroyed
                                      Pinned terminals saved to localStorage
                                      Pill count updates (may go to 0 → pill disappears)
Same tab, return to original graph    Pinned terminals restored from localStorage
                                      Pill reappears with typewriter animation
                                      Pinned cards appear in grid
```

### Carousel Stats Tab (Third Tab)

```
[ Sessions ]    [ Scripts ]    [ Stats ]

FRONT OF CARD (stats):
┌─────────────────────────┐
│ Terminal #1              │
│ ResNet Analysis          │
│                          │
│   47 commands            │
│   42 success · 5 errors  │
│   23 min uptime          │
│   Linked: ResNet Deep    │
│                          │
│   ⊞ Pinned               │
└─────────────────────────┘

BACK OF CARD (logs, after flip):
┌─────────────────────────┐
│ Terminal #1 — Logs    ↩ │
│                          │
│ ✓ 14:30 highlight resnet │
│ ✓ 14:30 filter bottle..  │
│ ✗ 14:30 zoom quantum     │
│ ✓ 14:31 annotate resnet  │
│ ... (scrollable)         │
│                          │
└─────────────────────────┘

FLIP ANIMATION: 3D rotateY(180deg), 600ms, preserve-3d
```

---

## FIX-10: Export Session Debug + Verbose Filter Log

### Problem
User had 84 commands, only 6 exported. Need to show what was filtered and why.

### Fix: Show Filter Summary Before Saving

```
arivu:resnet$ export session as script "test"
 Filtering 84 commands:
   kept:     6   (highlight ×2, zoom ×1, filter ×1, annotate ×1, info ×1)
   removed: 78   (help ×12, history ×8, script ×23, save ×5, clear ×10, ...)
 Save 6 commands as "test"? [y/n]
> y
 ✓ Script saved: "test" (v1)
   6 commands
```

Same for `script save`:
```
arivu:resnet$ script save "test"
 Filtering 84 commands:
   kept:     6
   removed: 78   (meta: help ×12, script ×23, ... | confirm: y ×3, n ×1)
 Save 6 commands as "test"? [y/n]
```

The "confirm: y ×3" category shows the y/n responses that were filtered.

---

## FIX-11: String Color Change

### Change

```
OLD: --term-string: #F59E0B (amber — too close to gold #D4A843)
NEW: --term-string: #38BDF8 (sky blue — distinct from everything)
```

Update in `arivu-terminal.css`:
```css
--term-string: #38BDF8;
```

Update CSS class:
```css
.term-string-val { color: var(--term-string); }
```

---

## FIX-12: Stop Saving y/n to History

### Root Cause
Enter handler at line 242 pushes to `this.history` UNCONDITIONALLY, even when `_pendingConfirm` consumed the input.

### Fix

```javascript
// In _attachEvents, the Enter handler:
if (e.key === 'Enter') {
  e.preventDefault();
  this._hideAC();
  const input = this.inputEl.value;
  if (input.trim()) {
    const wasPendingConfirm = !!this._pendingConfirm;  // capture BEFORE execute
    this._execute(input);
    if (!wasPendingConfirm) {                           // only push if NOT confirm
      this.history.push(input);
      this.historyIndex = this.history.length;
    }
  }
  this.inputEl.value = '';
  this._updateHighlight();
}
```

---

## FIX-13: Two-Step Delete in Carousel Script Cards

### Problem
The card-level ✕ button on script cards deletes immediately with just a CSS animation. No confirmation.

### Fix
Add the same two-click pattern used in the detail view:

```javascript
card.querySelector('.card-btn--delete')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const btn = e.target;
  if (btn.dataset.confirmed) {
    this._deleteScriptCard(script.name, card);
  } else {
    btn.textContent = 'Sure?';
    btn.style.color = '#ef4444';
    btn.dataset.confirmed = 'true';
    setTimeout(() => {
      btn.textContent = '✕';
      btn.style.color = '';
      delete btn.dataset.confirmed;
    }, 3000);
  }
});
```

Same pattern for session card delete buttons.

---

## FIX-14: Session Command Namespace

### Old Syntax → New Syntax (Deprecated Immediately)

```
OLD (deprecated)                    NEW (canonical)
═══════════════════════════════════════════════════════════
save session "name"                 session save "name"
load session "name"                 session load("name")
sessions                            session list
rename "name"                       session rename "old" "new"
delete session "name"               session delete "name"
(none)                              session load("name", replace)
(none)                              session load("name", continue)
(none)                              session append("name", ...)
```

### Deprecation: Hard Error

Old syntax shows:
```
arivu:resnet$ save session "test"
 ✗ Deprecated. Use: session save "test"
```

### Parser Changes

Register `session` as a command with subcommands:

```javascript
'session': { args: 'save|load|rename|delete|list|append', desc: 'Session management' },
```

Parse routing:
```javascript
case 'session': return this._parseSession(rest, raw);
```

### _parseSession Logic

```javascript
_parseSession(tokens, raw) {
  const sub = tokens[0]?.toLowerCase();
  const rest = tokens.slice(1);

  switch (sub) {
    case 'save': {
      const name = rest.join(' ').replace(/^["']|["']$/g, '');
      return { command: 'session_save', args: { name }, ... };
    }
    case 'load': {
      // Parse bracket syntax: load("name") or load("name", mode)
      const bracketContent = this._extractBracketArgs(tokens.slice(1), raw);
      if (bracketContent.error) return { command: null, args: {}, raw, error: bracketContent.error };
      const name = bracketContent.args[0];
      const mode = bracketContent.args[1] || 'new';  // default = new window
      return { command: 'session_load', args: { name, mode }, ... };
    }
    case 'rename': {
      const oldName = rest[0]?.replace(/^["']|["']$/g, '');
      const newName = rest[1]?.replace(/^["']|["']$/g, '');
      return { command: 'session_rename', args: { oldName, newName }, ... };
    }
    case 'delete': {
      const name = rest.join(' ').replace(/^["']|["']$/g, '');
      return { command: 'session_delete', args: { name }, ... };
    }
    case 'list': return { command: 'session_list', args: {}, ... };
    case 'append': {
      // Parse bracket syntax: append("name", selector)
      const bracketContent = this._extractBracketArgs(tokens.slice(1), raw);
      // ... parse selector (all, N, [N-M], from: "source")
    }
  }
}
```

### Bracket Argument Extractor

```javascript
_extractBracketArgs(tokens, raw) {
  // Join remaining tokens: '("name",' 'replace)'
  const joined = tokens.join(' ');
  // Match: (arg1, arg2, ...)
  const match = joined.match(/^\((.+)\)$/);
  if (!match) return { error: 'Expected (...). Usage: session load("name")' };
  // Split by comma, trim, strip quotes
  const args = match[1].split(',').map(a => a.trim().replace(/^["']|["']$/g, ''));
  return { args };
}
```

### session load Modes

```
session load("name")                → creates new terminal, loads session
session load("name", replace)       → clears current terminal, loads everything
session load("name", continue)      → adds session commands to current terminal

REPLACE MODE:
  1. Clear terminal output
  2. Clear history and log
  3. Set history = session.commands
  4. Set log = session.log
  5. Replay last 30 commands to rebuild output (0ms delay)
  6. Change terminal title to session name
  7. Restore annotations
  8. Link for auto-save

CONTINUE MODE:
  1. Append session.commands to current history
  2. Append session.log to current log
  3. Print: "Session 'name' loaded (continue mode). 45 commands added."
  4. Restore annotations (merge, not replace)
  5. Link for auto-save

NEW MODE (default):
  1. Create new terminal window
  2. Load everything like current load behavior
  3. Replay last 30 commands for visible output
```

### Highlighting

```
session         → gold (command)
load            → gold (sub-command)
(               → white
"name"          → sky blue (string)
,               → white
replace         → green (mode keyword)
continue        → green (mode keyword)
)               → white
```

### Autocomplete

```
AFTER                           SUGGESTS
═════════════════════════════════════════
session                         save, load, rename, delete, list, append
session load(                   session names in quotes
session load("name",            replace), continue)
session save                    (free text for name)
session rename                  session names for old name
session rename "old"            (free text for new name)
session delete                  session names
session append(                 session names
session append("name",          all, from:, or number/range
```

---

## FIX-15: Quick Replay

### Current Problem
`_replaySession()` uses `typeAndExecute()` — types each character at 40ms. Too slow.

### Add Quick Replay Mode

In carousel detail view, change buttons:

```
FROM: [Open] [▶ Replay]    [↓ Export] [✕ Delete]
TO:   [Open] [▶ Quick Load] [⟳ Replay] [↓ Export] [✕ Delete]
```

- **Quick Load** → executes all commands at 0ms delay, fast output rebuild
- **Replay** → existing typewriter animation (for when you want to watch)

### _quickReplaySession Implementation

```javascript
_quickReplaySession(session) {
  this.close();
  const tm = window.terminalManager;
  if (!tm) return;
  const term = tm.create();
  term.history = session.commands || [];
  term.log = session.log || [];
  term.linkedSessionId = session.id;
  term._updateTitle(session.name);

  // Fast replay — execute each command without animation
  term._print(` Quick loading: ${session.name}`, 'info');
  const cmds = session.commands || [];
  for (const cmd of cmds.slice(-30)) {  // last 30 for output
    const result = term.parser.parse(cmd);
    if (result.command && !result.error) {
      try { term._executeCommand(result); } catch {}
    }
  }
  term._print('');
  term._print(` ✓ Loaded: ${session.name} (${cmds.length} commands)`, 'success');

  // Restore annotations
  if (session.annotations) { /* ... restore ... */ }
  session.lastActive = new Date().toISOString();
  this._saveSessions();
}
```

---

## FIX-16: Session Save Overwrite + session append()

### Overwrite Confirmation

```
arivu:resnet$ session save "analysis"
 ⚠ Session "analysis" already exists (45 commands).
   Overwrite? [y/n]
> y
 ✓ Session saved: analysis (overwritten)
   47 commands, 3 annotations

> n
 Cancelled. Tip: use session append("analysis", all) to add commands.
```

### session append() Syntax

```
SYNTAX                                          DESCRIPTION
═══════════════════════════════════════════════════════════════════════

session append("name", all)                     Append all filtered history
session append("name", 5)                       Append command #5
session append("name", [3-7])                   Append range 3 through 7
```

### Validation

```
RULE                                    ERROR
═════════════════════════════════════════════════════════
Session doesn't exist                   "Session 'name' not found"
N < 1                                   "Command number must be ≥ 1"
N > history length                      "Command N doesn't exist (history has M)"
Range N2 < N1                           "Range end must be > start"
Range N2 > history                      "Range end exceeds history length"
No executable commands                  "No executable commands to append"
```

### After Append

```
arivu:resnet$ session append("analysis", [5-10])
 ✓ Appended 6 commands to "analysis"
   Session now has 51 commands total
```

---

## SUMMARY: All Changes by File

```
FILE                                CHANGES
═══════════════════════════════════════════════════════════════

arivu-terminal-parser.js
  - Subcommand highlighting in highlight() (FIX-01)
  - Rich comment/markup detection (FIX-08)
  - Export autocomplete (FIX-07)
  - Session command namespace: _parseSession() (FIX-14)
  - script append() parser (FIX-02)
  - session append() parser (FIX-16)
  - Bracket argument extractor (FIX-14)
  - Sequence mode keyword detection (FIX-05)
  - Deprecation of old session syntax (FIX-14)
  - Flag highlighting (--slow, --verbose) (FIX-01)
  - Mode keyword highlighting (replace, continue, all) (FIX-01)

arivu-terminal.js
  - ArivuScriptStorage: overwrite confirmation (FIX-02)
  - ArivuScriptStorage: script append() method (FIX-02)
  - _execute: don't push y/n to history (FIX-12)
  - _executeCommand: session_save with overwrite confirm (FIX-16)
  - _executeCommand: session_load with 3 modes (FIX-14)
  - _executeCommand: session_rename new syntax (FIX-14)
  - _executeCommand: session_delete (FIX-14)
  - _executeCommand: session_list (FIX-14)
  - _executeCommand: session_append (FIX-16)
  - _executeCommand: script_append (FIX-02)
  - _runScript: --slow flag support (FIX-05)
  - _runScript: --verbose flag support (FIX-05)
  - _runSequence: new method for sequence mode (FIX-05)
  - _showHelp: new format with <paper>, <type> etc (FIX-06)
  - _showHelp: expanded session help (FIX-06)
  - renderBox: new MySQL-style box method (FIX-04)
  - Verbose filter log in export/save (FIX-10)
  - Deprecated old session commands (FIX-14)

arivu-terminal.css
  - --term-string: #38BDF8 (FIX-11)
  - .term-error rule (already added)
  - .hl-header, .hl-rule, .hl-meta, .hl-todo, .hl-warn (FIX-08)
  - .hl-flag (FIX-01)
  - .hl-mode (FIX-01)
  - .hl-bracket (FIX-01)
  - Box renderer colors (FIX-04)

terminal-carousel.js
  - Two-step delete on script card buttons (FIX-13)
  - Quick replay method (FIX-15)
  - Stats tab (third tab) with flip animation (FIX-09)
  - Session detail: add "Quick Load" button (FIX-15)
  - Carousel open menu for session play (FIX-14)

NEW FILES:
  - static/js/terminal-grid.js — Grid menu, pill, minimize warp
  - static/js/terminal-icons.js — 30 dot matrix icon definitions
  - static/css/terminal-grid.css — Grid menu, pill, warp animation, icons
```

---

## EDGE CASES (COMPREHENSIVE)

```
EDGE CASE                                       HANDLING
═══════════════════════════════════════════════════════════════════════

script append("name", 0)                        Error: must be ≥ 1
script append("x", from: "x")                   Allowed (self-append duplicates)
script append("x", from: "y", [5-3])            Error: range end < start
session load("x", invalid)                      Error: mode must be replace/continue
session save "" (empty name)                     Error: name cannot be empty
Sequence mode + close terminal                  Sequence aborted, no errors
Sequence mode + "goto 2" at step 5              Error: can only go forward
Sequence mode + type normal command             Error: use Enter/skip/stop/peek
Pin terminal + navigate away + return           Pinned terminals restored
Pin terminal + clear localStorage               Pins lost, terminals gone
Grid 5 columns + resize window small            Grid cards wrap or shrink
Grid drag reorder + release outside grid        Card snaps back to original position
Minimize when grid menu closed                  Grid flashes open, warp plays, closes
Minimize last terminal                          Pill stays (1 active, minimized)
Close last terminal                             Pill disappears with typewriter-out
Old syntax "save session X"                     Hard error with migration hint
Icon picker + click outside                     Picker closes, no change
```

---

*End of TERMINAL_BUILD_PLAN.md. Ready to build on approval.*
