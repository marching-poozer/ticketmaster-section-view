// When Ticketmaster refuses our requests for its ticket list (HTTP 401 / 403 / 429: a bot
// defence or a rate limit) the right move is to stop asking: repeating a refused request
// doesn't turn it into an answer, and it can get the visitor's own session blocked too.
// So a refusal pauses the API for a while (and the page reader scrolls the list instead);
// one request is made after the pause, and if it is refused again the pause starts over.

export const API_PAUSE_KEY = 'apiPausedUntil';
export const API_PAUSE_MS = 15 * 60 * 1000;

const REFUSALS = [401, 403, 429];

/** Is this HTTP status Ticketmaster saying no (as opposed to a hiccup worth retrying)? */
export function isRefusal(status) {
  return REFUSALS.includes(Number(status));
}

/** When a pause that starts at `now` ends (ms since the epoch). */
export function pauseUntil(now) {
  return now + API_PAUSE_MS;
}

/**
 * How long is left of a stored pause: 0 once it is over. A stored time further off than a pause
 * can last is not one of ours (a clock that moved, a bad value), so it counts for nothing.
 */
export function pauseRemaining(until, now) {
  const left = Number(until) - now;
  return Number.isFinite(left) && left > 0 && left <= API_PAUSE_MS ? left : 0;
}

/** A time of day for a message: "14:05". */
export function formatClock(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
