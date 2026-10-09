import fs from 'node:fs';
import path from 'node:path';
import {
  attributeKey,
  attributeLabel,
  attributeName,
  attributesOf,
  crossCheck,
  currencyOf,
  describeAttribute,
  eventIdOf,
  isAttributeKey,
  isListUrl,
  listQuantity,
  listSignature,
  pageUrl,
  pickToTicket,
  picksToTickets,
  ticketKey,
} from '../src/lib/quickpicks.js';
import { parseTicketCard } from '../src/lib/tickets.js';
import { makeCard } from './helpers/cards.js';

const URL1 =
  'https://www.ticketmaster.ie/api/quickpicks/18006514C1CDA46A/list?sort=price&offset=40&qty=2&primary=true&resale=true&tids=000000000001%2CSIKV6MHULOY%2C000007050002%2C000007860003';
const response = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/quickpicks-list.json'), 'utf8'));

describe('the list request', () => {
  it('recognises it', () => {
    expect(isListUrl(URL1)).toBe(true);
    expect(isListUrl('/api/quickpicks/ABC/list?offset=0')).toBe(true);
    expect(isListUrl('https://www.ticketmaster.ie/api/quickpicks/ABC/detail')).toBe(false);
    expect(isListUrl('https://www.ticketmaster.ie/api/other/ABC/list')).toBe(false);
    expect(isListUrl(null)).toBe(false);
  });

  it('knows the event', () => {
    expect(eventIdOf(URL1)).toBe('18006514C1CDA46A');
    expect(eventIdOf('/event/123')).toBeNull();
  });

  it('knows the quantity', () => {
    expect(listQuantity(URL1)).toBe(2);
    expect(listQuantity('/api/quickpicks/A/list?offset=0')).toBeNull();
    expect(listQuantity('not a url at all', 'http://x')).toBeNull();
  });

  it('has the same signature for every page and sort of one list', () => {
    const next = URL1.replace('offset=40', 'offset=60');
    const bySeats = URL1.replace('sort=price', 'sort=quality');
    expect(listSignature(next)).toBe(listSignature(URL1));
    expect(listSignature(bySeats)).toBe(listSignature(URL1));
    expect(listSignature(URL1)).toContain('18006514C1CDA46A?');
  });

  it('has another signature when the quantity or a filter changes', () => {
    expect(listSignature(URL1.replace('qty=2', 'qty=3'))).not.toBe(listSignature(URL1));
    expect(listSignature(URL1.replace('resale=true', 'resale=false'))).not.toBe(listSignature(URL1));
    expect(listSignature(URL1.replace('SIKV6MHULOY%2C', ''))).not.toBe(listSignature(URL1));
  });

  it('does not depend on the order of the parameters', () => {
    const shuffled = 'https://www.ticketmaster.ie/api/quickpicks/18006514C1CDA46A/list?qty=2&offset=0&primary=true&sort=price&tids=000000000001%2CSIKV6MHULOY%2C000007050002%2C000007860003&resale=true';
    expect(listSignature(shuffled)).toBe(listSignature(URL1));
  });

  it('has no signature for something else', () => {
    expect(listSignature('https://www.ticketmaster.ie/event/123')).toBeNull();
    expect(listSignature('???', 'not a base')).toBeNull();
  });

  it('asks for another page of the same list', () => {
    const page = new URL(pageUrl(URL1, 0));
    expect(page.searchParams.get('offset')).toBe('0');
    expect(page.searchParams.get('qty')).toBe('2');
    expect(page.searchParams.get('tids')).toBe('000000000001,SIKV6MHULOY,000007050002,000007860003');
    expect(page.pathname).toBe('/api/quickpicks/18006514C1CDA46A/list');
    expect(new URL(pageUrl(URL1, 123.7)).searchParams.get('offset')).toBe('123');
    expect(new URL(pageUrl(URL1, -5)).searchParams.get('offset')).toBe('0');
  });

  it('resolves a relative URL against the page', () => {
    expect(pageUrl('/api/quickpicks/A/list?qty=1', 20, 'https://www.ticketmaster.co.uk/event/A')).toBe('https://www.ticketmaster.co.uk/api/quickpicks/A/list?qty=1&offset=20');
  });
});

