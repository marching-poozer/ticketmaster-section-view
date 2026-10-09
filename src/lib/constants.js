export const LOG_PREFIX = '[Section View]: ';

// Ticketmaster's own quantity stepper limits.
export const MIN_TICKETS = 1;
export const MAX_TICKETS = 8;

// Standing tickets have no row; they're parsed as this sentinel row number.
export const STANDING_ROW = 9999;
export const VIP_SECTION = 'VIP PACKAGES';

// The filter pills in the panel header, in groups. Seats, quality and price are each one choice, drawn as
// one pill split into segments (the first segment is "no filter"); the rest toggle on and off and combine.
// What is chosen is saved.
// How many rows count as the front of a tier, when nothing says otherwise (the options page and each venue can).
export const DEFAULT_FRONT_ROWS = 5;

/** The label of the "front rows" choice: it says how many rows that is. "⭐ First 3 Rows". */
export function frontRowsLabel(n) {
  return '⭐ First ' + n + (n === 1 ? ' Row' : ' Rows');
}

export const SEAT_FILTERS = [
  { key: 'all', label: 'Any' },
  { key: 'firstrow', label: '🥇 1st Row' },
  { key: 'frontrows', label: frontRowsLabel(DEFAULT_FRONT_ROWS) }, // the view swaps in the real number
];
// Seat quality (the list API's `quality` score), as a share of the event's tickets rather than a score,
// since what the scale means is not known: "Top 25%" is the best quarter of the tickets that have a score.
export const QUALITY_FILTERS = [
  { key: 'any', label: 'Any' },
  { key: 'top10', label: '💎 Top 10%' },
  { key: 'top25', label: '🌟 Top 25%' },
  { key: 'top50', label: '✨ Top 50%' },
];
// Whether a higher `quality` is a better seat. (Assumed, from the name: confirm against real data.)
export const HIGHER_QUALITY_IS_BETTER = true;
export const PRICE_FILTERS = [
  { key: 'any', label: 'Any' },
  { key: 'cheapest', label: '🔥 Cheapest' },
  { key: 'sectionlow', label: '💡 Section Low' },
];
// Built-in "Other" pills; attributes from the list API and the user's own badges are added to these. Each can show
// only its tickets or hide them, so hiding Standing is "seated tickets only".
export const OTHER_FILTERS = [
  { key: 'standing', label: '🧍 Standing' },
  { key: 'resale', label: '🔄 Resale' },
  { key: 'vip', label: '👑 VIP Packages' },
];
export const DEFAULT_SEAT_FILTER = 'all';
export const DEFAULT_QUALITY_FILTER = 'any';
export const DEFAULT_PRICE_FILTER = 'any';
