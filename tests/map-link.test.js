import fs from 'node:fs';
import path from 'node:path';
import { abbreviates, blockKeys, blocksToDim, keyOf, linkBlocks, sectionKeys, sectionsOf } from '../src/lib/map-link.js';
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

describe('a section code that abbreviates a block\'s name', () => {
  it.each([
    ['NTHM3', 'NORTH MIDDLE 3'],
    ['STHL5', 'SOUTH LOWER 5'],
    ['EASTM1', 'EAST MIDDLE 1'],
    ['WESTU7', 'WEST UPPER 7'],
    ['NTHU3', 'NORTH UPPER 3'],
    ['EASTL8', 'East Lower 8'],
    ['nthm2', 'NORTH MIDDLE 2'],
  ])('%s is %s', (code, name) => {
    expect(abbreviates(code, name)).toBe(true);
  });

  it.each([
    ['NTHM3', 'NORTH MIDDLE 4', 'another number'],
    ['NTHM3', 'NORTH UPPER 3', 'another tier'],
    ['NTHM3', 'SOUTH MIDDLE 3', 'another side'],
    ['NTHM', 'NORTH MIDDLE 3', 'no number, against a name with one'],
    ['NTHM3', 'NORTH MIDDLE', 'a number, against a name with none'],
    ['NTHM3', 'NORTH 3', 'one word: too easy to find a code in'],
    ['', 'NORTH MIDDLE 3', 'nothing'],
    ['NTHM3', '', 'no name'],
    ['STANDING', 'GROUND FLOOR STANDING', 'does not start with the first word\'s letter'],
    ['NMT3', 'NORTH MIDDLE 3', 'letters out of order'],
  ])('%s is not %s (%s)', (code, name) => {
    expect(abbreviates(code, name)).toBe(false);
  });

  it('copes with nothing at all', () => {
    expect(abbreviates(null, null)).toBe(false);
    expect(abbreviates(undefined, 'NORTH MIDDLE 3')).toBe(false);
  });
});

describe('linking the whole of The O2 Belfast\'s map with no help from the tickets', () => {
  // Every seat block, as the API would call it: NTH / STH / EAST / WEST + L / M / U + number. No description, no ticket: just the codes.
  const compass = { NORTH: 'NTH', SOUTH: 'STH', EAST: 'EAST', WEST: 'WEST' };
  const seatBlocks = o2.blocks.filter((b) => /^(NORTH|SOUTH|EAST|WEST) (LOWER|MIDDLE|UPPER) \d$/.test(b.name));
  const codeOf = (b) => { const [dir, tier, n] = b.name.split(' '); return compass[dir] + tier[0] + n; };
  const codes = seatBlocks.map((b) => ({ name: codeOf(b), tickets: [] }));

  it('links every one, the middle tier too (those did not link by description)', () => {
    const links = linkBlocks(o2.blocks, codes);
    seatBlocks.forEach((b) => expect(links.blockToSection.get(o2.blocks.indexOf(b))).toBe(codeOf(b)));
    expect(links.blockToSection.size).toBe(seatBlocks.length);
    expect(seatBlocks.filter((b) => / MIDDLE /.test(b.name)).length).toBeGreaterThan(10);
  });

  it('does not mix them up: each code is on its own block', () => {
    const links = linkBlocks(o2.blocks, codes);
    const sectionsUsed = [...links.blockToSection.values()];
    expect(new Set(sectionsUsed).size).toBe(sectionsUsed.length);
  });

  it('still prefers a match by name or id: the strong keys come first', () => {
    const withTicket = [{ name: 'NTHU3', tickets: [{ section: 'NTHU3', originalSection: 'NTHU3', description: 'NORTH UPPER TIER' }] }, ...codes.filter((c) => c.name !== 'NTHU3')];
    const links = linkBlocks(o2.blocks, withTicket);
    expect(links.blockToSection.get(blockIndex('NORTH UPPER 3'))).toBe('NTHU3');
  });

  it('does not guess when two sections could be the same block', () => {
    const links = linkBlocks(o2.blocks, [{ name: 'NTHM3', tickets: [] }, { name: 'NTM3', tickets: [] }]); // both abbreviate NORTH MIDDLE 3
    expect(links.blockToSection.get(blockIndex('NORTH MIDDLE 3'))).toBeUndefined();
  });

  it('does not link a standing or accessible block by abbreviation', () => {
    const links = linkBlocks(o2.blocks, [{ name: "STANDING-OVER 14'S ONLY", tickets: [] }, { name: 'STAND', tickets: [] }]);
    expect(links.blockToSection.size).toBe(0);
  });
});

describe('a section whose description points at another block (the accessible platforms)', () => {
  const ticket = (name, description) => ({ section: name, originalSection: name, description });
  const sections = [
    { name: 'WESTT7', tickets: [ticket('WESTT7', 'WEST UPPER TIER')] }, // an accessible platform, described like the upper tier it is in
    { name: 'WESTU7', tickets: [ticket('WESTU7', 'WEST UPPER TIER')] },
  ];

  it('keeps its own block, and does not take the block of the section it is described like', () => {
    const links = linkBlocks(o2.blocks, sections);
    expect(links.blockToSection.get(blockIndex('WESTT7'))).toBe('WESTT7');
    expect(links.blockToSection.get(blockIndex('WEST UPPER 7'))).toBe('WESTU7');
    expect(links.sectionToBlocks.get('WESTT7')).toEqual([blockIndex('WESTT7')]);
  });

  it('whatever order the sections come in', () => {
    const links = linkBlocks(o2.blocks, [...sections].reverse());
    expect(links.blockToSection.get(blockIndex('WESTT7'))).toBe('WESTT7');
    expect(links.blockToSection.get(blockIndex('WEST UPPER 7'))).toBe('WESTU7');
  });

  it('a section that has its own block does not also claim one by description', () => {
    const links = linkBlocks(o2.blocks, [sections[0]]); // WESTT7 alone: it is no reason to call WEST UPPER 7 its block
    expect(links.blockToSection.get(blockIndex('WEST UPPER 7'))).toBeUndefined();
  });
});

describe('the middle tier, whatever its tickets say about it', () => {
  it('links by abbreviation when the description is no help (the real one was not)', () => {
    const odd = (name, description) => ({ name, tickets: [{ section: name, originalSection: name, description }] });
    const links = linkBlocks(o2.blocks, [odd('NTHM2', 'NORTH MEZZANINE'), odd('STHM1', ''), odd('EASTM8', 'LEVEL 2 EAST'), odd('WESTM3', 'something else')]);
    expect(links.blockToSection.get(blockIndex('NORTH MIDDLE 2'))).toBe('NTHM2');
    expect(links.blockToSection.get(blockIndex('SOUTH MIDDLE 1'))).toBe('STHM1');
    expect(links.blockToSection.get(blockIndex('EAST MIDDLE 8'))).toBe('EASTM8');
    expect(links.blockToSection.get(blockIndex('WEST MIDDLE 3'))).toBe('WESTM3');
  });

  it('a description that fits and an abbreviation that fits make the surest link of the guesses', () => {
    const links = linkBlocks(o2.blocks, [
      { name: 'NTHM3', tickets: [{ section: 'NTHM3', originalSection: 'NTHM3', description: 'NORTH MIDDLE TIER' }] },
      { name: 'NTM3', tickets: [{ section: 'NTM3', originalSection: 'NTM3', description: '' }] }, // abbreviates it too, but nothing else says so
    ]);
    expect(links.blockToSection.get(blockIndex('NORTH MIDDLE 3'))).toBe('NTHM3');
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
