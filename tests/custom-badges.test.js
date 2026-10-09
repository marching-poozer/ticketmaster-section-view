import {
  BADGE_COLORS,
  MAX_BADGES,
  badgeKey,
  badgeText,
  checkPattern,
  colorPair,
  compileBadges,
  isBadgeKey,
  matchBadges,
  matchesAny,
  newBadgeId,
  normalizeBadge,
  normalizeBadges,
} from '../src/lib/custom-badges.js';

const aisle = { id: 'aisle1', label: 'Aisle', icon: '🚶', color: 'blue', pattern: 'aisle' };

describe('checkPattern', () => {
  it('compiles a pattern case-insensitively', () => {
    const { regex, error } = checkPattern('aisle|end of row');
    expect(error).toBeUndefined();
    expect(regex.test('Row 23 (AISLE Seating Ticket)')).toBe(true);
    expect(regex.test('Standard Seating')).toBe(false);
  });

  it('refuses an empty pattern, one that is too long and one that is not a regular expression', () => {
    expect(checkPattern('').error).toContain('Enter a pattern');
    expect(checkPattern('   ').error).toContain('Enter a pattern');
    expect(checkPattern(undefined).error).toContain('Enter a pattern');
    expect(checkPattern('a'.repeat(201)).error).toContain('200');
    const bad = checkPattern('(aisle');
    expect(bad.error).toMatch(/^Not a valid pattern \(.*\)\.$/);
    expect(bad.error).not.toContain('Invalid regular expression');
    expect(checkPattern('[').error).toContain('Not a valid pattern');
  });
});

describe('normalizeBadge', () => {
  it('keeps a valid badge', () => {
    expect(normalizeBadge(aisle)).toEqual(aisle);
  });

  it('fills in the icon and colour when they are missing, but keeps an icon cleared on purpose', () => {
    expect(normalizeBadge({ id: 'a', label: 'Aisle', pattern: 'aisle' })).toEqual({ id: 'a', label: 'Aisle', icon: '🔖', color: 'teal', pattern: 'aisle' });
    expect(normalizeBadge({ id: 'a', label: 'Aisle', icon: '', color: 'puce', pattern: 'aisle' })).toMatchObject({ icon: '', color: 'teal' });
  });

  it('tidies the label and icon', () => {
    const b = normalizeBadge({ id: 'a', label: '  A very long badge name indeed  ', icon: ' 🚶🚶🚶🚶🚶 ', pattern: 'x' });
    expect(b.label).toHaveLength(24);
    expect(b.label.startsWith('A very long badge name')).toBe(true);
    expect(Array.from(b.icon)).toHaveLength(3);
  });

  it('rejects anything unusable', () => {
    expect(normalizeBadge(null)).toBeNull();
    expect(normalizeBadge('aisle')).toBeNull();
    expect(normalizeBadge({ ...aisle, id: '' })).toBeNull();
    expect(normalizeBadge({ ...aisle, id: 'Has Spaces' })).toBeNull();
    expect(normalizeBadge({ ...aisle, label: '   ' })).toBeNull();
    expect(normalizeBadge({ ...aisle, pattern: '(' })).toBeNull();
    expect(normalizeBadge({ ...aisle, pattern: 5 })).toBeNull();
  });
});

describe('normalizeBadges', () => {
  it('keeps the valid ones, in order, and drops repeated ids', () => {
    const second = { ...aisle, id: 'wc', label: 'Wheelchair', pattern: 'wheelchair' };
    expect(normalizeBadges([aisle, { nope: 1 }, second, { ...aisle, label: 'Again' }])).toEqual([aisle, second]);
  });

  it('is empty for anything that is not a list', () => {
    expect(normalizeBadges(undefined)).toEqual([]);
    expect(normalizeBadges('aisle')).toEqual([]);
    expect(normalizeBadges({})).toEqual([]);
  });

  it('stops at the limit', () => {
    const many = Array.from({ length: MAX_BADGES + 5 }, (_, i) => ({ ...aisle, id: 'b' + i }));
    expect(normalizeBadges(many)).toHaveLength(MAX_BADGES);
  });
});

