import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAvailability, parseFacets, parseGeometry } from '../src/lib/map-data.js';
import { evaluateAvailability, filtersActive, judgeable, seatCounts } from '../src/lib/map-filters.js';

// Real excerpts of The O2 Belfast's seat map data: NORTH MIDDLE 3 (s_79: rows M and N, seats on sale in groups of 3 and one on its own),
// NORTH LOWER 1 (s_5: rows C, F, G, J), EAST LOWER 8 (s_22: rows G-K, aisle seats), WEST UPPER 1 (s_49: one resale seat in row U),
// NORTH MIDDLE 4 (s_78), the standing floor (s_112) and NORTH MIDDLE 5 (s_77: nothing on sale).
const fixture = (name) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures', name), 'utf8'));
const geometry = parseGeometry(fixture('o2-map-geometry.json'));
const availability = buildAvailability(geometry, parseFacets(fixture('o2-map-facets.json')));

const none = { seat: 'all', quality: 'any', price: 'any', show: [], hide: [], search: '', firstRows: [1], frontRows: 5, quantity: 2 };
const evaluate = (f = {}) => evaluateAvailability(availability, geometry, { ...none, ...f });
const groupsOf = (result, id) => (result.blocks.get(id) || { groups: 0 }).groups;
const blocksOf = (result) => Array.from(result.blocks.keys()).sort();

describe('which filters are in use', () => {
  it('says nothing is filtered when nothing is', () => {
    expect(filtersActive(none)).toBe(false);
    expect(filtersActive({})).toBe(false);
    expect(filtersActive(null)).toBe(false);
  });

  it('says it is as soon as any filter is', () => {
    expect(filtersActive({ ...none, seat: 'firstrow' })).toBe(true);
    expect(filtersActive({ ...none, seat: 'frontrows' })).toBe(true);
    expect(filtersActive({ ...none, quality: 'top10' })).toBe(true);
    expect(filtersActive({ ...none, price: 'cheapest' })).toBe(true);
    expect(filtersActive({ ...none, show: ['resale'] })).toBe(true);
    expect(filtersActive({ ...none, hide: ['standing'] })).toBe(true);
    expect(filtersActive({ ...none, search: ' nth ' })).toBe(true);
    expect(filtersActive({ ...none, search: '  ' })).toBe(false);
  });
});

describe('which filters the map can judge', () => {
  it('judges the seat choice, search, Standing, Resale and the attributes seats have; and is exact then', () => {
    const j = judgeable({ ...none, seat: 'firstrow', show: ['resale', 'attr:aisle'], hide: ['standing'], search: 'NTH' }, availability);
    expect(j).toMatchObject({ seat: 'firstrow', search: 'nth', show: ['resale', 'attr:aisle'], hide: ['standing'], exact: true, quantity: 2 });
  });

  it('cannot judge quality or price: it ignores them, and says it is not exact', () => {
    expect(judgeable({ ...none, quality: 'top10' }, availability).exact).toBe(false);
    expect(judgeable({ ...none, price: 'cheapest' }, availability).exact).toBe(false);
  });

  it('cannot judge VIP packages, the user\'s own badges, or an attribute no seat has: it ignores them too', () => {
    const j = judgeable({ ...none, show: ['vip', 'custom:abc123', 'attr:restricted-view', 'resale'], hide: ['custom:zzz'] }, availability);
    expect(j.show).toEqual(['resale']);
    expect(j.hide).toEqual([]);
    expect(j.exact).toBe(false);
  });

  it('lets a pill that shows win over the same pill hiding (as the list does), and takes the quantity as it is, at least 1', () => {
    expect(judgeable({ ...none, show: ['resale'], hide: ['resale'] }, availability).hide).toEqual([]);
    expect(judgeable({ ...none, quantity: 0 }, availability).quantity).toBe(1);
    expect(judgeable({ ...none, quantity: 3.7 }, availability).quantity).toBe(3);
    expect(judgeable({ ...none, quantity: undefined }, availability).quantity).toBe(1);
  });
});

