// Reads every ticket from Ticketmaster's list API instead of scrolling the page's list
// until it has loaded them all. It replays the page's own list request (see capture.js)
// page by page, so the filters (quantity, ticket types, primary / resale) are exactly
// the ones on screen, and starts again whenever the page changes them.
//
// It asks the way a person scrolling would: one page at a time, a moment apart (the old
// scroll loop ticked every 600ms and Ticketmaster never minded). A burst of parallel
// requests got an event with ~300 tickets refused (HTTP 403). If Ticketmaster still
// pushes back part-way, it waits and tries that page again, slower; and if it says no for
// good, the API is left alone for a while (lib/api-pause.js) and the page reader scrolls.
//
// This only fetches and converts. Whether to trust the result is the page reader's call
// (it checks the tickets against the cards on the page), and so is what to do when this
// fails: carry on by scrolling, as before.
import { API_PAUSE_KEY, formatClock, isRefusal, pauseRemaining, pauseUntil } from '../lib/api-pause.js';
import { LOG_PREFIX } from '../lib/constants.js';
import { listQuantity, listSignature, pageUrl, picksToTickets } from '../lib/quickpicks.js';
import { capture as defaultCapture } from './capture.js';

const CONCURRENCY = 1; // the page itself asks for one page at a time
const GAP_MS = 650; // between two requests: about the old scroll loop's pace, with a little jitter so it isn't a metronome
const GAP_JITTER_MS = 350;
const RETRY_DELAYS_MS = [400, 1500]; // a page that failed (not refused): the first request can race the page's own
const REFUSAL_DELAYS_MS = [4000, 12000, 30000]; // a page refused part-way: back off, then try that page again
const MAX_SLOWDOWN = 4; // each refusal that later clears doubles the gap, up to 4x
const MAX_RETRY_AFTER_MS = 60 * 1000;

// The response headers worth showing when a request is refused (never cookies, which a page can't read anyway).
const DETAIL_HEADER = /^(content-type|server|retry-after|www-authenticate|akamai-[a-z0-9-]+|x-[a-z0-9-]*(error|reference|request|akamai|block)[a-z0-9-]*)$/i;

