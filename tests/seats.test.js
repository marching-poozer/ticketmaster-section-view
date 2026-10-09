import { describeSeats } from '../src/lib/seats.js';

const seats = (seat) => describeSeats({ seat });

describe('describeSeats', () => {
  it('says one seat in the singular, with no count', () => {
    expect(seats('187')).toEqual({ text: 'Seat 187', count: 1, countText: '' });
  });

  it('says a range in the plural, and how many seats it is', () => {
    expect(seats('187-188')).toEqual({ text: 'Seats 187-188', count: 2, countText: '(2 seats)' });
    expect(seats('10-13')).toEqual({ text: 'Seats 10-13', count: 4, countText: '(4 seats)' });
    expect(seats('1 – 3')).toMatchObject({ text: 'Seats 1 – 3', count: 3 });
  });

  it('counts a list of seats', () => {
    expect(seats('12, 14')).toEqual({ text: 'Seats 12, 14', count: 2, countText: '(2 seats)' });
    expect(seats('1,2,3')).toMatchObject({ count: 3, countText: '(3 seats)' });
  });

  it('is plural for a range or list it cannot count, with no count to show', () => {
    expect(seats('A1-A2')).toEqual({ text: 'Seats A1-A2', count: null, countText: '' });
    expect(seats('A1, A3')).toEqual({ text: 'Seats A1, A3', count: null, countText: '' });
  });

  it('is singular for a single seat it cannot count', () => {
    expect(seats('A12')).toEqual({ text: 'Seat A12', count: null, countText: '' });
  });

  it('does not count a "range" that goes backwards or is far too big', () => {
    expect(seats('20-10')).toMatchObject({ text: 'Seats 20-10', count: null, countText: '' });
    expect(seats('1-500')).toMatchObject({ count: null, countText: '' });
  });

  it('has nothing to say without seats', () => {
    [null, undefined, '', '   '].forEach((seat) => expect(seats(seat)).toBeNull());
    expect(describeSeats({})).toBeNull();
    expect(describeSeats(null)).toBeNull();
  });

  it('copes with a seat that is not a string', () => {
    expect(seats(187)).toEqual({ text: 'Seat 187', count: 1, countText: '' });
  });
});
