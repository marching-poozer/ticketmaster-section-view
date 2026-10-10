import { createView } from '../src/content/view.js';
import { compileBadges } from '../src/lib/custom-badges.js';
import { buildSectionGroups } from '../src/lib/sections.js';

function makeHandlers() {
  return {
    onSearch: vi.fn(),
    onSeatSelect: vi.fn(),
    onQualitySelect: vi.fn(),
    onPriceSelect: vi.fn(),
    onBadgeCycle: vi.fn(),
    onSort: vi.fn(),
    onQuantityStep: vi.fn(),
    onSaveVenue: vi.fn(),
    onResetVenue: vi.fn(),
    onShowOriginal: vi.fn(),
    onOpenSettings: vi.fn(),
    onSectionHover: vi.fn(),
    onTicketHover: vi.fn(),
    onShowSection: vi.fn(),
    onShowTicket: vi.fn(),
    onAutoZoomChange: vi.fn(),
    onMapReport: vi.fn(() => 'Copied ✓'),
  };
}

function sampleTicket(overrides = {}) {
  return {
    section: '101',
    originalSection: '101',
    row: 3,
    seat: null,
    price: 85,
    currency: '€',
    type: 'standard',
    isResale: false,
    title: 'Row 3',
    ...overrides,
  };
}

function make(handlers = makeHandlers()) {
  const view = createView(handlers, '1.2.3');
  document.body.append(view.root);
  const q = (sel) => view.root.querySelector(sel);
  const qa = (sel) => [...view.root.querySelectorAll(sel)];
  return { view, handlers, q, qa };
}