/** Wait `ms`, or until `signal` aborts (the caller checks it). */
function sleep(ms, signal) {
  return new Promise(function (resolve) {
    if (signal && signal.aborted) return resolve();
    let timer = null;
    const done = function () {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', done);
      resolve();
    };
    timer = setTimeout(done, ms);
    if (signal) signal.addEventListener('abort', done, { once: true });
  });
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

/** How long a `Retry-After: <seconds>` header asks us to wait, in ms (at most a minute), or undefined. */
function retryAfterOf(response) {
  try {
    const seconds = Number(response.headers.get('retry-after'));
    return seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : undefined;
  } catch (err) {
    return undefined;
  }
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
 * an error status is an Error with `status`, `detail` (what the response said: see describeResponse)
 * and, if the response said how long to wait, `retryAfterMs`.
 */
export async function fetchListPage(url, signal) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal });
  if (!response.ok) {
    const err = new Error('HTTP ' + response.status);
    err.status = response.status;
    err.retryAfterMs = retryAfterOf(response);
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
 * Every pick of the list the request is for: the first page, then the rest, one request at a time with a
 * gap between them (`concurrency` more at once only if asked), then checked: as many picks as `total`
 * says, none twice. `fetchPage(url, signal)` -> { total, picks } (fetchListPage; faked in tests).
 *
 * A page that fails is tried again (`retryDelaysMs`); one that is *refused* (HTTP 401 / 403 / 429) after
 * the first page is waited on (`refusalDelaysMs`, or the response's Retry-After) and tried again, with
 * every gap after that longer. The first page being refused isn't a rate limit, so that fails at once.
 * `onProgress({ loaded, total, picks })` has the picks read so far, in order. `onWait(message)` is told
 * when it is backing off. `gapMs()` is the gap before a request (0 in tests).
 * Resolves to { picks, total, currency } where currency is what the response says ('' if it doesn't).
 */
export async function fetchAllPicks(url, options) {
  const opts = options || {};
  const fetchPage = opts.fetchPage || fetchListPage;
  const signal = opts.signal;
  const onProgress = opts.onProgress;
  const concurrency = opts.concurrency || CONCURRENCY;
  const retryDelays = opts.retryDelaysMs || RETRY_DELAYS_MS;
  const refusalDelays = opts.refusalDelaysMs || REFUSAL_DELAYS_MS;
  const gapMs = opts.gapMs || function () { return GAP_MS + Math.random() * GAP_JITTER_MS; };
  const aborted = function () { if (signal && signal.aborted) throw new Error('aborted'); };

  let slowdown = 1;

  /** One page, with its retries and its backing off. */
  async function fetchOne(offset) {
    let hiccups = 0;
    let refusals = 0;
    for (;;) {
      aborted();
      try {
        return await fetchPage(pageUrl(url, offset), signal);
      } catch (err) {
        if (signal && signal.aborted) throw err;
        if (isRefusal(err && err.status)) {
          if (offset === 0 || refusals >= refusalDelays.length) throw err;
          const wait = (err && err.retryAfterMs) || refusalDelays[refusals];
          refusals++;
          slowdown = Math.min(slowdown * 2, MAX_SLOWDOWN);
          if (opts.onWait) opts.onWait('Ticketmaster refused a page of the list (HTTP ' + err.status + '); waiting ' + Math.round(wait / 1000) + 's, then trying that page again, more slowly.');
          await sleep(wait, signal);
        } else {
          if (hiccups >= retryDelays.length) throw err;
          await sleep(retryDelays[hiccups++], signal);
        }
      }
    }
  }

  const first = await fetchOne(0);
  aborted();
  const total = first.total;
  const pageSize = first.picks.length;
  const pages = new Map([[0, first.picks]]);

  /** The picks read so far with no gap in them: pages in order from the start. */
  const contiguous = function () {
    const picks = [];
    for (let offset = 0; pages.has(offset); offset += pageSize) picks.push.apply(picks, pages.get(offset));
    return picks;
  };
  const report = function () {
    if (!onProgress) return;
    const picks = contiguous();
    onProgress({ loaded: picks.length, total, picks });
  };
  report();

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
          const gap = gapMs() * slowdown;
          if (gap > 0) await sleep(gap, signal);
          aborted();
          const page = await fetchOne(offset);
          aborted();
          pages.set(offset, page.picks);
          report();
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
 *   partial:   the picks read so far while 'loading' (in order, from the start of the list)
 *   picks / currency: what the API sent, once 'ready'; tickets: those as tickets (picksToTickets)
 * `deps.capture`, `deps.fetchPage`, `deps.pause`, `deps.retryDelaysMs`, `deps.refusalDelaysMs` and `deps.gapMs` are for tests.
 */
export function createApiSource({ onChange, deps } = {}) {
  const d = deps || {};
  const capture = d.capture || defaultCapture;
  const fetchPage = d.fetchPage || fetchListPage;
  const pause = d.pause || storagePause();

  let running = false;
  let unsubscribe = null;
  let controller = null;
  const fresh = function () { return { phase: 'waiting', signature: null, qty: null, loaded: 0, total: 0, tickets: [], picks: [], partial: [], currency: '', error: null }; };
  let current = fresh();

  function set(next) {
    current = Object.assign({}, current, next);
    if (onChange) onChange();
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
      const result = await fetchAllPicks(url, {
        fetchPage,
        signal: mine.signal,
        retryDelaysMs: d.retryDelaysMs,
        refusalDelaysMs: d.refusalDelaysMs,
        gapMs: d.gapMs,
        onProgress: function (p) {
          if (!mine.signal.aborted) set({ loaded: p.loaded, total: p.total, partial: p.picks });
        },
        onWait: function (message) {
          if (!mine.signal.aborted) console.warn(LOG_PREFIX + message);
        },
      });
      if (mine.signal.aborted) return;
      const tickets = picksToTickets({ picks: result.picks, currency: result.currency });
      set({ phase: 'ready', loaded: tickets.length, total: result.total, tickets, picks: result.picks, partial: [], currency: result.currency });
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
      set({ phase: 'failed', error: message, partial: [] });
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
