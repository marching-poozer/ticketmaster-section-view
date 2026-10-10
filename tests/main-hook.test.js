// The script that runs in the page's own world and hands the extension the seat map's data (see src/content/main-hook.js).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = fs.readFileSync(path.resolve(process.cwd(), 'src/content/main-hook.js'), 'utf8');
const GEOMETRY_URL = 'https://mapsapi.tmol.co/maps/geometry/3/event/380064F5B47C10D0/placeDetailNoKeys?systemId=HOST_UK&useHostGrids=true&app=PRD1741_ICCP-FE';
const FACETS_URL = 'https://services.ticketmaster.ie/api/ismds/host/380064F5B47C10D0/facets?q=available&oq=&by=shape+attributes&show=places&apikey=KEY&apisecret=SECRET&compress=places';
const NARROW_FACETS_URL = 'https://services.ticketmaster.ie/api/ismds/host/380064F5B47C10D0/facets?q=available&by=shape&show=counts&apikey=KEY';

const response = (text, ok = true) => ({ ok, status: ok ? 200 : 403, text: () => Promise.resolve(text), clone() { return response(text, ok); } });
const installHook = () => window.eval(source);
// (jsdom's postMessage does not say who sent it, as a browser does: so the extension's hello is dispatched by hand)
const hello = () => window.dispatchEvent(new MessageEvent('message', { data: { __tmsv: 1, kind: 'hello' }, source: window }));
const nextMessages = (ms = 20) => new Promise((resolve) => {
  const seen = [];
  const on = (e) => { if (e.data && e.data.__tmsv === 1) seen.push(e.data); };
  window.addEventListener('message', on);
  setTimeout(() => { window.removeEventListener('message', on); resolve(seen); }, ms);
});

let realFetch;
let realXhr;
let realAdd;
let added;
beforeEach(() => {
  realFetch = window.fetch;
  realXhr = window.XMLHttpRequest;
  delete window.__tmsvMainHook;
  // (one hook per page in life; here each test installs its own, so take its message listener away again afterwards)
  added = [];
  realAdd = window.addEventListener;
  window.addEventListener = function (type, fn, ...rest) {
    if (type === 'message') added.push(fn);
    return realAdd.call(this, type, fn, ...rest);
  };
});
afterEach(() => {
  window.addEventListener = realAdd;
  added.forEach((fn) => window.removeEventListener('message', fn));
  window.fetch = realFetch;
  window.XMLHttpRequest = realXhr;
  delete window.__tmsvMainHook;
});

describe('the page-world hook: fetch', () => {
  it('hands over the geometry and the seats on sale as the page receives them, and the page gets its response as ever', async () => {
    const original = vi.fn((url) => Promise.resolve(response(url.includes('placeDetail') ? '{"pages":[]}' : '{"facets":[]}')));
    window.fetch = original;
    installHook();
    const seen = nextMessages();
    const a = await window.fetch(GEOMETRY_URL);
    const b = await window.fetch(FACETS_URL, { credentials: 'include' });
    expect(await a.text()).toBe('{"pages":[]}'); // the page's own response is untouched
    expect(await b.text()).toBe('{"facets":[]}');
    expect(original).toHaveBeenCalledTimes(2);
    expect(original.mock.calls[1][1]).toEqual({ credentials: 'include' }); // with the page's own arguments
    expect((await seen).map((m) => [m.kind, m.text])).toEqual([['geometry', '{"pages":[]}'], ['facets', '{"facets":[]}']]);
  });

  it('does not pass the URL on (it has the page\'s API key)', async () => {
    window.fetch = vi.fn(() => Promise.resolve(response('{}')));
    installHook();
    const seen = nextMessages();
    await window.fetch(FACETS_URL);
    const messages = await seen;
    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0])).not.toMatch(/KEY|SECRET|apikey|http/);
  });

  it('leaves every other request alone, a narrower facets request included', async () => {
    window.fetch = vi.fn(() => Promise.resolve(response('{}')));
    installHook();
    const seen = nextMessages();
    await window.fetch('https://www.ticketmaster.ie/api/quickpicks/380064F5B47C10D0/list?qty=2');
    await window.fetch(NARROW_FACETS_URL);
    await window.fetch('https://example.com/x');
    expect(await seen).toEqual([]);
  });

  it('passes a Request object through too', async () => {
    window.fetch = vi.fn(() => Promise.resolve(response('{"a":1}')));
    installHook();
    const seen = nextMessages();
    await window.fetch({ url: GEOMETRY_URL });
    expect((await seen).map((m) => m.kind)).toEqual(['geometry']);
  });

  it('says nothing about a response that is not ok', async () => {
    window.fetch = vi.fn(() => Promise.resolve(response('{}', false)));
    installHook();
    const seen = nextMessages();
    await window.fetch(FACETS_URL);
    expect(await seen).toEqual([]);
  });

  it('never gets in the way of a request that fails: the page sees the failure as ever', async () => {
    window.fetch = vi.fn(() => Promise.reject(new Error('offline')));
    installHook();
    const seen = nextMessages();
    await expect(window.fetch(GEOMETRY_URL)).rejects.toThrow('offline');
    expect(await seen).toEqual([]);
  });

  it('does not wrap twice if the script runs twice', async () => {
    const original = vi.fn(() => Promise.resolve(response('{}')));
    window.fetch = original;
    installHook();
    const once = window.fetch;
    installHook();
    expect(window.fetch).toBe(once);
    const seen = nextMessages();
    await window.fetch(GEOMETRY_URL);
    expect(await seen).toHaveLength(1);
  });
});

