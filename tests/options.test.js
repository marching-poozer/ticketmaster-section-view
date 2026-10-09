import { init } from '../src/options/options.js';
import { saveSettings } from '../src/lib/settings.js';
import { saveVenue } from '../src/lib/venues.js';
import { loadOptionsDom } from './helpers/page-dom.js';
import { flush, peekStorage, seedStorage } from './mocks/chrome.js';

let page;

async function start(settings) {
  if (settings) seedStorage(settings);
  loadOptionsDom();
  page = await init();
}

afterEach(() => {
  if (page) page.destroy();
  page = null;
});

const checkedMode = () => document.querySelector('input[name="displayMode"]:checked')?.value;
const pickMode = (value) => {
  const radio = document.querySelector(`input[name="displayMode"][value="${value}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
};
const checkedSize = () => document.querySelector('input[name="uiSize"]:checked')?.value;
const pickSize = (value) => {
  const radio = document.querySelector(`input[name="uiSize"][value="${value}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
};
const checkedLoad = () => document.querySelector('input[name="loadMode"]:checked')?.value;
const pickLoad = (value) => {
  const radio = document.querySelector(`input[name="loadMode"][value="${value}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
};
const checkedSide = () => document.querySelector('input[name="paneSide"]:checked')?.value;
const pickSide = (value) => {
  const radio = document.querySelector(`input[name="paneSide"][value="${value}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
};
const widthLabel = () => document.getElementById('width-label').textContent;
const reset = () => document.getElementById('reset-width');

describe('options page', () => {
  describe('auto zoom map', () => {
    const box = () => document.getElementById('auto-zoom-map');
    const flip = (checked) => {
      box().checked = checked;
      box().dispatchEvent(new Event('change', { bubbles: true }));
    };

    it('is on by default, and shows that it was switched off', async () => {
      await start();
      expect(box().checked).toBe(true);
      page.destroy();
      page = null;
      await start({ autoZoomMap: false });
      expect(box().checked).toBe(false);
    });

    it('is saved as it changes, and follows the header\'s checkbox', async () => {
      await start();
      flip(false);
      await flush();
      expect(peekStorage('autoZoomMap')).toBe(false);
      await saveSettings({ autoZoomMap: true }); // switched on in the list's header
      await flush();
      expect(box().checked).toBe(true);
    });

    it('says what it does, and where else it is', async () => {
      await start();
      const text = document.getElementById('autozoom').textContent;
      expect(text).toMatch(/Show on map/);
      expect(text).toMatch(/header/);
    });
  });

  describe('the seat map link', () => {
    const box = () => document.getElementById('map-link');
    const flip = (checked) => {
      box().checked = checked;
      box().dispatchEvent(new Event('change', { bubbles: true }));
    };

    it('is on by default, and shows that it was switched off', async () => {
      await start();
      expect(box().checked).toBe(true);
      page.destroy();
      page = null;
      await start({ mapLink: false });
      expect(box().checked).toBe(false);
    });

    it('is saved as it changes', async () => {
      await start();
      flip(false);
      await flush();
      expect(peekStorage('mapLink')).toBe(false);
      flip(true);
      await flush();
      expect(peekStorage('mapLink')).toBe(true);
    });

    it('says what it does', async () => {
      await start();
      expect(document.getElementById('seatmap').textContent).toMatch(/veiled in white/);
    });
  });

  describe('the on/off switch', () => {
    const box = () => document.getElementById('enabled');
    const flip = (checked) => {
      box().checked = checked;
      box().dispatchEvent(new Event('change', { bubbles: true }));
    };

    it('is on by default', async () => {
      await start();
      expect(box().checked).toBe(true);
    });

    it('shows that it was switched off', async () => {
      await start({ enabled: false });
      expect(box().checked).toBe(false);
    });

    it('switches it off and on, saving each at once', async () => {
      await start();
      flip(false);
      await flush();
      expect(peekStorage('enabled')).toBe(false);
      flip(true);
      await flush();
      expect(peekStorage('enabled')).toBe(true);
    });

    it('follows a switch made from the toolbar icon\'s menu', async () => {
      await start();
      await saveSettings({ enabled: false });
      await flush();
      expect(box().checked).toBe(false);
    });

    it('says where else the switch is', async () => {
      await start();
      expect(document.getElementById('power').textContent).toMatch(/toolbar icon/);
    });
  });

  it('shows the defaults: inline, floating pane on the right', async () => {
    await start();
    expect(checkedMode()).toBe('inline');
    expect(checkedSide()).toBe('right');
    expect(widthLabel()).toBe('380 px');
    expect(reset().disabled).toBe(true);
  });

  it('shows saved settings', async () => {
    await start({ paneSide: 'left', paneWidth: 520 });
    expect(checkedSide()).toBe('left');
    expect(widthLabel()).toBe('520 px');
  });

  it('loads tickets from the API by default, and can be told to scroll instead', async () => {
    await start();
    expect(checkedLoad()).toBe('api');
    pickLoad('scroll');
    await flush();
    expect(peekStorage('loadMode')).toBe('scroll');
    pickLoad('api');
    await flush();
    expect(peekStorage('loadMode')).toBe('api');
  });

  it('shows a saved way of loading', async () => {
    await start({ loadMode: 'scroll' });
    expect(checkedLoad()).toBe('scroll');
  });

  it('shows and saves the display mode', async () => {
    await start({ displayMode: 'pane' });
    expect(checkedMode()).toBe('pane');

    pickMode('inline');
    await flush();
    expect(peekStorage('displayMode')).toBe('inline');
    expect(checkedMode()).toBe('inline');
  });

  it('shows the text size, matching Ticketmaster by default, and saves a change', async () => {
    await start();
    expect(checkedSize()).toBe('match');

    pickSize('comfort');
    await flush();
    expect(peekStorage('uiSize')).toBe('comfort');
    expect(checkedSize()).toBe('comfort');
  });

  it('shows a saved text size and follows a change made elsewhere', async () => {
    await start({ uiSize: 'compact' });
    expect(checkedSize()).toBe('compact');
    await saveSettings({ uiSize: 'match' });
    await flush();
    expect(checkedSize()).toBe('match');
  });

  it('keeps the floating-pane options available in inline mode (they are the fallback)', async () => {
    await start();
    expect(document.getElementById('pane-options').disabled).toBe(false);
  });

  it('follows a mode change made elsewhere', async () => {
    await start();
    await saveSettings({ displayMode: 'pane' });
    await flush();
    expect(checkedMode()).toBe('pane');
  });

  it('saves the side as it changes', async () => {
    await start();
    pickSide('left');
    await flush();
    expect(peekStorage('paneSide')).toBe('left');
    expect(checkedSide()).toBe('left');
  });

  it('resets the width to the default', async () => {
    await start({ paneWidth: 600 });
    expect(reset().disabled).toBe(false);
    expect(reset().textContent).toBe('Reset to 380 px');

    reset().click();
    await flush();

    expect(peekStorage('paneWidth')).toBe(380);
    expect(widthLabel()).toBe('380 px');
    expect(reset().disabled).toBe(true);
  });

  it('follows changes made elsewhere, like dragging the pane\'s edge', async () => {
    await start();
    await saveSettings({ paneWidth: 640, paneSide: 'left' });
    await flush();
    expect(widthLabel()).toBe('640 px');
    expect(checkedSide()).toBe('left');
  });

  it('does not touch other saved settings', async () => {
    await start({ sort: 'price', badgeFilters: ['resale'] });
    pickSide('left');
    await flush();
    expect(peekStorage('sort')).toBe('price');
    expect(peekStorage('badgeFilters')).toEqual(['resale']);
  });
});

describe('front rows (the global default)', () => {
  const input = () => document.getElementById('front-rows');
  const type = (value) => {
    input().value = value;
    input().dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('shows the default of 5 and saves a change', async () => {
    await start();
    expect(input().value).toBe('5');
    type('8');
    await flush();
    expect(peekStorage('frontRows')).toBe(8);
    expect(input().value).toBe('8');
  });

  it('refuses nonsense, says so, and puts the old value back', async () => {
    await start({ frontRows: 6 });
    ['0', '51', 'many', '', '2.5'].forEach((bad) => {
      type(bad);
      expect(input().value).toBe('6');
      expect(document.getElementById('front-rows-message').textContent).toContain('whole number');
    });
    await flush();
    expect(peekStorage('frontRows')).toBe(6);
  });

  it('clears the message after a good value', async () => {
    await start();
    type('x');
    type('4');
    expect(document.getElementById('front-rows-message').textContent).toBe('');
  });

  it('follows a change made elsewhere', async () => {
    await start();
    await saveSettings({ frontRows: 9 });
    await flush();
    expect(input().value).toBe('9');
  });
});

describe('venues', () => {
  const rows = () => [...document.querySelectorAll('.venue-row')];
  const fieldsOf = (row) => ({
    tiers: row.querySelector('input[aria-label="Tiers start at row"]'),
    front: row.querySelector('input[aria-label="Front rows"]'),
    message: row.querySelector('.inline-message'),
  });

  it('says so when no venue has been saved', async () => {
    await start();
    expect(rows()).toHaveLength(0);
    expect(document.getElementById('venues-empty').hidden).toBe(false);
  });

  it('lists each saved venue with its tiers and front rows', async () => {
    await saveVenue('197033', { name: '3Arena, Dublin', firstRows: [21, 33], frontRows: 4 });
    await saveVenue('42', { name: 'Alpha Hall', firstRows: [1] });
    await start();

    expect(document.getElementById('venues-empty').hidden).toBe(true);
    expect(rows().map((r) => r.querySelector('strong').textContent)).toEqual(['3Arena, Dublin', 'Alpha Hall'].sort());
    const arena = rows().find((r) => r.dataset.venue === '197033');
    expect(arena.textContent).toContain('venue 197033');
    expect(fieldsOf(arena).tiers.value).toBe('21, 33');
    expect(fieldsOf(arena).front.value).toBe('4');
    const alpha = rows().find((r) => r.dataset.venue === '42');
    expect(fieldsOf(alpha).front.value).toBe('');
    expect(fieldsOf(alpha).front.placeholder).toBe('5');
  });

  it('saves edits to a venue', async () => {
    await saveVenue('197033', { name: '3Arena, Dublin', firstRows: [1] });
    await start();
    const row = rows()[0];
    fieldsOf(row).tiers.value = '33, 21';
    fieldsOf(row).front.value = '3';
    row.querySelector('.venue-save').click();
    await flush();

    expect(peekStorage('venue:197033')).toEqual({ name: '3Arena, Dublin', firstRows: [21, 33], frontRows: 3, badges: [] });
  });

  it('says what is wrong and saves nothing when the values are not usable', async () => {
    await saveVenue('1', { name: 'A', firstRows: [21] });
    await start();
    const row = rows()[0];

    fieldsOf(row).tiers.value = 'twenty-one';
    row.querySelector('.venue-save').click();
    expect(fieldsOf(row).message.textContent).toContain('row numbers');

    fieldsOf(row).tiers.value = '21';
    fieldsOf(row).front.value = '99';
    row.querySelector('.venue-save').click();
    expect(fieldsOf(row).message.textContent).toContain('whole number');

    await flush();
    expect(peekStorage('venue:1')).toEqual({ name: 'A', firstRows: [21], frontRows: null, badges: [] });
  });

  it('saves tiers written as row letters', async () => {
    await saveVenue('1', { name: 'Royal Hall', firstRows: [1] });
    await start();
    const row = rows()[0];
    fieldsOf(row).tiers.value = 'k, a';
    row.querySelector('.venue-save').click();
    await flush();
    expect(peekStorage('venue:1').firstRows).toEqual(['A', 'K']);
  });

  it('shows saved row letters, and refuses a mix of numbers and letters', async () => {
    await saveVenue('1', { name: 'Royal Hall', firstRows: ['A', 'K'] });
    await start();
    const row = rows()[0];
    expect(fieldsOf(row).tiers.value).toBe('A, K');

    fieldsOf(row).tiers.value = '21, K';
    row.querySelector('.venue-save').click();
    expect(fieldsOf(row).message.textContent).toContain('letters');
    await flush();
    expect(peekStorage('venue:1').firstRows).toEqual(['A', 'K']);
  });

  it('removes a venue', async () => {
    await saveVenue('1', { name: 'A', firstRows: [21] });
    await saveVenue('2', { name: 'B', firstRows: [7] });
    await start();

    rows().find((r) => r.dataset.venue === '1').querySelector('.venue-remove').click();
    await flush();
    await flush();

    expect(peekStorage('venue:1')).toBeUndefined();
    expect(rows().map((r) => r.dataset.venue)).toEqual(['2']);
  });

  it('shows a venue saved elsewhere (from the 📍 button on an event page) straight away', async () => {
    await start();
    expect(rows()).toHaveLength(0);

    await saveVenue('197033', { name: '3Arena, Dublin', firstRows: [21, 33] });
    await flush();
    await flush();

    expect(rows()).toHaveLength(1);
    expect(document.getElementById('venues-empty').hidden).toBe(true);
  });

  it('labels a venue saved without a name by its id', async () => {
    await saveVenue('7', { firstRows: [3] });
    await start();
    expect(rows()[0].querySelector('strong').textContent).toBe('Venue 7');
  });

  it('uses the current default front rows as the placeholder', async () => {
    await saveVenue('1', { name: 'A', firstRows: [21] });
    await start({ frontRows: 7 });
    expect(fieldsOf(rows()[0]).front.placeholder).toBe('7');
  });
});

describe('custom badges', () => {
  const aisle = { id: 'aisle1', label: 'Aisle', icon: '🚶', color: 'blue', pattern: 'aisle' };
  const editor = () => document.getElementById('global-badges');
  const rows = () => [...editor().querySelectorAll('.be-row')];
  const message = () => document.getElementById('badges-message').textContent;
  const save = () => document.getElementById('save-badges').click();
  const type = (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('explains the pattern syntax, with examples', async () => {
    await start();
    const help = document.getElementById('pattern-help');
    expect(help.querySelector('summary').textContent).toBe('Pattern syntax');
    expect(help.open).toBe(false); // folded away until wanted
    expect(help.textContent).toContain('ignoring case');
    expect(help.textContent).toContain('aisle|end of row');
    expect(help.textContent).toContain('Section BLOCKG Row 26 Full Price Ticket €80.75 each');
  });

  it('starts with none', async () => {
    await start();
    expect(rows()).toHaveLength(0);
  });

  it('shows the saved badges', async () => {
    await start({ customBadges: [aisle] });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('.be-label').value).toBe('Aisle');
    expect(rows()[0].querySelector('.be-pattern').value).toBe('aisle');
  });

  it('saves a new badge when asked', async () => {
    await start();
    editor().querySelector('.be-add').click();
    type(rows()[0].querySelector('.be-label'), 'Aisle');
    type(rows()[0].querySelector('.be-pattern'), 'aisle|end of row');
    expect(peekStorage('customBadges')).toBeUndefined(); // not until Save

    save();
    await flush();
    expect(peekStorage('customBadges')).toEqual([expect.objectContaining({ label: 'Aisle', pattern: 'aisle|end of row', icon: '🔖', color: 'teal' })]);
    expect(document.getElementById('badges-saved').textContent).toBe('Saved');
    expect(message()).toBe('');
  });

  it('keeps the entered badge (and its id) after saving, so a second save does not duplicate it', async () => {
    await start();
    editor().querySelector('.be-add').click();
    type(rows()[0].querySelector('.be-label'), 'Aisle');
    type(rows()[0].querySelector('.be-pattern'), 'aisle');
    save();
    await flush();
    const [first] = peekStorage('customBadges');
    save();
    await flush();
    expect(rows()).toHaveLength(1);
    expect(peekStorage('customBadges')).toEqual([first]);
  });

  it('edits and removes saved badges', async () => {
    await start({ customBadges: [aisle, { ...aisle, id: 'two', label: 'Two', pattern: 'two' }] });
    type(rows()[0].querySelector('.be-pattern'), 'aisle seat');
    rows()[1].querySelector('.be-remove').click();
    save();
    await flush();
    expect(peekStorage('customBadges')).toEqual([{ ...aisle, pattern: 'aisle seat' }]);
  });

  it('says what is wrong and saves nothing when a pattern is not valid', async () => {
    await start({ customBadges: [aisle] });
    type(rows()[0].querySelector('.be-pattern'), '(aisle');
    save();
    await flush();
    expect(message()).toContain('Fix the badges');
    expect(rows()[0].querySelector('.be-error').textContent).toContain('Not a valid pattern');
    expect(peekStorage('customBadges')).toEqual([aisle]);
  });

  it('shows badges changed elsewhere, but not the echo of its own save', async () => {
    await start();
    await saveSettings({ customBadges: [aisle] });
    await flush();
    expect(rows()).toHaveLength(1);

    // own save: the in-progress (here: blank, ignored) extra row is left alone
    editor().querySelector('.be-add').click();
    expect(rows()).toHaveLength(2);
    await saveSettings({ customBadges: [aisle] });
    await flush();
    expect(rows()).toHaveLength(2);
  });

  it('drops its complaint, and the "Saved" note, as soon as a badge is edited', async () => {
    await start({ customBadges: [aisle] });
    type(rows()[0].querySelector('.be-pattern'), '(');
    save();
    expect(message()).not.toBe('');

    type(rows()[0].querySelector('.be-pattern'), 'aisle');
    expect(message()).toBe('');

    save();
    await flush();
    expect(document.getElementById('badges-saved').textContent).toBe('Saved');
    type(rows()[0].querySelector('.be-pattern'), 'aisles');
    expect(document.getElementById('badges-saved').textContent).toBe('');
  });

  describe('for a venue', () => {
    const venueRow = () => document.querySelector('.venue-row');

    it('lists the venue\'s badges in its row', async () => {
      await saveVenue('1', { name: 'A', firstRows: [21], badges: [aisle] });
      await start();
      expect(venueRow().querySelectorAll('.be-row')).toHaveLength(1);
      expect(venueRow().querySelector('.be-pattern').value).toBe('aisle');
    });

    it('saves them with the venue\'s other settings', async () => {
      await saveVenue('1', { name: 'A', firstRows: [21] });
      await start();
      venueRow().querySelector('.be-add').click();
      type(venueRow().querySelector('.be-label'), 'Restricted');
      type(venueRow().querySelector('.be-pattern'), 'restricted');
      venueRow().querySelector('.venue-save').click();
      await flush();

      expect(peekStorage('venue:1')).toMatchObject({ firstRows: [21], badges: [expect.objectContaining({ label: 'Restricted', pattern: 'restricted' })] });
    });

    it('says what is wrong and saves nothing when a pattern is not valid', async () => {
      await saveVenue('1', { name: 'A', firstRows: [21], badges: [aisle] });
      await start();
      type(venueRow().querySelector('.be-pattern'), '[');
      venueRow().querySelector('.venue-save').click();
      await flush();

      expect(venueRow().querySelector('.inline-message').textContent).toContain('Fix the badges');
      expect(peekStorage('venue:1').badges).toEqual([aisle]);
    });
  });
});
