// "Inline" display mode: Section View takes the place of Ticketmaster's own
// ticket list inside its pane, so the filter chips above it stay usable.
//
// Ticketmaster only loads more tickets when its own list is scrolled to the end,
// so while tickets are loading that list has to stay in place and keep being
// scrolled (by the page reader). That gives two states:
//
//   LOADING ("cover"): our view is an absolutely positioned child of
//     `main#main-content`, covering Ticketmaster's list, which stays laid out
//     but invisible. The header above the list (upsell banner, results/sort/
//     chips, delivery note) lives in the same scroller, so it would scroll away
//     as the list is scrolled; each block is moved down by the scroller's
//     scrollTop (a transform, updated on every scroll event, which fires before
//     the next paint) to cancel that out. (`position: sticky` would be simpler
//     but only holds inside a containing block as tall as the content, which
//     isn't ours to guarantee.) The scroller is locked so the user can't scroll
//     it by hand; programmatic scrolling (the reader's) still works. The header
//     never moves or gets covered, so nothing jumps while loading.
//
//   LOADED ("flow"): nothing more needs loading, so our view moves into the
//     normal flow of the pane where Ticketmaster's list was (which is collapsed),
//     the header is released and the scroller unlocked. Header and list scroll
//     together as one page, as on Ticketmaster's own list, which also gives the
//     list the whole height of the pane. If the list reloads (quantity or sort
//     changed) we go back to LOADING.
//
//   While "Your Selection" is open (`#quickpicks-detail`): in LOADING we step
//   aside (a cover would sit on top of the dialog); in LOADED we stay put under
//   it, so the user's scroll position is still there on Back.
//
// A "By Section / Tickets" chip is added to Ticketmaster's own filter chips to
// switch between our view and Ticketmaster's own list (everything above is
// undone while Ticketmaster's list is showing). Without a chip row to put it in
// (an unfamiliar layout) a link in the view and a small tab take over.
//
// The element ids used here (#quickpicks, #quickpicks-list, #quickpicks-detail,
// #main-content) are Ticketmaster's; the hashed class names are not relied on.
import { h } from '../lib/dom.js';
import { VIEW_CSS } from './styles.js';
import { SCROLLER_ATTR, findHeaderBlocks } from './tm-page.js';
import { createViewSwitch, VIEW_SECTION, VIEW_TICKETS } from './view-switch.js';

const HOST_ID = 'tmsv-inline-host';
const FONT = 'Averta, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
// After acting on a change, ignore further changes for this long, then check once more.
const EVALUATE_COOLDOWN_MS = 150;
// How long Ticketmaster's pane may be missing before we say it isn't there
// (event pages render it a moment after load).
const UNAVAILABLE_GRACE_MS = 2500;

const INLINE_CSS = `
  :host { all: initial; }
  .frame { height: 100%; }
  :host([data-mode="tab"]) .frame { display: none; }
  :host([data-mode="view"]) .restore, :host([data-mode="flow"]) .restore { display: none; }
  .restore {
    all: unset; box-sizing: border-box; cursor: pointer; background: #026cdf; color: #fff;
    font: 700 12px ${FONT}; padding: 6px 12px; border-radius: 14px 0 0 14px;
    box-shadow: 0 2px 8px rgba(0,0,0,.25); white-space: nowrap;
  }
  .restore:hover { background: #0150a6; }
`;

