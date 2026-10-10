// Ticketmaster starts every page at 2 tickets, however you left it. Two jobs, both through Ticketmaster's OWN quantity control (the
// "2 Tickets" chip and the Quantity stepper it opens), so what you see and press on the page is Ticketmaster's, unchanged:
//
//   1. Set the quantity you prefer when a page loads: press the stepper's + / - once per page and never again, keeping the panel it
//      opens out of sight while we do (so the page does not jump open and shut), then close it. A quantity you choose yourself
//      afterwards is left alone.
//   2. Remember what you choose: once the page is at rest, a change you make with Ticketmaster's control (or our own header's) is
//      reported (`onChoose`), to be saved and applied to the next page.
//
// It stays within the event's own limit (the stepper says it: 6 for some events, not always 8), and says when it cannot (the control
// did not appear, or will not move) rather than trying forever.
//
// `pending()` tells the reader to hold off reading Ticketmaster's ticket list until this is done: the page asks for a list at every
// quantity it passes through (2, 3, 4...), and reading the ones we are about to leave would be wasted requests.
import { LOG_PREFIX } from '../lib/constants.js';
import * as pageTm from './tm-page.js';

const WAIT_FOR_CONTROL_MS = 10000; // how long to wait for Ticketmaster's quantity control to appear
const MAX_STEPS = 10; // Ticketmaster allows 1-8: more steps than that means something is wrong
const STUCK_STEPS = 2; // steps that change nothing before it gives up
const HIDE_LIMIT_MS = 20000; // the panel is never kept out of sight longer than this, whatever happens

/**
 * `options.tm` (the page helpers), `options.key()` (what a page is: its path, so a new event reached without a reload gets its
 * turn), `options.now()`, `options.log(message)` are for tests. `options.onChoose(quantity)` hears a quantity the user chose.
 */
export function createQuantityDefault(options) {
  const o = options || {};
  const tm = o.tm || pageTm;
  const now = o.now || function () { return Date.now(); };
  const key = o.key || function () { return typeof location !== 'undefined' ? location.pathname : ''; };
  const log = o.log || function (message) { console.log(LOG_PREFIX + message); };
  let onChoose = o.onChoose || null;

  let desired = 0; // 0: none asked for
  let remember = false; // report what the user chooses
  let doneFor = null; // the page (key) this has finished for
  let watching = null; // the page it is working on
  let stepping = false; // a press is in progress
  let startedAt = null;
  let steps = 0;
  let stuck = 0;
  let observed = null; // the quantity the page was last seen at, at rest (a different one later is the user's choice)
  let observedFor = null;
  let guard = null; // { observer, timer }: while the quantity panel is kept out of sight
  const waiting = [];

  function settle() {
    const callbacks = waiting.splice(0);
    callbacks.forEach(function (fn) {
      try { fn(); } catch (err) { /* one failing must not stop the others */ }
    });
  }

  /** Keep Ticketmaster's quantity panel out of sight as it opens (before it is painted), until release(). */
  function hold() {
    if (guard || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const apply = function () {
      try { tm.hideQuantityPanel(true); } catch (err) { /* not there yet */ }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    guard = { observer, timer: setTimeout(release, HIDE_LIMIT_MS) };
  }

  function release() {
    if (!guard) return;
    guard.observer.disconnect();
    clearTimeout(guard.timer);
    guard = null;
    try { tm.hideQuantityPanel(false); } catch (err) { /* gone */ }
  }

  function finish(message) {
    stepping = false;
    doneFor = key();
    release();
    // Stepping opens Ticketmaster's panel: close it, but only if it was us who opened it (never a panel the user has open).
    if (steps > 0) {
      try { tm.closeQuantityControl(); } catch (err) { /* nothing to close */ }
    }
    observed = tm.hasQuantityControl() ? tm.getActiveQuantity() : null;
    observedFor = key();
    if (message) log(message);
    settle();
  }

  /** At rest: a quantity different from the last one seen is the user's choice. */
  function observe() {
    if (!remember || !tm.hasQuantityControl()) return;
    const page = key();
    const active = tm.getActiveQuantity();
    if (observedFor !== page || observed === null) {
      observed = active;
      observedFor = page;
      return;
    }
    if (active === observed) return;
    observed = active;
    if (onChoose) {
      try { onChoose(active); } catch (err) { /* not ours to break */ }
    }
  }

  /** Is there work to do on this page that has not been done? */
  function pending() {
    return desired > 0 && doneFor !== key();
  }

  /** Look at the page and take the next step towards the quantity, if one is due. Cheap: call it as often as the page changes. */
  function tick() {
    if (stepping) return;
    if (!pending()) {
      observe();
      return;
    }
    const page = key();
    if (watching !== page) {
      watching = page;
      startedAt = null;
      steps = 0;
      stuck = 0;
    }
    if (startedAt === null) startedAt = now();
    if (!tm.hasQuantityControl()) {
      if (now() - startedAt > WAIT_FOR_CONTROL_MS) finish('Could not set the ticket quantity to ' + desired + ': Ticketmaster\'s quantity control did not appear.');
      return;
    }
    const active = tm.getActiveQuantity();
    // never beyond what the event allows (known once the stepper has been open: it says so)
    const limit = tm.getQuantityMax ? tm.getQuantityMax() : null;
    const want = limit !== null && desired > limit ? limit : desired;
    if (active === want) {
      finish(steps > 0 ? 'Ticket quantity set to ' + want + (want !== desired ? ' (the most this event allows; ' + desired + ' was asked for)' : '') + '.' : null);
      return;
    }
    if (steps >= MAX_STEPS) {
      finish('Could not set the ticket quantity to ' + desired + ' (it is ' + active + ').');
      return;
    }
    stepping = true;
    steps += 1;
    hold();
    const started = tm.stepQuantity(want > active ? 1 : -1, function () {
      stepping = false;
      if (tm.getActiveQuantity() === active) {
        stuck += 1;
        if (stuck >= STUCK_STEPS) {
          finish('Could not set the ticket quantity to ' + desired + ': Ticketmaster\'s control did not move from ' + active + '.');
          return;
        }
      } else {
        stuck = 0;
      }
      tick();
    });
    if (!started) finish('Could not set the ticket quantity to ' + desired + '.');
  }

  return {
    tick,
    pending,
    /** The quantity to ask for (0: none). A new one is applied to the page that is open now too. */
    setDesired(quantity) {
      const next = Number.isInteger(quantity) && quantity > 0 ? quantity : 0;
      if (next === desired) return;
      desired = next;
      doneFor = null;
      watching = null;
      if (!desired) settle();
    },
    /** Report the quantity the user chooses (`fn(quantity)`), or stop reporting. */
    setRemember(on, fn) {
      remember = on === true;
      if (typeof fn === 'function') onChoose = fn;
      if (!remember) observed = null;
    },
    /** `fn` is called once, when there is nothing left to wait for (at once if there is not). */
    whenSettled(fn) {
      if (!pending()) fn();
      else waiting.push(fn);
    },
  };
}
