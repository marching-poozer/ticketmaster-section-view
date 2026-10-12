// Our list's filters, applied to what the venue's seat map itself knows (lib/map-data.js): which seats on sale could be bought,
// at the quantity chosen, under the filters on screen. Ticketmaster's ticket list leaves out some of what the map sells (it keeps
// larger blocks of seats unbroken), so a filter that counts none in the list can still have matches here.
//
// What can be judged from the map: the section search (the section code), the seat choice (1st Row / First N Rows: the row's place
// in its tier, as in the list), Standing, Resale, and the attributes Ticketmaster gives seats (aisle, accessible). What cannot: the
// quality score, the price, VIP packages and the user's own badges (the map has none of them). A filter that cannot be judged is
// IGNORED here (a seat it might exclude still counts), and the result says it is not `exact`: it can say "none of the seats
// passes" with confidence, never "all of these pass".
//
// A "ticket" on the map is a group of as many neighbouring seats on sale in a row as the quantity asks for (one inventory type: a
// resale listing is its own). Standing is a count, never seats.
import { consecutiveRuns } from './map-data.js';
import { attributeKey } from './quickpicks.js';
import { rowPosition } from './sections.js';
import { rowRank } from './tickets.js';

/** Is anything filtered? `f` = { seat, quality, price, show, hide, search }. */
export function filtersActive(f) {
  const g = f || {};
  return (g.seat === 'firstrow' || g.seat === 'frontrows') || (!!g.tier && g.tier !== 'any') || (!!g.quality && g.quality !== 'any') || (!!g.price && g.price !== 'any') ||
    (g.show || []).length > 0 || (g.hide || []).length > 0 || String(g.search || '').trim() !== '';
}

/**
 * How each filter will be judged on the map.
 * `f` = { seat, tier, tierOf, firstRows, frontRows, quality, price, show, hide, search, quantity } (`tier` a tier key or 'any'; `tierOf(seat)` says
 * which tier a seat is in, see lib/tiers.js).
 * Returns { search, seat, tier, tierOf, firstRows, frontRows, show, hide, exact, quantity } where `show` / `hide` are the keys that can be judged
 * ('standing', 'resale', or an attribute key some seat has) and `exact` is false if any filter had to be ignored.
 */
export function judgeable(f, availability) {
  const g = f || {};
  const attributeKeys = new Set(availability ? Array.from(availability.attributeNames).map(attributeKey) : []);
  let exact = !(g.quality && g.quality !== 'any') && !(g.price && g.price !== 'any');
  const wantsTier = !!g.tier && g.tier !== 'any';
  if (wantsTier && typeof g.tierOf !== 'function') exact = false; // a tier chosen that the map cannot place seats in: ignored
  const show = Array.from(new Set(g.show || []));
  const hide = Array.from(new Set(g.hide || [])).filter(function (key) { return !show.includes(key); });
  const keep = function (key) {
    if (key === 'standing' || key === 'resale') return true;
    if (attributeKeys.has(key)) return true;
    exact = false; // VIP packages, the user's own badges, an attribute no seat on the map has
    return false;
  };
  const shown = show.filter(keep);
  const hidden = hide.filter(keep);
  return {
    search: String(g.search || '').toLowerCase().trim(),
    seat: g.seat === 'firstrow' || g.seat === 'frontrows' ? g.seat : null,
    tier: wantsTier && typeof g.tierOf === 'function' ? g.tier : null,
    tierOf: g.tierOf,
    firstRows: g.firstRows || [1],
    frontRows: g.frontRows || 5,
    show: shown,
    hide: hidden,
    exact,
    quantity: g.quantity > 0 ? Math.floor(g.quantity) : 1,
  };
}

/** Does a group of neighbouring seats pass the filters judged by `j`? */
function groupPasses(j, group) {
  const first = group[0];
  if (j.search && !String(first.section).toLowerCase().includes(j.search)) return false;
  if (j.tier && j.tierOf(first) !== j.tier) return false;
  if (j.seat) {
    const position = rowPosition(rowRank(first.row), j.firstRows);
    if (position === null) return false;
    if (j.seat === 'firstrow' ? position.index !== 1 : position.index > j.frontRows) return false;
  }
  const has = function (key) {
    if (key === 'standing') return false;
    if (key === 'resale') return first.inventory === 'resale';
    return group.some(function (s) { return s.attributes.some(function (a) { return attributeKey(a) === key; }); });
  };
  if (!j.show.every(has)) return false;
  return !j.hide.some(has);
}

