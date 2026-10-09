import { compileBadges } from '../src/lib/custom-badges.js';
import { rowRank } from '../src/lib/tickets.js';
import {
  DEFAULT_ROW_CONFIG,
  annotateResaleBaselines,
  buildSectionGroups,
  computeBadges,
  formatBestTicketLabel,
  minPrice,
  ordinal,
  rowPosition,
  ticketComparator,
  ticketPriorityScore,
} from '../src/lib/sections.js';

// Plain ticket objects: parsing is covered in tickets.test.js.
function ticket(overrides = {}) {
  return {
    section: '101',
    originalSection: '101',
    row: 10,
    price: 100,
    currency: '€',
    type: 'standard',
    isResale: false,
    ...overrides,
  };
}

describe('ticketPriorityScore', () => {
  it('ranks VIP, then standing, then ascending rows', () => {
    const vip = ticketPriorityScore(ticket({ type: 'vip', row: 0 }));
    const standing = ticketPriorityScore(ticket({ row: 9999 }));
    const row1 = ticketPriorityScore(ticket({ row: 1 }));
    const row20 = ticketPriorityScore(ticket({ row: 20 }));
    expect(vip).toBeLessThan(standing);
    expect(standing).toBeLessThan(row1);
    expect(row1).toBeLessThan(row20);
  });
});

describe('ticketComparator', () => {
  it('sorts by price when asked, otherwise by seat priority', () => {
    const cheap = ticket({ price: 50, row: 30 });
    const close = ticket({ price: 200, row: 2 });
    expect([close, cheap].sort(ticketComparator('price'))).toEqual([cheap, close]);
    expect([cheap, close].sort(ticketComparator('row'))).toEqual([close, cheap]);
  });

  describe('tickets that tie', () => {
    const rows = (sort, tickets) => tickets.slice().sort(ticketComparator(sort)).map((t) => t.row + '@' + t.price + (t.quality !== undefined ? '/' + t.quality : ''));

    it('by price: the same price goes by row, the better row first', () => {
      const t = [ticket({ row: 30, price: 80.75 }), ticket({ row: 21, price: 80.75 }), ticket({ row: 25, price: 80.75 }), ticket({ row: 5, price: 90 }), ticket({ row: 40, price: 70 })];
      expect(rows('price', t)).toEqual(['40@70', '21@80.75', '25@80.75', '30@80.75', '5@90']);
    });

    it('by seat: the same row goes by price, the lower first', () => {
      const t = [ticket({ row: 3, price: 120 }), ticket({ row: 3, price: 80 }), ticket({ row: 2, price: 200 }), ticket({ row: 3, price: 100 })];
      expect(rows('row', t)).toEqual(['2@200', '3@80', '3@100', '3@120']);
      expect(rows(undefined, t)).toEqual(['2@200', '3@80', '3@100', '3@120']); // seat order is the default
    });

    it('does not let the second order override the first', () => {
      const t = [ticket({ row: 1, price: 500 }), ticket({ row: 50, price: 10 })];
      expect(rows('price', t)).toEqual(['50@10', '1@500']);
      expect(rows('row', t)).toEqual(['1@500', '50@10']);
    });

    it('uses the seat priority for the other order: VIP packages, then standing, then rows', () => {
      const t = [ticket({ row: 4, price: 60 }), ticket({ row: 9999, price: 60 }), ticket({ row: 0, type: 'vip', price: 60 })];
      expect(t.slice().sort(ticketComparator('price')).map((x) => x.type === 'vip' ? 'vip' : x.row)).toEqual(['vip', 9999, 4]);
    });

    it('then, for the same price and row, the better quality score first', () => {
      const t = [ticket({ row: 5, price: 60, quality: 0.3 }), ticket({ row: 5, price: 60, quality: 0.9 }), ticket({ row: 5, price: 60, quality: 0.5 })];
      expect(rows('price', t)).toEqual(['5@60/0.9', '5@60/0.5', '5@60/0.3']);
      expect(rows('row', t)).toEqual(['5@60/0.9', '5@60/0.5', '5@60/0.3']);
    });

    it('leaves tickets with no quality score, or only one of them, in the order they came', () => {
      const a = ticket({ row: 5, price: 60 });
      const b = ticket({ row: 5, price: 60, quality: 0.9 });
      const c = ticket({ row: 5, price: 60 });
      expect([a, b, c].sort(ticketComparator('price'))).toEqual([a, b, c]);
      expect([c, a].sort(ticketComparator('row'))).toEqual([c, a]);
    });
  });
});

describe('minPrice', () => {
  it('ignores zero (unknown) prices', () => {
    expect(minPrice([ticket({ price: 0 }), ticket({ price: 80 }), ticket({ price: 60 })])).toBe(60);
  });

  it('is 0 when no ticket has a price', () => {
    expect(minPrice([ticket({ price: 0 })])).toBe(0);
    expect(minPrice([])).toBe(0);
  });
});

describe('annotateResaleBaselines', () => {
  it('uses the cheapest primary ticket in the same row', () => {
    const resale = ticket({ isResale: true, row: 5, price: 150 });
    annotateResaleBaselines([resale, ticket({ row: 5, price: 90 }), ticket({ row: 5, price: 80 }), ticket({ row: 6, price: 10 })]);
    expect(resale.baselinePrice).toBe(80);
    expect(resale.baselineSource).toBe('Row 5');
  });

  it('falls back to the primary ticket in the nearest row', () => {
    const resale = ticket({ isResale: true, row: 10, price: 150 });
    annotateResaleBaselines([resale, ticket({ row: 2, price: 70 }), ticket({ row: 12, price: 95 })]);
    expect(resale.baselinePrice).toBe(95);
    expect(resale.baselineSource).toBe('Row 12');
  });

  it('labels a standing baseline', () => {
    const resale = ticket({ isResale: true, row: 9999, price: 150 });
    annotateResaleBaselines([resale, ticket({ row: 9999, price: 90 })]);
    expect(resale.baselineSource).toBe('Standing');
  });

  it('leaves the baseline unset when the section has no primary ticket', () => {
    const resale = ticket({ isResale: true, price: 150 });
    annotateResaleBaselines([resale, ticket({ isResale: true, price: 160 })]);
    expect(resale.baselinePrice).toBeUndefined();
  });

  it('does not touch primary tickets', () => {
    const primary = ticket();
    annotateResaleBaselines([primary]);
    expect(primary.baselinePrice).toBeUndefined();
  });
});

describe('rowPosition with lettered rows', () => {
  it('counts from Row A when nothing says otherwise', () => {
    expect(rowPosition(1)).toEqual({ tierStart: 1, index: 1 }); // Row A
    expect(rowPosition(3)).toEqual({ tierStart: 1, index: 3 }); // Row C
  });

  it('takes tier starts written as letters', () => {
    expect(rowPosition(11, ['A', 'K'])).toEqual({ tierStart: 11, index: 1 }); // Row K
    expect(rowPosition(13, ['A', 'K'])).toEqual({ tierStart: 11, index: 3 }); // Row M
    expect(rowPosition(10, ['A', 'K'])).toEqual({ tierStart: 1, index: 10 }); // Row J
    expect(rowPosition(27, ['A', 'K', 'AA'])).toEqual({ tierStart: 27, index: 1 }); // Row AA
    expect(rowPosition(28, ['a', 'k', 'aa'])).toEqual({ tierStart: 27, index: 2 }); // Row AB
  });

  it('copes with a mix and with entries that are not rows', () => {
    expect(rowPosition(13, [21, 'K'])).toEqual({ tierStart: 11, index: 3 });
    expect(rowPosition(13, ['K', 'nonsense', null])).toEqual({ tierStart: 11, index: 3 });
  });
});

describe('rowPosition', () => {
  it('is the row\'s place within its tier', () => {
    expect(rowPosition(21, [21, 33])).toEqual({ tierStart: 21, index: 1 });
    expect(rowPosition(26, [21, 33])).toEqual({ tierStart: 21, index: 6 });
    expect(rowPosition(32, [21, 33])).toEqual({ tierStart: 21, index: 12 });
    expect(rowPosition(33, [21, 33])).toEqual({ tierStart: 33, index: 1 });
    expect(rowPosition(40, [21, 33])).toEqual({ tierStart: 33, index: 8 });
  });

  it('is simply the row number when rows start at 1', () => {
    expect(rowPosition(1, [1])).toEqual({ tierStart: 1, index: 1 });
    expect(rowPosition(7, [1])).toEqual({ tierStart: 1, index: 7 });
    expect(rowPosition(7)).toEqual({ tierStart: 1, index: 7 });
  });

  it('treats a row before the first configured start as counting from Row 1', () => {
    expect(rowPosition(5, [21, 33])).toEqual({ tierStart: 1, index: 5 });
  });

  it('is null for rows that are not in a tier: VIP packages, standing, nothing', () => {
    expect(rowPosition(0, [1])).toBeNull();
    expect(rowPosition(9999, [1])).toBeNull();
    expect(rowPosition(NaN, [1])).toBeNull();
  });
});

