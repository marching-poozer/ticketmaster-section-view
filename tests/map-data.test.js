import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAvailability, consecutiveRuns, describeData, expandPlaces, parseFacets, parseGeometry, seatKeyOf } from '../src/lib/map-data.js';

// Real excerpts of The O2 Belfast's seat map data (2026-10-10): see the notes inside the files.
const fixture = (name) => JSON.parse(readFileSync(path.resolve(process.cwd(), 'tests/fixtures', name), 'utf8'));
const geometryJson = fixture('o2-map-geometry.json');
const facetsJson = fixture('o2-map-facets.json');

describe('expandPlaces', () => {
  it('is the text itself when nothing is bracketed', () => {
    expect(expandPlaces('K5CVGVCMHA5ECORRGUYQ')).toEqual(['K5CVGVCMHA5ECORRGUYQ']);
  });

  it('spreads alternatives over their shared start', () => {
    expect(expandPlaces('IVAVGVCMGE5E[OORR,QORRGI]')).toEqual(['IVAVGVCMGE5EOORR', 'IVAVGVCMGE5EQORRGI']);
  });

  it('nests: alternatives within alternatives, and more text after a group', () => {
    expect(expandPlaces('GOR[V[G[4,Q],H[A]],WG[A]]')).toEqual(['GORVG4', 'GORVGQ', 'GORVHA', 'GORWGA']);
    expect(expandPlaces('X[A,B]Y[1,2]')).toEqual(['XAY1', 'XAY2', 'XBY1', 'XBY2']);
  });

  it('gives nothing for text that does not parse (a format it does not know), never an error', () => {
    expect(expandPlaces('A[B,C')).toEqual([]);
    expect(expandPlaces('A]B')).toEqual([]);
    expect(expandPlaces('')).toEqual([]);
    expect(expandPlaces(null)).toEqual([]);
  });

  it('stops a runaway expansion instead of eating the page', () => {
    const wide = 'A' + '[0,1,2,3,4,5,6,7,8,9]'.repeat(7);
    expect(expandPlaces(wide)).toEqual([]);
  });
});

describe('parseGeometry', () => {
  const geometry = parseGeometry(geometryJson);

  it('reads blocks with their section code, rows and seats', () => {
    expect(geometry.blocks.map((b) => b.id)).toEqual(['s_78', 's_77', 's_79', 's_22', 's_112', 's_49', 's_5']);
    const north = geometry.byBlockId.get('s_79');
    expect(north).toMatchObject({ name: 'NORTH MIDDLE 3', section: 'NTHM3', generalAdmission: false });
    expect(north.rows.map((r) => r.name)).toEqual(['P', 'Q', 'R', 'L', 'M', 'N']);
    expect(geometry.bySection.get('NTHM3')).toBe(north);
  });

  it('puts every seat where the live map draws it (a seat circle seen on the page: EASTL8, row J, seat 141)', () => {
    const east = geometry.bySection.get('EASTL8');
    const seat = east.rows.find((r) => r.name === 'J').seats.find((s) => s.seat === '141');
    expect(seat).toMatchObject({ x: 7807.4, y: 5568.85, order: 21 });
    expect(geometry.places.get(seat.id)).toEqual({ block: 's_22', row: 'J', seat: '141', order: 21 });
  });

  it('knows the standing floor: a block that is general admission and has no rows', () => {
    const floor = geometry.byBlockId.get('s_112');
    expect(floor).toMatchObject({ name: 'GROUND FLOOR STANDING', section: 'STAND', generalAdmission: true, totalPlaces: 4600, rows: [] });
  });

  it('is null for anything else', () => {
    expect(parseGeometry(null)).toBeNull();
    expect(parseGeometry({})).toBeNull();
    expect(parseGeometry({ pages: [] })).toBeNull();
  });
});

describe('parseFacets', () => {
  const facets = parseFacets(facetsJson);

  it('expands the places of each group and keeps what is known of its seats', () => {
    expect(facets.facets.length).toBe(14);
    const north = facets.facets.filter((f) => f.block === 's_79');
    expect(north.reduce((n, f) => n + f.ids.length, 0)).toBe(10);
    north.forEach((f) => expect(f.ids).toHaveLength(f.count)); // the count says how many the compressed text should give
    expect(north[0]).toMatchObject({ inventory: 'primary', attributes: [] });
  });

  it('has a count and no seats for standing', () => {
    const standing = facets.facets.filter((f) => f.block === 's_112');
    expect(standing.every((f) => f.ids.length === 0)).toBe(true);
    expect(standing.reduce((n, f) => n + f.count, 0)).toBe(822);
    expect(standing.map((f) => f.inventory).sort()).toEqual(['primary', 'primary', 'resale']);
  });

  it('leaves out what is not available, and is null for a response that is not facets', () => {
    expect(parseFacets({ facets: [{ available: false, shapes: ['s_1'], places: [], count: 3 }] }).facets).toEqual([]);
    expect(parseFacets(null)).toBeNull();
    expect(parseFacets({})).toBeNull();
  });
});

