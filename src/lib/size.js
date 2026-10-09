// How big Section View's text is, relative to its original dense layout.
//
//   compact: the original look (scale 1).
//   match:   the same size as the text on Ticketmaster's own ticket cards,
//            measured from the page; falls back to a typical value when no card
//            is on the page to measure.
//   comfort: a little larger than match.
//
// The list text scales fully; the header's controls scale only part of the way
// so they don't take over the pane (see headerScale).

// Our section-heading text at scale 1, in px: what a card's section/row text is compared against.
const BASE_TEXT_PX = 13;
const FALLBACK_MATCH_SCALE = 1.25;
const MIN_SCALE = 0.9;
const MAX_SCALE = 1.9;
const COMFORT_FACTOR = 1.15;
// 0 = header controls never scale, 1 = they scale like the list.
const HEADER_FOLLOWS = 0.4;

/** Scale for the list text. `tmTextPx` is Ticketmaster's card text size in px, or null if unknown. */
export function uiScale(size, tmTextPx) {
  if (size === 'compact') return 1;

  const raw = tmTextPx > 0 ? tmTextPx / BASE_TEXT_PX : FALLBACK_MATCH_SCALE;
  const match = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
  const scale = size === 'comfort' ? match * COMFORT_FACTOR : match;
  return Math.round(scale * 100) / 100;
}

/** Scale for the header's controls, given the list scale. */
export function headerScale(scale) {
  return Math.round((1 + (scale - 1) * HEADER_FOLLOWS) * 100) / 100;
}
