// "Pane on the page" display mode: Section View in a resizable pane docked to
// the left or right edge of the Ticketmaster page. It floats over the page (the
// page is never narrowed). The pane lives in a shadow root, so Ticketmaster's
// CSS can't touch it. Showing the pane starts the app (page reader); hiding it
// stops it.
import { LOG_PREFIX } from '../lib/constants.js';
import { h } from '../lib/dom.js';
import { clampPaneWidth, saveSettings } from '../lib/settings.js';
import { VIEW_CSS } from './styles.js';

const HOST_ID = 'tmsv-pane-host';
const BLUE = '#026cdf';
const BLUE_DARK = '#0150a6';
const FONT = 'Averta, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const Z = 2147483647;

// --pw is the pane width, capped so a sliver of the page always stays visible.
const PANE_CSS = `
  :host { all: initial; }
  .wrap { --pw: min(var(--w, 380px), calc(100vw - 48px)); }
  .tab {
    all: unset; box-sizing: border-box; position: fixed; top: 120px; z-index: ${Z - 1}; cursor: pointer;
    background: ${BLUE}; color: #fff; padding: 8px 14px; font: 700 12px ${FONT}; white-space: nowrap;
    box-shadow: 0 3px 10px rgba(0,0,0,.2); transition: background-color .2s;
  }
  .tab:hover { background: ${BLUE_DARK}; }
  .tab:focus-visible { outline: 2px solid #fff; outline-offset: -4px; }
  .wrap[data-side="right"] .tab { right: 0; border-radius: 16px 0 0 16px; }
  .wrap[data-side="left"] .tab { left: 0; border-radius: 0 16px 16px 0; }
  .wrap[data-open="true"][data-side="right"] .tab { right: var(--pw); }
  .wrap[data-open="true"][data-side="left"] .tab { left: var(--pw); }

  .pane {
    display: none; position: fixed; top: 0; bottom: 0; width: var(--pw); z-index: ${Z};
    box-sizing: border-box; background: #fff; box-shadow: 0 0 20px rgba(0,0,0,.18);
  }
  .wrap[data-open="true"] .pane { display: block; }
  .wrap[data-side="right"] .pane { right: 0; border-left: 1px solid #e0e0e0; }
  .wrap[data-side="left"] .pane { left: 0; border-right: 1px solid #e0e0e0; }

  .wrap.dragging { cursor: col-resize; user-select: none; }
  .handle { position: absolute; top: 0; bottom: 0; width: 10px; cursor: col-resize; z-index: 1; touch-action: none; }
  .handle:hover, .wrap.dragging .handle { background: rgba(2, 108, 223, .25); }
  .wrap[data-side="right"] .handle { left: -5px; }
  .wrap[data-side="left"] .handle { right: -5px; }
`;

/**
 * Create the pane for `app`. `settings` supplies paneSide / paneWidth / paneOpen.
 * `active: false` creates it dormant (nothing on the page) until activate().
 * Returns { update(settings), toggle(), activate(), deactivate(), destroy() }.
 */
export function createPane(app, settings, { active = true } = {}) {
  let isActive = active;
  let current = settings;
  let open = settings.paneOpen;
  let liveWidth = settings.paneWidth; // differs from `current` only mid-drag
  let dragging = false;
  let dragOffset = 0; // how far from the pane's edge the pointer grabbed the handle
  let ui = null;

  function build() {
    const host = h('div', { id: HOST_ID });
    const root = host.attachShadow({ mode: 'open' });

    const tab = h('button', { type: 'button', class: 'tab', on: { click: toggle } });
    const handle = h('div', {
      class: 'handle',
      role: 'separator',
      'aria-orientation': 'vertical',
      on: { pointerdown: onDragStart, pointermove: onDragMove, pointerup: onDragEnd, pointercancel: onDragEnd },
    });
    const pane = h('div', { class: 'pane' }, handle, app.root);
    const wrap = h('div', { class: 'wrap' }, tab, pane);

    root.append(h('style', { text: VIEW_CSS + PANE_CSS }), wrap);
    document.documentElement.append(host);
    return { host, wrap, tab };
  }

  function tabLabel() {
    const towardsPage = current.paneSide === 'right' ? '►' : '◄';
    const awayFromPage = current.paneSide === 'right' ? '◄' : '►';
    return open ? towardsPage + ' Hide' : awayFromPage + ' Section View';
  }

  /** Make the DOM and the app match the current settings and open state. Idempotent. */
  function apply() {
    if (!isActive) return;
    if (!ui || !ui.host.isConnected) ui = build();

    ui.wrap.dataset.side = current.paneSide;
    ui.wrap.dataset.open = String(open);
    ui.wrap.style.setProperty('--w', liveWidth + 'px');
    ui.tab.textContent = tabLabel();
    ui.tab.setAttribute('aria-expanded', String(open));

    app.configure({ scrollToClicked: true, compact: false, flow: false, onShowOriginal: null, followPageSort: false, listLoad: null });
    if (open) app.start();
    else app.stop();
  }

  function toggle() {
    if (!isActive) return;
    open = !open;
    saveSettings({ paneOpen: open });
    apply();
  }

  // --- resizing --------------------------------------------------------------

  function edgeX(width) {
    return current.paneSide === 'right' ? window.innerWidth - width : width;
  }

  function widthAt(clientX) {
    const x = clientX - dragOffset;
    return clampPaneWidth(current.paneSide === 'right' ? window.innerWidth - x : x);
  }

  function onDragStart(e) {
    dragging = true;
    dragOffset = e.clientX - edgeX(liveWidth);
    ui.wrap.classList.add('dragging');
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ }
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!dragging) return;
    liveWidth = widthAt(e.clientX);
    apply();
  }

  function onDragEnd() {
    if (!dragging) return;
    dragging = false;
    if (ui) ui.wrap.classList.remove('dragging');
    current = Object.assign({}, current, { paneWidth: liveWidth });
    saveSettings({ paneWidth: liveWidth });
  }

  apply();

  return {
    /** Settings changed elsewhere (options page, another tab). The open state is per-tab and left alone. */
    update(next) {
      current = next;
      if (!dragging) liveWidth = next.paneWidth;
      apply();
    },
    toggle,

    /** Put the pane on the page (e.g. when inline mode has nowhere to go). */
    activate() {
      if (isActive) return;
      isActive = true;
      apply();
    },

    /** Take the pane off the page and stop the app. */
    deactivate() {
      if (!isActive) return;
      isActive = false;
      app.stop();
      if (ui) ui.host.remove();
      ui = null;
    },

    destroy() {
      isActive = false;
      app.stop();
      if (ui) ui.host.remove();
      ui = null;
    },
  };
}
