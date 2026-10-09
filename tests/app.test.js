import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/content/app.js';
import { MSG } from '../src/lib/protocol.js';
import { normalizeSettings } from '../src/lib/settings.js';
import { saveVenue } from '../src/lib/venues.js';
import { addCards, addLoadedLabel } from './helpers/cards.js';
import { chrome, flush, peekStorage } from './mocks/chrome.js';

let app;

function make(settings = {}) {
  // Most of these tests are about the cards on the page, which is what scrolling mode reads (the API has its own tests).
  app = createApp({ settings: normalizeSettings({ loadMode: 'scroll', ...settings }), version: '1.2.3' });
  document.body.append(app.root);
  return app;
}

afterEach(() => {
  if (app) app.stop();
  app = null;
});

const q = (sel) => app.root.querySelector(sel);
const qa = (sel) => [...app.root.querySelectorAll(sel)];
const sectionNames = () => qa('.section-name').map((s) => s.textContent.replace(/\(\d+\)$/, '').trim());
const settle = (ms = 300) => vi.advanceTimersByTimeAsync(ms);

function sampleCards() {
  addLoadedLabel(4, 4);
  return addCards(
    { section: '101', row: 12, price: 90 },
    { section: '101', row: 3, price: 130 },
    { section: '102', row: 20, price: 40, resale: true },
    { section: 'PIT', price: 75 }
  );
}

describe('showing the page\'s tickets', () => {
  it('waits for tickets before the page has been read', () => {
    make();
    expect(q('.sv-content').textContent).toBe('Waiting for tickets to render...');
  });

  it('lists the sections once started', () => {
    sampleCards();
    make();
    app.start();

    expect(sectionNames()).toEqual(['Section PIT', 'Section 101', 'Section 102']);
    expect(q('.status').textContent).toBe('✓ All 4 Loaded (Scroll)'); // the app here reads the cards
    expect(q('.counter').textContent).toBe('Total Loaded: 4 options (1 per offer)');
  });

  it('says it is waiting when the page has no tickets yet', () => {
    make();
    app.start();
    expect(q('.sv-content').textContent).toBe('Waiting for tickets to render...');
    expect(q('.counter').textContent).toContain('Total Loaded: 0 options');
  });

  it('follows the page as it loads more tickets', async () => {
    vi.useFakeTimers();
    addLoadedLabel(1, 1);
    addCards({ section: '101', row: 1 });
    make();
    app.start();
    expect(sectionNames()).toEqual(['Section 101']);

    addCards({ section: '205', row: 4 });
    await settle();

    expect(sectionNames()).toEqual(['Section 101', 'Section 205']);
  });

  it('only watches the page while started', async () => {
    vi.useFakeTimers();
    addLoadedLabel(1, 1);
    addCards({ section: '101', row: 1 });
    make();
    app.start();
    app.stop();

    addCards({ section: '205', row: 4 });
    await settle(3000);

    expect(sectionNames()).toEqual(['Section 101']);
  });
});

