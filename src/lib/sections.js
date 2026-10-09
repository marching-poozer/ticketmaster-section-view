import { HIGHER_QUALITY_IS_BETTER, OTHER_FILTERS, STANDING_ROW } from './constants.js';
import { isBadgeKey, matchBadges } from './custom-badges.js';
import { formatPrice } from './currency.js';
import { attributeKey, isAttributeKey } from './quickpicks.js';
import { isLetterRow, rankToName, rowLabel, rowRank } from './tickets.js';

/** Lower is better. VIP packages first, then standing, then by row number. */
export function ticketPriorityScore(ticket) {
  if (ticket.type === 'vip') return -2000;
  if (ticket.row === STANDING_ROW) return -1000;
  return ticket.row;
}

function byPrice(a, b) {
  return a.price - b.price;
}

/** A VIP package's real row, to order packages among themselves (they all share one priority); standing first. */
function packageRowRank(ticket) {
  const rank = ticket.rowName ? rowRank(ticket.rowName) : null;
  return rank === null ? -1 : rank;
}

function bySeat(a, b) {
  const byPriority = ticketPriorityScore(a) - ticketPriorityScore(b);
  if (byPriority !== 0) return byPriority;
  if (a.type !== 'vip' || b.type !== 'vip') return 0;
  // Packages in the same row of different sections: by section, so the order is the same every time.
  return packageRowRank(a) - packageRowRank(b) || String(a.originalSection).localeCompare(String(b.originalSection));
}

/** The better seat (by Ticketmaster's quality score) first; tickets without a score don't prefer either. */
function byQuality(a, b) {
  if (typeof a.quality !== 'number' || typeof b.quality !== 'number') return 0;
  return HIGHER_QUALITY_IS_BETTER ? b.quality - a.quality : a.quality - b.quality;
}

/**
 * How to order tickets: by price ('price') or by seat, best first (anything else). Whichever it is, tickets
 * that tie are put in the other order (the same price: the better row first; the same row: the lower
 * price first), and tickets that still tie by the better quality score.
 */
export function ticketComparator(sort) {
  const primary = sort === 'price' ? byPrice : bySeat;
  const secondary = sort === 'price' ? bySeat : byPrice;
  return function (a, b) { return primary(a, b) || secondary(a, b) || byQuality(a, b); };
}

/** Lowest price above zero, or 0 when no ticket has a usable price. */
export function minPrice(tickets) {
  const prices = tickets.map(function (t) { return t.price; }).filter(function (p) { return p > 0; });
  return prices.length > 0 ? Math.min.apply(null, prices) : 0;
}

/**
 * For each resale ticket, find the primary (non-resale) price to compare it to:
 * the cheapest primary ticket in the same row, else the primary ticket in the
 * nearest row. Sets `baselinePrice` / `baselineSource` on the resale tickets.
 */
export function annotateResaleBaselines(sectionTickets) {
  sectionTickets.forEach(function (t) {
    if (!t.isResale) return;

    const sameRow = sectionTickets.filter(function (st) {
      return !st.isResale && st.row === t.row && st.price > 0;
    });
    if (sameRow.length > 0) {
      t.baselinePrice = Math.min.apply(null, sameRow.map(function (st) { return st.price; }));
      t.baselineSource = t.rowLabel || rowLabel(t.row);
      return;
    }

    const standards = sectionTickets.filter(function (st) { return !st.isResale && st.price > 0; });
    if (standards.length > 0) {
      standards.sort(function (a, b) { return Math.abs(a.row - t.row) - Math.abs(b.row - t.row); });
      t.baselinePrice = standards[0].price;
      t.baselineSource = standards[0].rowLabel || rowLabel(standards[0].row);
    }
  });
}

/** Where rows start, when nothing is known about the venue: Row 1, and the first 5 rows are the front. */
export const DEFAULT_ROW_CONFIG = Object.freeze({ firstRows: [1], frontRows: 5 });

/**
 * Where a row sits in its tier. `row` is the row's rank (a number, or A = 1, B = 2, ...
 * for rows named with letters, see rowRank). `firstRows` lists the row each tier starts
 * at, as numbers or letters (3Arena, Dublin: [21, 33]; a lettered venue: ['A', 'K']).
 * A row belongs to the tier with the highest start at or below it (or an implicit tier
 * starting at the first row). Returns { tierStart, index } (tierStart as a rank), with
 * index 1 for the tier's first row, or null for rows that aren't in a tier (standing,
 * VIP packages).
 */
export function rowPosition(row, firstRows) {
  if (!(row > 0) || row === STANDING_ROW) return null;
  const ranks = (firstRows || [1]).map(function (s) { return typeof s === 'number' ? s : rowRank(s); });
  const starts = ranks.filter(function (s) { return s !== null && s <= row; });
  const tierStart = starts.length > 0 ? Math.max.apply(null, starts) : 1;
  return { tierStart, index: row - tierStart + 1 };
}

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th", 22 -> "22nd". */
export function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}

