// What Ticketmaster's seat map itself knows, from the two requests its page makes when it loads (see content/map-data-store.js):
//
//   GEOMETRY  .../maps/geometry/3/event/<id>/placeDetailNoKeys: every block of the venue, with its rows and seats. A block
//             ("WEST LOWER 8", id "s_38", the map's own data-section-id) holds one section (code "WESTL8", the code our list
//             uses too), which holds rows ("A", "B"...), which hold places: [placeId, seat name, x, y, group, order, ?]. `order`
//             counts down along the row, so seats with consecutive orders are neighbours. A standing floor is a block with
//             `generalAdmission: true` and no rows.
//   FACETS    .../api/ismds/host/<id>/facets?q=available&...&show=places&compress=places: every seat on sale RIGHT NOW, whatever
//             the quantity asked, in groups with the same offer: inventory type (primary / resale), attributes (aisle,
//             accessible), accessibility, the block, and the place ids in a compressed form (see expandPlaces). Standing has a
//             count and no places.
//
// The ticket list only has what Ticketmaster offers for the quantity chosen (it keeps larger blocks of seats unbroken, so it
// leaves out, say, a group of 3 when asked for 2); the map has every seat on sale. Joined here, they say which seats are on
// sale in each block and row, which is what the filters on rows need to judge a block the list has nothing for.
//
// Pure: no DOM, no network. Everything tolerates garbage (a changed format gives less, never an error).
import { keyOf } from './map-link.js';

const MAX_IDS = 200000; // a runaway expansion (a format we do not understand) stops here

/**
 * Place ids come compressed as a tree: a shared start and bracketed alternatives, nested:
 * "IVAVGVCMGE5E[OORR,QORRGI]" is "IVAVGVCMGE5EOORR" and "IVAVGVCMGE5EQORRGI"; "GOR[V[G[4,Q],H[A]],WG[A]]" is GORVG4, GORVGQ,
 * GORVHA, GORWGA. Returns the full ids ([] for a string that does not parse).
 */
export function expandPlaces(text) {
  const s = String(text == null ? '' : text);
  let count = 0;

  function sequence(i) {
    let results = [''];
    while (i < s.length && s[i] !== ',' && s[i] !== ']') {
      if (s[i] === '[') {
        const group = alternatives(i + 1);
        i = group.end;
        const next = [];
        results.forEach(function (r) { group.items.forEach(function (a) { next.push(r + a); }); });
        count += next.length;
        if (count > MAX_IDS) throw new Error('too many');
        results = next;
      } else {
        let j = i;
        while (j < s.length && s[j] !== '[' && s[j] !== ']' && s[j] !== ',') j += 1;
        const literal = s.slice(i, j);
        results = results.map(function (r) { return r + literal; });
        i = j;
      }
    }
    return { items: results, end: i };
  }

  function alternatives(i) {
    let items = [];
    for (;;) {
      const seq = sequence(i);
      items = items.concat(seq.items);
      i = seq.end;
      if (s[i] === ',') { i += 1; continue; }
      if (s[i] === ']') return { items, end: i + 1 };
      throw new Error('unbalanced');
    }
  }

  try {
    const top = sequence(0);
    return top.end === s.length ? top.items.filter(Boolean) : [];
  } catch (err) {
    return [];
  }
}

/**
 * The geometry response -> { blocks, byBlockId, bySection, places } or null if it is not one.
 * A block: { id, name, section (code), generalAdmission, totalPlaces, rows: [{ name, seats: [{ id, seat, order, x, y }] }] }.
 * `places` maps a place id to { block, row, seat, order }.
 */
export function parseGeometry(json) {
  const page = json && Array.isArray(json.pages) ? json.pages[0] : null;
  if (!page || !Array.isArray(page.segments)) return null;
  const blocks = [];
  const byBlockId = new Map();
  const bySection = new Map();
  const places = new Map();
  page.segments.forEach(function (composite) {
    if (!composite || typeof composite.id !== 'string') return;
    const sections = Array.isArray(composite.segments) ? composite.segments : [];
    const section = sections[0] || {};
    const block = {
      id: composite.id,
      name: String(composite.name || ''),
      section: String(section.name || ''),
      generalAdmission: composite.generalAdmission === true || section.generalAdmission === true,
      totalPlaces: composite.totalPlaces || 0,
      rows: [],
    };
    (Array.isArray(section.segments) ? section.segments : []).forEach(function (row) {
      const seats = (Array.isArray(row.placesNoKeys) ? row.placesNoKeys : []).filter(Array.isArray).map(function (p) {
        return { id: String(p[0]), seat: String(p[1]), x: p[2], y: p[3], order: typeof p[5] === 'number' ? p[5] : null };
      });
      block.rows.push({ name: String(row.name || ''), seats });
      seats.forEach(function (seat) { places.set(seat.id, { block: block.id, row: String(row.name || ''), seat: seat.seat, order: seat.order }); });
    });
    blocks.push(block);
    byBlockId.set(block.id, block);
    if (block.section) bySection.set(block.section, block);
  });
  return { blocks, byBlockId, bySection, places };
}

/**
 * The facets response -> { facets, expires } or null if it is not one. A facet is a group of seats on sale with the same
 * offer: { block, ids (place ids), count, inventory ('primary' | 'resale' | ...), attributes, accessibility, ticketType, offer,
 * description }. A standing facet has a `count` and no ids.
 */
