// The page reader taking its tickets from Ticketmaster's list API (see api-source.js), checking them
// against the cards on the page, and falling back to scrolling when it can't.
import { createPageReader } from '../src/content/page-reader.js';
import { addCards, addLoadedLabel, makeCard } from './helpers/cards.js';

let reader;

afterEach(() => {
  if (reader) reader.stop();
  reader = null;
});

const pick = (section, row, price, extra = {}) => ({
  id: `${section}-${row}-${price}-${extra.n ?? ''}`,
  type: 'seat',
  section,
  row: String(row),
  seatFrom: '10',
  seatTo: '11',
  name: 'Full Price Ticket',
  originalPrice: price,
  quality: 0.5,
  attributes: [],
  ...extra,
});

/** An API source whose state the test controls. */
function fakeApi(initial = {}) {
  let state = { phase: 'waiting', signature: 'sig', qty: 1, loaded: 0, total: 0, tickets: [], picks: [], currency: '', error: null, ...initial };
  const source = { start: vi.fn(), stop: vi.fn(), reload: vi.fn(), state: () => state };
  return { source, set: (next) => { state = { ...state, ...next }; } };
}

function setup(api, options = {}) {
  const onSnapshot = vi.fn();
  reader = createPageReader({ onSnapshot, deps: { apiSource: api.source }, ...options });
  return { reader, onSnapshot, last: () => onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1][0] };
}

const settle = (ms = 300) => vi.advanceTimersByTimeAsync(ms);
/** Something changed on the page: have the reader look again. */
async function poke(ms = 300) {
  document.body.append(document.createElement('i'));
  await settle(ms);
}

function pageCards() {
  addLoadedLabel(3, 84);
  return addCards({ section: 'BLOCKG', row: 26, price: 80.75 }, { section: 'BLOCKG', row: 27, price: 80.75 }, { section: 'BLOCKA', row: 3, price: 130 });
}
const matchingPicks = () => [pick('BLOCKG', 26, 80.75), pick('BLOCKG', 27, 80.75), pick('BLOCKA', 3, 130), pick('BLOCKB', 12, 99), pick('BLOCKB', 13, 99)];