describe('keys and ids', () => {
  it('builds and recognises filter keys', () => {
    expect(badgeKey('abc')).toBe('custom:abc');
    expect(isBadgeKey('custom:abc123')).toBe(true);
    ['custom:', 'custom:A b', 'resale', 'custom', null, 3].forEach((k) => expect(isBadgeKey(k)).toBe(false));
  });

  it('makes ids that are valid keys and not already taken', () => {
    const taken = new Set();
    for (let i = 0; i < 50; i++) {
      const id = newBadgeId(taken);
      expect(isBadgeKey(badgeKey(id))).toBe(true);
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
  });
});

describe('presentation', () => {
  it('shows the icon and the name', () => {
    expect(badgeText(aisle)).toBe('🚶 Aisle');
    expect(badgeText({ ...aisle, icon: '' })).toBe('Aisle');
  });

  it('has a colour pair per name, and a default for unknown names', () => {
    Object.keys(BADGE_COLORS).forEach((name) => expect(colorPair(name)).toEqual(BADGE_COLORS[name]));
    expect(colorPair('nonsense')).toEqual(BADGE_COLORS.teal);
  });
});

describe('compileBadges / matchBadges', () => {
  it('compiles the global badges and then the venue\'s', () => {
    const venue = { ...aisle, id: 'v1', label: 'Restricted', pattern: 'restricted view' };
    const compiled = compileBadges([aisle], [venue]);
    expect(compiled.map((b) => b.key)).toEqual(['custom:aisle1', 'custom:v1']);
    expect(compiled[0]).toMatchObject({ text: '🚶 Aisle', pattern: 'aisle' });
    expect(compiled[0].regex).toBeInstanceOf(RegExp);
  });

  it('keeps the first of a repeated id, and ignores invalid badges and missing lists', () => {
    const compiled = compileBadges([aisle, { id: 'bad', label: 'X', pattern: '(' }], undefined, [{ ...aisle, label: 'Dupe' }]);
    expect(compiled.map((b) => b.text)).toEqual(['🚶 Aisle']);
  });

  it('reports which badges a ticket\'s text matches, as plain data', () => {
    const compiled = compileBadges([aisle, { id: 'wc', label: 'Wheelchair', icon: '♿', color: 'green', pattern: 'wheelchair' }]);
    expect(matchBadges(compiled, 'Row 23 Aisle Seating Ticket')).toEqual([{ key: 'custom:aisle1', text: '🚶 Aisle', color: 'blue', pattern: 'aisle' }]);
    expect(matchBadges(compiled, 'Standard')).toEqual([]);
    expect(matchBadges(compiled, undefined)).toEqual([]);
  });

  it('matches a ticket if any of its texts do (its text on Ticketmaster, its title in Section View)', () => {
    const compiled = compileBadges([{ id: 'p', label: 'Paren', icon: '', color: 'teal', pattern: '\\(aisle seating ticket\\)' }]);
    const text = 'Section BLOCKG Row 23 Aisle Seating Ticket €90.75 each';
    const title = 'Row 23 (Aisle Seating Ticket)';
    expect(matchBadges(compiled, text)).toEqual([]);
    expect(matchBadges(compiled, [text, title])).toHaveLength(1);
    expect(matchBadges(compiled, [text, undefined, ''])).toEqual([]);
  });

  it('tries each text on its own, so a pattern never reaches from one into the next', () => {
    const { regex } = checkPattern('Section.*\\(Aisle');
    expect(matchesAny(regex, ['Section BLOCKG Row 23', 'Row 23 (Aisle Seating Ticket)'])).toBe(false);
    expect(matchesAny(regex, ['Section BLOCKG (Aisle'])).toBe(true);
    expect(matchesAny(regex, [])).toBe(false);
    expect(matchesAny(regex, undefined)).toBe(false);
  });

  it('can be run over and over (no regex state is kept between tickets)', () => {
    const compiled = compileBadges([aisle]);
    for (let i = 0; i < 4; i++) expect(matchBadges(compiled, 'Aisle')).toHaveLength(1);
  });
});