describe('ordinal', () => {
  it('reads like English', () => {
    const got = [1, 2, 3, 4, 10, 11, 12, 13, 14, 21, 22, 23, 101, 111, 112].map(ordinal);
    expect(got).toEqual(['1st', '2nd', '3rd', '4th', '10th', '11th', '12th', '13th', '14th', '21st', '22nd', '23rd', '101st', '111th', '112th']);
  });
});

describe('computeBadges', () => {
  const ctx = { globalMinPrice: 50, sectionMinPrice: 60, sectionSize: 3 };

  it('flags the cheapest ticket overall and the cheapest in the section', () => {
    expect(computeBadges(ticket({ price: 50 }), ctx)).toMatchObject({ cheapest: true, blockprice: false });
    expect(computeBadges(ticket({ price: 60 }), ctx)).toMatchObject({ cheapest: false, blockprice: true });
  });

  it('does not call a lone ticket the best block price', () => {
    expect(computeBadges(ticket({ price: 60 }), { ...ctx, sectionSize: 1 }).blockprice).toBe(false);
  });

  it('with no venue settings: Row 1 is the first row and rows 1-5 are the front', () => {
    const flags = (row, extra = {}) => computeBadges(ticket({ row }), { ...ctx, ...DEFAULT_ROW_CONFIG, ...extra });
    expect(flags(1)).toMatchObject({ firstrow: true, frontrows: true });
    expect(flags(5)).toMatchObject({ firstrow: false, frontrows: true });
    expect(flags(6)).toMatchObject({ firstrow: false, frontrows: false });
  });

  it('never flags VIP packages (row 0) or standing as front rows', () => {
    [0, 9999].forEach((row) => {
      expect(computeBadges(ticket({ row }), { ...ctx, ...DEFAULT_ROW_CONFIG })).toMatchObject({ firstrow: false, frontrows: false });
    });
  });

  it('counts rows from the start of their own tier (3Arena: tiers start at rows 21 and 33)', () => {
    const config = { firstRows: [21, 33], frontRows: 3 };
    const flags = (row) => computeBadges(ticket({ row }), { ...ctx, ...config });
    expect(flags(21)).toMatchObject({ firstrow: true, frontrows: true });
    expect(flags(23)).toMatchObject({ firstrow: false, frontrows: true });
    expect(flags(24)).toMatchObject({ firstrow: false, frontrows: false });
    expect(flags(33)).toMatchObject({ firstrow: true, frontrows: true });
    expect(flags(35)).toMatchObject({ firstrow: false, frontrows: true });
    expect(flags(36)).toMatchObject({ firstrow: false, frontrows: false });
  });

  it('a number of front rows of 1 means just the first row of each tier', () => {
    expect(computeBadges(ticket({ row: 22 }), { ...ctx, firstRows: [21], frontRows: 1 }).frontrows).toBe(false);
    expect(computeBadges(ticket({ row: 21 }), { ...ctx, firstRows: [21], frontRows: 1 }).frontrows).toBe(true);
  });

  it('no longer flags "options in a row": the row heading counts its tickets', () => {
    expect(computeBadges(ticket({ row: 5 }), { ...ctx, rowCount: 2 })).not.toHaveProperty('rowoptions');
  });

  it('flags resale and markup over the baseline', () => {
    const marked = computeBadges(ticket({ isResale: true, price: 120, baselinePrice: 100 }), ctx);
    expect(marked).toMatchObject({ resale: true, markup: true });

    const discounted = computeBadges(ticket({ isResale: true, price: 90, baselinePrice: 100 }), ctx);
    expect(discounted.markup).toBe(false);

    const noBaseline = computeBadges(ticket({ isResale: true, price: 120 }), ctx);
    expect(noBaseline.markup).toBe(false);

    expect(computeBadges(ticket(), ctx)).toMatchObject({ resale: false });
    expect(computeBadges(ticket(), ctx)).not.toHaveProperty('facevalue'); // nothing to say about a ticket that is simply not resale
  });
});

describe('buildSectionGroups', () => {
  const tickets = () => [
    ticket({ section: '101', row: 12, price: 90 }),
    ticket({ section: '101', row: 3, price: 130 }),
    ticket({ section: '102', row: 20, price: 40 }),
    ticket({ section: 'PIT', row: 9999, price: 75 }),
    ticket({ section: 'VIP PACKAGES', originalSection: 'FLOOR', row: 0, type: 'vip', price: 300 }),
  ];

  it('groups by section and sorts groups by best seat, then tickets within', () => {
    const { groups, empty } = buildSectionGroups(tickets(), { sort: 'row' });
    expect(empty).toBeNull();
    expect(groups.map((g) => g.name)).toEqual(['VIP PACKAGES', 'PIT', '101', '102']);
    expect(groups.find((g) => g.name === '101').tickets.map((t) => t.row)).toEqual([3, 12]);
  });

  it('sorts groups by lowest price when sort is price', () => {
    const { groups } = buildSectionGroups(tickets(), { sort: 'price' });
    expect(groups.map((g) => g.name)).toEqual(['102', 'PIT', '101', 'VIP PACKAGES']);
    expect(groups.find((g) => g.name === '101').topTicket.price).toBe(90);
  });

  it('defaults to the best-seat sort', () => {
    expect(buildSectionGroups(tickets()).groups[0].name).toBe('VIP PACKAGES');
  });

  it('filters sections by name, case-insensitively', () => {
    const { groups } = buildSectionGroups(tickets(), { search: ' pit ' });
    expect(groups.map((g) => g.name)).toEqual(['PIT']);
  });

  it('reports no-sections when the name search matches nothing', () => {
    expect(buildSectionGroups(tickets(), { search: 'zzz' })).toMatchObject({ groups: [], empty: 'no-sections' });
  });

  it('applies the other badge filters with AND semantics, and with the seat choice', () => {
    const { groups } = buildSectionGroups(tickets(), { seat: 'frontrows', hideFilters: new Set(['resale']) });
    expect(groups.map((g) => g.name)).toEqual(['101']);
    expect(groups[0].tickets.map((t) => t.row)).toEqual([3]);
  });

  it('reports no-matches when the filters exclude everything', () => {
    expect(buildSectionGroups(tickets(), { badgeFilters: new Set(['resale']) })).toMatchObject({ groups: [], empty: 'no-matches' });
    expect(buildSectionGroups(tickets(), { seat: 'firstrow' })).toMatchObject({ groups: [], empty: 'no-matches' });
  });

  it('annotates tickets with badges', () => {
    const { groups } = buildSectionGroups(
      [ticket({ section: 'A', row: 4, price: 80 }), ticket({ section: 'A', row: 4, price: 95 })],
      {}
    );
    const [low, high] = groups[0].tickets;
    expect(low.badges).toMatchObject({ blockprice: true, firstrow: false, frontrows: true });
    expect(low.badges).not.toHaveProperty('rowoptions');
    expect(low).not.toHaveProperty('rowCount');
    expect(low.rowIndex).toBe(4);
    expect(low.tierStart).toBe(1);
    expect(high.badges.blockprice).toBe(false);
  });

  it('compares resale markup against same-row primary tickets', () => {
    const { groups } = buildSectionGroups([
      ticket({ section: 'A', row: 8, price: 100 }),
      ticket({ section: 'A', row: 8, price: 140, isResale: true }),
      ticket({ section: 'A', row: 9, price: 90, isResale: true }),
    ]);
    const byPrice = Object.fromEntries(groups[0].tickets.map((t) => [t.price, t.badges.markup]));
    expect(byPrice).toEqual({ 100: false, 140: true, 90: false });
  });

  it('handles an empty ticket list', () => {
    expect(buildSectionGroups([], {})).toMatchObject({ groups: [], empty: 'no-sections' });
  });
});

