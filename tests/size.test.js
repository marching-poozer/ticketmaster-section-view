import { headerScale, uiScale } from '../src/lib/size.js';

describe('uiScale', () => {
  it('compact is always the original size, whatever Ticketmaster measures', () => {
    expect(uiScale('compact', 18)).toBe(1);
    expect(uiScale('compact', null)).toBe(1);
  });

  it('match scales the text up to what Ticketmaster\'s cards measure', () => {
    expect(uiScale('match', 13)).toBe(1);
    expect(uiScale('match', 18)).toBe(1.38);
    expect(uiScale('match', 16)).toBe(1.23);
  });

  it('match falls back to a typical value when there is no card to measure', () => {
    expect(uiScale('match', null)).toBe(1.25);
    expect(uiScale('match', 0)).toBe(1.25);
    expect(uiScale('match', undefined)).toBe(1.25);
  });

  it('comfort is a bit larger than match', () => {
    expect(uiScale('comfort', 18)).toBeCloseTo(1.38 * 1.15, 1);
    expect(uiScale('comfort', 18)).toBeGreaterThan(uiScale('match', 18));
    expect(uiScale('comfort', null)).toBeGreaterThan(uiScale('match', null));
  });

  it('stays within sensible bounds if a measurement is silly', () => {
    expect(uiScale('match', 3)).toBe(0.9);
    expect(uiScale('match', 200)).toBe(1.9);
  });

  it('treats an unknown size as match', () => {
    expect(uiScale('whatever', 18)).toBe(uiScale('match', 18));
  });
});

describe('headerScale', () => {
  it('follows the list scale only part of the way, so the header does not take over the pane', () => {
    expect(headerScale(1)).toBe(1);
    expect(headerScale(1.38)).toBe(1.15);
    expect(headerScale(2)).toBe(1.4);
    expect(headerScale(1.38)).toBeLessThan(1.38);
  });

  it('shrinks a little with a smaller list scale', () => {
    expect(headerScale(0.9)).toBe(0.96);
  });
});