describe('while the API is being read', () => {
  it('starts reading it, and stops when stopped', () => {
    const api = fakeApi();
    const { reader } = setup(api);
    reader.start();
    expect(api.source.start).toHaveBeenCalled();
    reader.stop();
    expect(api.source.stop).toHaveBeenCalled();
  });

  it('shows the cards on the page meanwhile, not as complete, and does not scroll the page\'s list', async () => {
    vi.useFakeTimers();
    pageCards();
    const api = fakeApi({ phase: 'loading', loaded: 20, total: 84 });
    const { reader, last } = setup(api);
    reader.start();
    await settle(2000);

    expect(last().source).toBe('scroll');
    expect(last().tickets).toHaveLength(3);
    expect(last().status).toEqual({ loaded: 20, total: 84, isComplete: false });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  describe('part-way through a long list', () => {
    it('shows the tickets read so far, not as complete, once they agree with the cards', async () => {
      vi.useFakeTimers();
      pageCards();
      const api = fakeApi({ phase: 'loading', loaded: 5, total: 84, partial: matchingPicks() });
      const { reader, last } = setup(api);
      reader.start();
      await settle(2000);

      expect(last().source).toBe('api');
      expect(last().viaApi).toBe(true);
      expect(last().tickets).toHaveLength(5);
      expect(last().tickets.map((t) => t.section)).toContain('BLOCKB'); // not on the page yet: only the API has it
      expect(last().status).toEqual({ loaded: 5, total: 84, isComplete: false });
      expect(window.scrollTo).not.toHaveBeenCalled();
    });

    it('grows as more of the list is read', async () => {
      vi.useFakeTimers();
      pageCards();
      const api = fakeApi({ phase: 'loading', loaded: 3, total: 84, partial: matchingPicks().slice(0, 3) });
      const { reader, last } = setup(api);
      reader.start();
      await settle(2000);
      expect(last().tickets).toHaveLength(3);
      api.set({ loaded: 5, partial: matchingPicks() });
      await poke();
      expect(last().tickets).toHaveLength(5);
      expect(last().status.isComplete).toBe(false);
    });

    it('keeps showing the cards while what has been read disagrees with them, and does not give up on that', async () => {
      vi.useFakeTimers();
      pageCards();
      const wrong = matchingPicks().map((p) => ({ ...p, originalPrice: p.originalPrice + 1 }));
      const api = fakeApi({ phase: 'loading', loaded: 5, total: 84, partial: wrong });
      const { reader, last } = setup(api);
      reader.start();
      await settle(10000);
      expect(last().source).toBe('scroll');
      expect(last().tickets).toHaveLength(3);
      expect(last().fallback).toBe(null);
    });

    it('shows nothing from a list for a quantity the page has left', async () => {
      vi.useFakeTimers();
      pageCards();
      const api = fakeApi({ phase: 'loading', qty: 5, loaded: 5, total: 84, partial: matchingPicks() });
      const { reader, last } = setup(api);
      reader.start();
      await settle(2000);
      expect(last().source).toBe('scroll');
      expect(last().tickets).toHaveLength(3);
    });

    it('waits for the cards before showing unchecked tickets', async () => {
      vi.useFakeTimers();
      const api = fakeApi({ phase: 'loading', loaded: 5, total: 84, partial: matchingPicks() });
      const { reader, last } = setup(api);
      reader.start();
      await settle(500);
      expect(last().tickets).toHaveLength(0);
    });

    it('selects the right one of identical tickets while the rest is still loading', async () => {
      vi.useFakeTimers();
      const cards = addCards({ section: 'A', row: 5, price: 50 }, { section: 'A', row: 5, price: 50 });
      addLoadedLabel(2, 84);
      const twins = [pick('A', 5, 50, { n: 1 }), pick('A', 5, 50, { n: 2 })];
      const api = fakeApi({ phase: 'loading', loaded: 2, total: 84, partial: twins });
      const { reader, last } = setup(api);
      const clicks = [];
      cards.forEach((c, i) => c.addEventListener('click', () => clicks.push(i)));
      reader.start();
      await settle(2000);
      expect(last().tickets).toHaveLength(2);
      await reader.clickTicket(last().tickets[1]);
      expect(clicks).toEqual([1]);
    });
  });

  it('does not call the page complete just because it has not seen the request yet', async () => {
    vi.useFakeTimers();
    addLoadedLabel(3, 3);
    addCards({ section: 'A', row: 1, price: 50 });
    const { reader, last } = setup(fakeApi());
    reader.start();
    await settle(500);
    expect(last().status.isComplete).toBe(false);
  });
});

describe('once the API has been read', () => {
  it('shows its tickets, as complete, once they agree with the cards', async () => {
    vi.useFakeTimers();
    pageCards();
    const api = fakeApi({ phase: 'ready', total: 5, picks: matchingPicks() });
    const { reader, last } = setup(api);
    reader.start();
    await settle();

    expect(last().source).toBe('api');
    expect(last().status).toEqual({ loaded: 5, total: 5, isComplete: true });
    expect(last().tickets).toHaveLength(5);
    expect(last().tickets[0]).toMatchObject({ source: 'api', section: 'BLOCKG', rowName: '26', seat: '10-11', quality: 0.5 });
    expect(last().tickets.every((t) => !t.element)).toBe(true);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('takes the currency from the cards when the API does not say', async () => {
    vi.useFakeTimers();
    addLoadedLabel(1, 2);
    document.body.append(makeCard({ section: 'A', row: 1, price: 50, currency: '£' }));
    const api = fakeApi({ phase: 'ready', total: 2, picks: [pick('A', 1, 50), pick('A', 2, 60)] });
    const { reader, last } = setup(api);
    reader.start();
    await settle();
    expect(last().tickets.map((t) => t.currency)).toEqual(['£', '£']);
    expect(last().tickets[0].text).toContain('£50.00 each');
  });

  it('uses the currency the API names when there are no cards to say', async () => {
    vi.useFakeTimers();
    const api = fakeApi({ phase: 'ready', total: 1, currency: 'GBP', picks: [pick('A', 1, 50)] });
    const { reader, last } = setup(api);
    reader.start();
    await settle();
    expect(last().source).toBe('scroll'); // nothing to check them against yet
    expect(last().tickets).toHaveLength(0);
  });

  it('waits for the page\'s cards before trusting it, rather than showing unchecked tickets', async () => {
    vi.useFakeTimers();
    const api = fakeApi({ phase: 'ready', total: 5, picks: matchingPicks() });
    const { reader, last } = setup(api);
    reader.start();
    await settle(1000);
    expect(last().source).toBe('scroll');

    addLoadedLabel(3, 84);
    addCards({ section: 'BLOCKG', row: 26, price: 80.75 });
    await settle();
    expect(last().source).toBe('api');
  });

  it('lists the VIP packages from the API, and does not touch Ticketmaster\'s own VIP row', async () => {
    vi.useFakeTimers();
    pageCards();
    document.body.insertAdjacentHTML('beforeend', '<div data-testid="quickpicksList"><div><button><svg class="StarCircledFilledIcon___X"></svg><span><span>VIP Packages</span><span>€100.00 each</span></span><span>Show Tickets</span></button></div></div>');
    const pressed = vi.fn();
    document.querySelector('[data-testid="quickpicksList"] button').addEventListener('click', pressed);
    const api = fakeApi({ phase: 'ready', total: 6, picks: [...matchingPicks(), pick('BLOCKE', 1, 253.65, { name: 'Trivium Meet & Greet Package' })] });
    const { reader, last } = setup(api);
    reader.start();
    await settle();
    expect(last().tickets.some((t) => t.type === 'vip')).toBe(true);
    expect(last()).not.toHaveProperty('vip');
    expect(pressed).not.toHaveBeenCalled(); // only selecting a package needs the row open
  });

  it('opens Ticketmaster\'s VIP row once it is the cards being read (the API could not be used)', async () => {
    vi.useFakeTimers();
    pageCards();
    document.body.insertAdjacentHTML('beforeend', '<div data-testid="quickpicksList"><div><button><svg class="StarCircledFilledIcon___X"></svg><span><span>VIP Packages</span><span>€100.00 each</span></span><span>Show Tickets</span></button></div></div>');
    const pressed = vi.fn();
    document.querySelector('[data-testid="quickpicksList"] button').addEventListener('click', pressed);
    Array.from(document.querySelectorAll('span, div')).filter((e) => !e.children.length && /^Loaded \d+ of \d+$/.test(e.textContent.trim())).forEach((e) => { e.textContent = 'Loaded 84 of 84'; });
    const api = fakeApi({ phase: 'loading', loaded: 20, total: 84 });
    const { reader } = setup(api);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    reader.start();
    await settle(500);
    expect(pressed).not.toHaveBeenCalled(); // still hoping to read the API

    api.set({ phase: 'failed', error: 'HTTP 403' });
    await poke();
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it('keeps showing the same tickets without telling the app again', async () => {
    vi.useFakeTimers();
    pageCards();
    const api = fakeApi({ phase: 'ready', total: 5, picks: matchingPicks() });
    const { reader, onSnapshot } = setup(api);
    reader.start();
    await settle();
    const calls = onSnapshot.mock.calls.length;
    await poke();
    await poke();
    expect(onSnapshot.mock.calls.length).toBe(calls);
  });
});

describe('when the API cannot be used', () => {
  it('falls back to scrolling at once if reading it failed', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    pageCards();
    const api = fakeApi({ phase: 'failed', error: 'HTTP 403' });
    const { reader, last } = setup(api);
    reader.start();
    await settle(700);

    expect(reader.sourceInfo()).toEqual({ mode: 'api', using: 'scroll', gaveUp: 'reading it failed: HTTP 403' });
    expect(api.source.stop).toHaveBeenCalled();
    expect(window.scrollTo).toHaveBeenCalled(); // scrolling the list again
    expect(last().source).toBe('scroll');
    expect(last().fallback).toBe('reading it failed: HTTP 403'); // passed on, so the view can say why
    expect(last().tickets).toHaveLength(3);
  });

  it('falls back to scrolling if the page is never seen asking for its list', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pageCards();
    const { reader } = setup(fakeApi());
    reader.start();
    await settle(2500);
    expect(reader.sourceInfo().using).toBe('api');
    expect(window.scrollTo).not.toHaveBeenCalled();

    await settle(1500);
    expect(reader.sourceInfo().using).toBe('scroll');
    expect(reader.sourceInfo().gaveUp).toContain('not seen');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('scrolling the list instead'));
    await settle(700);
    expect(window.scrollTo).toHaveBeenCalled();
  });

  it('does not give up waiting on a page that has no tickets at all', async () => {
    vi.useFakeTimers();
    const { reader } = setup(fakeApi());
    reader.start();
    await settle(10000);
    expect(reader.sourceInfo().using).toBe('api');
  });

  it('falls back when the tickets disagree with the cards for too long, saying how', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pageCards();
    const api = fakeApi({ phase: 'ready', total: 3, picks: [pick('BLOCKG', 26, 70), pick('BLOCKG', 27, 70), pick('BLOCKA', 3, 100)] }); // prices are not the displayed prices
    const { reader, last } = setup(api);
    reader.start();
    await settle(2000);
    expect(last().source).toBe('scroll');
    expect(reader.sourceInfo().using).toBe('api'); // still giving the page time to catch up

    await settle(3000);
    expect(reader.sourceInfo().using).toBe('scroll');
    expect(reader.sourceInfo().gaveUp).toMatch(/disagrees with the page: 3 of 3 cards have no matching ticket, e\.g\. BLOCKG\|26\|80\.75\|primary/);
    expect(warn).toHaveBeenCalled();
    // ...and says what the API had where the page has something else, as text that can be copied from the console
    const detail = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes('For the cards it could not match'));
    expect(detail).toBeDefined();
    const parsed = JSON.parse(detail.slice(detail.indexOf('{')));
    expect(parsed.shape).toMatchObject({ count: 3, types: { seat: 3 } });
    expect(parsed.unmatched[0].card).toBe('BLOCKG|26|80.75|primary');
    expect(parsed.unmatched[0].picks.map((p) => p.originalPrice)).toContain(70); // the API's price for that section and row
    expect(last().source).toBe('scroll');
  });

  it('gives the page time to catch up: a list that agrees after a moment is fine', async () => {
    vi.useFakeTimers();
    addLoadedLabel(1, 84);
    addCards({ section: 'OLD', row: 1, price: 10 }); // the page still has the previous list's cards
    const api = fakeApi({ phase: 'ready', total: 5, picks: matchingPicks() });
    const { reader, last } = setup(api);
    reader.start();
    await settle(2000);
    expect(last().source).toBe('scroll');

    document.body.innerHTML = '';
    pageCards();
    await settle(500);
    expect(last().source).toBe('api');
    expect(reader.sourceInfo().using).toBe('api');
  });

  it('ignores tickets for a quantity the page is no longer on', async () => {
    vi.useFakeTimers();
    pageCards();
    document.body.insertAdjacentHTML('beforeend', '<div role="spinbutton" aria-valuenow="3"></div>');
    const api = fakeApi({ phase: 'ready', qty: 2, total: 5, picks: matchingPicks() });
    const { reader, last } = setup(api);
    reader.start();
    await settle();
    expect(last().source).toBe('scroll');
    expect(last().qty).toBe(3);
    expect(reader.sourceInfo().using).toBe('api');

    api.set({ qty: 3 });
    await poke();
    expect(last().source).toBe('api');
  });

  it('goes back to the cards while a changed list is read again', async () => {
    vi.useFakeTimers();
    pageCards();
    const api = fakeApi({ phase: 'ready', total: 5, picks: matchingPicks() });
    const { reader, last } = setup(api);
    reader.start();
    await settle();
    expect(last().source).toBe('api');

    api.set({ phase: 'loading', signature: 'sig2', loaded: 0, total: 0, tickets: [], picks: [] });
    await poke();
    expect(last().source).toBe('scroll');
    expect(last().status.isComplete).toBe(false);
  });
});

describe('choosing how to load', () => {
  it('can be told to scroll instead, and back', async () => {
    vi.useFakeTimers();
    pageCards();
    const api = fakeApi({ phase: 'ready', total: 5, picks: matchingPicks() });
    const { reader, last } = setup(api);
    reader.start();
    await settle();
    expect(last().source).toBe('api');

    reader.setLoadMode('scroll');
    await settle(700);
    expect(api.source.stop).toHaveBeenCalled();
    expect(last().source).toBe('scroll');
    expect(window.scrollTo).toHaveBeenCalled();

    api.source.start.mockClear();
    reader.setLoadMode('api');
    expect(api.source.start).toHaveBeenCalled();
    await settle();
    expect(last().source).toBe('api');
  });

  it('starts in the mode it is given', () => {
    const api = fakeApi();
    const { reader } = setup(api, { loadMode: 'scroll' });
    reader.start();
    expect(api.source.start).not.toHaveBeenCalled();
    expect(reader.sourceInfo()).toMatchObject({ mode: 'scroll', using: 'scroll' });
  });

  it('ignores a mode it does not know', () => {
    const { reader } = setup(fakeApi());
    reader.setLoadMode('telepathy');
    expect(reader.sourceInfo().mode).toBe('api');
  });

  it('tries the API again when restarted, even after giving up once', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    pageCards();
    const api = fakeApi({ phase: 'failed', error: 'x' });
    const { reader } = setup(api);
    reader.start();
    await settle();
    expect(reader.sourceInfo().using).toBe('scroll');
    reader.stop();
    api.source.start.mockClear();
    reader.start();
    expect(api.source.start).toHaveBeenCalled();
  });
});