describe('attributes from the list API', () => {
  const tickets = () => [
    ticket({ row: 23, price: 90, attributes: [] }),
    ticket({ row: 24, price: 91, attributes: ['aisle'] }),
    ticket({ section: 'B', row: 5, price: 70, attributes: ['aisle', 'restrictedView'] }),
    ticket({ section: 'B', row: 6, price: 71 }), // read from a card: no attributes at all
  ];
  const rows = (result) => result.groups.flatMap((g) => g.tickets.map((t) => t.row)).sort((a, b) => a - b);

  it('flags the tickets that have them', () => {
    const { groups } = buildSectionGroups(tickets(), {});
    const byRow = Object.fromEntries(groups.flatMap((g) => g.tickets).map((t) => [t.row, t]));
    expect(byRow[24].badges['attr:aisle']).toBe(true);
    expect(byRow[5].badges['attr:aisle']).toBe(true);
    expect(byRow[5].badges['attr:restricted-view']).toBe(true);
    expect(byRow[23].badges['attr:aisle']).toBeFalsy();
    expect(byRow[6].badges['attr:aisle']).toBeFalsy();
  });

  it('filters on them, with the other filters', () => {
    expect(rows(buildSectionGroups(tickets(), { badgeFilters: ['attr:aisle'] }))).toEqual([5, 24]);
    expect(rows(buildSectionGroups(tickets(), { badgeFilters: ['attr:aisle', 'attr:restricted-view'] }))).toEqual([5]);
    expect(rows(buildSectionGroups(tickets(), { badgeFilters: ['attr:aisle'], price: 'cheapest' }))).toEqual([5]);
  });

  it('ignores a filter for an attribute no ticket here has', () => {
    expect(rows(buildSectionGroups(tickets(), { badgeFilters: ['attr:wheelchair'] }))).toEqual([5, 6, 23, 24]);
    expect(rows(buildSectionGroups([ticket({ row: 1 })], { badgeFilters: ['attr:aisle'] }))).toEqual([1]);
  });
});

describe('custom badges', () => {
  const compiled = compileBadges([
    { id: 'aisle1', label: 'Aisle', icon: '🚶', color: 'blue', pattern: 'aisle' },
    { id: 'restr', label: 'Restricted', icon: '👁️', color: 'red', pattern: 'restricted|limited view' },
  ]);
  const tickets = () => [
    ticket({ row: 23, price: 90, text: 'Section A Row 23 Aisle Seating Ticket' }),
    ticket({ row: 24, price: 91, text: 'Section A Row 24 Full Price Ticket' }),
    ticket({ section: 'B', row: 5, price: 70, text: 'Section B Row 5 Limited View' }),
  ];
  const rows = (result) => result.groups.flatMap((g) => g.tickets.map((t) => t.row)).sort((a, b) => a - b);

  it('marks the tickets whose text matches', () => {
    const { groups } = buildSectionGroups(tickets(), { customBadges: compiled });
    const byRow = Object.fromEntries(groups.flatMap((g) => g.tickets).map((t) => [t.row, t]));
    expect(byRow[23].badges['custom:aisle1']).toBe(true);
    expect(byRow[23].customMatches).toEqual([{ key: 'custom:aisle1', text: '🚶 Aisle', color: 'blue', pattern: 'aisle' }]);
    expect(byRow[24].badges['custom:aisle1']).toBeFalsy();
    expect(byRow[24].customMatches).toEqual([]);
    expect(byRow[5].badges['custom:restr']).toBe(true);
  });

  it('filters by a custom badge, together with the built-in ones', () => {
    expect(rows(buildSectionGroups(tickets(), { customBadges: compiled, badgeFilters: ['custom:aisle1'] }))).toEqual([23]);
    expect(rows(buildSectionGroups(tickets(), { customBadges: compiled, badgeFilters: ['custom:aisle1', 'custom:restr'] }))).toEqual([]);
    expect(rows(buildSectionGroups(tickets(), { customBadges: compiled, badgeFilters: ['custom:aisle1'], price: 'cheapest' }))).toEqual([23]); // the cheapest of the aisle tickets
    expect(buildSectionGroups(tickets(), { customBadges: compiled, badgeFilters: ['custom:aisle1', 'custom:restr'] }).empty).toBe('no-matches');
    expect(rows(buildSectionGroups(tickets(), { customBadges: compiled, badgeFilters: ['custom:restr'], price: 'cheapest' }))).toEqual([5]);
  });

  it('ignores a custom badge filter that does not exist here (a deleted badge, or another venue\'s)', () => {
    expect(rows(buildSectionGroups(tickets(), { customBadges: compiled, badgeFilters: ['custom:gone'] }))).toEqual([5, 23, 24]);
    expect(rows(buildSectionGroups(tickets(), { badgeFilters: ['custom:aisle1'] }))).toEqual([5, 23, 24]);
  });

  it('also matches the title the ticket is listed under, so patterns can be written from what the list shows', () => {
    const paren = compileBadges([{ id: 'p', label: 'Paren', icon: '', color: 'teal', pattern: '\\(Aisle Seating Ticket\\)' }]);
    const t = ticket({ row: 23, price: 90, title: 'Row 23 (Aisle Seating Ticket)', text: 'Section A Row 23 Aisle Seating Ticket €90.00 each' });
    const { groups } = buildSectionGroups([t], { customBadges: paren, badgeFilters: ['custom:p'] });
    expect(groups[0].tickets[0].customMatches.map((m) => m.key)).toEqual(['custom:p']);
  });

  it('copes with tickets that have no text', () => {
    const { groups } = buildSectionGroups([ticket()], { customBadges: compiled });
    expect(groups[0].tickets[0].customMatches).toEqual([]);
  });
});

describe('formatBestTicketLabel', () => {
  it('leads with the price for the price sort and the row for the seat sort', () => {
    const t = ticket({ row: 7, rowName: '7', price: 85 });
    expect(formatBestTicketLabel(t, 'price')).toBe('Lowest: €85.00, Row: 7');
    expect(formatBestTicketLabel(t, 'row')).toBe('Row: 7, €85.00');
  });

  it('uses the ticket currency', () => {
    expect(formatBestTicketLabel(ticket({ row: 7, price: 85, currency: '£' }), 'price')).toBe('Lowest: £85.00, Row: 7');
  });

  it('shows the place within the tier when the venue\'s rows do not start at 1', () => {
    const [t] = buildSectionGroups([ticket({ row: 21, rowName: '21', price: 80.75 })], { rowConfig: { firstRows: [21, 33] } }).groups[0].tickets;
    expect(formatBestTicketLabel(t, 'price')).toBe('Lowest: €80.75, Row: 21 (1st)');
    expect(formatBestTicketLabel(t, 'row')).toBe('Row: 21 (1st), €80.75');

    const [upper] = buildSectionGroups([ticket({ row: 36, rowName: '36', price: 60 })], { rowConfig: { firstRows: [21, 33] } }).groups[0].tickets;
    expect(formatBestTicketLabel(upper, 'price')).toBe('Lowest: €60.00, Row: 36 (4th)');
  });

  it('leaves the place out when it would only repeat the row number', () => {
    const [t] = buildSectionGroups([ticket({ row: 3, rowName: '3' })]).groups[0].tickets;
    expect(t.rowIndex).toBe(3);
    expect(formatBestTicketLabel(t, 'price')).toBe('Lowest: €100.00, Row: 3');
  });

  it('describes standing, VIP and unpriced tickets', () => {
    expect(formatBestTicketLabel(ticket({ row: 9999, rowName: null }), 'row')).toBe('Standing, €100.00');
    expect(formatBestTicketLabel(ticket({ row: 9999, rowName: null }), 'price')).toBe('Lowest: €100.00, Standing');
    expect(formatBestTicketLabel(ticket({ type: 'vip', row: 0, originalSection: 'FLOOR' }), 'row')).toBe('FLOOR, €100.00');
    expect(formatBestTicketLabel(ticket({ type: 'vip', row: 0, originalSection: '' }), 'row')).toBe('VIP, €100.00');
    expect(formatBestTicketLabel(ticket({ row: 10, rowName: '10', price: 0 }), 'price')).toBe('Lowest: N/A, Row: 10');
  });

  it('returns an empty string without a ticket', () => {
    expect(formatBestTicketLabel(null, 'row')).toBe('');
  });
});

