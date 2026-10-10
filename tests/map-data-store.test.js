import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMapDataStore } from '../src/content/map-data-store.js';

const fixture = (name) => fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures', name), 'utf8');
const geometryText = fixture('o2-map-geometry.json');
const facetsText = fixture('o2-map-facets.json');

let store;
afterEach(() => { if (store) store.destroy(); store = null; });

const post = (kind, text, extra = {}) => window.dispatchEvent(new MessageEvent('message', { data: { __tmsv: 1, kind, text }, source: window, ...extra }));

describe('the store of the seat map\'s data', () => {
  it('knows nothing until the page has sent something', () => {
    store = createMapDataStore({ window });
    expect(store.get()).toMatchObject({ geometry: null, availability: null, received: { geometry: 0, facets: 0 }, bad: 0 });
  });

  it('asks the page-world hook to say again what it heard before it was listening', () => {
    const asked = [];
    const on = (e) => { if (e.data && e.data.kind === 'hello') asked.push(e.data); };
    window.addEventListener('message', on);
    store = createMapDataStore({ window });
    return new Promise((resolve) => setTimeout(resolve, 20)).then(() => {
      window.removeEventListener('message', on);
      expect(asked.length).toBeGreaterThanOrEqual(1); // (an earlier test's store may have asked too, a moment late)
      asked.forEach((message) => expect(message).toEqual({ __tmsv: 1, kind: 'hello' }));
      expect(store.get().bad).toBe(0); // (its own hello is not a message to read)
    });
  });

  it('has the geometry alone first, and the seats on sale once both have come, in either order', () => {
    store = createMapDataStore({ window });
    post('geometry', geometryText);
    expect(store.get().geometry.blocks).toHaveLength(7);
    expect(store.get().availability).toBeNull();
    post('facets', facetsText);
    expect(store.get().availability.seats).toHaveLength(50);
    store.destroy();
    store = createMapDataStore({ window });
    post('facets', facetsText);
    expect(store.get().availability).toBeNull();
    post('geometry', geometryText);
    expect(store.get().availability.seats).toHaveLength(50);
  });

  it('tells its listeners after each change, and not after it has stopped', () => {
    store = createMapDataStore({ window });
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    post('geometry', geometryText);
    post('facets', facetsText);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(heard.mock.calls[1][0].availability.seats).toHaveLength(50);
    stop();
    post('facets', facetsText);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('takes the latest when the page asks again (the seats on sale change), and counts them', () => {
    store = createMapDataStore({ window });
    post('geometry', geometryText);
    post('facets', facetsText);
    const smaller = JSON.parse(facetsText);
    smaller.facets = smaller.facets.filter((f) => f.shapes[0] === 's_79');
    post('facets', JSON.stringify(smaller));
    expect(store.get().availability.seats).toHaveLength(10);
    expect(store.get().received).toEqual({ geometry: 1, facets: 2 });
  });

  it('ignores what did not come from the page itself, or is not its message', () => {
    store = createMapDataStore({ window });
    post('geometry', geometryText, { source: null }); // from another window
    window.dispatchEvent(new MessageEvent('message', { data: { kind: 'geometry', text: geometryText }, source: window })); // not ours
    window.dispatchEvent(new MessageEvent('message', { data: 'hello', source: window }));
    post('something else', geometryText);
    expect(store.get().geometry).toBeNull();
    expect(store.get().bad).toBe(0);
  });

  it('counts a message that is not what it says, and keeps what it had', () => {
    store = createMapDataStore({ window });
    post('geometry', geometryText);
    post('geometry', 'not json');
    post('facets', '{"nothing":true}');
    expect(store.get().geometry.blocks).toHaveLength(7);
    expect(store.get().bad).toBe(2);
  });

  it('shares nothing between two stores, and stops listening when destroyed', () => {
    store = createMapDataStore({ window });
    const other = createMapDataStore({ window });
    other.destroy();
    post('geometry', geometryText);
    expect(store.get().geometry).not.toBeNull();
    expect(other.get().geometry).toBeNull();
  });
});
