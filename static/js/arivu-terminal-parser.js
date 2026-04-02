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
      'session':    { args: 'save|load|rename|delete|list|append', desc: 'Session management commands' },
      'rename':     { args: '"<new name>"', desc: 'Deprecated → session rename' },
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
        if (rest[0]?.toLowerCase() === 'session') {
          const name = rest.slice(1).join(' ').replace(/^["']|["']$/g, '');
          return { command: null, args: {}, raw, error: `Deprecated. Use: session save "${name || '<name>'}"` };
        }
        return { command: null, args: {}, raw, error: 'Deprecated. Use: session save "<name>"' };
      }
      case 'load': {
        if (rest[0]?.toLowerCase() === 'session') {
          const name = rest.slice(1).join(' ').replace(/^["']|["']$/g, '');
          return { command: null, args: {}, raw, error: `Deprecated. Use: session load("${name || '<name>'}")` };
        }
        return { command: null, args: {}, raw, error: 'Deprecated. Use: session load("<name>")' };
      }
      case 'sessions': return { command: null, args: {}, raw, error: 'Deprecated. Use: session list' };
      case 'rename': {
        const name = rest.join(' ').replace(/^["']|["']$/g, '');
        return { command: null, args: {}, raw, error: `Deprecated. Use: session rename "<old>" "${name || '<new>'}"` };
      }
      case 'session': return this._parseSession(rest, raw);
      case 'script': return this._parseScript(rest, raw);
      case 'run': {
        // Separate name, flags, and "as sequence"
        let nameTokens = [];
        let flags = [];
        let asSequence = false;
        for (let ri = 0; ri < rest.length; ri++) {
          const t = rest[ri];
          if (t.toLowerCase() === 'as' && rest[ri + 1]?.toLowerCase() === 'sequence') {
            asSequence = true; ri++;
          } else if (t.startsWith('--')) { flags.push(t); }
          else if (flags.length === 0 && !asSequence) { nameTokens.push(t); }
          else { flags.push(t); }
        }
        const scriptName = nameTokens.join(' ').replace(/^["']|["']$/g, '');
        if (!scriptName) return { command: null, args: {}, raw, error: 'Usage: run "<name>" [--slow|--verbose|as sequence]' };
        return { command: 'script_run', args: { name: scriptName, flags, asSequence }, error: null, raw };
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
        // Separate name from flags and detect "as sequence"
        let nameTokens = [];
        let flags = [];
        let asSequence = false;
        for (let ti = 0; ti < rest.length; ti++) {
          const t = rest[ti];
          if (t.toLowerCase() === 'as' && rest[ti + 1]?.toLowerCase() === 'sequence') {
            asSequence = true;
            ti++; // skip 'sequence'
          } else if (t.startsWith('--')) {
            flags.push(t);
          } else if (flags.length === 0 && !asSequence) {
            nameTokens.push(t);
          } else {
            flags.push(t); // flag values like --top 5
          }
        }
        const name = nameTokens.join(' ').replace(/^["']|["']$/g, '');
        if (!name) return { command: null, args: {}, raw, error: 'Usage: script run "<name>" [--slow|--verbose|as sequence]' };
        return { command: 'script_run', args: { name, flags, asSequence }, error: null, raw };
      }
      case 'export': {
        const name = rest.join(' ').replace(/^["']|["']$/g, '');
        if (!name) return { command: null, args: {}, raw, error: 'Usage: script export "<name>"' };
        return { command: 'script_export', args: { name }, error: null, raw };
      }
      case 'append': {
        // script append("name", selector)
        // selector: all | N | [N-M] | from: "source" | from: "source", N | from: "source", [N-M]
        const bracketResult = this._extractBracketArgs(rest);
        if (bracketResult.error) return { command: null, args: {}, raw, error: bracketResult.error };
        const bArgs = bracketResult.args;
        if (!bArgs.length) return { command: null, args: {}, raw, error: 'Usage: script append("<name>", all|N|[N-M])' };

        const targetName = bArgs[0];
        if (!targetName) return { command: null, args: {}, raw, error: 'Missing script name' };

        // Parse the selector (2nd+ args)
        const selectorRaw = bArgs.slice(1).join(', ');
        let selector = { type: 'all' };

        if (bArgs.length < 2 || bArgs[1]?.toLowerCase() === 'all') {
          selector = { type: 'all' };
        } else if (bArgs[1]?.toLowerCase().startsWith('from:')) {
          // from: "source" or from: "source", N or from: "source", [N-M]
          const sourceRaw = bArgs[1].replace(/^from:\s*/i, '').replace(/^["']|["']$/g, '');
          const thirdArg = bArgs[2];
          if (!sourceRaw) return { command: null, args: {}, raw, error: 'Missing source script name after from:' };
          if (!thirdArg) {
            selector = { type: 'from_all', source: sourceRaw };
          } else {
            const rangeMatch = thirdArg.match(/^\[(\d+)-(\d+)\]$/);
            if (rangeMatch) {
              selector = { type: 'from_range', source: sourceRaw, start: parseInt(rangeMatch[1]), end: parseInt(rangeMatch[2]) };
            } else if (/^\d+$/.test(thirdArg)) {
              selector = { type: 'from_single', source: sourceRaw, index: parseInt(thirdArg) };
            } else {
              return { command: null, args: {}, raw, error: `Invalid selector: '${thirdArg}'. Use: N, [N-M], or all` };
            }
          }
        } else {
          // N or [N-M]
          const sel = bArgs[1];
          const rangeMatch = sel.match(/^\[(\d+)-(\d+)\]$/);
          if (rangeMatch) {
            selector = { type: 'range', start: parseInt(rangeMatch[1]), end: parseInt(rangeMatch[2]) };
          } else if (/^\d+$/.test(sel)) {
            selector = { type: 'single', index: parseInt(sel) };
          } else {
            return { command: null, args: {}, raw, error: `Invalid selector: '${sel}'. Use: all, N, [N-M], or from: "<script>"` };
          }
        }

        return { command: 'script_append', args: { name: targetName, selector }, error: null, raw };
      }
      default:
        return { command: null, args: {}, raw, error: `Unknown script subcommand: '${sub}'. Options: save, list, info, delete, copy, run, export, append` };
    }
  }

  /**
   * Extract arguments from bracket syntax: append("name", selector)
   * Input: remaining tokens after the subcommand, e.g., ['("name",', '5)']
   * Returns: { args: ["name", "5"], error: null } or { args: null, error: "..." }
   */
  _extractBracketArgs(tokens) {
    const joined = tokens.join(' ');
    // Match: (...content...)
    const match = joined.match(/^\((.+)\)$/);
    if (!match) {
      // Try partial: maybe user typed "name", 5) without opening paren
      return { args: null, error: 'Expected (...). Usage: command("name", selector)' };
    }
    // Split by comma, respecting quotes
    const inner = match[1];
    const args = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if ((ch === '"' || ch === "'") && !inQuote) { inQuote = true; quoteChar = ch; current += ch; }
      else if (ch === quoteChar && inQuote) { inQuote = false; current += ch; }
      else if (ch === ',' && !inQuote) { args.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    if (current.trim()) args.push(current.trim());
    // Strip quotes from each arg
    return { args: args.map(a => a.replace(/^["']|["']$/g, '')), error: null };
  }

  _parseSession(tokens, raw) {
    if (!tokens.length) return { command: null, args: {}, raw, error: 'Usage: session save|load|rename|delete|list|append' };
    const sub = tokens[0].toLowerCase();
    const rest = tokens.slice(1);

    switch (sub) {
      case 'save': {
        const name = rest.join(' ').replace(/^["']|["']$/g, '');
        if (!name) return { command: null, args: {}, raw, error: 'Usage: session save "<name>"' };
        return { command: 'session_save', args: { name }, error: null, raw };
      }
      case 'load': {
        // session load("name") or session load("name", replace|continue)
        const bracketResult = this._extractBracketArgs(rest);
        if (bracketResult.error) {
          // Maybe they used space syntax: session load "name"
          const name = rest.join(' ').replace(/^["']|["']$/g, '');
          if (name) return { command: 'session_load', args: { name, mode: 'new' }, error: null, raw };
          return { command: null, args: {}, raw, error: 'Usage: session load("<name>") or session load("<name>", replace|continue)' };
        }
        const name = bracketResult.args[0];
        const mode = bracketResult.args[1]?.toLowerCase() || 'new';
        if (!name) return { command: null, args: {}, raw, error: 'Missing session name' };
        if (mode && !['new', 'replace', 'continue'].includes(mode)) {
          return { command: null, args: {}, raw, error: `Invalid mode: '${mode}'. Must be replace or continue.` };
        }
        return { command: 'session_load', args: { name, mode }, error: null, raw };
      }
      case 'rename': {
        // session rename "old" "new"
        const oldName = rest[0]?.replace(/^["']|["']$/g, '');
        const newName = rest.slice(1).join(' ').replace(/^["']|["']$/g, '');
        if (!oldName) return { command: null, args: {}, raw, error: 'Usage: session rename "<old-name>" "<new-name>"' };
        if (!newName) return { command: null, args: {}, raw, error: 'Usage: session rename "<old-name>" "<new-name>"' };
        return { command: 'session_rename', args: { oldName, newName }, error: null, raw };
      }
      case 'delete': {
        const name = rest.join(' ').replace(/^["']|["']$/g, '');
        if (!name) return { command: null, args: {}, raw, error: 'Usage: session delete "<name>"' };
        return { command: 'session_delete', args: { name }, error: null, raw };
      }
      case 'list': return { command: 'session_list', args: {}, error: null, raw };
      case 'append': {
        // session append("name", all|N|[N-M])
        const bracketResult = this._extractBracketArgs(rest);
        if (bracketResult.error) return { command: null, args: {}, raw, error: bracketResult.error };
        const bArgs = bracketResult.args;
        if (!bArgs.length || !bArgs[0]) return { command: null, args: {}, raw, error: 'Usage: session append("<name>", all|N|[N-M])' };

        const targetName = bArgs[0];
        let selector = { type: 'all' };

        if (bArgs.length < 2 || bArgs[1]?.toLowerCase() === 'all') {
          selector = { type: 'all' };
        } else {
          const sel = bArgs[1];
          const rangeMatch = sel.match(/^\[(\d+)-(\d+)\]$/);
          if (rangeMatch) {
            selector = { type: 'range', start: parseInt(rangeMatch[1]), end: parseInt(rangeMatch[2]) };
          } else if (/^\d+$/.test(sel)) {
            selector = { type: 'single', index: parseInt(sel) };
          } else {
            return { command: null, args: {}, raw, error: `Invalid selector: '${sel}'. Use: all, N, or [N-M]` };
          }
        }
        return { command: 'session_append', args: { name: targetName, selector }, error: null, raw };
      }
      default:
        return { command: null, args: {}, raw, error: `Unknown session subcommand: '${sub}'. Options: save, load, rename, delete, list, append` };
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

    // ── Export completion ──
    if (cmd === 'export') {
      if (tokens.length === 2) {
        return ['session'].filter(s => s.startsWith(argText))
          .map(s => ({ text: `export ${s}`, desc: 'Export session data', type: 'arg' }));
      }
      if (tokens[1]?.toLowerCase() === 'session' && tokens.length === 3) {
        return ['as'].filter(s => s.startsWith(tokens[2]?.toLowerCase() || ''))
          .map(s => ({ text: `export session ${s}`, desc: '', type: 'arg' }));
      }
      if (tokens[1]?.toLowerCase() === 'session' && tokens[2]?.toLowerCase() === 'as' && tokens.length === 4) {
        return ['script', 'text']
          .filter(s => s.startsWith(tokens[3]?.toLowerCase() || ''))
          .map(s => ({ text: `export session as ${s}`, desc: s === 'script' ? 'Save as reusable script' : 'Copy to clipboard', type: 'arg' }));
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

  // ── Subcommand Map: which second-tokens get gold highlighting ──
  static SUBCOMMAND_MAP = {
    'script':  new Set(['save','list','info','delete','copy','run','export','append','diff','edit','history','revert']),
    'session': new Set(['save','load','rename','delete','list','append']),
    'export':  new Set(['session']),
    'delete':  new Set(['session','script']),
    'remove':  new Set(['annotation','annotations']),
    'clear':   new Set(['annotations','screen','variables']),
    'ls':      new Set(['annotations','papers','scripts','variables','sessions']),
  };

  // ── Mode keywords: get green highlighting ──
  static MODE_KEYWORDS = new Set(['replace','continue','all','sequence']);

  /**
   * Syntax-highlight a command string for display.
   * Returns HTML with colored spans.
   *
   * Priority order:
   *  1. Rich markup (===, ---, ##, #!, # TODO, # WARN, #)
   *  2. Command keyword (1st token)
   *  3. Sub-command keyword (2nd token, context-aware)
   *  4. Flags (--xxx) → green
   *  5. Mode keywords (replace, continue, all, sequence) → green
   *  6. Operators (as, to, and, from, etc.) → teal
   *  7. Brackets/parens/commas → white
   *  8. Strings ("...") → sky blue
   *  9. Numbers → teal
   * 10. Default → white
   */
  highlight(input) {
    if (!input) return '';
    const trimmed = input.trim();

    // ── Rich markup — detect BEFORE tokenization ──
    if (/^={3,}$/.test(trimmed))
      return `<span class="term-hl-rule">${'═'.repeat(48)}</span>`;
    if (/^-{2,}$/.test(trimmed))
      return `<span class="term-hl-rule">${'─'.repeat(48)}</span>`;
    if (/^## /.test(trimmed))
      return `<span class="term-hl-header">${this._esc(trimmed)}</span>`;
    if (/^#!\s*(\w+):\s*(.*)/.test(trimmed)) {
      const m = trimmed.match(/^(#!\s*\w+:)\s*(.*)/);
      return `<span class="term-hl-meta-key">${this._esc(m[1])}</span> <span class="term-hl-meta-val">${this._esc(m[2])}</span>`;
    }
    if (/^#\s*TODO:/i.test(trimmed))
      return `<span class="term-hl-todo">${this._esc(trimmed)}</span>`;
    if (/^#\s*WARN:/i.test(trimmed))
      return `<span class="term-hl-warn">${this._esc(trimmed)}</span>`;
    if (/^#/.test(trimmed))
      return `<span class="term-hl-comment">${this._esc(trimmed)}</span>`;

    // ── Normal tokenization ──
    const tokens = this._tokenize(input);
    if (!tokens.length) return this._esc(input);

    const cmd = tokens[0]?.toLowerCase() || '';
    const subCmds = ArivuTerminalParser.SUBCOMMAND_MAP[cmd];

    let html = '';
    let pos = 0;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const tokenLower = token.toLowerCase();
      const idx = input.indexOf(token, pos);

      // Preserve whitespace before this token
      if (idx > pos) html += input.substring(pos, idx);

      if (i === 0) {
        // First token: command keyword
        const isValid = tokenLower in this.commands;
        html += `<span class="${isValid ? 'term-cmd-keyword' : 'term-error'}">${this._esc(token)}</span>`;

      } else if (i === 1 && subCmds?.has(tokenLower)) {
        // Second token: sub-command (gold, same as command)
        html += `<span class="term-cmd-keyword">${this._esc(token)}</span>`;

      } else if (token.startsWith('--')) {
        // Flags: --verbose, --slow, --desc, etc. → green
        html += `<span class="term-flag">${this._esc(token)}</span>`;

      } else if (ArivuTerminalParser.MODE_KEYWORDS.has(tokenLower)) {
        // Mode keywords: replace, continue, all, sequence → green
        html += `<span class="term-mode">${this._esc(token)}</span>`;

      } else if (this.operators.has(tokenLower)) {
        // Operators: as, to, and, from, etc. → teal
        html += `<span class="term-operator">${this._esc(token)}</span>`;

      } else if (/^[()[\],]$/.test(token) || token.startsWith('(') || token.endsWith(')') || token.startsWith('[') || token.endsWith(']')) {
        // Brackets, parens, commas → white (but we need to handle mixed tokens like '("name",' )
        html += `<span class="term-bracket">${this._esc(token)}</span>`;

      } else if (token.startsWith('"') || token.startsWith("'")) {
        // Strings → sky blue
        html += `<span class="term-string-val">${this._esc(token)}</span>`;

      } else if (/^\d+(\.\d+)?$/.test(token)) {
        // Numbers → teal
        html += `<span class="term-data-val">${this._esc(token)}</span>`;

      } else {
        // Default: paper names, other text → white (inherit)
        html += this._esc(token);
      }

      pos = idx + token.length;
    }

    // Trailing text
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
