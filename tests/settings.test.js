import {
  applySettingsChanges,
  clampPaneWidth,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from '../src/lib/settings.js';
import { chrome, flush, peekStorage, seedStorage } from './mocks/chrome.js';

const DEFAULTS = {
  enabled: true,
  mapLink: true,
  autoZoomMap: true,
  sort: 'row',
  seatFilter: 'all',
  qualityFilter: 'any',
  priceFilter: 'any',
  badgeFilters: [],
  hideFilters: [],
  customBadges: [],
  displayMode: 'inline',
  uiSize: 'match',
  loadMode: 'api',
  frontRows: 5,
  paneSide: 'right',
  paneWidth: 380,
  paneOpen: false,
};

describe('autoZoomMap (zooming the seat map by itself)', () => {
  it('is on unless it has been switched off, and only a real false switches it off', () => {
    expect(normalizeSettings({}).autoZoomMap).toBe(true);
    expect(normalizeSettings({ autoZoomMap: false }).autoZoomMap).toBe(false);
    ['no', 0, null, 'false', [], {}].forEach((v) => expect(normalizeSettings({ autoZoomMap: v }).autoZoomMap).toBe(true));
  });

  it('is saved under its own key', async () => {
    await saveSettings({ autoZoomMap: false });
    expect(peekStorage('autoZoomMap')).toBe(false);
    expect((await loadSettings()).autoZoomMap).toBe(false);
  });
});

describe('mapLink (linking the list to the venue\'s seat map)', () => {
  it('is on unless it has been switched off, and only a real false switches it off', () => {
    expect(normalizeSettings({}).mapLink).toBe(true);
    expect(normalizeSettings({ mapLink: false }).mapLink).toBe(false);
    ['no', 0, null, 'false', [], {}].forEach((v) => expect(normalizeSettings({ mapLink: v }).mapLink).toBe(true));
  });

  it('is saved under its own key', async () => {
    await saveSettings({ mapLink: false });
    expect(peekStorage('mapLink')).toBe(false);
    expect((await loadSettings()).mapLink).toBe(false);
  });
});

describe('enabled (Section View switched on or off)', () => {
  it('is on unless it has been switched off', () => {
    expect(normalizeSettings({}).enabled).toBe(true);
    expect(normalizeSettings({ enabled: true }).enabled).toBe(true);
    expect(normalizeSettings({ enabled: false }).enabled).toBe(false);
  });

  it('only a real false switches it off: anything else a bad value in storage leaves it on', () => {
    ['no', 0, null, 'false', [], {}].forEach((v) => expect(normalizeSettings({ enabled: v }).enabled).toBe(true));
  });

  it('is saved under its own key, and followed when it changes elsewhere', async () => {
    await saveSettings({ enabled: false });
    expect(peekStorage('enabled')).toBe(false);
    expect((await loadSettings()).enabled).toBe(false);
    const on = applySettingsChanges(normalizeSettings({ enabled: false }), { enabled: { oldValue: false, newValue: true } });
    expect(on.enabled).toBe(true);
    const removed = applySettingsChanges(normalizeSettings({ enabled: false }), { enabled: { oldValue: false, newValue: undefined } });
    expect(removed.enabled).toBe(true); // a removed key is back to its default
  });
});

describe('normalizeSettings', () => {
  it('defaults everything for missing or garbage input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULTS);
    expect(normalizeSettings(null)).toEqual(DEFAULTS);
    expect(normalizeSettings('nope')).toEqual(DEFAULTS);
    expect(normalizeSettings({})).toEqual(DEFAULTS);
  });

  it('keeps valid values', () => {
    const customBadges = [{ id: 'aisle1', label: 'Aisle', icon: '🚶', color: 'blue', pattern: 'aisle' }];
    const valid = { enabled: false, mapLink: false, autoZoomMap: false, sort: 'price', seatFilter: 'frontrows', qualityFilter: 'top25', priceFilter: 'sectionlow', badgeFilters: ['resale', 'custom:aisle1'], hideFilters: ['attr:aisle'], customBadges, displayMode: 'pane', uiSize: 'comfort', loadMode: 'scroll', frontRows: 8, paneSide: 'left', paneWidth: 500, paneOpen: true };
    expect(normalizeSettings(valid)).toEqual(valid);
  });

  it('rejects invalid values field by field and drops unknown fields', () => {
    expect(
      normalizeSettings({ panelOpen: true, sort: 'size', badgeFilters: ['resale', 'bogus', 3, 'cheapest'], displayMode: 'popup', uiSize: 'huge', paneSide: 'top', paneWidth: 'wide', paneOpen: 'yes' })
    // (an old-style "cheapest" in the list becomes the price choice)
    ).toEqual({ ...DEFAULTS, badgeFilters: ['resale'], priceFilter: 'cheapest' });
    expect(normalizeSettings({ badgeFilters: 'resale' }).badgeFilters).toEqual([]);
  });

  it('knows the two display modes and defaults to inline', () => {
    expect(normalizeSettings({ displayMode: 'pane' }).displayMode).toBe('pane');
    expect(normalizeSettings({ displayMode: 'inline' }).displayMode).toBe('inline');
    expect(normalizeSettings({ displayMode: 'sidepanel' }).displayMode).toBe('inline');
  });

  it('knows the two ways of loading tickets and defaults to reading the API', () => {
    expect(normalizeSettings({}).loadMode).toBe('api');
    expect(normalizeSettings({ loadMode: 'scroll' }).loadMode).toBe('scroll');
    expect(normalizeSettings({ loadMode: 'api' }).loadMode).toBe('api');
    expect(normalizeSettings({ loadMode: 'telepathy' }).loadMode).toBe('api');
  });

  it('knows the three text sizes and defaults to matching Ticketmaster', () => {
    ['compact', 'match', 'comfort'].forEach((size) => expect(normalizeSettings({ uiSize: size }).uiSize).toBe(size));
    expect(normalizeSettings({ uiSize: 'large' }).uiSize).toBe('match');
    expect(normalizeSettings({}).uiSize).toBe('match');
  });

  it('knows how many rows count as the front by default, within limits', () => {
    expect(normalizeSettings({}).frontRows).toBe(5);
    expect(normalizeSettings({ frontRows: 3 }).frontRows).toBe(3);
    expect(normalizeSettings({ frontRows: 0 }).frontRows).toBe(1);
    expect(normalizeSettings({ frontRows: 500 }).frontRows).toBe(50);
    expect(normalizeSettings({ frontRows: 2.6 }).frontRows).toBe(3);
    expect(normalizeSettings({ frontRows: 'lots' }).frontRows).toBe(5);
  });

  describe('Standing, which used to be a choice in Seats and is now an "Other" pill', () => {
    it('shows only standing tickets for someone who had that chosen', () => {
      const n = normalizeSettings({ seatFilter: 'standing' });
      expect(n.seatFilter).toBe('all');
      expect(n.badgeFilters).toEqual(['standing']);
    });

    it('keeps the other pills that were on', () => {
      expect(normalizeSettings({ seatFilter: 'standing', badgeFilters: ['resale'] }).badgeFilters).toEqual(['resale', 'standing']);
    });

    it('is a pill that can show only its tickets or hide them, like the others', () => {
      expect(normalizeSettings({ badgeFilters: ['standing'] }).badgeFilters).toEqual(['standing']);
      expect(normalizeSettings({ hideFilters: ['standing'] }).hideFilters).toEqual(['standing']);
    });

    it('is shown, not hidden, if both were saved (the old choice wins over a hide)', () => {
      const n = normalizeSettings({ seatFilter: 'standing', hideFilters: ['standing'] });
      expect(n.badgeFilters).toEqual(['standing']);
      expect(n.hideFilters).toEqual([]);
    });

    it('is not carried over once the choice is something else', () => {
      expect(normalizeSettings({ seatFilter: 'firstrow' }).badgeFilters).toEqual([]);
    });
  });

  describe('the "Other" pills that hide their tickets', () => {
    it('are none by default', () => {
      expect(normalizeSettings({}).hideFilters).toEqual([]);
    });

    it('keep resale, attributes and custom badges, once each, and drop anything else', () => {
      expect(normalizeSettings({ hideFilters: ['resale', 'attr:aisle', 'custom:a1', 'resale', 'cheapest', 'bogus', 3] }).hideFilters).toEqual(['resale', 'attr:aisle', 'custom:a1']);
      expect(normalizeSettings({ hideFilters: 'resale' }).hideFilters).toEqual([]);
      expect(normalizeSettings({ hideFilters: ['attr:Bad Key'] }).hideFilters).toEqual([]);
    });

    it('are never also showing only their tickets: the pill that shows wins', () => {
      const n = normalizeSettings({ badgeFilters: ['resale'], hideFilters: ['resale', 'attr:aisle'] });
      expect(n.badgeFilters).toEqual(['resale']);
      expect(n.hideFilters).toEqual(['attr:aisle']);
    });
  });

  it('has no quality filter by default, and knows the choices', () => {
    expect(normalizeSettings({}).qualityFilter).toBe('any');
    ['any', 'top10', 'top25', 'top50'].forEach((k) => expect(normalizeSettings({ qualityFilter: k }).qualityFilter).toBe(k));
    expect(normalizeSettings({ qualityFilter: 'best' }).qualityFilter).toBe('any');
  });

  it('has no seat or price filter by default, and knows the choices', () => {
    expect(normalizeSettings({}).seatFilter).toBe('all');
    expect(normalizeSettings({}).priceFilter).toBe('any');
    ['firstrow', 'frontrows', 'all'].forEach((k) => expect(normalizeSettings({ seatFilter: k }).seatFilter).toBe(k));
    ['cheapest', 'sectionlow', 'any'].forEach((k) => expect(normalizeSettings({ priceFilter: k }).priceFilter).toBe(k));
    expect(normalizeSettings({ seatFilter: 'back', priceFilter: 'free' })).toMatchObject({ seatFilter: 'all', priceFilter: 'any' });
  });

  describe('carrying over the filters of earlier versions (all pills in one list)', () => {
    it('takes the seat choice from "1st Row" / "Front Rows" (the narrower, if both were on)', () => {
      expect(normalizeSettings({ badgeFilters: ['frontrows'] }).seatFilter).toBe('frontrows');
      expect(normalizeSettings({ badgeFilters: ['firstrow'] }).seatFilter).toBe('firstrow');
      expect(normalizeSettings({ badgeFilters: ['frontrows', 'firstrow'] }).seatFilter).toBe('firstrow');
    });

    it('and "Top Row", which Front Rows replaced', () => {
      expect(normalizeSettings({ badgeFilters: ['toprow'] }).seatFilter).toBe('frontrows');
      expect(normalizeSettings({ badgeFilters: ['toprow', 'frontrows', 'resale'] })).toMatchObject({ seatFilter: 'frontrows', badgeFilters: ['resale'] });
    });

    it('takes the price choice from "Cheapest" / "Best Block"', () => {
      expect(normalizeSettings({ badgeFilters: ['cheapest'] }).priceFilter).toBe('cheapest');
      expect(normalizeSettings({ badgeFilters: ['blockprice'] }).priceFilter).toBe('sectionlow');
      expect(normalizeSettings({ badgeFilters: ['blockprice', 'cheapest'] }).priceFilter).toBe('cheapest');
    });

    it('keeps resale, attributes and custom badges as the other filters, and drops the pills that went', () => {
      expect(normalizeSettings({ badgeFilters: ['resale', 'rowoptions', 'markup', 'facevalue', 'attr:aisle', 'custom:a1', 'frontrows', 'cheapest'] }).badgeFilters)
        .toEqual(['resale', 'attr:aisle', 'custom:a1']);
    });

    it('lets the new settings win over the old list', () => {
      expect(normalizeSettings({ seatFilter: 'frontrows', priceFilter: 'any', badgeFilters: ['firstrow', 'cheapest'] })).toMatchObject({ seatFilter: 'frontrows', priceFilter: 'any' });
    });
  });

  it('keeps only valid custom badges, and lets custom badge filters through', () => {
    const good = { id: 'a1', label: 'Aisle', icon: '🚶', color: 'blue', pattern: 'aisle' };
    expect(normalizeSettings({ customBadges: [good, { id: 'bad', label: 'X', pattern: '(' }, 'nope'] }).customBadges).toEqual([good]);
    expect(normalizeSettings({ customBadges: 'aisle' }).customBadges).toEqual([]);
    expect(normalizeSettings({ badgeFilters: ['custom:a1', 'custom:', 'custom:Not Valid', 'resale'] }).badgeFilters).toEqual(['custom:a1', 'resale']);
    expect(normalizeSettings({ badgeFilters: ['attr:aisle', 'attr:', 'attr:Bad Key', 'resale'] }).badgeFilters).toEqual(['attr:aisle', 'resale']);
  });

  it('clamps the pane width to a usable range', () => {
    expect(normalizeSettings({ paneWidth: 10 }).paneWidth).toBe(280);
    expect(normalizeSettings({ paneWidth: 99999 }).paneWidth).toBe(900);
    expect(normalizeSettings({ paneWidth: 412.6 }).paneWidth).toBe(413);
    expect(normalizeSettings({ paneWidth: NaN }).paneWidth).toBe(380);
  });
});

