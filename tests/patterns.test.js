// The custom badge patterns are regular expressions the user types, so these run a
// range of them through the whole path: typed into the editor, read back, compiled and
// matched against the text of real-looking cards. They also pin down the one mistake
// people actually make: ". *" (with a space) is not ".*".
import { createBadgeEditor } from '../src/lib/badge-editor.js';
import { checkPattern, compileBadges, lintPattern, matchBadges } from '../src/lib/custom-badges.js';
import { buildSectionGroups } from '../src/lib/sections.js';
import { parseTicketCard } from '../src/lib/tickets.js';
import { makeCard } from './helpers/cards.js';

const AISLE = 'Section BLOCKG Row 23 Aisle Seating Ticket €90.75 each';
const PLAIN = 'Section BLOCKG Row 26 Full Price Ticket €80.75 each';
const RESALE = 'Section BLOCKA Row 7 Verified Resale Ticket €50.00 each';
const PRESALE = 'Section BLOCKA Row 7 MCD Presale Ticket €50.00 each';
const SEAT = 'Section BLOCKC Row 5 Seat 12-13 Full Price Ticket €85.00 each';
const STANDING = 'Section STANDING Full Price Ticket €60.00 each';
const ALL = [AISLE, PLAIN, RESALE, PRESALE, SEAT, STANDING];

/** Type `pattern` into a fresh editor, read it back, and say which of `texts` it matches. */
function matching(pattern, texts = ALL) {
  const editor = createBadgeEditor();
  document.body.append(editor.root);
  editor.root.querySelector('.be-add').click();
  const row = editor.root.querySelector('.be-row');
  row.querySelector('.be-label').value = 'Test';
  const input = row.querySelector('.be-pattern');
  input.value = pattern;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const result = editor.read();
  editor.root.remove();
  if (!result.ok) return null;
  const compiled = compileBadges(result.badges);
  return texts.filter((t) => matchBadges(compiled, t).length > 0);
}

describe('what patterns match', () => {
  const table = [
    // plain words, ignoring case
    ['aisle', [AISLE]],
    ['AISLE', [AISLE]],
    ['aIsLe seating', [AISLE]],
    ['Seat ', [SEAT]],
    ['seat', [AISLE, SEAT]], // "Seating" contains "seat" too
    ['standing', [STANDING]],
    // or
    ['aisle|presale', [AISLE, PRESALE]],
    ['aisle|end of row', [AISLE]],
    // dot and star
    ['.*', ALL],
    ['.+', ALL],
    ['aisle.*', [AISLE]],
    ['.*aisle', [AISLE]],
    ['.*aisle.*', [AISLE]],
    ['^.*aisle.*$', [AISLE]],
    ['Row.*Aisle', [AISLE]],
    ['Row 23.*Aisle', [AISLE]],
    ['Section.*Aisle Seating', [AISLE]],
    ['BLOCKG.*Aisle', [AISLE]],
    ['BLOCKG.*Ticket', [AISLE, PLAIN]],
    ['Aisle.*each', [AISLE]],
    ['Aisle.*€', [AISLE]],
    ['Row.*Resale', [RESALE, PRESALE]], // "Presale" contains "resale" (see \\bresale\\b below)
    ['Row.+Ticket', [AISLE, PLAIN, RESALE, PRESALE, SEAT]], // no Row in the standing text
    ['Row .* Ticket', [AISLE, PLAIN, RESALE, PRESALE, SEAT]],
    ['a.sle', [AISLE]],
    ['a..le', [AISLE]],
    ['Aisle.?Seating', [AISLE]],
    // classes, digits, word edges
    ['\\bresale\\b', [RESALE]], // not "presale"
    ['resale', [RESALE, PRESALE]],
    ['\\d\\d\\.75', [AISLE, PLAIN]],
    ['€\\d\\d\\.\\d\\d each', [AISLE, PLAIN, RESALE, PRESALE, SEAT, STANDING]],
    ['€9\\d', [AISLE]],
    ['BLOCK[A-C]', [RESALE, PRESALE, SEAT]],
    ['BLOCK[^A-C]', [AISLE, PLAIN]],
    ['Row [0-9]{2}\\b', [AISLE, PLAIN]],
    ['Row (23|26)\\b', [AISLE, PLAIN]],
    ['Row (2|23)\\b', [AISLE]], // "Row 2" does not end a word in "Row 23"
    ['Row \\d+ Aisle', [AISLE]],
    ['row\\s+23', [AISLE]],
    ['\\s{2,}', []], // the text has single spaces only
    // anchors
    ['^Section', ALL],
    ['^Row', []],
    ['each$', ALL],
    ['Ticket$', []],
    // optional and repeated
    ['seats?', [AISLE, SEAT]],
    ['(very )?full price', [PLAIN, SEAT, STANDING]],
    // characters that need escaping
    ['\\.75', [AISLE, PLAIN]],
    ['90.75', [AISLE]],
    ['90\\.75', [AISLE]],
    ['12-13', [SEAT]],
    ['\\$', []],
    ['€', ALL],
  ];

  it.each(table)('%s', (pattern, expected) => {
    expect(matching(pattern)).toEqual(expected);
  });

  it('keeps a pattern exactly as typed, spaces and all', () => {
    const editor = createBadgeEditor();
    editor.setBadges([{ id: 'a', label: 'A', icon: '', color: 'teal', pattern: ' aisle ' }]);
    expect(editor.read().badges[0].pattern).toBe(' aisle ');
    expect(matching(' aisle ')).toEqual([AISLE]); // spaces on both sides are there in "Row 23 Aisle Seating"
    expect(matching('aisle ')).toEqual([AISLE]);
    expect(matching(' aisle$')).toEqual([]);
  });
});