describe('controls', () => {
  it('filters sections by name', () => {
    sampleCards();
    make();
    app.start();

    const search = q('.search');
    search.value = '10';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(sectionNames()).toEqual(['Section 101', 'Section 102']);

    search.value = 'nope';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(q('.sv-content').textContent).toBe('No matching blocks found.');
  });

  it('toggles the other pills, re-renders and persists them', async () => {
    sampleCards();
    make();
    app.start();

    q('[data-badge="resale"]').click();
    expect(sectionNames()).toEqual(['Section 102']);
    await flush();
    expect(peekStorage('badgeFilters')).toEqual(['resale']);

    q('[data-seat="firstrow"]').click();
    expect(q('.sv-content').textContent).toBe('No tickets match the selected filters.');

    q('[data-badge="resale"]').click(); // now hiding the resale tickets...
    q('[data-badge="resale"]').click(); // ...and now neither
    q('[data-seat="all"]').click();
    await flush();
    expect(peekStorage('badgeFilters')).toEqual([]);
    expect(peekStorage('hideFilters')).toEqual([]);
    expect(sectionNames()).toHaveLength(3);
  });

  describe('hiding the tickets of an "Other" pill', () => {
    const state = () => q('[data-badge="resale"]').getAttribute('data-state');

    it('goes round: off, show only, hide, off', async () => {
      sampleCards(); // 4 tickets, one of them resale
      make();
      app.start();
      expect(state()).toBe('off');
      expect(qa('.ticket')).toHaveLength(4);

      q('[data-badge="resale"]').click();
      expect(state()).toBe('show');
      expect(qa('.ticket')).toHaveLength(1);

      q('[data-badge="resale"]').click();
      expect(state()).toBe('hide');
      expect(qa('.ticket')).toHaveLength(3);
      expect(sectionNames()).not.toContain('Section 102');

      q('[data-badge="resale"]').click();
      expect(state()).toBe('off');
      expect(qa('.ticket')).toHaveLength(4);
    });

    it('saves what is hidden, and keeps it apart from what is shown only', async () => {
      sampleCards();
      make();
      app.start();
      q('[data-badge="resale"]').click();
      q('[data-badge="resale"]').click();
      await flush();
      expect(peekStorage('hideFilters')).toEqual(['resale']);
      expect(peekStorage('badgeFilters')).toEqual([]);
    });

    it('comes back as it was saved, for every venue and page', () => {
      sampleCards();
      make({ hideFilters: ['resale'] });
      app.start();
      expect(state()).toBe('hide');
      expect(q('[data-badge="resale"]').textContent).toContain('🚫');
      expect(qa('.ticket')).toHaveLength(3);
    });

    it('says how many tickets the filters are hiding, next to the count of tickets', () => {
      sampleCards();
      make();
      app.start();
      expect(q('.counter').textContent).toBe('Total Loaded: 4 options (1 per offer)');
      q('[data-badge="resale"]').click();
      q('[data-badge="resale"]').click();
      expect(q('.counter').textContent).toBe('Total Loaded: 4 options (1 per offer) · 1 hidden by filters');
      q('[data-badge="standing"]').click();
      expect(q('.counter').textContent).toBe('Total Loaded: 4 options (1 per offer) · 3 hidden by filters');
    });

    it('counts a search, or everything when nothing matches, as hidden too', () => {
      sampleCards();
      make();
      app.start();
      const search = q('.search');
      search.value = '101';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      expect(q('.counter').textContent).toContain('2 hidden by filters');
      q('[data-seat="firstrow"]').click();
      expect(q('.counter').textContent).toContain('4 hidden by filters');
    });

    it('applies with the price choice last: hide resale, then the cheapest of what is left', () => {
      sampleCards(); // the resale ticket (€40) is the cheapest of all
      make();
      app.start();
      q('[data-badge="resale"]').click();
      q('[data-badge="resale"]').click();
      q('[data-price="cheapest"]').click();
      expect(qa('.ticket')).toHaveLength(1);
      expect(sectionNames()).toEqual(['Section PIT']); // €75, the cheapest that isn't resale
    });

    it('shows how many a hiding pill is hiding, in its count', () => {
      sampleCards();
      make({ hideFilters: ['resale'] });
      app.start();
      expect(q('[data-badge="resale"]').textContent).toBe('🚫 Resale (1)');
    });
  });

  describe('the seat and price choices', () => {
    it('start as All and Any, showing everything', () => {
      sampleCards();
      make();
      app.start();
      expect(qa('[data-seat]').map((p) => p.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
      expect(qa('[data-price]').map((p) => p.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
      expect(sectionNames()).toHaveLength(3);
    });

    it('are one choice each: choosing one replaces the other', async () => {
      sampleCards();
      make();
      app.start();

      q('[data-seat="firstrow"]').click();
      expect(q('.sv-content').textContent).toBe('No tickets match the selected filters.');
      expect(qa('[data-seat]').map((p) => p.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);

      q('[data-seat="frontrows"]').click();
      expect(qa('[data-seat]').map((p) => p.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
      expect(sectionNames()).toEqual(['Section 101']); // Row 3 is within the first 5

      q('[data-price="cheapest"]').click();
      q('[data-price="sectionlow"]').click();
      expect(qa('[data-price]').map((p) => p.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    });

    it('save, and show, what was chosen', async () => {
      sampleCards();
      make();
      app.start();
      q('[data-seat="frontrows"]').click();
      q('[data-price="cheapest"]').click();
      await flush();
      expect(peekStorage('seatFilter')).toBe('frontrows');
      expect(peekStorage('priceFilter')).toBe('cheapest');
    });

    it('save all three whenever one changes, so none is lost', async () => {
      sampleCards();
      make({ seatFilter: 'frontrows', priceFilter: 'sectionlow' });
      app.start();
      q('[data-badge="resale"]').click();
      await flush();
      expect(peekStorage('badgeFilters')).toEqual(['resale']);
      expect(peekStorage('seatFilter')).toBe('frontrows');
      expect(peekStorage('priceFilter')).toBe('sectionlow');
    });

    it('come back as they were saved', () => {
      sampleCards();
      make({ seatFilter: 'frontrows', priceFilter: 'cheapest' });
      app.start();
      expect(qa('[data-seat]').map((p) => p.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
      expect(qa('[data-price]').map((p) => p.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
      expect(sectionNames()).toEqual(['Section 101']);
    });

    it('carry over a saved "standing" choice as the Standing pill (showing only standing tickets)', () => {
      sampleCards();
      make({ seatFilter: 'standing' });
      app.start();
      expect(q('[data-seat="all"]').getAttribute('aria-checked')).toBe('true');
      expect(q('[data-badge="standing"]').getAttribute('data-state')).toBe('show');
      expect(sectionNames()).toEqual(['Section PIT']);
    });

    it('carry over from the single list of an earlier version', () => {
      sampleCards();
      make({ badgeFilters: ['frontrows', 'cheapest', 'resale'] });
      app.start();
      expect(q('[data-seat="frontrows"]').getAttribute('aria-checked')).toBe('true');
      expect(q('[data-price="cheapest"]').getAttribute('aria-checked')).toBe('true');
      expect(q('[data-badge="resale"]').getAttribute('aria-pressed')).toBe('true');
    });

    it('work out the cheapest of what the other filters leave', () => {
      sampleCards(); // 101: row 12 €90, row 3 €130; 102: row 20 €40 resale; PIT: standing €75
      make();
      app.start();
      q('[data-price="cheapest"]').click();
      expect(sectionNames()).toEqual(['Section 102']);

      q('[data-badge="standing"]').click();
      expect(sectionNames()).toEqual(['Section PIT']); // the cheapest standing ticket

      q('[data-badge="standing"]').click(); // hiding the standing tickets: the cheapest of the seated ones
      expect(sectionNames()).toEqual(['Section 102']);

      q('[data-badge="standing"]').click(); // off
      q('[data-price="sectionlow"]').click();
      expect(sectionNames()).toHaveLength(3);
      expect(qa('.ticket')).toHaveLength(3); // one per section
    });
  });

  describe('the front rows choice says how many rows it is', () => {
    const label = () => q('[data-seat="frontrows"]').textContent;

    it('uses the default number from the settings', () => {
      sampleCards();
      make({ frontRows: 3 });
      app.start();
      expect(label()).toBe('⭐ First 3 Rows (1)');
    });

    it('is "First 5 Rows" by default', () => {
      sampleCards();
      make();
      app.start();
      expect(label()).toBe('⭐ First 5 Rows (1)');
    });

    it('follows the default when it is changed in Settings', () => {
      sampleCards();
      make({ frontRows: 5 });
      app.start();
      app.updateSettings(normalizeSettings({ frontRows: 8 }));
      expect(label()).toBe('⭐ First 8 Rows (1)');
    });

    it('is the venue\'s own number when it has one', async () => {
      document.body.insertAdjacentHTML('afterbegin', '<div id="header"><a href="/3arena-tickets-dublin/venue/197033">3Arena, Dublin</a></div>');
      sampleCards();
      await saveVenue('197033', { name: '3Arena, Dublin', firstRows: [1], frontRows: 2 });
      make({ frontRows: 5 });
      app.start();
      await flush();
      expect(label()).toBe('⭐ First 2 Rows (0)'); // none of the cards is in the first 2 rows (row 3 is)
    });

    it('changes as soon as the venue\'s number is saved from the panel, and goes back when it is reset', async () => {
      document.body.insertAdjacentHTML('afterbegin', '<div id="header"><a href="/3arena-tickets-dublin/venue/197033">3Arena, Dublin</a></div>');
      sampleCards();
      make({ frontRows: 5 });
      app.start();
      await flush();
      q('.venue-btn').click();
      q('.venue-input[aria-label="Front rows"]').value = '3';
      q('.venue-save').click();
      expect(label()).toContain('First 3 Rows');
      q('.venue-btn').click();
      q('.venue-reset').click();
      expect(label()).toContain('First 5 Rows');
    });

    it('follows a change made to the venue elsewhere', async () => {
      document.body.insertAdjacentHTML('afterbegin', '<div id="header"><a href="/3arena-tickets-dublin/venue/197033">3Arena, Dublin</a></div>');
      sampleCards();
      make();
      app.start();
      await flush();
      app.handleStorageChange({ 'venue:197033': { newValue: { name: '3Arena, Dublin', firstRows: [1], frontRows: 7 } } });
      expect(label()).toContain('First 7 Rows');
    });

    it('is still the front rows choice: it filters to that many rows, and is saved as before', async () => {
      sampleCards(); // 101: row 12, row 3; 102: row 20; PIT standing
      make({ frontRows: 3 });
      app.start();
      q('[data-seat="frontrows"]').click();
      expect(sectionNames()).toEqual(['Section 101']); // row 3 is in the first 3
      await flush();
      expect(peekStorage('seatFilter')).toBe('frontrows');
      app.updateSettings(normalizeSettings({ frontRows: 2 })); // now row 3 is not a front row
      expect(q('.sv-content').textContent).toBe('No tickets match the selected filters.');
    });
  });

  describe('counts on the pills', () => {
    const counts = () => ({
      seat: qa('[data-seat]').map((p) => p.textContent),
      price: qa('[data-price]').map((p) => p.textContent),
      other: qa('[data-badge]').map((p) => p.textContent),
    });

    it('say how many tickets each pill would show', () => {
      sampleCards();
      make();
      app.start();
      expect(counts()).toEqual({
        seat: ['Any (4)', '🥇 1st Row (0)', '⭐ First 5 Rows (1)'],
        price: ['Any (4)', '🔥 Cheapest (1)', '💡 Section Low (3)'],
        other: ['🧍 Standing (1)', '🔄 Resale (1)', '👑 VIP Packages (0)'],
      });
    });

    it('follow the choices made', () => {
      sampleCards();
      make();
      app.start();
      q('[data-badge="standing"]').click();
      expect(counts()).toEqual({
        seat: ['Any (1)', '🥇 1st Row (0)', '⭐ First 5 Rows (0)'],
        price: ['Any (1)', '🔥 Cheapest (1)', '💡 Section Low (1)'],
        other: ['🧍 Standing (1)', '🔄 Resale (0)', '👑 VIP Packages (0)'],
      });
    });

    it('follow the search', () => {
      sampleCards();
      make();
      app.start();
      const search = q('.search');
      search.value = '101';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      expect(counts().seat).toEqual(['Any (2)', '🥇 1st Row (0)', '⭐ First 5 Rows (1)']);
    });
  });

  it('re-sorts and persists the sort', async () => {
    sampleCards();
    make();
    app.start();
    expect(sectionNames()[0]).toBe('Section PIT');

    q('[data-sort="price"]').click();

    expect(sectionNames()).toEqual(['Section 102', 'Section PIT', 'Section 101']);
    await flush();
    expect(peekStorage('sort')).toBe('price');
  });

  it('starts with the saved sort and filters', () => {
    sampleCards();
    make({ sort: 'price', badgeFilters: ['resale'] });
    app.start();

    expect(q('[data-sort="price"]').getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-badge="resale"]').getAttribute('aria-pressed')).toBe('true');
    expect(sectionNames()).toEqual(['Section 102']);
  });

  it('does not corrupt the page data when filters change back and forth', () => {
    sampleCards();
    make();
    app.start();
    q('[data-badge="resale"]').click();
    q('[data-badge="resale"]').click();
    q('[data-badge="resale"]').click();
    expect(sectionNames()).toHaveLength(3);
  });

  it('asks the service worker to open the options page from the gear', () => {
    make();
    q('.gear-btn').click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: MSG.OPEN_OPTIONS });
  });
});

describe('acting on the page', () => {
  it('clicks the ticket on the page when a row is clicked', () => {
    const cards = sampleCards();
    const clicked = vi.fn();
    cards[3].addEventListener('click', clicked);
    make();
    app.start();

    [...qa('.ticket')].find((t) => t.textContent.includes('Standing')).click();

    expect(cards[3].scrollIntoView).toHaveBeenCalled();
    expect(clicked).toHaveBeenCalled();
  });

  it('steps the page\'s quantity control from the stepper', () => {
    sampleCards();
    const host = document.createElement('div');
    host.innerHTML =
      '<div role="spinbutton" aria-valuenow="2"></div>' +
      '<div data-testid="quantityStepper"><button id="tm-minus"></button><button id="tm-plus"></button></div>';
    document.body.prepend(host);
    make();
    app.start();
    expect(q('.counter').textContent).toContain('(2 per offer)');
    const plusClicked = vi.fn();
    document.getElementById('tm-plus').addEventListener('click', plusClicked);

    qa('.stepper button')[1].click();

    expect(plusClicked).toHaveBeenCalled();
  });
});

describe('hosting hooks', () => {
  it('configure(): compact layout and a "show Ticketmaster\'s list" link with its callback', () => {
    make();
    const onShowOriginal = vi.fn();
    app.configure({ compact: true, onShowOriginal });
    expect(app.root.classList.contains('compact')).toBe(true);
    expect(q('.original-row').hidden).toBe(false);

    q('.link-btn').click();
    expect(onShowOriginal).toHaveBeenCalled();

    app.configure({ compact: false, onShowOriginal: null });
    expect(app.root.classList.contains('compact')).toBe(false);
    expect(q('.original-row').hidden).toBe(true);
  });

  it('configure(): flow lets the page scroll the view instead of the view scrolling inside itself', () => {
    make();
    app.configure({ flow: true });
    expect(app.root.classList.contains('flow')).toBe(true);
    app.configure({ flow: false });
    expect(app.root.classList.contains('flow')).toBe(false);
  });

  it('configure(): can stop scrolling Ticketmaster\'s list to a clicked ticket', () => {
    const cards = sampleCards();
    make();
    app.configure({ scrollToClicked: false });
    app.start();

    qa('.ticket')[0].click();
    expect(cards.some((c) => c.scrollIntoView.mock.calls.length > 0)).toBe(false);

    app.configure({ scrollToClicked: true });
    qa('.ticket')[0].click();
    expect(cards.some((c) => c.scrollIntoView.mock.calls.length > 0)).toBe(true);
  });

  it('subscribe(): reports each snapshot, until unsubscribed', async () => {
    vi.useFakeTimers();
    addLoadedLabel(1, 1);
    addCards({ section: '101', row: 1 });
    make();
    const seen = vi.fn();
    const unsubscribe = app.subscribe(seen);

    app.start();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].status).toMatchObject({ isComplete: true });

    unsubscribe();
    addCards({ section: '205', row: 4 });
    await settle();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('opens the page\'s VIP row itself, with no banner of ours (scrolling the cards)', () => {
    document.body.innerHTML = '';
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div data-testid="quickpicksList"><div><button><svg class="StarCircledFilledIcon___X"></svg><span><span>VIP Packages</span><span>€100.00 each</span></span><span>Show Tickets</span></button></div></div>'
    );
    addLoadedLabel(1, 1);
    const pressed = vi.fn();
    document.querySelector('button').addEventListener('click', pressed);
    make();
    app.start();

    expect(pressed).toHaveBeenCalledTimes(1);
    expect(q('.vip-row')).toBeNull();
  });
});

describe('the venue\'s seat map', () => {
  /** An app that tells the map about its sections. */
  function makeMapped(settings = {}) {
    const onSections = vi.fn();
    const onSectionHover = vi.fn();
    app = createApp({ settings: normalizeSettings({ loadMode: 'scroll', ...settings }), version: '1.2.3', onSections, onSectionHover });
    document.body.append(app.root);
    return { onSections, onSectionHover };
  }
  const last = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0];

  it('hears about every section, which of them still show tickets, and whether everything has loaded', () => {
    sampleCards();
    const { onSections } = makeMapped();
    app.start();
    const state = last(onSections);
    expect(state.sections.map((s) => s.name)).toEqual(['101', '102', 'PIT']);
    expect(state.sections[0].tickets).toHaveLength(2);
    expect([...state.visible].sort()).toEqual(['101', '102', 'PIT']);
    expect(state.ready).toBe(true);
  });

  it('hears which sections the filters leave out', () => {
    sampleCards();
    const { onSections } = makeMapped();
    app.start();
    qa('.pill').find((p) => p.getAttribute('data-badge') === 'resale').click(); // show only resale tickets: section 102
    const state = last(onSections);
    expect(state.sections.map((s) => s.name)).toEqual(['101', '102', 'PIT']); // every section still, so a block stays linked
    expect([...state.visible]).toEqual(['102']);
  });

  it('says the list is not ready while tickets are still loading', () => {
    addLoadedLabel(4, 84);
    addCards({ section: '101', row: 12, price: 90 });
    const { onSections } = makeMapped();
    app.start();
    expect(last(onSections).ready).toBe(false);
  });

  it('hears nothing before there are tickets', () => {
    const { onSections } = makeMapped();
    app.start();
    expect(onSections).not.toHaveBeenCalled();
  });

  it('tells the map when the mouse goes over a section in the list', () => {
    sampleCards();
    const { onSectionHover } = makeMapped();
    app.start();
    q('.section').dispatchEvent(new MouseEvent('mouseenter'));
    expect(onSectionHover).toHaveBeenLastCalledWith('PIT', false); // the first section in the list, closed
    q('.section').dispatchEvent(new MouseEvent('mouseleave'));
    expect(onSectionHover).toHaveBeenLastCalledWith(null, false);
  });

  it('outlines a section when the mouse is over its block, and opens it when the block is clicked', () => {
    sampleCards();
    makeMapped();
    app.start();
    app.highlightSection('102');
    expect(qa('.section.map-hover').map((s) => s.getAttribute('data-section'))).toEqual(['102']);
    app.highlightSection(null);
    expect(qa('.section.map-hover')).toHaveLength(0);
    expect(app.openSection('102')).toBe(true);
    expect(qa('.section').find((s) => s.getAttribute('data-section') === '102').open).toBe(true);
    expect(app.openSection('NOWHERE')).toBe(false);
  });

  it('tells the map when the mouse goes onto a ticket, with the ticket, and off it', () => {
    sampleCards();
    const onTicketHover = vi.fn();
    app = createApp({ settings: normalizeSettings({ loadMode: 'scroll' }), version: '1.2.3', onTicketHover });
    document.body.append(app.root);
    app.start();
    app.openSection('101');
    const card = qa('.section[data-section="101"] .ticket')[0];
    card.dispatchEvent(new MouseEvent('mouseenter'));
    expect(onTicketHover).toHaveBeenLastCalledWith(expect.objectContaining({ section: '101' }));
    card.dispatchEvent(new MouseEvent('mouseleave'));
    expect(onTicketHover).toHaveBeenLastCalledWith(null);
  });

  it('shows what the map\'s grey blocks mean, when it is told to', () => {
    sampleCards();
    make();
    app.start();
    app.setMapNote('Seat map: 2 blocks greyed, with no tickets matching your filters.');
    expect(q('.map-note').textContent).toContain('2 blocks greyed');
    app.setMapNote(null);
    expect(q('.map-note').hidden).toBe(true);
  });

  it('works without a map to tell (no callbacks)', () => {
    sampleCards();
    make();
    expect(() => app.start()).not.toThrow();
    expect(() => q('.section').dispatchEvent(new MouseEvent('mouseenter'))).not.toThrow();
  });
});

describe('text size', () => {
  const lastScale = () => app.root.style.getPropertyValue('--sv-scale');

  it('matches Ticketmaster\'s text size once it has been measured from the page', () => {
    sampleCards();
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ fontSize: '18px', overflowY: 'visible', position: 'static', backgroundColor: '', getPropertyValue: () => '' }));
    make();
    app.start();
    expect(lastScale()).toBe('1.38');
  });

  it('uses a typical size before anything has been measured', () => {
    make();
    expect(lastScale()).toBe('1.25');
  });

  it('compact keeps the original size, comfort is larger than match', () => {
    make({ uiSize: 'compact' });
    expect(lastScale()).toBe('1');
    app.setUiSize('comfort');
    expect(Number(lastScale())).toBeGreaterThan(1.25);
    app.setUiSize('match');
    expect(lastScale()).toBe('1.25');
  });
});

describe('following Ticketmaster\'s sort', () => {
  const realPane = () => {
    document.body.innerHTML = '';
    document.body.insertAdjacentHTML('beforeend', fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/quickpicks-pane.html'), 'utf8'));
  };
  const sortRow = () => app.root.querySelector('[data-sort="row"]').parentElement;
  const setTmSort = (text) => {
    document.querySelector('[class*="ArrowExchangeIcon"]').closest('button').querySelector('span > span').textContent = text;
  };

  it('takes the sort from Ticketmaster and hides its own chips', () => {
    realPane();
    make({ sort: 'row' });
    app.configure({ followPageSort: true });
    app.start();

    expect(app.root.querySelector('[data-sort="price"]').getAttribute('aria-pressed')).toBe('true'); // "Lowest Price"
    expect(sortRow().hidden).toBe(true);
  });

  it('re-sorts when Ticketmaster\'s sort changes', async () => {
    vi.useFakeTimers();
    realPane();
    make();
    app.configure({ followPageSort: true });
    app.start();

    setTmSort('Best Seats');
    document.body.append(document.createElement('div'));
    await settle();

    expect(app.root.querySelector('[data-sort="row"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('does not save the sort it took from Ticketmaster as the user\'s own', async () => {
    realPane();
    make({ sort: 'row' });
    app.configure({ followPageSort: true });
    app.start();
    await flush();
    expect(peekStorage('sort')).toBeUndefined();
  });

  it('keeps its own chips when it cannot read Ticketmaster\'s sort', () => {
    realPane();
    setTmSort('Plus récents');
    make({ sort: 'price' });
    app.configure({ followPageSort: true });
    app.start();

    expect(sortRow().hidden).toBe(false);
    expect(app.root.querySelector('[data-sort="price"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows its own chips when not following (the floating pane)', () => {
    realPane();
    make();
    app.configure({ followPageSort: false });
    app.start();
    expect(sortRow().hidden).toBe(false);
  });
});

describe('venues with lettered rows', () => {
  const page = () => {
    document.body.insertAdjacentHTML('afterbegin', '<div id="header"><a href="/royal-hall-tickets/venue/321">Royal Hall</a></div>');
    addLoadedLabel(6, 6);
    return addCards(
      { section: 'STALLS', row: 'A', price: 80 },
      { section: 'STALLS', row: 'B', price: 80 },
      { section: 'STALLS', row: 'J', price: 80 },
      { section: 'GRAND', row: 'K', price: 60 },
      { section: 'GRAND', row: 'L', price: 60 },
      { section: 'GRAND', row: 'N', price: 60 }
    );
  };
  /** The first / front row badges on a row's heading. */
  const placeBadges = (row) => {
    const g = qa('.row-group').find((x) => x.querySelector('.row-title').textContent === 'Row ' + row);
    return [...g.querySelectorAll('.row-head .badge')].map((b) => b.textContent);
  };
  const bestLabels = () => qa('.best').map((b) => b.textContent);

  it('Row A is the first row and the next few are front rows, with nothing saved', () => {
    page();
    make();
    app.start();
    expect(placeBadges('A')).toEqual(['🥇 1st Row']);
    expect(placeBadges('B')).toEqual(['⭐ 2nd Row']);
    expect(placeBadges('J')).toEqual([]); // the 10th
    expect(placeBadges('K')).toEqual([]); // the 11th
  });

  it('follows tiers set in letters from the venue panel, and stores them as typed', async () => {
    page();
    make();
    app.start();
    q('.venue-btn').click();
    q('.venue-input[aria-label="Tiers start at row"]').value = 'k, a';
    q('.venue-input[aria-label="Front rows"]').value = '2';
    q('.venue-save').click();

    expect(placeBadges('A')).toEqual(['🥇 1st Row']);
    expect(placeBadges('K')).toEqual(['🥇 1st Row']);
    expect(placeBadges('L')).toEqual(['⭐ 2nd Row']);
    expect(placeBadges('N')).toEqual([]);
    await flush();
    expect(peekStorage('venue:321').firstRows).toEqual(['A', 'K']);

    q('.venue-btn').click();
    expect(q('.venue-input[aria-label="Tiers start at row"]').value).toBe('A, K');
  });

  it('says the place in each section\'s label, and what the tier starts at in the tooltip', async () => {
    page();
    await saveVenue('321', { name: 'Royal Hall', firstRows: ['A', 'K'] });
    make();
    app.start();
    await flush();

    expect(bestLabels()).toEqual(['Row: A (1st), €80.00', 'Row: K (1st), €60.00']);
    const l = qa('.row-group').find((x) => x.querySelector('.row-title').textContent === 'Row L');
    expect([...l.querySelectorAll('.row-head .badge')].find((b) => /Row$/.test(b.textContent)).title).toBe('Row L is the 2nd row of its tier (which starts at Row K)');
  });

  it('asks for letters or numbers, not a mix', () => {
    page();
    make();
    app.start();
    q('.venue-btn').click();
    q('.venue-input[aria-label="Tiers start at row"]').value = '21, K';
    q('.venue-save').click();
    expect(q('.venue-message').textContent).toContain('letters');
    expect(q('.venue-panel').hidden).toBe(false);
  });
});

describe('tickets read from the list API', () => {
  const pick = (n, attributes = []) => ({
    id: 'p' + n, type: 'seat', section: 'BLOCKE', row: String(23 + n), seatFrom: '10', seatTo: '11', name: 'Full Price Ticket', originalPrice: 94.8, quality: 0.48, attributes,
  });

  /** An app in API mode, whose API source says it has read these picks (and the page's cards agree). */
  function makeApiApp(picks, settings = {}) {
    addLoadedLabel(1, picks.length);
    addCards({ section: 'BLOCKE', row: 23, price: 94.8 });
    const state = { phase: 'ready', signature: 's', qty: 1, loaded: picks.length, total: picks.length, tickets: [], picks, currency: '', error: null };
    const apiSource = { start: vi.fn(), stop: vi.fn(), reload: vi.fn(), state: () => state };
    app = createApp({ settings: normalizeSettings({ loadMode: 'api', ...settings }), version: '1.2.3', readerDeps: { apiSource } });
    document.body.append(app.root);
    app.start();
    return apiSource;
  }

  it('lists them all, with seat numbers and quality, though the page only has one card', () => {
    makeApiApp([pick(0), pick(1), pick(2)]);
    expect(qa('.ticket')).toHaveLength(3);
    expect(qa('.ticket-title').map((t) => t.textContent).sort()).toEqual(['Row 23', 'Row 24', 'Row 25']);
    expect(qa('.ticket-seats').map((t) => t.textContent)).toEqual(['Seats 10-11', 'Seats 10-11', 'Seats 10-11']);
    expect(qa('.ticket-seat-count')[0].textContent).toBe('(2 seats)');
    expect(qa('.ticket-badge-line .badge')[0].textContent).toBe('💎 Top 10% (0.48)'); // all the same score, so all in the best share
    expect(q('.status').title).toContain('Read directly');
    expect(q('.status').textContent).toBe('✓ All 3 Loaded (API)');
  });

  it('says (API) on the chip while the API is still being read and the page\'s own cards are what is shown', () => {
    addLoadedLabel(1, 84);
    addCards({ section: 'BLOCKE', row: 23, price: 94.8 });
    const state = { phase: 'loading', signature: 's', qty: 1, loaded: 20, total: 84, tickets: [], picks: [], partial: [], currency: '', error: null };
    const apiSource = { start: vi.fn(), stop: vi.fn(), reload: vi.fn(), state: () => state };
    app = createApp({ settings: normalizeSettings({ loadMode: 'api' }), version: '1.2.3', readerDeps: { apiSource } });
    document.body.append(app.root);
    app.start();
    expect(q('.status').dataset.state).toBe('loading');
    expect(q('.status').textContent).toBe('⏳ Loading 20/84 (API)');
  });

  it('says (Scroll) once it has fallen back to scrolling, and why on hover', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    addLoadedLabel(1, 1);
    addCards({ section: 'BLOCKE', row: 23, price: 94.8 });
    const state = { phase: 'failed', signature: 's', qty: 1, loaded: 0, total: 0, tickets: [], picks: [], partial: [], currency: '', error: 'HTTP 403' };
    const apiSource = { start: vi.fn(), stop: vi.fn(), reload: vi.fn(), state: () => state };
    app = createApp({ settings: normalizeSettings({ loadMode: 'api' }), version: '1.2.3', readerDeps: { apiSource } });
    document.body.append(app.root);
    app.start();
    expect(q('.status').textContent).toBe('✓ All 1 Loaded (Scroll)');
    expect(q('.status').title).toContain('reading it failed: HTTP 403');
  });

  it('gets a filter pill per attribute, before the user\'s own badges, and filters on it', async () => {
    makeApiApp([pick(0), pick(1, ['aisle']), pick(2, ['aisle', 'wheelchair'])], { customBadges: [{ id: 'c1', label: 'Mine', icon: '🔖', color: 'teal', pattern: 'zzz' }] });
    expect(qa('.pill.custom').map((p) => p.textContent)).toEqual(['🚶 Aisle (2)', '🔹 Wheelchair (1)', '🔖 Mine (0)']);

    q('[data-badge="attr:aisle"]').click();
    expect(qa('.ticket-title').map((t) => t.textContent).sort()).toEqual(['Row 24', 'Row 25']);
    await flush();
    expect(peekStorage('badgeFilters')).toEqual(['attr:aisle']);
    expect(qa('.badge').map((b) => b.textContent)).toContain('🚶 Aisle');
  });

  it('shows every attribute that comes back, with how many tickets have it and what the API called it', () => {
    makeApiApp([pick(0, ['aisle']), pick(1, ['restrictedView', 'aisle']), pick(2, ['Restricted_View']), pick(3, [{ name: 'wheelchair' }, { weird: true }])]);
    const pills = qa('.pill.custom');
    expect(pills.map((p) => p.textContent)).toEqual(['🔹 {"weird":true} (1)', '🚶 Aisle (2)', '🔹 Restricted view (2)', '🔹 Wheelchair (1)']);
    expect(pills[1].title).toBe('Attribute from Ticketmaster: "aisle" — on 2 tickets\nClick to show only these tickets');
    expect(pills[2].title).toBe('Attribute from Ticketmaster: "restrictedView", "Restricted_View" — on 2 tickets\nClick to show only these tickets');
    expect(pills[3].title).toBe('Attribute from Ticketmaster: "wheelchair" — on 1 ticket\nClick to show only these tickets');
  });

  describe('the quality choice', () => {
    const scored = (n, quality) => ({ ...pick(n), quality });
    const eight = () => Array.from({ length: 8 }, (_, i) => scored(i, (i + 1) / 10)); // .1 .. .8
    const titles = () => qa('.ticket-title').map((t) => t.textContent.replace(/ •.*/, '')).sort();

    it('is there, with counts, when the tickets have quality scores', () => {
      makeApiApp(eight());
      expect(q('[data-group="quality"]').hidden).toBe(false);
      expect(qa('[data-quality]').map((p) => p.textContent)).toEqual(['Any (8)', '💎 Top 10% (1)', '🌟 Top 25% (2)', '✨ Top 50% (4)']);
      expect(q('[data-quality="any"]').getAttribute('aria-checked')).toBe('true');
    });

    it('keeps the best share of the tickets, and saves the choice', async () => {
      makeApiApp(eight());
      q('[data-quality="top25"]').click();
      expect(titles()).toEqual(['Row 29', 'Row 30']); // scores .8 and .7: rows 23 + 7 and 23 + 6
      expect(q('[data-quality="top25"]').getAttribute('aria-checked')).toBe('true');
      await flush();
      expect(peekStorage('qualityFilter')).toBe('top25');
      expect(peekStorage('seatFilter')).toBe('all'); // all saved together
    });

    it('comes back as it was saved', () => {
      makeApiApp(eight(), { qualityFilter: 'top50' });
      expect(q('[data-quality="top50"]').getAttribute('aria-checked')).toBe('true');
      expect(qa('.ticket')).toHaveLength(4);
    });

    it('is not shown, and filters nothing, when the tickets have no scores (the scrolling fallback)', () => {
      sampleCards();
      make({ qualityFilter: 'top10' });
      app.start();
      expect(q('[data-group="quality"]').hidden).toBe(true);
      expect(sectionNames()).toHaveLength(3);
    });
  });

  it('can hide the tickets with an attribute: click the pill until it is struck through', async () => {
    makeApiApp([pick(0), pick(1, ['aisle']), pick(2, ['aisle', 'wheelchair']), pick(3)]);
    const aisle = () => q('[data-badge="attr:aisle"]');
    expect(qa('.ticket')).toHaveLength(4);

    aisle().click(); // only the aisle tickets
    expect(qa('.ticket')).toHaveLength(2);
    expect(aisle().getAttribute('data-state')).toBe('show');

    aisle().click(); // none of them
    expect(aisle().getAttribute('data-state')).toBe('hide');
    expect(aisle().textContent).toBe('🚫 Aisle (2)');
    expect(qa('.ticket')).toHaveLength(2);
    expect(qa('.ticket-title').map((t) => t.textContent).sort()).toEqual(['Row 23', 'Row 26']);
    expect(q('.counter').textContent).toContain('2 hidden by filters');
    await flush();
    expect(peekStorage('hideFilters')).toEqual(['attr:aisle']);
    expect(peekStorage('badgeFilters')).toEqual([]);

    aisle().click();
    expect(aisle().getAttribute('data-state')).toBe('off');
    expect(qa('.ticket')).toHaveLength(4);
    expect(q('.counter').textContent).not.toContain('hidden');
  });

  it('keeps hiding a saved attribute on a page where it comes and goes (quantity changes the tickets)', () => {
    makeApiApp([pick(0), pick(1, ['aisle'])], { hideFilters: ['attr:aisle'] });
    expect(qa('.ticket')).toHaveLength(1);
    expect(q('[data-badge="attr:aisle"]').getAttribute('data-state')).toBe('hide');
  });

  it('a regular expression badge can match an attribute too', () => {
    makeApiApp([pick(0), pick(1, ['aisle'])], { customBadges: [{ id: 'c1', label: 'Aisle seat', icon: '🔖', color: 'teal', pattern: 'aisle' }] });
    expect(qa('.badge').filter((b) => b.textContent === '🔖 Aisle seat')).toHaveLength(1);
  });

  it('changes how it loads when the setting changes', () => {
    const api = makeApiApp([pick(0)]);
    app.updateSettings(normalizeSettings({ loadMode: 'scroll' }));
    expect(api.stop).toHaveBeenCalled();
  });
});

describe('custom badges', () => {
  const VENUE = { id: '197033', name: '3Arena, Dublin' };
  const aisle = { id: 'aisle1', label: 'Aisle', icon: '🚶', color: 'blue', pattern: 'aisle' };
  const restricted = { id: 'restr', label: 'Restricted', icon: '👁️', color: 'red', pattern: 'restricted' };
  const page = () => {
    document.body.insertAdjacentHTML('afterbegin', '<div id="header"><a href="/3arena-tickets-dublin/venue/197033">3Arena, Dublin</a></div>');
    addLoadedLabel(3, 3);
    return addCards(
      { section: 'BLOCKG', row: 23, price: 90.75, packageTitle: 'Aisle Seating Ticket' },
      { section: 'BLOCKG', row: 24, price: 80.75 },
      { section: 'BLOCKH', row: 40, price: 60, packageTitle: 'Restricted View Ticket' }
    );
  };
  const titles = () => qa('.ticket-title').map((t) => t.textContent.replace(/ \(.*/, ''));
  // all the badges a ticket carries: the ones on its card, and its row's first / front row badge
  const badgesOf = (title) => {
    const card = qa('.ticket').find((t) => t.querySelector('.ticket-title').textContent.startsWith(title));
    const head = card.closest('.row-group') ? [...card.closest('.row-group').querySelectorAll('.row-head .badge')] : [];
    return [...head, ...card.querySelectorAll('.badge')].map((b) => b.textContent);
  };
  const pill = (key) => q(`[data-badge="${key}"]`);

  it('does nothing without any', () => {
    page();
    make();
    app.start();
    expect(qa('.pill.custom')).toHaveLength(0);
    expect(qa('.badge').map((b) => b.textContent).join()).not.toContain('Aisle');
  });

  it('shows, in the venue panel, how many of the page\'s tickets a pattern matches, and what their text looks like', () => {
    page();
    make({ customBadges: [] });
    app.start();
    q('.venue-btn').click();
    q('.venue-panel .be-add').click();
    const pattern = q('.venue-panel .be-pattern');
    pattern.value = 'aisle';
    pattern.dispatchEvent(new Event('input', { bubbles: true }));

    expect(q('.venue-panel .be-count').textContent).toBe('Matches 1 of the 3 tickets here.');
    expect(q('.venue-panel .be-sample').hidden).toBe(false);
    expect(q('.venue-panel .be-sample').textContent).toContain('Section BLOCKG Row');

    pattern.value = 'Row. *Aisle';
    pattern.dispatchEvent(new Event('input', { bubbles: true }));
    expect(q('.venue-panel .be-count').textContent).toBe('Matches none of the 3 tickets here.');
    expect(q('.venue-panel .be-warn').textContent).toContain('.*');
  });

  it('matches what the list shows as well as the card: brackets in the title (Row 23 (Aisle Seating Ticket)) count', () => {
    page();
    make({ customBadges: [{ id: 'p', label: 'Paren', icon: '🔖', color: 'orange', pattern: '\\(Aisle Seating Ticket\\)' }] });
    app.start();
    expect(badgesOf('Row 23')).toContain('🔖 Paren');
    expect(badgesOf('Row 24')).not.toContain('🔖 Paren');

    q('.venue-btn').click();
    expect(q('.venue-panel .be-sample').textContent).toContain('As Section View lists it: Row');
  });

  it('badges the matching tickets and offers a filter for it', () => {
    page();
    make({ customBadges: [aisle] });
    app.start();

    expect(badgesOf('Row 23')).toContain('🚶 Aisle');
    expect(badgesOf('Row 24')).not.toContain('🚶 Aisle');
    expect(qa('.pill.custom').map((p) => p.textContent)).toEqual(['🚶 Aisle (1)']);

    pill('custom:aisle1').click();
    expect(titles()).toEqual(['Row 23']);
    expect(pill('custom:aisle1').getAttribute('aria-pressed')).toBe('true');
  });

  it('remembers the filter', async () => {
    page();
    make({ customBadges: [aisle] });
    app.start();
    pill('custom:aisle1').click();
    await flush();
    expect(peekStorage('badgeFilters')).toEqual(['custom:aisle1']);
  });

  it('starts with a saved custom filter applied', () => {
    page();
    make({ customBadges: [aisle], badgeFilters: ['custom:aisle1'] });
    app.start();
    expect(titles()).toEqual(['Row 23']);
    expect(pill('custom:aisle1').getAttribute('aria-pressed')).toBe('true');
  });

  it('ignores a saved filter for a badge that no longer exists, rather than hiding everything', () => {
    page();
    make({ badgeFilters: ['custom:gone'] });
    app.start();
    expect(titles()).toHaveLength(3);
  });

  it('follows changes to the global badges', () => {
    page();
    make();
    app.start();
    app.updateSettings(normalizeSettings({ customBadges: [aisle] }));
    expect(badgesOf('Row 23')).toContain('🚶 Aisle');

    app.updateSettings(normalizeSettings({ customBadges: [{ ...aisle, label: 'Aisle seat' }] }));
    expect(qa('.pill.custom').map((p) => p.textContent)).toEqual(['🚶 Aisle seat (1)']);

    app.updateSettings(normalizeSettings({ customBadges: [] }));
    expect(qa('.pill.custom')).toHaveLength(0);
    expect(badgesOf('Row 23')).not.toContain('🚶 Aisle');
  });

  it('adds the venue\'s own badges to the global ones', async () => {
    page();
    await saveVenue(VENUE.id, { name: VENUE.name, badges: [restricted] });
    make({ customBadges: [aisle] });
    app.start();
    await flush();

    expect(qa('.pill.custom').map((p) => p.textContent)).toEqual(['🚶 Aisle (1)', '👁️ Restricted (1)']);
    expect(badgesOf('Row 40')).toContain('👁️ Restricted');
    expect(badgesOf('Row 23')).toContain('🚶 Aisle');

    pill('custom:restr').click();
    expect(titles()).toEqual(['Row 40']);
  });

  it('saving a venue badge from the panel applies at once and is stored for the venue', async () => {
    page();
    make();
    app.start();
    await flush();
    expect(badgesOf('Row 40')).not.toContain('👁️ Restricted');

    q('.venue-btn').click();
    q('.venue-panel .be-add').click();
    q('.venue-panel .be-row:last-child .be-label').value = 'Restricted';
    q('.venue-panel .be-row:last-child .be-icon').value = '👁️';
    q('.venue-panel .be-row:last-child .be-pattern').value = 'restricted';
    q('.venue-save').click();

    expect(badgesOf('Row 40')).toContain('👁️ Restricted');
    expect(qa('.pill.custom')).toHaveLength(1);
    await flush();
    expect(peekStorage('venue:197033').badges).toEqual([expect.objectContaining({ label: 'Restricted', pattern: 'restricted', icon: '👁️' })]);
  });

  it('the venue\'s badges are not used at another venue', async () => {
    page();
    await saveVenue(VENUE.id, { name: VENUE.name, badges: [restricted] });
    make({ badgeFilters: ['custom:restr'] });
    app.start();
    await flush();
    expect(titles()).toEqual(['Row 40']);

    document.querySelector('#header a').setAttribute('href', '/other-tickets/venue/555');
    app.stop();
    app.start();
    await flush();

    expect(qa('.pill.custom')).toHaveLength(0);
    expect(titles()).toHaveLength(3); // the filter is for a badge this venue doesn't have, so it's ignored
  });

  it('picks up edits to the venue\'s badges made elsewhere', async () => {
    page();
    make();
    app.start();
    await flush();
    app.handleStorageChange({ 'venue:197033': { newValue: { name: VENUE.name, firstRows: [1], badges: [restricted] } } });
    expect(badgesOf('Row 40')).toContain('👁️ Restricted');
    expect(qa('.pill.custom')).toHaveLength(1);
  });

  it('resetting the venue takes its badges away but keeps the global ones', async () => {
    page();
    await saveVenue(VENUE.id, { name: VENUE.name, badges: [restricted] });
    make({ customBadges: [aisle] });
    app.start();
    await flush();
    q('.venue-btn').click();
    q('.venue-reset').click();
    expect(qa('.pill.custom').map((p) => p.textContent)).toEqual(['🚶 Aisle (1)']);
  });
});

describe('venue settings', () => {
  const VENUE = { id: '197033', name: '3Arena, Dublin' };
  const venuePage = () => {
    document.body.insertAdjacentHTML('afterbegin', '<div id="header"><a href="/3arena-tickets-dublin/venue/197033">3Arena, Dublin</a></div>');
    addLoadedLabel(6, 6);
    // lower tier from Row 21, upper tier from Row 33 (3Arena)
    return addCards(
      { section: 'BLOCKA', row: 21, price: 80 },
      { section: 'BLOCKA', row: 23, price: 80 },
      { section: 'BLOCKA', row: 27, price: 80 },
      { section: 'BLOCKH', row: 33, price: 60 },
      { section: 'BLOCKH', row: 34, price: 60 },
      { section: 'BLOCKH', row: 45, price: 60 }
    );
  };
  const rowTitles = () => qa('.ticket-title').map((t) => t.textContent);
  // the first / front row badge is on the heading of the row
  const badgeTexts = () => qa('.row-group').map((g) => [g.querySelector('.row-title').textContent, [...g.querySelectorAll('.row-head .badge')].map((b) => b.textContent)]);
  const rowBadge = (row) => badgeTexts().find(([title]) => title === 'Row ' + row)[1];
  const pressed = (key) => q(`[data-badge="${key}"]`).getAttribute('aria-pressed') === 'true';

  it('shows the venue button once the page names a venue', () => {
    venuePage();
    make();
    expect(q('.venue-btn').hidden).toBe(true);
    app.start();
    expect(q('.venue-btn').hidden).toBe(false);
    expect(q('.venue-btn').title).toBe('Venue settings: 3Arena, Dublin');
  });

  it('has no venue button on a page with no venue', () => {
    sampleCards();
    make();
    app.start();
    expect(q('.venue-btn').hidden).toBe(true);
  });

  it('with nothing saved, rows count from Row 1, so none of 3Arena\'s rows is a first or front row', () => {
    venuePage();
    make();
    app.start();
    qa('.ticket').forEach((t) => expect(t.textContent).not.toMatch(/1st Row|\dth Row|\dnd Row|\drd Row/));
  });

  it('uses the venue\'s saved tiers: Row 21 and Row 33 are first rows, and their neighbours are front rows', async () => {
    venuePage();
    await saveVenue(VENUE.id, { name: VENUE.name, firstRows: [21, 33], frontRows: 3 });
    make();
    app.start();
    await flush();

    expect(rowBadge(21)).toEqual(['🥇 1st Row']);
    expect(rowBadge(23)).toEqual(['⭐ 3rd Row']);
    expect(rowBadge(27)).toEqual([]);
    expect(rowBadge(33)).toEqual(['🥇 1st Row']);
    expect(rowBadge(34)).toEqual(['⭐ 2nd Row']);
    expect(rowBadge(45)).toEqual([]);
  });

  it('the 1st Row and Front Rows filters use them', async () => {
    venuePage();
    await saveVenue(VENUE.id, { firstRows: [21, 33], frontRows: 3 });
    make();
    app.start();
    await flush();

    q('[data-seat="firstrow"]').click();
    expect(rowTitles()).toEqual(['Row 21', 'Row 33']);

    q('[data-seat="frontrows"]').click();
    expect(rowTitles().sort()).toEqual(['Row 21', 'Row 23', 'Row 33', 'Row 34']);
  });

  it('saving from the panel applies at once and is stored for next time', async () => {
    venuePage();
    make();
    app.start();
    q('.venue-btn').click();
    q('.venue-input[aria-label="Tiers start at row"]').value = '21, 33';
    q('.venue-input[aria-label="Front rows"]').value = '2';
    q('.venue-save').click();

    expect(rowBadge(21)).toEqual(['🥇 1st Row']);
    expect(rowBadge(23)).toEqual([]); // the 3rd row of its tier: not a front row when only 2 count
    await flush();
    expect(peekStorage('venue:197033')).toEqual({ name: '3Arena, Dublin', firstRows: [21, 33], frontRows: 2, badges: [] });
  });

  it('resetting forgets the venue\'s settings', async () => {
    venuePage();
    await saveVenue(VENUE.id, { name: VENUE.name, firstRows: [21, 33] });
    make();
    app.start();
    await flush();
    expect(rowBadge(21)).toEqual(['🥇 1st Row']);

    q('.venue-btn').click();
    q('.venue-reset').click();

    expect(rowBadge(21)).toEqual([]);
    await flush();
    expect(peekStorage('venue:197033')).toBeUndefined();
  });

  it('picks up changes made elsewhere (another tab, the options page)', async () => {
    venuePage();
    make();
    app.start();
    await flush();
    expect(rowBadge(21)).toEqual([]);

    app.handleStorageChange({ 'venue:197033': { oldValue: undefined, newValue: { name: VENUE.name, firstRows: [21, 33], frontRows: 4 } } });

    expect(rowBadge(21)).toEqual(['🥇 1st Row']);
    expect(q('.venue-input[aria-label="Tiers start at row"]').value).toBe('21, 33');
  });

  it('ignores storage changes for other venues and for unrelated settings', async () => {
    venuePage();
    make();
    app.start();
    await flush();
    app.handleStorageChange({ 'venue:999': { newValue: { firstRows: [21, 33] } }, sort: { newValue: 'price' } });
    expect(rowBadge(21)).toEqual([]);
  });

  it('a venue can set its own number of front rows, otherwise the global default applies', async () => {
    venuePage();
    await saveVenue(VENUE.id, { firstRows: [21, 33] }); // no frontRows of its own
    make({ frontRows: 2 });
    app.start();
    await flush();
    expect(rowBadge(23)).toEqual([]); // global default 2: Row 23 is the 3rd

    app.updateSettings(normalizeSettings({ frontRows: 3 }));
    expect(rowBadge(23)).toEqual(['⭐ 3rd Row']);

    app.handleStorageChange({ 'venue:197033': { newValue: { firstRows: [21, 33], frontRows: 1 } } });
    expect(rowBadge(23)).toEqual([]);
    expect(rowBadge(21)).toEqual(['🥇 1st Row']);
    expect(rowBadge(34)).toEqual([]);
  });

  it('the placeholder in the panel follows the global default', async () => {
    venuePage();
    make({ frontRows: 7 });
    app.start();
    await flush();
    expect(q('.venue-input[aria-label="Front rows"]').placeholder).toBe('7');
    app.updateSettings(normalizeSettings({ frontRows: 9 }));
    expect(q('.venue-input[aria-label="Front rows"]').placeholder).toBe('9');
  });

  it('follows the page to a different venue, with that venue\'s own settings', async () => {
    venuePage();
    await saveVenue(VENUE.id, { firstRows: [21, 33] });
    await saveVenue('555', { name: 'Other Arena', firstRows: [10] });
    make();
    app.start();
    await flush();
    expect(rowBadge(21)).toEqual(['🥇 1st Row']);

    document.querySelector('#header a').setAttribute('href', '/other-tickets/venue/555');
    document.querySelector('#header a').textContent = 'Other Arena';
    app.stop();
    app.start();
    await flush();

    expect(q('.venue-btn').title).toBe('Venue settings: Other Arena');
    expect(rowBadge(21)).toEqual([]); // 21 is the 12th row of a tier starting at 10
    expect(q('.venue-input[aria-label="Tiers start at row"]').value).toBe('10');
  });

  it('does not let a slow load overwrite what was saved from the panel in the meantime', async () => {
    venuePage();
    await saveVenue(VENUE.id, { name: VENUE.name, firstRows: [33] });
    make();
    app.start(); // loading the saved settings...
    q('.venue-btn').click();
    q('.venue-input[aria-label="Tiers start at row"]').value = '21';
    q('.venue-save').click(); // ...but they are replaced before it finishes
    await flush();
    expect(rowBadge(21)).toEqual(['🥇 1st Row']);
    q('.venue-btn').click();
    expect(q('.venue-input[aria-label="Tiers start at row"]').value).toBe('21');
  });

  it('does not let a slow load for the old venue overwrite the new one', async () => {
    venuePage();
    await saveVenue(VENUE.id, { firstRows: [21, 33] });
    make();
    app.start(); // starts loading venue 197033's settings...
    document.querySelector('#header a').setAttribute('href', '/other-tickets/venue/555');
    app.stop();
    app.start(); // ...but the page is now at venue 555
    await flush();
    expect(rowBadge(21)).toEqual([]);
  });

  it('does not show a venue editor for a page that has stopped having one', () => {
    venuePage();
    make();
    app.start();
    expect(q('.venue-btn').hidden).toBe(false);
    document.getElementById('header').remove();
    app.stop();
    app.start();
    expect(q('.venue-btn').hidden).toBe(true);
  });
});