describe('clampPaneWidth', () => {
  it('rounds and clamps', () => {
    expect(clampPaneWidth(100)).toBe(280);
    expect(clampPaneWidth(1000)).toBe(900);
    expect(clampPaneWidth(333.4)).toBe(333);
  });
});

describe('loadSettings / saveSettings', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await loadSettings()).toEqual(DEFAULTS);
  });

  it('stores each setting under its own key and writes only what changed', async () => {
    await saveSettings({ sort: 'price' });
    expect(peekStorage('sort')).toBe('price');
    expect(peekStorage('paneWidth')).toBeUndefined();
    expect(await loadSettings()).toEqual({ ...DEFAULTS, sort: 'price' });
  });

  it('round-trips every setting', async () => {
    const customBadges = [{ id: 'a1', label: 'Aisle', icon: '🚶', color: 'blue', pattern: 'aisle' }];
    const all = { sort: 'price', seatFilter: 'frontrows', qualityFilter: 'top10', priceFilter: 'cheapest', badgeFilters: ['resale', 'custom:a1'], hideFilters: ['attr:aisle'], customBadges, paneSide: 'left', paneWidth: 500, paneOpen: true };
    await saveSettings(all);
    expect(await loadSettings()).toEqual({ ...DEFAULTS, ...all });
  });

  it('does not lose writes made at the same moment (each key is independent)', async () => {
    await Promise.all([saveSettings({ paneSide: 'left' }), saveSettings({ paneWidth: 600 }), saveSettings({ sort: 'price' })]);
    expect(await loadSettings()).toEqual({ ...DEFAULTS, paneSide: 'left', paneWidth: 600, sort: 'price' });
  });

  it('validates what it saves and ignores unknown keys', async () => {
    await saveSettings({ paneWidth: 5, paneSide: 'top', bogus: 1 });
    expect(peekStorage('paneWidth')).toBe(280);
    expect(peekStorage('paneSide')).toBe('right');
    expect(peekStorage('bogus')).toBeUndefined();
  });

  it('sanitises what it reads back', async () => {
    seedStorage({ sort: 'weird', badgeFilters: ['old-badge'], paneWidth: 'x' });
    expect(await loadSettings()).toEqual(DEFAULTS);
  });

  it('picks up settings saved by earlier versions as a single object, with the new per-key values winning', async () => {
    seedStorage('settings', { sort: 'price', badgeFilters: ['resale'], panelOpen: true });
    expect(await loadSettings()).toEqual({ ...DEFAULTS, sort: 'price', badgeFilters: ['resale'] });

    seedStorage('sort', 'row');
    expect((await loadSettings()).sort).toBe('row');
  });

  it('falls back to defaults when storage throws', async () => {
    vi.spyOn(chrome.storage.local, 'get').mockRejectedValue(new Error('Extension context invalidated.'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadSettings()).toEqual(DEFAULTS);
  });

  it('swallows errors when saving', async () => {
    vi.spyOn(chrome.storage.local, 'set').mockRejectedValue(new Error('Extension context invalidated.'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(saveSettings({ sort: 'price' })).resolves.toBeUndefined();
  });
});

describe('applySettingsChanges', () => {
  it('applies the changed keys onto the current settings', async () => {
    const seen = [];
    chrome.storage.onChanged.addListener((changes) => seen.push(changes));
    await saveSettings({ paneSide: 'left', paneWidth: 500 });
    await flush();

    const next = applySettingsChanges(DEFAULTS, seen[0]);
    expect(next).toEqual({ ...DEFAULTS, paneSide: 'left', paneWidth: 500 });
  });

  it('resets a removed key to its default and ignores unrelated keys', () => {
    expect(applySettingsChanges({ ...DEFAULTS, paneSide: 'left' }, { paneSide: { oldValue: 'left' }, somethingElse: { newValue: 1 } })).toEqual(DEFAULTS);
  });
});
