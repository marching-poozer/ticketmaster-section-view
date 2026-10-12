// Seating tiers: Lower | Middle | Upper. Ticketmaster has no "tier" field: it is in the names. At the O2 Belfast the map's blocks are
// "NORTH LOWER 1", the list says "NORTH UPPER TIER" ("EAST MID TIER": MID, not MIDDLE), and the rows split the tiers exactly (lower A-K,
// middle L-R, upper S-Y). Where a venue has no such words (3Arena: "BLOCK E", rows 21 and 33 start the tiers), the rows the user gave as
// the FIRST ROW of each tier are the tiers: two starts are Lower and Upper, three Lower, Middle and Upper, more are Tier 1, Tier 2...
//
// A model says which tiers a venue has and which one a ticket, a row or a seat on the map is in. Where tiers come from, in this order:
//   1. the rows the user gave as the first row of each tier (two or more): `mode: 'rows'`, a place is in the tier its row is in;
//   2. else the tier words in the section names and descriptions (two or more different ones): `mode: 'words'`.
// With neither there are no tiers (the model is null) and there is nothing to filter.
import { STANDING_ROW } from './constants.js';
import { rowRank } from './tickets.js';

const WORDS = ['lower', 'middle', 'upper'];
const WORD_LABELS = { lower: 'Lower', middle: 'Middle', upper: 'Upper' };
const MAX_ROW_TIERS = 9; // more tier starts than this is not tiers

/** 'lower' | 'middle' | 'upper' for text that says so ("NORTH LOWER TIER", "EAST MID TIER", "WEST UPPER 7"), else null. */
export function tierWord(text) {
  const found = /\b(lower|middle|mid|upper)\b/i.exec(String(text == null ? '' : text));
  if (!found) return null;
  const word = found[1].toLowerCase();
  return word === 'mid' ? 'middle' : word;
}

/** What a tier is called: 'lower' -> 'Lower', 'tier-3' -> 'Tier 3'. */
export function tierLabel(key) {
  if (WORD_LABELS[key]) return WORD_LABELS[key];
  const number = /^tier-(\d+)$/.exec(String(key));
  return number ? 'Tier ' + number[1] : String(key);
}

/** The keys of `count` tiers (ordered from the floor up): 2 are Lower and Upper, 3 Lower, Middle and Upper, more are Tier 1... */
export function tierKeysFor(count) {
  if (count === 2) return ['lower', 'upper'];
  if (count === 3) return ['lower', 'middle', 'upper'];
  return Array.from({ length: count }, function (_, i) { return 'tier-' + (i + 1); });
}

/** The ranks (A = 1, 21, ...) of the rows the user gave as the first row of each tier, ascending, without repeats or what is not a row. */
function startRanks(firstRows) {
  const ranks = (firstRows || []).map(function (s) { return typeof s === 'number' ? s : rowRank(s); }).filter(function (r) { return typeof r === 'number' && r > 0; });
  return Array.from(new Set(ranks)).sort(function (a, b) { return a - b; });
}

/**
 * `firstRows`: where the venue's tiers start, as the user gave them (numbers or letters). `words`: the tier words found in the
 * venue's section names and descriptions (a Set of 'lower' | 'middle' | 'upper'). `blockTiers`: Map(block id -> tier word), the
 * map's own blocks by name, for seats on the venue's map (words mode).
 * Returns null when the venue has no tiers, else
 *   { mode: 'rows' | 'words', keys: [...], tiers: [{ key, label }], ofRank(rank), ofTicket(ticket), ofSeat(seat) } where each `of…` gives
 *   a tier key or null (standing, VIP packages, a seat of a block that is in no tier).
 */
export function buildTierModel(input) {
  const o = input || {};
  const starts = startRanks(o.firstRows);
  if (starts.length >= 2 && starts.length <= MAX_ROW_TIERS) {
    const keys = tierKeysFor(starts.length);
    const ofRank = function (rank) {
      if (!(rank > 0) || rank === STANDING_ROW) return null;
      let index = 0;
      starts.forEach(function (start, i) { if (start <= rank) index = i; });
      return keys[index];
    };
    return {
      mode: 'rows',
      keys,
      tiers: keys.map(function (key) { return { key, label: tierLabel(key) }; }),
      ofRank,
      ofTicket: function (ticket) { return ticket.type === 'vip' ? null : ofRank(ticket.row); },
      ofSeat: function (seat) { return ofRank(rowRank(seat.row)); },
    };
  }
  const found = WORDS.filter(function (word) { return o.words && o.words.has(word); });
  if (found.length < 2) return null;
  const blocks = o.blockTiers || new Map();
  const known = function (word) { return word && found.includes(word) ? word : null; };
  return {
    mode: 'words',
    keys: found,
    tiers: found.map(function (key) { return { key, label: tierLabel(key) }; }),
    ofRank: function () { return null; },
    ofTicket: function (ticket) { return ticket.type === 'vip' ? null : known(tierWord(ticket.description)); },
    ofSeat: function (seat) { return known(blocks.get(seat.block) || null); },
  };
}

/** The tier words in some texts (descriptions, block names): a Set. */
export function wordsIn(texts) {
  const words = new Set();
  texts.forEach(function (text) {
    const word = tierWord(text);
    if (word) words.add(word);
  });
  return words;
}
