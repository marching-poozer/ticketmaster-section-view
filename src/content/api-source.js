// Reads every ticket from Ticketmaster's list API instead of scrolling the page's list
// until it has loaded them all. It replays the page's own list request (see capture.js)
// page by page, so the filters (quantity, ticket types, primary / resale) are exactly
// the ones on screen, and starts again whenever the page changes them.
//
// This only fetches and converts. Whether to trust the result is the page reader's call
// (it checks the tickets against the cards on the page), and so is what to do when this
// fails: carry on by scrolling, as before.
import { API_PAUSE_KEY, formatClock, isRefusal, pauseRemaining, pauseUntil } from '../lib/api-pause.js';
import { LOG_PREFIX } from '../lib/constants.js';
import { listQuantity, listSignature, pageUrl, picksToTickets } from '../lib/quickpicks.js';
import { capture as defaultCapture } from './capture.js';

// The page itself asks for one page at a time; a burst of parallel requests is what a bot defence notices.
const CONCURRENCY = 2;

// The response headers worth showing when a request is refused (never cookies, which a page can't read anyway).
const DETAIL_HEADER = /^(content-type|server|retry-after|www-authenticate|akamai-[a-z0-9-]+|x-[a-z0-9-]*(error|reference|request|akamai|block)[a-z0-9-]*)$/i;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/** What a refused request said, for the console: { statusText, headers: ['server: AkamaiGHost'], body: first 300 characters as text }. */
async function describeResponse(response) {
  const headers = [];
  try {
    response.headers.forEach(function (value, name) {
      if (DETAIL_HEADER.test(name) && headers.length < 10) headers.push(name + ': ' + String(value).slice(0, 100));
    });
  } catch (err) { /* nothing to show */ }
  let body = '';
  try {
    body = String(await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  } catch (err) { /* nothing to show */ }
  return { statusText: response.statusText || '', headers, body };
}

/** The pause after a refusal is remembered in storage, so reloading the page doesn't ask again at once. */
function storagePause() {
  let memory = 0;
  return {
    async get() {
      try {
        const stored = await chrome.storage.local.get(API_PAUSE_KEY);
        return Number(stored[API_PAUSE_KEY]) || memory;
      } catch (err) {
        return memory;
      }
    },
    async set(until) {
      memory = until;
      try {
        await chrome.storage.local.set({ [API_PAUSE_KEY]: until });
      } catch (err) { /* kept in memory for this page */ }
    },
  };
}

/**
 * GET a list page as JSON, same-origin with the page's cookies. Throws on anything but a good answer;
 * an error status is an Error with `status` and `detail` (what the response said: see describeResponse).
 */
export async function fetchListPage(url, signal) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal });
  if (!response.ok) {
    const err = new Error('HTTP ' + response.status);
    err.status = response.status;
    err.detail = await describeResponse(response);
    throw err;
  }
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
    let failure = null;
    const worker = async function () {
      // Once one page has failed the others stop asking for more: the whole read fails anyway.
      while (next < offsets.length && !failure) {
        const offset = offsets[next++];
        try {
          aborted();
          const page = await fetchPage(pageUrl(url, offset), signal);
          aborted();
          pages.set(offset, page.picks);
          if (onProgress) onProgress({ loaded: loaded(), total });
        } catch (err) {
          failure = failure || err;
          throw err;
        }
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
  const pause = d.pause || storagePause();

  let running = false;
  let unsubscribe = null;
  let controller = null;
  const fresh = function () { return { phase: 'waiting', signature: null, qty: null, loaded: 0, total: 0, tickets: [], picks: [], currency: '', error: null }; };
  let current = fresh();

  function set(next) {
    current = Object.assign({}, current, next);
    if (onChange) onChange();
  }

  /** Fetch with a couple of retries: the first request can race the page's own. Not after a refusal. */
  async function fetchWithRetry(url, signal, onProgress) {
    let lastError;
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        return await fetchAllPicks(url, { fetchPage, signal, onProgress });
      } catch (err) {
        if (signal.aborted) throw err;
        if (isRefusal(err && err.status)) throw err; // a "no" isn't a hiccup: asking again only makes it worse
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

    // Ticketmaster said no a short while ago: don't ask at all (the page reader scrolls instead).
    const pausedUntil = await pause.get();
    if (mine.signal.aborted) return;
    if (pauseRemaining(pausedUntil, Date.now()) > 0) {
      const why = 'paused until ' + formatClock(pausedUntil) + ', after Ticketmaster refused the list request';
      console.warn(LOG_PREFIX + 'Not asking the ticket list API: ' + why + '.');
      set({ phase: 'failed', error: why });
      return;
    }

    try {
      const result = await fetchWithRetry(url, mine.signal, function (p) {
        if (!mine.signal.aborted) set({ loaded: p.loaded, total: p.total });
      });
      if (mine.signal.aborted) return;
      const tickets = picksToTickets({ picks: result.picks, currency: result.currency });
      set({ phase: 'ready', loaded: tickets.length, total: result.total, tickets, picks: result.picks, currency: result.currency });
    } catch (err) {
      if (mine.signal.aborted) return;
      let message = err && err.message ? err.message : String(err);
      if (err && isRefusal(err.status)) {
        const until = pauseUntil(Date.now());
        await pause.set(until);
        message += ' (not asking again until ' + formatClock(until) + ')';
      }
      // What the refusal said, as text so it can be copied from the console.
      console.warn(LOG_PREFIX + 'Could not read the ticket list from the API: ' + message + (err && err.detail ? ' ' + JSON.stringify(err.detail) : ''));
      set({ phase: 'failed', error: message });
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
