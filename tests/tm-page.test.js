import {
  clickElement,
  findHeaderBlocks,
  findVenue,
  findVipRow,
  getPageSort,
  measureTicketTextPx,
  sortModeFromLabel,
  getActiveQuantity,
  getCards,
  getLoadedStatus,
  scrollToLoadMore,
  scrollToTopAllContainers,
  stepQuantity,
} from '../src/content/tm-page.js';
import fs from 'node:fs';
import path from 'node:path';
import { addCards, addLoadedLabel } from './helpers/cards.js';

describe('getLoadedStatus', () => {
  it('reads Ticketmaster\'s "Loaded X of Y" label', () => {
    addLoadedLabel(24, 60);
    expect(getLoadedStatus()).toEqual({ loaded: 24, total: 60, isComplete: false });
  });

  it('reports completion when everything is loaded', () => {
    addLoadedLabel(60, 60);
    expect(getLoadedStatus()).toMatchObject({ loaded: 60, total: 60, isComplete: true });
  });

  it('finds the label in any span when the known classes are absent', () => {
    const span = document.createElement('span');
    span.textContent = 'Loaded 5 of 5';
    document.body.append(span);
    expect(getLoadedStatus()).toMatchObject({ loaded: 5, total: 5, isComplete: true });
  });

  it('falls back to counting cards, incomplete, when there is no label', () => {
    addCards({ section: 'A', row: 1 }, { section: 'A', row: 2 });
    expect(getLoadedStatus()).toEqual({ loaded: 2, total: 0, isComplete: false });
  });
});

describe('getCards', () => {
  it('returns the ticket cards in document order', () => {
    const cards = addCards({ section: 'A', row: 1 }, { section: 'B', row: 2 });
    expect(getCards()).toEqual(cards);
  });
});

describe('getActiveQuantity', () => {
  it('defaults to 1', () => {
    expect(getActiveQuantity()).toBe(1);
  });

  it('reads aria-valuenow from a spinbutton', () => {
    document.body.innerHTML = '<div role="spinbutton" aria-valuenow="4">ignored</div>';
    expect(getActiveQuantity()).toBe(4);
  });

  it('falls back to the spinbutton text', () => {
    document.body.innerHTML = '<div role="spinbutton"> 3 </div>';
    expect(getActiveQuantity()).toBe(3);
  });

  it('falls back to the "N Tickets" filter button', () => {
    document.body.innerHTML = '<button>2 Tickets</button>';
    expect(getActiveQuantity()).toBe(2);
  });
});

describe('clickElement', () => {
  it('sends the pointer/mouse sequence ending in exactly one click', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const order = [];
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) =>
      el.addEventListener(type, () => order.push(type))
    );

    clickElement(el);

    expect(order).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
  });

  it('activates the element once: Ticketmaster navigates on every activation, so more would pile up history entries', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'button');
    const activations = vi.fn();
    el.addEventListener('click', activations);
    document.body.append(el);

    clickElement(el);

    expect(activations).toHaveBeenCalledTimes(1);
  });

  it('does not click the element\'s children as well (a click on a child bubbles to the parent)', () => {
    const button = document.createElement('button');
    button.innerHTML = '<svg></svg>';
    const activations = vi.fn();
    button.addEventListener('click', activations);
    document.body.append(button);

    clickElement(button);

    expect(activations).toHaveBeenCalledTimes(1);
  });

  it('warns and does nothing for a missing element', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => clickElement(null)).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});

describe('scrolling', () => {
  it('scrollToLoadMore pushes the last card, known containers and the window to the bottom', () => {
    const list = document.createElement('div');
    list.id = 'quickpicks-list';
    document.body.append(list);
    const cards = addCards({ section: 'A', row: 1 }, { section: 'A', row: 2 });
    Object.defineProperty(list, 'scrollHeight', { value: 900, configurable: true });
    const wheel = vi.fn();
    list.addEventListener('wheel', wheel);

    scrollToLoadMore();

    expect(cards[1].scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'end' });
    expect(list.scrollTop).toBe(900);
    expect(wheel).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalled();
  });

  it('scrollToTopAllContainers resets the first card, containers and window', () => {
    const list = document.createElement('div');
    list.id = 'quickpicks-list';
    list.scrollTop = 500;
    document.body.append(list);
    const [first] = addCards({ section: 'A', row: 1 });

    scrollToTopAllContainers();

    expect(first.scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' });
    expect(list.scrollTop).toBe(0);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });
});

