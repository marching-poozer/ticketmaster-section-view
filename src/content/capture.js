// Remembers the page's own requests of Ticketmaster's ticket list API
// (/api/quickpicks/<event>/list?...), by watching the browser's resource timing.
// Those requests carry exactly the filters the list on screen is for (quantity,
// ticket types, primary / resale), so replaying one with another offset reads the
// same list without us having to know what any of its parameters mean.
//
// No permissions needed: the page's own timeline lists its requests (the URL only).
// This module starts watching as soon as it is imported; a tiny script (early.js)
// imports it at document_start so requests made while the page loads are seen, and
// the buffered entries cover anything from before that.
import { isListUrl } from '../lib/quickpicks.js';

/** `deps.Observer` stands in for PerformanceObserver in tests. */
export function createCapture(deps) {
  const Observer = (deps && deps.Observer) || (typeof PerformanceObserver !== 'undefined' ? PerformanceObserver : null);
  const listeners = new Set();
  let latest = null;
  let observer = null;

  function record(entries) {
    entries.forEach(function (entry) {
      if (!isListUrl(entry.name)) return;
      latest = entry.name;
      listeners.forEach(function (fn) {
        try {
          fn(latest);
        } catch (err) { /* one listener failing must not stop the others */ }
      });
    });
  }

  return {
    /** Begin watching. Safe to call twice. Quietly does nothing where resource timing isn't available. */
    start() {
      if (observer || !Observer) return;
      try {
        observer = new Observer(function (list) { record(list.getEntries()); });
        observer.observe({ type: 'resource', buffered: true });
      } catch (err) {
        observer = null;
      }
    },

    stop() {
      if (observer) observer.disconnect();
      observer = null;
    },

    /** The most recent list request seen (absolute URL), or null. */
    latest() {
      return latest;
    },

    /** Call `fn(url)` for each list request seen from now on. Returns an unsubscribe function. */
    subscribe(fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },

    // For tests: feed entries without a browser.
    record,
  };
}

/** The one that watches the real page. */
export const capture = createCapture();
capture.start();