describe('selecting a ticket the API listed', () => {
  async function ready(cardOpts, picks) {
    vi.useFakeTimers();
    addLoadedLabel(cardOpts.length, picks.length);
    const cards = addCards(...cardOpts);
    const api = fakeApi({ phase: 'ready', total: picks.length, picks });
    const made = setup(api);
    made.reader.start();
    await settle();
    expect(made.last().source).toBe('api');
    return { ...made, cards, api };
  }
  const clicks = (card) => {
    const fn = vi.fn();
    card.addEventListener('click', fn);
    return fn;
  };

  it('clicks its card, exactly once, found by section, row and price', async () => {
    const { reader, last, cards } = await ready(
      [{ section: 'BLOCKG', row: 26, price: 80.75 }, { section: 'BLOCKA', row: 3, price: 130 }],
      [pick('BLOCKG', 26, 80.75), pick('BLOCKA', 3, 130), pick('BLOCKB', 9, 50)]
    );
    const click = clicks(cards[1]);
    const other = clicks(cards[0]);
    await reader.clickTicket(last().tickets[1], { scroll: false });
    expect(click).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('tells identical tickets apart by their order', async () => {
    const same = { section: 'BLOCKG', row: 26, price: 80.75 };
    const { reader, last, cards } = await ready([same, same, same], [pick('BLOCKG', 26, 80.75, { n: 1 }), pick('BLOCKG', 26, 80.75, { n: 2 }), pick('BLOCKG', 26, 80.75, { n: 3 })]);
    const spies = cards.map(clicks);
    await reader.clickTicket(last().tickets[2], { scroll: false });
    expect(spies.map((s) => s.mock.calls.length)).toEqual([0, 0, 1]);
    await reader.clickTicket(last().tickets[0], { scroll: false });
    expect(spies.map((s) => s.mock.calls.length)).toEqual([1, 0, 1]);
  });

  it('scrolls the page\'s list until the ticket\'s card has loaded, then clicks it', async () => {
    const { reader, last } = await ready(
      [{ section: 'BLOCKG', row: 26, price: 80.75 }],
      [pick('BLOCKG', 26, 80.75), pick('BLOCKB', 12, 99), pick('BLOCKB', 13, 99)]
    );
    // each scroll loads another card, like the page's own list
    const more = [{ section: 'BLOCKB', row: 12, price: 99 }, { section: 'BLOCKB', row: 13, price: 99 }];
    let loaded = null;
    window.scrollTo.mockImplementation(() => {
      const next = more.shift();
      if (next) {
        loaded = makeCard(next);
        document.body.append(loaded);
      }
    });
    const click = vi.fn();
    document.body.addEventListener('click', click, true);

    const promise = reader.clickTicket(last().tickets[2], { scroll: false });
    await settle(3000);
    await promise;

    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.calls[0][0].target.getAttribute('aria-label')).toContain('row 13');
  });

  it('lets the host get the list ready first and put things back afterwards, even if the card never comes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { reader, last } = await ready([{ section: 'A', row: 1, price: 10 }], [pick('A', 1, 10), pick('GONE', 9, 99)]);
    const order = [];
    reader.setLoadHooks({ before: async () => { order.push('before'); }, after: async () => { order.push('after'); } });
    window.scrollTo.mockImplementation(() => order.push('scroll'));
    const click = vi.fn();
    document.body.addEventListener('click', click, true);

    const promise = reader.clickTicket(last().tickets[1], { scroll: false });
    await settle(20000);
    await promise;

    expect(order[0]).toBe('before');
    expect(order[order.length - 1]).toBe('after');
    expect(order.filter((x) => x === 'scroll').length).toBeGreaterThan(3);
    expect(click).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no longer on the page'), expect.anything());
  });

  it('stops looking once the page says everything has loaded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { reader, last } = await ready([{ section: 'A', row: 1, price: 10 }], [pick('A', 1, 10), pick('GONE', 9, 99)]);
    document.querySelector('.sc-bb065817-4').textContent = 'Loaded 2 of 2';
    window.scrollTo.mockClear();
    const promise = reader.clickTicket(last().tickets[1], { scroll: false });
    await settle(5000);
    await promise;
    expect(window.scrollTo.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('ignores a second click while the first is still finding its card', async () => {
    const { reader, last } = await ready([{ section: 'A', row: 1, price: 10 }], [pick('A', 1, 10), pick('B', 2, 20), pick('C', 3, 30)]);
    const before = vi.fn(async () => {});
    reader.setLoadHooks({ before });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = reader.clickTicket(last().tickets[1], { scroll: false });
    const second = reader.clickTicket(last().tickets[2], { scroll: false });
    await settle(20000);
    await Promise.all([first, second]);
    expect(before).toHaveBeenCalledTimes(1);
  });

  it('scrolls the card into view when asked to, like before', async () => {
    const { reader, last, cards } = await ready([{ section: 'A', row: 1, price: 10 }], [pick('A', 1, 10)]);
    await reader.clickTicket(last().tickets[0], { scroll: true });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    void cards;
  });
});

describe('selecting a VIP package the API listed', () => {
  const vipPick = pick('BLOCKE', 1, 253.65, { name: 'Trivium Meet & Greet Package', n: 'vip' });

  /** The page: one ordinary card, and Ticketmaster's "VIP Packages" row, which adds the package cards when pressed. */
  function pageWithVipRow({ expanded = false } = {}) {
    addLoadedLabel(1, 2);
    addCards({ section: 'BLOCKG', row: 26, price: 80.75 });
    const list = document.createElement('div');
    list.setAttribute('data-testid', 'quickpicksList');
    list.innerHTML = '<button><svg class="StarCircledFilledIcon___StyledBaseSvg-sc-qrtrcy-0"></svg><span>VIP Packages</span><span>€253.65 each</span></button>';
    document.body.append(list);
    const pressed = vi.fn();
    const addPackage = () => list.append(makeCard({ section: 'BLOCKE', row: 1, price: 253.65, packageTitle: 'Trivium Meet & Greet Package', vipIcon: true }));
    list.querySelector('button').addEventListener('click', () => {
      pressed();
      addPackage();
    });
    if (expanded) addPackage();
    return { list, pressed };
  }

  async function ready() {
    vi.useFakeTimers();
    const api = fakeApi({ phase: 'ready', total: 2, picks: [pick('BLOCKG', 26, 80.75), vipPick] });
    const made = setup(api);
    made.reader.start();
    await settle();
    return made;
  }
  const vipTicket = (last) => last().tickets.find((t) => t.type === 'vip');

  it('presses the VIP Packages row to bring its card into the page, then selects it, once', async () => {
    const { pressed } = pageWithVipRow();
    const { reader, last } = await ready();
    expect(vipTicket(last)).toBeDefined();
    const click = vi.fn();
    document.body.addEventListener('click', click, true);

    const promise = reader.clickTicket(vipTicket(last), { scroll: false });
    await settle(1000);
    await promise;

    expect(pressed).toHaveBeenCalledTimes(1);
    const clicks = click.mock.calls.map((c) => c[0].target).filter((t) => t.getAttribute && t.getAttribute('aria-label') && t.getAttribute('aria-label').includes('253.65'));
    expect(clicks).toHaveLength(1);
  });

  it('does not press the row again if the packages are already showing (that would close them)', async () => {
    const { pressed } = pageWithVipRow({ expanded: true });
    const { reader, last } = await ready();
    const click = vi.fn();
    document.body.addEventListener('click', click, true);

    const promise = reader.clickTicket(vipTicket(last), { scroll: false });
    await settle(1000);
    await promise;

    expect(pressed).not.toHaveBeenCalled();
    expect(click.mock.calls.filter((c) => c[0].target.getAttribute && (c[0].target.getAttribute('aria-label') || '').includes('253.65'))).toHaveLength(1);
  });

  it('does not scroll Ticketmaster\'s list looking for it (it is not down the list: it is behind a row)', async () => {
    pageWithVipRow();
    const { reader, last } = await ready();
    window.scrollTo.mockClear();
    const promise = reader.clickTicket(vipTicket(last), { scroll: false });
    await settle(1000);
    await promise;
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('gives up, saying so, if the packages never appear (and does not wait for ever)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    addLoadedLabel(1, 2);
    addCards({ section: 'BLOCKG', row: 26, price: 80.75 });
    const { reader, last } = await ready();
    const click = vi.fn();
    document.body.addEventListener('click', click, true);

    const promise = reader.clickTicket(vipTicket(last), { scroll: false });
    await settle(5000);
    await promise;

    expect(click).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no longer on the page'), expect.anything());
  });

  it('is one click at a time, like any other ticket', async () => {
    pageWithVipRow();
    const { reader, last } = await ready();
    const first = reader.clickTicket(vipTicket(last), { scroll: false });
    const second = reader.clickTicket(vipTicket(last), { scroll: false });
    await settle(1000);
    await Promise.all([first, second]);
    expect(document.querySelectorAll('[data-testid="quickpicksList"] [role="button"]')).toHaveLength(1); // pressed once
  });
});
