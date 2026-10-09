import { createPageReader } from '../src/content/page-reader.js';
import fs from 'node:fs';
import path from 'node:path';
import { addCards, addLoadedLabel } from './helpers/cards.js';

let reader;

afterEach(() => {
  if (reader) reader.stop();
  reader = null;
});

function setup() {
  const onSnapshot = vi.fn();
  reader = createPageReader({ onSnapshot, loadMode: 'scroll' }); // the scrolling path; reading the API is tested in page-reader-api.test.js
  return { reader, onSnapshot };
}

const settle = (ms = 300) => vi.advanceTimersByTimeAsync(ms);

function sampleCards() {
  return addCards(
    { section: '101', row: 12, price: 90 },
    { section: '101', row: 3, price: 130, resale: true },
    { section: 'PIT', price: 75 }
  );
}

describe('starting and stopping', () => {
  it('does nothing until started', async () => {
    vi.useFakeTimers();
    sampleCards();
    const { onSnapshot } = setup();
    await settle(5000);
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('reports the page straight away on start', () => {
    addLoadedLabel(3, 3);
    const cards = sampleCards();
    const { reader, onSnapshot } = setup();

    reader.start();

    expect(onSnapshot).toHaveBeenCalledTimes(1);
    const snap = onSnapshot.mock.calls[0][0];
    expect(snap).toMatchObject({ qty: 1, status: { loaded: 3, total: 3, isComplete: true } });
    expect(snap.tickets).toHaveLength(3);
    expect(snap.tickets[0]).toMatchObject({ section: '101', row: 12, price: 90, currency: '€', isResale: false });
    expect(snap.tickets[0].element).toBe(cards[0]);
    expect(snap.tickets[1].isResale).toBe(true);
    expect(reader.isRunning()).toBe(true);
  });

  it('reads the quantity from the page', () => {
    document.body.innerHTML = '<div role="spinbutton" aria-valuenow="3"></div>';
    const { reader, onSnapshot } = setup();
    reader.start();
    expect(onSnapshot.mock.calls[0][0].qty).toBe(3);
  });

  it('start is idempotent', () => {
    sampleCards();
    const { reader, onSnapshot } = setup();
    reader.start();
    reader.start();
    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });

  it('stops watching, and reports afresh when restarted', async () => {
    vi.useFakeTimers();
    addLoadedLabel(3, 3);
    sampleCards();
    const { reader, onSnapshot } = setup();
    reader.start();
    reader.stop();
    expect(reader.isRunning()).toBe(false);

    addCards({ section: '999', row: 1 });
    await settle(3000);
    expect(onSnapshot).toHaveBeenCalledTimes(1);

    reader.start();
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    expect(onSnapshot.mock.calls[1][0].tickets).toHaveLength(4);
  });
});

describe('snapshots', () => {
  it('reports again when the page adds tickets, but not for unrelated changes', async () => {
    vi.useFakeTimers();
    addLoadedLabel(1, 1);
    addCards({ section: '101', row: 1 });
    const { reader, onSnapshot } = setup();
    reader.start();
    expect(onSnapshot).toHaveBeenCalledTimes(1);

    document.body.append(document.createElement('div')); // unrelated page churn
    await settle();
    expect(onSnapshot).toHaveBeenCalledTimes(1);

    addCards({ section: '205', row: 4 });
    await settle();
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    expect(onSnapshot.mock.calls[1][0].tickets.map((t) => t.section)).toEqual(['101', '205']);
  });

  it('does not report when Ticketmaster re-creates identical cards', async () => {
    vi.useFakeTimers();
    addLoadedLabel(1, 1);
    const [card] = addCards({ section: '101', row: 1 });
    const { reader, onSnapshot } = setup();
    reader.start();

    card.replaceWith(card.cloneNode(true));
    await settle();

    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe('clickTicket', () => {
  it('clicks the card once, after scrolling to it', () => {
    const cards = sampleCards();
    const clicked = vi.fn();
    cards[1].addEventListener('click', clicked);
    const { reader, onSnapshot } = setup();
    reader.start();

    reader.clickTicket(onSnapshot.mock.calls[0][0].tickets[1]);

    expect(cards[1].scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    // Ticketmaster pushes a history entry per activation: exactly one, or Back needs several presses.
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('finds the card by its label when Ticketmaster has since re-created it', () => {
    const [card] = sampleCards();
    const { reader, onSnapshot } = setup();
    reader.start();
    const ticket = onSnapshot.mock.calls[0][0].tickets[0];

    const replacement = card.cloneNode(true);
    const clicked = vi.fn();
    replacement.addEventListener('click', clicked);
    card.replaceWith(replacement);

    reader.clickTicket(ticket);

    expect(clicked).toHaveBeenCalled();
  });

  it('warns and does nothing when the ticket has left the page', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [card] = sampleCards();
    const { reader, onSnapshot } = setup();
    reader.start();
    const ticket = onSnapshot.mock.calls[0][0].tickets[0];
    card.remove();

    expect(() => reader.clickTicket(ticket)).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});

describe('stepQuantity', () => {
  function addStepper(qty) {
    const host = document.createElement('div');
    host.innerHTML =
      `<div role="spinbutton" aria-valuenow="${qty}"></div>` +
      '<div data-testid="quantityStepper"><button id="tm-minus"></button><button id="tm-plus"></button></div>';
    document.body.prepend(host);
  }

  it('steps the page\'s own quantity control', () => {
    addStepper(2);
    const { reader } = setup();
    reader.start();
    const plus = vi.fn();
    const minus = vi.fn();
    document.getElementById('tm-plus').addEventListener('click', plus);
    document.getElementById('tm-minus').addEventListener('click', minus);

    reader.stepQuantity(1);
    expect(plus).toHaveBeenCalled();
    expect(minus).not.toHaveBeenCalled();

    reader.stepQuantity(-1);
    expect(minus).toHaveBeenCalled();
  });

  it('pauses auto-scroll while stepping and resumes afterwards', async () => {
    vi.useFakeTimers();
    addLoadedLabel(2, 9);
    addStepper(2);
    sampleCards();
    const { reader } = setup();
    reader.start();

    reader.stepQuantity(1);
    window.scrollTo.mockClear();
    await settle(450);
    expect(window.scrollTo).not.toHaveBeenCalled();

    await settle(1500);
    expect(window.scrollTo).toHaveBeenCalled();
  });
});

describe('auto-scroll', () => {
  it('scrolls to load more tickets while loading, then resets to the top when complete', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document.body, 'scrollHeight', { value: 5000, configurable: true });
    const label = addLoadedLabel(4, 8);
    sampleCards();
    const { reader, onSnapshot } = setup();
    reader.start();
    expect(onSnapshot.mock.calls[0][0].status).toEqual({ loaded: 4, total: 8, isComplete: false });

    window.scrollTo.mockClear();
    await settle(600);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 5000);

    label.textContent = 'Loaded 8 of 8';
    window.scrollTo.mockClear();
    await settle(600);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    await settle(300);
    expect(onSnapshot.mock.calls.at(-1)[0].status.isComplete).toBe(true);

    window.scrollTo.mockClear();
    await settle(3000);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('does not scroll a page that has no ticket cards', async () => {
    vi.useFakeTimers();
    const { reader } = setup();
    reader.start();
    await settle(5000);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('stops scrolling when stopped', async () => {
    vi.useFakeTimers();
    addLoadedLabel(4, 8);
    sampleCards();
    const { reader } = setup();
    reader.start();
    reader.stop();

    window.scrollTo.mockClear();
    await settle(3000);

    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});

describe('the VIP packages row (scrolling the cards)', () => {
  const loadRealPane = () => {
    document.body.innerHTML = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/quickpicks-pane.html'), 'utf8');
  };
  const vipButton = () => document.querySelector('[data-testid="quickpicksList"] button');
  const watchVip = () => {
    const pressed = vi.fn();
    vipButton().addEventListener('click', pressed);
    return pressed;
  };

  it('opens Ticketmaster\'s own VIP row, once, so the packages are in the list', () => {
    loadRealPane();
    const pressed = watchVip();
    const { reader } = setup();
    reader.start();
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it('does not press it again on later looks at the page: that would close it again', async () => {
    vi.useFakeTimers();
    loadRealPane();
    const pressed = watchVip();
    const { reader } = setup();
    reader.start();
    for (let i = 0; i < 4; i++) {
      document.body.append(document.createElement('i'));
      await settle(400);
    }
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it('presses it again for a new quantity (the list reloads, and the row closes)', async () => {
    vi.useFakeTimers();
    loadRealPane();
    const spin = document.createElement('div');
    spin.setAttribute('role', 'spinbutton');
    spin.setAttribute('aria-valuenow', '2');
    document.body.append(spin);
    const pressed = watchVip();
    const { reader } = setup();
    reader.start();
    expect(pressed).toHaveBeenCalledTimes(1);

    spin.setAttribute('aria-valuenow', '3');
    document.body.append(document.createElement('i')); // the list reloading: something changes on the page
    await settle(400);
    expect(pressed).toHaveBeenCalledTimes(2);
  });

  it('leaves it alone when the packages are already showing (pressing it would close them)', () => {
    loadRealPane();
    const list = document.querySelector('[data-testid="quickpicksList"]');
    const [vipCard] = addCards({ section: 'BLOCKE', row: 26, price: 253.65, packageTitle: 'Trivium Meet & Greet Package', vipIcon: true });
    list.append(vipCard);
    const pressed = watchVip();
    const { reader } = setup();
    reader.start();
    expect(pressed).not.toHaveBeenCalled();
  });

  it('finds the row when it appears after the first look, even if nothing else changed', async () => {
    vi.useFakeTimers();
    sampleCards();
    const { reader } = setup();
    reader.start();
    document.body.innerHTML += '<div data-testid="quickpicksList"><div><button><svg class="StarCircledFilledIcon___X"></svg><span><span>VIP Packages</span><span>€100.00 each</span></span><span>Show Tickets</span></button></div></div>';
    const pressed = vi.fn();
    document.querySelector('button').addEventListener('click', pressed);
    await settle(600);
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a VIP row', () => {
    sampleCards();
    const { reader, onSnapshot } = setup();
    expect(() => reader.start()).not.toThrow();
    expect(onSnapshot).toHaveBeenCalled();
  });

  it('no longer reports the row to the view: the VIP pill is all there is', () => {
    loadRealPane();
    const { reader, onSnapshot } = setup();
    reader.start();
    expect(onSnapshot.mock.calls[0][0]).not.toHaveProperty('vip');
    expect(reader.toggleVip).toBeUndefined();
  });
});

describe('clickTicket scrolling', () => {
  it('can skip scrolling Ticketmaster\'s list to the ticket (when the list is covered)', () => {
    const cards = sampleCards();
    const clicked = vi.fn();
    cards[0].addEventListener('click', clicked);
    const { reader, onSnapshot } = setup();
    reader.start();

    reader.clickTicket(onSnapshot.mock.calls[0][0].tickets[0], { scroll: false });

    expect(cards[0].scrollIntoView).not.toHaveBeenCalled();
    expect(clicked).toHaveBeenCalled();
  });
});

describe('what the page says about itself', () => {
  const loadRealPane = () => {
    document.body.innerHTML = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/quickpicks-pane.html'), 'utf8');
  };

  it('reports Ticketmaster\'s sort and the size of its card text', () => {
    loadRealPane();
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => ({ fontSize: '18px', overflowY: 'visible', position: 'static', getPropertyValue: () => '' }));
    const { reader, onSnapshot } = setup();
    reader.start();
    expect(onSnapshot.mock.calls[0][0]).toMatchObject({ pageSort: 'price', textPx: 18 });
  });

  it('reports null for both when the page has neither', () => {
    sampleCards();
    const { reader, onSnapshot } = setup();
    reader.start();
    expect(onSnapshot.mock.calls[0][0]).toMatchObject({ pageSort: null });
  });

  it('reports again when Ticketmaster\'s sort changes', async () => {
    vi.useFakeTimers();
    loadRealPane();
    const { reader, onSnapshot } = setup();
    reader.start();
    expect(onSnapshot).toHaveBeenCalledTimes(1);

    document.querySelector('[class*="ArrowExchangeIcon"]').closest('button').querySelector('span > span').textContent = 'Best Seats';
    document.body.append(document.createElement('div')); // a mutation, as React would make
    await settle();

    expect(onSnapshot).toHaveBeenCalledTimes(2);
    expect(onSnapshot.mock.calls[1][0].pageSort).toBe('row');
  });
});

describe('the venue', () => {
  it('is reported with each snapshot', () => {
    document.body.innerHTML = '<div id="header"><a href="/3arena-tickets-dublin/venue/197033">3Arena, Dublin</a></div>';
    const { reader, onSnapshot } = setup();
    reader.start();
    expect(onSnapshot.mock.calls[0][0].venue).toEqual({ id: '197033', name: '3Arena, Dublin' });
  });

  it('is null when the page has none', () => {
    sampleCards();
    const { reader, onSnapshot } = setup();
    reader.start();
    expect(onSnapshot.mock.calls[0][0].venue).toBeNull();
  });
});
