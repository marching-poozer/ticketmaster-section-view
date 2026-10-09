import {
  VENUE_KEY_PREFIX,
  changedVenueIds,
  deleteVenue,
  formatRowList,
  listVenues,
  loadVenue,
  normalizeVenue,
  parseFrontRows,
  parseRowList,
  saveVenue,
  venueKey,
} from '../src/lib/venues.js';
import { chrome, flush, peekStorage, seedStorage } from './mocks/chrome.js';

describe('normalizeVenue', () => {
  it('defaults: rows start at 1 and the default number of front rows applies', () => {
    expect(normalizeVenue(undefined)).toEqual({ name: '', firstRows: [1], frontRows: null, badges: [] });
    expect(normalizeVenue('nope')).toEqual({ name: '', firstRows: [1], frontRows: null, badges: [] });
    expect(normalizeVenue({})).toEqual({ name: '', firstRows: [1], frontRows: null, badges: [] });
  });

  it('keeps a valid venue, with the tiers sorted and de-duplicated', () => {
    expect(normalizeVenue({ name: '3Arena, Dublin', firstRows: [33, 21, 33], frontRows: 4 })).toEqual({
      name: '3Arena, Dublin',
      firstRows: [21, 33],
      frontRows: 4,
      badges: [],
    });
  });

  it('keeps the venue\'s custom badges, valid ones only', () => {
    const good = { id: 'a1', label: 'Aisle', icon: '🚶', color: 'blue', pattern: 'aisle' };
    expect(normalizeVenue({ badges: [good, { id: 'bad', label: 'X', pattern: '(' }] }).badges).toEqual([good]);
    expect(normalizeVenue({ badges: 'aisle' }).badges).toEqual([]);
  });

  it('drops anything that is not a row number or row letter', () => {
    expect(normalizeVenue({ firstRows: [0, -3, 2.5, '?', 'ABC', 'GA', 21, 5000, null] }).firstRows).toEqual([21]);
    expect(normalizeVenue({ firstRows: [0, '?'] }).firstRows).toEqual([1]);
    expect(normalizeVenue({ firstRows: 'nope' }).firstRows).toEqual([1]);
  });

  it('keeps tiers that start at row letters, in row order and upper case', () => {
    expect(normalizeVenue({ firstRows: ['k', 'A', 'aa'] }).firstRows).toEqual(['A', 'K', 'AA']);
    expect(normalizeVenue({ firstRows: ['B', 2, 'b'] }).firstRows).toEqual(['B']); // the same row three ways
    expect(normalizeVenue({ firstRows: ['21', 33] }).firstRows).toEqual([21, 33]);
  });

  it('limits the front rows, and falls back to the default for nonsense', () => {
    expect(normalizeVenue({ frontRows: 500 }).frontRows).toBe(50);
    expect(normalizeVenue({ frontRows: 0 }).frontRows).toBeNull();
    expect(normalizeVenue({ frontRows: 'x' }).frontRows).toBeNull();
    expect(normalizeVenue({ frontRows: 2.5 }).frontRows).toBeNull();
  });

  it('keeps names sane', () => {
    expect(normalizeVenue({ name: 42 }).name).toBe('');
    expect(normalizeVenue({ name: 'x'.repeat(500) }).name).toHaveLength(120);
  });
});

describe('parseRowList', () => {
  it('reads rows separated by commas, spaces or semicolons', () => {
    expect(parseRowList('21, 33')).toEqual([21, 33]);
    expect(parseRowList('33 21')).toEqual([21, 33]);
    expect(parseRowList('21;33')).toEqual([21, 33]);
    expect(parseRowList(' 21 ,, 33 ')).toEqual([21, 33]);
    expect(parseRowList('7')).toEqual([7]);
  });

  it('treats blank as "rows start at 1"', () => {
    expect(parseRowList('')).toEqual([1]);
    expect(parseRowList('   ')).toEqual([1]);
    expect(parseRowList(null)).toEqual([1]);
  });

  it('reads row letters too, in row order and upper case', () => {
    expect(parseRowList('a')).toEqual(['A']);
    expect(parseRowList('k, a')).toEqual(['A', 'K']);
    expect(parseRowList('AA B')).toEqual(['B', 'AA']);
  });

  it('rejects anything else, including a mix of numbers and letters', () => {
    ['21 b', 'a 33', '21-33', '0', '-4', '2.5', '1000', 'GA', 'ABC', 'A1', '?'].forEach((text) => expect(parseRowList(text)).toBeNull());
  });
});

describe('parseFrontRows', () => {
  it('blank means use the default; numbers are kept', () => {
    expect(parseFrontRows('')).toBeNull();
    expect(parseFrontRows('  ')).toBeNull();
    expect(parseFrontRows('4')).toBe(4);
    expect(parseFrontRows(' 12 ')).toBe(12);
  });

  it('rejects the rest', () => {
    ['0', '51', '-1', '2.5', 'a'].forEach((text) => expect(parseFrontRows(text)).toBeUndefined());
  });
});