describe('lettered rows in the first / front row badges', () => {
  const lettered = (name, extra = {}) => ticket({ row: rowRank(name), rowName: name, rowLabel: 'Row ' + name, text: 'Row ' + name, ...extra });
  const group = (names, options) => buildSectionGroups(names.map((n) => lettered(n)), options).groups[0].tickets;
  const byName = (tickets, name) => tickets.find((t) => t.rowName === name);

  it('treats Row A as the first row, and the next few as front rows, with nothing configured', () => {
    const tickets = group(['A', 'B', 'E', 'F']);
    expect(byName(tickets, 'A').badges).toMatchObject({ firstrow: true, frontrows: true });
    expect(byName(tickets, 'B').badges).toMatchObject({ firstrow: false, frontrows: true });
    expect(byName(tickets, 'E').badges.frontrows).toBe(true); // 5th
    expect(byName(tickets, 'F').badges.frontrows).toBe(false);
  });

  it('follows tiers that start at letters', () => {
    const tickets = group(['A', 'J', 'K', 'L', 'N'], { rowConfig: { firstRows: ['A', 'K'], frontRows: 3 } });
    expect(byName(tickets, 'K')).toMatchObject({ tierStart: 11, tierStartName: 'K', rowIndex: 1 });
    expect(byName(tickets, 'K').badges.firstrow).toBe(true);
    expect(byName(tickets, 'L').badges).toMatchObject({ firstrow: false, frontrows: true });
    expect(byName(tickets, 'N').badges.frontrows).toBe(false); // 4th of its tier, 3 count
    expect(byName(tickets, 'J').badges.frontrows).toBe(false); // 10th of the first tier
  });

  it('writes the tier start the way the ticket writes its row', () => {
    const [letter] = group(['M'], { rowConfig: { firstRows: ['K'] } });
    expect(letter.tierStartName).toBe('K');
    const [number] = buildSectionGroups([ticket({ row: 23, rowName: '23' })], { rowConfig: { firstRows: [21] } }).groups[0].tickets;
    expect(number.tierStartName).toBe('21');
  });

  it('says where the place is in the section header label, always for letters', () => {
    const [c] = group(['C']);
    expect(formatBestTicketLabel(c, 'price')).toBe('Lowest: €100.00, Row: C (3rd)');
    expect(formatBestTicketLabel(c, 'row')).toBe('Row: C (3rd), €100.00');
    const [m] = group(['M'], { rowConfig: { firstRows: ['A', 'K'] } });
    expect(formatBestTicketLabel(m, 'price')).toBe('Lowest: €100.00, Row: M (3rd)');
    const [k] = group(['K'], { rowConfig: { firstRows: ['A', 'K'] } });
    expect(formatBestTicketLabel(k, 'row')).toBe('Row: K (1st), €100.00');
  });

  it('filters by them', () => {
    const rows = (names, seat, config) => buildSectionGroups(names.map((n) => lettered(n)), { seat, rowConfig: config }).groups.flatMap((g) => g.tickets.map((t) => t.rowName)).sort();
    expect(rows(['A', 'B', 'K', 'L'], 'firstrow', { firstRows: ['A', 'K'] })).toEqual(['A', 'K']);
    expect(rows(['A', 'B', 'C', 'K', 'L', 'M'], 'frontrows', { firstRows: ['A', 'K'], frontRows: 2 })).toEqual(['A', 'B', 'K', 'L']);
  });
});

describe('rows with letters', () => {
  it('uses the row name in the best-ticket label and in resale baselines', () => {
    const t = ticket({ row: 3, rowName: 'C', rowLabel: 'Row C', price: 90 });
    expect(formatBestTicketLabel(t, 'row')).toBe('Row: C, €90.00');

    const resale = ticket({ isResale: true, row: 3, rowName: 'C', rowLabel: 'Row C', price: 150 });
    annotateResaleBaselines([resale, ticket({ row: 3, rowName: 'C', rowLabel: 'Row C', price: 100 })]);
    expect(resale.baselineSource).toBe('Row C');
  });

  it('sorts lettered rows front to back', () => {
    const { groups } = buildSectionGroups(
      [
        ticket({ section: 'S', row: 27, rowName: 'AA', rowLabel: 'Row AA' }),
        ticket({ section: 'S', row: 2, rowName: 'B', rowLabel: 'Row B' }),
        ticket({ section: 'S', row: 26, rowName: 'Z', rowLabel: 'Row Z' }),
      ],
      { sort: 'row' }
    );
    expect(groups[0].tickets.map((t) => t.rowName)).toEqual(['B', 'Z', 'AA']);
  });
});

describe('buildSectionGroups with venue row settings', () => {
  const venueTickets = () => [
    ticket({ section: 'BLOCKA', row: 21, price: 80 }),
    ticket({ section: 'BLOCKA', row: 23, price: 80 }),
    ticket({ section: 'BLOCKA', row: 28, price: 80 }),
    ticket({ section: 'BLOCKH', row: 33, price: 60 }),
    ticket({ section: 'BLOCKH', row: 34, price: 60 }),
    ticket({ section: 'BLOCKH', row: 40, price: 60 }),
  ];
  const rowsOf = (result) => result.groups.flatMap((g) => g.tickets.map((t) => t.row)).sort((a, b) => a - b);
  const config = { firstRows: [21, 33], frontRows: 2 };

  it('without settings there is no Row 1 here, so nothing is a first row and nothing is at the front', () => {
    expect(rowsOf(buildSectionGroups(venueTickets(), { seat: 'firstrow' }))).toEqual([]);
    expect(rowsOf(buildSectionGroups(venueTickets(), { seat: 'frontrows' }))).toEqual([]);
  });

  it('with the tiers set, the first row filter finds the first row of each tier', () => {
    expect(rowsOf(buildSectionGroups(venueTickets(), { rowConfig: config, seat: 'firstrow' }))).toEqual([21, 33]);
  });

  it('...and the front rows filter finds the first few rows of each tier', () => {
    expect(rowsOf(buildSectionGroups(venueTickets(), { rowConfig: config, seat: 'frontrows' }))).toEqual([21, 33, 34]);
    expect(rowsOf(buildSectionGroups(venueTickets(), { rowConfig: { firstRows: [21, 33], frontRows: 3 }, seat: 'frontrows' }))).toEqual([21, 23, 33, 34]);
  });

  it('the two filters combine: front rows that are not the first row', () => {
    const only = buildSectionGroups(venueTickets(), { rowConfig: { firstRows: [21, 33], frontRows: 3 }, seat: 'frontrows' });
    const first = new Set(buildSectionGroups(venueTickets(), { rowConfig: { firstRows: [21, 33], frontRows: 3 }, seat: 'firstrow' }).groups.flatMap((g) => g.tickets.map((t) => t.row)));
    expect(rowsOf(only).filter((r) => !first.has(r))).toEqual([23, 34]);
  });

  it('annotates each ticket with its place in its tier', () => {
    const { groups } = buildSectionGroups(venueTickets(), { rowConfig: config });
    const byRow = Object.fromEntries(groups.flatMap((g) => g.tickets).map((t) => [t.row, [t.tierStart, t.rowIndex]]));
    expect(byRow[21]).toEqual([21, 1]);
    expect(byRow[28]).toEqual([21, 8]);
    expect(byRow[33]).toEqual([33, 1]);
    expect(byRow[40]).toEqual([33, 8]);
  });
});

