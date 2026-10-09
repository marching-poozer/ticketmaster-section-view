import { API_PAUSE_MS, formatClock, isRefusal, pauseRemaining, pauseUntil } from '../src/lib/api-pause.js';

describe('isRefusal', () => {
  it('is Ticketmaster saying no: unauthorised, forbidden, too many requests', () => {
    [401, 403, 429, '403'].forEach((s) => expect(isRefusal(s)).toBe(true));
  });

  it('is not a hiccup worth retrying, or a good answer', () => {
    [200, 404, 500, 502, 503, undefined, null, NaN, 'oops'].forEach((s) => expect(isRefusal(s)).toBe(false));
  });
});

describe('pauseUntil / pauseRemaining', () => {
  it('a pause lasts a quarter of an hour from when it starts', () => {
    expect(API_PAUSE_MS).toBe(15 * 60 * 1000);
    expect(pauseUntil(1000)).toBe(1000 + API_PAUSE_MS);
  });

  it('says how long is left, and 0 once it is over', () => {
    const until = pauseUntil(0);
    expect(pauseRemaining(until, 0)).toBe(API_PAUSE_MS);
    expect(pauseRemaining(until, 60 * 1000)).toBe(API_PAUSE_MS - 60 * 1000);
    expect(pauseRemaining(until, until)).toBe(0);
    expect(pauseRemaining(until, until + 1)).toBe(0);
  });

  it('ignores a stored value that is not a pause of ours (nothing, junk, or a time too far off)', () => {
    [undefined, null, 0, 'soon', NaN].forEach((v) => expect(pauseRemaining(v, 5000)).toBe(0));
    expect(pauseRemaining(5000 + API_PAUSE_MS + 1, 5000)).toBe(0);
    expect(pauseRemaining(5000 + 10 * API_PAUSE_MS, 5000)).toBe(0); // a clock that moved must not pause us for good
  });
});

describe('formatClock', () => {
  it('is a 24-hour time of day', () => {
    expect(formatClock(new Date(2026, 9, 9, 14, 5).getTime())).toBe('14:05');
    expect(formatClock(new Date(2026, 9, 9, 7, 30).getTime())).toBe('07:30');
    expect(formatClock(new Date(2026, 9, 9, 0, 0).getTime())).toBe('00:00');
  });
});
