import { containsPrice, formatPrice, parsePrice } from '../src/lib/currency.js';

describe('parsePrice', () => {
  it('reads euro, pound and dollar prices with the symbol in front', () => {
    expect(parsePrice('Select, €85.50 each')).toEqual({ amount: 85.5, currency: '€' });
    expect(parsePrice('Select, £120.00')).toEqual({ amount: 120, currency: '£' });
    expect(parsePrice('Select, $9.99')).toEqual({ amount: 9.99, currency: '$' });
    expect(parsePrice('Select Full Price Ticket €80.75, section BLOCKG, row 26')).toEqual({ amount: 80.75, currency: '€' });
  });

  it('strips thousands separators', () => {
    expect(parsePrice('€1,234.50')).toEqual({ amount: 1234.5, currency: '€' });
    expect(parsePrice('£1,234,567.00')).toEqual({ amount: 1234567, currency: '£' });
    expect(parsePrice('€1,234')).toEqual({ amount: 1234, currency: '€' });
  });

  it('uses the first price when several appear', () => {
    expect(parsePrice('£50.00 incl. €60.00')).toEqual({ amount: 50, currency: '£' });
  });

  it('reads prices with the symbol after the number, as on the continental sites', () => {
    expect(parsePrice('Standardticket 80,75 €')).toEqual({ amount: 80.75, currency: '€' });
    expect(parsePrice('Billet 80,75€')).toEqual({ amount: 80.75, currency: '€' });
    expect(parsePrice('Entrada 80.75 €')).toEqual({ amount: 80.75, currency: '€' });
  });

  it('reads European thousands and decimals', () => {
    expect(parsePrice('1.234,50 €')).toEqual({ amount: 1234.5, currency: '€' });
    expect(parsePrice('1\u00a0234,50\u00a0€')).toEqual({ amount: 1234.5, currency: '€' });
    expect(parsePrice('€1.234')).toEqual({ amount: 1234, currency: '€' });
    expect(parsePrice("CHF 1'234.50")).toEqual({ amount: 1234.5, currency: 'CHF' });
  });

  it('reads currency codes and short symbols', () => {
    expect(parsePrice('Ticket CHF 80.00')).toEqual({ amount: 80, currency: 'CHF' });
    expect(parsePrice('Ticket 800,00 SEK')).toEqual({ amount: 800, currency: 'SEK' });
    expect(parsePrice('Ticket kr 800')).toEqual({ amount: 800, currency: 'kr' });
    expect(parsePrice('Ticket 450 zł')).toEqual({ amount: 450, currency: 'zł' });
    expect(parsePrice('Ticket A$120.50')).toEqual({ amount: 120.5, currency: '$' });
  });

  it('prefers a symbol in front over a number that happens to precede one', () => {
    expect(parsePrice('row 26 €80.75')).toEqual({ amount: 80.75, currency: '€' });
  });

  it('does not take ordinary words or counts for a price', () => {
    expect(parsePrice('Select VIP 100 package')).toBeNull();
    expect(parsePrice('2 Tickets')).toBeNull();
    expect(parsePrice('section BLOCKG, row 26')).toBeNull();
  });

  it('returns null when there is no price', () => {
    expect(parsePrice('Select, Section 101')).toBeNull();
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
    expect(parsePrice('€.')).toBeNull();
  });
});

describe('containsPrice', () => {
  it('tells price lines from names', () => {
    expect(containsPrice('€80.75 each')).toBe(true);
    expect(containsPrice('80,75 € pro Ticket')).toBe(true);
    expect(containsPrice('Full Price Ticket')).toBe(false);
    expect(containsPrice('Trivium Meet & Greet Package')).toBe(false);
  });
});

describe('formatPrice', () => {
  it('prefixes the symbol and uses two decimals', () => {
    expect(formatPrice(85, '€')).toBe('€85.00');
    expect(formatPrice(9.5, '£')).toBe('£9.50');
  });

  it('puts a space after codes and words', () => {
    expect(formatPrice(80, 'CHF')).toBe('CHF 80.00');
    expect(formatPrice(800, 'kr')).toBe('kr 800.00');
  });
});