describe('stepQuantity', () => {
  function stepper(qty) {
    document.body.innerHTML =
      `<div role="spinbutton" aria-valuenow="${qty}"></div>` +
      '<div data-testid="quantityStepper"><button id="minus"></button><button id="plus"></button></div>';
    const plus = document.getElementById('plus');
    const minus = document.getElementById('minus');
    return { plus, minus, plusClick: vi.fn(), minusClick: vi.fn() };
  }

  it('clicks plus, then reports back after the page has settled', () => {
    vi.useFakeTimers();
    const s = stepper(2);
    s.plus.addEventListener('click', s.plusClick);
    s.minus.addEventListener('click', s.minusClick);
    const done = vi.fn();

    expect(stepQuantity(1, done)).toBe(true);

    expect(s.plusClick).toHaveBeenCalledTimes(1);
    expect(s.minusClick).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('clicks minus when stepping down', () => {
    vi.useFakeTimers();
    const s = stepper(3);
    s.minus.addEventListener('click', s.minusClick);

    stepQuantity(-1, () => {});

    expect(s.minusClick).toHaveBeenCalled();
  });

  it('refuses to leave the 1-8 range', () => {
    const done = vi.fn();
    stepper(8);
    expect(stepQuantity(1, done)).toBe(false);
    stepper(1);
    expect(stepQuantity(-1, done)).toBe(false);
  });

  it('opens the quantity dropdown first when it is collapsed', () => {
    vi.useFakeTimers();
    const s = stepper(2);
    const filter = document.createElement('button');
    filter.setAttribute('aria-expanded', 'false');
    filter.textContent = '2 Tickets';
    document.body.prepend(filter);
    const filterClick = vi.fn();
    filter.addEventListener('click', filterClick);
    s.plus.addEventListener('click', s.plusClick);

    stepQuantity(1, () => {});

    expect(filterClick).toHaveBeenCalled();
    expect(s.plusClick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(s.plusClick).toHaveBeenCalled();
  });

  it('does nothing further when the stepper button is missing', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div role="spinbutton" aria-valuenow="2"></div>';
    const done = vi.fn();

    stepQuantity(1, done);
    vi.advanceTimersByTime(1000);

    expect(done).not.toHaveBeenCalled();
  });
});

describe('the real ticketmaster.ie pane', () => {
  // Verbatim (SVG path data shortened) from the live site: tests/fixtures/quickpicks-pane.html
  function loadRealPane() {
    document.body.innerHTML = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/quickpicks-pane.html'), 'utf8');
  }

  it('finds the three ticket cards, and not the "VIP Packages" row', () => {
    loadRealPane();
    expect(getCards()).toHaveLength(3);
  });

  it('reads the "Loaded 20 of 84" footer', () => {
    loadRealPane();
    expect(getLoadedStatus()).toEqual({ loaded: 20, total: 84, isComplete: false });
  });

  it('falls back to the results header for the total while the footer has not appeared yet', () => {
    loadRealPane();
    document.querySelector('.sc-bb065817-4').closest('.sc-bb065817-0').remove();
    expect(getLoadedStatus()).toEqual({ loaded: 3, total: 84, isComplete: false });
  });

  it('counts the load as complete when every result is already on the page', () => {
    loadRealPane();
    document.querySelector('.sc-bb065817-4').closest('.sc-bb065817-0').remove();
    document.querySelector('[role="status"]').textContent = '3 results available';
    expect(getLoadedStatus()).toEqual({ loaded: 3, total: 3, isComplete: true });
  });

  it('works from the header\'s <h2> when there is no status text', () => {
    loadRealPane();
    document.querySelector('.sc-bb065817-4').closest('.sc-bb065817-0').remove();
    document.querySelector('[role="status"]').remove();
    expect(getLoadedStatus().total).toBe(84);
  });

  it('reads the quantity from the "2 Tickets" chip', () => {
    loadRealPane();
    expect(getActiveQuantity()).toBe(2);
  });

  it('steps the quantity by opening the "2 Tickets" chip, not "All Ticket Types"', () => {
    vi.useFakeTimers();
    loadRealPane();
    const [qtyChip, , typesChip] = document.querySelectorAll('[role="toolbar"] button');
    const qtyClicked = vi.fn();
    const typesClicked = vi.fn();
    qtyChip.addEventListener('click', qtyClicked);
    typesChip.addEventListener('click', typesClicked);

    expect(stepQuantity(1, () => {})).toBe(true);

    expect(qtyClicked).toHaveBeenCalled();
    expect(typesClicked).not.toHaveBeenCalled();
  });
});

describe('findVipRow', () => {
  function loadRealPane() {
    document.body.innerHTML = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/quickpicks-pane.html'), 'utf8');
  }

  it('finds the "VIP Packages" summary row and reads its title and price range', () => {
    loadRealPane();
    const row = findVipRow();
    expect(row.title).toBe('VIP Packages');
    expect(row.range).toBe('€197.45–€329.40 each');
    expect(row.element.tagName).toBe('BUTTON');
    expect(row.element.textContent).toContain('Show Tickets');
  });

  it('is null when the page has no VIP row, or no list at all', () => {
    expect(findVipRow()).toBeNull();
    loadRealPane();
    document.querySelector('[data-testid="quickpicksList"] button').remove();
    expect(findVipRow()).toBeNull();
  });

  it('ignores the other buttons in the pane', () => {
    loadRealPane();
    expect(findVipRow().element).toBe(document.querySelector('[data-testid="quickpicksList"] button'));
  });
});

describe('getPageSort (Ticketmaster\'s own sort control)', () => {
  function loadRealPane() {
    document.body.innerHTML = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/quickpicks-pane.html'), 'utf8');
  }
  const setSortLabel = (text) => {
    document.querySelector('[class*="ArrowExchangeIcon"]').closest('button').querySelector('span > span').textContent = text;
  };

  it('reads "Lowest Price" as price', () => {
    loadRealPane();
    expect(getPageSort()).toBe('price');
  });

  it('reads the best-seats option as row', () => {
    loadRealPane();
    setSortLabel('Best Seats');
    expect(getPageSort()).toBe('row');
    setSortLabel('Best Available');
    expect(getPageSort()).toBe('row');
  });

  it('is null for a label it does not know, or when there is no sort control', () => {
    loadRealPane();
    setSortLabel('Plus récents');
    expect(getPageSort()).toBeNull();
    document.body.innerHTML = '';
    expect(getPageSort()).toBeNull();
  });
});

describe('sortModeFromLabel', () => {
  it('maps the two options in Ticketmaster\'s real sort menu', () => {
    // tests/fixtures/sort-popover.html: <ul role="menu" aria-label="Sort results by"> with these two items
    document.body.innerHTML = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/sort-popover.html'), 'utf8');
    const labels = [...document.querySelectorAll('[role="menu"] button')].map((b) => b.textContent.trim());
    expect(labels).toEqual(['Lowest Price', 'Best Seats']);
    expect(labels.map(sortModeFromLabel)).toEqual(['price', 'row']);
  });

  it('is null for anything else', () => {
    expect(sortModeFromLabel('Plus récents')).toBeNull();
    expect(sortModeFromLabel('')).toBeNull();
    expect(sortModeFromLabel(undefined)).toBeNull();
  });
});

describe('measureTicketTextPx', () => {
  it('reads the font size of the text on a ticket card', () => {
    document.body.innerHTML = '<div data-testid="quickpicksList"><div role="button" aria-label="Select x €1.00"><dl><div><dt>Section</dt> <dd style="font-size:18px">A</dd></div></dl></div></div>';
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => ({ fontSize: el.tagName === 'DD' ? '18px' : '16px', overflowY: 'visible', position: 'static', getPropertyValue: () => '' }));
    expect(measureTicketTextPx()).toBe(18);
  });

  it('is null with no card, or when the size cannot be read', () => {
    expect(measureTicketTextPx()).toBeNull();
    document.body.innerHTML = '<div role="button" aria-label="Select x €1.00"><dd>A</dd></div>';
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ fontSize: '' }));
    expect(measureTicketTextPx()).toBeNull();
  });
});

