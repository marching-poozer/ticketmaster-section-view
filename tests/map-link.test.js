import fs from 'node:fs';
import path from 'node:path';
import { blockKeys, blocksToDim, keyOf, linkBlocks, sectionKeys, sectionsOf } from '../src/lib/map-link.js';
import { picksToTickets, segmentIdOf } from '../src/lib/quickpicks.js';

const o2 = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/o2-map-blocks.json'), 'utf8'));
const real = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/quickpicks-resale-standing.json'), 'utf8'));
const blockIndex = (name, id) => o2.blocks.findIndex((b) => b.name === name && (!id || b.id === id));

describe('keyOf', () => {
  it('keeps upper case letters and digits only', () => {
    expect(keyOf('West Lower 8')).toBe('WESTLOWER8');
    expect(keyOf("STANDING-OVER 14'S ONLY")).toBe('STANDINGOVER14SONLY');
    expect(keyOf('s_112')).toBe('S112');
    expect(keyOf(null)).toBe('');
    expect(keyOf(undefined)).toBe('');
  });
});

describe('the segment id in a standing pick\'s picture address', () => {
  it('is read from segmentIds', () => {
    expect(segmentIdOf('image?systemId=HOST_UK&segmentIds=s_112')).toBe('s_112');
    expect(segmentIdOf('image?segmentIds=s_1%2Cs_2')).toBe('s_1');
  });

  it('is empty when there is none (a seat\'s picture names its section instead)', () => {
    expect(segmentIdOf('image?systemId=HOST_UK&sectionNames=NTHU3&placeId=JZKE')).toBe('');
    expect(segmentIdOf(undefined)).toBe('');
    expect(segmentIdOf('')).toBe('');
  });
});

describe('what a section can be called on the map', () => {
  const tickets = picksToTickets(real, { currency: '€' });
  const north = tickets.filter((t) => t.section === 'NTHU3');
  const standing = tickets.filter((t) => t.section === "STANDING-OVER 14'S ONLY");

  it('a seat section: its name, and its description with its number', () => {
    const keys = Object.fromEntries(sectionKeys('NTHU3', north).map((k) => [k.key, k.weight]));
    expect(keys.NTHU3).toBe(3);
    expect(keys.NORTHUPPER3).toBe(2); // "NORTH UPPER TIER" + 3
  });

  it('standing: the block id its picture names is the strongest key', () => {
    const keys = Object.fromEntries(sectionKeys("STANDING-OVER 14'S ONLY", standing).map((k) => [k.key, k.weight]));
    expect(keys.S112).toBe(4);
  });

  it('a section with no tickets has only its own name', () => {
    expect(sectionKeys('WESTT7', [])).toEqual([{ key: 'WESTT7', weight: 3 }]);
  });
});