describe('which seats on sale could be bought, with nothing filtered', () => {
  it('counts groups of the quantity asked for: a run of 3 holds two pairs, or one trio', () => {
    // NORTH MIDDLE 3: row M 38-40 and 43-45, row N 39-41, and seat M47 on its own
    expect(groupsOf(evaluate({ quantity: 2 }), 's_79')).toBe(6);
    expect(groupsOf(evaluate({ quantity: 3 }), 's_79')).toBe(3);
    expect(groupsOf(evaluate({ quantity: 1 }), 's_79')).toBe(10);
  });

  it('has none where there is no run long enough: a block with seats on sale that cannot sell the quantity', () => {
    expect(groupsOf(evaluate({ quantity: 4 }), 's_79')).toBe(0);
    expect(evaluate({ quantity: 4 }).blocks.has('s_79')).toBe(false);
  });

  it('has none for a block with nothing on sale at all, and a block of resale seats only has them under its own inventory', () => {
    expect(evaluate({ quantity: 1 }).blocks.has('s_77')).toBe(false);
    expect(groupsOf(evaluate({ quantity: 1 }), 's_49')).toBe(1);
    expect(groupsOf(evaluate({ quantity: 2 }), 's_49')).toBe(0); // one seat
  });

  it('counts standing as tickets on sale (at least the quantity), never as seats', () => {
    const result = evaluate({ quantity: 2 });
    expect(result.blocks.get('s_112')).toMatchObject({ groups: 0, standing: 822 });
  });

  it('is not active, and says it is exact', () => {
    expect(evaluate()).toMatchObject({ active: false, exact: true, quantity: 2 });
  });
});

describe('the seat choice on the map', () => {
  it('finds the 1st row of the tier: with Row 1 as the start, only a row A, so none of these blocks (rows C-K, L-R)', () => {
    expect(blocksOf(evaluate({ seat: 'firstrow' }))).toEqual([]);
  });

  it('follows where the venue says tiers start (the same as the list): the middle tier starting at M makes row M its first row', () => {
    const result = evaluate({ seat: 'firstrow', firstRows: ['A', 'M', 'S'] });
    expect(blocksOf(result)).toEqual(['s_79']);
    expect(result.blocks.get('s_79').seatKeys.size).toBe(6); // pairs from 38-40 and from 43-45 (not the lone 47, nor row N): six seats of row M
    Array.from(result.blocks.get('s_79').seatKeys).forEach((key) => expect(key).toMatch(/^NTHM3\|M\|/));
  });

  it('counts the first N rows of each tier: with the default 5 and Row 1 as the start, rows A-E: NORTH LOWER 1 has seats in row C', () => {
    const result = evaluate({ seat: 'frontrows', frontRows: 5 });
    expect(blocksOf(result)).toEqual(['s_5']);
    expect(groupsOf(evaluate({ seat: 'frontrows', frontRows: 5, quantity: 1 }), 's_5')).toBe(3); // the three seats of row C (F, G and J are further back)
  });

  it('judges the first rows of every block, listed or not: that is the point (rows are ranked A=1, B=2, ...: M is 13th, N 14th)', () => {
    expect(blocksOf(evaluate({ seat: 'frontrows', frontRows: 12, firstRows: [1] }))).toEqual(['s_22', 's_5']);
    expect(blocksOf(evaluate({ seat: 'frontrows', frontRows: 14, firstRows: [1] }))).toEqual(['s_22', 's_5', 's_78', 's_79']);
  });

  it('has no row for standing, so a row choice leaves it out', () => {
    expect(evaluate({ seat: 'frontrows', frontRows: 99, quantity: 1 }).blocks.has('s_112')).toBe(false);
  });
});

describe('Standing, Resale and attributes on the map', () => {
  it('shows only standing: no seat, and the floor', () => {
    const result = evaluate({ show: ['standing'], quantity: 1 });
    expect(blocksOf(result)).toEqual(['s_112']);
    expect(result.blocks.get('s_112').standing).toBe(822);
    expect(result.seatKeys.size).toBe(0);
  });

  it('hides standing: seated tickets only', () => {
    const result = evaluate({ hide: ['standing'], quantity: 1 });
    expect(result.blocks.has('s_112')).toBe(false);
    expect(result.blocks.has('s_79')).toBe(true);
  });

  it('shows only resale: the resale seat and the resale standing tickets', () => {
    const result = evaluate({ show: ['resale'], quantity: 1 });
    expect(blocksOf(result)).toEqual(['s_112', 's_49']);
    expect(result.blocks.get('s_112').standing).toBe(14);
  });

  it('hides resale', () => {
    const result = evaluate({ hide: ['resale'], quantity: 1 });
    expect(result.blocks.has('s_49')).toBe(false);
    expect(result.blocks.get('s_112').standing).toBe(808);
  });

  it('shows only the seats with an attribute (aisle): a group passes if one of its seats has it', () => {
    const result = evaluate({ show: ['attr:aisle'], quantity: 2 });
    expect(blocksOf(result)).toEqual(expect.arrayContaining(['s_22']));
    expect(result.blocks.has('s_79')).toBe(false); // no aisle seat in NORTH MIDDLE 3
    expect(result.blocks.has('s_112')).toBe(false);
  });

  it('ignores a filter it cannot judge, and says so: a quality choice changes nothing', () => {
    const plain = evaluate({ quantity: 2 });
    const quality = evaluate({ quality: 'top10', quantity: 2 });
    expect(blocksOf(quality)).toEqual(blocksOf(plain));
    expect(quality).toMatchObject({ active: true, exact: false });
  });

  it('every pill must hold: shows-only are all required', () => {
    expect(blocksOf(evaluate({ show: ['standing', 'resale'], quantity: 1 }))).toEqual(['s_112']); // resale standing only
    expect(evaluate({ show: ['resale', 'attr:aisle'], quantity: 1 }).blocks.size).toBe(0);
  });
});