export function parseFacets(json) {
  if (!json || !Array.isArray(json.facets)) return null;
  const facets = [];
  json.facets.forEach(function (f) {
    if (!f || f.available === false) return;
    const ids = [];
    (Array.isArray(f.places) ? f.places : []).forEach(function (text) { expandPlaces(text).forEach(function (id) { ids.push(id); }); });
    facets.push({
      block: Array.isArray(f.shapes) ? String(f.shapes[0] || '') : '',
      ids,
      count: typeof f.count === 'number' ? f.count : ids.length,
      inventory: Array.isArray(f.inventoryTypes) && f.inventoryTypes[0] ? String(f.inventoryTypes[0]) : 'primary',
      attributes: Array.isArray(f.attributes) ? f.attributes.map(String) : [],
      accessibility: Array.isArray(f.accessibility) ? f.accessibility.map(String) : [],
      ticketType: Array.isArray(f.ticketTypes) && f.ticketTypes[0] ? String(f.ticketTypes[0]) : '',
      offer: Array.isArray(f.offers) && f.offers[0] ? String(f.offers[0]) : '',
      description: f.description ? String(f.description) : '',
    });
  });
  return { facets, expires: json.meta && json.meta.expires ? String(json.meta.expires) : '' };
}

/** 'section|row|seat': the same key the seat circles of the zoomed map and our tickets have (see map.js). */
export function seatKeyOf(section, row, seat) {
  return keyOf(section) + '|' + String(row == null ? '' : row).trim().toUpperCase() + '|' + String(seat == null ? '' : seat).trim();
}

/**
 * Join the two: every seat on sale, with where it is.
 * Returns { seats, byBlock, bySeatKey, standing, attributeNames, generalAdmission } where
 *   seats: [{ key, id, block, section, row, seat, order, inventory, attributes, accessibility, ticketType, offer, description }],
 *   byBlock: Map(block id -> { seats: [...], standing: [facets] }),
 *   bySeatKey: Map(seatKeyOf -> seat),
 *   standing: the facets of standing blocks (counts, no seats),
 *   attributeNames: every attribute any seat has ("aisle", "accessible"), and
 *   unplaced: how many place ids the geometry does not know (a sign that the two do not belong together).
 */
export function buildAvailability(geometry, parsedFacets) {
  const seats = [];
  const byBlock = new Map();
  const bySeatKey = new Map();
  const standing = [];
  const attributeNames = new Set();
  let unplaced = 0;
  const entry = function (blockId) {
    if (!byBlock.has(blockId)) byBlock.set(blockId, { seats: [], standing: [] });
    return byBlock.get(blockId);
  };
  if (!geometry || !parsedFacets) return { seats, byBlock, bySeatKey, standing, attributeNames, unplaced };
  parsedFacets.facets.forEach(function (f) {
    f.attributes.forEach(function (a) { attributeNames.add(a); });
    const home = geometry.byBlockId.get(f.block);
    if (f.ids.length === 0) {
      if (home && (home.generalAdmission || home.rows.length === 0)) {
        standing.push(f);
        entry(f.block).standing.push(f);
      }
      return;
    }
    f.ids.forEach(function (id) {
      const place = geometry.places.get(id);
      if (!place) {
        unplaced += 1;
        return;
      }
      const block = geometry.byBlockId.get(place.block);
      const seat = {
        key: seatKeyOf(block.section, place.row, place.seat),
        id,
        block: place.block,
        section: block.section,
        row: place.row,
        seat: place.seat,
        order: place.order,
        inventory: f.inventory,
        attributes: f.attributes,
        accessibility: f.accessibility,
        ticketType: f.ticketType,
        offer: f.offer,
        description: f.description,
      };
      seats.push(seat);
      entry(place.block).seats.push(seat);
      bySeatKey.set(seat.key, seat);
    });
  });
  return { seats, byBlock, bySeatKey, standing, attributeNames, unplaced };
}

/**
 * The runs of neighbouring seats among some seats of ONE block: each run is an array of seats in one row with consecutive
 * orders, longest first. (A seat with no order is a run of its own.)
 */
export function consecutiveRuns(seats) {
  const byRow = new Map();
  seats.forEach(function (s) {
    if (!byRow.has(s.row)) byRow.set(s.row, []);
    byRow.get(s.row).push(s);
  });
  const runs = [];
  byRow.forEach(function (inRow) {
    const ordered = inRow.filter(function (s) { return s.order !== null; }).sort(function (a, b) { return b.order - a.order; });
    let run = [];
    ordered.forEach(function (s) {
      if (run.length && run[run.length - 1].order - s.order !== 1) {
        runs.push(run);
        run = [];
      }
      run.push(s);
    });
    if (run.length) runs.push(run);
    inRow.filter(function (s) { return s.order === null; }).forEach(function (s) { runs.push([s]); });
  });
  return runs.sort(function (a, b) { return b.length - a.length; });
}

/** For the Map report: what we know, in few words. */
export function describeData(geometry, availability) {
  const resale = availability ? availability.seats.filter(function (s) { return s.inventory === 'resale'; }).length : 0;
  return {
    geometry: geometry ? { blocks: geometry.blocks.length, places: geometry.places.size, standing: geometry.blocks.filter(function (b) { return b.generalAdmission; }).map(function (b) { return b.name; }) } : null,
    availability: availability ? {
      seatsOnSale: availability.seats.length,
      resale,
      blocksWithSeats: Array.from(availability.byBlock.values()).filter(function (b) { return b.seats.length > 0; }).length,
      standingOnSale: availability.standing.reduce(function (n, f) { return n + f.count; }, 0),
      attributes: Array.from(availability.attributeNames),
      unplaced: availability.unplaced,
    } : null,
  };
}
