// Stylesheet for the Section View UI. It lives in a JS string (not a .css file)
// because it's injected into a shadow root in the Ticketmaster page, and a
// <style> element can't be blocked by the page's Content-Security-Policy the
// way an external stylesheet request might be.
//
// Sizes are scaled: `u(n)` is n px times the list scale (--sv-scale) and `uh(n)`
// n px times the header scale (--sv-header-scale), both set by the view from
// the "text size" setting (see lib/size.js). Borders and shadows stay in plain px.
const u = (n) => `calc(var(--u) * ${n})`;
const uh = (n) => `calc(var(--uh) * ${n})`;

export const VIEW_CSS = `
.sv {
  --blue: #026cdf;
  --blue-dark: #0150a6;
  --border: #e0e0e0;
  --text: #111111;
  --muted: #666666;
  --u: calc(1px * var(--sv-scale, 1));
  --uh: calc(1px * var(--sv-header-scale, 1));
  display: flex;
  flex-direction: column;
  height: 100%;
  font: ${u(14)}/normal Averta, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--text);
  background: #f8f9fa;
}
.sv [hidden] { display: none !important; }
.sv button { font-family: inherit; }

/* ---- header ---- */
.sv-header {
  flex: none;
  background: var(--blue);
  color: #ffffff;
  padding: ${uh(14)};
  display: flex;
  flex-direction: column;
  gap: ${uh(10)};
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  font-size: ${uh(14)};
}
.title-row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: ${uh(4)} ${uh(8)}; }
.title { display: flex; align-items: center; gap: ${uh(6)}; flex: none; }
.title-text { font-size: ${uh(15)}; font-weight: 700; letter-spacing: -0.2px; white-space: nowrap; }
.version { background: rgba(255, 255, 255, 0.25); padding: ${uh(1)} ${uh(6)}; border-radius: ${uh(8)}; font-size: ${uh(10)}; font-weight: 700; }
.title-actions { display: flex; align-items: center; gap: ${uh(6)}; margin-left: auto; }
.icon-btn {
  background: transparent; color: #ffffff; border: none; border-radius: ${uh(4)};
  font-size: ${uh(16)}; line-height: 1; padding: ${uh(3)} ${uh(5)}; cursor: pointer; opacity: 0.85;
}
.icon-btn:hover { opacity: 1; background: rgba(255, 255, 255, 0.18); }
.counter { font-size: ${uh(11)}; color: rgba(255, 255, 255, 0.85); margin-top: ${uh(1)}; }
.auto-zoom { display: inline-flex; align-items: center; gap: ${uh(4)}; margin-top: ${uh(3)}; font-size: ${uh(11)}; color: rgba(255, 255, 255, 0.9); cursor: pointer; user-select: none; }
.auto-zoom[hidden] { display: none; }
.auto-zoom-box { margin: 0; accent-color: #ffb300; cursor: pointer; }
.show-on-map { display: none; flex: none; background: #ffffff; color: var(--blue); border: 1px solid var(--border); border-radius: ${u(10)}; padding: ${u(2)} ${u(8)}; font-size: ${u(10)}; font-weight: 700; cursor: pointer; white-space: nowrap; }
.show-on-map:hover { background: #eef4ff; border-color: var(--blue); }
.sv.map-buttons .show-on-map { display: inline-block; }
.ticket > .show-on-map { grid-column: 2; grid-row: 2; justify-self: end; align-self: end; }
.map-note { font-size: ${uh(10)}; color: rgba(255, 255, 255, 0.75); margin-top: ${uh(1)}; font-style: italic; }
.status {
  background: rgba(255, 255, 255, 0.22); padding: ${uh(3)} ${uh(8)}; border-radius: ${uh(10)};
  font-size: ${uh(10)}; font-weight: 700; white-space: nowrap;
}
.status[data-state="loading"] { background: #e65100; }
.status[data-state="done"] { background: #2e7d32; }

.controls { display: flex; flex-direction: column; gap: ${uh(8)}; }
.search {
  width: 100%; box-sizing: border-box; padding: ${uh(6)} ${uh(10)}; border-radius: ${uh(4)};
  border: 1px solid rgba(255, 255, 255, 0.3); background: #ffffff; color: var(--text);
  font-size: ${uh(12)}; font-family: inherit; outline: none;
}
.pills { display: flex; gap: ${uh(4)}; flex-wrap: wrap; }
.pill {
  font-size: ${uh(10)}; padding: ${uh(3)} ${uh(8)}; border-radius: ${uh(10)}; cursor: pointer; transition: all 0.15s;
  border: 1px solid rgba(255, 255, 255, 0.3); background: rgba(255, 255, 255, 0.15); color: #ffffff; font-weight: 400;
}
.pill[aria-pressed="true"], .pill[aria-checked="true"] { background: #ffffff; border-color: #ffffff; color: var(--blue); font-weight: 700; }
.pill.zero:not([aria-pressed="true"]):not([aria-checked="true"]):not([data-state="hide"]) { opacity: 0.55; }
/* an "Other" pill that is hiding its tickets */
.pill[data-state="hide"] { background: #c5221f; border-color: #ffb4ae; color: #ffffff; text-decoration: line-through; }
/* a choice of one, as a single pill split into segments */
.segmented {
  flex: 0 0 auto; max-width: 100%; flex-wrap: nowrap; gap: 0; overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.35); border-radius: ${uh(12)}; background: rgba(255, 255, 255, 0.12);
}
/* normally each segment is as wide as its text; if they can't all fit (large text), the words wrap inside the segments */
.segmented .pill { flex: 0 1 auto; min-width: 0; border: none; border-radius: 0; background: transparent; padding: ${uh(3)} ${uh(5)}; text-align: center; line-height: 1.2; }
.segmented .pill + .pill { border-left: 1px solid rgba(255, 255, 255, 0.3); }
.segmented .pill:hover { background: rgba(255, 255, 255, 0.18); }
.segmented .pill[aria-checked="true"] { background: #ffffff; color: var(--blue); }
.filters { display: flex; flex-direction: column; gap: ${uh(5)}; }
/* the label sits beside its pills, or above them when a split pill is too wide to share the line */
.pill-group { display: flex; flex-wrap: wrap; gap: ${uh(3)} ${uh(6)}; align-items: flex-start; }
.pill-group[data-group="other"] .pills { flex: 1 1 0; min-width: 0; }
.pill-label { flex: none; width: ${uh(34)}; padding-top: ${uh(4)}; font-size: ${uh(10)}; font-weight: 700; opacity: 0.85; }

.control-box {
  display: flex; flex-direction: column; gap: ${uh(6)}; background: rgba(255, 255, 255, 0.14);
  padding: ${uh(8)} ${uh(10)}; border-radius: ${uh(6)}; font-size: ${uh(11)};
}
.control-row { display: flex; gap: ${uh(6)}; align-items: center; flex-wrap: wrap; }
.control-label { font-weight: 500; }
.chip {
  padding: ${uh(3)} ${uh(10)}; border-radius: ${uh(12)}; cursor: pointer; font-size: ${uh(11)};
  background: transparent; color: #ffffff; border: 1px solid #ffffff; font-weight: 500;
}
.chip[aria-pressed="true"] { background: #ffffff; color: var(--blue); border-color: #ffffff; font-weight: 700; }

.stepper {
  display: flex; align-items: center; justify-content: space-between; background: #ffffff;
  border-radius: ${uh(12)}; padding: ${uh(1)} ${uh(3)}; min-width: ${uh(76)};
}
.stepper button {
  width: ${uh(22)}; height: ${uh(22)}; padding: 0; background: var(--blue); color: #ffffff; border: none;
  border-radius: 50%; font-weight: 700; font-size: ${uh(13)}; cursor: pointer;
  display: flex; align-items: center; justify-content: center; line-height: 1;
}
.stepper button:disabled { opacity: 0.35; cursor: not-allowed; }
.qty-value { color: var(--blue); font-weight: 700; font-size: ${uh(12)}; min-width: ${uh(16)}; text-align: center; }

/* ---- venue settings ---- */
.venue-panel {
  display: flex; flex-direction: column; gap: ${uh(6)}; background: rgba(255, 255, 255, 0.14);
  padding: ${uh(8)} ${uh(10)}; border-radius: ${uh(6)}; font-size: ${uh(11)};
}
.venue-name { font-weight: 700; font-size: ${uh(12)}; }
.venue-field { display: flex; flex-direction: column; gap: ${uh(2)}; }
.venue-label { font-weight: 500; }
.venue-input {
  width: 100%; box-sizing: border-box; padding: ${uh(5)} ${uh(8)}; border-radius: ${uh(4)};
  border: 1px solid rgba(255, 255, 255, 0.3); background: #ffffff; color: var(--text);
  font-size: ${uh(12)}; font-family: inherit; outline: none;
}
.venue-hint { color: rgba(255, 255, 255, 0.8); font-size: ${uh(10)}; }
.venue-message { color: #ffd2cc; font-weight: 700; min-height: 0; }
.venue-message:empty { display: none; }
.venue-save { background: #ffffff; color: var(--blue); border-color: #ffffff; font-weight: 700; }

/* custom badge editor (inside the venue panel) */
.be { display: flex; flex-direction: column; gap: ${uh(6)}; }
.be-list { display: flex; flex-direction: column; gap: ${uh(6)}; }
.be-row { display: flex; flex-direction: column; gap: ${uh(3)}; padding-bottom: ${uh(6)}; border-bottom: 1px solid rgba(255, 255, 255, 0.2); }
.be-line { display: flex; gap: ${uh(4)}; align-items: center; }
.be-icon, .be-label, .be-pattern, .be-color {
  box-sizing: border-box; padding: ${uh(4)} ${uh(6)}; border-radius: ${uh(4)}; border: 1px solid rgba(255, 255, 255, 0.3);
  background: #ffffff; color: var(--text); font-size: ${uh(12)}; font-family: inherit; outline: none; min-width: 0;
}
.be-icon { width: ${uh(34)}; text-align: center; flex: none; }
.be-label { flex: 1; }
.be-color { flex: none; }
.be-pattern { width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.be [aria-invalid="true"] { border-color: #ffd2cc; box-shadow: 0 0 0 2px #c5221f; }
.be-remove, .be-add {
  font-family: inherit; font-size: ${uh(11)}; cursor: pointer; border-radius: ${uh(10)};
  background: transparent; color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.5); padding: ${uh(2)} ${uh(8)};
}
.be-remove { flex: none; padding: ${uh(2)} ${uh(6)}; }
.be-add { align-self: flex-start; }
.be-add:disabled { opacity: 0.5; cursor: default; }
.be-error { color: #ffd2cc; font-weight: 700; font-size: ${uh(10)}; }
.be-error:empty { display: none; }
.be-warn { color: #ffe9a8; font-size: ${uh(10)}; }
.be-count { color: rgba(255, 255, 255, 0.85); font-size: ${uh(10)}; }
.be-sample { color: rgba(255, 255, 255, 0.85); font-size: ${uh(10)}; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.be-warn:empty, .be-count:empty { display: none; }

/* ---- inline (compact) layout ---- */
.sv.compact .sv-header { padding: ${uh(10)} ${uh(12)}; gap: ${uh(8)}; }
.sv.compact .qty-row { display: none; }
.link-btn {
  background: none; border: none; padding: 0; color: #ffffff; font-size: ${uh(11)};
  text-decoration: underline; cursor: pointer; opacity: 0.9;
}
.link-btn:hover { opacity: 1; }

/* ---- in the page's flow: the page scrolls, not us ---- */
.sv.flow { height: auto; }
.sv.flow .sv-content { flex: none; min-height: auto; overflow: visible; }

/* ---- section list ---- */
.sv-content {
  flex: 1; min-height: 0; overflow-y: auto; padding: ${u(12)};
  display: flex; flex-direction: column; gap: ${u(8)};
}
.message { color: var(--muted); font-size: ${u(12)}; text-align: center; padding: ${u(16)} 0; }
.section {
  flex: none; border: 1px solid var(--border); border-radius: ${u(6)}; background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.section > summary {
  list-style: none; padding: ${u(10)} ${u(12)}; font-weight: 700; font-size: ${u(13)}; cursor: pointer; user-select: none;
  display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: ${u(2)} ${u(6)};
  border-radius: ${u(6)}; transition: background-color 0.15s;
}
.section > summary::-webkit-details-marker { display: none; }
.section.map-hover { border-color: #ffb300; box-shadow: 0 0 0 2px #ffb300; }
.section > summary:hover { background: #f1f5f9; }
.section-name { display: flex; align-items: center; min-width: 0; }
.section-name::before {
  content: ""; flex: none; width: ${u(6)}; height: ${u(6)}; margin: 0 ${u(12)} 0 ${u(3)};
  border: solid #555555; border-width: 0 2.5px 2.5px 0; transform: rotate(-45deg);
  transition: transform 0.2s ease-in-out;
}
.section[open] > summary .section-name::before { transform: rotate(45deg); margin-top: ${u(-3)}; }
.count { font-weight: 400; color: var(--muted); font-size: ${u(11)}; margin-left: ${u(4)}; }
.best { font-size: ${u(11)}; color: var(--blue); font-weight: 700; }
.tickets {
  display: flex; flex-direction: column; gap: ${u(6)}; padding: 0 ${u(10)} ${u(10)};
  border-top: 1px solid #f0f0f0; margin-top: ${u(2)};
}
.ticket {
  padding: ${u(8)} ${u(10)}; background: #ffffff; border: 1px solid var(--border); border-radius: ${u(5)}; cursor: pointer;
  font-size: ${u(11)};
  transition: all 0.15s ease-in-out;
}
.ticket:hover { background: #f0f7ff; border-color: var(--blue); }
/* the seats and the price share the first line; the badges have the whole width below them */
.ticket { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: ${u(8)}; row-gap: ${u(4)}; align-items: start; }
.ticket-main { display: contents; }
.ticket-seat-line, .ticket-badge-line.alone { grid-column: 1; grid-row: 1; }
.ticket-badge-line { grid-column: 1 / -1; grid-row: 2; }
.visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
/* the rows of a section */
.row-group + .row-group { margin-top: ${u(6)}; }
.row-head { display: flex; flex-wrap: wrap; align-items: center; gap: ${u(2)} ${u(6)}; padding: ${u(4)} ${u(2)} ${u(4)}; }
.row-title { font-size: ${u(12)}; font-weight: 700; }
.row-place { font-size: ${u(11)}; color: var(--muted); font-weight: 500; }
.row-tickets { display: flex; flex-direction: column; gap: ${u(4)}; margin-left: ${u(2)}; padding-left: ${u(6)}; border-left: 2px solid #e3e8ef; }
.ticket-line { display: flex; flex-wrap: wrap; align-items: center; gap: ${u(2)} ${u(6)}; min-width: 0; }
.ticket-title { font-size: ${u(12)}; font-weight: 700; }
.ticket-section { font-size: ${u(10)}; color: var(--muted); }
.ticket-type { font-size: ${u(10)}; color: var(--muted); font-weight: 700; }
.ticket-seats { font-size: ${u(11)}; color: var(--muted); font-weight: 700; }
.ticket-seat-count { font-size: ${u(10)}; color: var(--muted); }
.badges { display: inline-flex; gap: ${u(3)}; flex-wrap: wrap; align-items: center; }
/* on a ticket's lines each badge flows by itself, filling the line before wrapping to the next */
.ticket-line > .badges { display: contents; }
.badge { font-size: ${u(9)}; padding: ${u(2)} ${u(5)}; border-radius: ${u(8)}; font-weight: 700; cursor: help; }
/* the price badges: just their emoji, the name on hover */
.badge.icon { font-size: ${u(11)}; padding: ${u(1)} ${u(4)}; line-height: 1.3; }
.ticket-side { grid-column: 2; grid-row: 1; display: flex; align-items: center; gap: ${u(6)}; }
.price-badges { flex-wrap: nowrap; }
.ticket-price { color: var(--blue); font-weight: 700; font-size: ${u(12)}; white-space: nowrap; }
`;