describe('findHeaderBlocks', () => {
  it('returns the blocks above the list inside #quickpicks, in order', () => {
    document.body.innerHTML = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/quickpicks-pane.html'), 'utf8');
    const blocks = findHeaderBlocks(document.getElementById('quickpicks-list'));
    expect(blocks).toHaveLength(4);
    expect(blocks[0].textContent).toContain('Want to enhance your night');
    expect(blocks[2].querySelector('[role="toolbar"]')).not.toBeNull();
    expect(blocks[3].textContent).toContain('Delivery');
  });

  it('is empty when the layout is not recognised', () => {
    document.body.innerHTML = '<div id="quickpicks"><div>a</div></div><div id="quickpicks-list"></div>';
    expect(findHeaderBlocks(document.getElementById('quickpicks-list'))).toEqual([]);
    expect(findHeaderBlocks(null)).toEqual([]);
    document.body.innerHTML = '';
    expect(findHeaderBlocks(document.createElement('div'))).toEqual([]);
  });
});

describe('findVenue', () => {
  const realLink = () => fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/venue-link.html'), 'utf8');

  it('reads the venue id and name from the real link under the event title', () => {
    document.body.innerHTML = realLink();
    expect(findVenue()).toEqual({ id: '197033', name: '3Arena, Dublin' });
  });

  it('prefers the link in the event header over any other venue link on the page', () => {
    document.body.innerHTML = '<a href="/other-tickets/venue/111">Elsewhere</a><div id="header">' + realLink() + '</div>';
    expect(findVenue()).toEqual({ id: '197033', name: '3Arena, Dublin' });
  });

  it('falls back to a venue link anywhere on the page', () => {
    document.body.innerHTML = '<div><a href="/x-tickets/venue/42"> The Venue </a></div>';
    expect(findVenue()).toEqual({ id: '42', name: 'The Venue' });
  });

  it('is null when there is no venue link, or it has no id', () => {
    expect(findVenue()).toBeNull();
    document.body.innerHTML = '<a href="/venues">All venues</a><a href="/some/venue/">x</a>';
    expect(findVenue()).toBeNull();
  });
});
