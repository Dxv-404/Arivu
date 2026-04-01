/**
 * arivu-terminal-parser.js — ArivuQL Command Parser
 *
 * Parses terminal input into structured command objects.
 * Handles syntax highlighting, error detection, fuzzy paper matching,
 * and auto-complete suggestions.
 */

class ArivuTerminalParser {
  constructor(graphData) {
    this.graphData = graphData || {};
    this.nodes = (graphData?.nodes || []);
    this.commands = {
      'annotate':   { args: '<paper> as "<label>"', desc: 'Add annotation badge to a paper' },
      'remove':     { args: 'annotation <paper>', desc: 'Remove annotation from paper' },
      'clear':      { args: 'annotations | screen', desc: 'Clear annotations or terminal' },
      'zoom':       { args: '<paper>', desc: 'Zoom to a paper in the graph' },
      'highlight':  { args: '<paper>', desc: 'Highlight a paper node' },
      'filter':     { args: '<type>', desc: 'Filter: bottlenecks, most-cited, contradictions' },
      'reset':      { args: '', desc: 'Reset all graph state' },
      'info':       { args: '<paper>', desc: 'Show paper statistics' },
      'compare':    { args: '<paper1> , <paper2>', desc: 'Compare two papers side-by-side' },
      'path':       { args: '<paper1> to <paper2>', desc: 'Find path between papers' },
      'deep-dive':  { args: '<paper>', desc: 'Start deep dive analysis in Athena' },
      'pathfinder': { args: '"<query>"', desc: 'Run Pathfinder positioning analysis' },
      'ls':         { args: 'annotations | papers', desc: 'List items' },
      'find':       { args: '"<search>"', desc: 'Search papers by name' },
      'help':       { args: '[command]', desc: 'Show help' },
      'history':    { args: '[--errors]', desc: 'Show command history' },
      'export':     { args: 'session as script|text "<name>"', desc: 'Export session as saved script or clipboard text' },
      'save':       { args: 'session "<name>"', desc: 'Save current terminal session' },
      'load':       { args: 'session "<name>"', desc: 'Load a saved session' },
      'sessions':   { args: '', desc: 'Open session carousel / list sessions' },
      'scripts':    { args: '', desc: 'List saved scripts' },
      'run':        { args: '"<script-name>"', desc: 'Run a saved script' },
      'script':     { args: 'save|list|info|delete|copy|run "<name>"', desc: 'Script management commands' },
      'rename':     { args: '"<new name>"', desc: 'Rename current session' },
      'delete':     { args: 'session|script "<name>"', desc: 'Delete a session or script' },
      'exit':       { args: '', desc: 'Close terminal' },
    };

    this.operators = new Set(['as', 'to', 'from', 'in', 'by', 'and', 'or', 'not', 'value', 'paper']);
    this.filterTypes = ['bottlenecks', 'most-cited', 'least-cited', 'contradictions', 'highest-impact', 'all'];
  }