/** Does a standing facet (a count of tickets on sale, no seats) pass? `names`: what the section is called, for the search. */
function standingPasses(j, facet, names) {
  if (facet.count < j.quantity) return false;
  if (j.search && !names.some(function (n) { return String(n).toLowerCase().includes(j.search); })) return false;
  if (j.seat) return false; // standing has no row
  if (j.tier) return false; // ...and is in no tier
  const has = function (key) {
    if (key === 'standing') return true;
    if (key === 'resale') return facet.inventory === 'resale';
    return facet.attributes.some(function (a) { return attributeKey(a) === key; });
  };
  if (!j.show.every(has)) return false;
  return !j.hide.some(has);
}

/**
 * Which seats on sale could be bought under the filters: { active, exact, quantity, blocks, seatKeys }, where
 * `blocks` maps a block id to { groups, standing, seatKeys } for each block with at least one passing group or passing standing
 * tickets (a block absent from it has none that pass), and `seatKeys` is every seat in a passing group.
 * `geometry` names the sections (for the search on standing); `namesFor(blockId)` may add what else a block is called (our list's name for it).
 */
export function evaluateAvailability(availability, geometry, f, namesFor) {
  const j = judgeable(f, availability);
  const result = { active: filtersActive(f), exact: j.exact, quantity: j.quantity, blocks: new Map(), seatKeys: new Set() };
  if (!availability) return result;
  const entry = function (id) {
    if (!result.blocks.has(id)) result.blocks.set(id, { groups: 0, standing: 0, seatKeys: new Set() });
    return result.blocks.get(id);
  };
  availability.byBlock.forEach(function (info, blockId) {
    // seats of one inventory type (resale listings do not mix with the others) in neighbouring runs: windows of `quantity` seats
    const byInventory = new Map();
    info.seats.forEach(function (s) {
      if (!byInventory.has(s.inventory)) byInventory.set(s.inventory, []);
      byInventory.get(s.inventory).push(s);
    });
    byInventory.forEach(function (seats) {
      consecutiveRuns(seats).forEach(function (run) {
        for (let i = 0; i + j.quantity <= run.length; i += 1) {
          const group = run.slice(i, i + j.quantity);
          if (!groupPasses(j, group)) continue;
          const block = entry(blockId);
          block.groups += 1;
          group.forEach(function (s) {
            block.seatKeys.add(s.key);
            result.seatKeys.add(s.key);
          });
        }
      });
    });
    if (info.standing.length) {
      const home = geometry && geometry.byBlockId.get(blockId);
      const names = (home ? [home.section, home.name] : []).concat(namesFor ? namesFor(blockId) || [] : []);
      info.standing.forEach(function (facet) {
        if (standingPasses(j, facet, names)) entry(blockId).standing += facet.count;
      });
    }
  });
  return result;
}

/**
 * How many places are on sale, by what the venue's map knows: { all, seats, standing, firstrow, frontrows }, or null without its data.
 * `seats` is every seat on sale (whatever the quantity: a seat alone counts), `standing` the standing tickets, `all` both, `firstrow` /
 * `frontrows` the seats in the first row / first N rows of each tier (the same tiers and rows as the list: `config` = { firstRows,
 * frontRows }), and `tiers` the seats on sale in each tier (`config.tierOf(seat)` -> a tier key, `config.tierKeys` the keys; {} without them).
 * Nothing here depends on any filter.
 */
export function seatCounts(availability, config) {
  if (!availability) return null;
  const firstRows = (config && config.firstRows) || [1];
  const frontRows = (config && config.frontRows) || 5;
  let firstrow = 0;
  let frontrows = 0;
  const tiers = {};
  const tierOf = config && typeof config.tierOf === 'function' ? config.tierOf : null;
  ((config && config.tierKeys) || []).forEach(function (key) { tiers[key] = 0; });
  availability.seats.forEach(function (seat) {
    if (tierOf) {
      const key = tierOf(seat);
      if (key && key in tiers) tiers[key] += 1;
    }
    const position = rowPosition(rowRank(seat.row), firstRows);
    if (!position) return;
    if (position.index === 1) firstrow += 1;
    if (position.index <= frontRows) frontrows += 1;
  });
  const standing = availability.standing.reduce(function (n, facet) { return n + facet.count; }, 0);
  return { all: availability.seats.length + standing, seats: availability.seats.length, standing, firstrow, frontrows, tiers };
}