describe('the seat and price choices', () => {
  const T = () => [
    ticket({ section: 'A', row: 1, price: 100 }),
    ticket({ section: 'A', row: 2, price: 80 }),
    ticket({ section: 'A', row: 9, price: 60 }),
    ticket({ section: 'B', row: 1, price: 90 }),
    ticket({ section: 'B', row: 7, price: 50 }),
    ticket({ section: 'B', row: 9999, price: 40 }),
    ticket({ section: 'C', row: 9999, price: 70 }),
    ticket({ section: 'C', row: 3, price: 55, isResale: true }),
    ticket({ section: 'VIP PACKAGES', originalSection: 'X', row: 0, type: 'vip', price: 300 }),
  ];
  const rows = (opts, tickets = T()) => buildSectionGroups(tickets, { rowConfig: { firstRows: [1], frontRows: 2 }, ...opts }).groups.flatMap((g) => g.tickets.map((t) => g.name + t.row)).sort();

  it('shows everything by default, and for All / Any', () => {
    expect(rows({})).toHaveLength(9);
    expect(rows({ seat: 'all', price: 'any' })).toHaveLength(9);
    expect(rows({ seat: 'nonsense', price: 'nonsense' })).toHaveLength(9);
  });

  describe('seats', () => {
    it('1st Row is the first row of each tier', () => {
      expect(rows({ seat: 'firstrow' })).toEqual(['A1', 'B1']);
    });

    it('Front Rows includes the first row, and as many rows as are set', () => {
      expect(rows({ seat: 'frontrows' })).toEqual(['A1', 'A2', 'B1']);
    });

    it('standing tickets and VIP packages are never first or front rows', () => {
      ['firstrow', 'frontrows'].forEach((seat) => {
        const names = rows({ seat });
        expect(names.some((n) => n.endsWith('9999') || n.startsWith('VIP'))).toBe(false);
      });
    });
  });

  describe('price', () => {
    it('Cheapest is the cheapest ticket overall', () => {
      expect(rows({ price: 'cheapest' })).toEqual(['B9999']);
    });

    it('Section Low is the cheapest ticket of each section, sections with one ticket included', () => {
      expect(rows({ price: 'sectionlow' })).toEqual(['A9', 'B9999', 'C3', 'VIP PACKAGES0']);
    });

    it('keeps tickets that tie for the lowest price', () => {
      const tied = [ticket({ section: 'A', row: 1, price: 50 }), ticket({ section: 'A', row: 2, price: 50 }), ticket({ section: 'A', row: 3, price: 60 })];
      expect(rows({ price: 'cheapest' }, tied)).toEqual(['A1', 'A2']);
      expect(rows({ price: 'sectionlow' }, tied)).toEqual(['A1', 'A2']);
    });

    it('never treats a ticket with no price as the cheapest', () => {
      const t = [ticket({ section: 'A', row: 1, price: 0 }), ticket({ section: 'A', row: 2, price: 40 })];
      expect(rows({ price: 'cheapest' }, t)).toEqual(['A2']);
      expect(rows({ price: 'sectionlow' }, t)).toEqual(['A2']);
      expect(rows({ price: 'cheapest' }, [ticket({ price: 0 })])).toEqual([]);
    });
  });

  describe('together', () => {
    it('price is worked out on what the other filters leave: the cheapest front-row ticket, the cheapest in each section', () => {
      expect(rows({ seat: 'frontrows', price: 'cheapest' })).toEqual(['A2']);
      expect(rows({ seat: 'frontrows', price: 'sectionlow' })).toEqual(['A2', 'B1']);
      expect(rows({ badgeFilters: ['standing'], price: 'cheapest' })).toEqual(['B9999']);
      expect(rows({ badgeFilters: ['standing'], price: 'sectionlow' })).toEqual(['B9999', 'C9999']);
    });

    it('works on what the search leaves too', () => {
      expect(rows({ search: 'c', price: 'cheapest' })).toEqual(['C3']);
    });

    it('and with the other badges', () => {
      expect(rows({ badgeFilters: ['resale'], price: 'cheapest' })).toEqual(['C3']);
      expect(rows({ badgeFilters: ['resale', 'standing'] })).toEqual([]);
    });

    it('the Cheapest badge on a ticket still means cheapest of the whole event', () => {
      const { groups } = buildSectionGroups(T(), { seat: 'frontrows' });
      const flagged = groups.flatMap((g) => g.tickets).filter((t) => t.badges.cheapest);
      expect(flagged).toEqual([]); // the event's cheapest (standing, 40) is not among the front rows shown
    });
  });

  describe('counts', () => {
    const counts = (opts, tickets = T()) => buildSectionGroups(tickets, { rowConfig: { firstRows: [1], frontRows: 2 }, ...opts }).counts;

    it('say how many tickets each pill would show', () => {
      const c = counts({});
      expect(c.seat).toEqual({ firstrow: 2, frontrows: 3, all: 9 });
      expect(c.price).toEqual({ cheapest: 1, sectionlow: 4, any: 9 });
      expect(c.other).toEqual({ standing: 2, resale: 1, vip: 1 });
    });

    it('take the other choices into account: a seat pill replaces the seat choice, price follows it', () => {
      const c = counts({ seat: 'frontrows' });
      expect(c.seat).toEqual({ firstrow: 2, frontrows: 3, all: 9 }); // each as if chosen instead
      expect(c.price).toEqual({ cheapest: 1, sectionlow: 2, any: 3 }); // among the front rows
      expect(c.other.resale).toBe(0);
    });

    it('take the price choice into account for the seat pills', () => {
      const c = counts({ price: 'cheapest' });
      expect(c.seat).toEqual({ firstrow: 1, frontrows: 1, all: 1 }); // the cheapest of each group's tickets
    });

    it('take the search into account', () => {
      const c = counts({ search: 'b' });
      expect(c.seat.all).toBe(3);
      expect(c.price.any).toBe(3);
      expect(c.price.cheapest).toBe(1);
    });

    it('add an other pill to the other pills already on', () => {
      const t = [
        ticket({ section: 'A', row: 1, price: 10, attributes: ['aisle'] }),
        ticket({ section: 'A', row: 2, price: 11, attributes: ['aisle'], isResale: true }),
        ticket({ section: 'A', row: 3, price: 12, isResale: true }),
      ];
      expect(counts({}, t).other).toEqual({ standing: 0, resale: 2, vip: 0, 'attr:aisle': 2 });
      expect(counts({ badgeFilters: ['resale'] }, t).other).toEqual({ standing: 0, resale: 2, vip: 0, 'attr:aisle': 1 });
      expect(counts({ badgeFilters: ['attr:aisle'] }, t).other).toEqual({ standing: 0, resale: 1, vip: 0, 'attr:aisle': 2 });
    });

    it('have a count for each of the user\'s own badges', () => {
      const compiled = compileBadges([{ id: 'x1', label: 'X', icon: '', color: 'teal', pattern: 'row 1' }]);
      const c = counts({ customBadges: compiled }, [ticket({ row: 1, text: 'Row 1' }), ticket({ row: 2, text: 'Row 2' })]);
      expect(c.other['custom:x1']).toBe(1);
    });

    it('are all zero when nothing matches the search, and for an empty list', () => {
      expect(counts({ search: 'zzz' }).seat).toEqual({ firstrow: 0, frontrows: 0, all: 0 });
      expect(counts({}, []).price).toEqual({ cheapest: 0, sectionlow: 0, any: 0 });
    });
  });
});

describe('the quality choice', () => {
  // ten tickets, scores 0.1 .. 1.0 (higher is better); one has none
  const Q = () => [
    ...Array.from({ length: 10 }, (_, i) => ticket({ section: i < 5 ? 'A' : 'B', row: i + 1, price: 100 + i, quality: (i + 1) / 10 })),
    ticket({ section: 'C', row: 1, price: 50 }), // no score (read from a card)
  ];
  const scores = (opts, tickets = Q()) => buildSectionGroups(tickets, opts).groups.flatMap((g) => g.tickets.map((t) => t.quality)).filter((q) => q !== undefined).sort((a, b) => a - b);
  const count = (opts, tickets = Q()) => buildSectionGroups(tickets, opts).groups.flatMap((g) => g.tickets).length;

  it('is no filter by default, and for Any', () => {
    expect(count({})).toBe(11);
    expect(count({ quality: 'any' })).toBe(11);
    expect(count({ quality: 'nonsense' })).toBe(11);
  });

  it('keeps the best share of the tickets that have a score', () => {
    expect(scores({ quality: 'top10' })).toEqual([1]);
    expect(scores({ quality: 'top25' })).toEqual([0.8, 0.9, 1]); // 25% of 10, rounded up to 3
    expect(scores({ quality: 'top50' })).toEqual([0.6, 0.7, 0.8, 0.9, 1]);
  });

  it('leaves out tickets with no score once a quality is chosen', () => {
    expect(buildSectionGroups(Q(), { quality: 'top50' }).groups.map((g) => g.name)).not.toContain('C');
  });

  it('always keeps at least one ticket', () => {
    expect(scores({ quality: 'top10' }, [ticket({ quality: 0.2 }), ticket({ quality: 0.9 })])).toEqual([0.9]);
    expect(scores({ quality: 'top10' }, [ticket({ quality: 0.5 })])).toEqual([0.5]);
  });

  it('keeps tickets that tie at the line', () => {
    const tied = [0.9, 0.7, 0.7, 0.7, 0.2, 0.2, 0.2, 0.2].map((quality, i) => ticket({ row: i + 1, quality }));
    expect(scores({ quality: 'top25' }, tied)).toEqual([0.7, 0.7, 0.7, 0.9]); // the 2nd best is 0.7, and so are two more
  });

  it('is a share of the whole event, not of what the other filters leave', () => {
    // Section A holds scores .1-.5, section B .6-1: "best 25%" is the same three tickets wherever you look
    expect(scores({ quality: 'top25', search: 'a' })).toEqual([]);
    expect(scores({ quality: 'top25', search: 'b' })).toEqual([0.8, 0.9, 1]);
  });

  it('does nothing when no ticket has a score (the cards of the scrolling fallback)', () => {
    const none = [ticket({ row: 1 }), ticket({ row: 2 })];
    expect(count({ quality: 'top10' }, none)).toBe(2);
  });

  it('combines with the seat and price choices: price is still last', () => {
    expect(scores({ quality: 'top50', price: 'cheapest' })).toEqual([0.6]); // the cheapest of the best half (prices go up with the score here)
    expect(scores({ quality: 'top50', badgeFilters: ['standing'] })).toEqual([]);
  });

  describe('counts', () => {
    it('say how many tickets each choice would leave', () => {
      expect(buildSectionGroups(Q(), {}).counts.quality).toEqual({ any: 11, top10: 1, top25: 3, top50: 5 });
    });

    it('follow the other filters (but not the share itself, which is of the whole event)', () => {
      expect(buildSectionGroups(Q(), { search: 'b' }).counts.quality).toEqual({ any: 5, top10: 1, top25: 3, top50: 5 });
      expect(buildSectionGroups(Q(), { price: 'cheapest' }).counts.quality).toEqual({ any: 1, top10: 1, top25: 1, top50: 1 });
    });

    it('are not there when no ticket has a score', () => {
      expect(buildSectionGroups([ticket({ row: 1 })], {}).counts.quality).toBeNull();
      expect(buildSectionGroups([], {}).counts.quality).toBeNull();
    });
  });
});

