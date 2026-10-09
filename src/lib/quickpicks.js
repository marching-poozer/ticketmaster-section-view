// Ticketmaster's own list API, which the ticket list on the page is built from:
//
//   GET /api/quickpicks/<eventId>/list?sort=price&offset=40&qty=2&primary=true&resale=true&tids=...
//   -> { quantity, eventId, total, picks: [{ id, type: "seat", section, row, seatFrom, seatTo, name,
//        originalPrice, description, areaName, quality, attributes: ["aisle"], ... }] }
//
// Reading it directly gets every ticket without scrolling the list, and carries things the cards
// don't show: seat numbers, a quality score and attributes (aisle, ...). This file is the pure part:
// recognising and paging that URL, turning picks into the same ticket objects the cards parse to,
// and checking the two agree. Fetching lives in content/api-source.js.
import { STANDING_ROW, VIP_SECTION } from './constants.js';
import { formatPrice } from './currency.js';
import { RESALE_RE, rowRank } from './tickets.js';

const LIST_URL_RE = /\/api\/quickpicks\/([^/?#]+)\/list(?:[/?#]|$)/;
// Which part of the request the list's *content* does not depend on: where we are in it, and how it is ordered.
const PAGING_PARAMS = ['offset', 'sort'];

export const ATTRIBUTE_KEY_PREFIX = 'attr:';

// --- the request ---------------------------------------------------------------

/** True for a URL of the list request. */
export function isListUrl(url) {
  return LIST_URL_RE.test(String(url == null ? '' : url));
}

/** The list request's event id, or null. */
export function eventIdOf(url) {
  const match = LIST_URL_RE.exec(String(url == null ? '' : url));
  return match ? decodeURIComponent(match[1]) : null;
}

function toUrl(url, base) {
  try {
    return new URL(String(url), base || (typeof location !== 'undefined' ? location.href : undefined));
  } catch (err) {
    return null;
  }
}

/**
 * What the list is *of*: event, quantity and filters (ticket types, primary / resale), but not the
 * offset or the sort. Two requests with the same signature are pages of the same list, so Ticketmaster
 * scrolling to its next page doesn't mean the list changed, while changing the quantity does.
 */
export function listSignature(url, base) {
  const u = toUrl(url, base);
  if (!u || !isListUrl(u.pathname)) return null;
  const params = Array.from(u.searchParams.entries())
    .filter(function ([key]) { return !PAGING_PARAMS.includes(key); })
    .map(function ([key, value]) { return key + '=' + value; })
    .sort();
  return eventIdOf(u.pathname) + '?' + params.join('&');
}

/** The quantity the request is for (the `qty` parameter), or null. */
export function listQuantity(url, base) {
  const u = toUrl(url, base);
  const qty = u ? parseInt(u.searchParams.get('qty'), 10) : NaN;
  return Number.isFinite(qty) ? qty : null;
}

/** The same request for another page (same filters, same sort), as an absolute URL. */
export function pageUrl(url, offset, base) {
  const u = toUrl(url, base);
  if (!u) return null;
  u.searchParams.set('offset', String(Math.max(0, Math.floor(offset))));
  return u.href;
}

// --- the response --------------------------------------------------------------

function text(value) {
  return value == null ? '' : String(value).trim();
}

const CURRENCY_SYMBOLS = { EUR: '€', GBP: '£', USD: '$', CAD: '$', AUD: '$', NZD: '$', CHF: 'CHF', SEK: 'kr', NOK: 'kr', DKK: 'kr' };

/** The currency of a list response, as written on the page ("€"), from a `currency` field if it has one; otherwise ''. */
export function currencyOf(response) {
  const code = text(response && (response.currency || response.currencyCode)).toUpperCase();
  return CURRENCY_SYMBOLS[code] || code;
}

/**
 * An attribute as a string, whatever the API sent: a string is itself; an object is its name (or code,
 * id...) if it has one, else its JSON, so nothing shows as "[object Object]" and nothing is hidden.
 */
export function attributeName(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object') {
    const named = ['name', 'code', 'id', 'type', 'label', 'value'].map(function (k) { return raw[k]; }).find(function (v) { return typeof v === 'string' && v.trim(); });
    if (named) return named.trim();
    try {
      return JSON.stringify(raw);
    } catch (err) {
      return '';
    }
  }
  return String(raw).trim();
}

/** "aisle" -> "Aisle", "restrictedView" / "restricted_view" -> "Restricted view". */
export function attributeLabel(name) {
  const words = text(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-\s]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The filter key for an attribute: "aisle" -> "attr:aisle". A name with nothing in it we can use in a key
 * (not English letters or digits) still gets a key of its own, from its characters, so it is never lost.
 */
export function attributeKey(name) {
  // Through the label, so "restrictedView", "restricted_view" and "Restricted-View" are one attribute.
  const plain = attributeLabel(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (plain) return ATTRIBUTE_KEY_PREFIX + plain;
  const codes = Array.from(text(name)).map(function (c) { return c.codePointAt(0).toString(16); }).join('-').slice(0, 40);
  return codes ? ATTRIBUTE_KEY_PREFIX + 'u' + codes : ATTRIBUTE_KEY_PREFIX;
}

export function isAttributeKey(key) {
  return typeof key === 'string' && /^attr:[a-z0-9_-]{1,40}$/.test(key);
}

const ATTRIBUTE_ICONS = { aisle: '🚶' };

/** How an attribute shows: { key, label, text } with an icon where there is a fitting one. */
export function describeAttribute(name) {
  const label = attributeLabel(name);
  const icon = ATTRIBUTE_ICONS[text(name).toLowerCase()] || '🔹';
  return { key: attributeKey(name), label, text: icon + ' ' + label };
}

/**
 * Every attribute on these tickets, A to Z: [{ key, label, text, count, names }] where `count` is how
 * many tickets have it and `names` the ways the API wrote it ("restrictedView"), so what is being
 * returned can be seen. (Names that differ only in case or punctuation share one entry.)
 */
export function attributesOf(tickets) {
  const seen = new Map();
  tickets.forEach(function (t) {
    const mine = new Set();
    (t.attributes || []).forEach(function (name) {
      const key = attributeKey(name);
      if (key === ATTRIBUTE_KEY_PREFIX) return;
      if (!seen.has(key)) seen.set(key, Object.assign(describeAttribute(name), { count: 0, names: [] }));
      const entry = seen.get(key);
      if (!entry.names.includes(name)) entry.names.push(name);
      if (!mine.has(key)) {
        mine.add(key);
        entry.count++;
      }
    });
  });
  return Array.from(seen.values()).sort(function (a, b) { return a.label.localeCompare(b.label); });
}

/**
 * One pick from the list response as a ticket, in the shape parseTicketCard produces (so the rest of
 * the extension doesn't care where a ticket came from) plus what only the API has:
 *   seat / seatFrom / seatTo, quality (a number, or null), attributes, and `index`: the place in the list.
 * There is no `element`: the card may not be on the page.
 */
export function pickToTicket(pick, options) {
  const opts = options || {};
  const p = pick && typeof pick === 'object' ? pick : {};

  const section = text(p.section) || text(p.areaName) || 'OTHER';
  const kind = text(p.type).toLowerCase();
  const name = text(p.name);
  const rowText = text(p.row);
  const rank = rowText ? rowRank(rowText) : null;

  const isVip = /package|vip/i.test(name) || /package|vip/.test(kind);
  const isResale = RESALE_RE.test(name) || /resale/.test(kind) || p.resale === true || p.isResale === true;

  const price = Number(p.originalPrice);
  const amount = Number.isFinite(price) && price > 0 ? price : 0;

  const seatFrom = text(p.seatFrom) || null;
  const seatTo = text(p.seatTo) || null;
  const seat = seatFrom && seatTo && seatFrom !== seatTo ? seatFrom + '-' + seatTo : seatFrom || seatTo;

  const rowName = rank === null ? null : rowText;
  const label = rowName === null ? 'Standing' : 'Row ' + rowName;
  const packageName = name && name !== 'Full Price Ticket' && name !== 'Verified Resale Ticket' ? name : '';
  let title = label;
  if (seat) title += ' • Seat ' + seat;
  if (packageName) title += ' (' + packageName + ')';

  const attributes = Array.isArray(p.attributes) ? p.attributes.map(attributeName).filter(Boolean) : [];
  const currency = opts.currency || '';
  const quality = typeof p.quality === 'number' && Number.isFinite(p.quality) ? p.quality : null;

  const pieces = ['Section ' + section];
  if (rowName !== null) pieces.push('Row ' + rowName);
  if (seat) pieces.push('Seat ' + seat);
  if (name) pieces.push(name);
  if (amount > 0) pieces.push(formatPrice(amount, currency) + ' each');
  attributes.forEach(function (a) { pieces.push(a); });

  return {
    source: 'api',
    id: text(p.id) || null,
    index: Number.isFinite(opts.index) ? opts.index : 0,
    ariaLabel: '',
    section: isVip ? VIP_SECTION : section,
    originalSection: section,
    row: isVip ? 0 : rank === null ? STANDING_ROW : rank,
    rowName,
    rowLabel: label,
    seat,
    seatFrom,
    seatTo,
    price: amount,
    currency,
    type: isVip ? 'vip' : 'standard',
    isResale,
    title,
    ticketType: name,
    packageName,
    text: pieces.join(' '),
    quality,
    attributes,
    name,
  };
}

/** The tickets in a list response, in the order the API gave them. */
export function picksToTickets(response, options) {
  const picks = response && Array.isArray(response.picks) ? response.picks : [];
  const currency = (options && options.currency) || currencyOf(response);
  const base = (options && options.offset) || 0;
  return picks.map(function (pick, i) { return pickToTicket(pick, { currency, index: base + i }); });
}

// --- agreeing with the page ----------------------------------------------------

/**
 * What identifies a ticket on the page: section, row, price, resale or not. Cards don't show seat
 * numbers or ids, so several tickets can share a key; the order they come in tells them apart.
 */
export function ticketKey(ticket) {
  return [
    ticket.originalSection || ticket.section || '',
    ticket.rowName == null ? '' : ticket.rowName,
    Number(ticket.price || 0).toFixed(2),
    ticket.isResale ? 'resale' : 'primary',
  ].join('|');
}

/**
 * Do these tickets (read from the list API) agree with the cards on the page (`domTickets`)? Every
 * card should have a ticket with the same section, row, price and resale-ness; VIP packages are left
 * out as they only show once expanded. Used to decide whether to trust the API's data, so a field we
 * misread (a price that is not the displayed price...) falls back to scrolling instead of showing
 * wrong tickets. `ok` needs at least one card to compare and `minRatio` of them to match.
 */
export function crossCheck(domTickets, apiTickets, minRatio) {
  const ratio = typeof minRatio === 'number' ? minRatio : 0.9;
  const cards = domTickets.filter(function (t) { return t.type !== 'vip'; });
  const pool = new Map();
  apiTickets.filter(function (t) { return t.type !== 'vip'; }).forEach(function (t) {
    const key = ticketKey(t);
    pool.set(key, (pool.get(key) || 0) + 1);
  });

  const missing = [];
  let matched = 0;
  cards.forEach(function (card) {
    const key = ticketKey(card);
    if (pool.get(key) > 0) {
      pool.set(key, pool.get(key) - 1);
      matched++;
    } else {
      missing.push(key);
    }
  });

  return { ok: cards.length > 0 && matched / cards.length >= ratio, matched, total: cards.length, missing };
}