describe('the section search on the map', () => {
  it('keeps the blocks whose section code has the text', () => {
    expect(blocksOf(evaluate({ search: 'nthm', quantity: 1 }))).toEqual(['s_78', 's_79']);
    expect(blocksOf(evaluate({ search: 'EAST', quantity: 1 }))).toEqual(['s_22']);
  });

  it('finds the floor by what it is called, or by the name our list gives it', () => {
    expect(blocksOf(evaluate({ search: 'stand', quantity: 1 }))).toEqual(['s_112']);
    expect(blocksOf(evaluate({ search: 'over 14', quantity: 1 }))).toEqual([]);
    const named = evaluateAvailability(availability, geometry, { ...none, search: 'over 14', quantity: 1 }, (id) => (id === 's_112' ? ["STANDING-OVER 14'S ONLY"] : []));
    expect(blocksOf(named)).toEqual(['s_112']);
  });
});

describe('with nothing to go on', () => {
  it('has no blocks without availability, and no error', () => {
    const result = evaluateAvailability(null, null, none);
    expect(result.blocks.size).toBe(0);
    expect(result.seatKeys.size).toBe(0);
  });
});

describe('how many places are on sale, by the map', () => {
  it('counts every seat on sale and every standing ticket: Any is all of them', () => {
    expect(seatCounts(availability, { firstRows: [1], frontRows: 5 })).toMatchObject({ seats: 50, standing: 822, all: 872 });
  });

  it('counts the seats in the first row, and the first N rows, of each tier, as the list does (rows A=1, B=2, ...; tiers where the venue says)', () => {
    // Row 1 as the only start: only rows A-E count as front; the blocks here have C (NORTH LOWER 1) among them
    expect(seatCounts(availability, { firstRows: [1], frontRows: 5 })).toMatchObject({ firstrow: 0, frontrows: 3 });
    // the middle tier starting at row M: its first row is M (NORTH MIDDLE 3 has 7 seats on sale there)
    expect(seatCounts(availability, { firstRows: ['A', 'M', 'S'], frontRows: 1 })).toMatchObject({ firstrow: 7, frontrows: 7 });
    // a deep front: rows up to the 14th (N), so NORTH LOWER 1 (10), EAST LOWER 8 (27), NORTH MIDDLE 3 (10) and NORTH MIDDLE 4 (2)
    expect(seatCounts(availability, { firstRows: [1], frontRows: 14 }).frontrows).toBe(49);
  });

  it('has no row for standing, and none for a seat in a row it cannot rank', () => {
    expect(seatCounts(availability, { firstRows: [1], frontRows: 99 }).frontrows).toBe(50); // every seat, none of the standing
  });

  it('does not depend on any filter: it is not given any', () => {
    const before = seatCounts(availability, { firstRows: ['A', 'M', 'S'], frontRows: 3 });
    evaluate({ show: ['resale'], quality: 'top10', search: 'nthm', quantity: 4 }); // (whatever the list is filtered by)
    expect(seatCounts(availability, { firstRows: ['A', 'M', 'S'], frontRows: 3 })).toEqual(before);
  });

  it('uses the same defaults as the list when not told the tiers', () => {
    expect(seatCounts(availability, null)).toEqual(seatCounts(availability, { firstRows: [1], frontRows: 5 }));
  });

  it('is null without the map\'s data', () => {
    expect(seatCounts(null, { firstRows: [1], frontRows: 5 })).toBeNull();
  });
});