describe('a pick as a ticket', () => {
  const [plain, aisle] = picksToTickets(response, { currency: '€' });

  it('reads the section, row, seats and price', () => {
    expect(plain).toMatchObject({
      source: 'api',
      id: '-1583548577',
      index: 0,
      section: 'BLOCKE',
      originalSection: 'BLOCKE',
      row: 23,
      rowName: '23',
      rowLabel: 'Row 23',
      seat: '125-126',
      seatFrom: '125',
      seatTo: '126',
      price: 94.8,
      currency: '€',
      type: 'standard',
      isResale: false,
      quality: 0.48,
      attributes: [],
      name: 'Full Price Ticket',
    });
    expect(plain.title).toBe('Row 23 • Seat 125-126');
  });

  it('has no element and keeps its place in the list', () => {
    expect(plain.element).toBeUndefined();
    expect(aisle.index).toBe(1);
    expect(picksToTickets(response, { offset: 40 }).map((t) => t.index)).toEqual([40, 41]);
  });

  it('keeps attributes, and puts them in the text so a pattern can find them', () => {
    expect(aisle.attributes).toEqual(['aisle']);
    expect(aisle.text).toBe('Section BLOCKE Row 24 Seat 116-117 Full Price Ticket €94.80 each aisle');
    expect(plain.text).toBe('Section BLOCKE Row 23 Seat 125-126 Full Price Ticket €94.80 each');
  });

  it('shows one seat as one number, and a package or ticket type in the title', () => {
    expect(pickToTicket({ row: '5', seatFrom: '12', seatTo: '12', name: 'Aisle Seating Ticket' }).title).toBe('Row 5 • Seat 12 (Aisle Seating Ticket)');
    expect(pickToTicket({ row: '5', seatFrom: '12' }).seat).toBe('12');
    expect(pickToTicket({ row: '5' }).seat).toBeNull();
  });

  it('calls a ticket with no row standing', () => {
    const t = pickToTicket({ type: 'standing', section: 'PIT', row: '', name: 'Full Price Ticket', originalPrice: 60 });
    expect(t).toMatchObject({ row: 9999, rowName: null, rowLabel: 'Standing', title: 'Standing', section: 'PIT' });
    expect(pickToTicket({ row: 'GA' }).row).toBe(9999);
  });

  it('ranks rows named with letters, keeping the name', () => {
    expect(pickToTicket({ row: 'C' })).toMatchObject({ row: 3, rowName: 'C', rowLabel: 'Row C' });
  });

  it('spots resale by name, type or flag', () => {
    expect(pickToTicket({ name: 'Verified Resale Ticket' }).isResale).toBe(true);
    expect(pickToTicket({ type: 'resale' }).isResale).toBe(true);
    expect(pickToTicket({ resale: true }).isResale).toBe(true);
    expect(pickToTicket({ name: 'MCD Presale Ticket' }).isResale).toBe(false);
    expect(pickToTicket({ name: 'Full Price Ticket' }).isResale).toBe(false);
  });

  it('spots packages and groups them as VIP', () => {
    const t = pickToTicket({ section: 'BLOCKE', row: '1', name: 'Trivium Meet & Greet Package', originalPrice: 253.65 });
    expect(t).toMatchObject({ type: 'vip', section: 'VIP PACKAGES', originalSection: 'BLOCKE', row: 0 });
    expect(pickToTicket({ name: 'VIP Seating' }).type).toBe('vip');
  });

  it('copes with a pick that is missing things', () => {
    expect(pickToTicket({})).toMatchObject({ section: 'OTHER', price: 0, quality: null, attributes: [], seat: null, row: 9999 });
    expect(pickToTicket(null)).toMatchObject({ section: 'OTHER' });
    expect(pickToTicket({ originalPrice: 'lots', quality: 'high', attributes: 'aisle' })).toMatchObject({ price: 0, quality: null, attributes: [] });
  });

  it('falls back to the area name for the section', () => {
    expect(pickToTicket({ areaName: 'BLOCKQ' }).section).toBe('BLOCKQ');
  });

  it('is the same ticket the card of the same seat parses to, where they overlap', () => {
    const card = parseTicketCard(makeCard({ section: 'BLOCKE', row: 23, price: 94.8 }));
    expect(ticketKey(plain)).toBe(ticketKey(card));
    expect(plain.rowLabel).toBe(card.rowLabel);
    expect(plain.row).toBe(card.row);
    expect(plain.currency).toBe(card.currency);
  });
});

