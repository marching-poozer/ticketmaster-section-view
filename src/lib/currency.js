// Prices as Ticketmaster writes them across its domains: "€80.75", "£1,234.50",
// "80,75 €", "1.234,50 €", "CHF 80.00", "kr 800". Currency symbols and ISO
// codes are matched from fixed lists (not "any capitals") so a word like "VIP"
// next to a number can't be mistaken for a currency.
const CODES = [
  'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'AUD', 'NZD', 'CAD', 'USD', 'GBP', 'EUR',
  'MXN', 'BRL', 'CLP', 'ARS', 'ZAR', 'SGD', 'HKD', 'TRY', 'AED', 'MYR', 'THB', 'JPY',
];
// Letters-only tokens must not start in the middle of a word; symbols can (A$120).
const CURRENCY = '(?:[€£$¥₺₪₹₩₽]|R\\$|(?<![A-Za-z])(?:kr\\.?|zł|Kč|Ft|' + CODES.join('|') + '))';
// Digits with optional thousands/decimal separators (incl. no-break and thin spaces, and ' as in Swiss prices).
const AMOUNT = '\\d(?:[\\d.,\\u00a0\\u202f\']*\\d)?';

const BEFORE = new RegExp('(' + CURRENCY + ')\\s?(' + AMOUNT + ')');
const AFTER = new RegExp('(' + AMOUNT + ')\\s?(' + CURRENCY + ')(?![A-Za-z])');

/** "1,234.50" and "1.234,50" and "80,75" and "1'234" -> a number. */
function toNumber(raw) {
  let s = raw.replace(/[  ']/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');

  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes last is the decimal separator.
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    const last = parts[parts.length - 1];
    // A single separator followed by 1-2 digits is a decimal point; anything
    // else (three digits, or repeated) groups thousands.
    s = parts.length === 2 && last.length <= 2 ? parts[0] + '.' + last : parts.join('');
  }
  return parseFloat(s);
}

/**
 * Pull the first price out of a string such as an aria-label.
 * Returns { amount, currency } (currency as written: "€", "CHF", ...) or null.
 */
export function parsePrice(text) {
  const str = text || '';
  const before = BEFORE.exec(str);
  const match = before ? { currency: before[1], raw: before[2] } : null;
  const after = match ? null : AFTER.exec(str);
  const found = match || (after ? { currency: after[2], raw: after[1] } : null);
  if (!found) return null;

  const amount = toNumber(found.raw);
  return Number.isNaN(amount) ? null : { amount, currency: found.currency };
}

/** True if the text contains a price (used to skip price lines when looking for a ticket's name). */
export function containsPrice(text) {
  return parsePrice(text) !== null;
}

export function formatPrice(amount, currency) {
  // Codes and words read better with a space: "CHF 80.00", "kr 800.00".
  const sep = /[A-Za-z.]$/.test(currency) ? ' ' : '';
  return currency + sep + amount.toFixed(2);
}