describe('the ". *" mistake', () => {
  it('with a space it means "any one character, then spaces" — not "anything"', () => {
    expect(matching('. *')).toEqual(ALL); // any character at all
    expect(matching('Row. *Aisle')).toEqual([]); // after "Row" and one character comes "23", not "Aisle"
    expect(matching('Row. *23')).toEqual([AISLE]); // ...but "23" does follow "Row" and one character
    expect(matching('aisle. *seating')).toEqual([AISLE]); // "Aisle" + " " + "Seating"
  });

  it('without the space, it works as intended', () => {
    expect(matching('Row.*Aisle')).toEqual([AISLE]);
    expect(matching('Row 2.*Aisle')).toEqual([AISLE]);
  });

  it('is flagged, so it can be spotted while typing', () => {
    ['Row. *Aisle', '. *', 'a. +b', 'x.  *y', 'x.\t*'].forEach((p) => expect(lintPattern(p)).toContain('space'));
  });

  it('leaves legitimate patterns alone', () => {
    ['.*', 'Row.*Aisle', 'aisle', '\\. *', 'a\\.\\s*b', 'a[. ]*b', 'Row (.*) x', '', null, undefined].forEach((p) => expect(lintPattern(p)).toBeNull());
  });
});

describe('patterns that are not regular expressions', () => {
  it.each(['(', ')', '[', 'aisle(', '*aisle', '+', '?', 'a{2,1}', '(?<n', '\\'])('refuses %s with a readable reason', (pattern) => {
    expect(matching(pattern)).toBeNull();
    const { error } = checkPattern(pattern);
    expect(error).toMatch(/^Not a valid pattern \(.+\)\.$/);
    expect(error).not.toContain('Invalid regular expression');
  });

  it('a pattern that is valid but matches nothing is not an error', () => {
    expect(matching('zzz')).toEqual([]);
  });
});

describe('the title Section View lists a ticket under', () => {
  // What the list shows ("Row 23 (Aisle Seating Ticket)") is not quite Ticketmaster's text, which has no brackets.
  const text = 'Section BLOCKG Row 23 Aisle Seating Ticket €90.75 each';
  const title = 'Row 23 • Seat 5 (Aisle Seating Ticket)';
  const matches = (pattern) => matchBadges(compileBadges([{ id: 'x1', label: 'X', icon: '', color: 'teal', pattern }]), [text, title]).length === 1;

  it('(Aisle Seating Ticket) is a group, so it matches the words', () => {
    expect(matches('(Aisle Seating Ticket)')).toBe(true);
    expect(matchBadges(compileBadges([{ id: 'x1', label: 'X', icon: '', color: 'teal', pattern: '(Aisle Seating Ticket)' }]), text)).toHaveLength(1);
  });

  it('\\(Aisle Seating Ticket\\) asks for real brackets: only the title has them, and it now matches', () => {
    expect(matchBadges(compileBadges([{ id: 'x1', label: 'X', icon: '', color: 'teal', pattern: '\\(Aisle Seating Ticket\\)' }]), text)).toEqual([]);
    expect(matches('\\(Aisle Seating Ticket\\)')).toBe(true);
    expect(matches('Seat 5 \\(Aisle')).toBe(true);
  });

  it('patterns that anchor on the way the list starts a ticket work too', () => {
    expect(matches('^Row 23')).toBe(true);
    expect(matches('^Section BLOCKG')).toBe(true); // ...and on the way Ticketmaster does
    expect(matches('^Aisle')).toBe(false);
    expect(matches('Ticket\\)$')).toBe(true);
  });

  it('never joins the two, so a pattern cannot match across them', () => {
    expect(matches('each.*Row 23')).toBe(false);
    expect(matches('each Row 23')).toBe(false);
  });
});

describe('matching real card markup', () => {
  const tickets = () => [
    parseTicketCard(makeCard({ section: 'BLOCKG', row: 23, price: 90.75, packageTitle: 'Aisle Seating Ticket' })),
    parseTicketCard(makeCard({ section: 'BLOCKG', row: 26, price: 80.75 })),
    parseTicketCard(makeCard({ section: 'BLOCKA', row: 7, price: 50, resale: true })),
  ];
  const flagged = (pattern) => {
    const [badge] = compileBadges([{ id: 'x1', label: 'X', icon: '', color: 'teal', pattern }]);
    const { groups } = buildSectionGroups(tickets(), { customBadges: [badge] });
    return groups.flatMap((g) => g.tickets).filter((t) => t.badges['custom:x1']).map((t) => t.row).sort((a, b) => a - b);
  };

  it('finds what the card says, wherever it says it', () => {
    expect(flagged('aisle')).toEqual([23]);
    expect(flagged('Row.*Aisle')).toEqual([23]);
    expect(flagged('BLOCKG')).toEqual([23, 26]);
    expect(flagged('resale')).toEqual([7]);
    expect(flagged('Row 7 ')).toEqual([7]);
    expect(flagged('.*')).toEqual([7, 23, 26]);
    expect(flagged('Row. *Aisle')).toEqual([]); // the mistake
  });

  it('finds what the list shows too, brackets and all', () => {
    expect(flagged('\\(Aisle Seating Ticket\\)')).toEqual([23]);
    expect(flagged('(Aisle Seating Ticket)')).toEqual([23]);
    expect(flagged('^Row 23 \\(')).toEqual([23]);
  });
});
