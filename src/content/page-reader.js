// Reads Ticketmaster's ticket list and acts on it. Every ticket comes from the list
// API (api-source.js) when it can: much faster than scrolling, and it carries seat
// numbers, quality and attributes. Those tickets are only trusted after they have been
// cross-checked against the cards on the page; if the API can't be read, or doesn't
// agree with the cards, this falls back to parsing the cards and keeping the lazy list
// scrolled until everything has loaded, as it always did. Also carries out clicks and
// quantity steps. Draws no UI. Does nothing until start() is called, and stops
// completely on stop().
import { LOG_PREFIX } from '../lib/constants.js';
import { crossCheck, currencyOf, picksToTickets, ticketKey } from '../lib/quickpicks.js';
import { parseTicketCard, parseTickets } from '../lib/tickets.js';
import { createApiSource } from './api-source.js';
import * as tm from './tm-page.js';

const SCROLL_INTERVAL_MS = 600;
const SNAPSHOT_DEBOUNCE_MS = 250;
const NO_REQUEST_GRACE_MS = 3000; // how long to wait for the page's own list request before scrolling instead
const VERIFY_GRACE_MS = 4000; // how long the API's tickets may disagree with the cards (the page may be mid-reload) before giving up
const VIP_STEP_MS = 200;
const VIP_TRIES = 15; // up to ~3s for the VIP packages to appear once their row is pressed
const LOAD_STEP_MS = 400;
const LOAD_TRIES = 40; // up to ~16s of scrolling to bring one ticket's card into the page

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/**
 * `onSnapshot({ status, source, fallback, viaApi, qty, tickets, vip, pageSort, textPx, venue })` is called with the current page state
 * whenever it changes. Tickets read from cards hold their `element`; tickets from the API don't (see clickTicket).
 * `source` is 'api' or 'scroll'; `fallback` says why the API isn't being used, if it was meant to be; `viaApi` is whether
 * the tickets are (or are about to be) read from it. `vip` is Ticketmaster's "VIP Packages" row: only the cards need it. `loadMode` ('api', the default, or 'scroll') says where tickets should come from.
 * `deps.apiSource` is for tests.
 */