/** The set of badge flags for one ticket. */
export function computeBadges(ticket, ctx) {
  const position = rowPosition(ticket.row, ctx.firstRows);
  return {
    cheapest: ticket.price > 0 && ticket.price === ctx.globalMinPrice,
    blockprice: ticket.price > 0 && ticket.price === ctx.sectionMinPrice && ctx.sectionSize > 1,
    standing: ticket.row === STANDING_ROW,
    vip: ticket.type === 'vip',
    firstrow: position !== null && position.index === 1,
    frontrows: position !== null && position.index <= ctx.frontRows,
    resale: ticket.isResale,
    markup: ticket.isResale && !!ticket.baselinePrice && ticket.price > ticket.baselinePrice,
  };
}

const QUALITY_SHARES = { top10: 0.1, top25: 0.25, top50: 0.5 };

/**
 * The quality score a ticket needs to be in the best `share` of the tickets that have one (ties at the
 * line are in), or null when there is nothing to go on (no ticket has a score: tickets read from cards).
 */
function qualityCutoff(tickets, share) {
  const scores = tickets
    .map(function (t) { return t.quality; })
    .filter(function (q) { return typeof q === 'number'; })
    .sort(function (a, b) { return HIGHER_QUALITY_IS_BETTER ? b - a : a - b; });
  if (scores.length === 0) return null;
  return scores[Math.max(1, Math.ceil(share * scores.length)) - 1];
}

/** Does this score make the cut? */
function passesQuality(quality, cutoff) {
  return typeof quality === 'number' && (HIGHER_QUALITY_IS_BETTER ? quality >= cutoff : quality <= cutoff);
}

/**
 * Work out what each ticket is (its badge flags, its place in its tier, resale baselines, custom matches),
 * in place, over the whole list: the flags are about the event as a whole, not about what is filtered.
 */
function annotate(tickets, opts) {
  const customBadges = opts.customBadges || [];
  const cutoffs = {};
  Object.keys(QUALITY_SHARES).forEach(function (key) { cutoffs[key] = qualityCutoff(tickets, QUALITY_SHARES[key]); });
  const globalMinPrice = minPrice(tickets);
  const rowConfig = Object.assign({}, DEFAULT_ROW_CONFIG, opts.rowConfig);

  const sections = Object.create(null);
  tickets.forEach(function (t) {
    (sections[t.section] = sections[t.section] || []).push(t);
  });

  Object.keys(sections).forEach(function (name) {
    const all = sections[name];
    const sectionMinPrice = minPrice(all);

    annotateResaleBaselines(all);
    all.forEach(function (t) {
      const position = rowPosition(t.row, rowConfig.firstRows);
      t.tierStart = position ? position.tierStart : null;
      // How the tier's first row is written on this ticket's row scale: "21", or "K" for lettered rows.
      t.tierStartName = position ? (isLetterRow(t.rowName) ? rankToName(position.tierStart) : String(position.tierStart)) : null;
      t.rowIndex = position ? position.index : null;
      // Which share of the event's tickets its quality score is in: 'top10', 'top25', 'top50' or null.
      t.qualityTier = typeof t.quality === 'number'
        ? Object.keys(QUALITY_SHARES).find(function (key) { return cutoffs[key] !== null && passesQuality(t.quality, cutoffs[key]); }) || null
        : null;
      t.badges = computeBadges(t, {
        globalMinPrice,
        sectionMinPrice,
        sectionSize: all.length,
        firstRows: rowConfig.firstRows,
        frontRows: rowConfig.frontRows,
      });

      (t.attributes || []).forEach(function (a) { t.badges[attributeKey(a)] = true; });
      t.customMatches = matchBadges(customBadges, [t.text, t.title]);
      t.customMatches.forEach(function (m) { t.badges[m.key] = true; });
    });
  });
}

/** Keep the cheapest ticket(s) overall, or of each section. Tickets with no usable price are never "cheapest". */
function applyPriceFilter(tickets, price) {
  if (price !== 'cheapest' && price !== 'sectionlow') return tickets;
  const lowest = new Map();
  tickets.forEach(function (t) {
    const group = price === 'cheapest' ? '' : t.section;
    if (t.price > 0 && (!lowest.has(group) || t.price < lowest.get(group))) lowest.set(group, t.price);
  });
  return tickets.filter(function (t) { return t.price > 0 && t.price === lowest.get(price === 'cheapest' ? '' : t.section); });
}

