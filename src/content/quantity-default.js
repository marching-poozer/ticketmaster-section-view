// Ticketmaster starts every page at 2 tickets, however you left it. This sets the quantity you prefer when a page loads, by pressing
// Ticketmaster's own quantity control (the same "2 Tickets" chip and its + / - that you would press), once per page and never again:
// a quantity you choose yourself afterwards is left alone. It closes the dropdown that stepping opens, and says when it cannot (the
// control did not appear, or would not move) rather than trying forever.
//
// `pending()` tells the reader to hold off reading Ticketmaster's ticket list until this is done: the page asks for a list at every
// quantity it passes through (2, 3, 4...), and reading the ones we are about to leave would be wasted requests.
import { LOG_PREFIX } from '../lib/constants.js';
import * as pageTm from './tm-page.js';

const WAIT_FOR_CONTROL_MS = 10000; // how long to wait for Ticketmaster's quantity control to appear
const MAX_STEPS = 10; // Ticketmaster allows 1-8: more steps than that means something is wrong
const STUCK_STEPS = 2; // steps that change nothing before it gives up

/**
 * `options.tm` (the page helpers), `options.key()` (what a page is: its path, so a new event reached without a reload gets its
 * turn), `options.now()` and `options.log(message)` are for tests.
 */
export function createQuantityDefault(options) {
  const o = options || {};
  const tm = o.tm || pageTm;
  const now = o.now || function () { return Date.now(); };
  const key = o.key || function () { return typeof location !== 'undefined' ? location.pathname : ''; };
  const log = o.log || function (message) { console.log(LOG_PREFIX + message); };

  let desired = 0; // 0: leave Ticketmaster alone
  let doneFor = null; // the page (key) this has finished for
  let watching = null; // the page it is working on
  let stepping = false; // a press is in progress
  let startedAt = null;
  let steps = 0;
  let stuck = 0;
  const waiting = [];

  function settle() {
    const callbacks = waiting.splice(0);
    callbacks.forEach(function (fn) {
      try { fn(); } catch (err) { /* one failing must not stop the others */ }
    });
  }

  function finish(message) {
    stepping = false;
    doneFor = key();
    try { tm.closeQuantityControl(); } catch (err) { /* nothing to close */ }
    if (message) log(message);
    settle();
  }

  /** Is there work to do on this page that has not been done? */
  function pending() {
    return desired > 0 && doneFor !== key();
  }

  /** Look at the page and take the next step towards the quantity, if one is due. Cheap: call it as often as the page changes. */
  function tick() {
    if (!pending() || stepping) return;
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
    if (active === desired) {
      finish(steps > 0 ? 'Ticket quantity set to ' + desired + '.' : null);
      return;
    }
    if (steps >= MAX_STEPS) {
      finish('Could not set the ticket quantity to ' + desired + ' (it is ' + active + ').');
      return;
    }
    stepping = true;
    steps += 1;
    const started = tm.stepQuantity(desired > active ? 1 : -1, function () {
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
    /** `fn` is called once, when there is nothing left to wait for (at once if there is not). */
    whenSettled(fn) {
      if (!pending()) fn();
      else waiting.push(fn);
    },
  };
}
