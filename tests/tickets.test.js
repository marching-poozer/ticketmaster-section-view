import { CARD_SELECTOR, cardText, isLetterRow, parseTickets, parseTicketCard, rankToName, rowLabel, rowRank } from '../src/lib/tickets.js';
import fs from 'node:fs';
import path from 'node:path';
import { addCards, makeCard } from './helpers/cards.js';

describe('rowLabel', () => {
  it('labels standing and numbered rows', () => {
    expect(rowLabel(9999)).toBe('Standing');
    expect(rowLabel(7)).toBe('Row 7');
  });
});

describe('parseTicketCard', () => {
  it('reads section, row, seat and price from the card', () => {
    const t = parseTicketCard(makeCard({ section: '101', row: 5, seat: '12-13', price: 85.5 }));
    expect(t).toMatchObject({
      section: '101',
      originalSection: '101',
      row: 5,
      seat: '12-13',
      price: 85.5,
      currency: '€',
      type: 'standard',
      isResale: false,
      title: 'Row 5 • Seat 12-13',
    });
  });

  it('keeps a reference to the card element and its aria-label', () => {
    const card = makeCard({ section: 'A', row: 1 });
    const t = parseTicketCard(card);
    expect(t.element).toBe(card);
    expect(t.ariaLabel).toBe(card.getAttribute('aria-label'));
  });

  it('falls back to the aria-label when there is no <dl>', () => {
    const card = makeCard({ dl: false, ariaLabel: 'Select Full Price Ticket £60.00, section BLOCK B, row 12, seats 4-5' });
    expect(parseTicketCard(card)).toMatchObject({ section: 'BLOCK B', row: 12, seat: '4-5', price: 60, currency: '£' });
  });

  it('treats a card with no row as standing', () => {
    const t = parseTicketCard(makeCard({ section: 'PIT', price: 70 }));
    expect(t.row).toBe(9999);
    expect(t.title).toBe('Standing');
  });

  it('defaults to section OTHER and price 0 when nothing can be parsed', () => {
    const t = parseTicketCard(makeCard({ dl: false, ariaLabel: 'Select a ticket' }));
    expect(t).toMatchObject({ section: 'OTHER', price: 0, currency: '' });
  });

  it('detects the currency from the label rather than assuming euros', () => {
    expect(parseTicketCard(makeCard({ section: 'A', row: 1, price: 40, currency: '£' })).currency).toBe('£');
    expect(parseTicketCard(makeCard({ section: 'A', row: 1, price: 40, currency: '$' })).currency).toBe('$');
  });

  it('flags resale cards from the aria-label', () => {
    expect(parseTicketCard(makeCard({ section: 'A', row: 1, resale: true })).isResale).toBe(true);
  });

  it('flags resale cards from the package title', () => {
    const t = parseTicketCard(makeCard({ section: 'A', row: 1, packageTitle: 'Resale Ticket' }));
    expect(t.isResale).toBe(true);
  });

  it('groups VIP/package cards into VIP PACKAGES at row 0', () => {
    const t = parseTicketCard(makeCard({ section: 'FLOOR', row: 3, packageTitle: 'VIP Gold Package' }));
    expect(t).toMatchObject({ section: 'VIP PACKAGES', originalSection: 'FLOOR', row: 0, type: 'vip' });
    expect(t.title).toBe('Row 3 (VIP Gold Package)');
  });

  it('recognises VIP cards by their star icon', () => {
    expect(parseTicketCard(makeCard({ section: 'A', row: 1, vipIcon: true })).type).toBe('vip');
  });

  it('leaves out the generic ticket-type names from the title', () => {
    const t = parseTicketCard(makeCard({ section: 'A', row: 2, packageTitle: 'Full Price Ticket' }));
    expect(t.title).toBe('Row 2');
    const r = parseTicketCard(makeCard({ section: 'A', row: 2, packageTitle: 'Verified Resale Ticket' }));
    expect(r.title).toBe('Row 2');
  });

  it('ignores spans that are prices or "each"', () => {
    const card = makeCard({ section: 'A', row: 2, packageTitle: 'Standard Entry' });
    const info = card.querySelector('[data-testid="ticketTypeInfo"]');
    ['€85.00', 'each', 'ab'].forEach((text) => {
      const span = document.createElement('span');
      span.textContent = text;
      info.append(span);
    });
    expect(parseTicketCard(card).title).toBe('Row 2 (Standard Entry)');
  });
});

