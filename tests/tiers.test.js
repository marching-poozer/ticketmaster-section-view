import { describe, expect, it } from 'vitest';
import { buildTierModel, tierKeysFor, tierLabel, tierWord, wordsIn } from '../src/lib/tiers.js';
import { STANDING_ROW } from '../src/lib/constants.js';

describe('tierWord', () => {
  it('finds the tier in the words Ticketmaster uses: a block name, a description, a code with its words', () => {
    expect(tierWord('NORTH LOWER 1')).toBe('lower');
    expect(tierWord('NORTH UPPER TIER')).toBe('upper');
    expect(tierWord('WEST MIDDLE 7')).toBe('middle');
    expect(tierWord('EAST MID TIER')).toBe('middle'); // the list says MID, the map MIDDLE
    expect(tierWord('lower tier')).toBe('lower');
  });

  it('says nothing for text without a tier word, and does not find one inside another word', () => {
    ['BLOCK E', 'STANDING-OVER 14\'S ONLY', 'GROUND FLOOR STANDING', 'ACCESSIBLE', 'WESTT7', 'NTHL3', '', null, undefined, 'MIDNIGHT', 'UPPERCUT', 'SLOWER'].forEach((text) => expect(tierWord(text)).toBeNull());
  });
});

describe('what tiers are called', () => {
  it('labels the words, and numbered tiers', () => {
    expect(tierLabel('lower')).toBe('Lower');
    expect(tierLabel('middle')).toBe('Middle');
    expect(tierLabel('upper')).toBe('Upper');
    expect(tierLabel('tier-3')).toBe('Tier 3');
  });

  it('names a venue\'s tiers by how many it has, from the floor up: two are Lower and Upper, three add the Middle, more are numbered', () => {
    expect(tierKeysFor(2)).toEqual(['lower', 'upper']);
    expect(tierKeysFor(3)).toEqual(['lower', 'middle', 'upper']);
    expect(tierKeysFor(4)).toEqual(['tier-1', 'tier-2', 'tier-3', 'tier-4']);
  });
});

describe('a venue with no map, or no words: the rows the user gave as the first row of each tier are the tiers', () => {
  it('has Lower and Upper for two starts (3Arena: Row 21 and Row 33)', () => {
    const model = buildTierModel({ firstRows: [21, 33] });
    expect(model.mode).toBe('rows');
    expect(model.tiers).toEqual([{ key: 'lower', label: 'Lower' }, { key: 'upper', label: 'Upper' }]);
    expect(model.ofRank(21)).toBe('lower');
    expect(model.ofRank(32)).toBe('lower');
    expect(model.ofRank(33)).toBe('upper');
    expect(model.ofRank(60)).toBe('upper');
  });

  it('has Lower, Middle and Upper for three (the middle being optional: two starts just have no middle)', () => {
    const model = buildTierModel({ firstRows: ['A', 'L', 'S'] }); // the O2: lower A-K, middle L-R, upper S-Y
    expect(model.keys).toEqual(['lower', 'middle', 'upper']);
    expect(['A', 'K', 'L', 'R', 'S', 'Y'].map((row) => model.ofSeat({ row }))).toEqual(['lower', 'lower', 'middle', 'middle', 'upper', 'upper']);
  });

  it('numbers the tiers when there are more than three', () => {
    const model = buildTierModel({ firstRows: [1, 10, 20, 30] });
    expect(model.keys).toEqual(['tier-1', 'tier-2', 'tier-3', 'tier-4']);
    expect(model.ofRank(25)).toBe('tier-3');
  });

  it('puts a row below the first start in the first tier (the list counts from an implicit tier there too)', () => {
    expect(buildTierModel({ firstRows: [21, 33] }).ofRank(5)).toBe('lower');
  });

  it('puts no ticket in a tier that has no row: standing, a VIP package', () => {
    const model = buildTierModel({ firstRows: [21, 33] });
    expect(model.ofRank(STANDING_ROW)).toBeNull();
    expect(model.ofRank(0)).toBeNull();
    expect(model.ofTicket({ row: STANDING_ROW })).toBeNull();
    expect(model.ofTicket({ row: 30, type: 'vip' })).toBeNull();
    expect(model.ofTicket({ row: 30 })).toBe('lower');
  });

  it('ignores starts that are not rows and repeats, and has no tiers with fewer than two', () => {
    expect(buildTierModel({ firstRows: [1] })).toBeNull();
    expect(buildTierModel({ firstRows: [21, 21] })).toBeNull();
    expect(buildTierModel({ firstRows: ['GA', 'x1', 5] })).toBeNull();
    expect(buildTierModel({ firstRows: [] })).toBeNull();
    expect(buildTierModel({})).toBeNull();
    expect(buildTierModel(null)).toBeNull();
    expect(buildTierModel({ firstRows: Array.from({ length: 12 }, (_, i) => i * 10 + 1) })).toBeNull(); // that many is not tiers
  });
});

describe('a venue whose names say the tier (the O2 Belfast)', () => {
  const words = new Set(['lower', 'middle', 'upper']);

  it('has the tiers the words found, from the floor up', () => {
    expect(buildTierModel({ firstRows: [1], words }).keys).toEqual(['lower', 'middle', 'upper']);
    expect(buildTierModel({ firstRows: [1], words: new Set(['upper', 'lower']) }).keys).toEqual(['lower', 'upper']);
  });

  it('puts a ticket in the tier its description says', () => {
    const model = buildTierModel({ firstRows: [1], words });
    expect(model.mode).toBe('words');
    expect(model.ofTicket({ description: 'NORTH UPPER TIER', row: 3 })).toBe('upper');
    expect(model.ofTicket({ description: 'EAST MID TIER', row: 3 })).toBe('middle');
    expect(model.ofTicket({ description: "STANDING-OVER 14'S ONLY", row: STANDING_ROW })).toBeNull();
    expect(model.ofTicket({ description: 'NORTH UPPER TIER', type: 'vip' })).toBeNull();
    expect(model.ofTicket({ row: 3 })).toBeNull(); // a ticket read from a card has no description
  });

  it('puts a seat on the map in the tier of its block', () => {
    const model = buildTierModel({ firstRows: [1], words, blockTiers: new Map([['s_5', 'lower'], ['s_79', 'middle']]) });
    expect(model.ofSeat({ block: 's_5', row: 'C' })).toBe('lower');
    expect(model.ofSeat({ block: 's_79', row: 'M' })).toBe('middle');
    expect(model.ofSeat({ block: 's_107', row: 'T' })).toBeNull(); // a block in no tier (the terrace)
  });

  it('has no tiers for one word alone, or none', () => {
    expect(buildTierModel({ firstRows: [1], words: new Set(['upper']) })).toBeNull();
    expect(buildTierModel({ firstRows: [1], words: new Set() })).toBeNull();
  });

  it('prefers the rows the user gave as the first rows of tiers: they are the user\'s word on it', () => {
    const model = buildTierModel({ firstRows: ['A', 'S'], words });
    expect(model.mode).toBe('rows');
    expect(model.keys).toEqual(['lower', 'upper']);
  });
});

describe('wordsIn', () => {
  it('collects the tier words of some texts', () => {
    expect(wordsIn(['NORTH LOWER 1', 'BLOCK E', 'EAST MID TIER', null, 'NORTH LOWER 2'])).toEqual(new Set(['lower', 'middle']));
    expect(wordsIn([])).toEqual(new Set());
  });
});