function findScrollerAbove(el) {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

function isTransparent(color) {
  return !color || color === 'transparent' || /^rgba\(.*,\s*0\)$/.test(color);
}

/**
 * `onAvailability(bool)` is called when Ticketmaster's pane appears (true) or
 * has been missing for a while (false). Nothing happens until start().
 */
export function createInline(app, { onAvailability } = {}) {
  let watching = false;
  let enabled = true; // false while the pane is covering for us
  let viewOn = true; // our view (true) vs Ticketmaster's own list (false)
  let available = null;
  let settled = false; // everything loaded (or nothing to load): the view can move into the page's flow

  let host = null;
  let frame = null;
  let appRunning = false;

  let observer = null;
  let resizeObserver = null;
  let evaluateTimer = null;
  let evaluateDirty = false;
  let graceTimer = null;
  let unsubscribe = null;
  const viewSwitch = createViewSwitch({
    onChange(view) {
      viewOn = view === VIEW_SECTION;
      evaluate();
    },
  });

  let heldScroller = null; // the pane's scroller while we manage it
  let heldPrev = { overflowY: '', gutter: '' };
  let positionedMain = null;
  let positionedPrev = '';
  let hidden = null; // { wrapper, prop, prev }: how Ticketmaster's list is currently kept out of sight
  let phase = null; // 'cover' (loading) | 'flow' (loaded) | null (not mounted)
  let loadingForClick = false; // the page's list is being scrolled to bring a ticket's card in: keep it laid out (cover)
  let inMount = false; // a snapshot can arrive while we're mounting; handle it afterwards
  let remount = false;
  const pinned = new Map(); // header block -> the inline styles it had before we pinned it
  let pinScroller = null; // the scroller whose scrolling the pinned blocks cancel out
  let naturalTop = null; // where the list begins, relative to `main`, with the pane at the top

  // --- the host element ------------------------------------------------------

  function build() {
    const el = h('div', { id: HOST_ID });
    const root = el.attachShadow({ mode: 'open' });
    frame = h('div', { class: 'frame' });
    const restore = h('button', {
      type: 'button',
      class: 'restore',
      text: '◄ Section View',
      on: { click: function () { viewOn = true; evaluate(); } },
    });
    root.append(h('style', { text: VIEW_CSS + INLINE_CSS }), frame, restore);
    return el;
  }

  function setHostMode(mode, top) {
    host.dataset.mode = mode;
    if (mode === 'view') host.style.cssText = 'position:absolute;left:0;right:0;bottom:0;z-index:10;top:' + top + 'px;';
    else if (mode === 'flow') host.style.cssText = 'display:block;position:static;min-width:0;';
    else host.style.cssText = 'position:absolute;right:0;top:8px;z-index:10;';
  }

  // --- the app -----------------------------------------------------------------

  const nextFrame = function () {
    return new Promise(function (resolve) {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { resolve(); });
      else setTimeout(resolve, 0);
    });
  };

  /**
   * Selecting a ticket whose card the page hasn't loaded yet means scrolling the page's list, which only
   * loads while it is laid out. In the page's flow it's collapsed under our view, so for the duration we go
   * back to the covering state (list laid out but invisible, scroller locked), then return and put the
   * scroll position back.
   */
  const listLoad = {
    async before() {
      const { scroller } = find();
      listLoad.scrollTop = scroller ? scroller.scrollTop : null;
      loadingForClick = true;
      evaluate();
      await nextFrame();
    },
    async after() {
      loadingForClick = false;
      evaluate();
      const { scroller } = find();
      if (scroller && listLoad.scrollTop !== null && phase === 'flow') scroller.scrollTop = listLoad.scrollTop;
      listLoad.scrollTop = null;
    },
    scrollTop: null,
  };

  /**
   * `hasChip`: the chip is the way back to Ticketmaster's list; otherwise the view offers a link.
   * `flow`: the view is part of the page's scroll rather than scrolling inside itself.
   */
  function configureApp(hasChip, flow) {
    app.configure({
      scrollToClicked: false,
      compact: true,
      flow,
      followPageSort: true,
      listLoad,
      onShowOriginal: hasChip ? null : function () { viewOn = false; evaluate(); },
    });
  }

  function startApp() {
    if (appRunning) return;
    appRunning = true; // before start(): starting sends a snapshot, which can re-enter evaluate()
    if (app.root.parentNode !== frame) frame.append(app.root);
    app.start();
  }

  function stopApp() {
    if (!appRunning) return;
    appRunning = false;
    app.stop();
  }

  // --- Ticketmaster's DOM ------------------------------------------------------

  function find() {
    const root = document.getElementById('quickpicks');
    const list = document.getElementById('quickpicks-list');
    const detail = document.getElementById('quickpicks-detail');
    const scroller = heldScroller && heldScroller.isConnected ? heldScroller : root ? findScrollerAbove(root) : null;
    const main = document.getElementById('main-content') || (scroller && scroller.parentElement) || null;
    const toolbar = root ? root.querySelector('[role="toolbar"]') : null;
    return { root, list, detail, scroller, main, toolbar };
  }

  function ensurePositioned(main) {
    if (positionedMain === main) return;
    restorePositioned();
    if (window.getComputedStyle(main).position === 'static') {
      positionedPrev = main.style.position;
      main.style.position = 'relative';
      positionedMain = main;
    }
  }

  function restorePositioned() {
    if (!positionedMain) return;
    positionedMain.style.position = positionedPrev;
    positionedMain = null;
  }

  /**
   * Take charge of the pane's scroller. Its scrollbar's space is reserved
   * (`scrollbar-gutter: stable`) for as long as we hold it: the scrollbar coming
   * or going changes the width of Ticketmaster's content, which can re-wrap its
   * text and shift everything below it by a line, in the middle of a hand-over.
   * `locked`: also stop the user scrolling it by hand (the reader's programmatic
   * scrolling still works).
   */
  function holdScroller(scroller, locked) {
    if (!scroller) return;
    if (heldScroller !== scroller) {
      releaseScroller();
      heldPrev = {
        overflowY: scroller.style.getPropertyValue('overflow-y'),
        gutter: scroller.style.getPropertyValue('scrollbar-gutter'),
      };
      heldScroller = scroller;
      scroller.style.setProperty('scrollbar-gutter', 'stable');
      // Locked, it no longer looks like a scroller (overflow: hidden): this is how the page reader still knows it is the list's.
      scroller.setAttribute(SCROLLER_ATTR, '');
    }
    if (locked) heldScroller.style.setProperty('overflow-y', 'hidden');
    else if (heldPrev.overflowY) heldScroller.style.setProperty('overflow-y', heldPrev.overflowY);
    else heldScroller.style.removeProperty('overflow-y');
  }

  function releaseScroller() {
    if (!heldScroller) return;
    heldScroller.removeAttribute(SCROLLER_ATTR);
    ['overflow-y', 'scrollbar-gutter'].forEach(function (prop) {
      const prev = prop === 'overflow-y' ? heldPrev.overflowY : heldPrev.gutter;
      if (prev) heldScroller.style.setProperty(prop, prev);
      else heldScroller.style.removeProperty(prop);
    });
    heldScroller = null;
  }

  /**
   * Keep Ticketmaster's list out of sight. 'invisible' keeps it laid out (it must
   * keep loading while we cover it); 'collapsed' takes it out of the layout (all
   * loaded: our view takes its place in the flow).
   */
  function hideList(list, how) {
    const wrapper = list.parentElement || list;
    const prop = how === 'collapsed' ? 'display' : 'visibility';
    if (hidden && hidden.wrapper === wrapper && hidden.prop === prop) return;
    showList();
    hidden = { wrapper, prop, prev: wrapper.style.getPropertyValue(prop) };
    wrapper.style.setProperty(prop, how === 'collapsed' ? 'none' : 'hidden');
  }

  function showList() {
    if (!hidden) return;
    if (hidden.prev) hidden.wrapper.style.setProperty(hidden.prop, hidden.prev);
    else hidden.wrapper.style.removeProperty(hidden.prop);
    hidden = null;
  }

  const PIN_PROPS = ['position', 'z-index', 'background-color', 'transform', 'will-change'];

  /** Move each pinned block down by the scroll distance, so it stays where it was on screen. */
  function followScroll() {
    if (!pinScroller) return;
    const y = pinScroller.scrollTop;
    pinned.forEach(function (prev, el) {
      if (y) el.style.setProperty('transform', 'translateY(' + y + 'px)');
      else el.style.removeProperty('transform');
    });
  }

  function unpin() {
    if (pinScroller) pinScroller.removeEventListener('scroll', followScroll);
    pinScroller = null;
    pinned.forEach(function (prev, el) {
      PIN_PROPS.forEach(function (prop) {
        if (prev[prop]) el.style.setProperty(prop, prev[prop]);
        else el.style.removeProperty(prop);
      });
    });
    pinned.clear();
    naturalTop = null;
  }

  /** Pin each header block where it is now (the pane must be scrolled to the top). */
  function pin(blocks, scroller, main, list) {
    unpin();
    blocks.forEach(function (el) {
      if (el.getBoundingClientRect().height === 0) return;
      const prev = {};
      PIN_PROPS.forEach(function (prop) { prev[prop] = el.style.getPropertyValue(prop); });
      pinned.set(el, prev);
      el.style.setProperty('position', 'relative'); // so z-index applies
      el.style.setProperty('z-index', '3');
      el.style.setProperty('will-change', 'transform');
      // The list scrolls underneath; a transparent block would let it show through.
      if (isTransparent(window.getComputedStyle(el).backgroundColor)) el.style.setProperty('background-color', '#fff');
    });

    if (pinned.size === 0) return;
    pinScroller = scroller;
    scroller.addEventListener('scroll', followScroll, { passive: true });
    followScroll();
    const wrapper = list.parentElement || list;
    naturalTop = Math.round(wrapper.getBoundingClientRect().top - main.getBoundingClientRect().top);
  }

  /** Without a pinned header (unknown layout) fall back to covering the whole pane while loading. */
  function fallbackTop(list, scroller, main) {
    if (!settled) return 0;
    if (scroller && scroller.scrollTop !== 0) scroller.scrollTop = 0;
    const wrapper = list.parentElement || list;
    const top = wrapper.getBoundingClientRect().top - main.getBoundingClientRect().top + (scroller ? scroller.scrollTop : 0);
    return Math.max(0, Math.round(top));
  }

  // --- show / hide ---------------------------------------------------------------

  function attachHost(main) {
    if (!host) host = build();
    if (host.parentElement !== main) {
      ensurePositioned(main);
      main.append(host);
    }
  }

  /** LOADING: cover Ticketmaster's list, hold its header in place, lock its scroller. */
  function mountCover(main, list, scroller, hasChip) {
    attachHost(main);
    configureApp(hasChip, false);
    startApp();

    if (scroller) {
      // Take charge of the scroller first, then measure (see holdScroller).
      holdScroller(scroller, true);
      const stale = Array.from(pinned.keys()).some(function (el) { return !el.isConnected; });
      const atTop = scroller.scrollTop === 0;
      // (Re)measure only when the pane is at rest at the top; mid-load the pins just hold.
      if (stale || pinned.size === 0 || atTop) {
        if (!atTop) scroller.scrollTop = 0;
        pin(findHeaderBlocks(list), scroller, main, list);
      }
    }
    hideList(list, 'invisible');
    setHostMode('view', naturalTop !== null ? naturalTop : fallbackTop(list, scroller, main));
    phase = 'cover';
  }

  /** LOADED: our view takes Ticketmaster's list's place in the pane's normal flow. */
  function mountFlow(list, scroller, hasChip) {
    const wrapper = list.parentElement || list;
    const container = wrapper.parentElement;
    if (!container) return mountCover(document.getElementById('main-content'), list, scroller, hasChip);

    if (!host) host = build();
    const entering = phase !== 'flow';

    configureApp(hasChip, true);
    unpin(); // the header scrolls with the list again...
    holdScroller(scroller, false); // ...and the scroller is the user's
    hideList(list, 'collapsed');
    if (host.parentElement !== container || host.nextElementSibling !== wrapper) container.insertBefore(host, wrapper);
    restorePositioned();
    setHostMode('flow');
    startApp();
    if (entering && scroller) scroller.scrollTop = 0;
    phase = 'flow';
  }

  function mount(main, list, scroller, toolbar) {
    inMount = true;
    try {
      // First, so the header is measured with the chip in it (it may add a line).
      const hasChip = viewSwitch.mount(toolbar, viewOn ? VIEW_SECTION : VIEW_TICKETS);

      if (!viewOn) {
        // Ticketmaster's own list: undo everything we did to it.
        stopApp();
        unpin();
        showList();
        releaseScroller();
        phase = null;
        if (hasChip) {
          if (host) host.remove();
          restorePositioned();
        } else {
          attachHost(main);
          setHostMode('tab');
        }
        return;
      }

      if (settled && !loadingForClick) mountFlow(list, scroller, hasChip);
      else mountCover(main, list, scroller, hasChip);
    } finally {
      inMount = false;
    }
    // Starting the app reports the page's state at once; if that changed which
    // state we should be in, deal with it now that we're done mounting.
    if (remount) {
      remount = false;
      evaluate();
    }
  }

  function unmount() {
    viewSwitch.unmount();
    stopApp();
    unpin();
    showList();
    releaseScroller();
    phase = null;
    if (host) host.remove();
    restorePositioned();
  }

  // --- deciding what to do ---------------------------------------------------------

  function setAvailable(isAvailable) {
    if (isAvailable) {
      clearTimeout(graceTimer);
      graceTimer = null;
      if (available !== true) {
        available = true;
        if (onAvailability) onAvailability(true);
      }
    } else if (available !== false && !graceTimer) {
      graceTimer = setTimeout(function () {
        graceTimer = null;
        if (available !== false) {
          available = false;
          if (onAvailability) onAvailability(false);
        }
      }, UNAVAILABLE_GRACE_MS);
    }
  }

  /** Make the page match the current state. Idempotent, cheap to repeat. */
  function evaluate() {
    if (!watching) return;

    const { root, list, detail, scroller, main, toolbar } = find();
    setAvailable(!!(root || detail));

    if (!enabled || !list || !main) {
      unmount();
      return;
    }
    if (detail) {
      // "Your Selection" is open. A cover would sit on top of its dialog, so step
      // aside; but our view in the page's flow is under the dialog, so leave it
      // exactly as it is and the scroll position is still there on Back.
      if (phase !== 'flow') unmount();
      return;
    }
    mount(main, list, scroller, toolbar);
  }

  /**
   * Act on the first change straight away (waiting would let Ticketmaster's own
   * list show for a moment), then check once more after the dust has settled.
   */
  function scheduleEvaluate() {
    if (evaluateTimer) {
      evaluateDirty = true;
      return;
    }
    evaluate();
    evaluateTimer = setTimeout(function () {
      evaluateTimer = null;
      if (evaluateDirty) {
        evaluateDirty = false;
        evaluate();
      }
    }, EVALUATE_COOLDOWN_MS);
  }

  function onSnapshot(snapshot) {
    const s = snapshot.status;
    const nowSettled = s.isComplete || (s.loaded === 0 && s.total === 0);
    if (nowSettled === settled) return;
    settled = nowSettled;
    if (inMount) remount = true;
    else evaluate();
  }

  // --- public ----------------------------------------------------------------------

  return {
    /** Begin watching the page and showing the view where Ticketmaster's list is. */
    start() {
      if (watching) return;
      watching = true;
      unsubscribe = app.subscribe(onSnapshot);
      observer = new MutationObserver(scheduleEvaluate);
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(scheduleEvaluate);
        resizeObserver.observe(document.documentElement);
      }
      evaluate();
    },

    stop() {
      if (!watching) return;
      watching = false;
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      if (observer) observer.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      observer = resizeObserver = null;
      clearTimeout(evaluateTimer);
      clearTimeout(graceTimer);
      evaluateTimer = graceTimer = null;
      evaluateDirty = false;
      unmount();
      available = null;
      settled = false;
      remount = false;
    },

    /** Allow or forbid showing the view (forbidden while the pane stands in for us). */
    setEnabled(next) {
      enabled = next;
      evaluate();
    },

    /** Switch between our view and Ticketmaster's own list. */
    toggle() {
      viewOn = !viewOn;
      evaluate();
    },

    destroy() {
      this.stop();
    },
  };
}