/**
 * The tickets that pass the filters, in the order they are applied: the section name search, the seat
 * choice ('firstrow' | 'frontrows' | 'all'), the quality choice ('top10' | 'top25' | 'top50'
 * | 'any': the best share of the whole event's tickets, however the others are filtered), the "other"
 * badges (all must be present: `other`), the hidden ones (none may be present: `hide`), and last the price choice ('cheapest' | 'sectionlow' | 'any'), so
 * "cheapest" is the cheapest of what is left (front rows + section low = the cheapest front-row ticket in
 * each section). A quality choice does nothing when no ticket has a score.
 */
export function filterTickets(tickets, filters) {
  const f = filters || {};
  const search = (f.search || '').toLowerCase().trim();
  const seat = f.seat === 'firstrow' || f.seat === 'frontrows' ? f.seat : null;
  const cutoff = QUALITY_SHARES[f.quality] ? qualityCutoff(tickets, QUALITY_SHARES[f.quality]) : null;
  const other = f.other || [];
  const hide = f.hide || [];

  let list = tickets.filter(function (t) { return t.section.toLowerCase().includes(search); });
  if (seat) list = list.filter(function (t) { return t.badges[seat]; });
  if (cutoff !== null) list = list.filter(function (t) { return passesQuality(t.quality, cutoff); });
  if (other.length > 0) list = list.filter(function (t) { return other.every(function (key) { return t.badges[key]; }); });
  if (hide.length > 0) list = list.filter(function (t) { return !hide.some(function (key) { return t.badges[key]; }); });
  return applyPriceFilter(list, f.price);
}

/**
 * How many tickets each pill would show if it were chosen, with everything else as it is now: a seat
 * or price pill replaces the current choice in its group, an "other" pill is added to the others.
 * { seat: { firstrow, frontrows, all }, quality: { any, top10, top25, top50 } or null when no ticket has
 * a quality score, price: { cheapest, sectionlow, any }, other: { [key]: n } }.
 */
function countPills(tickets, filters, otherKeys) {
  const count = function (override) { return filterTickets(tickets, Object.assign({}, filters, override)).length; };
  const counts = { seat: {}, quality: null, price: {}, other: {} };
  ['firstrow', 'frontrows', 'all'].forEach(function (key) { counts.seat[key] = count({ seat: key }); });
  if (tickets.some(function (t) { return typeof t.quality === 'number'; })) {
    counts.quality = {};
    ['any', 'top10', 'top25', 'top50'].forEach(function (key) { counts.quality[key] = count({ quality: key }); });
  }
  ['cheapest', 'sectionlow', 'any'].forEach(function (key) { counts.price[key] = count({ price: key }); });
  // An "other" pill counts the tickets that have it, given everything else: whether it is on, hiding, or off.
  otherKeys.forEach(function (key) {
    counts.other[key] = count({
      other: Array.from(new Set(filters.other.concat(key))),
      hide: (filters.hide || []).filter(function (k) { return k !== key; }),
    });
  });
  return counts;
}

/**
 * Where a row is in its tier ("6th"), for a row heading that has no first / front row badge to say so; null when
 * a badge does, when it isn't in a tier, or when it would only repeat the row number (Row 7 is the 7th row of a
 * tier that starts at Row 1). Lettered rows always get it: "Row F" is the 6th row.
 */
function placeOf(ticket) {
  if (ticket.rowIndex === null || ticket.rowIndex === undefined || ticket.badges.firstrow || ticket.badges.frontrows) return null;
  return ticket.rowIndex !== ticket.row || isLetterRow(ticket.rowName) ? ordinal(ticket.rowIndex) : null;
}

/**
 * A section's tickets (already sorted) split by row: [{ row, label, section, tickets, topTicket, place }], the rows
 * in the order of their best ticket. VIP packages are grouped as "VIP PACKAGES", not by where they are, so their
 * rows are those of the section each is for (`section`, "BLOCKE", to show in the heading); they have no place in a
 * tier. For everything else `section` is null (the heading above says it).
 */
function groupByRow(sorted, compare) {
  const byRow = new Map();
  sorted.forEach(function (t) {
    const key = t.type === 'vip' ? t.originalSection + '|' + (t.rowName === null || t.rowName === undefined ? '' : t.rowName) : t.row;
    if (!byRow.has(key)) byRow.set(key, []);
    byRow.get(key).push(t);
  });
  return Array.from(byRow.values())
    .map(function (tickets) {
      const first = tickets[0];
      return {
        row: first.row,
        label: first.rowLabel || rowLabel(first.row),
        section: first.type === 'vip' && first.originalSection && first.originalSection !== 'OTHER' ? first.originalSection : null,
        tickets,
        topTicket: first,
        place: placeOf(first),
      };
    })
    .sort(function (a, b) { return compare(a.topTicket, b.topTicket); });
}

