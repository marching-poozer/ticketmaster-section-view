// Custom badges: the user's own "tag a ticket when its text matches this pattern"
// rules, e.g. "Aisle" for /aisle/. They live in two places: globally (every venue)
// and per venue. Each shows as a badge on the tickets it matches and as a filter
// pill, just like the built-in ones.
//
// A badge is { id, label, icon, color, pattern }. `pattern` is a regular expression
// (always case-insensitive) tested against the ticket's text as Ticketmaster shows
// it: section, row, seat, ticket type ("Aisle Seating Ticket"), and so on, and also
// against the title Section View lists it under ("Row 23 (Aisle Seating Ticket)"),
// so a pattern written from either one works.

export const BADGE_KEY_PREFIX = 'custom:';
export const MAX_BADGES = 20;
export const MAX_LABEL = 24;
export const MAX_PATTERN = 200;
export const DEFAULT_ICON = '🔖';
export const DEFAULT_COLOR = 'teal';

// [background, text] pairs, in the same family as the built-in badges.
export const BADGE_COLORS = Object.freeze({
  teal: ['#e0f7f4', '#0b6b5f'],
  blue: ['#e8f0fe', '#1a73e8'],
  green: ['#e6f4ea', '#137333'],
  purple: ['#f3e8fd', '#6b21a8'],
  orange: ['#fef7e0', '#b06000'],
  red: ['#fce8e6', '#c5221f'],
  grey: ['#f1f3f4', '#5f6368'],
});

const ID_RE = /^[a-z0-9]{1,24}$/;

/** The filter key (what's saved in `badgeFilters`) for a badge id. */
export function badgeKey(id) {
  return BADGE_KEY_PREFIX + id;
}

export function isBadgeKey(key) {
  return typeof key === 'string' && key.startsWith(BADGE_KEY_PREFIX) && ID_RE.test(key.slice(BADGE_KEY_PREFIX.length));
}

/** A fresh id that isn't one of `taken`. */
export function newBadgeId(taken) {
  const used = new Set(taken || []);
  let id;
  do {
    id = Math.random().toString(36).slice(2, 10);
  } while (!id || used.has(id));
  return id;
}

/** [bg, text] for a colour name; unknown names get the default. */
export function colorPair(name) {
  return BADGE_COLORS[name] || BADGE_COLORS[DEFAULT_COLOR];
}

/** The text a badge shows: its icon (if any) and name. */
export function badgeText(badge) {
  return (badge.icon ? badge.icon + ' ' : '') + badge.label;
}

/** Compile a pattern: { regex } or { error } with a message fit to show the user. */
export function checkPattern(pattern) {
  const text = String(pattern == null ? '' : pattern);
  if (!text.trim()) return { error: 'Enter a pattern to match, e.g. aisle.' };
  if (text.length > MAX_PATTERN) return { error: 'The pattern can be at most ' + MAX_PATTERN + ' characters.' };
  try {
    return { regex: new RegExp(text, 'i') };
  } catch (err) {
    const why = String(err && err.message ? err.message : err).replace(/^Invalid regular expression: \/[\s\S]*\/[a-z]*: /, '');
    return { error: 'Not a valid pattern (' + why + ').' };
  }
}

/**
 * A warning for a pattern that is valid but probably not what was meant, or null.
 * ". *" (a space between the dot and the star) is "any one character, then any number
 * of spaces", not "anything": ".*" is what people mean.
 */
export function lintPattern(pattern) {
  const text = String(pattern == null ? '' : pattern);
  if (/(^|[^\\])\.[ \t]+[*+]/.test(text)) {
    return 'There is a space between "." and "*"/"+": that means any character followed by spaces. For "anything" write .* with no space.';
  }
  return null;
}

/** One valid badge, or null if `raw` isn't one (no id, no name, or a pattern that doesn't compile). */
export function normalizeBadge(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null;
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, MAX_LABEL) : '';
  if (!label) return null;
  if (typeof raw.pattern !== 'string' || checkPattern(raw.pattern).error) return null;
  return {
    id: raw.id,
    label,
    icon: typeof raw.icon === 'string' ? Array.from(raw.icon.trim()).slice(0, 3).join('') : DEFAULT_ICON,
    color: Object.prototype.hasOwnProperty.call(BADGE_COLORS, raw.color) ? raw.color : DEFAULT_COLOR,
    pattern: raw.pattern,
  };
}

/** A list of valid badges: bad entries and repeated ids dropped, at most MAX_BADGES. */
export function normalizeBadges(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  list.forEach(function (raw) {
    const badge = normalizeBadge(raw);
    if (!badge || seen.has(badge.id) || out.length >= MAX_BADGES) return;
    seen.add(badge.id);
    out.push(badge);
  });
  return out;
}

/**
 * Ready-to-run badges from any number of lists (global first, then the venue's):
 * [{ id, key, text, icon, label, color, pattern, regex }]. An id used twice keeps its first.
 */
export function compileBadges(...lists) {
  const seen = new Set();
  const out = [];
  lists.forEach(function (list) {
    normalizeBadges(list).forEach(function (badge) {
      if (seen.has(badge.id)) return;
      seen.add(badge.id);
      out.push(Object.assign({ key: badgeKey(badge.id), text: badgeText(badge), regex: checkPattern(badge.pattern).regex }, badge));
    });
  });
  return out;
}

/** The non-empty strings out of one text or a list of them. */
function texts(value) {
  return [].concat(value).filter(function (t) { return typeof t === 'string' && t; });
}

/** True if the regex matches any of the texts (a string, or a list of strings). Each is tested on its own, so `.*` never reaches from one into another. */
export function matchesAny(regex, value) {
  return texts(value).some(function (t) { return regex.test(t); });
}

/**
 * The compiled badges whose pattern matches `value` — one text, or a list of them (a ticket's
 * text on Ticketmaster and its title as Section View lists it); any one matching is enough.
 * Returns plain { key, text, color, pattern }.
 */
export function matchBadges(compiled, value) {
  return compiled
    .filter(function (b) { return matchesAny(b.regex, value); })
    .map(function (b) { return { key: b.key, text: b.text, color: b.color, pattern: b.pattern }; });
}
