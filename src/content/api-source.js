// Reads every ticket from Ticketmaster's list API instead of scrolling the page's list
// until it has loaded them all. It replays the page's own list request (see capture.js)
// page by page, so the filters (quantity, ticket types, primary / resale) are exactly
// the ones on screen, and starts again whenever the page changes them.
//
// This only fetches and converts. Whether to trust the result is the page reader's call
// (it checks the tickets against the cards on the page), and so is what to do when this
// fails: carry on by scrolling, as before.
import { LOG_PREFIX } from '../lib/constants.js';
import { listQuantity, listSignature, pageUrl, picksToTickets } from '../lib/quickpicks.js';
import { capture as defaultCapture } from './capture.js';

const CONCURRENCY = 4;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/** GET a list page as JSON, same-origin with the page's cookies. Throws on anything but a good answer. */
export async function fetchListPage(url, signal) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const body = await response.json();
  if (!body || !Array.isArray(body.picks) || !Number.isInteger(body.total) || body.total < 0) {
    throw new Error('unexpected response (no picks / total)');
  }
  return body;
}

/**
 * Every pick of the list the request is for: the first page, then the rest in parallel
 * (a few at a time), then checked: as many picks as `total` says, none twice.
 * `fetchPage(url, signal)` -> { total, picks } (fetchListPage; faked in tests).
 * Resolves to { picks, total, currency } where currency is what the response says ('' if it doesn't).
 */
export async function fetchAllPicks(url, { fetchPage = fetchListPage, signal, onProgress, concurrency = CONCURRENCY } = {}) {
  const aborted = function () { if (signal && signal.aborted) throw new Error('aborted'); };

  const first = await fetchPage(pageUrl(url, 0), signal);
  aborted();
  const total = first.total;
  const pageSize = first.picks.length;
  const pages = new Map([[0, first.picks]]);
  const loaded = function () { let n = 0; pages.forEach(function (p) { n += p.length; }); return n; };
  if (onProgress) onProgress({ loaded: loaded(), total });

  if (pageSize > 0 && total > pageSize) {
    const offsets = [];
    for (let o = pageSize; o < total; o += pageSize) offsets.push(o);
    let next = 0;
    const worker = async function () {
      while (next < offsets.length) {
        const offset = offsets[next++];
        aborted();
        const page = await fetchPage(pageUrl(url, offset), signal);
        aborted();
        pages.set(offset, page.picks);
        if (onProgress) onProgress({ loaded: loaded(), total });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, offsets.length) }, worker));
  }

  const picks = [];
  const seen = new Set();
  Array.from(pages.keys()).sort(function (a, b) { return a - b; }).forEach(function (offset) {
    pages.get(offset).forEach(function (pick) {
      const id = pick && pick.id != null ? String(pick.id) : null;
      if (id !== null) {
        if (seen.has(id)) return;
        seen.add(id);
      }
      picks.push(pick);
    });
  });
  if (picks.length !== total) throw new Error('got ' + picks.length + ' of ' + total + ' tickets');
  return { picks, total, currency: first.currency || first.currencyCode || '' };
}

/**
 * `onChange()` is called whenever `state()` changes. The state:
 *   phase:     'waiting' (no list request seen yet) | 'loading' | 'ready' | 'failed'
 *   signature: which list it is of (listSignature); qty: that list's quantity
 *   loaded / total: progress; error: why it 'failed'
 *   picks / currency: what the API sent, once 'ready'; tickets: those as tickets (picksToTickets)
 * `deps.capture`, `deps.fetchPage` and `deps.retryDelaysMs` are for tests.
 */
export function createApiSource({ onChange, deps } = {}) {
  const d = deps || {};
  const capture = d.capture || defaultCapture;
  const fetchPage = d.fetchPage || fetchListPage;
  const retryDelays = d.retryDelaysMs || [400, 1500];

  let running = false;
  let unsubscribe = null;
  let controller = null;
  const fresh = function () { return { phase: 'waiting', signature: null, qty: null, loaded: 0, total: 0, tickets: [], picks: [], currency: '', error: null }; };
  let current = fresh();

  function set(next) {
    current = Object.assign({}, current, next);
    if (onChange) onChange();
  }

  /** Fetch with a couple of retries: the first request can race the page's own. */
  async function fetchWithRetry(url, signal, onProgress) {
    let lastError;
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        return await fetchAllPicks(url, { fetchPage, signal, onProgress });
      } catch (err) {
        if (signal.aborted) throw err;
        lastError = err;
        if (attempt < retryDelays.length) await sleep(retryDelays[attempt]);
      }
    }
    throw lastError;
  }

  async function load(url, signature) {
    if (controller) controller.abort();
    const mine = (controller = new AbortController());
    set(Object.assign(fresh(), { phase: 'loading', signature, qty: listQuantity(url) }));
    try {
      const result = await fetchWithRetry(url, mine.signal, function (p) {
        if (!mine.signal.aborted) set({ loaded: p.loaded, total: p.total });
      });
      if (mine.signal.aborted) return;
      const tickets = picksToTickets({ picks: result.picks, currency: result.currency });
      set({ phase: 'ready', loaded: tickets.length, total: result.total, tickets, picks: result.picks, currency: result.currency });
    } catch (err) {
      if (mine.signal.aborted) return;
      console.warn(LOG_PREFIX + 'Could not read the ticket list from the API:', err && err.message ? err.message : err);
      set({ phase: 'failed', error: err && err.message ? err.message : String(err) });
    }
  }

  /** A list request has been seen: load its list, unless that is the list we already have (a later page of it). */
  function onRequest(url) {
    if (!running) return;
    const signature = listSignature(url);
    // The same list again is a later page of it (or one we already failed on: don't hammer it).
    if (!signature || signature === current.signature) return;
    load(url, signature);
  }

  return {
    start() {
      if (running) return;
      running = true;
      current = fresh();
      unsubscribe = capture.subscribe(onRequest);
      capture.start();
      const seen = capture.latest();
      if (seen) onRequest(seen);
    },

    stop() {
      running = false;
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      if (controller) controller.abort();
      controller = null;
    },

    state() {
      return current;
    },

    /** Give up on the list the page is showing and read it again (e.g. after the cross-check failed once for stale data). */
    reload() {
      const url = capture.latest();
      if (running && url) load(url, listSignature(url));
    },
  };
}