  /**
   * Parse a command string into a structured command object.
   * Returns: { command, args, error, raw }
   */
  parse(input) {
    const raw = input.trim();
    if (!raw) return { command: null, args: {}, error: null, raw };
    if (raw.startsWith('#')) return { command: 'comment', args: { text: raw }, error: null, raw };

    // Tokenize — respect quoted strings
    const tokens = this._tokenize(raw);
    if (!tokens.length) return { command: null, args: {}, error: null, raw };

    const cmd = tokens[0].toLowerCase();
    const rest = tokens.slice(1);

    // Route to specific parsers
    switch (cmd) {
      case 'annotate': return this._parseAnnotate(rest, raw);
      case 'remove':   return this._parseRemove(rest, raw);
      case 'clear':    return this._parseClear(rest, raw);
      case 'zoom':     return this._parseSimplePaper(cmd, rest, raw);
      case 'highlight': return this._parseSimplePaper(cmd, rest, raw);
      case 'filter':   return this._parseFilter(rest, raw);
      case 'reset':    return { command: 'reset', args: {}, error: null, raw };
      case 'info':     return this._parseSimplePaper(cmd, rest, raw);
      case 'compare':  return this._parseCompare(rest, raw);
      case 'path':     return this._parsePath(rest, raw);
      case 'deep-dive': return this._parseSimplePaper('deep-dive', rest, raw);
      case 'pathfinder': return this._parsePathfinder(rest, raw);
      case 'ls':       return this._parseLs(rest, raw);
      case 'find':     return this._parseFind(rest, raw);
      case 'help':     return { command: 'help', args: { topic: rest.join(' ') || null }, error: null, raw };
      case 'history':  return { command: 'history', args: { errors: rest.includes('--errors') }, error: null, raw };
      case 'export': {
        // export session as script "name" | export session as text
        const restLower = rest.map(r => r.toLowerCase());
        if (restLower[0] === 'session' && restLower[1] === 'as' && restLower[2] === 'script') {
          const name = rest.slice(3).join(' ').replace(/^["']|["']$/g, '');
          return { command: 'export_script', args: { name }, error: name ? null : 'Usage: export session as script "<name>"', raw };
        }
        if (restLower[0] === 'session' && restLower[1] === 'as' && restLower[2] === 'text') {
          return { command: 'export_text', args: {}, error: null, raw };
        }
        // Fallback: "export script" or "export history" (legacy)
        if (restLower[0] === 'script' || restLower[0] === 'history') {
          return { command: 'export_text', args: {}, error: null, raw };
        }
        return { command: null, args: {}, raw, error: 'Usage: export session as script "<name>" | export session as text' };
      }
      case 'save': {
        // save session "name"
        if (rest[0]?.toLowerCase() === 'session') {
          const name = rest.slice(1).join(' ').replace(/^["']|["']$/g, '');
          return { command: 'save_session', args: { name }, error: name ? null : 'Usage: save session "<name>"', raw };
        }
        return { command: null, args: {}, raw, error: 'Usage: save session "<name>"' };
      }
      case 'load': {
        if (rest[0]?.toLowerCase() === 'session') {
          const name = rest.slice(1).join(' ').replace(/^["']|["']$/g, '');
          return { command: 'load_session', args: { name }, error: name ? null : 'Usage: load session "<name>"', raw };
        }
        return { command: null, args: {}, raw, error: 'Usage: load session "<name>"' };
      }
      case 'sessions': return { command: 'sessions', args: {}, error: null, raw };
      case 'rename': {
        const name = rest.join(' ').replace(/^["']|["']$/g, '');
        return { command: 'rename_session', args: { name }, error: name ? null : 'Usage: rename "<new name>"', raw };
      }
      case 'script': return this._parseScript(rest, raw);
      case 'run': {
        const scriptName = rest.join(' ').replace(/^["']|["']$/g, '');
        if (!scriptName) return { command: null, args: {}, raw, error: 'Usage: run "<script-name>"' };
        return { command: 'script_run', args: { name: scriptName }, error: null, raw };
      }
      case 'scripts': return { command: 'script_list', args: {}, error: null, raw };
      case 'delete': {
        if (rest[0]?.toLowerCase() === 'session') {
          const name = rest.slice(1).join(' ').replace(/^["']|["']$/g, '');
          return { command: 'delete_session', args: { name }, error: name ? null : 'Usage: delete session "<name>"', raw };
        }
        if (rest[0]?.toLowerCase() === 'script') {
          const name = rest.slice(1).join(' ').replace(/^["']|["']$/g, '');
          return { command: 'script_delete', args: { name }, error: name ? null : 'Usage: delete script "<name>"', raw };
        }
        return { command: null, args: {}, raw, error: 'Usage: delete session|script "<name>"' };
      }
      case 'exit':     return { command: 'exit', args: {}, error: null, raw };
      default:
        // Fuzzy command suggestion
        const suggestion = this._fuzzyCommand(cmd);
        return {
          command: null, args: {}, raw,
          error: `Unknown command: '${cmd}'${suggestion ? `. Did you mean: ${suggestion}?` : ''}. Type 'help' for available commands.`
        };
    }
  }

  _parseScript(tokens, raw) {
    if (!tokens.length) return { command: null, args: {}, raw, error: 'Usage: script save|list|info|delete|copy|run "<name>"' };
    const sub = tokens[0].toLowerCase();
    const rest = tokens.slice(1);

    switch (sub) {
      case 'save': {
        // script save "<name>" [--desc "<description>"]
        let name = '', desc = '';
        const descIdx = rest.findIndex(t => t.toLowerCase() === '--desc');
        if (descIdx >= 0) {
          name = rest.slice(0, descIdx).join(' ').replace(/^["']|["']$/g, '');
          desc = rest.slice(descIdx + 1).join(' ').replace(/^["']|["']$/g, '');
        } else {
          name = rest.join(' ').replace(/^["']|["']$/g, '');
        }
        if (!name) return { command: null, args: {}, raw, error: 'Usage: script save "<name>" [--desc "<description>"]' };
        return { command: 'script_save', args: { name, desc }, error: null, raw };
      }
      case 'list': return { command: 'script_list', args: {}, error: null, raw };
      case 'info': {
        const name = rest.join(' ').replace(/^["']|["']$/g, '');
        if (!name) return { command: null, args: {}, raw, error: 'Usage: script info "<name>"' };
        return { command: 'script_info', args: { name }, error: null, raw };
      }
      case 'delete': {
        const name = rest.join(' ').replace(/^["']|["']$/g, '');
        if (!name) return { command: null, args: {}, raw, error: 'Usage: script delete "<name>"' };
        return { command: 'script_delete', args: { name }, error: null, raw };
      }
      case 'copy': {
        // script copy "<name>" as "<new-name>"
        const asIdx = rest.findIndex(t => t.toLowerCase() === 'as');
        if (asIdx === -1) return { command: null, args: {}, raw, error: 'Usage: script copy "<name>" as "<new-name>"' };
        const srcName = rest.slice(0, asIdx).join(' ').replace(/^["']|["']$/g, '');
        const newName = rest.slice(asIdx + 1).join(' ').replace(/^["']|["']$/g, '');
        if (!srcName || !newName) return { command: null, args: {}, raw, error: 'Usage: script copy "<name>" as "<new-name>"' };
        return { command: 'script_copy', args: { name: srcName, newName }, error: null, raw };
      }
      case 'run': {
        const name = rest.join(' ').replace(/^["']|["']$/g, '');
        if (!name) return { command: null, args: {}, raw, error: 'Usage: script run "<name>"' };
        return { command: 'script_run', args: { name }, error: null, raw };
      }
      case 'export': {
        const name = rest.join(' ').replace(/^["']|["']$/g, '');
        if (!name) return { command: null, args: {}, raw, error: 'Usage: script export "<name>"' };
        return { command: 'script_export', args: { name }, error: null, raw };
      }
      default:
        return { command: null, args: {}, raw, error: `Unknown script subcommand: '${sub}'. Options: save, list, info, delete, copy, run, export` };
    }
  }

  _parseAnnotate(tokens, raw) {
    // annotate <paper> as "<label>"
    const asIdx = tokens.findIndex(t => t.toLowerCase() === 'as');
    if (asIdx === -1) {
      if (tokens.length === 0) return { command: null, args: {}, raw, error: 'Usage: annotate <paper> as "<label>"' };
      // No "as" — use "noted" as default label
      return { command: 'annotate', args: { paper: tokens.join(' '), label: 'noted' }, error: null, raw };
    }
    const paper = tokens.slice(0, asIdx).join(' ');
    const label = tokens.slice(asIdx + 1).join(' ').replace(/^["']|["']$/g, '');
    if (!paper) return { command: null, args: {}, raw, error: 'Usage: annotate <paper> as "<label>"' };
    if (!label) return { command: null, args: {}, raw, error: 'Missing label. Usage: annotate <paper> as "<label>"' };
    return { command: 'annotate', args: { paper, label: label.substring(0, 20) }, error: null, raw };
  }

  _parseRemove(tokens, raw) {
    // remove annotation value "label" — remove by annotation label
    // remove annotation paper "name" — remove by paper name
    // remove annotation "paper-or-label" — auto-detect
    // remove annotations — remove all
    if (tokens[0]?.toLowerCase() === 'annotation' || tokens[0]?.toLowerCase() === 'annotations') {
      const rest = tokens.slice(1);
      if (!rest.length) return { command: 'remove_annotation', args: { mode: 'all' }, error: null, raw };

      const keyword = rest[0]?.toLowerCase();
      if (keyword === 'value') {
        const label = rest.slice(1).join(' ').replace(/^["']|["']$/g, '');
        if (!label) return { command: null, args: {}, raw, error: 'Usage: remove annotation value "<label>"' };
        return { command: 'remove_annotation', args: { mode: 'value', label }, error: null, raw };
      }
      if (keyword === 'paper') {
        const paper = rest.slice(1).join(' ').replace(/^["']|["']$/g, '');
        if (!paper) return { command: null, args: {}, raw, error: 'Usage: remove annotation paper "<name>"' };
        return { command: 'remove_annotation', args: { mode: 'paper', paper }, error: null, raw };
      }
      // Default: treat as paper name
      const paper = rest.join(' ').replace(/^["']|["']$/g, '');
      return { command: 'remove_annotation', args: { mode: 'paper', paper }, error: null, raw };
    }
    return { command: null, args: {}, raw, error: 'Usage: remove annotation [value "<label>" | paper "<name>"]' };
  }

  _parseClear(tokens, raw) {
    const what = tokens[0]?.toLowerCase();
    if (what === 'annotations') return { command: 'clear_annotations', args: {}, error: null, raw };
    if (what === 'screen' || !what) return { command: 'clear_screen', args: {}, error: null, raw };
    return { command: 'clear_screen', args: {}, error: null, raw };
  }

  _parseSimplePaper(cmd, tokens, raw) {
    const paper = tokens.join(' ').replace(/^["']|["']$/g, '');
    if (!paper) return { command: null, args: {}, raw, error: `Usage: ${cmd} <paper>` };
    return { command: cmd, args: { paper }, error: null, raw };
  }

  _parseFilter(tokens, raw) {
    const type = tokens.join(' ').toLowerCase().replace(/-/g, '-');
    if (!type) return { command: null, args: {}, raw, error: `Usage: filter <type>\nTypes: ${this.filterTypes.join(', ')}` };
    return { command: 'filter', args: { type }, error: null, raw };
  }

  _parseCompare(tokens, raw) {
    // compare <p1> , <p2>  OR  compare <p1> and <p2>
    const sep = tokens.findIndex(t => t === ',' || t.toLowerCase() === 'and');
    if (sep === -1) return { command: null, args: {}, raw, error: 'Usage: compare <paper1> , <paper2>' };
    const p1 = tokens.slice(0, sep).join(' ');
    const p2 = tokens.slice(sep + 1).join(' ');
    if (!p1 || !p2) return { command: null, args: {}, raw, error: 'Usage: compare <paper1> , <paper2>' };
    return { command: 'compare', args: { paper1: p1, paper2: p2 }, error: null, raw };
  }

  _parsePath(tokens, raw) {
    const toIdx = tokens.findIndex(t => t.toLowerCase() === 'to');
    if (toIdx === -1) return { command: null, args: {}, raw, error: 'Usage: path <paper1> to <paper2>' };
    const p1 = tokens.slice(0, toIdx).join(' ');
    const p2 = tokens.slice(toIdx + 1).join(' ');
    if (!p1 || !p2) return { command: null, args: {}, raw, error: 'Usage: path <paper1> to <paper2>' };
    return { command: 'path', args: { from: p1, to: p2 }, error: null, raw };
  }

  _parsePathfinder(tokens, raw) {
    const query = tokens.join(' ').replace(/^["']|["']$/g, '');
    if (!query) return { command: null, args: {}, raw, error: 'Usage: pathfinder "<query>"' };
    return { command: 'pathfinder', args: { query }, error: null, raw };
  }

  _parseLs(tokens, raw) {
    const what = tokens[0]?.toLowerCase() || 'annotations';
    return { command: 'ls', args: { what }, error: null, raw };
  }

  _parseFind(tokens, raw) {
    const query = tokens.join(' ').replace(/^["']|["']$/g, '');
    if (!query) return { command: null, args: {}, raw, error: 'Usage: find "<search>"' };
    return { command: 'find', args: { query }, error: null, raw };
  }

  /**
   * Resolve a paper name to a node in the graph.
   * Returns { id, title, node } or null.
   */
  resolvePaper(name) {
    if (!name || !this.nodes.length) return null;
    const lower = name.toLowerCase().trim().replace(/^["']|["']$/g, '');

    // Exact title match
    for (const n of this.nodes) {
      if ((n.title || '').toLowerCase() === lower) return { id: n.id, title: n.title, node: n };
    }

    // Alias map
    const aliases = {
      'resnet': 'residual', 'vgg': 'very deep convolutional', 'vggnet': 'very deep convolutional',
      'alexnet': 'imagenet classification with deep', 'googlenet': 'going deeper',
      'inception': 'going deeper', 'lstm': 'long short-term', 'batch norm': 'batch normalization',
      'faster rcnn': 'faster r-cnn', 'r-cnn': 'rich feature hierarchies',
    };
    const expanded = aliases[lower] || lower;

    // Substring match (best: shortest title containing the query)
    let best = null;
    let bestLen = Infinity;
    for (const n of this.nodes) {
      const title = (n.title || '').toLowerCase();
      if (title.includes(expanded) && title.length < bestLen) {
        best = { id: n.id, title: n.title, node: n };
        bestLen = title.length;
      }
    }
    if (best) return best;

    // Word overlap scoring
    const queryWords = lower.split(/\s+/).filter(w => w.length > 2);
    let topScore = 0;
    let topMatch = null;
    for (const n of this.nodes) {
      const titleWords = (n.title || '').toLowerCase().split(/\s+/);
      const overlap = queryWords.filter(w => titleWords.some(tw => tw.includes(w))).length;
      if (overlap > topScore) {
        topScore = overlap;
        topMatch = { id: n.id, title: n.title, node: n };
      }
    }
    if (topScore >= 1) return topMatch;

    return null;
  }

  /**
   * Get auto-complete suggestions for partial input.
   */
  getSuggestions(input) {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return Object.entries(this.commands).map(([cmd, info]) => ({ text: cmd, desc: info.desc, type: 'command' }));

    const tokens = trimmed.split(/\s+/);
    const firstWord = tokens[0];
    const hasTrailingSpace = input.endsWith(' ');

    // Command completion (first word, no trailing space)
    if (tokens.length === 1 && !hasTrailingSpace) {
      return Object.entries(this.commands)
        .filter(([cmd]) => cmd.startsWith(firstWord))
        .map(([cmd, info]) => ({ text: cmd, desc: info.desc, type: 'command' }));
    }

    // If exactly 1 token + trailing space, treat as "ready for arguments"
    if (tokens.length === 1 && hasTrailingSpace) {
      tokens.push(''); // Add empty arg token
    }

    const cmd = firstWord;
    const argText = tokens.slice(1).join(' ');
    const lastToken = tokens[tokens.length - 1];

    // ── Filter type completion ──
    if (cmd === 'filter') {
      return this.filterTypes
        .filter(t => t.startsWith(argText))
        .map(t => ({ text: `filter ${t}`, desc: '', type: 'arg' }));
    }

    // ── ls completion ──
    if (cmd === 'ls') {
      return ['annotations', 'papers'].filter(t => t.startsWith(argText))
        .map(t => ({ text: `ls ${t}`, desc: '', type: 'arg' }));
    }

    // ── Clear completion ──
    if (cmd === 'clear') {
      return ['annotations', 'screen'].filter(t => t.startsWith(argText))
        .map(t => ({ text: `clear ${t}`, desc: '', type: 'arg' }));
    }

    // ── Remove completion ──
    if (cmd === 'remove') {
      if (tokens.length === 2 && !argText.startsWith('annotation')) {
        return [{ text: 'remove annotation', desc: 'Remove annotation by paper or value', type: 'arg' }];
      }
      if (argText === 'annotation' || argText === 'annotations') {
        return [
          { text: 'remove annotation value', desc: 'Remove by annotation label', type: 'arg' },
          { text: 'remove annotation paper', desc: 'Remove by paper name', type: 'arg' },
        ];
      }
      if (argText.startsWith('annotation paper') || argText.startsWith('annotations paper')) {
        const paperPart = argText.replace(/^annotations?\s+paper\s*/, '');
        return this._paperSuggestions(cmd, 'remove annotation paper', paperPart);
      }
      if (argText.startsWith('annotation value') || argText.startsWith('annotations value')) {
        // Suggest existing annotation labels
        const graphId = window._arivuGraph?.metadata?.graph_id || 'default';
        try {
          const existing = JSON.parse(sessionStorage.getItem(`athena_annotations_${graphId}`) || '{}');
          return Object.values(existing).map(a => ({
            text: `remove annotation value "${a.label}"`,
            desc: 'Remove this annotation',
            type: 'arg',
          }));
        } catch { return []; }
      }
      // Fallback: suggest papers
      if (argText.startsWith('annotation')) {
        const paperPart = argText.replace(/^annotations?\s*/, '');
        return this._paperSuggestions(cmd, 'remove annotation', paperPart);
      }
    }

    // ── Script subcommand completion ──
    if (cmd === 'script') {
      const subCmds = ['save', 'list', 'info', 'delete', 'copy', 'run', 'export'];
      if (tokens.length === 2) {
        return subCmds
          .filter(s => s.startsWith(argText))
          .map(s => ({ text: `script ${s}`, desc: `Script ${s} command`, type: 'arg' }));
      }
      // After subcommand, suggest script names
      const sub = tokens[1]?.toLowerCase();
      if (['info', 'delete', 'copy', 'run', 'export'].includes(sub)) {
        const scripts = JSON.parse(localStorage.getItem('arivu_terminal_scripts') || '[]');
        const nameQuery = tokens.slice(2).join(' ').replace(/^["']|["']$/g, '').toLowerCase();
        return scripts
          .filter(s => !nameQuery || s.name.toLowerCase().includes(nameQuery))
          .slice(0, 8)
          .map(s => ({
            text: `script ${sub} "${s.name}"`,
            desc: `${s.commands?.length || 0} cmds · ${s.description || 'No description'}`.substring(0, 40),
            type: 'arg',
          }));
      }
      return [];
    }

    // ── Run script name completion ──
    if (cmd === 'run') {
      const scripts = JSON.parse(localStorage.getItem('arivu_terminal_scripts') || '[]');
      const nameQuery = argText.replace(/^["']|["']$/g, '').toLowerCase();
      return scripts
        .filter(s => !nameQuery || s.name.toLowerCase().includes(nameQuery))
        .slice(0, 8)
        .map(s => ({
          text: `run "${s.name}"`,
          desc: `${s.commands?.length || 0} cmds`,
          type: 'arg',
        }));
    }

    // ── Delete session/script completion ──
    if (cmd === 'delete') {
      if (tokens.length === 2) {
        return ['session', 'script']
          .filter(s => s.startsWith(argText))
          .map(s => ({ text: `delete ${s}`, desc: `Delete a ${s}`, type: 'arg' }));
      }
      if (tokens[1]?.toLowerCase() === 'script') {
        const scripts = JSON.parse(localStorage.getItem('arivu_terminal_scripts') || '[]');
        const nameQuery = tokens.slice(2).join(' ').replace(/^["']|["']$/g, '').toLowerCase();
        return scripts
          .filter(s => !nameQuery || s.name.toLowerCase().includes(nameQuery))
          .slice(0, 8)
          .map(s => ({ text: `delete script "${s.name}"`, desc: `${s.commands?.length || 0} cmds`, type: 'arg' }));
      }
      if (tokens[1]?.toLowerCase() === 'session') {
        const sessions = JSON.parse(localStorage.getItem('arivu_terminal_sessions') || '[]');
        const nameQuery = tokens.slice(2).join(' ').replace(/^["']|["']$/g, '').toLowerCase();
        return sessions
          .filter(s => !nameQuery || s.name.toLowerCase().includes(nameQuery))
          .slice(0, 8)
          .map(s => ({ text: `delete session "${s.name}"`, desc: `${s.totalCommands || 0} cmds`, type: 'arg' }));
      }
      return [];
    }

    // ── Help completion ──
    if (cmd === 'help') {
      return Object.entries(this.commands)
        .filter(([c]) => c.startsWith(argText))
        .map(([c, info]) => ({ text: `help ${c}`, desc: info.desc, type: 'command' }));
    }

    // ── Compare: "compare paper1 and paper2" ──
    if (cmd === 'compare') {
      // Check if "and" has been typed
      const andIdx = argText.indexOf(' and ');
      if (andIdx >= 0) {
        // After "and" — suggest second paper
        const secondPart = argText.substring(andIdx + 5).trim();
        const firstPart = argText.substring(0, andIdx).trim();
        return this._paperSuggestions(cmd, `compare "${firstPart}" and`, secondPart);
      }
      // Before "and" — suggest first paper
      return this._paperSuggestions(cmd, 'compare', argText);
    }

    // ── Path: "path paper1 to paper2" ──
    if (cmd === 'path') {
      const toIdx = argText.indexOf(' to ');
      if (toIdx >= 0) {
        const secondPart = argText.substring(toIdx + 4).trim();
        const firstPart = argText.substring(0, toIdx).trim();
        return this._paperSuggestions(cmd, `path "${firstPart}" to`, secondPart);
      }
      return this._paperSuggestions(cmd, 'path', argText);
    }

    // ── Annotate: after paper, suggest "as" ──
    if (cmd === 'annotate') {
      // If "as" is in the text, no more suggestions
      if (argText.includes(' as ')) return [];
      // Check if there's enough text for a paper match
      const paperMatches = this.nodes.filter(n => (n.title || '').toLowerCase().includes(argText)).length;
      if (paperMatches > 0) {
        return this._paperSuggestions(cmd, 'annotate', argText);
      }
      return [];
    }

    // ── Generic paper name completion for other commands ──
    if (['zoom', 'highlight', 'info', 'deep-dive', 'find'].includes(cmd)) {
      return this._paperSuggestions(cmd, cmd, argText);
    }

    return [];
  }

  /**
   * Helper: generate paper name suggestions for auto-complete.
   */
  _paperSuggestions(cmd, prefix, query) {
    if (!query) {
      // Show top papers by citation
      return this.nodes
        .sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0))
        .slice(0, 8)
        .map(n => ({
          text: `${prefix} "${(n.title || '').substring(0, 38)}"`,
          desc: `${n.year || '?'} · ${(n.citation_count || 0).toLocaleString()} cites`,
          type: 'paper',
        }));
    }
    return this.nodes
      .filter(n => (n.title || '').toLowerCase().includes(query))
      .slice(0, 8)
      .map(n => ({
        text: `${prefix} "${(n.title || '').substring(0, 38)}"`,
        desc: `${n.year || '?'} · ${(n.citation_count || 0).toLocaleString()} cites`,
        type: 'paper',
      }));
  }

  /**
   * Syntax-highlight a command string for display.
   * Returns HTML with colored spans.
   */
  highlight(input) {
    if (!input) return '';
    const tokens = this._tokenize(input);
    if (!tokens.length) return this._esc(input);

    let html = '';
    let pos = 0;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const idx = input.indexOf(token, pos);
      // Add any whitespace before this token
      if (idx > pos) html += input.substring(pos, idx);

      if (i === 0) {
        // Command keyword
        const isValid = token.toLowerCase() in this.commands;
        html += `<span class="${isValid ? 'term-cmd-keyword' : 'term-error'}">${this._esc(token)}</span>`;
      } else if (this.operators.has(token.toLowerCase())) {
        html += `<span class="term-operator">${this._esc(token)}</span>`;
      } else if (token.startsWith('"') || token.startsWith("'")) {
        html += `<span class="term-string-val">${this._esc(token)}</span>`;
      } else if (/^\d+(\.\d+)?$/.test(token)) {
        html += `<span class="term-data-val">${this._esc(token)}</span>`;
      } else if (token.startsWith('--')) {
        html += `<span class="term-operator">${this._esc(token)}</span>`;
      } else {
        // Could be a paper name — keep default color
        html += this._esc(token);
      }
      pos = idx + token.length;
    }

    // Any trailing text
    if (pos < input.length) html += input.substring(pos);
    return html;
  }

  _tokenize(input) {
    const tokens = [];
    let i = 0;
    while (i < input.length) {
      // Skip whitespace
      while (i < input.length && input[i] === ' ') i++;
      if (i >= input.length) break;

      // Quoted string
      if (input[i] === '"' || input[i] === "'") {
        const quote = input[i];
        let j = i + 1;
        while (j < input.length && input[j] !== quote) j++;
        tokens.push(input.substring(i, j + 1));
        i = j + 1;
      } else {
        // Regular token
        let j = i;
        while (j < input.length && input[j] !== ' ') j++;
        tokens.push(input.substring(i, j));
        i = j;
      }
    }
    return tokens;
  }

  _fuzzyCommand(input) {
    const cmds = Object.keys(this.commands);
    let best = null;
    let bestDist = 3;
    for (const cmd of cmds) {
      const dist = this._levenshtein(input.toLowerCase(), cmd);
      if (dist < bestDist) {
        bestDist = dist;
        best = cmd;
      }
    }
    return best;
  }

  _levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] !== b[j-1] ? 1 : 0));
    return dp[m][n];
  }

  _esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

// Export for use
window.ArivuTerminalParser = ArivuTerminalParser;