/**
 * Group tickets by section, filter them, and sort.
 *
 * Filters (`options`): `search` (section name), `seat` ('firstrow' | 'frontrows' | 'all'),
 * `quality` ('top10' | 'top25' | 'top50' | 'any'), `price` ('cheapest' | 'sectionlow' | 'any') and `badgeFilters`, the "other" badges that must all be
 * present: 'standing', 'resale', 'attr:<name>' (an attribute from the list API) and 'custom:<id>' (the user's own).
 * `hideFilters` is the same kind of keys, for tickets to leave out: any ticket with one of them is hidden.
 * One that no ticket can have (a deleted custom badge, another venue's, an attribute not on this list)
 * is ignored. See filterTickets for how they combine.
 *
 * `options.rowConfig` ({ firstRows, frontRows }) says where rows start and how many
 * count as the front (see rowPosition); the default is Row 1 and 5 rows.
 * `options.customBadges` (from compileBadges) are the user's own pattern badges; a
 * ticket gets `badges[key]` and a `customMatches` entry for each one its text matches.
 * Tickets read from the list API also have `attributes` ("aisle"): each sets `badges['attr:aisle']`.
 *
 * Returns { groups, empty, counts }; each group is { name, tickets, topTicket, rows } where `rows` splits the
 * tickets by row (see groupByRow). `empty` is null when there are groups, otherwise
 * 'no-sections' (name search matched nothing) or 'no-matches' (the filters excluded
 * everything). `counts` is what each pill would show (see countPills). Tickets in the result are
 * annotated with `badges` and (for resale) `baselinePrice` / `baselineSource`.
 */
export function buildSectionGroups(tickets, options) {
  const opts = options || {};
  const search = (opts.search || '').toLowerCase().trim();
  const customKeys = (opts.customBadges || []).map(function (b) { return b.key; });
  const attributeKeys = new Set();
  tickets.forEach(function (t) { (t.attributes || []).forEach(function (a) { attributeKeys.add(attributeKey(a)); }); });
  // A custom badge or attribute no ticket can have here (deleted, another venue's, not on this list) is ignored.
  const exists = function (key) {
    if (isBadgeKey(key)) return customKeys.includes(key);
    if (isAttributeKey(key)) return attributeKeys.has(key);
    return true;
  };
  const other = Array.from(new Set(opts.badgeFilters || [])).filter(exists);
  const hide = Array.from(new Set(opts.hideFilters || [])).filter(exists).filter(function (key) { return !other.includes(key); });
  const compare = ticketComparator(opts.sort);

  annotate(tickets, opts);

  const filters = { search, seat: opts.seat, quality: opts.quality, price: opts.price, other, hide };
  const counts = countPills(tickets, filters, OTHER_FILTERS.map(function (f) { return f.key; }).concat(Array.from(attributeKeys), customKeys));

  if (!tickets.some(function (t) { return t.section.toLowerCase().includes(search); })) return { groups: [], empty: 'no-sections', counts };

  const bySection = new Map();
  filterTickets(tickets, filters).forEach(function (t) {
    if (!bySection.has(t.section)) bySection.set(t.section, []);
    bySection.get(t.section).push(t);
  });

  const groups = Array.from(bySection.entries()).map(function ([name, matching]) {
    const sorted = matching.slice().sort(compare);
    return { name, tickets: sorted, topTicket: sorted[0], rows: groupByRow(sorted, compare) };
  });

  if (groups.length === 0) return { groups: [], empty: 'no-matches', counts };

  groups.sort(function (a, b) { return compare(a.topTicket, b.topTicket); });
  return { groups, empty: null, counts };
}

/**
 * Text shown on the right of a section header: the group's top ticket.
 * Price sort: "Lowest: €80.75, Row: 21 (1st)". Seat sort, where the top ticket is the
 * best seat rather than the cheapest: "Row: 21 (1st), €80.75". The "(1st)" is the row's
 * place in its tier (see rowPosition) and is left out when it would only repeat the row
 * number, as it does at a venue whose rows start at 1. Lettered rows always get it
 * ("Row: C (3rd)").
 */
export function formatBestTicketLabel(ticket, sort) {
  if (!ticket) return '';

  const price = ticket.price > 0 ? formatPrice(ticket.price, ticket.currency) : 'N/A';
  const where = describeWhere(ticket);

  return sort === 'price' ? 'Lowest: ' + price + ', ' + where : where + ', ' + price;
}

function describeWhere(ticket) {
  if (ticket.type === 'vip') return ticket.originalSection || 'VIP';
  if (ticket.row === STANDING_ROW) return 'Standing';

  const name = ticket.rowName || ticket.row;
  // The place says something new unless it is just the row number again (never so for letters).
  const worthSaying = ticket.rowIndex && (ticket.rowIndex !== ticket.row || isLetterRow(name));
  return 'Row: ' + name + (worthSaying ? ' (' + ordinal(ticket.rowIndex) + ')' : '');
}