describe('the quality tier of a ticket', () => {
  const tiers = (qualities) => Object.fromEntries(buildSectionGroups(qualities.map((quality, i) => ticket({ row: i + 1, quality })), {}).groups.flatMap((g) => g.tickets).map((t) => [t.quality, t.qualityTier]));

  it('is the narrowest share of the event\'s tickets its score is in', () => {
    const t = tiers([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(t[1]).toBe('top10');
    expect(t[0.9]).toBe('top25');
    expect(t[0.8]).toBe('top25');
    expect(t[0.7]).toBe('top50');
    expect(t[0.6]).toBe('top50');
    expect(t[0.5]).toBeNull();
    expect(t[0.1]).toBeNull();
  });

  it('agrees with what the Quality filter keeps', () => {
    const scores = [0.9, 0.3, 0.7, 0.5, 0.1, 0.6, 0.8, 0.2, 0.4, 1];
    const made = scores.map((quality, i) => ticket({ row: i + 1, quality }));
    ['top10', 'top25', 'top50'].forEach((share) => {
      const kept = buildSectionGroups(made.map((t) => ({ ...t })), { quality: share }).groups.flatMap((g) => g.tickets).map((t) => t.quality).sort();
      const byTier = buildSectionGroups(made.map((t) => ({ ...t })), {}).groups.flatMap((g) => g.tickets);
      const order = ['top10', 'top25', 'top50'];
      const inShare = byTier.filter((t) => t.qualityTier && order.indexOf(t.qualityTier) <= order.indexOf(share)).map((t) => t.quality).sort();
      expect(inShare).toEqual(kept);
    });
  });

  it('is null for tickets with no score, and for everything when none has one', () => {
    expect(buildSectionGroups([ticket({ row: 1 }), ticket({ row: 2 })], {}).groups[0].tickets.map((t) => t.qualityTier)).toEqual([null, null]);
    const mixed = buildSectionGroups([ticket({ row: 1, quality: 0.9 }), ticket({ row: 2 })], {}).groups[0].tickets;
    expect(mixed.map((t) => [t.row, t.qualityTier])).toEqual([[1, 'top10'], [2, null]]);
  });
});

describe('the order of sections and tickets when sorted', () => {
  const T = () => [
    ticket({ section: 'A', row: 30, price: 80 }),
    ticket({ section: 'A', row: 21, price: 80 }),
    ticket({ section: 'B', row: 25, price: 80 }),
    ticket({ section: 'B', row: 5, price: 95 }),
    ticket({ section: 'C', row: 2, price: 80 }),
  ];
  const order = (sort) => buildSectionGroups(T(), { sort }).groups.map((g) => g.name + ':' + g.tickets.map((t) => t.row).join(','));

  it('by price: within a section the cheapest first, then the better row; sections tie-break on their top ticket\'s row', () => {
    // A, B and C all start at 80; C's best row (2) is nearest, then A's (21), then B's (25)
    expect(order('price')).toEqual(['C:2', 'A:21,30', 'B:25,5']);
  });

  it('by seat: within a section the best row first, then the lower price; sections tie-break on price', () => {
    expect(order('row')).toEqual(['C:2', 'B:5,25', 'A:21,30']);
  });

  it('shows the cheapest of a tie as the section\'s best ticket', () => {
    const groups = buildSectionGroups(T(), { sort: 'price' }).groups;
    expect(groups.find((g) => g.name === 'A').topTicket.row).toBe(21);
  });
});

describe('the rows of a section', () => {
  const T = () => [
    ticket({ section: 'A', row: 30, rowName: '30', rowLabel: 'Row 30', price: 80 }),
    ticket({ section: 'A', row: 21, rowName: '21', rowLabel: 'Row 21', price: 80, seat: '1-2' }),
    ticket({ section: 'A', row: 21, rowName: '21', rowLabel: 'Row 21', price: 95, seat: '3-4' }),
    ticket({ section: 'A', row: 25, rowName: '25', rowLabel: 'Row 25', price: 70 }),
    ticket({ section: 'A', row: 9999, rowName: null, rowLabel: 'Standing', price: 60 }),
    ticket({ section: 'VIP PACKAGES', originalSection: 'FLOOR', type: 'vip', row: 0, rowName: '1', rowLabel: 'Row 1', price: 300 }),
    ticket({ section: 'VIP PACKAGES', originalSection: 'PIT', type: 'vip', row: 0, rowName: '2', rowLabel: 'Row 2', price: 350 }),
  ];
  const rowsOf = (sort, opts = {}) => buildSectionGroups(T(), { sort, ...opts }).groups.find((g) => g.name === 'A').rows;
  const summary = (rows) => rows.map((r) => r.label + ':' + r.tickets.map((t) => t.price).join('/'));

  it('splits each section into its rows, with a label and the tickets in each', () => {
    const rows = rowsOf('price');
    expect(rows.map((r) => r.label).sort()).toEqual(['Row 21', 'Row 25', 'Row 30', 'Standing']);
    expect(rows.find((r) => r.label === 'Row 21').tickets).toHaveLength(2);
    expect(rows.find((r) => r.label === 'Row 21').row).toBe(21);
  });

  it('keeps every ticket in exactly one row', () => {
    const group = buildSectionGroups(T(), {}).groups.find((g) => g.name === 'A');
    const inRows = group.rows.flatMap((r) => r.tickets);
    expect(inRows).toHaveLength(group.tickets.length);
    expect(new Set(inRows).size).toBe(inRows.length);
  });

  it('puts the rows in the order of their best ticket: by price the cheapest row first', () => {
    expect(summary(rowsOf('price'))).toEqual(['Standing:60', 'Row 25:70', 'Row 21:80/95', 'Row 30:80']); // 21 before 30: the same price, the better row
  });

  it('...and by seat the best row first, standing before rows', () => {
    expect(summary(rowsOf('row'))).toEqual(['Standing:60', 'Row 21:80/95', 'Row 25:70', 'Row 30:80']);
  });

  it('has a row\'s tickets in the sort order too: the lower price first', () => {
    expect(rowsOf('row').find((r) => r.label === 'Row 21').tickets.map((t) => t.price)).toEqual([80, 95]);
    expect(rowsOf('price').find((r) => r.label === 'Row 21').tickets.map((t) => t.seat)).toEqual(['1-2', '3-4']);
  });

  it('gives each row its best ticket', () => {
    rowsOf('price').forEach((r) => expect(r.topTicket).toBe(r.tickets[0]));
  });

  it('only has the tickets that passed the filters', () => {
    const rows = rowsOf('price', { price: 'cheapest' });
    expect(rows.map((r) => r.label)).toEqual(['Standing']);
    expect(rowsOf('row', { badgeFilters: ['standing'] }).map((r) => r.label)).toEqual(['Standing']);
  });

  it('splits VIP packages by the section each is for and its row, the section kept for the heading', () => {
    const vip = buildSectionGroups(T(), {}).groups.find((g) => g.name === 'VIP PACKAGES');
    expect(vip.tickets).toHaveLength(2);
    expect(vip.rows.map((r) => [r.label, r.section, r.tickets.length])).toEqual([['Row 1', 'FLOOR', 1], ['Row 2', 'PIT', 1]]);
  });

  it('gives an ordinary row no section (the heading above it says)', () => {
    rowsOf('price').forEach((r) => expect(r.section).toBeNull());
  });

  it('labels a lettered row by its letter, and falls back to the row number without a label', () => {
    const rows = buildSectionGroups([ticket({ section: 'S', row: 3, rowName: 'C', rowLabel: 'Row C' }), ticket({ section: 'S', row: 4 })], {}).groups[0].rows;
    expect(rows.map((r) => r.label)).toEqual(['Row C', 'Row 4']);
  });
});

describe('hiding the tickets that have a badge', () => {
  const T = () => [
    ticket({ section: 'A', row: 1, price: 90, attributes: ['aisle'] }),
    ticket({ section: 'A', row: 2, price: 80 }),
    ticket({ section: 'A', row: 3, price: 70, isResale: true }),
    ticket({ section: 'B', row: 4, price: 60, attributes: ['aisle'], isResale: true }),
    ticket({ section: 'B', row: 5, price: 50 }),
  ];
  const rows = (opts, tickets = T()) => buildSectionGroups(tickets, opts).groups.flatMap((g) => g.tickets.map((t) => t.row)).sort((a, b) => a - b);

  it('leaves out every ticket that has it', () => {
    expect(rows({ hideFilters: ['attr:aisle'] })).toEqual([2, 3, 5]);
    expect(rows({ hideFilters: ['resale'] })).toEqual([1, 2, 5]);
  });

  it('leaves out the tickets with any of several', () => {
    expect(rows({ hideFilters: ['attr:aisle', 'resale'] })).toEqual([2, 5]);
  });

  it('works with the other filters: only these, but none of those', () => {
    expect(rows({ badgeFilters: ['resale'], hideFilters: ['attr:aisle'] })).toEqual([3]);
    expect(rows({ hideFilters: ['attr:aisle'], seat: 'frontrows' })).toEqual([2, 3, 5]);
  });

  it('is applied before the price choice: the cheapest of what is left', () => {
    expect(rows({ hideFilters: ['resale'], price: 'cheapest' })).toEqual([5]); // 5 is €50: the cheapest anyway
    expect(rows({ hideFilters: ['attr:aisle'], price: 'sectionlow' })).toEqual([3, 5]); // A: row 3 (70), B: row 5 (50)
    expect(rows({ hideFilters: ['attr:aisle'], price: 'cheapest' })).toEqual([5]);
    expect(rows({ hideFilters: ['resale', 'attr:aisle'], price: 'sectionlow' })).toEqual([2, 5]);
  });

  it('ignores a key that is also in the shown-only list (a pill is one or the other)', () => {
    expect(rows({ badgeFilters: ['attr:aisle'], hideFilters: ['attr:aisle'] })).toEqual([1, 4]);
  });

  it('ignores a hidden attribute or custom badge that does not exist here', () => {
    expect(rows({ hideFilters: ['attr:wheelchair'] })).toEqual([1, 2, 3, 4, 5]);
    expect(rows({ hideFilters: ['custom:gone'] })).toEqual([1, 2, 3, 4, 5]);
  });

  it('hides tickets matched by one of the user\'s own badges', () => {
    const compiled = compileBadges([{ id: 'x1', label: 'X', icon: '', color: 'teal', pattern: 'row 2' }]);
    const t = [ticket({ row: 1, text: 'Row 1' }), ticket({ row: 2, text: 'Row 2' })];
    expect(rows({ customBadges: compiled, hideFilters: ['custom:x1'] }, t)).toEqual([1]);
  });

  it('can hide everything, and then says so', () => {
    const result = buildSectionGroups([ticket({ row: 1, isResale: true })], { hideFilters: ['resale'] });
    expect(result).toMatchObject({ groups: [], empty: 'no-matches' });
  });

  it('accepts a Set', () => {
    expect(rows({ hideFilters: new Set(['resale']) })).toEqual([1, 2, 5]);
  });

  describe('counts', () => {
    const counts = (opts) => buildSectionGroups(T(), opts).counts.other;

    it('say how many tickets have the badge, whether its pill is off, showing only, or hiding', () => {
      expect(counts({})).toEqual({ standing: 0, resale: 2, vip: 0, 'attr:aisle': 2 });
      expect(counts({ badgeFilters: ['attr:aisle'] })).toEqual({ standing: 0, resale: 1, vip: 0, 'attr:aisle': 2 });
      expect(counts({ hideFilters: ['attr:aisle'] })['attr:aisle']).toBe(2); // how many it is hiding
    });

    it('count what is left of the other filters, hidden badges included', () => {
      // with aisle hidden, a ticket that is resale AND aisle is out: only row 3 is resale
      expect(counts({ hideFilters: ['attr:aisle'] }).resale).toBe(1);
      expect(counts({ hideFilters: ['resale'] })['attr:aisle']).toBe(1); // aisle but not resale: row 1
    });

    it('do not hide a pill\'s own tickets from its own count', () => {
      expect(counts({ hideFilters: ['resale'] }).resale).toBe(2);
    });
  });
});

describe('standing and seated tickets', () => {
  const T = () => [
    ticket({ section: 'A', row: 1, price: 90 }),
    ticket({ section: 'A', row: 2, price: 80 }),
    ticket({ section: 'B', row: 9999, rowName: null, rowLabel: 'Standing', price: 60 }),
    ticket({ section: 'B', row: 9999, rowName: null, rowLabel: 'Standing', price: 70, isResale: true }),
    ticket({ section: 'VIP PACKAGES', originalSection: 'FLOOR', type: 'vip', row: 0, price: 300 }),
  ];
  const kinds = (opts) => buildSectionGroups(T(), opts).groups.flatMap((g) => g.tickets.map((t) => (t.type === 'vip' ? 'vip' : t.row === 9999 ? 'standing' : 'row ' + t.row)));

  it('Standing, shown only, is the tickets with no row (not VIP packages)', () => {
    expect(kinds({ badgeFilters: ['standing'] })).toEqual(['standing', 'standing']);
  });

  it('Standing, hidden, leaves the seated tickets', () => {
    expect(kinds({ hideFilters: ['standing'] }).sort()).toEqual(['row 1', 'row 2', 'vip']);
  });

  it('...and VIP packages stay: they have no row, but they are not standing', () => {
    expect(kinds({ hideFilters: ['standing'] })).toContain('vip');
  });

  it('works with the row choices: 1st / front rows are never standing', () => {
    expect(kinds({ seat: 'firstrow', hideFilters: ['standing'] })).toEqual(['row 1']);
    expect(kinds({ seat: 'frontrows', badgeFilters: ['standing'] })).toEqual([]);
  });

  it('works with resale, the other way: standing resale tickets only', () => {
    expect(kinds({ badgeFilters: ['standing', 'resale'] })).toEqual(['standing']);
    expect(kinds({ badgeFilters: ['resale'], hideFilters: ['standing'] })).toEqual([]);
  });

  it('works with the price choice, last: the cheapest seated ticket', () => {
    const t = buildSectionGroups(T(), { hideFilters: ['standing'], price: 'cheapest' }).groups.flatMap((g) => g.tickets);
    expect(t.map((x) => x.row)).toEqual([2]);
  });

  it('says how many tickets are standing, in any state of the pill', () => {
    expect(buildSectionGroups(T(), {}).counts.other.standing).toBe(2);
    expect(buildSectionGroups(T(), { hideFilters: ['standing'] }).counts.other.standing).toBe(2);
    expect(buildSectionGroups(T(), { badgeFilters: ['standing'] }).counts.other.standing).toBe(2);
  });

  it('is not a choice in the seats group any more', () => {
    expect(buildSectionGroups(T(), { seat: 'standing' }).groups.flatMap((g) => g.tickets)).toHaveLength(5); // ignored
    expect(buildSectionGroups(T(), {}).counts.seat).not.toHaveProperty('standing');
  });
});

describe('where a row is in its tier, for its heading', () => {
  const place = (tickets, rowConfig) => buildSectionGroups(tickets, { rowConfig }).groups[0].rows.map((r) => r.label + ':' + r.place);
  const at = (n, extra = {}) => ticket({ section: 'A', row: n, rowName: String(n), rowLabel: 'Row ' + n, ...extra });

  it('is the ordinal of the row in its tier when no badge says so', () => {
    expect(place([at(26), at(27), at(34), at(45)], { firstRows: [21, 33], frontRows: 3 }).sort()).toEqual(['Row 26:6th', 'Row 27:7th', 'Row 34:null', 'Row 45:13th']);
  });

  it('is null for the first and front rows: their badge says it', () => {
    expect(place([at(21), at(22), at(23), at(24)], { firstRows: [21], frontRows: 3 }).sort()).toEqual(['Row 21:null', 'Row 22:null', 'Row 23:null', 'Row 24:4th']);
  });

  it('is null where it would only repeat the row number', () => {
    expect(place([at(7), at(12)], { firstRows: [1], frontRows: 5 }).sort()).toEqual(['Row 12:null', 'Row 7:null']);
  });

  it('is said for lettered rows even when it matches the rank', () => {
    const lettered = (n, name) => ticket({ section: 'A', row: n, rowName: name, rowLabel: 'Row ' + name });
    expect(place([lettered(6, 'F'), lettered(11, 'K')], { firstRows: ['A', 'K'], frontRows: 3 }).sort()).toEqual(['Row F:6th', 'Row K:null']);
  });

  it('is null for standing', () => {
    expect(place([ticket({ section: 'A', row: 9999, rowName: null, rowLabel: 'Standing' })], { firstRows: [21] })).toEqual(['Standing:null']);
  });

  it('follows the venue\'s settings, so it changes with them', () => {
    expect(place([at(26)], { firstRows: [21], frontRows: 3 })).toEqual(['Row 26:6th']);
    expect(place([at(26)], { firstRows: [25], frontRows: 3 })).toEqual(['Row 26:null']); // now the 2nd row: a front row, with a badge
    expect(place([at(26)], { firstRows: [1], frontRows: 3 })).toEqual(['Row 26:null']); // rows start at 1: just the row number
  });
});

describe('the ticket type', () => {
  it('is on tickets from the cards and from the list API alike', async () => {
    const { parseTicketCard } = await import('../src/lib/tickets.js');
    const { pickToTicket } = await import('../src/lib/quickpicks.js');
    const { makeCard } = await import('./helpers/cards.js');
    expect(parseTicketCard(makeCard({ section: 'A', row: 1 })).ticketType).toBe('Full Price Ticket');
    expect(parseTicketCard(makeCard({ section: 'A', row: 1, packageTitle: 'Aisle Seating Ticket' })).ticketType).toBe('Aisle Seating Ticket');
    expect(pickToTicket({ name: 'Full Price Ticket' }).ticketType).toBe('Full Price Ticket');
    expect(pickToTicket({ name: 'Trivium Meet & Greet Package' }).ticketType).toBe('Trivium Meet & Greet Package');
    expect(pickToTicket({}).ticketType).toBe('');
  });
});

describe('VIP packages as a pill', () => {
  const T = () => [
    ticket({ section: 'A', row: 1, price: 90 }),
    ticket({ section: 'A', row: 2, price: 80, isResale: true }),
    ticket({ section: 'B', row: 9999, rowName: null, rowLabel: 'Standing', price: 60 }),
    ticket({ section: 'VIP PACKAGES', originalSection: 'FLOOR', type: 'vip', row: 0, rowName: '1', rowLabel: 'Row 1', price: 300 }),
    ticket({ section: 'VIP PACKAGES', originalSection: 'PIT', type: 'vip', row: 0, rowName: '2', rowLabel: 'Row 2', price: 350 }),
  ];
  const names = (opts) => buildSectionGroups(T(), opts).groups.map((g) => g.name + ':' + g.tickets.length).sort();

  it('are flagged, and nothing else is', () => {
    const flagged = buildSectionGroups(T(), {}).groups.flatMap((g) => g.tickets).filter((t) => t.badges.vip);
    expect(flagged.map((t) => t.type)).toEqual(['vip', 'vip']);
  });

  it('shown only, they are all that is listed', () => {
    expect(names({ badgeFilters: ['vip'] })).toEqual(['VIP PACKAGES:2']);
  });

  it('hidden, the section goes and everything else stays', () => {
    expect(names({ hideFilters: ['vip'] })).toEqual(['A:2', 'B:1']);
  });

  it('are counted, in any state of the pill', () => {
    expect(buildSectionGroups(T(), {}).counts.other.vip).toBe(2);
    expect(buildSectionGroups(T(), { hideFilters: ['vip'] }).counts.other.vip).toBe(2);
  });

  it('combine with the other pills: hide standing and VIP packages for ordinary seated tickets only', () => {
    expect(names({ hideFilters: ['standing', 'vip'] })).toEqual(['A:2']);
  });

  it('are not first or front rows, nor standing', () => {
    expect(names({ seat: 'frontrows' })).toEqual(['A:2']);
    expect(names({ badgeFilters: ['standing'] })).toEqual(['B:1']);
  });
});

describe('the rows of VIP packages', () => {
  const pkg = (section, rowName, price, extra = {}) => ticket({
    section: 'VIP PACKAGES', originalSection: section, type: 'vip', row: 0, rowName, rowLabel: rowName === null ? 'Standing' : 'Row ' + rowName, price, ...extra,
  });
  const group = (tickets, opts) => buildSectionGroups(tickets, opts).groups.find((g) => g.name === 'VIP PACKAGES');
  const heads = (g) => g.rows.map((r) => r.label + '/' + r.section);

  it('are one row per section and row, so packages in the same row of different sections are apart', () => {
    const g = group([pkg('BLOCKE', '26', 250), pkg('BLOCKF', '26', 250), pkg('BLOCKE', '26', 260)], { sort: 'row' });
    expect(g.rows).toHaveLength(2);
    expect(g.rows.find((r) => r.section === 'BLOCKE').tickets).toHaveLength(2);
  });

  it('go by their real row when sorted by seats (standing first), not all at once as row 0', () => {
    const g = group([pkg('BLOCKB', '21', 329), pkg('BLOCKE', '26', 250), pkg('STNDNG', null, 197), pkg('BLOCKC', '29', 250), pkg('BLOCKF', '25', 250)], { sort: 'row' });
    expect(heads(g)).toEqual(['Standing/STNDNG', 'Row 21/BLOCKB', 'Row 25/BLOCKF', 'Row 26/BLOCKE', 'Row 29/BLOCKC']);
  });

  it('go by price when sorted by price, the better row first for the same price', () => {
    const g = group([pkg('BLOCKB', '21', 329), pkg('BLOCKE', '26', 250), pkg('STNDNG', null, 197), pkg('BLOCKC', '29', 250), pkg('BLOCKF', '25', 250)], { sort: 'price' });
    expect(heads(g)).toEqual(['Standing/STNDNG', 'Row 25/BLOCKF', 'Row 26/BLOCKE', 'Row 29/BLOCKC', 'Row 21/BLOCKB']);
  });

  it('in the same row of different sections go by section name, the same every time', () => {
    const a = group([pkg('BLOCKF', '26', 250), pkg('BLOCKC', '26', 250), pkg('BLOCKE', '26', 250)], { sort: 'row' });
    const b = group([pkg('BLOCKE', '26', 250), pkg('BLOCKF', '26', 250), pkg('BLOCKC', '26', 250)], { sort: 'price' });
    expect(heads(a)).toEqual(['Row 26/BLOCKC', 'Row 26/BLOCKE', 'Row 26/BLOCKF']);
    expect(heads(b)).toEqual(['Row 26/BLOCKC', 'Row 26/BLOCKE', 'Row 26/BLOCKF']);
  });

  it('are still first among the sections when sorted by seats', () => {
    const names = buildSectionGroups([ticket({ section: 'A', row: 1, price: 50 }), pkg('BLOCKE', '26', 250)], { sort: 'row' }).groups.map((g) => g.name);
    expect(names).toEqual(['VIP PACKAGES', 'A']);
  });

  it('have no place in a tier and no first / front row badge, whatever their row', () => {
    const g = group([pkg('BLOCKE', '1', 250), pkg('BLOCKE', '23', 250)], { sort: 'row', rowConfig: { firstRows: [1], frontRows: 5 } });
    g.rows.forEach((r) => {
      expect(r.place).toBeNull();
      expect(r.topTicket.badges.firstrow).toBe(false);
      expect(r.topTicket.badges.frontrows).toBe(false);
    });
  });

  it('keep the order of a section\'s row\'s own packages by price, then quality', () => {
    const g = group([pkg('BLOCKE', '26', 300, { quality: 0.2 }), pkg('BLOCKE', '26', 250, { quality: 0.1 }), pkg('BLOCKE', '26', 250, { quality: 0.9 })], { sort: 'row' });
    expect(g.rows[0].tickets.map((t) => t.price + '/' + t.quality)).toEqual(['250/0.9', '250/0.1', '300/0.2']);
  });
});