describe('formatRowList', () => {
  it('is what parseRowList reads', () => {
    expect(formatRowList([21, 33])).toBe('21, 33');
    expect(parseRowList(formatRowList([21, 33]))).toEqual([21, 33]);
    expect(formatRowList(['A', 'K'])).toBe('A, K');
    expect(parseRowList(formatRowList(['A', 'K']))).toEqual(['A', 'K']);
  });
});

describe('storage', () => {
  it('keeps each venue under its own key', () => {
    expect(venueKey('197033')).toBe('venue:197033');
    expect(venueKey('197033').startsWith(VENUE_KEY_PREFIX)).toBe(true);
  });

  it('loads defaults for a venue that has nothing saved', async () => {
    expect(await loadVenue('1')).toEqual({ name: '', firstRows: [1], frontRows: null, badges: [] });
  });

  it('saves and loads a venue', async () => {
    await saveVenue('197033', { name: '3Arena, Dublin', firstRows: [21, 33], frontRows: 4 });
    expect(peekStorage('venue:197033')).toEqual({ name: '3Arena, Dublin', firstRows: [21, 33], frontRows: 4, badges: [] });
    expect(await loadVenue('197033')).toEqual({ name: '3Arena, Dublin', firstRows: [21, 33], frontRows: 4, badges: [] });
  });

  it('merges a patch into what is saved', async () => {
    await saveVenue('1', { name: 'A', firstRows: [21, 33] });
    await saveVenue('1', { frontRows: 3 });
    expect(await loadVenue('1')).toEqual({ name: 'A', firstRows: [21, 33], frontRows: 3, badges: [] });
  });

  it('saves a venue\'s badges, and keeps them when other settings are saved', async () => {
    const aisle = { id: 'a1', label: 'Aisle', icon: '🚶', color: 'blue', pattern: 'aisle' };
    await saveVenue('1', { name: 'A', badges: [aisle, { id: 'bad', label: 'X', pattern: '(' }] });
    expect((await loadVenue('1')).badges).toEqual([aisle]);

    await saveVenue('1', { firstRows: [21] });
    expect((await loadVenue('1')).badges).toEqual([aisle]);
    expect((await listVenues())[0].badges).toEqual([aisle]);
  });

  it('keeps venues apart', async () => {
    await saveVenue('1', { firstRows: [21] });
    await saveVenue('2', { firstRows: [7] });
    expect((await loadVenue('1')).firstRows).toEqual([21]);
    expect((await loadVenue('2')).firstRows).toEqual([7]);
  });

  it('sanitises what it saves and reads back', async () => {
    await saveVenue('1', { firstRows: [0, '?'], frontRows: -3 });
    expect(peekStorage('venue:1')).toEqual({ name: '', firstRows: [1], frontRows: null, badges: [] });
    seedStorage('venue:2', { firstRows: 'garbage' });
    expect((await loadVenue('2')).firstRows).toEqual([1]);
  });

  it('deletes a venue', async () => {
    await saveVenue('1', { firstRows: [21] });
    await deleteVenue('1');
    expect(peekStorage('venue:1')).toBeUndefined();
    expect((await loadVenue('1')).firstRows).toEqual([1]);
  });

  it('lists the saved venues by name, ignoring other settings', async () => {
    seedStorage({ sort: 'price', paneSide: 'left' });
    await saveVenue('2', { name: 'Zed Arena', firstRows: [3] });
    await saveVenue('1', { name: 'Alpha Hall', firstRows: [21, 33], frontRows: 4 });
    const list = await listVenues();
    expect(list.map((v) => v.id)).toEqual(['1', '2']);
    expect(list[0]).toEqual({ id: '1', name: 'Alpha Hall', firstRows: [21, 33], frontRows: 4, badges: [] });
  });

  it('reports which venues a storage change touched', async () => {
    const seen = [];
    chrome.storage.onChanged.addListener((changes) => seen.push(changes));
    await saveVenue('197033', { firstRows: [21, 33] });
    await saveSettingsLike();
    await flush();
    expect(changedVenueIds(seen[0])).toEqual(['197033']);
    expect(changedVenueIds(seen[1])).toEqual([]);

    async function saveSettingsLike() {
      await chrome.storage.local.set({ sort: 'price' });
    }
  });

  it('survives storage failing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(chrome.storage.local, 'get').mockRejectedValue(new Error('Extension context invalidated.'));
    expect(await loadVenue('1')).toEqual({ name: '', firstRows: [1], frontRows: null, badges: [] });
    expect(await listVenues()).toEqual([]);
    await expect(saveVenue('1', { firstRows: [2] })).resolves.toBeUndefined();
  });
});