describe('currency', () => {
  it('reads a currency field if the response has one', () => {
    expect(currencyOf({ currency: 'EUR' })).toBe('€');
    expect(currencyOf({ currencyCode: 'gbp' })).toBe('£');
    expect(currencyOf({ currency: 'XYZ' })).toBe('XYZ');
  });

  it('is empty when it does not say', () => {
    expect(currencyOf(response)).toBe('');
    expect(currencyOf(null)).toBe('');
  });

  it('uses it for the tickets unless told otherwise', () => {
    expect(picksToTickets({ currency: 'GBP', picks: [{ originalPrice: 5 }] })[0].currency).toBe('£');
    expect(picksToTickets({ currency: 'GBP', picks: [{ originalPrice: 5 }] }, { currency: '€' })[0].currency).toBe('€');
  });
});

describe('attributes', () => {
  it('makes a readable label', () => {
    expect(attributeLabel('aisle')).toBe('Aisle');
    expect(attributeLabel('restrictedView')).toBe('Restricted view');
    expect(attributeLabel('restricted_view')).toBe('Restricted view');
    expect(attributeLabel('WHEELCHAIR-ACCESS')).toBe('Wheelchair access');
  });

  it('reads an attribute whatever form the API sent it in', () => {
    expect(attributeName(' aisle ')).toBe('aisle');
    expect(attributeName({ name: 'wheelchair', other: 1 })).toBe('wheelchair');
    expect(attributeName({ code: 'RV' })).toBe('RV');
    expect(attributeName({ weird: true })).toBe('{"weird":true}');
    expect(attributeName(7)).toBe('7');
    expect(attributeName(true)).toBe('true');
    expect(attributeName(null)).toBe('');
    expect(attributeName(undefined)).toBe('');
  });

  it('never shows an attribute as [object Object], and keeps them all on the ticket', () => {
    const t = pickToTicket({ attributes: ['aisle', { name: 'wheelchair' }, { x: 1 }, '', null, 3] });
    expect(t.attributes).toEqual(['aisle', 'wheelchair', '{"x":1}', '3']);
  });

  it('makes a filter key', () => {
    expect(attributeKey('aisle')).toBe('attr:aisle');
    expect(attributeKey('Restricted View')).toBe('attr:restricted-view');
    expect(attributeKey('restrictedView')).toBe('attr:restricted-view');
    expect(attributeKey('restricted_view')).toBe('attr:restricted-view');
    expect(isAttributeKey('attr:aisle')).toBe(true);
    ['attr:', 'attr:A B', 'custom:aisle', 'aisle', null].forEach((k) => expect(isAttributeKey(k)).toBe(false));
  });

  it('gives a name with no English letters or digits a key of its own, so it is never lost', () => {
    const a = attributeKey('無障害');
    const b = attributeKey('通路側');
    expect(isAttributeKey(a)).toBe(true);
    expect(isAttributeKey(b)).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toBe('attr:');
    expect(attributeKey('!!!')).toMatch(/^attr:u21/);
    expect(attributeKey('')).toBe('attr:');
  });

  it('describes one with an icon', () => {
    expect(describeAttribute('aisle')).toEqual({ key: 'attr:aisle', label: 'Aisle', text: '🚶 Aisle' });
    expect(describeAttribute('limitedView').text).toBe('🔹 Limited view');
  });

  it('lists the ones on some tickets once each, A to Z, saying how many tickets have each', () => {
    const list = attributesOf([{ attributes: ['wheelchair', 'aisle'] }, { attributes: ['aisle'] }, {}, { attributes: ['', '   '] }]);
    expect(list.map((a) => [a.key, a.label, a.count])).toEqual([['attr:aisle', 'Aisle', 2], ['attr:wheelchair', 'Wheelchair', 1]]);
  });

  it('counts a ticket once however many times it repeats an attribute', () => {
    expect(attributesOf([{ attributes: ['aisle', 'aisle', 'Aisle'] }])[0].count).toBe(1);
  });

  it('keeps the names the API used, merging spellings of one attribute', () => {
    const [entry] = attributesOf([{ attributes: ['restrictedView'] }, { attributes: ['restricted_view', 'restrictedView'] }]);
    expect(entry).toMatchObject({ key: 'attr:restricted-view', label: 'Restricted view', count: 2, names: ['restrictedView', 'restricted_view'] });
  });

  it('lists names with no English letters too', () => {
    const list = attributesOf([{ attributes: ['無障害'] }]);
    expect(list).toHaveLength(1);
    expect(list[0].names).toEqual(['無障害']);
  });
});

