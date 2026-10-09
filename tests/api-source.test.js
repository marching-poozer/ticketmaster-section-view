import { createApiSource, fetchAllPicks, fetchListPage } from '../src/content/api-source.js';
import { createCapture } from '../src/content/capture.js';

const URL1 = 'https://www.ticketmaster.ie/api/quickpicks/EVT/list?sort=price&offset=40&qty=2&primary=true&resale=true&tids=A%2CB';
const offsetOf = (url) => Number(new URL(url).searchParams.get('offset'));

/** A fake API of `total` picks with `size` per page; records every request. */
function fakeApi(total, size, { currency } = {}) {
  const requests = [];
  const all = Array.from({ length: total }, (_, i) => ({ id: 'p' + i, type: 'seat', section: 'S' + (i % 3), row: String(1 + (i % 9)), name: 'Full Price Ticket', originalPrice: 50 + i }));
  const fetchPage = async (url) => {
    requests.push(url);
    const offset = offsetOf(url);
    return { total, picks: all.slice(offset, offset + size), ...(currency ? { currency } : {}) };
  };
  return { fetchPage, requests, all };
}

describe('fetchAllPicks', () => {
  it('reads the first page, then the rest of them, in order', async () => {
    const api = fakeApi(84, 20);
    const result = await fetchAllPicks(URL1, { fetchPage: api.fetchPage });
    expect(result.total).toBe(84);
    expect(result.picks.map((p) => p.id)).toEqual(api.all.map((p) => p.id));
    expect(api.requests.map(offsetOf).sort((a, b) => a - b)).toEqual([0, 20, 40, 60, 80]);
  });

  it('asks for the same list every time: same filters, only the offset changes', async () => {
    const api = fakeApi(60, 20);
    await fetchAllPicks(URL1, { fetchPage: api.fetchPage });
    api.requests.forEach((url) => {
      const u = new URL(url);
      expect(u.searchParams.get('qty')).toBe('2');
      expect(u.searchParams.get('tids')).toBe('A,B');
      expect(u.searchParams.get('sort')).toBe('price');
    });
  });

  it('starts from the first page whatever offset the page happened to ask for', async () => {
    const api = fakeApi(10, 20);
    await fetchAllPicks(URL1, { fetchPage: api.fetchPage });
    expect(api.requests.map(offsetOf)).toEqual([0]);
  });

  it('needs only one request when everything fits', async () => {
    const api = fakeApi(5, 20);
    expect((await fetchAllPicks(URL1, { fetchPage: api.fetchPage })).picks).toHaveLength(5);
    expect(api.requests).toHaveLength(1);
  });

  it('copes with an empty list', async () => {
    const api = fakeApi(0, 20);
    expect(await fetchAllPicks(URL1, { fetchPage: api.fetchPage })).toMatchObject({ picks: [], total: 0 });
  });

  it('never has more than `concurrency` requests going at once', async () => {
    let active = 0;
    let peak = 0;
    const api = fakeApi(200, 10);
    const fetchPage = async (url) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return api.fetchPage(url);
    };
    await fetchAllPicks(URL1, { fetchPage, concurrency: 3 });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('reports progress', async () => {
    const api = fakeApi(60, 20);
    const seen = [];
    await fetchAllPicks(URL1, { fetchPage: api.fetchPage, onProgress: (p) => seen.push(p) });
    expect(seen[0]).toEqual({ loaded: 20, total: 60 });
    expect(seen[seen.length - 1]).toEqual({ loaded: 60, total: 60 });
  });

  it('refuses a list that does not add up to its total', async () => {
    const api = fakeApi(84, 20);
    const short = async (url) => { const page = await api.fetchPage(url); return offsetOf(url) === 40 ? { ...page, picks: page.picks.slice(0, 5) } : page; };
    await expect(fetchAllPicks(URL1, { fetchPage: short })).rejects.toThrow(/got 69 of 84/);
  });

  it('drops a ticket that comes twice (a list that moved while it was read)', async () => {
    const api = fakeApi(40, 20);
    const dup = async (url) => { const page = await api.fetchPage(url); return offsetOf(url) === 20 ? { ...page, picks: [page.picks[0], page.picks[0], ...page.picks.slice(2)] } : page; };
    await expect(fetchAllPicks(URL1, { fetchPage: dup })).rejects.toThrow(/got 39 of 40/);
  });

  it('stops when told to', async () => {
    const api = fakeApi(200, 10);
    const controller = new AbortController();
    const fetchPage = async (url) => { const r = await api.fetchPage(url); controller.abort(); return r; };
    await expect(fetchAllPicks(URL1, { fetchPage, signal: controller.signal })).rejects.toThrow('aborted');
  });

  it('passes on the currency the response names', async () => {
    const api = fakeApi(3, 20, { currency: 'EUR' });
    expect((await fetchAllPicks(URL1, { fetchPage: api.fetchPage })).currency).toBe('EUR');
  });
});

describe('fetchListPage', () => {
  const reply = (body, ok = true, status = 200) => vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok, status, json: async () => body });

  it('GETs the URL as JSON with the page\'s cookies', async () => {
    const spy = reply({ total: 1, picks: [{ id: 1 }] });
    await fetchListPage('https://x/api', undefined);
    expect(spy).toHaveBeenCalledWith('https://x/api', { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: undefined });
  });

  it('returns the body', async () => {
    reply({ total: 1, picks: [{ id: 1 }] });
    expect(await fetchListPage('https://x/api')).toEqual({ total: 1, picks: [{ id: 1 }] });
  });

  it('throws on an error status, and on a body that is not a list', async () => {
    reply({}, false, 403);
    await expect(fetchListPage('https://x/api')).rejects.toThrow('HTTP 403');
    reply({ nothing: true });
    await expect(fetchListPage('https://x/api')).rejects.toThrow(/unexpected response/);
    reply({ total: 'many', picks: [] });
    await expect(fetchListPage('https://x/api')).rejects.toThrow(/unexpected response/);
    reply(null);
    await expect(fetchListPage('https://x/api')).rejects.toThrow(/unexpected response/);
  });
});

