import { createApiSource, fetchAllPicks, fetchListPage } from '../src/content/api-source.js';
import { createCapture } from '../src/content/capture.js';
import { API_PAUSE_KEY, API_PAUSE_MS } from '../src/lib/api-pause.js';
import { peekStorage, seedStorage } from './mocks/chrome.js';

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

/** fetchAllPicks as the tests want it: no gaps between requests, tiny retry delays. */
const read = (url, options) => fetchAllPicks(url, { gapMs: () => 0, retryDelaysMs: [1, 1], refusalDelaysMs: [1, 1, 1], ...options });

describe('fetchAllPicks', () => {
  it('reads the first page, then the rest of them, in order', async () => {
    const api = fakeApi(84, 20);
    const result = await read(URL1, { fetchPage: api.fetchPage });
    expect(result.total).toBe(84);
    expect(result.picks.map((p) => p.id)).toEqual(api.all.map((p) => p.id));
    expect(api.requests.map(offsetOf).sort((a, b) => a - b)).toEqual([0, 20, 40, 60, 80]);
  });

  it('asks for the same list every time: same filters, only the offset changes', async () => {
    const api = fakeApi(60, 20);
    await read(URL1, { fetchPage: api.fetchPage });
    api.requests.forEach((url) => {
      const u = new URL(url);
      expect(u.searchParams.get('qty')).toBe('2');
      expect(u.searchParams.get('tids')).toBe('A,B');
      expect(u.searchParams.get('sort')).toBe('price');
    });
  });

  it('starts from the first page whatever offset the page happened to ask for', async () => {
    const api = fakeApi(10, 20);
    await read(URL1, { fetchPage: api.fetchPage });
    expect(api.requests.map(offsetOf)).toEqual([0]);
  });

  it('needs only one request when everything fits', async () => {
    const api = fakeApi(5, 20);
    expect((await read(URL1, { fetchPage: api.fetchPage })).picks).toHaveLength(5);
    expect(api.requests).toHaveLength(1);
  });

  it('copes with an empty list', async () => {
    const api = fakeApi(0, 20);
    expect(await read(URL1, { fetchPage: api.fetchPage })).toMatchObject({ picks: [], total: 0 });
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
    await read(URL1, { fetchPage, concurrency: 3 });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('stops asking for more pages once one has failed', async () => {
    const api = fakeApi(400, 10);
    const fetchPage = vi.fn(async (url) => {
      if (offsetOf(url) === 20) throw Object.assign(new Error('HTTP 500'), { status: 500 });
      return api.fetchPage(url);
    });
    await expect(read(URL1, { fetchPage, concurrency: 2, retryDelaysMs: [] })).rejects.toThrow('HTTP 500');
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchPage.mock.calls.length).toBeLessThan(6); // not the 40 pages of the whole list
  });

  it('reports progress', async () => {
    const api = fakeApi(60, 20);
    const seen = [];
    await read(URL1, { fetchPage: api.fetchPage, onProgress: (p) => seen.push(p) });
    expect(seen.map((p) => [p.loaded, p.total])).toEqual([[20, 60], [40, 60], [60, 60]]);
    expect(seen[0].picks.map((p) => p.id)).toEqual(api.all.slice(0, 20).map((p) => p.id)); // the picks so far, in order
    expect(seen[2].picks.map((p) => p.id)).toEqual(api.all.map((p) => p.id));
  });

  it('asks for one page at a time, a gap apart, in order (the way a person scrolling would)', async () => {
    const api = fakeApi(100, 20);
    const times = [];
    let active = 0;
    let peak = 0;
    const fetchPage = async (url) => {
      times.push([offsetOf(url), Date.now()]);
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return api.fetchPage(url);
    };
    await read(URL1, { fetchPage, gapMs: () => 40 });
    expect(peak).toBe(1);
    expect(times.map((t) => t[0])).toEqual([0, 20, 40, 60, 80]);
    for (let i = 1; i < times.length; i++) expect(times[i][1] - times[i - 1][1]).toBeGreaterThanOrEqual(35);
  });

  it('does not make the first page wait', async () => {
    const api = fakeApi(10, 20);
    const start = Date.now();
    await read(URL1, { fetchPage: api.fetchPage, gapMs: () => 500 });
    expect(Date.now() - start).toBeLessThan(200);
  });

  describe('when Ticketmaster pushes back part-way', () => {
    const refusal = (status = 403, extra = {}) => Object.assign(new Error('HTTP ' + status), { status }, extra);

    it('waits, tries that page again, and carries on', async () => {
      const api = fakeApi(80, 20);
      let refused = 0;
      const fetchPage = vi.fn(async (url) => {
        if (offsetOf(url) === 40 && refused++ === 0) throw refusal();
        return api.fetchPage(url);
      });
      const onWait = vi.fn();
      const result = await read(URL1, { fetchPage, onWait });
      expect(result.picks).toHaveLength(80);
      expect(fetchPage.mock.calls.filter(([u]) => offsetOf(u) === 40)).toHaveLength(2);
      expect(onWait).toHaveBeenCalledTimes(1);
      expect(onWait.mock.calls[0][0]).toMatch(/refused a page.*HTTP 403.*more slowly/);
    });

    it('then asks more slowly: the gap doubles after each refusal that cleared', async () => {
      const api = fakeApi(100, 20);
      let refused = 0;
      const times = {};
      const fetchPage = async (url) => {
        const offset = offsetOf(url);
        times[offset] = [...(times[offset] || []), Date.now()];
        if (offset === 20 && refused++ === 0) throw refusal();
        return api.fetchPage(url);
      };
      await read(URL1, { fetchPage, gapMs: () => 30 });
      expect(times[40][0] - times[20][1]).toBeGreaterThanOrEqual(55); // 2 x 30, not 30
    });

    it('keeps the slowdown to 4x however many times it happens', async () => {
      const api = fakeApi(140, 20);
      const refusedOnce = new Set();
      const times = {};
      const fetchPage = async (url) => {
        const offset = offsetOf(url);
        times[offset] = Date.now();
        if ([20, 40, 60].includes(offset) && !refusedOnce.has(offset)) { refusedOnce.add(offset); throw refusal(); }
        return api.fetchPage(url);
      };
      await read(URL1, { fetchPage, gapMs: () => 20 });
      expect(times[120] - times[100]).toBeLessThan(20 * 4 + 40);
    });

    it('gives up when the page stays refused, with the refusal as the error', async () => {
      const api = fakeApi(60, 20);
      const fetchPage = vi.fn(async (url) => {
        if (offsetOf(url) === 20) throw refusal(429);
        return api.fetchPage(url);
      });
      const err = await read(URL1, { fetchPage }).catch((e) => e);
      expect(err.status).toBe(429);
      expect(fetchPage.mock.calls.filter(([u]) => offsetOf(u) === 20)).toHaveLength(4); // once, then after each of 3 waits
    });

    it('does the Retry-After the response asked for rather than its own wait', async () => {
      const api = fakeApi(40, 20);
      let refused = 0;
      const stamps = [];
      const fetchPage = async (url) => {
        if (offsetOf(url) === 20) {
          stamps.push(Date.now());
          if (refused++ === 0) throw refusal(429, { retryAfterMs: 30 });
        }
        return api.fetchPage(url);
      };
      await read(URL1, { fetchPage, refusalDelaysMs: [2000] });
      expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(25);
      expect(stamps[1] - stamps[0]).toBeLessThan(500);
    });

    it('does not argue with a refusal of the first page: that is not a rate limit', async () => {
      const fetchPage = vi.fn(async () => { throw refusal(); });
      await expect(read(URL1, { fetchPage })).rejects.toThrow('HTTP 403');
      expect(fetchPage).toHaveBeenCalledTimes(1);
    });
  });

  it('stops waiting between pages as soon as it is told to stop', async () => {
    const api = fakeApi(100, 20);
    const controller = new AbortController();
    const start = Date.now();
    const run = read(URL1, { fetchPage: api.fetchPage, gapMs: () => 5000, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(run).rejects.toThrow('aborted');
    expect(Date.now() - start).toBeLessThan(500);
    expect(api.requests).toHaveLength(1);
  });

  it('refuses a list that does not add up to its total', async () => {
    const api = fakeApi(84, 20);
    const short = async (url) => { const page = await api.fetchPage(url); return offsetOf(url) === 40 ? { ...page, picks: page.picks.slice(0, 5) } : page; };
    await expect(read(URL1, { fetchPage: short })).rejects.toThrow(/got 69 of 84/);
  });

  it('drops a ticket that comes twice (a list that moved while it was read)', async () => {
    const api = fakeApi(40, 20);
    const dup = async (url) => { const page = await api.fetchPage(url); return offsetOf(url) === 20 ? { ...page, picks: [page.picks[0], page.picks[0], ...page.picks.slice(2)] } : page; };
    await expect(read(URL1, { fetchPage: dup })).rejects.toThrow(/got 39 of 40/);
  });

  it('stops when told to', async () => {
    const api = fakeApi(200, 10);
    const controller = new AbortController();
    const fetchPage = async (url) => { const r = await api.fetchPage(url); controller.abort(); return r; };
    await expect(read(URL1, { fetchPage, signal: controller.signal })).rejects.toThrow('aborted');
  });

  it('passes on the currency the response names', async () => {
    const api = fakeApi(3, 20, { currency: 'EUR' });
    expect((await read(URL1, { fetchPage: api.fetchPage })).currency).toBe('EUR');
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

  it('an error status carries the status and what the response said (headers worth knowing, the body as text)', async () => {
    const headers = new Map([['server', 'AkamaiGHost'], ['content-type', 'text/html'], ['set-cookie', 'secret=1'], ['x-reference-error', '18.abc']]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden', headers,
      text: async () => '<html><body><h1>Access Denied</h1>\n<p>Reference #18.abc.123</p></body></html>',
    });
    const err = await fetchListPage('https://x/api').catch((e) => e);
    expect(err.message).toBe('HTTP 403');
    expect(err.status).toBe(403);
    expect(err.detail.statusText).toBe('Forbidden');
    expect(err.detail.body).toBe('Access Denied Reference #18.abc.123');
    expect(err.detail.headers).toEqual(['server: AkamaiGHost', 'content-type: text/html', 'x-reference-error: 18.abc']);
  });

  it('passes on how long the response asked us to wait (at most a minute)', async () => {
    const reply = (value) => vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 429, headers: new Map(value === undefined ? [] : [['retry-after', value]]), text: async () => '' });
    reply('7');
    expect((await fetchListPage('https://x/api').catch((e) => e)).retryAfterMs).toBe(7000);
    reply('900');
    expect((await fetchListPage('https://x/api').catch((e) => e)).retryAfterMs).toBe(60000);
    reply('soon');
    expect((await fetchListPage('https://x/api').catch((e) => e)).retryAfterMs).toBeUndefined();
    reply(undefined);
    expect((await fetchListPage('https://x/api').catch((e) => e)).retryAfterMs).toBeUndefined();
  });

  it('keeps only the start of a long body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 403, headers: new Map(), text: async () => 'x'.repeat(5000) });
    const err = await fetchListPage('https://x/api').catch((e) => e);
    expect(err.detail.body).toHaveLength(300);
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
    const source = createApiSource({ onChange: changes, deps: { capture, fetchPage: api.fetchPage, retryDelaysMs: [1, 1], refusalDelaysMs: [1, 1, 1], gapMs: () => 0 } });
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
    const src = createApiSource({ deps: { capture, fetchPage, retryDelaysMs: [], gapMs: () => 0 } });
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
    const source = createApiSource({ deps: { capture, fetchPage, retryDelaysMs: [1, 1], refusalDelaysMs: [1, 1, 1], gapMs: () => 0 } });
    source.start();
    globalThis.__obs.cb({ getEntries: () => [{ name: URL1 }] });
    for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 2));
    expect(source.state().phase).toBe('ready');
    expect(calls).toBe(3);
  });

  /** A source whose fetchPage answers `answer(url)`, fed one list request; resolves when it has settled. */
  async function refused({ status = 403, pause, fetchPage } = {}) {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = fetchPage || vi.fn(async () => { throw Object.assign(new Error('HTTP ' + status), { status, detail: { statusText: 'Forbidden', headers: ['server: AkamaiGHost'], body: 'Access Denied' } }); });
    let obs;
    const capture = createCapture({ Observer: class { constructor(cb) { this.cb = cb; obs = this; } observe() {} disconnect() {} } });
    const source = createApiSource({ deps: Object.assign({ capture, fetchPage: fetch, retryDelaysMs: [1, 1], refusalDelaysMs: [1, 1, 1], gapMs: () => 0 }, pause ? { pause } : {}) });
    source.start();
    obs.cb({ getEntries: () => [{ name: URL1 }] });
    for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 2));
    return { source, fetch, obs };
  }

  it('fails, saying why, and does not hammer a list that failed', async () => {
    const { source, fetch, obs } = await refused({ status: 500 });
    expect(source.state()).toMatchObject({ phase: 'failed', error: 'HTTP 500' });
    const calls = fetch.mock.calls.length;
    obs.cb({ getEntries: () => [{ name: URL1.replace('offset=40', 'offset=60') }] }); // the same list again
    await new Promise((r) => setTimeout(r, 10));
    expect(fetch.mock.calls.length).toBe(calls);
  });

  it.each([401, 403, 429])('asks once, not again, when Ticketmaster refuses with HTTP %i', async (status) => {
    const { source, fetch } = await refused({ status });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(source.state()).toMatchObject({ phase: 'failed' });
    expect(source.state().error).toMatch(new RegExp('^HTTP ' + status + ' \\(not asking again until \\d\\d:\\d\\d\\)$'));
  });

  it('still retries an error that is not a refusal (a 503)', async () => {
    const { fetch } = await refused({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('puts what the refusal said in the console, as text', async () => {
    await refused();
    const line = console.warn.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('Could not read'));
    expect(line).toContain('HTTP 403');
    expect(line).toContain('AkamaiGHost');
    expect(line).toContain('Access Denied');
  });

  it('remembers a refusal for a quarter of an hour, in storage', async () => {
    const before = Date.now();
    await refused();
    const until = peekStorage(API_PAUSE_KEY);
    expect(until).toBeGreaterThanOrEqual(before + API_PAUSE_MS);
    expect(until).toBeLessThanOrEqual(Date.now() + API_PAUSE_MS);
  });

  it('does not ask at all while paused (a reload of the page right after a refusal)', async () => {
    seedStorage(API_PAUSE_KEY, Date.now() + 5 * 60 * 1000);
    const { source, fetch } = await refused();
    expect(fetch).not.toHaveBeenCalled();
    expect(source.state().phase).toBe('failed');
    expect(source.state().error).toMatch(/^paused until \d\d:\d\d, after Ticketmaster refused/);
  });

  it('asks again once the pause is over, and a good answer carries on as normal', async () => {
    seedStorage(API_PAUSE_KEY, Date.now() - 1000);
    const api = fakeApi(5, 20);
    const { source, fetch } = await refused({ fetchPage: vi.fn(api.fetchPage) });
    expect(fetch).toHaveBeenCalled();
    expect(source.state().phase).toBe('ready');
  });

  it('takes the pause from `deps.pause` when given one, and sets it on a refusal', async () => {
    const pause = { get: vi.fn(async () => 0), set: vi.fn(async () => {}) };
    await refused({ pause });
    expect(pause.get).toHaveBeenCalled();
    expect(pause.set).toHaveBeenCalledTimes(1);
    expect(pause.set.mock.calls[0][0]).toBeGreaterThan(Date.now());
  });

  it('has the picks read so far while it is still loading, and none once it is done', async () => {
    const api = fakeApi(45, 20);
    let release;
    const gate = new Promise((r) => { release = r; });
    const fetchPage = vi.fn(async (url) => { if (offsetOf(url) === 20) await gate; return api.fetchPage(url); });
    const capture2 = createCapture({ Observer: class { constructor(cb) { this.cb = cb; globalThis.__obs2 = this; } observe() {} disconnect() {} } });
    const s2 = createApiSource({ deps: { capture: capture2, fetchPage, retryDelaysMs: [], refusalDelaysMs: [], gapMs: () => 0 } });
    s2.start();
    globalThis.__obs2.cb({ getEntries: () => [{ name: URL1 }] });
    const settled = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 5)); };
    await settled();
    expect(s2.state()).toMatchObject({ phase: 'loading', loaded: 20, total: 45 });
    expect(s2.state().partial.map((p) => p.id)).toEqual(api.all.slice(0, 20).map((p) => p.id));
    release();
    await settled();
    expect(s2.state()).toMatchObject({ phase: 'ready', loaded: 45 });
    expect(s2.state().partial).toEqual([]);
    s2.stop();
  });

  it('pauses the API when a page stays refused part-way, after waiting for it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = fakeApi(60, 20);
    const fetchPage = vi.fn(async (url) => {
      if (offsetOf(url) === 40) throw Object.assign(new Error('HTTP 403'), { status: 403 });
      return api.fetchPage(url);
    });
    const { source } = await refused({ fetchPage });
    expect(source.state()).toMatchObject({ phase: 'failed', partial: [] });
    expect(source.state().error).toMatch(/^HTTP 403 \(not asking again until \d\d:\d\d\)$/);
    expect(fetchPage.mock.calls.filter(([u]) => offsetOf(u) === 40)).toHaveLength(4); // once, and again after each wait
    expect(peekStorage(API_PAUSE_KEY)).toBeGreaterThan(Date.now());
    expect(console.warn.mock.calls.map((c) => c.join(' ')).filter((l) => /refused a page/.test(l))).toHaveLength(3);
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