describe('row letters', () => {
  it('turns a rank back into the row letters', () => {
    expect([1, 2, 11, 26, 27, 28, 52, 53, 702].map(rankToName)).toEqual(['A', 'B', 'K', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ']);
  });

  it('is the inverse of rowRank for every row Ticketmaster could name with one or two letters', () => {
    // "GA" and "NA" (general admission) are never rows, so rowRank has no rank for them.
    for (let rank = 1; rank <= 702; rank++) {
      if (['GA', 'NA'].includes(rankToName(rank))) continue;
      expect(rowRank(rankToName(rank))).toBe(rank);
    }
  });

  it('knows which row names are letters', () => {
    ['A', 'c', 'AA', ' b '].forEach((n) => expect(isLetterRow(n)).toBe(true));
    ['26', 'GA', 'NA', 'ABC', 'A1', '', null, undefined].forEach((n) => expect(isLetterRow(n)).toBe(false));
  });
});

describe('card text', () => {
  it('is everything on the card, a space between the pieces, so a pattern can match any of it', () => {
    const card = makeCard({ section: 'BLOCKG', row: 23, price: 90.75, packageTitle: 'Aisle Seating Ticket' });
    expect(cardText(card)).toBe('Section BLOCKG Row 23 Aisle Seating Ticket €90.75 each');
    expect(parseTicketCard(card).text).toBe(cardText(card));
  });

  it('falls back to the aria-label when the card shows no text', () => {
    const card = document.createElement('div');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'Select Aisle Seating Ticket €90.75, section BLOCKG, row 23');
    expect(parseTicketCard(card).text).toBe('Select Aisle Seating Ticket €90.75, section BLOCKG, row 23');
  });
});

describe('parseTickets', () => {
  it('parses every ticket card in the document and nothing else', () => {
    addCards({ section: '101', row: 1 }, { section: '102', row: 2 });
    const stray = document.createElement('div');
    stray.setAttribute('role', 'button');
    stray.setAttribute('aria-label', 'Close');
    document.body.append(stray);

    expect(document.querySelectorAll(CARD_SELECTOR)).toHaveLength(2);
    expect(parseTickets().map((t) => t.section)).toEqual(['101', '102']);
  });
});

describe('resale vs presale', () => {
  it('flags a real resale card (label says "Resale Tickets", with a presale subtitle)', () => {
    // From the live site: aria-label "Select Resale Tickets €100.30, section STANDING",
    // title "Verified Resale Ticket", second line "MCD Presale Ticket".
    const t = parseTicketCard(
      makeCard({ section: 'STANDING', price: 100.3, resale: true, labelKind: 'Resale Tickets', subtitle: 'MCD Presale Ticket' })
    );
    expect(t).toMatchObject({ section: 'STANDING', row: 9999, price: 100.3, isResale: true, type: 'standard', title: 'Standing' });
  });

  it('does not mistake a primary presale ticket for resale', () => {
    const t = parseTicketCard(makeCard({ section: 'BLOCKA', row: 4, packageTitle: 'MCD Presale Ticket' }));
    expect(t.isResale).toBe(false);
    expect(t.title).toBe('Row 4 (MCD Presale Ticket)');
  });

  it('does not mistake "presale" in the aria-label for resale either', () => {
    const t = parseTicketCard(makeCard({ section: 'A', row: 1, ariaLabel: 'Select Presale Ticket €50.00, section A, row 1' }));
    expect(t.isResale).toBe(false);
  });
});

describe('VIP packages (as shown on the live site)', () => {
  it('groups a package card with a row, by the word "Package"', () => {
    const t = parseTicketCard(
      makeCard({ section: 'BLOCKE', row: 26, price: 253.65, packageTitle: 'Trivium Meet & Greet Package', vipIcon: true })
    );
    expect(t).toMatchObject({ section: 'VIP PACKAGES', originalSection: 'BLOCKE', row: 0, type: 'vip', price: 253.65 });
    expect(t.title).toBe('Row 26 (Trivium Meet & Greet Package)');
  });

  it('groups a standing package', () => {
    const t = parseTicketCard(
      makeCard({ section: 'STANDING', price: 197.45, packageTitle: 'Trivium Crown In The Grave VIP Package', vipIcon: true })
    );
    expect(t).toMatchObject({ section: 'VIP PACKAGES', originalSection: 'STANDING', type: 'vip', rowLabel: 'Standing' });
  });

  it('recognises a VIP card by its star icon alone, using the real hashed class name', () => {
    const t = parseTicketCard(makeCard({ section: 'A', row: 2, packageTitle: 'Meet and Greet Experience', vipIcon: true }));
    expect(t.type).toBe('vip');
  });

  it('is not triggered by the "VIP Packages" summary row, which is not a ticket card', () => {
    document.body.innerHTML = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/quickpicks-pane.html'), 'utf8');
    expect(parseTickets().every((t) => t.type === 'standard')).toBe(true);
  });
});

describe('parsing the aria-label fallback safely', () => {
  it('does not take "section" from inside a package name', () => {
    const card = makeCard({ dl: false, ariaLabel: 'Select Section 101 Premium Package €200.00, section BLOCKB, row 3' });
    expect(parseTicketCard(card)).toMatchObject({ originalSection: 'BLOCKB', row: 3 });
  });

  it('reads a section with a space in it', () => {
    const card = makeCard({ dl: false, ariaLabel: 'Select In Flames Meet & Greet Package €253.65, section BLOCK C, row 27' });
    expect(parseTicketCard(card)).toMatchObject({ originalSection: 'BLOCK C', row: 27 });
  });
});

describe('rows that are not plain numbers', () => {
  it('ranks numeric and lettered rows', () => {
    expect(rowRank('26')).toBe(26);
    expect(rowRank(' 7 ')).toBe(7);
    expect(rowRank('A')).toBe(1);
    expect(rowRank('e')).toBe(5);
    expect(rowRank('Z')).toBe(26);
    expect(rowRank('AA')).toBe(27);
    expect(rowRank('AB')).toBe(28);
  });

  it('has no rank for anything else', () => {
    ['', 'GA', 'na', 'Floor', 'A12', '1A', 'ABC', null, undefined].forEach((v) => expect(rowRank(v)).toBeNull());
  });

  it('parses lettered rows instead of calling them standing, keeping the name for display', () => {
    const t = parseTicketCard(makeCard({ section: 'STALLS', row: 'C', price: 120 }));
    expect(t).toMatchObject({ row: 3, rowName: 'C', rowLabel: 'Row C', title: 'Row C' });
    expect(t.row).not.toBe(9999);
  });

  it('reads lettered rows from the aria-label too', () => {
    const card = makeCard({ dl: false, ariaLabel: 'Select Full Price Ticket €60.00, section CIRCLE, row AA' });
    expect(parseTicketCard(card)).toMatchObject({ row: 27, rowName: 'AA', rowLabel: 'Row AA' });
  });

  it('treats a row that cannot be ranked as no row (standing)', () => {
    const t = parseTicketCard(makeCard({ section: 'PIT', row: 'GA' }));
    expect(t).toMatchObject({ row: 9999, rowName: null, rowLabel: 'Standing' });
  });
});

describe('cards on pages that are not in English', () => {
  function inList(card) {
    const list = document.createElement('div');
    list.setAttribute('data-testid', 'quickpicksList');
    list.append(card);
    document.body.append(list);
    return card;
  }

  it('finds cards by their place in the list, whatever the aria-label says', () => {
    inList(makeCard({ section: 'X', row: 1, ariaLabel: 'Wählen Sie Standardticket 80,75 €' }));
    expect(document.querySelectorAll(CARD_SELECTOR)).toHaveLength(1);
  });

  it('finds each card once when both the structure and the label match', () => {
    inList(makeCard({ section: 'X', row: 1 }));
    expect(document.querySelectorAll(CARD_SELECTOR)).toHaveLength(1);
  });

  it('still finds English cards outside a recognisable list', () => {
    document.body.append(makeCard({ section: 'X', row: 1 }));
    expect(document.querySelectorAll(CARD_SELECTOR)).toHaveLength(1);
  });

  it('does not take the "VIP Packages" summary row (a real <button>) for a ticket', () => {
    document.body.innerHTML = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/quickpicks-pane.html'), 'utf8');
    expect(document.querySelectorAll(CARD_SELECTOR)).toHaveLength(3);
  });

  it('reads section, row and seat by position when the <dt> labels are not English', () => {
    const card = document.createElement('div');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'Wählen Sie Standardticket 80,75 €');
    card.innerHTML =
      '<dl><div><dt>Bereich</dt> <dd>BLOCKG</dd></div><div><dt>Reihe</dt> <dd>26</dd></div><div><dt>Platz</dt> <dd>4-5</dd></div></dl>' +
      '<div data-testid="ticketTypeInfo"><span>Standardticket</span><span>80,75 € pro Ticket</span></div>';
    const t = parseTicketCard(card);
    expect(t).toMatchObject({ section: 'BLOCKG', row: 26, seat: '4-5', price: 80.75, currency: '€', title: 'Row 26 • Seat 4-5 (Standardticket)' });
  });

  it('reads a localised standing card (one pair only) as a section with no row', () => {
    const card = document.createElement('div');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'x €50.00');
    card.innerHTML = '<dl><div><dt>Zone</dt> <dd>PIT</dd></div></dl>';
    expect(parseTicketCard(card)).toMatchObject({ section: 'PIT', row: 9999, rowLabel: 'Standing' });
  });

  it('prefers English labels over position when it can read them', () => {
    const card = document.createElement('div');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'Select x €50.00');
    card.innerHTML = '<dl><div><dt>Row</dt> <dd>7</dd></div><div><dt>Section</dt> <dd>B</dd></div></dl>';
    expect(parseTicketCard(card)).toMatchObject({ section: 'B', row: 7 });
  });
});

describe('a real ticketmaster.ie card', () => {
  // Copied verbatim from the live site (tests/fixtures/card-full-price.html).
  function realCard() {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/card-full-price.html'), 'utf8');
    const holder = document.createElement('div');
    holder.innerHTML = html;
    document.body.append(holder);
    return holder.firstElementChild;
  }

  it('matches the card selector', () => {
    realCard();
    expect(document.querySelectorAll(CARD_SELECTOR)).toHaveLength(1);
  });

  it('parses into section, row, price and type', () => {
    const t = parseTicketCard(realCard());
    expect(t).toMatchObject({
      section: 'BLOCKG',
      originalSection: 'BLOCKG',
      row: 26,
      seat: null,
      price: 80.75,
      currency: '€',
      type: 'standard',
      isResale: false,
      title: 'Row 26',
      rowName: '26',
      rowLabel: 'Row 26',
      ariaLabel: 'Select Full Price Ticket €80.75, section BLOCKG, row 26',
    });
  });

  it('still parses when the <dl> is missing, from the aria-label alone', () => {
    const card = realCard();
    card.querySelector('dl').remove();
    expect(parseTicketCard(card)).toMatchObject({ section: 'BLOCKG', row: 26, price: 80.75 });
  });
});