describe('linking The O2 Belfast\'s map to its sections', () => {
  const tickets = picksToTickets(real, { currency: '€' });
  const sections = sectionsOf(tickets);

  it('knows the blocks the paste had', () => {
    expect(o2.blocks.length).toBeGreaterThan(60);
    expect(blockKeys({ id: 's_38', name: 'WEST LOWER 8' })).toEqual(['WESTLOWER8', 'S38']);
  });

  it('links seats by description + number: NTHU3 is NORTH UPPER 3, WESTU1 is WEST UPPER 1, WESTU7 is WEST UPPER 7', () => {
    const links = linkBlocks(o2.blocks, sections);
    expect(links.blockToSection.get(blockIndex('NORTH UPPER 3'))).toBe('NTHU3');
    expect(links.blockToSection.get(blockIndex('WEST UPPER 1'))).toBe('WESTU1');
    expect(links.blockToSection.get(blockIndex('WEST UPPER 7'))).toBe('WESTU7');
    expect(links.sectionToBlocks.get('NTHU3')).toEqual([blockIndex('NORTH UPPER 3')]);
  });

  it('links standing by block id: GROUND FLOOR STANDING is s_112', () => {
    const links = linkBlocks(o2.blocks, sections);
    expect(links.blockToSection.get(blockIndex('GROUND FLOOR STANDING', 's_112'))).toBe("STANDING-OVER 14'S ONLY");
  });

  it('leaves alone the blocks no section is called after (nothing is linked by guessing)', () => {
    const links = linkBlocks(o2.blocks, sections);
    expect(links.blockToSection.get(blockIndex('NORTH UPPER 2'))).toBeUndefined();
    expect(links.blockToSection.get(blockIndex('SWEST'))).toBeUndefined();
    expect([...links.blockToSection.values()].sort()).toEqual(["NTHU3", "STANDING-OVER 14'S ONLY", 'WESTU1', 'WESTU7'].sort());
  });

  it('links a section named just like its block (the accessible platforms: WESTT7)', () => {
    const links = linkBlocks(o2.blocks, [{ name: 'WESTT7', tickets: [] }]);
    expect(links.blockToSection.get(blockIndex('WESTT7'))).toBe('WESTT7');
  });

  it('links by the block\'s id when that is the section\'s name (EASTU2 is "EAST UPPER 2")', () => {
    const links = linkBlocks(o2.blocks, [{ name: 'EASTU2', tickets: [] }]);
    expect(links.blockToSection.get(blockIndex('EAST UPPER 2'))).toBe('EASTU2');
  });

  it('several blocks with one name are one section (the ACCESSIBLE ones)', () => {
    const links = linkBlocks(o2.blocks, [{ name: 'ACCESSIBLE', tickets: [] }]);
    expect(links.sectionToBlocks.get('ACCESSIBLE').length).toBeGreaterThan(3);
  });

  it('a block takes the section that matches it best', () => {
    const sectionsTwo = [
      { name: 'S112', tickets: [] }, // the same as the block\'s id: a name match
      { name: 'STAND', tickets: [{ segmentId: 's_112', section: 'STAND', originalSection: 'STAND' }] }, // the id its picture names: stronger
    ];
    const links = linkBlocks(o2.blocks, sectionsTwo);
    expect(links.blockToSection.get(blockIndex('GROUND FLOOR STANDING'))).toBe('STAND');
  });

  it('every block of the real map links to at most one section, and the numbers line up for a whole venue', () => {
    // every seat section of the map, as the API would call it: NTH/STH/EAST/WEST + L/M/U + number, with its description
    const compass = { NORTH: 'NTH', SOUTH: 'STH', EAST: 'EAST', WEST: 'WEST' };
    const seatBlocks = o2.blocks.filter((b) => /^(NORTH|SOUTH|EAST|WEST) (LOWER|MIDDLE|UPPER) \d$/.test(b.name));
    const all = seatBlocks.map((b) => {
      const [dir, tier, n] = b.name.split(' ');
      const name = compass[dir] + tier[0] + n;
      return { name, tickets: [{ section: name, originalSection: name, description: dir + ' ' + tier + ' TIER' }] };
    });
    const links = linkBlocks(o2.blocks, all);
    seatBlocks.forEach((b) => {
      const [dir, tier, n] = b.name.split(' ');
      expect(links.blockToSection.get(o2.blocks.indexOf(b))).toBe(compass[dir] + tier[0] + n);
    });
    expect(links.blockToSection.size).toBe(seatBlocks.length);
  });
});

describe('sectionsOf', () => {
  it('groups tickets by section in order, and leaves out VIP packages (they are not on the map)', () => {
    const out = sectionsOf([
      { section: 'B', type: 'standard' }, { section: 'A', type: 'standard' }, { section: 'B', type: 'standard' }, { section: 'VIP PACKAGES', type: 'vip' },
    ]);
    expect(out.map((s) => [s.name, s.tickets.length])).toEqual([['B', 2], ['A', 1]]);
  });
});

describe('which blocks to dim', () => {
  const blocks = [
    { id: 'a', name: 'A', active: true },
    { id: 'b', name: 'B', active: true },
    { id: 'c', name: 'C', active: false },
    { id: 'd', name: 'D', active: true },
  ];
  const links = { blockToSection: new Map([[0, 'A'], [1, 'B'], [2, 'C']]), sectionToBlocks: new Map() };

  it('dims an available block whose section has nothing left after the filters', () => {
    expect(blocksToDim(blocks, links, new Set(['A']))).toEqual([1]);
  });

  it('dims nothing when every section still has tickets', () => {
    expect(blocksToDim(blocks, links, new Set(['A', 'B', 'C']))).toEqual([]);
  });

  it('does not touch what the map already shows as unavailable, or what it could not link', () => {
    expect(blocksToDim(blocks, links, new Set())).toEqual([0, 1]); // C is already grey; D is not linked: not knowing is not "empty"
  });
});
