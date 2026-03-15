/**
 * static/js/export-panel.js
 *
 * ExportPanel: manages the export UI in the tool page right panel.
 * Adds an "Export" section below the DNA profile panel.
 *
 * Dependencies: none (vanilla JS)
 */

class ExportPanel {
  constructor(containerId) {
    this.container      = document.getElementById(containerId);
    this._activeDownload = null;
  }

  render() {
    if (!this.container) return;

    const exports = [
      { type: "graph-json",        label: "Graph JSON",          icon: "{ }",  desc: "Full graph data for external analysis" },
      { type: "graph-csv",         label: "Graph CSV (ZIP)",      icon: "\u2B1B",   desc: "Nodes and edges as spreadsheets" },
      { type: "bibtex",            label: "BibTeX Citations",     icon: "\uD83D\uDCC4",   desc: "All papers as .bib file" },
      { type: "literature-review", label: "Literature Review",    icon: "\uD83D\uDCDD",   desc: "Structured Markdown review" },
      { type: "genealogy-pdf",     label: "Genealogy PDF",        icon: "\uD83D\uDCDC",   desc: "Intellectual story as PDF" },
      { type: "graph-png",         label: "Graph PNG",            icon: "\uD83D\uDDBC",   desc: "Static image at 150dpi" },
      { type: "graph-svg",         label: "Graph SVG",            icon: "\uD83D\uDD37",   desc: "Vector graphic for publications" },
      { type: "action-log",        label: "Action Log",           icon: "\uD83D\uDCCB",   desc: "Your session activity history" },
    ];

    this.container.innerHTML = `
      <div class="export-panel" role="region" aria-label="Export options">
        <h3 class="panel-section-title">Export</h3>
        <div class="export-grid" id="export-grid">
          ${exports.map(e => `
            <button
              class="export-btn"
              data-type="${e.type}"
              title="${e.desc}"
              aria-label="Export as ${e.label}"
            >
              <span class="export-icon" aria-hidden="true">${e.icon}</span>
              <span class="export-label">${e.label}</span>
            </button>
          `).join("")}
        </div>
        <div id="export-status" class="export-status" aria-live="polite" hidden></div>
      </div>
    `;

    this.container.querySelectorAll(".export-btn").forEach(btn => {
      btn.addEventListener("click", () => this._handleExport(btn.dataset.type, btn));
    });
  }

  async _handleExport(exportType, btn) {
    if (this._activeDownload) return;

    this._activeDownload = exportType;
    const status   = document.getElementById("export-status");
    const original = btn.innerHTML;

    btn.disabled  = true;
    btn.innerHTML = `<span class="export-spin" aria-hidden="true">\u27F3</span> <span class="export-label">Generating\u2026</span>`;
    if (status) { status.hidden = false; status.textContent = `Generating ${exportType}\u2026`; }

    try {
      const resp = await fetch(`/api/export/${exportType}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ extra: {} }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${resp.status}`);
      }

      const { url, filename } = await resp.json();
      const a = document.createElement("a");
      a.href     = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      if (status) { status.textContent = `\u2713 ${filename} downloading\u2026`; }
      setTimeout(() => { if (status) { status.hidden = true; } }, 4000);

    } catch (err) {
      console.error("Export failed:", err);
      if (status) {
        status.textContent = `\u2717 Export failed: ${err.message}`;
        status.style.color = "var(--danger)";
        setTimeout(() => { status.hidden = true; status.style.color = ""; }, 6000);
      }
    } finally {
      btn.disabled  = false;
      btn.innerHTML = original;
      this._activeDownload = null;
    }
  }
}