describe('createApiSource', () => {
  function setup(total = 45, size = 20, extra = {}) {
    const api = fakeApi(total, size, extra);
    const entries = [];
    const observers = [];
    class Observer {
      constructor(cb) { this.cb = cb; observers.push(this); }
      observe() {}
      disconnect() {}
    }
    const capture = createCapture({ Observer });
    const changes = vi.fn();
    const source = createApiSource({ onChange: changes, deps: { capture, fetchPage: api.fetchPage, retryDelaysMs: [1, 1] } });
    const see = (url) => observers[0].cb({ getEntries: () => [{ name: url }] });
    const settled = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 5)); };
    return { api, capture, source, see, changes, settled, entries };
  }

  it('waits until the page has asked for its list', () => {
    const { source } = setup();
    source.start();
    expect(source.state().phase).toBe('waiting');
  });

  it('reads the whole list when the page asks for it, and turns it into tickets', async () => {
    const { source, see, settled } = setup(45, 20);
    source.start();
    see(URL1);
    expect(source.state().phase).toBe('loading');
    expect(source.state().qty).toBe(2);
    await settled();

    const state = source.state();
    expect(state.phase).toBe('ready');
    expect(state.total).toBe(45);
    expect(state.tickets).toHaveLength(45);
    expect(state.tickets[3]).toMatchObject({ source: 'api', id: 'p3', index: 3, section: 'S0', rowName: '4' });
    expect(state.picks).toHaveLength(45);
  });

  it('finds a request the page made before it started', async () => {
    const { source, capture, see, settled } = setup();
    capture.start();
    see(URL1);
    source.start();
    expect(source.state().phase).toBe('loading');
    await settled();
    expect(source.state().phase).toBe('ready');
  });

  it('tells its owner as it goes', async () => {
    const { source, see, settled, changes } = setup();
    source.start();
    see(URL1);
    await settled();
    expect(changes.mock.calls.length).toBeGreaterThanOrEqual(3); // loading, progress, ready
  });

  it('leaves the list alone when the page asks for a later page of it', async () => {
    const { source, see, settled, api } = setup(45, 20);
    source.start();
    see(URL1);
    await settled();
    const requests = api.requests.length;
    see(URL1.replace('offset=40', 'offset=60'));
    see(URL1.replace('sort=price', 'sort=quality'));
    await settled();
    expect(api.requests).toHaveLength(requests);
    expect(source.state().phase).toBe('ready');
  });

  it('reads again when the quantity changes, dropping the old tickets at once', async () => {
    const { source, see, settled, api } = setup(45, 20);
    source.start();
    see(URL1);
    await settled();
    const before = api.requests.length;

    see(URL1.replace('qty=2', 'qty=3'));
    expect(source.state()).toMatchObject({ phase: 'loading', qty: 3, tickets: [] });
    await settled();
    expect(source.state()).toMatchObject({ phase: 'ready', qty: 3 });
    expect(api.requests.length).toBeGreaterThan(before);
  });

  it('abandons a read that is overtaken by a new list', async () => {
    const slow = fakeApi(45, 20);
    const { source, see, settled, capture } = setup();
    let release;
    const gate = new Promise((r) => { release = r; });
    const seenQty = [];
    const fetchPage = async (url) => { seenQty.push(new URL(url).searchParams.get('qty')); if (new URL(url).searchParams.get('qty') === '2') await gate; return slow.fetchPage(url); };
    const src = createApiSource({ deps: { capture, fetchPage, retryDelaysMs: [] } });
    src.start();
    see(URL1);
    see(URL1.replace('qty=2', 'qty=3'));
    release();
    await settled();
    expect(src.state()).toMatchObject({ phase: 'ready', qty: 3 });
    src.stop();
  });

  it('retries a failed read a couple of times before giving up', async () => {
    const api = fakeApi(10, 20);
    let calls = 0;
    const fetchPage = async (url) => { if (++calls < 3) throw new Error('HTTP 503'); return api.fetchPage(url); };
    const capture = createCapture({ Observer: class { constructor(cb) { this.cb = cb; globalThis.__obs = this; } observe() {} disconnect() {} } });
    const source = createApiSource({ deps: { capture, fetchPage, retryDelaysMs: [1, 1] } });
    source.start();
    globalThis.__obs.cb({ getEntries: () => [{ name: URL1 }] });
    for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 2));
    expect(source.state().phase).toBe('ready');
    expect(calls).toBe(3);
  });

  it('fails, saying why, and does not hammer a list that failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchPage = vi.fn(async () => { throw new Error('HTTP 403'); });
    let obs;
    const capture = createCapture({ Observer: class { constructor(cb) { this.cb = cb; obs = this; } observe() {} disconnect() {} } });
    const source = createApiSource({ deps: { capture, fetchPage, retryDelaysMs: [1] } });
    source.start();
    obs.cb({ getEntries: () => [{ name: URL1 }] });
    for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 2));
    expect(source.state()).toMatchObject({ phase: 'failed', error: 'HTTP 403' });
    const calls = fetchPage.mock.calls.length;
    obs.cb({ getEntries: () => [{ name: URL1.replace('offset=40', 'offset=60') }] }); // the same list again
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchPage.mock.calls.length).toBe(calls);
  });

  it('does nothing when stopped, and can be started again', async () => {
    const { source, see, settled } = setup();
    source.start();
    source.stop();
    see(URL1);
    await settled();
    expect(source.state().phase).toBe('waiting');
    source.start();
    see(URL1);
    await settled();
    expect(source.state().phase).toBe('ready');
  });

  it('can read the page\'s list again on request', async () => {
    const { source, see, settled, api } = setup(45, 20);
    source.start();
    see(URL1);
    await settled();
    const before = api.requests.length;
    source.reload();
    await settled();
    expect(api.requests.length).toBeGreaterThan(before);
    expect(source.state().phase).toBe('ready');
  });
});
