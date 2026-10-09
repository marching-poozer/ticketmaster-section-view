// How a ticket's seats read on its card: "Seat 187", "Seats 187-188 (2 seats)".

const MAX_COUNTED = 99; // a "range" bigger than this is more likely two numbers that aren't a range

/**
 * { text, count, countText } for a ticket's `seat` ("187-188", "12", "12, 14", "A1-A2"), or null when it has none.
 * `text` is "Seat 12" for one seat and "Seats 187-188" for more, `count` how many (null when it can't
 * be told: "A1-A2"), `countText` "(2 seats)" when there is more than one, else ''.
 */
export function describeSeats(ticket) {
  const seat = String(ticket && ticket.seat != null ? ticket.seat : '').trim();
  if (!seat) return null;

  let count = null;
  const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(seat);
  if (range) {
    const from = parseInt(range[1], 10);
    const to = parseInt(range[2], 10);
    if (to >= from && to - from < MAX_COUNTED) count = to - from + 1;
  } else if (/^\d+$/.test(seat)) {
    count = 1;
  } else if (/^\d+(\s*,\s*\d+)+$/.test(seat)) {
    count = seat.split(',').length;
  }

  // Plural when there are several seats; when that can't be counted, a range or a list still means several.
  const several = count !== null ? count > 1 : /[-–,]/.test(seat);
  return {
    text: (several ? 'Seats ' : 'Seat ') + seat,
    count,
    countText: count !== null && count > 1 ? '(' + count + ' seats)' : '',
  };
}
