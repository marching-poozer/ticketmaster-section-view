// Receives what content/main-hook.js posts from the page (the seat map's geometry and its seats on sale), turns it into
// lib/map-data.js's shapes, and tells whoever is listening when it changes. Starts listening as soon as it is imported (early.js
// imports it at document_start, before the page asks for anything), so nothing is missed; the latest of each is kept.
import { buildAvailability, parseFacets, parseGeometry } from '../lib/map-data.js';

/** `deps.window` is for tests. */
export function createMapDataStore(deps) {
  const win = (deps && deps.window) || (typeof window !== 'undefined' ? window : null);
  const listeners = new Set();
  let geometry = null;
  let facets = null;
  let availability = null;
  let received = { geometry: 0, facets: 0 }; // how many times each has arrived (a page may ask again)
  let bad = 0; // messages that were not JSON, or not what they said

  function snapshot() {
    return { geometry, availability, received: Object.assign({}, received), bad };
  }

  function notify() {
    const state = snapshot();
    listeners.forEach(function (fn) {
      try { fn(state); } catch (err) { /* one listener failing must not stop the others */ }
    });
  }

  function onMessage(event) {
    const data = event && event.data;
    if (!win || event.source !== win || !data || data.__tmsv !== 1 || typeof data.text !== 'string') return;
    let json;
    try {
      json = JSON.parse(data.text);
    } catch (err) {
      bad += 1;
      return;
    }
    if (data.kind === 'geometry') {
      const parsed = parseGeometry(json);
      if (!parsed) { bad += 1; return; }
      geometry = parsed;
      received.geometry += 1;
    } else if (data.kind === 'facets') {
      const parsed = parseFacets(json);
      if (!parsed) { bad += 1; return; }
      facets = parsed;
      received.facets += 1;
    } else {
      return;
    }
    availability = geometry && facets ? buildAvailability(geometry, facets) : null;
    notify();
  }

  if (win && win.addEventListener) {
    win.addEventListener('message', onMessage);
    // The page-world hook (main-hook.js) may have heard from the page before this was listening: ask it to say it again.
    try {
      const origin = win.location && win.location.origin;
      win.postMessage({ __tmsv: 1, kind: 'hello' }, origin && origin !== 'null' ? origin : '*');
    } catch (err) { /* nothing to ask */ }
  }

  return {
    /** What is known now: { geometry, availability (null until both have arrived), received, bad }. */
    get: snapshot,
    /** `fn(state)` is called after each change; returns a function that stops it. */
    subscribe(fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },
    destroy() {
      if (win && win.removeEventListener) win.removeEventListener('message', onMessage);
      listeners.clear();
    },
  };
}

/** The one shared by the content scripts of a page. */
export const mapData = createMapDataStore();