describe('buildAvailability', () => {
  const geometry = parseGeometry(geometryJson);
  const availability = buildAvailability(geometry, parseFacets(facetsJson));

  it('has every seat on sale with its block, section, row and seat, all of them found in the geometry', () => {
    expect(availability.unplaced).toBe(0);
    expect(availability.seats).toHaveLength(10 + 27 + 10 + 2 + 1); // NTHM3, EASTL8, NTHL1, NTHM4, WESTU1
    const counts = (id) => availability.byBlock.get(id).seats.length;
    expect([counts('s_79'), counts('s_22'), counts('s_5'), counts('s_78'), counts('s_49')]).toEqual([10, 27, 10, 2, 1]); // the same figures as the live map's own seats
    expect(availability.byBlock.has('s_77')).toBe(false); // nothing on sale in NORTH MIDDLE 5
  });

  it('names a seat the way the zoomed map and our tickets do', () => {
    const seat = availability.bySeatKey.get(seatKeyOf('EASTL8', 'G', '141'));
    expect(seat).toMatchObject({ block: 's_22', section: 'EASTL8', row: 'G', seat: '141', inventory: 'primary', attributes: ['aisle'] });
    expect(seatKeyOf('Nth-M3', ' p ', 12)).toBe('NTHM3|P|12');
  });

  it('keeps inventory and attributes, and says which attributes there are', () => {
    expect(availability.byBlock.get('s_49').seats[0]).toMatchObject({ inventory: 'resale', row: 'U' });
    expect(Array.from(availability.attributeNames)).toContain('aisle');
  });

  it('counts standing by the facets of the floor', () => {
    const floor = availability.byBlock.get('s_112');
    expect(floor.seats).toEqual([]);
    expect(floor.standing.reduce((n, f) => n + f.count, 0)).toBe(822);
  });

  it('gives nothing, and no error, without both halves', () => {
    expect(buildAvailability(null, null).seats).toEqual([]);
    expect(buildAvailability(geometry, null).seats).toEqual([]);
  });

  it('counts the places the geometry does not know (the two do not belong together)', () => {
    const other = buildAvailability(parseGeometry({ pages: [{ segments: [{ id: 's_79', name: 'NORTH MIDDLE 3', segments: [{ name: 'NTHM3', segments: [] }] }] }] }), parseFacets(facetsJson));
    expect(other.seats).toEqual([]);
    expect(other.unplaced).toBeGreaterThan(0);
  });
});

describe('consecutiveRuns', () => {
  const geometry = parseGeometry(geometryJson);
  const availability = buildAvailability(geometry, parseFacets(facetsJson));

  it('finds the groups of neighbouring seats: NORTH MIDDLE 3 has three groups of 3 and one on its own (so a list for 2 tickets leaves them out)', () => {
    const runs = consecutiveRuns(availability.byBlock.get('s_79').seats);
    expect(runs.map((r) => r.map((s) => s.row + s.seat).join(' '))).toEqual(expect.arrayContaining(['M38 M39 M40', 'M43 M44 M45', 'N39 N40 N41', 'M47']));
    expect(runs.map((r) => r.length).sort()).toEqual([1, 3, 3, 3]);
  });

  it('puts the longest first, and never joins seats of different rows or across a gap', () => {
    const seat = (row, order) => ({ row, order, seat: String(order) });
    const runs = consecutiveRuns([seat('A', 5), seat('A', 4), seat('A', 2), seat('B', 3), seat('A', 3 + 10)]);
    expect(runs.map((r) => r.length)).toEqual([2, 1, 1, 1]);
    expect(runs[0].map((s) => s.order)).toEqual([5, 4]);
  });

  it('treats a seat with no order as a run of its own', () => {
    expect(consecutiveRuns([{ row: 'A', order: null, seat: '1' }, { row: 'A', order: null, seat: '2' }]).map((r) => r.length)).toEqual([1, 1]);
  });
});

describe('describeData', () => {
  it('says in few words what is known', () => {
    const geometry = parseGeometry(geometryJson);
    const info = describeData(geometry, buildAvailability(geometry, parseFacets(facetsJson)));
    expect(info.geometry).toMatchObject({ blocks: 7, standing: ['GROUND FLOOR STANDING'] });
    expect(info.availability).toMatchObject({ seatsOnSale: 50, resale: 1, blocksWithSeats: 5, standingOnSale: 822, unplaced: 0 });
    expect(describeData(null, null)).toEqual({ geometry: null, availability: null });
  });
});
