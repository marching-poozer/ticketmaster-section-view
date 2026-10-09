import { STANDING_ROW, VIP_SECTION } from './constants.js';
import { containsPrice, parsePrice } from './currency.js';

// Each ticket option on the seat-selection list is one of these. Structure first
// (the cards are the role="button" divs inside the list, whatever language the
// page is in; the "VIP Packages" summary row is a real <button>, so it's not
// matched), then the English aria-label as a fallback for other layouts.
export const CARD_SELECTOR = '[data-testid="quickpicksList"] > div[role="button"], div[role="button"][aria-label*="Select"]';

// <dt> labels as they read in English; other languages are read by position.
const ENGLISH_LABELS = ['section', 'row'];

// "resale" as a word: Ticketmaster also has "presale" tickets, which are primary.
export const RESALE_RE = /\bresale\b/i;
// The real class is e.g. "StarCircledFilledIcon___StyledBaseSvg-sc-qrtrcy-0".
export const VIP_ICON_SELECTOR = '[class*="StarCircledFilledIcon"]';

/** All the text on a card, a space between pieces ("Section BLOCKG Row 23 Aisle Seating Ticket €90.75"); the aria-label if it has none. */
export function cardText(card) {
  const pieces = [];
  const walker = card.ownerDocument.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const piece = node.nodeValue.replace(/\s+/g, ' ').trim();
    if (piece) pieces.push(piece);
  }
  return pieces.join(' ') || (card.getAttribute('aria-label') || '').trim();
}

export function rowLabel(row) {
  return row === STANDING_ROW ? 'Standing' : 'Row ' + row;
}

/**
 * Sort rank for a row name, or null if it isn't one we can rank:
 * '26' -> 26, 'A' -> 1, 'Z' -> 26, 'AA' -> 27. "GA" (general admission) is not a row.
 */
export function rowRank(text) {
  const t = String(text == null ? '' : text).trim();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (/^(ga|na)$/i.test(t)) return null;
  if (/^[A-Za-z]{1,2}$/.test(t)) {
    let rank = 0;
    for (const ch of t.toUpperCase()) rank = rank * 26 + (ch.charCodeAt(0) - 64);
    return rank;
  }
  return null;
}

/** The other way round, for letters: 1 -> 'A', 26 -> 'Z', 27 -> 'AA', 702 -> 'ZZ'. */
export function rankToName(rank) {
  let n = Math.floor(rank);
  let name = '';
  while (n > 0) {
    n -= 1;
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26);
  }
  return name;
}

/** True for a row named with letters ("C", "AA") rather than a number. */
export function isLetterRow(name) {
  return /^[A-Za-z]{1,2}$/.test(String(name == null ? '' : name).trim()) && rowRank(name) !== null;
}

/**
 * Turn one Ticketmaster ticket card into a plain ticket object.
 * Prefers the card's <dt>/<dd> pairs and falls back to the aria-label, which
 * reads like "Select Full Price Ticket €80.75, section BLOCKG, row 26".
 */
export function parseTicketCard(card) {
  let section = 'OTHER';
  let row = STANDING_ROW;
  let rowName = null;
  let seat = null;
  let packageTitle = '';

  function setRow(text) {
    const rank = rowRank(text);
    if (rank === null) return;
    row = rank;
    rowName = String(text).trim();
  }

  const pairs = [];
  card.querySelectorAll('dt').forEach(function (dt) {
    const dd = dt.nextElementSibling;
    if (!dd) return;
    pairs.push({ label: dt.textContent.trim().toLowerCase(), value: dd.textContent.trim() });
  });
  // If none of the labels is a word we know, assume the order is section, row, seat.
  const positional = pairs.length > 0 && !pairs.some(function (p) { return ENGLISH_LABELS.includes(p.label) || p.label.includes('seat'); });
  pairs.forEach(function (pair, i) {
    if (pair.label === 'section' || (positional && i === 0)) section = pair.value;
    if (pair.label === 'row' || (positional && i === 1)) setRow(pair.value);
    if (pair.label.includes('seat') || (positional && i === 2)) seat = pair.value;
  });

  const ariaLabel = card.getAttribute('aria-label') || '';

  // Anchored on the comma so a package name containing "section" can't match.
  if (section === 'OTHER') {
    const matchSec = ariaLabel.match(/(?:^|,\s*)section\s+([^,]+)/i);
    if (matchSec) section = matchSec[1].trim();
  }
  if (row === STANDING_ROW) {
    const matchRow = ariaLabel.match(/,\s*row\s+([^,]+)/i);
    if (matchRow) setRow(matchRow[1]);
  }
  if (!seat) {
    const matchSeat = ariaLabel.match(/seat[s]?\s+([\d\-,\s]+)/i);
    if (matchSeat) seat = matchSeat[1].replace(/[,\s]+$/, '').trim() || null;
  }

  const parsedPrice = parsePrice(ariaLabel);
  const price = parsedPrice ? parsedPrice.amount : 0;
  const currency = parsedPrice ? parsedPrice.currency : '';

  const typeInfo = card.querySelector('[data-testid="ticketTypeInfo"]') || card;
  typeInfo.querySelectorAll('span').forEach(function (span) {
    const txt = span.textContent.trim();
    const lower = txt.toLowerCase();
    if (txt && !containsPrice(txt) && !lower.includes('each') && txt.length > 3) {
      if (!packageTitle || lower.includes('package') || lower.includes('vip') || RESALE_RE.test(txt)) {
        packageTitle = txt;
      }
    }
  });

  const packageLower = packageTitle.toLowerCase();
  const isVipCard =
    packageLower.includes('package') ||
    packageLower.includes('vip') ||
    card.querySelector(VIP_ICON_SELECTOR) !== null;
  const isResale = RESALE_RE.test(ariaLabel) || RESALE_RE.test(packageTitle);

  const label = rowName === null ? 'Standing' : 'Row ' + rowName;
  // The ticket type, unless it is one of the two every ticket would have ("Full Price Ticket", "Verified Resale Ticket").
  const packageName = packageTitle && packageTitle !== 'Full Price Ticket' && packageTitle !== 'Verified Resale Ticket' ? packageTitle : '';
  let title = label;
  if (seat) title += ' • Seat ' + seat;
  if (packageName) title += ' (' + packageName + ')';

  return {
    element: card,
    ariaLabel,
    section: isVipCard ? VIP_SECTION : section,
    originalSection: section,
    row: isVipCard ? 0 : row,
    rowName,
    rowLabel: label,
    seat,
    price,
    currency,
    type: isVipCard ? 'vip' : 'standard',
    isResale,
    title,
    ticketType: packageTitle,
    packageName,
    text: cardText(card),
  };
}

export function parseTickets(root = document) {
  return Array.from(root.querySelectorAll(CARD_SELECTOR)).map(parseTicketCard);
}