describe('agreeing with the page', () => {
  const card = (opts) => parseTicketCard(makeCard(opts));
  const api = (extra) => pickToTicket({ type: 'seat', section: 'BLOCKG', row: '26', name: 'Full Price Ticket', originalPrice: 80.75, ...extra }, { currency: '€' });

  it('has a key of section, row, price and resale', () => {
    expect(ticketKey(api())).toBe('BLOCKG|26|80.75|primary');
    expect(ticketKey(api({ name: 'Verified Resale Ticket' }))).toBe('BLOCKG|26|80.75|resale');
    expect(ticketKey(pickToTicket({ section: 'PIT', name: 'x', originalPrice: 60 }))).toBe('PIT||60.00|primary');
  });

  it('is happy when every card has a ticket', () => {
    const result = crossCheck([card({ section: 'BLOCKG', row: 26, price: 80.75 }), card({ section: 'BLOCKG', row: 26, price: 80.75 })], [api(), api(), api({ row: '27' })]);
    expect(result).toMatchObject({ ok: true, matched: 2, total: 2, missing: [] });
  });

  it('uses each ticket for one card only (identical tickets need an identical number of them)', () => {
    const result = crossCheck([card({ section: 'BLOCKG', row: 26, price: 80.75 }), card({ section: 'BLOCKG', row: 26, price: 80.75 })], [api()], 1);
    expect(result).toMatchObject({ ok: false, matched: 1, total: 2 });
    expect(result.missing).toEqual(['BLOCKG|26|80.75|primary']);
  });

  it('is not happy when a price is not the displayed price', () => {
    const result = crossCheck([card({ section: 'BLOCKG', row: 26, price: 80.75 })], [api({ originalPrice: 70 })]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['BLOCKG|26|80.75|primary']);
  });

  it('is not happy when resale is told differently', () => {
    expect(crossCheck([card({ section: 'BLOCKG', row: 26, price: 80.75, resale: true })], [api()]).ok).toBe(false);
  });

  it('allows a few cards to differ, up to the ratio', () => {
    const cards = Array.from({ length: 10 }, (_, i) => card({ section: 'S', row: i + 1, price: 50 }));
    const apis = cards.map((_, i) => pickToTicket({ section: 'S', row: String(i + 1), name: 'Full Price Ticket', originalPrice: i === 0 ? 51 : 50 }));
    expect(crossCheck(cards, apis)).toMatchObject({ ok: true, matched: 9, total: 10 });
    expect(crossCheck(cards, apis, 0.95).ok).toBe(false);
  });

  it('leaves VIP packages out: they only show once expanded', () => {
    const vipCard = card({ section: 'BLOCKE', row: 1, price: 253.65, packageTitle: 'Trivium Meet & Greet Package' });
    expect(vipCard.type).toBe('vip');
    expect(crossCheck([vipCard, card({ section: 'BLOCKG', row: 26, price: 80.75 })], [api()])).toMatchObject({ ok: true, total: 1 });
  });

  it('cannot say anything without cards', () => {
    expect(crossCheck([], [api()]).ok).toBe(false);
  });
});
