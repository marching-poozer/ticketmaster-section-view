import { DEFAULT_FRONT_ROWS, DEFAULT_PRICE_FILTER, DEFAULT_QUALITY_FILTER, DEFAULT_SEAT_FILTER, LOG_PREFIX, OTHER_FILTERS, PRICE_FILTERS, QUALITY_FILTERS, SEAT_FILTERS } from './constants.js';
import { isBadgeKey, normalizeBadges } from './custom-badges.js';
import { isAttributeKey } from './quickpicks.js';

const SORTS = ['row', 'price'];
const OTHER_KEYS = OTHER_FILTERS.map(function (b) { return b.key; });
const SEAT_KEYS = SEAT_FILTERS.map(function (b) { return b.key; });
const PRICE_KEYS = PRICE_FILTERS.map(function (b) { return b.key; });
const QUALITY_KEYS = QUALITY_FILTERS.map(function (b) { return b.key; });

// Where Section View is shown: 'inline' replaces Ticketmaster's own ticket list;
// 'pane' is a floating pane docked to a screen edge (also the fallback when
// inline can't find Ticketmaster's list).
export const DISPLAY_MODES = ['inline', 'pane'];
export const PANE_SIDES = ['left', 'right'];
// Text size: 'compact' is the dense original look, 'match' follows Ticketmaster's own list, 'comfort' is a bit larger than that.
export const UI_SIZES = ['compact', 'match', 'comfort'];
// How tickets are loaded: 'api' reads Ticketmaster's list API (and falls back to scrolling if it can't);
// 'scroll' scrolls Ticketmaster's list until everything has loaded.
export const LOAD_MODES = ['api', 'scroll'];
export const PANE_MIN_WIDTH = 280;
export const PANE_MAX_WIDTH = 900;
export const DEFAULT_PANE_WIDTH = 380;

export { DEFAULT_FRONT_ROWS };
export const MAX_FRONT_ROWS = 50;

export function clampPaneWidth(width) {
  return Math.min(PANE_MAX_WIDTH, Math.max(PANE_MIN_WIDTH, Math.round(width)));
}

// Badge keys that were renamed: "Top Row" (rows 1-5) became "Front Rows".
function renameBadge(key) {
  return key === 'toprow' ? 'frontrows' : key;
}

/** A key an "Other" pill can have: resale, an attribute from the list API, or one of the user's own badges. */
function isOtherKey(key) {
  return OTHER_KEYS.includes(key) || isBadgeKey(key) || isAttributeKey(key);
}

/** What the old multi-select pills meant for the seat choice: the narrowest of 1st Row / Front Rows that was on. */
function legacySeat(keys) {
  return keys.includes('firstrow') ? 'firstrow' : keys.includes('frontrows') ? 'frontrows' : DEFAULT_SEAT_FILTER;
}

/** ...and for the price choice. */
function legacyPrice(keys) {
  return keys.includes('cheapest') ? 'cheapest' : keys.includes('blockprice') ? 'sectionlow' : DEFAULT_PRICE_FILTER;
}

/**
 * Coerce a (possibly partial, possibly garbage) settings object into a valid
 * one. Unknown fields are dropped, invalid ones fall back to defaults.
 */
export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const legacy = Array.isArray(s.badgeFilters) ? s.badgeFilters.map(renameBadge) : [];
  // "Standing" used to be a choice in Seats; it is an "Other" pill now (showing only standing tickets, or hiding them).
  const showFilters = Array.from(new Set(legacy.filter(isOtherKey).concat(s.seatFilter === 'standing' ? ['standing'] : [])));
  return {
    // Section View on or off (the menu of the toolbar icon, and the options page). Off means it does nothing on the page.
    enabled: s.enabled !== false,
    sort: SORTS.includes(s.sort) ? s.sort : 'row',
    // The seat and price choices used to be pills among the others in `badgeFilters`: carry those over.
    seatFilter: SEAT_KEYS.includes(s.seatFilter) ? s.seatFilter : legacySeat(legacy),
    qualityFilter: QUALITY_KEYS.includes(s.qualityFilter) ? s.qualityFilter : DEFAULT_QUALITY_FILTER,
    priceFilter: PRICE_KEYS.includes(s.priceFilter) ? s.priceFilter : legacyPrice(legacy),
    badgeFilters: showFilters,
    // The "Other" pills can also hide the tickets that have them. A pill is one or the other, never both.
    hideFilters: Array.from(new Set((Array.isArray(s.hideFilters) ? s.hideFilters : []).filter(isOtherKey))).filter(function (k) { return !showFilters.includes(k); }),
    customBadges: normalizeBadges(s.customBadges),
    frontRows: Number.isFinite(s.frontRows) ? Math.min(MAX_FRONT_ROWS, Math.max(1, Math.round(s.frontRows))) : DEFAULT_FRONT_ROWS,
    displayMode: DISPLAY_MODES.includes(s.displayMode) ? s.displayMode : 'inline',
    uiSize: UI_SIZES.includes(s.uiSize) ? s.uiSize : 'match',
    loadMode: LOAD_MODES.includes(s.loadMode) ? s.loadMode : 'api',
    paneSide: PANE_SIDES.includes(s.paneSide) ? s.paneSide : 'right',
    paneWidth: Number.isFinite(s.paneWidth) ? clampPaneWidth(s.paneWidth) : DEFAULT_PANE_WIDTH,
    paneOpen: s.paneOpen === true,
  };
}

// Each setting is its own storage key, so writers in different places (a page,
// the options page) can't overwrite each other's changes with a stale copy.
const KEYS = Object.keys(normalizeSettings(null));
// Earlier versions kept everything in one object under this key.
const LEGACY_KEY = 'settings';

export async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get([LEGACY_KEY].concat(KEYS));
    const flat = {};
    KEYS.forEach(function (k) { if (k in stored) flat[k] = stored[k]; });
    return normalizeSettings(Object.assign({}, stored[LEGACY_KEY], flat));
  } catch (err) {
    console.warn(LOG_PREFIX + 'Could not load settings:', err);
    return normalizeSettings(null);
  }
}

/** Save only the keys in `patch` (each validated). Never throws, e.g. after the extension is reloaded under an open page. */
export async function saveSettings(patch) {
  try {
    const valid = normalizeSettings(patch);
    const items = {};
    Object.keys(patch).forEach(function (k) { if (KEYS.includes(k)) items[k] = valid[k]; });
    await chrome.storage.local.set(items);
  } catch (err) {
    console.warn(LOG_PREFIX + 'Could not save settings:', err);
  }
}

/** Apply a storage.onChanged `changes` object to the settings you already have. */
export function applySettingsChanges(current, changes) {
  const next = Object.assign({}, current);
  KEYS.forEach(function (k) { if (changes[k]) next[k] = changes[k].newValue; });
  return normalizeSettings(next);
}