export function createPageReader({ onSnapshot, loadMode: initialMode, deps }) {
  const d = deps || {};
  let running = false;
  let lastQty = null;
  let lastSent = null;
  let debounceTimer = null;
  let autoScrollInterval = null;

  let loadMode = initialMode === 'scroll' ? 'scroll' : 'api'; // 'api' | 'scroll'
  let gaveUp = null; // why the API isn't being used on this page, or null
  let startedAt = 0;
  let timers = [];
  let verified = null; // { signature, currency, tickets } the API's tickets once they agreed with the cards
  let partialChecked = null; // signature of a list whose first pages (read so far) agreed with the cards
  let apiTickets = []; // the API's tickets as last shown (some of the list while it loads, then all): selecting counts identical ones in this order
  let mismatchSince = 0;
  let loadHooks = null; // { before(), after() }: the host makes the page's list loadable around a scroll-to-load
  let findingCard = false;
  const api = d.apiSource || createApiSource({ onChange: function () { scheduleSnapshot(); } });

  function usingApi() {
    return running && loadMode === 'api' && gaveUp === null;
  }

  function giveUp(reason) {
    if (gaveUp !== null) return;
    gaveUp = reason;
    console.warn(LOG_PREFIX + 'Not using the ticket list API (' + reason + '); scrolling the list instead.');
    api.stop();
    verified = null;
    partialChecked = null;
    apiTickets = [];
    if (running) startAutoScroll();
  }

  const observer = new MutationObserver(function () {
    scheduleSnapshot();
  });

  // --- auto-scroll (loads every ticket by scrolling the lazy list) ---------

  function stopAutoScroll() {
    if (autoScrollInterval) {
      console.log(LOG_PREFIX + 'Stopping auto-scroll interval.');
      clearInterval(autoScrollInterval);
      autoScrollInterval = null;
    }
  }

  function autoScrollTick() {
    if (!running) {
      stopAutoScroll();
      return;
    }

    // Nothing to scroll on pages without a ticket list (or before it renders).
    // Scrolling anyway would throw e.g. the homepage to the bottom just because
    // Section View is open.
    if (tm.getCards().length === 0) return;

    const status = tm.getLoadedStatus();
    if (status.total > 0 && status.isComplete) {
      console.log(LOG_PREFIX + 'All tickets loaded (' + status.loaded + '/' + status.total + '). Resetting scroll to top.');
      stopAutoScroll();
      tm.scrollToTopAllContainers();
      scheduleSnapshot();
      return;
    }

    tm.scrollToLoadMore();
    scheduleSnapshot();
  }

  function startAutoScroll() {
    if (!running) return;
    stopAutoScroll();
    console.log(LOG_PREFIX + 'Starting card-anchored auto-scroll...');
    autoScrollInterval = setInterval(autoScrollTick, SCROLL_INTERVAL_MS);
  }

  // --- snapshots -----------------------------------------------------------

  function scheduleSnapshot() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { sendSnapshot(false); }, SNAPSHOT_DEBOUNCE_MS);
  }

  /**
   * The tickets read so far while the API is still paging through a long list, so there is something to
   * browse straight away: shown once they agree with the cards on the page (the same check as for the whole
   * list, but a disagreement here just means "keep showing the cards"; the whole list's check decides
   * whether to give up). Null when there is nothing to show yet.
   */
  function partialView(a, domTickets, qty) {
    if (!a.partial || a.partial.length === 0 || domTickets.length === 0) return null;
    if (a.qty !== null && a.qty !== qty) return null;
    const domCurrency = (domTickets.find(function (t) { return t.currency; }) || {}).currency || '';
    const tickets = picksToTickets({ picks: a.partial }, { currency: domCurrency || currencyOf({ currency: a.currency }) });
    if (partialChecked !== a.signature) {
      if (!crossCheck(domTickets, tickets).ok) return null;
      partialChecked = a.signature;
    }
    return tickets;
  }

  /**
   * What the list API says, if it can be trusted yet: { tickets, status }. Null while it is still
   * being read, or the page is catching up with it (the cards are shown meanwhile), or after giving up.
   */
  function apiView(domTickets, qty, domStatus) {
    const a = api.state();
    if (a.phase === 'failed') {
      giveUp('reading it failed: ' + a.error);
      return null;
    }
    if (a.phase === 'waiting') {
      if (domTickets.length > 0 && Date.now() - startedAt > NO_REQUEST_GRACE_MS) giveUp('the page was not seen asking for its list');
      return null;
    }
    if (a.phase === 'loading') {
      const total = a.total || domStatus.total;
      const partial = partialView(a, domTickets, qty);
      if (partial) {
        apiTickets = partial;
        return { tickets: partial, status: { loaded: partial.length, total, isComplete: false } };
      }
      return { loading: { loaded: a.loaded, total } };
    }
    if (a.qty !== null && a.qty !== qty) return null; // the page changed the quantity; its new list is on its way

    const domCurrency = (domTickets.find(function (t) { return t.currency; }) || {}).currency || '';
    const currency = domCurrency || currencyOf({ currency: a.currency });
    if (!verified || verified.signature !== a.signature || verified.currency !== currency) {
      if (domTickets.length === 0) return null; // nothing to compare with yet
      const tickets = picksToTickets({ picks: a.picks }, { currency });
      const check = crossCheck(domTickets, tickets);
      if (!check.ok) {
        if (!mismatchSince) {
          mismatchSince = Date.now();
          timers.push(setTimeout(scheduleSnapshot, VERIFY_GRACE_MS + 100));
        }
        if (Date.now() - mismatchSince > VERIFY_GRACE_MS) {
          giveUp('it disagrees with the page: ' + (check.total - check.matched) + ' of ' + check.total + ' cards have no matching ticket, e.g. ' + check.missing.slice(0, 3).join(', '));
        }
        return null;
      }
      mismatchSince = 0;
      verified = { signature: a.signature, currency, tickets };
    }
    apiTickets = verified.tickets;
    return { tickets: verified.tickets, status: { loaded: verified.tickets.length, total: a.total, isComplete: true } };
  }

  /** Read the page and report it, unless nothing has changed since last time. */
  function sendSnapshot(force) {
    if (!running) return;

    const qty = tm.getActiveQuantity();
    if (lastQty !== null && lastQty !== qty && !usingApi()) {
      console.log(LOG_PREFIX + 'Observed quantity change (' + lastQty + ' -> ' + qty + '). Resetting scroll loop.');
      startAutoScroll();
    }
    lastQty = qty;

    const domTickets = parseTickets();
    let tickets = domTickets;
    let status = tm.getLoadedStatus();
    let source = 'scroll';

    if (usingApi()) {
      const view = apiView(domTickets, qty, status);
      if (view && view.tickets) {
        tickets = view.tickets;
        status = view.status;
        source = 'api';
      } else if (view && view.loading) {
        status = { loaded: view.loading.loaded, total: view.loading.total, isComplete: false };
      } else if (usingApi()) {
        // Waiting for the page: show its cards, and don't call it complete
        status = Object.assign({}, status, { isComplete: false });
      }
    }
    if (!usingApi() && !status.isComplete && !autoScrollInterval) startAutoScroll();

    const vipRow = tm.findVipRow();
    // Expanded <=> the packages are actually in the list (works in any language).
    const vip = vipRow
      ? { element: vipRow.element, title: vipRow.title, range: vipRow.range, expanded: domTickets.some(function (t) { return t.type === 'vip'; }) }
      : null;

    // Compare on the data alone: elements are re-created by Ticketmaster often
    // and say nothing about whether what the user sees has changed.
    const venue = tm.findVenue();
    const pageSort = tm.getPageSort();
    const textPx = tm.measureTicketTextPx();

    const serialized = JSON.stringify({
      status,
      source,
      fallback: gaveUp,
      viaApi: usingApi(),
      qty,
      pageSort,
      textPx,
      venue,
      vip: vip && { title: vip.title, range: vip.range, expanded: vip.expanded },
      tickets: tickets.map(function (t) {
        const plain = Object.assign({}, t);
        delete plain.element;
        return plain;
      }),
    });
    if (!force && serialized === lastSent) return;
    lastSent = serialized;

    onSnapshot({ status, source, fallback: gaveUp, viaApi: usingApi(), qty, tickets, vip, pageSort, textPx, venue });
  }

  // --- commands ------------------------------------------------------------

  /**
   * The card on the page for a ticket, or null. Cards read from the page still have their element (or
   * their label). A ticket from the API has neither: the card is the one with the same section, row,
   * price and resale-ness, taking the n-th such card if n tickets before it in the list look the same
   * (cards don't show seat numbers, so identical tickets are told apart by their order, which is the
   * API's order since we read it with the page's own sort).
   */
  function findCard(ticket) {
    if (ticket.element && ticket.element.isConnected) return ticket.element;
    const cards = tm.getCards();
    if (ticket.ariaLabel) {
      const byLabel = cards.find(function (c) { return c.getAttribute('aria-label') === ticket.ariaLabel; });
      if (byLabel) return byLabel;
    }
    if (ticket.source !== 'api') return null;

    const key = ticketKey(ticket);
    const earlier = apiTickets.filter(function (t) { return t.index < ticket.index && ticketKey(t) === key; }).length;
    const matching = cards.filter(function (c) { return ticketKey(parseTicketCard(c)) === key; });
    return matching[earlier] || null;
  }

  /**
   * A ticket from the API whose card hasn't loaded yet (the page only has the first few): scroll the page's
   * list until it has. The host gets to make the list scrollable first (it may be hidden behind our view).
   */
  async function loadCard(ticket) {
    if (loadHooks && loadHooks.before) await loadHooks.before();
    let card = null;
    try {
      for (let i = 0; i < LOAD_TRIES && running; i++) {
        tm.scrollToLoadMore();
        await sleep(LOAD_STEP_MS);
        card = findCard(ticket);
        if (card || tm.getLoadedStatus().isComplete) break;
      }
      if (!card) card = findCard(ticket);
    } finally {
      if (loadHooks && loadHooks.after) await loadHooks.after();
    }
    return card;
  }

  /**
   * A VIP package's card is only in the page once Ticketmaster's "VIP Packages" row has been expanded, so press
   * it (unless the packages are already showing: pressing again would close them) and wait for the card.
   */
  async function revealVipCard(ticket) {
    const row = tm.findVipRow();
    if (row && !parseTickets().some(function (t) { return t.type === 'vip'; })) tm.clickElement(row.element);
    let card = null;
    for (let i = 0; i < VIP_TRIES && running; i++) {
      await sleep(VIP_STEP_MS);
      card = findCard(ticket);
      if (card) break;
    }
    return card;
  }

  /** Select a ticket on the page, loading its card first if it isn't there yet. */
  async function clickTicket(ticket, options) {
    if (findingCard) return; // one at a time: a second click while the first is still loading its card
    let card = findCard(ticket);
    if (!card && ticket.source === 'api') {
      findingCard = true;
      try {
        card = ticket.type === 'vip' ? await revealVipCard(ticket) : await loadCard(ticket);
      } finally {
        findingCard = false;
      }
    }
    if (!card) {
      console.warn(LOG_PREFIX + 'Ticket no longer on the page:', ticket.title || ticket.ariaLabel);
      return;
    }

    // The page's own list scrolls to the ticket as feedback; pointless when it's covered.
    if (!options || options.scroll !== false) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tm.clickElement(card);
  }

  /** Press Ticketmaster's "Show Tickets" / "Hide Tickets" button on the VIP row. */
  function toggleVip() {
    const row = tm.findVipRow();
    if (row) tm.clickElement(row.element);
  }

  /** Step Ticketmaster's own quantity control by +1 / -1, pausing auto-scroll while the page reacts. */
  function stepQuantity(delta) {
    const started = tm.stepQuantity(delta, function () {
      if (!usingApi()) startAutoScroll();
      scheduleSnapshot();
    });
    if (started && !usingApi()) stopAutoScroll();
  }

  // --- lifecycle -----------------------------------------------------------

  function beginLoading() {
    gaveUp = null;
    verified = null;
    partialChecked = null;
    apiTickets = [];
    mismatchSince = 0;
    startedAt = Date.now();
    if (loadMode === 'api') {
      api.start();
      // If the page never asks for its list (or we never see it), carry on by scrolling.
      timers.push(setTimeout(scheduleSnapshot, NO_REQUEST_GRACE_MS + 100));
    } else {
      startAutoScroll();
    }
  }

  function start() {
    if (running) return;
    running = true;
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    beginLoading();
    sendSnapshot(true);
  }

  function stop() {
    if (!running) return;
    running = false;
    observer.disconnect();
    stopAutoScroll();
    api.stop();
    timers.forEach(clearTimeout);
    timers = [];
    clearTimeout(debounceTimer);
    lastSent = null;
    lastQty = null;
    verified = null;
    partialChecked = null;
    apiTickets = [];
  }

  /** 'api' (read the list API, the default) or 'scroll' (scroll Ticketmaster's list until it has loaded everything). */
  function setLoadMode(next) {
    if ((next !== 'api' && next !== 'scroll') || next === loadMode) return;
    loadMode = next;
    if (!running) return;
    api.stop();
    stopAutoScroll();
    timers.forEach(clearTimeout);
    timers = [];
    beginLoading();
    scheduleSnapshot();
  }

  /** Where the tickets come from now: 'api', 'scroll', and why the API isn't being used if that's the case. */
  function sourceInfo() {
    return { mode: loadMode, using: usingApi() ? 'api' : 'scroll', gaveUp };
  }

  return {
    start,
    stop,
    clickTicket,
    toggleVip,
    stepQuantity,
    setLoadMode,
    sourceInfo,
    /** `hooks.before()` / `hooks.after()` (may return promises) bracket scrolling the page's list to bring a card in. */
    setLoadHooks: function (hooks) { loadHooks = hooks || null; },
    isRunning: function () { return running; },
  };
}
