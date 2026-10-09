import { createBadgeEditor } from '../src/lib/badge-editor.js';
import { MAX_BADGES } from '../src/lib/custom-badges.js';

const aisle = { id: 'aisle1', label: 'Aisle', icon: '🚶', color: 'blue', pattern: 'aisle' };

function make(badges) {
  const editor = createBadgeEditor();
  document.body.append(editor.root);
  if (badges) editor.setBadges(badges);
  const rows = () => [...editor.root.querySelectorAll('.be-row')];
  const field = (row, cls) => row.querySelector('.' + cls);
  const type = (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const add = () => editor.root.querySelector('.be-add').click();
  return { editor, rows, field, type, add };
}

describe('badge editor', () => {
  it('starts empty, with a button to add a badge', () => {
    const { editor, rows } = make();
    expect(rows()).toHaveLength(0);
    expect(editor.read()).toEqual({ ok: true, badges: [] });
    expect(editor.root.querySelector('.be-add').textContent).toBe('+ Add badge');
  });

  it('shows saved badges in their fields', () => {
    const { rows, field } = make([aisle]);
    expect(rows()).toHaveLength(1);
    expect(field(rows()[0], 'be-icon').value).toBe('🚶');
    expect(field(rows()[0], 'be-label').value).toBe('Aisle');
    expect(field(rows()[0], 'be-pattern').value).toBe('aisle');
    expect(field(rows()[0], 'be-color').value).toBe('blue');
  });

  it('reads back what is there, keeping each badge\'s id', () => {
    const { editor } = make([aisle]);
    expect(editor.read()).toEqual({ ok: true, badges: [aisle] });
  });

  it('adds a badge with a fresh id, focusing its name', () => {
    const { editor, rows, field, type, add } = make([aisle]);
    add();
    expect(rows()).toHaveLength(2);
    expect(document.activeElement).toBe(field(rows()[1], 'be-label'));

    type(field(rows()[1], 'be-label'), 'Wheelchair');
    type(field(rows()[1], 'be-pattern'), 'wheelchair|accessible');
    field(rows()[1], 'be-color').value = 'green';
    const result = editor.read();
    expect(result.ok).toBe(true);
    expect(result.badges).toHaveLength(2);
    expect(result.badges[1]).toMatchObject({ label: 'Wheelchair', pattern: 'wheelchair|accessible', color: 'green', icon: '🔖' });
    expect(result.badges[1].id).not.toBe(aisle.id);
  });

  it('ignores a row left completely blank', () => {
    const { editor, add, rows } = make([aisle]);
    add();
    expect(rows()).toHaveLength(2);
    expect(editor.read()).toEqual({ ok: true, badges: [aisle] });
  });

  it('removes a badge', () => {
    const { editor, rows, field } = make([aisle, { ...aisle, id: 'two', label: 'Two', pattern: 'two' }]);
    field(rows()[0], 'be-remove').click();
    expect(rows()).toHaveLength(1);
    expect(editor.read().badges.map((b) => b.id)).toEqual(['two']);
  });

  it('marks a pattern that is not a regular expression, and gives nothing to save', () => {
    const { editor, rows, field, type } = make([aisle]);
    type(field(rows()[0], 'be-pattern'), '(aisle');
    expect(editor.read()).toEqual({ ok: false });
    expect(field(rows()[0], 'be-error').textContent).toContain('Not a valid pattern');
    expect(field(rows()[0], 'be-pattern').getAttribute('aria-invalid')).toBe('true');
  });

  it('marks a badge without a name, and one without a pattern', () => {
    const { editor, rows, field, type } = make([aisle, { ...aisle, id: 'two', label: 'Two', pattern: 'two' }]);
    type(field(rows()[0], 'be-label'), '');
    type(field(rows()[1], 'be-pattern'), '');
    expect(editor.read().ok).toBe(false);
    expect(field(rows()[0], 'be-error').textContent).toBe('Give the badge a name.');
    expect(field(rows()[0], 'be-label').getAttribute('aria-invalid')).toBe('true');
    expect(field(rows()[1], 'be-error').textContent).toContain('Enter a pattern');
  });

  it('clears the mark as soon as the entry is edited, and accepts the fix', () => {
    const { editor, rows, field, type } = make([aisle]);
    type(field(rows()[0], 'be-pattern'), '(');
    editor.read();
    expect(field(rows()[0], 'be-error').textContent).not.toBe('');

    type(field(rows()[0], 'be-pattern'), 'aisle');
    expect(field(rows()[0], 'be-error').textContent).toBe('');
    expect(field(rows()[0], 'be-pattern').hasAttribute('aria-invalid')).toBe(false);
    expect(editor.read().ok).toBe(true);
  });

  it('allows an empty icon', () => {
    const { editor, rows, field, type } = make([aisle]);
    type(field(rows()[0], 'be-icon'), '');
    expect(editor.read().badges[0].icon).toBe('');
  });

  it('replaces everything on setBadges', () => {
    const { editor, rows } = make([aisle]);
    editor.setBadges([]);
    expect(rows()).toHaveLength(0);
    editor.setBadges([aisle, { ...aisle, id: 'two' }]);
    expect(rows()).toHaveLength(2);
  });

  it('stops offering to add once the limit is reached', () => {
    const many = Array.from({ length: MAX_BADGES }, (_, i) => ({ ...aisle, id: 'b' + i }));
    const { editor, add } = make(many);
    expect(editor.root.querySelector('.be-add').disabled).toBe(true);
    add();
    expect(editor.root.querySelectorAll('.be-row')).toHaveLength(MAX_BADGES);
  });
});

describe('badge editor feedback', () => {
  const texts = ['Section A Row 23 Aisle Seating Ticket', 'Section A Row 26 Full Price Ticket', 'Section B Row 7 Full Price Ticket'];

  it('warns about a space in ". *" as soon as it is typed, without refusing the pattern', () => {
    const { editor, rows, field, type } = make([aisle]);
    expect(field(rows()[0], 'be-warn').textContent).toBe('');
    type(field(rows()[0], 'be-pattern'), 'Row. *Aisle');
    expect(field(rows()[0], 'be-warn').textContent).toContain('.*');
    expect(editor.read().ok).toBe(true);

    type(field(rows()[0], 'be-pattern'), 'Row.*Aisle');
    expect(field(rows()[0], 'be-warn').textContent).toBe('');
  });

  it('shows the warning for a saved pattern that has the mistake', () => {
    const { rows, field } = make([{ ...aisle, pattern: 'Row. *Aisle' }]);
    expect(field(rows()[0], 'be-warn').textContent).toContain('space');
  });

  it('says how many of the page\'s tickets a pattern matches, updating as it is typed', () => {
    const { editor, rows, field, type } = make([aisle]);
    editor.setSamples(texts);
    expect(field(rows()[0], 'be-count').textContent).toBe('Matches 1 of the 3 tickets here.');

    type(field(rows()[0], 'be-pattern'), 'full price');
    expect(field(rows()[0], 'be-count').textContent).toBe('Matches 2 of the 3 tickets here.');
    type(field(rows()[0], 'be-pattern'), '.*');
    expect(field(rows()[0], 'be-count').textContent).toBe('Matches 3 of the 3 tickets here.');
    type(field(rows()[0], 'be-pattern'), 'zzz');
    expect(field(rows()[0], 'be-count').textContent).toBe('Matches none of the 3 tickets here.');
  });

  it('shows no count for an empty or invalid pattern, or without tickets', () => {
    const { editor, rows, field, type } = make([aisle]);
    expect(field(rows()[0], 'be-count').textContent).toBe(''); // no tickets known yet
    editor.setSamples(texts);
    type(field(rows()[0], 'be-pattern'), '(');
    expect(field(rows()[0], 'be-count').textContent).toBe('');
    type(field(rows()[0], 'be-pattern'), '');
    expect(field(rows()[0], 'be-count').textContent).toBe('');
    editor.setSamples([]);
    type(field(rows()[0], 'be-pattern'), 'aisle');
    expect(field(rows()[0], 'be-count').textContent).toBe('');
  });

  it('counts for rows added later, and for rows replaced by setBadges', () => {
    const { editor, rows, field, type, add } = make();
    editor.setSamples(texts);
    add();
    type(field(rows()[0], 'be-pattern'), 'Row');
    expect(field(rows()[0], 'be-count').textContent).toBe('Matches 3 of the 3 tickets here.');
    editor.setBadges([aisle]);
    expect(field(rows()[0], 'be-count').textContent).toBe('Matches 1 of the 3 tickets here.');
  });

  it('shows an example of a ticket\'s text to write patterns against', () => {
    const { editor } = make([aisle]);
    const sample = editor.root.querySelector('.be-sample');
    expect(sample.hidden).toBe(true);
    editor.setSamples(texts);
    expect(sample.hidden).toBe(false);
    expect(sample.textContent).toBe('A ticket\'s text on Ticketmaster: Section A Row 23 Aisle Seating Ticket');
    editor.setSamples([]);
    expect(sample.hidden).toBe(true);
  });

  it('also shows the title Section View lists a ticket under, and counts a ticket if either matches', () => {
    const { editor, rows, field, type } = make([aisle]);
    const tickets = [
      ['Section A Row 23 Aisle Seating Ticket €90.75 each', 'Row 23 (Aisle Seating Ticket)'],
      ['Section A Row 26 Full Price Ticket €80.75 each', 'Row 26'],
    ];
    editor.setSamples(tickets);
    const sample = editor.root.querySelector('.be-sample');
    expect(sample.textContent).toContain('A ticket\'s text on Ticketmaster: Section A Row 23 Aisle Seating Ticket €90.75 each');
    expect(sample.textContent).toContain('As Section View lists it: Row 23 (Aisle Seating Ticket)');

    type(field(rows()[0], 'be-pattern'), '\\(Aisle Seating Ticket\\)'); // real brackets: only the title has them
    expect(field(rows()[0], 'be-count').textContent).toBe('Matches 1 of the 2 tickets here.');
    type(field(rows()[0], 'be-pattern'), '(Aisle Seating Ticket)'); // a group: matches the words
    expect(field(rows()[0], 'be-count').textContent).toBe('Matches 1 of the 2 tickets here.');
    type(field(rows()[0], 'be-pattern'), '^Row');
    expect(field(rows()[0], 'be-count').textContent).toBe('Matches 2 of the 2 tickets here.'); // both titles start with Row
  });

  it('leaves out the second line when the title is the same as the text, or there is none', () => {
    const { editor } = make([aisle]);
    editor.setSamples([['Row 1', 'Row 1']]);
    expect(editor.root.querySelector('.be-sample').textContent).toBe('A ticket\'s text on Ticketmaster: Row 1');
    editor.setSamples([['Row 1']]);
    expect(editor.root.querySelector('.be-sample').textContent).toBe('A ticket\'s text on Ticketmaster: Row 1');
  });

  it('ignores samples that are not text', () => {
    const { editor, rows, field } = make([aisle]);
    editor.setSamples([null, undefined, '', 5, 'Aisle Seating']);
    expect(field(rows()[0], 'be-count').textContent).toBe('Matches 1 of the 1 tickets here.');
    editor.setSamples(null);
    expect(field(rows()[0], 'be-count').textContent).toBe('');
  });
});
