// Per-venue settings. Row numbering differs between venues: some start at Row 1,
// others number straight on from one tier to the next (3Arena, Dublin: the lower
// tier starts at Row 21 and the upper tier at Row 33), so "the front rows" can't
// be read off the row number alone.
//
// Each venue is stored under its own key (`venue:<id>`) so edits to different
// venues, or from different tabs, can't overwrite each other.
import { LOG_PREFIX } from './constants.js';
import { normalizeBadges } from './custom-badges.js';
import { rowRank } from './tickets.js';

export const VENUE_KEY_PREFIX = 'venue:';
export const MAX_FRONT_ROWS = 50;
const MAX_ROW = 999;

export function venueKey(id) {
  return VENUE_KEY_PREFIX + id;
}

/**
 * Coerce stored data into a valid venue config:
 *   name:      display name
 *   firstRows: the row each tier starts at, in order: numbers ([21, 33]) or, for venues whose
 *              rows are lettered, letters (['A', 'K']); [1] = rows start at the beginning
 *   frontRows: how many rows from the front of each tier count as "front", or null for the default
 *   badges:    this venue's own custom badges (see custom-badges.js), on top of the global ones
 */
export function normalizeVenue(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const starts = Array.isArray(v.firstRows) ? v.firstRows.map(rowStart).filter(function (s) { return s !== null; }) : [];
  const firstRows = sortedUnique(starts);
  return {
    name: typeof v.name === 'string' ? v.name.slice(0, 120) : '',
    firstRows: firstRows.length > 0 ? firstRows : [1],
    frontRows: Number.isInteger(v.frontRows) && v.frontRows >= 1 ? Math.min(v.frontRows, MAX_FRONT_ROWS) : null,
    badges: normalizeBadges(v.badges),
  };
}

/**
 * One tier start: a row number (1-999) stays a number; a row letter ("k", "AA") becomes
 * upper case; anything else (including "GA", which isn't a row) is null.
 */
function rowStart(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1 && value <= MAX_ROW ? value : null;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (/^\d+$/.test(t)) return rowStart(parseInt(t, 10));
  if (/^[A-Za-z]{1,2}$/.test(t) && rowRank(t) !== null) return t.toUpperCase();
  return null;
}

/** In row order, with repeats (the same row as a number and a letter, say) dropped. */
function sortedUnique(starts) {
  const seen = new Set();
  return starts
    .filter(function (s) {
      const rank = rowRank(s);
      if (seen.has(rank)) return false;
      seen.add(rank);
      return true;
    })
    .sort(function (a, b) { return rowRank(a) - rowRank(b); });
}

/**
 * "21, 33" -> [21, 33]; "a, k" -> ['A', 'K']; "" -> [1]. Anything else, including a mix of
 * numbers and letters, -> null.
 */
export function parseRowList(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return [1];
  const starts = t.split(/[\s,;]+/).filter(Boolean).map(rowStart);
  if (starts.some(function (s) { return s === null; })) return null;
  const letters = starts.filter(function (s) { return typeof s === 'string'; }).length;
  if (letters > 0 && letters < starts.length) return null;
  return sortedUnique(starts);
}

/** "" -> null (use the default); "4" -> 4; invalid -> undefined. */
export function parseFrontRows(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = parseInt(t, 10);
  return n >= 1 && n <= MAX_FRONT_ROWS ? n : undefined;
}

export function formatRowList(firstRows) {
  return firstRows.join(', ');
}

export async function loadVenue(id) {
  try {
    const key = venueKey(id);
    const stored = await chrome.storage.local.get(key);
    return normalizeVenue(stored[key]);
  } catch (err) {
    console.warn(LOG_PREFIX + 'Could not load venue settings:', err);
    return normalizeVenue(null);
  }
}

/** Merge `patch` into the venue's saved config. Never throws. */
export async function saveVenue(id, patch) {
  try {
    const key = venueKey(id);
    const stored = await chrome.storage.local.get(key);
    await chrome.storage.local.set({ [key]: normalizeVenue(Object.assign({}, normalizeVenue(stored[key]), patch)) });
  } catch (err) {
    console.warn(LOG_PREFIX + 'Could not save venue settings:', err);
  }
}

export async function deleteVenue(id) {
  try {
    await chrome.storage.local.remove(venueKey(id));
  } catch (err) {
    console.warn(LOG_PREFIX + 'Could not remove venue settings:', err);
  }
}

/** Every saved venue: [{ id, name, firstRows, frontRows, badges }], by name. */
export async function listVenues() {
  try {
    const all = await chrome.storage.local.get(null);
    return Object.keys(all)
      .filter(function (k) { return k.startsWith(VENUE_KEY_PREFIX); })
      .map(function (k) { return Object.assign({ id: k.slice(VENUE_KEY_PREFIX.length) }, normalizeVenue(all[k])); })
      .sort(function (a, b) { return (a.name || a.id).localeCompare(b.name || b.id); });
  } catch (err) {
    console.warn(LOG_PREFIX + 'Could not list venues:', err);
    return [];
  }
}

/** The venue id a storage.onChanged `changes` object touches, or null if none. */
export function changedVenueIds(changes) {
  return Object.keys(changes)
    .filter(function (k) { return k.startsWith(VENUE_KEY_PREFIX); })
    .map(function (k) { return k.slice(VENUE_KEY_PREFIX.length); });
}