describe('createView', () => {
  it('shows the version and builds the filter pills in groups: Seats, Quality, Price and Other', () => {
    const { q, qa } = make();
    expect(q('.version').textContent).toBe('v1.2.3');
    expect(qa('.pill-group').map((g) => g.querySelector('.pill-label').textContent)).toEqual(['Seats', 'Quality', 'Price', 'Other']);
    expect(qa('[data-seat]').map((p) => p.textContent)).toEqual(['Any', '🥇 1st Row', '⭐ First 5 Rows']);
    expect(qa('[data-quality]').map((p) => p.textContent)).toEqual(['Any', '💎 Top 10%', '🌟 Top 25%', '✨ Top 50%']);
    expect(qa('[data-price]').map((p) => p.textContent)).toEqual(['Any', '🔥 Cheapest', '💡 Section Low']);
    expect(qa('[data-badge]').map((p) => p.textContent)).toEqual(['🧍 Standing', '🔄 Resale', '👑 VIP Packages']);
  });

  describe('the seat and price choices', () => {
    it('are one choice each, shown as radio buttons', () => {
      const { view, q, qa } = make();
      expect(q('[data-group="seat"] [role="radiogroup"]').getAttribute('aria-label')).toBe('Seats');
      expect(qa('[data-seat]').every((p) => p.getAttribute('role') === 'radio')).toBe(true);

      view.setSeat('frontrows');
      view.setPrice('cheapest');
      expect(qa('[data-seat]').map((p) => p.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
      expect(qa('[data-price]').map((p) => p.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);

      view.setSeat('all');
      expect(qa('[data-seat]').map((p) => p.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    });

    it('are drawn as one pill split into segments', () => {
      const { q, qa } = make();
      expect(qa('.segmented')).toHaveLength(3);
      expect(q('[data-group="quality"] .segmented').querySelectorAll('[data-quality]')).toHaveLength(4);
      expect(q('[data-group="seat"] .segmented').querySelectorAll('[data-seat]')).toHaveLength(3);
      expect(q('[data-group="price"] .segmented').querySelectorAll('[data-price]')).toHaveLength(3);
      expect(q('[data-group="other"] .segmented')).toBeNull(); // the toggles stay separate pills
    });

    it('have one tab stop, on the chosen segment (the first, "no filter", until something is chosen)', () => {
      const { view, qa } = make();
      expect(qa('[data-seat]').map((p) => p.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
      view.setSeat('firstrow');
      expect(qa('[data-seat]').map((p) => p.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    });

    it('move the choice with the arrow keys, wrapping round, and focus the new one', () => {
      const { handlers, view, q } = make();
      view.setSeat('firstrow');
      const press = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

      press(q('[data-seat="firstrow"]'), 'ArrowRight');
      expect(handlers.onSeatSelect).toHaveBeenLastCalledWith('frontrows');
      expect(document.activeElement).toBe(q('[data-seat="frontrows"]'));

      press(q('[data-seat="firstrow"]'), 'ArrowLeft');
      expect(handlers.onSeatSelect).toHaveBeenLastCalledWith('all');

      press(q('[data-seat="all"]'), 'ArrowLeft'); // wraps to the last
      expect(handlers.onSeatSelect).toHaveBeenLastCalledWith('frontrows');
      press(q('[data-seat="frontrows"]'), 'ArrowDown'); // wraps to the first
      expect(handlers.onSeatSelect).toHaveBeenLastCalledWith('all');

      press(q('[data-price="any"]'), 'ArrowUp');
      expect(handlers.onPriceSelect).toHaveBeenLastCalledWith('sectionlow');
    });

    it('leave other keys alone', () => {
      const { handlers, q } = make();
      const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
      q('[data-seat="all"]').dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(handlers.onSeatSelect).not.toHaveBeenCalled();
    });

    it('tell the app which pill was chosen', () => {
      const { handlers, q } = make();
      q('[data-quality="top25"]').click();
      expect(handlers.onQualitySelect.mock.calls).toEqual([['top25']]);
      q('[data-seat="firstrow"]').click();
      q('[data-seat="all"]').click();
      q('[data-price="sectionlow"]').click();
      expect(handlers.onSeatSelect.mock.calls).toEqual([['firstrow'], ['all']]);
      expect(handlers.onPriceSelect.mock.calls).toEqual([['sectionlow']]);
      expect(handlers.onBadgeCycle).not.toHaveBeenCalled();
    });
  });

  describe('the front rows choice', () => {
    it('says how many rows it covers: "First 3 Rows"', () => {
      const { view, q } = make();
      expect(q('[data-seat="frontrows"]').textContent).toBe('⭐ First 5 Rows'); // until told otherwise: the default
      view.setFrontRows(3);
      expect(q('[data-seat="frontrows"]').textContent).toBe('⭐ First 3 Rows');
      view.setFrontRows(12);
      expect(q('[data-seat="frontrows"]').textContent).toBe('⭐ First 12 Rows');
    });

    it('says "Row", not "Rows", for one', () => {
      const { view, q } = make();
      view.setFrontRows(1);
      expect(q('[data-seat="frontrows"]').textContent).toBe('⭐ First 1 Row');
      expect(q('[data-seat="frontrows"]').title).toContain('The first 1 row of each tier');
    });

    it('keeps its count when the number changes, and the count when the number does', () => {
      const { view, q } = make();
      view.setCounts({ seat: { firstrow: 2, frontrows: 18, all: 59 }, price: {}, other: {} });
      expect(q('[data-seat="frontrows"]').textContent).toBe('⭐ First 5 Rows (18)');
      view.setFrontRows(3);
      expect(q('[data-seat="frontrows"]').textContent).toBe('⭐ First 3 Rows (18)');
      view.setCounts({ seat: { firstrow: 2, frontrows: 9, all: 59 }, price: {}, other: {} });
      expect(q('[data-seat="frontrows"]').textContent).toBe('⭐ First 3 Rows (9)');
    });

    it('says on hover how many rows it is and where to change it', () => {
      const { view, q } = make();
      view.setFrontRows(4);
      expect(q('[data-seat="frontrows"]').title).toBe('The first 4 rows of each tier. Change how many with the 📍 button (this venue) or in Settings (the default).');
    });

    it('is still the same choice underneath (the saved key, the handler, the checked state)', () => {
      const { view, handlers, q } = make();
      view.setFrontRows(3);
      q('[data-seat="frontrows"]').click();
      expect(handlers.onSeatSelect).toHaveBeenCalledWith('frontrows');
      view.setSeat('frontrows');
      expect(q('[data-seat="frontrows"]').getAttribute('aria-checked')).toBe('true');
    });
  });

  describe('the quality choice', () => {
    const counts = { seat: { all: 10 }, quality: { any: 10, top10: 1, top25: 3, top50: 5 }, price: {}, other: {} };

    it('is only there when some tickets have a quality score (the list API gives them)', () => {
      const { view, q } = make();
      expect(q('[data-group="quality"]').hidden).toBe(true);
      view.setCounts({ ...counts, quality: null });
      expect(q('[data-group="quality"]').hidden).toBe(true);
      view.setCounts(counts);
      expect(q('[data-group="quality"]').hidden).toBe(false);
      view.setCounts(null);
      expect(q('[data-group="quality"]').hidden).toBe(true);
    });

    it('is one choice, like the others, with counts', () => {
      const { view, q, qa } = make();
      view.setCounts(counts);
      expect(qa('[data-quality]').map((p) => p.textContent)).toEqual(['Any (10)', '💎 Top 10% (1)', '🌟 Top 25% (3)', '✨ Top 50% (5)']);
      view.setQuality('top25');
      expect(qa('[data-quality]').map((p) => p.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false']);
      expect(q('[data-quality="top25"]').getAttribute('tabindex')).toBe('0');
    });
  });

  describe('counts on the pills', () => {
    const counts = { seat: { firstrow: 0, frontrows: 30, all: 311 }, price: { cheapest: 3, sectionlow: 22, any: 311 }, other: { standing: 4, resale: 40, 'attr:aisle': 163 } };

    it('read as "label (count)"', () => {
      const { view, qa } = make();
      view.setCounts(counts);
      expect(qa('[data-seat]').map((p) => p.textContent)).toEqual(['Any (311)', '🥇 1st Row (0)', '⭐ First 5 Rows (30)']);
      expect(qa('[data-price]').map((p) => p.textContent)).toEqual(['Any (311)', '🔥 Cheapest (3)', '💡 Section Low (22)']);
      expect(qa('[data-badge]').map((p) => p.textContent)).toEqual(['🧍 Standing (4)', '🔄 Resale (40)', '👑 VIP Packages']);
    });

    it('count the extra pills too, however they come and go', () => {
      const { view, q } = make();
      view.setCounts(counts);
      view.setCustomBadges([{ key: 'attr:aisle', text: '🚶 Aisle', title: 't' }]);
      expect(q('[data-badge="attr:aisle"]').textContent).toBe('🚶 Aisle (163)');

      view.setCounts({ ...counts, other: { ...counts.other, 'attr:aisle': 7 } });
      expect(q('[data-badge="attr:aisle"]').textContent).toBe('🚶 Aisle (7)');
    });

    it('dim a pill with nothing behind it, unless it is the one chosen', () => {
      const { view, q } = make();
      view.setCounts(counts);
      expect(q('[data-seat="firstrow"]').classList.contains('zero')).toBe(true);
      expect(q('[data-seat="all"]').classList.contains('zero')).toBe(false);
      view.setSeat('firstrow');
      expect(q('[data-seat="firstrow"]').classList.contains('zero')).toBe(true); // still marked; the style leaves a chosen pill alone
      expect(q('[data-seat="firstrow"]').getAttribute('aria-checked')).toBe('true');
    });

    it('show just the labels without counts, and again after they are cleared', () => {
      const { view, qa } = make();
      expect(qa('[data-seat]').map((p) => p.textContent)).toEqual(['Any', '🥇 1st Row', '⭐ First 5 Rows']);
      view.setCounts(counts);
      view.setCounts(null);
      expect(qa('[data-seat]')[1].textContent).toBe('🥇 1st Row');
      expect(qa('[data-badge]')[1].textContent).toBe('🔄 Resale');
    });

    it('leave out a count the app did not give', () => {
      const { view, q } = make();
      view.setCounts({ seat: {}, price: {}, other: {} });
      expect(q('[data-seat="all"]').textContent).toBe('Any');
    });
  });

  describe('custom badge pills', () => {
    const badges = compileBadges([
      { id: 'aisle1', label: 'Aisle', icon: '🚶', color: 'blue', pattern: 'aisle' },
      { id: 'wc', label: 'Wheelchair', icon: '♿', color: 'green', pattern: 'wheelchair' },
    ]);
    const customPills = (qa) => qa('[data-badge].custom');

    it('adds a pill per badge after the built-in ones', () => {
      const { view, qa } = make();
      view.setCustomBadges(badges);
      expect(qa('[data-badge]')).toHaveLength(5); // Standing, Resale and VIP Packages, then these
      expect(customPills(qa).map((p) => p.textContent)).toEqual(['🚶 Aisle', '♿ Wheelchair']);
      expect(customPills(qa).map((p) => p.getAttribute('data-badge'))).toEqual(['custom:aisle1', 'custom:wc']);
      expect(qa('[data-badge]').slice(-2)).toEqual(customPills(qa));
    });

    it('toggles through the same handler as the built-in pills', () => {
      const { view, handlers, q } = make();
      view.setCustomBadges(badges);
      q('[data-badge="custom:aisle1"]').click();
      expect(handlers.onBadgeCycle).toHaveBeenCalledWith('custom:aisle1');
    });

    it('shows which are on, including after the pills are rebuilt', () => {
      const { view, q } = make();
      view.setBadgeFilters(new Set(['resale', 'custom:wc']));
      view.setCustomBadges(badges);
      expect(q('[data-badge="custom:wc"]').getAttribute('aria-pressed')).toBe('true');
      expect(q('[data-badge="custom:aisle1"]').getAttribute('aria-pressed')).toBe('false');

      view.setCustomBadges(badges.slice(1));
      expect(q('[data-badge="custom:wc"]').getAttribute('aria-pressed')).toBe('true');
      view.setBadgeFilters(new Set(['custom:aisle1']));
      expect(q('[data-badge="resale"]').getAttribute('aria-pressed')).toBe('false');
    });

    it('puts a tooltip on a pill that has one, and rebuilds when it changes', () => {
      const { view, q } = make();
      view.setCustomBadges([{ key: 'attr:aisle', text: '🚶 Aisle (2)', title: 'Attribute from Ticketmaster: "aisle" — on 2 tickets' }]);
      expect(q('[data-badge="attr:aisle"]').title).toBe('Attribute from Ticketmaster: "aisle" — on 2 tickets\nClick to show only these tickets');
      view.setCustomBadges([{ key: 'attr:aisle', text: '🚶 Aisle (2)', title: 'changed' }]);
      expect(q('[data-badge="attr:aisle"]').title).toBe('changed\nClick to show only these tickets');
    });

    describe('the three states of an "Other" pill', () => {
      const setup = () => {
        const made = make();
        made.view.setCustomBadges([{ key: 'attr:aisle', text: '🚶 Aisle', title: 'Attribute from Ticketmaster: "aisle"' }]);
        made.view.setCounts({ seat: {}, quality: null, price: {}, other: { resale: 40, 'attr:aisle': 14 } });
        return { ...made, pill: () => made.q('[data-badge="attr:aisle"]') };
      };

      it('is off: plain, saying a click shows only these tickets', () => {
        const { pill } = setup();
        expect(pill().getAttribute('data-state')).toBe('off');
        expect(pill().getAttribute('aria-pressed')).toBe('false');
        expect(pill().hasAttribute('aria-label')).toBe(false);
        expect(pill().textContent).toBe('🚶 Aisle (14)');
        expect(pill().title).toContain('Click to show only these tickets');
      });

      it('shows only its tickets: pressed, saying the next click hides them', () => {
        const { view, pill } = setup();
        view.setBadgeFilters(new Set(['attr:aisle']), new Set());
        expect(pill().getAttribute('data-state')).toBe('show');
        expect(pill().getAttribute('aria-pressed')).toBe('true');
        expect(pill().getAttribute('aria-label')).toBe('Aisle: showing only these');
        expect(pill().textContent).toBe('🚶 Aisle (14)');
        expect(pill().title).toContain('Click to hide them instead');
      });

      it('hides its tickets: 🚫 in place of its icon, still counting how many it hides, and not "pressed"', () => {
        const { view, pill } = setup();
        view.setBadgeFilters(new Set(), new Set(['attr:aisle']));
        expect(pill().getAttribute('data-state')).toBe('hide');
        expect(pill().getAttribute('aria-pressed')).toBe('false');
        expect(pill().getAttribute('aria-label')).toBe('Aisle: hidden');
        expect(pill().textContent).toBe('🚫 Aisle (14)');
        expect(pill().title).toContain('Hiding these tickets. Click to stop');
      });

      it('goes back to plain when cleared', () => {
        const { view, pill } = setup();
        view.setBadgeFilters(new Set(), new Set(['attr:aisle']));
        view.setBadgeFilters(new Set(), new Set());
        expect(pill().textContent).toBe('🚶 Aisle (14)');
        expect(pill().hasAttribute('aria-label')).toBe(false);
      });

      it('works for the built-in Standing pill: hiding it is "seated tickets only"', () => {
        const { view, q } = setup();
        expect(q('[data-badge="standing"]').textContent).toBe('🧍 Standing');
        view.setBadgeFilters(new Set(), new Set(['standing']));
        expect(q('[data-badge="standing"]').textContent).toBe('🚫 Standing');
        expect(q('[data-badge="standing"]').getAttribute('aria-label')).toBe('Standing: hidden');
        view.setBadgeFilters(new Set(['standing']), new Set());
        expect(q('[data-badge="standing"]').getAttribute('data-state')).toBe('show');
      });

      it('works for the built-in Resale pill and without a leading emoji', () => {
        const { view, q } = setup();
        view.setBadgeFilters(new Set(), new Set(['resale']));
        expect(q('[data-badge="resale"]').textContent).toBe('🚫 Resale (40)');
        view.setCustomBadges([{ key: 'custom:x', text: 'Plain name', title: '' }]);
        view.setBadgeFilters(new Set(), new Set(['custom:x']));
        expect(q('[data-badge="custom:x"]').textContent).toBe('🚫 Plain name');
      });

      it('keeps its state when its text is rebuilt, and is not dimmed for having none', () => {
        const { view, pill } = setup();
        view.setCounts({ seat: {}, quality: null, price: {}, other: { 'attr:aisle': 0 } });
        view.setBadgeFilters(new Set(), new Set(['attr:aisle']));
        view.setCounts({ seat: {}, quality: null, price: {}, other: { 'attr:aisle': 0 } });
        expect(pill().textContent).toBe('🚫 Aisle (0)');
        expect(pill().getAttribute('data-state')).toBe('hide');
      });

      it('survives the pills being rebuilt', () => {
        const { view, q } = setup();
        view.setBadgeFilters(new Set(), new Set(['attr:aisle']));
        view.setCustomBadges([{ key: 'attr:aisle', text: '🚶 Aisle', title: 'now different' }]);
        expect(q('[data-badge="attr:aisle"]').getAttribute('data-state')).toBe('hide');
      });

      it('asks the app to move it on when clicked', () => {
        const { handlers, pill } = setup();
        pill().click();
        expect(handlers.onBadgeCycle).toHaveBeenCalledWith('attr:aisle');
      });
    });

    describe('the count of what the filters hide', () => {
      it('is added to the counter when some tickets are hidden', () => {
        const { view, q } = make();
        view.renderCounter(59, 2, 14);
        expect(q('.counter').textContent).toBe('Total Loaded: 59 options (2 per offer) · 14 hidden by filters');
      });

      it('is left out when none are', () => {
        const { view, q } = make();
        view.renderCounter(59, 2, 0);
        expect(q('.counter').textContent).toBe('Total Loaded: 59 options (2 per offer)');
        view.renderCounter(1, 1);
        expect(q('.counter').textContent).toBe('Total Loaded: 1 option (1 per offer)');
      });
    });

    it('removes pills for badges that are gone, and leaves the pills alone when nothing changed', () => {
      const { view, qa } = make();
      view.setCustomBadges(badges);
      const [first] = customPills(qa);
      view.setCustomBadges(badges);
      expect(customPills(qa)[0]).toBe(first);

      view.setCustomBadges([]);
      expect(customPills(qa)).toHaveLength(0);
      expect(qa('[data-badge]')).toHaveLength(3);
    });

    it('shows a ticket\'s matching badges on the ticket', () => {
      const { view, qa } = make();
      const { groups } = buildSectionGroups([sampleTicket({ text: 'Row 3 Aisle Seating Ticket' })], { customBadges: badges });
      view.renderGroups(groups, 'row', () => {});
      expect(qa('.badge').map((b) => b.textContent)).toContain('🚶 Aisle');
    });
  });

  describe('a ticket\'s card', () => {
    const render = (tickets) => {
      const made = make();
      made.view.renderGroups(buildSectionGroups(tickets, { rowConfig: { firstRows: [1], frontRows: 5 } }).groups, 'row', () => {});
      return made;
    };
    const apiTicket = (extra = {}) => sampleTicket({ rowLabel: 'Row 27', rowName: '27', row: 27, seat: '187-188', quality: 0.4, attributes: [], ...extra });
    const lines = (qa) => qa('.ticket-line');

    it('sits under its row\'s heading: the seats and their badges on the left, the price on the right', () => {
      const { qa, q } = render([apiTicket({ title: 'Row 27 • Seat 187-188' }), apiTicket({ seat: '189-190', price: 99 })]);
      expect(qa('.row-group')).toHaveLength(1);
      const heading = q('.row-head');
      expect(heading.querySelector('.row-title').textContent).toBe('Row 27');
      expect(heading.querySelector('.count').textContent).toBe('(2)');

      const ticket = q('.ticket');
      expect(ticket.querySelector('.ticket-row-line')).toBeNull(); // the heading says the row
      expect(ticket.querySelector('.ticket-seat-line .ticket-seats').textContent).toBe('Seats 187-188');
      expect(ticket.querySelector('.ticket-seat-line .ticket-seat-count').textContent).toBe('(2 seats)');
      expect(ticket.querySelector('.ticket-side .ticket-price').textContent).toBe('€85.00');
    });

    it('gives the quality, attributes and your badges a line of their own under the seats and price', () => {
      const { q } = render([apiTicket({ attributes: ['aisle'] })]);
      const lines = [...q('.ticket-main').children].map((c) => c.className);
      expect(lines).toEqual(['ticket-line ticket-seat-line', 'ticket-line ticket-badge-line']);
      expect(q('.ticket-badge-line').textContent).toContain('Aisle');
      expect(q('.ticket-seat-line .badge')).toBeNull();
    });

    it('has no badge line when there are no badges, and puts badges alone on the first line when there are no seats', () => {
      const plain = render([apiTicket({ quality: undefined })]);
      expect([...plain.q('.ticket-main').children].map((c) => c.className)).toEqual(['ticket-line ticket-seat-line']);
      const noSeats = render([apiTicket({ seat: null })]);
      expect(noSeats.q('.ticket-seat-line')).toBeNull();
      expect(noSeats.q('.ticket-badge-line').classList.contains('alone')).toBe(true);
    });

    it('still says its row for anyone who does not see the heading (visually hidden, read by screen readers)', () => {
      const { q } = render([apiTicket()]);
      const hidden = q('.ticket .ticket-title');
      expect(hidden.textContent).toBe('Row 27');
      expect(hidden.classList.contains('visually-hidden')).toBe(true);
    });

    it('says Seat for one seat and Seats for several', () => {
      const { qa } = render([apiTicket({ seat: '187' }), apiTicket({ seat: '12-15', row: 28, rowName: '28', rowLabel: 'Row 28' })]);
      const seats = qa('.ticket-seats').map((e) => e.textContent).sort();
      expect(seats).toEqual(['Seat 187', 'Seats 12-15']);
      expect(qa('.ticket-seat-count').map((e) => e.textContent)).toEqual(['(4 seats)']); // none for the single seat
    });

    it('has no seat line for a ticket with no seats and nothing to say about them', () => {
      const { q } = render([sampleTicket({ rowLabel: 'Row 3' })]);
      expect(q('.ticket').querySelectorAll('.ticket-line')).toHaveLength(0);
      expect(q('.ticket .ticket-price')).not.toBeNull();
    });

    describe('the ticket type', () => {
      it('is Ticketmaster\'s own name for it, after the seats, whatever it is', () => {
        ['Full Price Ticket', 'Aisle Seating Ticket', 'Verified Resale Ticket', 'Trivium Meet & Greet Package'].forEach((type) => {
          const line = render([apiTicket({ ticketType: type })]).q('.ticket-seat-line');
          expect([...line.children].map((c) => c.className)).toEqual(['ticket-seats', 'ticket-seat-count', 'ticket-type']);
          expect(line.querySelector('.ticket-type').textContent).toBe(type);
        });
      });

      it('follows the number of seats when there are several, and the seats when there is one', () => {
        expect(render([apiTicket({ ticketType: 'Full Price Ticket' })]).q('.ticket-seat-line').textContent).toBe('Seats 187-188(2 seats)Full Price Ticket');
        expect(render([apiTicket({ seat: '187', ticketType: 'Full Price Ticket' })]).q('.ticket-seat-line').textContent).toBe('Seat 187Full Price Ticket');
      });

      it('is on its own when there are no seats', () => {
        const bare = render([sampleTicket({ rowLabel: 'Row 3', ticketType: 'Meet & Greet' })]).q('.ticket-seat-line');
        expect(bare.textContent).toBe('Meet & Greet');
      });

      it('is left out when the ticket has none (a card that did not say)', () => {
        expect(render([apiTicket({ ticketType: '' })]).q('.ticket-type')).toBeNull();
        expect(render([apiTicket()]).q('.ticket-type')).toBeNull();
      });
    });

    it('puts the quality badge after the seats, as its share of the event with the score in brackets', () => {
      const tickets = Array.from({ length: 10 }, (_, i) => apiTicket({ rowLabel: 'Row ' + (i + 1), rowName: String(i + 1), row: i + 1, seat: '1-2', quality: (i + 1) / 10 }));
      const { qa } = render(tickets);
      const quality = qa('.ticket-badge-line .badge').map((b) => b.textContent).sort();
      expect(quality).toContain('💎 Top 10% (1.00)');
      expect(quality).toContain('🌟 Top 25% (0.80)');
      expect(quality).toContain('✨ Top 50% (0.60)');
      expect(quality).toContain('Quality (0.30)');
      expect(qa('.ticket-badge-line .badge').every((b) => !b.classList.contains('icon'))).toBe(true); // full text, not just an emoji
    });

    it('explains the quality badge on hover', () => {
      const { q } = render([apiTicket()]);
      expect(q('.ticket-badge-line .badge').title).toBe('Ticketmaster\'s seat quality score is 0.40: in the best 10% of this event\'s tickets');
    });

    it('puts attributes and the user\'s own badges next to the seats', () => {
      const custom = compileBadges([{ id: 'x1', label: 'Mine', icon: '🔖', color: 'teal', pattern: 'row 27' }]);
      const made = make();
      made.view.renderGroups(buildSectionGroups([apiTicket({ attributes: ['aisle'], text: 'Row 27' })], { customBadges: custom }).groups, 'row', () => {});
      expect(made.qa('.ticket-badge-line .badge').map((b) => b.textContent)).toEqual(expect.arrayContaining(['🚶 Aisle', '🔖 Mine']));
    });

    it('shows the first / front row badge in its row\'s heading, as text', () => {
      const { qa } = render([apiTicket({ rowName: '1', row: 1, rowLabel: 'Row 1' }), apiTicket({ rowName: '1', row: 1, rowLabel: 'Row 1', seat: '5-6' })]);
      expect(qa('.row-head .badge').map((b) => b.textContent)).toEqual(['🥇 1st Row']);
      expect(qa('.ticket .badge').map((b) => b.textContent).join()).not.toContain('1st Row'); // not on the cards as well
    });

    it('has no "Options in Row" badge anywhere: the heading\'s count says it', () => {
      const { qa } = render([apiTicket(), apiTicket({ seat: '5-6' })]);
      expect(qa('.badge').map((b) => b.textContent).join()).not.toContain('Options in Row');
      expect(qa('.row-head .count')[0].textContent).toBe('(2)');
    });

    it('...nor on a VIP package', () => {
      const made = make();
      const vip = [
        sampleTicket({ section: 'VIP PACKAGES', originalSection: 'FLOOR', type: 'vip', row: 0, rowLabel: 'Row 1', title: 'Row 1 (VIP)', price: 300 }),
        sampleTicket({ section: 'VIP PACKAGES', originalSection: 'PIT', type: 'vip', row: 0, rowLabel: 'Row 1', title: 'Row 1 (VIP)', price: 350 }),
      ];
      made.view.renderGroups(buildSectionGroups(vip, {}).groups, 'row', () => {});
      expect(made.qa('.badge').map((b) => b.textContent).join()).not.toContain('Options in Row');
    });

    describe('the price', () => {
      // the cheapest of the three is Row 27's (the list shows the lowest rows first, so it is the last)
      const cheap = () => {
        const made = render([apiTicket({ price: 50 }), apiTicket({ seat: '1-2', row: 5, rowName: '5', rowLabel: 'Row 5', price: 60 }), apiTicket({ seat: '3-4', row: 6, rowName: '6', rowLabel: 'Row 6', price: 70 })]);
        made.q = (selector) => made.qa('.ticket').find((t) => t.querySelector('.ticket-price').textContent === '€50.00').querySelector(selector);
        return made;
      };

      it('comes after its badges, which are only their emoji', () => {
        const { q } = cheap();
        const side = q('.ticket-side');
        expect([...side.children].map((c) => c.className.split(' ')[0])).toEqual(['badges', 'ticket-price']);
        expect([...side.querySelectorAll('.badge')].every((b) => b.classList.contains('icon'))).toBe(true);
        expect([...side.querySelectorAll('.badge')].map((b) => b.textContent)).toEqual(['🔥']);
      });

      it('names each badge, and says what it means, on hover', () => {
        const { q } = cheap();
        const [cheapest] = q('.ticket-side').querySelectorAll('.badge');
        expect(cheapest.title).toBe('Cheapest Overall — Lowest priced ticket across the entire event listing');
        expect(cheapest.getAttribute('aria-label')).toBe('Cheapest Overall. Lowest priced ticket across the entire event listing');
      });

      it('keeps the badge colours', () => {
        const { q } = cheap();
        expect(q('.ticket-side .badge').style.color).not.toBe('');
        expect(q('.ticket-side .badge').style.background).not.toBe('');
      });

      it('has nothing before the price for a plain ticket (not cheapest, not resale)', () => {
        const { qa } = cheap();
        const plain = qa('.ticket').find((t) => t.querySelector('.ticket-price').textContent === '€70.00');
        expect([...plain.querySelector('.ticket-side').children].map((c) => c.className)).toEqual(['ticket-price']);
        expect(plain.querySelector('.price-badges')).toBeNull();
      });

      it('has the resale badge too, with the markup in its hover text', () => {
        const { qa } = render([
          apiTicket({ price: 100, row: 5, rowName: '5', rowLabel: 'Row 5' }),
          apiTicket({ price: 140, row: 5, rowName: '5', rowLabel: 'Row 5', seat: '9-10', isResale: true }),
        ]);
        const resale = qa('.ticket-side .badge').find((b) => b.textContent === '🔄');
        expect(resale.title).toMatch(/^Resale \(\+€40\.00\) — Fan-to-fan Verified Resale ticket\. Priced €40\.00 higher/);
      });

      it('is "View Details" when there is no price, with nothing before it', () => {
        const { q } = render([sampleTicket({ rowLabel: 'Row 3', price: 0 })]);
        expect(q('.ticket-price').textContent).toBe('View Details');
      });
    });

    describe('the title line', () => {
      it('is "Standing" for a ticket with no row', () => {
        const { q } = render([sampleTicket({ row: 9999, rowName: null, rowLabel: 'Standing', title: 'Standing' })]);
        expect(q('.ticket-title').textContent).toBe('Standing');
      });

      it('says which section a VIP package is for, in its row\'s heading, since it is grouped under "VIP PACKAGES"', () => {
        const { q } = render([sampleTicket({ section: 'VIP PACKAGES', originalSection: 'FLOOR', type: 'vip', row: 0, rowLabel: 'Row 1', title: 'Row 1 (VIP)', price: 300 })]);
        expect(q('.row-head .ticket-section').textContent).toBe('Sec FLOOR');
        expect(render([apiTicket()]).q('.ticket-section')).toBeNull(); // the card is already under its section
      });

      it('falls back to the ticket\'s title when it has no row label', () => {
        const { q } = render([sampleTicket({ title: 'Row 3' })]);
        expect(q('.ticket-title').textContent).toBe('Row 3');
      });
    });

    describe('the rows of a section', () => {
      const tickets = () => [
        apiTicket({ row: 30, rowName: '30', rowLabel: 'Row 30', seat: '1-2', price: 80 }),
        apiTicket({ row: 21, rowName: '21', rowLabel: 'Row 21', seat: '3-4', price: 80 }),
        apiTicket({ row: 21, rowName: '21', rowLabel: 'Row 21', seat: '5-6', price: 90 }),
      ];

      it('are listed one after the other, each with its heading and its tickets', () => {
        const { qa } = render(tickets());
        expect(qa('.row-group .row-title').map((e) => e.textContent)).toEqual(['Row 21', 'Row 30']);
        expect(qa('.row-group').map((g) => g.querySelectorAll('.ticket').length)).toEqual([2, 1]);
        expect(qa('.row-group .count').map((e) => e.textContent)).toEqual(['(2)']); // only a row with more than one ticket says so
      });

      it('count their tickets only when there are several, with the number on hover', () => {
        const one = render([apiTicket()]);
        expect(one.q('.row-head .count')).toBeNull();
        const two = render([apiTicket(), apiTicket({ seat: '1-2' })]);
        expect(two.q('.row-head .count').textContent).toBe('(2)');
        expect(two.q('.row-head .count').title).toBe('2 tickets in this row');
      });

      describe('where the row is in its tier', () => {
        const heading = (tickets, rowConfig) => {
          const made = make();
          made.view.renderGroups(buildSectionGroups(tickets, { rowConfig }).groups, 'row', () => {});
          return made.q('.row-head');
        };
        const at = (n, extra = {}) => apiTicket({ row: n, rowName: String(n), rowLabel: 'Row ' + n, ...extra });

        it('is said for a row with no first / front row badge: Row 26 (6th)', () => {
          const h = heading([at(26)], { firstRows: [21, 33], frontRows: 3 });
          expect(h.querySelector('.row-title').textContent).toBe('Row 26');
          expect(h.querySelector('.row-place').textContent).toBe('(6th)');
          expect(h.querySelector('.row-place').title).toBe('Row 26 is the 6th row of its tier (which starts at Row 21)');
          expect(h.querySelector('.badge')).toBeNull();
        });

        it('is not said for a row that has a badge saying it', () => {
          const first = heading([at(21)], { firstRows: [21, 33], frontRows: 3 });
          expect(first.querySelector('.row-place')).toBeNull();
          expect(first.querySelector('.badge').textContent).toBe('🥇 1st Row');
          const front = heading([at(23)], { firstRows: [21, 33], frontRows: 3 });
          expect(front.querySelector('.row-place')).toBeNull();
          expect(front.querySelector('.badge').textContent).toBe('⭐ 3rd Row');
        });

        it('is not said when it would only repeat the row number (rows that start at 1)', () => {
          expect(heading([at(7)], { firstRows: [1], frontRows: 5 }).querySelector('.row-place')).toBeNull();
        });

        it('is always said for lettered rows', () => {
          const h = heading([apiTicket({ row: 6, rowName: 'F', rowLabel: 'Row F' })], { firstRows: ['A'], frontRows: 3 });
          expect(h.querySelector('.row-place').textContent).toBe('(6th)');
          expect(h.querySelector('.row-place').title).toContain('which starts at Row A');
        });

        it('is not said for standing, or for a ticket that has no place in a tier', () => {
          const h = heading([apiTicket({ row: 9999, rowName: null, rowLabel: 'Standing' })], { firstRows: [21] });
          expect(h.querySelector('.row-place')).toBeNull();
        });

        it('comes before the count, which is separate: Row 26 (6th) (2)', () => {
          const h = heading([at(26), at(26, { seat: '5-6' })], { firstRows: [21, 33], frontRows: 3 });
          expect([...h.children].map((c) => c.className)).toEqual(['row-title', 'row-place', 'count']);
          expect(h.textContent).toBe('Row 26(6th)(2)');
        });
      });

      it('have their tickets inside a block of their own, beneath the heading', () => {
        const { q } = render(tickets());
        const group = q('.row-group');
        expect([...group.children].map((c) => c.className)).toEqual(['row-head', 'row-tickets']);
        expect(group.querySelector('.row-tickets').children).toHaveLength(2);
      });

      it('give a row\'s first / front row badge to its heading, with the explanation on hover', () => {
        const made = make();
        made.view.renderGroups(buildSectionGroups(tickets().map((t) => ({ ...t })), { rowConfig: { firstRows: [21], frontRows: 3 } }).groups, 'row', () => {});
        const heads = made.qa('.row-head').map((h) => [h.querySelector('.row-title').textContent, [...h.querySelectorAll('.badge')].map((b) => b.textContent)]);
        expect(heads).toEqual([['Row 21', ['🥇 1st Row']], ['Row 30', []]]);
        expect(made.q('.row-head .badge').title).toBe('The first row of its tier (Row 21)');
      });

      describe('of VIP packages', () => {
        const pkg = (extra = {}) => sampleTicket({
          section: 'VIP PACKAGES', originalSection: 'BLOCKE', type: 'vip', row: 0, rowName: '26', rowLabel: 'Row 26', title: 'Row 26 (VIP)',
          seat: '121-122', ticketType: 'Trivium Meet & Greet Package', price: 253.65, quality: 0.48, ...extra,
        });
        const render = (tickets) => {
          const made = make();
          made.view.renderGroups(buildSectionGroups(tickets, {}).groups, 'row', () => {});
          return made;
        };

        it('are laid out like every other ticket: a row heading, then cards with the seats, type, quality and price', () => {
          const { q } = render([pkg()]);
          expect(q('.row-head .row-title').textContent).toBe('Row 26');
          expect(q('.row-head .ticket-section').textContent).toBe('Sec BLOCKE');
          const card = q('.row-tickets .ticket');
          expect(card.querySelector('.ticket-seats').textContent).toBe('Seats 121-122');
          expect(card.querySelector('.ticket-seat-count').textContent).toBe('(2 seats)');
          expect(card.querySelector('.ticket-type').textContent).toBe('Trivium Meet & Greet Package');
          expect(card.querySelector('.ticket-badge-line .badge').textContent).toContain('Top 10%');
          expect(card.querySelector('.ticket-price').textContent).toBe('€253.65');
          expect(card.querySelector('.ticket-row-line')).toBeNull();
          expect(card.querySelector('.ticket-section')).toBeNull(); // the heading says it
        });

        it('have a heading each for a different section or row', () => {
          const { qa } = render([pkg(), pkg({ rowName: '27', rowLabel: 'Row 27' }), pkg({ originalSection: 'BLOCKC' })]);
          expect(qa('.row-head').map((h) => h.querySelector('.row-title').textContent + ' ' + h.querySelector('.ticket-section').textContent)).toEqual(['Row 26 Sec BLOCKC', 'Row 26 Sec BLOCKE', 'Row 27 Sec BLOCKE']);
        });

        it('share a heading when they are in the same row of the same section, with the count', () => {
          const { qa } = render([pkg(), pkg({ seat: '123-124' })]);
          expect(qa('.row-group')).toHaveLength(1);
          expect(qa('.row-head .count')[0].textContent).toBe('(2)');
        });

        it('say Standing, and have no seats, for a package that is standing', () => {
          const { q } = render([pkg({ row: 0, rowName: null, rowLabel: 'Standing', originalSection: 'STNDNG', seat: null, ticketType: 'Trivium Crown In The Grave VIP Package' })]);
          expect(q('.row-head').textContent).toContain('Standing');
          expect(q('.row-head .ticket-section').textContent).toBe('Sec STNDNG');
          expect(q('.ticket .ticket-seats')).toBeNull();
          expect(q('.ticket .ticket-type').textContent).toBe('Trivium Crown In The Grave VIP Package');
        });

        it('have no first / front row badge or place: that is for the seats of the sections', () => {
          const { q } = render([pkg({ rowName: '1', rowLabel: 'Row 1' })]);
          expect(q('.row-head .badge')).toBeNull();
          expect(q('.row-head .row-place')).toBeNull();
        });
      });

      it('still select the ticket that is clicked, not the row', () => {
        const made = make();
        const onClick = vi.fn();
        const all = tickets();
        made.view.renderGroups(buildSectionGroups(all, {}).groups, 'row', onClick);
        made.qa('.row-group')[0].querySelectorAll('.ticket')[1].click();
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(onClick.mock.calls[0][0].price).toBe(90);
        made.q('.row-head').click();
        expect(onClick).toHaveBeenCalledTimes(1);
      });
    });

    it('selects the ticket when it is clicked', () => {
      const made = make();
      const onClick = vi.fn();
      made.view.renderGroups(buildSectionGroups([apiTicket()], {}).groups, 'row', onClick);
      made.q('.ticket').click();
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('what only the list API knows', () => {
    it('says where the tickets came from', () => {
      const { view, q } = make();
      view.renderStatus({ loaded: 5, total: 5, isComplete: true }, 'api');
      expect(q('.status').title).toBe('Read directly from Ticketmaster\'s ticket list');
      view.renderStatus({ loaded: 5, total: 5, isComplete: true }, 'scroll');
      expect(q('.status').title).toBe('Loaded by scrolling Ticketmaster\'s ticket list');
      view.renderStatus({ loaded: 5, total: 5, isComplete: true }, 'scroll', 'reading it failed: HTTP 403');
      expect(q('.status').title).toBe('Loaded by scrolling Ticketmaster\'s ticket list (not read directly: reading it failed: HTTP 403)');
    });
  });

  it('routes control events to the handlers', () => {
    const { handlers, q, qa } = make();

    const search = q('.search');
    search.value = 'Block A';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    q('[data-badge="resale"]').click();
    q('[data-sort="price"]').click();
    const [minus, plus] = qa('.stepper button');
    minus.click();
    plus.click();
    q('.gear-btn').click();

    expect(handlers.onSearch).toHaveBeenCalledWith('Block A');
    expect(handlers.onBadgeCycle).toHaveBeenCalledWith('resale');
    expect(handlers.onSort).toHaveBeenCalledWith('price');
    expect(handlers.onQuantityStep).toHaveBeenNthCalledWith(1, -1);
    expect(handlers.onQuantityStep).toHaveBeenNthCalledWith(2, 1);
    expect(handlers.onOpenSettings).toHaveBeenCalled();
  });

  it('reflects the active sort and badge filters as pressed buttons', () => {
    const { view, q } = make();

    view.setBadgeFilters(new Set(['resale']));
    expect(q('[data-badge="resale"]').getAttribute('aria-pressed')).toBe('true');
    view.setBadgeFilters(new Set());
    expect(q('[data-badge="resale"]').getAttribute('aria-pressed')).toBe('false');

    view.setSort('price');
    expect(q('[data-sort="price"]').getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-sort="row"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('setSearch fills the search box', () => {
    const { view, q } = make();
    view.setSearch('pit');
    expect(q('.search').value).toBe('pit');
  });

  describe('the venue\'s seat map', () => {
    const groupsFor = (...names) => names.map((name) => {
      const ticket = { section: name, originalSection: name, row: 1, rowName: '1', price: 50, currency: '€', isResale: false, type: 'standard', title: 'Row 1', badges: {}, seat: '1', seatFrom: '1', seatTo: '1' };
      return { name, tickets: [ticket], topTicket: ticket, rows: [{ row: 1, label: 'Row 1', tickets: [ticket], topTicket: ticket }] };
    });

    it('marks each section with its name, for the map to find', () => {
      const { view, q, qa } = make();
      view.renderGroups(groupsFor('NTHU3', 'WESTU1'), 'price', () => {});
      expect(qa('.section').map((s) => s.getAttribute('data-section'))).toEqual(['NTHU3', 'WESTU1']);
      expect(q('.section')).not.toBeNull();
    });

    it('tells when the mouse goes onto a section, closed, and when it leaves', () => {
      const { view, handlers, q } = make();
      view.renderGroups(groupsFor('NTHU3'), 'price', () => {});
      q('.section').dispatchEvent(new MouseEvent('mouseenter'));
      expect(handlers.onSectionHover).toHaveBeenLastCalledWith('NTHU3', false);
      q('.section').dispatchEvent(new MouseEvent('mouseleave'));
      expect(handlers.onSectionHover).toHaveBeenLastCalledWith(null, false);
    });

    it('says when the section the mouse goes onto is open: the map should open it, not just show it', () => {
      const { view, handlers, q } = make();
      view.renderGroups(groupsFor('NTHU3'), 'price', () => {});
      view.openSection('NTHU3');
      q('.section').dispatchEvent(new MouseEvent('mouseenter'));
      expect(handlers.onSectionHover).toHaveBeenLastCalledWith('NTHU3', true);
    });

    it('says so when a section is opened with the mouse on it', async () => {
      const { view, handlers, q } = make();
      view.renderGroups(groupsFor('NTHU3'), 'price', () => {});
      q('.section').dispatchEvent(new MouseEvent('mouseenter'));
      expect(handlers.onSectionHover).toHaveBeenLastCalledWith('NTHU3', false);
      q('.section').open = true;
      q('.section').dispatchEvent(new Event('toggle'));
      expect(handlers.onSectionHover).toHaveBeenLastCalledWith('NTHU3', true);
    });

    it('does not say so when it is opened with the mouse elsewhere (by the map\'s click)', () => {
      const { view, handlers, q } = make();
      view.renderGroups(groupsFor('NTHU3'), 'price', () => {});
      handlers.onSectionHover.mockClear();
      q('.section').open = true;
      q('.section').dispatchEvent(new Event('toggle'));
      expect(handlers.onSectionHover).not.toHaveBeenCalled();
    });

    it('outlines a section the mouse is over on the map, and takes it off again', () => {
      const { view, q, qa } = make();
      view.renderGroups(groupsFor('NTHU3', 'WESTU1'), 'price', () => {});
      view.highlightSection('WESTU1');
      expect(qa('.section.map-hover').map((s) => s.getAttribute('data-section'))).toEqual(['WESTU1']);
      view.highlightSection('NTHU3');
      expect(qa('.section.map-hover').map((s) => s.getAttribute('data-section'))).toEqual(['NTHU3']);
      view.highlightSection(null);
      expect(q('.section.map-hover')).toBeNull();
    });

    it('keeps the outline when the list is drawn again (it is rebuilt on every update)', () => {
      const { view, qa } = make();
      view.renderGroups(groupsFor('NTHU3'), 'price', () => {});
      view.highlightSection('NTHU3');
      view.renderGroups(groupsFor('NTHU3', 'WESTU1'), 'price', () => {});
      expect(qa('.section.map-hover').map((s) => s.getAttribute('data-section'))).toEqual(['NTHU3']);
    });

    it('ignores a section that is not in the list (the filters leave it out)', () => {
      const { view, qa } = make();
      view.renderGroups(groupsFor('NTHU3'), 'price', () => {});
      expect(() => view.highlightSection('NOWHERE')).not.toThrow();
      expect(qa('.section.map-hover')).toHaveLength(0);
    });

    it('opens a section when its block is clicked, and remembers it is open when the list is rebuilt', () => {
      const { view, qa } = make();
      view.renderGroups(groupsFor('NTHU3', 'WESTU1'), 'price', () => {});
      expect(qa('.section').every((s) => !s.open)).toBe(true);
      expect(view.openSection('WESTU1')).toBe(true);
      expect(qa('.section').map((s) => s.open)).toEqual([false, true]);
      view.renderGroups(groupsFor('NTHU3', 'WESTU1'), 'price', () => {});
      expect(qa('.section').map((s) => s.open)).toEqual([false, true]);
    });

    it('says when there is no such section to open', () => {
      const { view } = make();
      view.renderGroups(groupsFor('NTHU3'), 'price', () => {});
      expect(view.openSection('NOWHERE')).toBe(false);
    });

    it('tells when the mouse goes onto a ticket and off it (its seats are shown on the map)', () => {
      const { view, handlers, q } = make();
      view.renderGroups(groupsFor('NTHU3'), 'price', () => {});
      view.openSection('NTHU3');
      const card = q('.ticket');
      card.dispatchEvent(new MouseEvent('mouseenter'));
      expect(handlers.onTicketHover).toHaveBeenLastCalledWith(expect.objectContaining({ section: 'NTHU3', rowName: '1' }));
      card.dispatchEvent(new MouseEvent('mouseleave'));
      expect(handlers.onTicketHover).toHaveBeenLastCalledWith(null);
    });

    it('still selects a ticket on a click, as before', () => {
      const { view, q } = make();
      const onTicketClick = vi.fn();
      view.renderGroups(groupsFor('NTHU3'), 'price', onTicketClick);
      q('.ticket').click();
      expect(onTicketClick).toHaveBeenCalledTimes(1);
    });

    it('shows a line about the map under the counter, and takes it away', () => {
      const { view, q } = make();
      expect(q('.map-note').hidden).toBe(true);
      view.setMapNote('Seat map: 3 blocks greyed, with no tickets matching your filters.');
      expect(q('.map-note').hidden).toBe(false);
      expect(q('.map-note').textContent).toContain('3 blocks greyed');
      view.setMapNote(null);
      expect(q('.map-note').hidden).toBe(true);
      expect(q('.map-note').textContent).toBe('');
    });

    it('does not need the handler (a host with no map)', () => {
      const { view, handlers, q } = make();
      delete handlers.onSectionHover;
      view.renderGroups(groupsFor('NTHU3'), 'price', () => {});
      delete handlers.onTicketHover;
      expect(() => q('.section').dispatchEvent(new MouseEvent('mouseenter'))).not.toThrow();
      expect(() => q('.ticket').dispatchEvent(new MouseEvent('mouseenter'))).not.toThrow();
    });
  });

  describe('a seat the mouse is on, on the venue\'s map', () => {
    const ticket = (id, row) => ({ id, section: 'NTHU3', originalSection: 'NTHU3', row: Number(row), rowName: row, price: 50, currency: '€', isResale: false, type: 'standard', title: 'Row ' + row, badges: {}, seat: '1', seatFrom: '1', seatTo: '1' });
    const group = (name, tickets) => ({ name, tickets, topTicket: tickets[0], rows: tickets.map((t) => ({ row: t.row, label: 'Row ' + t.rowName, tickets: [t], topTicket: t })) });
    const mapped = () => [group('NTHU3', [ticket('t1', '1'), ticket('t2', '2')]), group('WESTU1', [{ ...ticket('t3', '3'), section: 'WESTU1', originalSection: 'WESTU1' }])];

    it('marks each ticket with its id, for the map to name it by', () => {
      const { view, qa } = make();
      view.renderGroups(mapped(), 'price', () => {});
      expect(qa('.ticket').map((t) => t.getAttribute('data-ticket'))).toEqual(['t1', 't2', 't3']);
    });

    it('has no such mark for a ticket without an id (read from the cards)', () => {
      const { view, qa } = make();
      const noId = ticket('x', '1');
      delete noId.id;
      view.renderGroups([group('NTHU3', [noId])], 'price', () => {});
      expect(qa('.ticket')[0].hasAttribute('data-ticket')).toBe(false);
    });

    it('lights up its ticket in the list, when the section is open, and only that one', () => {
      const { view, qa } = make();
      view.renderGroups(mapped(), 'price', () => {});
      view.openSection('NTHU3');
      view.highlightTicket('t2');
      expect(qa('.ticket.map-hover').map((t) => t.getAttribute('data-ticket'))).toEqual(['t2']);
      view.highlightTicket('t1');
      expect(qa('.ticket.map-hover').map((t) => t.getAttribute('data-ticket'))).toEqual(['t1']);
      view.highlightTicket(null);
      expect(qa('.ticket.map-hover')).toHaveLength(0);
    });

    it('lights up its section when that is closed (the ticket is not showing)', () => {
      const { view, qa } = make();
      view.renderGroups(mapped(), 'price', () => {});
      view.highlightTicket('t3');
      expect(qa('.ticket.map-hover')).toHaveLength(0);
      expect(qa('.section.map-seat').map((s) => s.getAttribute('data-section'))).toEqual(['WESTU1']);
      view.highlightTicket(null);
      expect(qa('.section.map-seat')).toHaveLength(0);
    });

    it('keeps it lit when the list is drawn again', () => {
      const { view, qa } = make();
      view.renderGroups(mapped(), 'price', () => {});
      view.openSection('NTHU3');
      view.highlightTicket('t1');
      view.renderGroups(mapped(), 'price', () => {});
      expect(qa('.ticket.map-hover').map((t) => t.getAttribute('data-ticket'))).toEqual(['t1']);
    });

    it('brings it into view after a pause, once, scrolling only its scroller (a sweep across the seats must not make the list lurch)', () => {
      vi.useFakeTimers();
      const { view, qa } = make();
      // the list inside a scroller that shows 500px of its 2000, with the tickets below what is showing
      const scroller = document.createElement('div');
      scroller.style.overflowY = 'auto';
      document.body.append(scroller);
      scroller.append(view.root);
      Object.defineProperty(scroller, 'scrollHeight', { value: 2000, configurable: true });
      Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
      scroller.getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 400, width: 400, height: 500 });
      scroller.scrollTo = vi.fn();
      view.renderGroups(mapped(), 'price', () => {});
      view.openSection('NTHU3');
      scroller.scrollTo.mockClear();
      qa('.ticket').forEach((t) => { t.getBoundingClientRect = () => ({ top: 900, bottom: 980, left: 0, right: 400, width: 400, height: 80 }); });

      view.highlightTicket('t1');
      vi.advanceTimersByTime(100);
      view.highlightTicket('t2'); // the mouse has moved on to another seat before the pause was over
      vi.advanceTimersByTime(200);
      expect(scroller.scrollTo).not.toHaveBeenCalled(); // 200ms since t2: not yet
      vi.advanceTimersByTime(100);
      expect(scroller.scrollTo).toHaveBeenCalledTimes(1); // once, for the one it is on
      expect(scroller.scrollTo.mock.calls[0][0].top).toBeGreaterThan(0); // down to it
    });

    it('does not scroll at all when the mouse has left the seat before the pause is over', () => {
      vi.useFakeTimers();
      const { view, qa } = make();
      const scroller = document.createElement('div');
      scroller.style.overflowY = 'auto';
      document.body.append(scroller);
      scroller.append(view.root);
      Object.defineProperty(scroller, 'scrollHeight', { value: 2000, configurable: true });
      Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
      scroller.getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 400, width: 400, height: 500 });
      scroller.scrollTo = vi.fn();
      view.renderGroups(mapped(), 'price', () => {});
      view.openSection('NTHU3');
      scroller.scrollTo.mockClear();
      qa('.ticket').forEach((t) => { t.getBoundingClientRect = () => ({ top: 900, bottom: 980, left: 0, right: 400, width: 400, height: 80 }); });
      view.highlightTicket('t1');
      vi.advanceTimersByTime(100);
      view.highlightTicket(null);
      vi.advanceTimersByTime(1000);
      expect(scroller.scrollTo).not.toHaveBeenCalled();
    });

    it('ignores a ticket that is not in the list (the filters leave it out)', () => {
      const { view, qa } = make();
      view.renderGroups(mapped(), 'price', () => {});
      expect(() => view.highlightTicket('nope')).not.toThrow();
      expect(qa('.ticket.map-hover, .section.map-seat')).toHaveLength(0);
    });

    it('opens the ticket\'s section when its seat is clicked, and says it did', () => {
      const { view, qa } = make();
      view.renderGroups(mapped(), 'price', () => {});
      expect(qa('.section').every((s) => !s.open)).toBe(true);
      expect(view.openTicket('t3')).toBe(true);
      expect(qa('.section').map((s) => s.open)).toEqual([false, true]);
      expect(qa('.ticket.map-hover').map((t) => t.getAttribute('data-ticket'))).toEqual(['t3']);
      view.renderGroups(mapped(), 'price', () => {});
      expect(qa('.section').map((s) => s.open)).toEqual([false, true]); // it stays open
    });

    it('says when there is no such ticket to open', () => {
      const { view } = make();
      view.renderGroups(mapped(), 'price', () => {});
      expect(view.openTicket('nope')).toBe(false);
      expect(view.openTicket(null)).toBe(false);
    });
  });

  describe('Auto zoom map, and the Show on map buttons', () => {
    const groupsFor = (...names) => names.map((name) => {
      const ticket = { section: name, originalSection: name, row: 1, rowName: '1', price: 50, currency: '€', isResale: false, type: 'standard', title: 'Row 1', badges: {}, seat: '1', seatFrom: '1', seatTo: '1' };
      return { name, tickets: [ticket], topTicket: ticket, rows: [{ row: 1, label: 'Row 1', tickets: [ticket], topTicket: ticket }] };
    });
    const visible = (el) => !el.hidden && getComputedStyle(el).display !== 'none';

    it('has no such option on a page with no interactive map', () => {
      const { q } = make();
      expect(q('.auto-zoom').hidden).toBe(true);
    });

    it('offers "Auto zoom map", on, when the page has a map', () => {
      const { view, q } = make();
      view.setMapAvailable(true);
      expect(q('.auto-zoom').hidden).toBe(false);
      expect(q('.auto-zoom').textContent).toContain('Auto zoom map');
      expect(q('.auto-zoom-box').checked).toBe(true);
    });

    it('tells the host when it is switched, and shows what the host says', () => {
      const { view, handlers, q } = make();
      view.setMapAvailable(true);
      q('.auto-zoom-box').checked = false;
      q('.auto-zoom-box').dispatchEvent(new Event('change', { bubbles: true }));
      expect(handlers.onAutoZoomChange).toHaveBeenLastCalledWith(false);
      view.setAutoZoom(true);
      expect(q('.auto-zoom-box').checked).toBe(true);
    });

    it('has a "Map report" button, only on a page with a map', () => {
      const { view, q } = make();
      expect(q('.map-report').hidden).toBe(true);
      view.setMapAvailable(true);
      expect(q('.map-report').hidden).toBe(false);
      expect(q('.map-report').textContent).toBe('Map report');
      view.setMapAvailable(false);
      expect(q('.map-report').hidden).toBe(true);
    });

    it('asks the host for the report when pressed, says what came of it, and goes back to its label', async () => {
      vi.useFakeTimers();
      const { view, handlers, q } = make();
      view.setMapAvailable(true);
      q('.map-report').click();
      expect(handlers.onMapReport).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(q('.map-report').textContent).toBe('Copied ✓');
      await vi.advanceTimersByTimeAsync(3100);
      expect(q('.map-report').textContent).toBe('Map report');
    });

    it('says so when the report could not be made, instead of doing nothing', async () => {
      vi.useFakeTimers();
      const { view, handlers, q } = make();
      handlers.onMapReport = vi.fn(() => Promise.reject(new Error('no')));
      view.setMapAvailable(true);
      q('.map-report').click();
      await vi.advanceTimersByTimeAsync(0);
      expect(q('.map-report').textContent).toMatch(/^Failed/);
      handlers.onMapReport = vi.fn(() => { throw new Error('boom'); });
      q('.map-report').click();
      await vi.advanceTimersByTimeAsync(0);
      expect(q('.map-report').textContent).toMatch(/^Failed/);
    });

    it('copes with a host that has no report to give', async () => {
      vi.useFakeTimers();
      const { view, handlers, q } = make();
      delete handlers.onMapReport;
      view.setMapAvailable(true);
      expect(() => q('.map-report').click()).not.toThrow();
      await vi.advanceTimersByTimeAsync(0);
      expect(q('.map-report').textContent).toBe('Map report');
    });

    it('has the "Show on map" buttons only with a map and with auto zoom off', () => {
      const { view } = make();
      view.renderGroups(groupsFor('NTHU3'), 'price', () => {});
      view.openSection('NTHU3');
      const rootHas = () => view.root.classList.contains('map-buttons');
      expect(rootHas()).toBe(false); // no map
      view.setMapAvailable(true);
      expect(rootHas()).toBe(false); // auto zoom is on
      view.setAutoZoom(false);
      expect(rootHas()).toBe(true);
      view.setAutoZoom(true);
      expect(rootHas()).toBe(false);
      view.setAutoZoom(false);
      view.setMapAvailable(false);
      expect(rootHas()).toBe(false); // the map went
    });

    it('puts a button on each section and each ticket', () => {
      const { view, qa } = make();
      view.renderGroups(groupsFor('NTHU3', 'WESTU1'), 'price', () => {});
      expect(qa('.section > summary .show-on-map')).toHaveLength(2);
      expect(qa('.section .ticket .show-on-map')).toHaveLength(2);
    });

    it('a section\'s button asks for that section, and neither opens nor closes it', () => {
      const { view, handlers, q } = make();
      view.renderGroups(groupsFor('NTHU3'), 'price', () => {});
      const section = q('.section');
      expect(section.open).toBe(false);
      q('.section > summary .show-on-map').click();
      expect(handlers.onShowSection).toHaveBeenCalledWith('NTHU3');
      expect(section.open).toBe(false);
    });

    it('a ticket\'s button asks for that ticket, and does not select it', () => {
      const { view, handlers, q } = make();
      const onTicketClick = vi.fn();
      view.renderGroups(groupsFor('NTHU3'), 'price', onTicketClick);
      view.openSection('NTHU3');
      q('.ticket .show-on-map').click();
      expect(handlers.onShowTicket).toHaveBeenCalledWith(expect.objectContaining({ section: 'NTHU3', rowName: '1' }));
      expect(onTicketClick).not.toHaveBeenCalled();
    });

    it('a ticket is still selected by a click anywhere else on it', () => {
      const { view, q } = make();
      const onTicketClick = vi.fn();
      view.renderGroups(groupsFor('NTHU3'), 'price', onTicketClick);
      view.openSection('NTHU3');
      q('.ticket .ticket-price').click();
      expect(onTicketClick).toHaveBeenCalledTimes(1);
    });

    it('has no buttons for a host with no map', () => {
      const { view, handlers, qa } = make();
      delete handlers.onShowSection;
      delete handlers.onShowTicket;
      view.renderGroups(groupsFor('NTHU3'), 'price', () => {});
      expect(() => qa('.show-on-map').forEach((b) => b.click())).not.toThrow();
    });

    it('the buttons say what they do, for those who cannot see the icon', () => {
      const { view, q } = make();
      view.renderGroups(groupsFor('NTHU3'), 'price', () => {});
      expect(q('.section > summary .show-on-map').getAttribute('aria-label')).toMatch(/section on the venue's map/);
      expect(q('.ticket .show-on-map').getAttribute('aria-label')).toMatch(/seats on the venue's map/);
    });
  });

  describe('VIP packages', () => {
    it('have no banner of their own: they are in the list, and the VIP pill filters them', () => {
      const { view, q } = make();
      expect(q('.vip-row')).toBeNull();
      expect(q('.vip-btn')).toBeNull();
      expect(view.renderVip).toBeUndefined();
    });
  });

  describe('text size', () => {
    it('sets the list scale and a milder header scale', () => {
      const { view } = make();
      view.setScale(1.38);
      expect(view.root.style.getPropertyValue('--sv-scale')).toBe('1.38');
      expect(view.root.style.getPropertyValue('--sv-header-scale')).toBe('1.15');
      view.setScale(1);
      expect(view.root.style.getPropertyValue('--sv-scale')).toBe('1');
      expect(view.root.style.getPropertyValue('--sv-header-scale')).toBe('1');
    });
  });

  describe('sort chips', () => {
    it('can be hidden (when following Ticketmaster\'s own sort) and shown again', () => {
      const { view, q } = make();
      const row = q('[data-sort="row"]').parentElement;
      expect(row.hidden).toBe(false);
      view.setSortVisible(false);
      expect(row.hidden).toBe(true);
      view.setSortVisible(true);
      expect(row.hidden).toBe(false);
    });
  });

  describe('the controls box', () => {
    const box = (q) => q('.control-box');

    it('is shown with the sort chips and the quantity stepper', () => {
      const { q } = make();
      expect(box(q).hidden).toBe(false);
    });

    it('is hidden when nothing in it is left: sort followed from Ticketmaster, compact layout, no "show original" link', () => {
      const { view, q } = make();
      view.setSortVisible(false);
      view.setCompact(true);
      expect(box(q).hidden).toBe(true);
    });

    it('comes back as soon as any row in it does', () => {
      const { view, q } = make();
      view.setSortVisible(false);
      view.setCompact(true);

      view.setOriginalLink(true);
      expect(box(q).hidden).toBe(false);
      view.setOriginalLink(false);
      expect(box(q).hidden).toBe(true);

      view.setSortVisible(true);
      expect(box(q).hidden).toBe(false);
      view.setSortVisible(false);
      expect(box(q).hidden).toBe(true);

      view.setCompact(false); // the quantity stepper is back
      expect(box(q).hidden).toBe(false);
    });
  });

  describe('venue settings', () => {
    const venue = { id: '197033', name: '3Arena, Dublin' };
    const config = { name: '3Arena, Dublin', firstRows: [21, 33], frontRows: 4 };
    const setup = () => {
      const made = make();
      made.view.setVenue(venue, config, 5);
      return made;
    };
    const fill = (q, tiers, front) => {
      q('.venue-input[aria-label="Tiers start at row"]').value = tiers;
      q('.venue-input[aria-label="Front rows"]').value = front;
    };

    it('has nothing to show until the page has a venue', () => {
      const { q } = make();
      expect(q('.venue-btn').hidden).toBe(true);
      expect(q('.venue-panel').hidden).toBe(true);
    });

    it('offers the venue\'s settings under a button that names it', () => {
      const { q } = setup();
      expect(q('.venue-btn').hidden).toBe(false);
      expect(q('.venue-btn').title).toBe('Venue settings: 3Arena, Dublin');
      expect(q('.venue-panel').hidden).toBe(true);
    });

    it('opens and closes on the button, showing the venue and its saved values', () => {
      const { q } = setup();
      q('.venue-btn').click();
      expect(q('.venue-panel').hidden).toBe(false);
      expect(q('.venue-btn').getAttribute('aria-expanded')).toBe('true');
      expect(q('.venue-name').textContent).toBe('3Arena, Dublin');
      expect(q('.venue-input[aria-label="Tiers start at row"]').value).toBe('21, 33');
      expect(q('.venue-input[aria-label="Front rows"]').value).toBe('4');

      q('.venue-btn').click();
      expect(q('.venue-panel').hidden).toBe(true);
      expect(q('.venue-btn').getAttribute('aria-expanded')).toBe('false');
    });

    it('shows the default for front rows as the placeholder when the venue has no setting of its own', () => {
      const { view, q } = make();
      view.setVenue(venue, { firstRows: [1], frontRows: null }, 5);
      expect(q('.venue-input[aria-label="Front rows"]').value).toBe('');
      expect(q('.venue-input[aria-label="Front rows"]').placeholder).toBe('5');
      expect(q('.venue-input[aria-label="Tiers start at row"]').value).toBe('1');
    });

    it('saves what was typed, parsed, and closes', () => {
      const { handlers, q } = setup();
      q('.venue-btn').click();
      fill(q, '33, 21', '3');
      q('.venue-save').click();

      expect(handlers.onSaveVenue).toHaveBeenCalledWith({ firstRows: [21, 33], frontRows: 3, badges: [] });
      expect(q('.venue-panel').hidden).toBe(true);
    });

    it('takes row letters for the tiers, for venues whose rows are lettered', () => {
      const { handlers, q } = setup();
      q('.venue-btn').click();
      fill(q, 'k, a', '2');
      q('.venue-save').click();
      expect(handlers.onSaveVenue).toHaveBeenCalledWith({ firstRows: ['A', 'K'], frontRows: 2, badges: [] });
    });

    it('shows saved letters as they were entered', () => {
      const { view, q } = make();
      view.setVenue(venue, { firstRows: ['A', 'K'], frontRows: null }, 5);
      expect(q('.venue-input[aria-label="Tiers start at row"]').value).toBe('A, K');
    });

    it('refuses a mix of numbers and letters, saying letters are allowed', () => {
      const { handlers, q } = setup();
      q('.venue-btn').click();
      fill(q, '21, K', '');
      q('.venue-save').click();
      expect(handlers.onSaveVenue).not.toHaveBeenCalled();
      expect(q('.venue-message').textContent).toContain('letters');
    });

    it('blank tiers mean rows start at 1, and blank front rows mean the default', () => {
      const { handlers, q } = setup();
      q('.venue-btn').click();
      fill(q, '', '');
      q('.venue-save').click();
      expect(handlers.onSaveVenue).toHaveBeenCalledWith({ firstRows: [1], frontRows: null, badges: [] });
    });

    it('saves on Enter, and closes on Escape without saving', () => {
      const { handlers, q } = setup();
      q('.venue-btn').click();
      q('.venue-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(handlers.onSaveVenue).toHaveBeenCalledTimes(1);

      q('.venue-btn').click();
      q('.venue-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(q('.venue-panel').hidden).toBe(true);
      expect(handlers.onSaveVenue).toHaveBeenCalledTimes(1);
    });

    it('explains and keeps the panel open when the tiers are not row numbers', () => {
      const { handlers, q } = setup();
      q('.venue-btn').click();
      fill(q, '21-33', '');
      q('.venue-save').click();

      expect(handlers.onSaveVenue).not.toHaveBeenCalled();
      expect(q('.venue-panel').hidden).toBe(false);
      expect(q('.venue-message').textContent).toContain('Tiers');
    });

    it('explains and keeps the panel open when the front rows are not a sensible number', () => {
      const { handlers, q } = setup();
      q('.venue-btn').click();
      fill(q, '21', '0');
      q('.venue-save').click();

      expect(handlers.onSaveVenue).not.toHaveBeenCalled();
      expect(q('.venue-message').textContent).toContain('Front rows');
      expect(q('.venue-message').textContent).toContain('5'); // the default
    });

    it('clears an old message when reopened', () => {
      const { q } = setup();
      q('.venue-btn').click();
      fill(q, 'twenty-one', '');
      q('.venue-save').click();
      expect(q('.venue-message').textContent).not.toBe('');
      q('.venue-btn').click();
      q('.venue-btn').click();
      expect(q('.venue-message').textContent).toBe('');
    });

    it('resets to the defaults and closes', () => {
      const { handlers, q } = setup();
      q('.venue-btn').click();
      q('.venue-reset').click();
      expect(handlers.onResetVenue).toHaveBeenCalled();
      expect(q('.venue-panel').hidden).toBe(true);
    });

    describe('badges for this venue', () => {
      const aisle = { id: 'aisle1', label: 'Aisle', icon: '🚶', color: 'blue', pattern: 'aisle' };
      const withBadges = () => {
        const made = make();
        made.view.setVenue(venue, { ...config, badges: [aisle] }, 5);
        made.q('.venue-btn').click();
        return made;
      };

      it('shows the venue\'s badges for editing', () => {
        const { qa, q } = withBadges();
        expect(qa('.venue-panel .be-row')).toHaveLength(1);
        expect(q('.venue-panel .be-label').value).toBe('Aisle');
        expect(q('.venue-panel .be-pattern').value).toBe('aisle');
      });

      it('saves them with the rest of the venue\'s settings', () => {
        const { handlers, q } = withBadges();
        const pattern = q('.venue-panel .be-pattern');
        pattern.value = 'aisle|end of row';
        q('.venue-save').click();

        expect(handlers.onSaveVenue).toHaveBeenCalledWith({
          firstRows: [21, 33],
          frontRows: 4,
          badges: [{ ...aisle, pattern: 'aisle|end of row' }],
        });
      });

      it('keeps the panel open and says so when a pattern is not valid', () => {
        const { handlers, q } = withBadges();
        q('.venue-panel .be-pattern').value = '(aisle';
        q('.venue-save').click();

        expect(handlers.onSaveVenue).not.toHaveBeenCalled();
        expect(q('.venue-panel').hidden).toBe(false);
        expect(q('.venue-message').textContent).toContain('Badges');
        expect(q('.venue-panel .be-error').textContent).toContain('Not a valid pattern');
      });

      it('drops the complaint as soon as a badge field is edited', () => {
        const { q } = withBadges();
        const pattern = q('.venue-panel .be-pattern');
        pattern.value = '(';
        q('.venue-save').click();
        expect(q('.venue-message').textContent).not.toBe('');

        pattern.value = 'aisle';
        pattern.dispatchEvent(new Event('input', { bubbles: true }));
        expect(q('.venue-message').textContent).toBe('');
      });

      it('adds a badge with the button without saving or closing the panel', () => {
        const { handlers, qa, q } = withBadges();
        q('.venue-panel .be-add').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        q('.venue-panel .be-add').click();
        expect(qa('.venue-panel .be-row')).toHaveLength(2);
        expect(handlers.onSaveVenue).not.toHaveBeenCalled();
        expect(q('.venue-panel').hidden).toBe(false);
      });

      it('saves on Enter in a badge field', () => {
        const { handlers, q } = withBadges();
        q('.venue-panel .be-pattern').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(handlers.onSaveVenue).toHaveBeenCalledTimes(1);
      });
    });

    it('goes away again when there is no venue', () => {
      const { view, q } = setup();
      q('.venue-btn').click();
      view.setVenue(null, config, 5);
      expect(q('.venue-btn').hidden).toBe(true);
      expect(q('.venue-panel').hidden).toBe(true);
    });
  });

  describe('flow layout (part of the page\'s own scroll)', () => {
    it('is off by default and can be switched on and off', () => {
      const { view } = make();
      expect(view.root.classList.contains('flow')).toBe(false);
      view.setFlow(true);
      expect(view.root.classList.contains('flow')).toBe(true);
      view.setFlow(false);
      expect(view.root.classList.contains('flow')).toBe(false);
    });
  });

  describe('inline layout', () => {
    it('is compact (no quantity stepper) only when asked', () => {
      const { view } = make();
      expect(view.root.classList.contains('compact')).toBe(false);
      view.setCompact(true);
      expect(view.root.classList.contains('compact')).toBe(true);
      view.setCompact(false);
      expect(view.root.classList.contains('compact')).toBe(false);
    });

    it('shows a "Show Ticketmaster\'s list" link only when asked, which calls the handler', () => {
      const { view, handlers, q } = make();
      expect(q('.original-row').hidden).toBe(true);

      view.setOriginalLink(true);
      expect(q('.original-row').hidden).toBe(false);
      q('.link-btn').click();
      expect(handlers.onShowOriginal).toHaveBeenCalled();

      view.setOriginalLink(false);
      expect(q('.original-row').hidden).toBe(true);
    });
  });

  it('says how the tickets are being loaded on the status chip: (API) or (Scroll)', () => {
    const { view, q } = make();
    view.renderStatus({ loaded: 311, total: 311, isComplete: true }, 'api');
    expect(q('.status').textContent).toBe('✓ All 311 Loaded (API)');
    view.renderStatus({ loaded: 311, total: 311, isComplete: true }, 'scroll');
    expect(q('.status').textContent).toBe('✓ All 311 Loaded (Scroll)');
    view.renderStatus({ loaded: 120, total: 311, isComplete: false }, 'api');
    expect(q('.status').textContent).toBe('⏳ Loading 120/311 (API)');
    expect(q('.status').title).toBe('Reading Ticketmaster\'s ticket list directly');
    view.renderStatus({ loaded: 120, total: 311, isComplete: false }, 'scroll');
    expect(q('.status').textContent).toBe('⏳ Loading 120/311 (Scroll)');
    view.renderStatus({ loaded: 3, total: 0, isComplete: false }, 'api');
    expect(q('.status').textContent).toBe('⏳ Loading 3 (API)');
  });

  it('renders load status, counter and quantity', () => {
    const { view, q } = make();

    view.renderStatus({ loaded: 3, total: 10, isComplete: false });
    expect(q('.status').textContent).toBe('⏳ Loading 3/10');
    expect(q('.status').dataset.state).toBe('loading');
    view.renderStatus({ loaded: 3, total: 0, isComplete: false });
    expect(q('.status').textContent).toBe('⏳ Loading 3');
    view.renderStatus({ loaded: 10, total: 10, isComplete: true });
    expect(q('.status').textContent).toBe('✓ All 10 Loaded');
    expect(q('.status').dataset.state).toBe('done');

    view.renderCounter(1, 2);
    expect(q('.counter').textContent).toBe('Total Loaded: 1 option (2 per offer)');
    view.renderCounter(5, 2);
    expect(q('.counter').textContent).toBe('Total Loaded: 5 options (2 per offer)');
  });

  it('disables the quantity buttons at the limits', () => {
    const { view, q, qa } = make();
    const [minus, plus] = qa('.stepper button');

    view.renderQuantity(1);
    expect(minus.disabled).toBe(true);
    expect(plus.disabled).toBe(false);
    view.renderQuantity(8);
    expect(minus.disabled).toBe(false);
    expect(plus.disabled).toBe(true);
    view.renderQuantity(4);
    expect(minus.disabled).toBe(false);
    expect(plus.disabled).toBe(false);
    expect(q('.qty-value').textContent).toBe('4');
  });

  it('renders messages and replaces earlier content', () => {
    const { view, q } = make();
    view.renderMessage('Waiting for tickets to render...');
    expect(q('.sv-content').textContent).toBe('Waiting for tickets to render...');
    view.renderMessage('No matching blocks found.');
    expect(q('.sv-content').textContent).toBe('No matching blocks found.');
  });

  describe('section list', () => {
    function render(view, tickets, sort = 'row', onTicketClick = vi.fn()) {
      const { groups } = buildSectionGroups(tickets, { sort });
      view.renderGroups(groups, sort, onTicketClick);
      return onTicketClick;
    }

    it('renders sections with counts, best ticket, rows, prices and badges', () => {
      const { view, qa } = make();
      render(view, [
        sampleTicket({ row: 3, price: 85, title: 'Row 3' }),
        sampleTicket({ row: 9, price: 120, title: 'Row 9', currency: '£' }),
        sampleTicket({ section: 'VIP PACKAGES', originalSection: 'FLOOR', type: 'vip', row: 0, price: 0, title: 'Row 1 (VIP)' }),
      ]);

      const sections = qa('details');
      expect(sections).toHaveLength(2);
      const heads = sections.map((d) => d.querySelector('summary').textContent);
      expect(heads[0]).toContain('VIP PACKAGES(1)');
      expect(heads[0]).toContain('FLOOR, N/A');
      expect(heads[1]).toContain('Section 101(2)');
      expect(heads[1]).toContain('Row: 3, €85.00');

      const text = sections[1].textContent;
      expect(text).toContain('Row 9');
      expect(text).toContain('£120.00');
      expect(text).toContain('3rd Row'); // row 3 is the 3rd row of a tier that starts at Row 1
      expect(sections[0].textContent).toContain('View Details');
      expect(sections[1].querySelector('[title^="Cheapest Overall — "]')).not.toBeNull();
    });

    it('applies badge colours from the badge description', () => {
      const { view, q } = make();
      render(view, [sampleTicket()]);
      const badge = q('.badge[title^="Row 3 is the 3rd row"]');
      expect(badge.style.background).not.toBe('');
      expect(badge.style.color).not.toBe('');
    });

    it('treats ticket text as text, never markup', () => {
      const { view, q } = make();
      const evil = '<img src=x onerror="window.__pwned = true">';
      render(view, [sampleTicket({ section: evil, originalSection: evil, title: evil })]);

      expect(q('.sv-content img')).toBeNull();
      expect(q('.sv-content').textContent).toContain(evil);
    });

    it('calls onTicketClick with the ticket when a row is clicked', () => {
      const { view, q } = make();
      const ticket = sampleTicket();
      const onTicketClick = render(view, [ticket]);

      q('.ticket').click();

      expect(onTicketClick).toHaveBeenCalledWith(ticket);
    });

    it('keeps sections the user expanded open across re-renders', () => {
      const { view, qa } = make();
      const tickets = () => [sampleTicket({ section: '101' }), sampleTicket({ section: '102' })];
      const open = () => qa('details').map((d) => [d.querySelector('summary').textContent.slice(0, 11), d.open]);

      render(view, tickets());
      expect(open().every(([, isOpen]) => !isOpen)).toBe(true);

      const [first] = qa('details');
      first.open = true;
      first.dispatchEvent(new Event('toggle'));
      render(view, tickets());
      expect(open()).toEqual([['Section 101', true], ['Section 102', false]]);

      const [reopened] = qa('details');
      reopened.open = false;
      reopened.dispatchEvent(new Event('toggle'));
      render(view, tickets());
      expect(open().every(([, isOpen]) => !isOpen)).toBe(true);
    });
  });
});