describe('the page-world hook: when the extension was not listening yet', () => {
  it('says what it heard again when asked (the extension\'s modules load a little after the page starts)', async () => {
    window.fetch = vi.fn(() => Promise.resolve(response('{"x":1}')));
    installHook();
    await window.fetch(GEOMETRY_URL);
    await window.fetch(FACETS_URL);
    await nextMessages(); // (nobody was listening)
    const seen = nextMessages();
    hello();
    expect((await seen).filter((m) => m.kind !== 'hello').map((m) => [m.kind, m.text]).sort()).toEqual([['facets', '{"x":1}'], ['geometry', '{"x":1}']]);
  });

  it('keeps only the latest of each', async () => {
    let n = 0;
    window.fetch = vi.fn(() => Promise.resolve(response('{"n":' + (n += 1) + '}')));
    installHook();
    await window.fetch(FACETS_URL);
    await window.fetch(FACETS_URL);
    await nextMessages();
    const seen = nextMessages();
    hello();
    expect((await seen).filter((m) => m.kind === 'facets').map((m) => m.text)).toEqual(['{"n":2}']);
  });

  it('has nothing to say if it has heard nothing, and does not answer other messages', async () => {
    window.fetch = vi.fn(() => Promise.resolve(response('{}')));
    installHook();
    const seen = nextMessages();
    hello();
    window.dispatchEvent(new MessageEvent('message', { data: { something: 'else' }, source: window }));
    window.dispatchEvent(new MessageEvent('message', { data: { __tmsv: 1, kind: 'hello' }, source: null })); // not from this window
    expect((await seen).filter((m) => m.kind !== 'hello')).toEqual([]);
  });
});

describe('the page-world hook: XMLHttpRequest', () => {
  // (a new class each time: the hook wraps the prototype it finds)
  const fakeXhr = () => class FakeXhr {
    constructor() { this.listeners = {}; this.status = 200; this.responseType = ''; this.responseText = ''; this.response = null; }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    open(method, url) { this.opened = [method, url]; }
    send() { this.sent = true; }
    finish() { (this.listeners.load || []).forEach((fn) => fn()); }
  };

  it('hands over the text of a response read the old way, and does not touch the request', async () => {
    window.XMLHttpRequest = fakeXhr();
    installHook();
    const xhr = new window.XMLHttpRequest();
    const seen = nextMessages();
    xhr.open('GET', FACETS_URL);
    xhr.send();
    expect(xhr.opened).toEqual(['GET', FACETS_URL]);
    expect(xhr.sent).toBe(true);
    xhr.responseText = '{"facets":[]}';
    xhr.finish();
    expect((await seen).map((m) => [m.kind, m.text])).toEqual([['facets', '{"facets":[]}']]);
  });

  it('reads a JSON response type, and ignores failures and other requests', async () => {
    window.XMLHttpRequest = fakeXhr();
    installHook();
    const seen = nextMessages();
    const json = new window.XMLHttpRequest();
    json.open('GET', GEOMETRY_URL);
    json.responseType = 'json';
    json.send();
    json.response = { pages: [] };
    json.finish();
    const failed = new window.XMLHttpRequest();
    failed.open('GET', FACETS_URL);
    failed.send();
    failed.status = 403;
    failed.responseText = 'no';
    failed.finish();
    const other = new window.XMLHttpRequest();
    other.open('GET', 'https://example.com/a');
    other.send();
    other.responseText = '{}';
    other.finish();
    expect((await seen).map((m) => [m.kind, m.text])).toEqual([['geometry', '{"pages":[]}']]);
  });
});
