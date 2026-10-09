/**
 * Builders for Ticketmaster-style ticket cards in the jsdom document, modelled
 * on the real markup (see tests/fixtures/card-full-price.html).
 */
export function ariaLabelFor({ section, row, seat, price = 85, currency = '€', resale = false, packageTitle, labelKind }) {
  const kind = labelKind || (resale ? 'Verified Resale Ticket' : packageTitle || 'Full Price Ticket');
  const parts = ['Select ' + kind + ' ' + currency + price.toFixed(2)];
  if (section != null) parts.push('section ' + section);
  if (row != null && row !== '') parts.push('row ' + row);
  if (seat != null) parts.push('seat ' + seat);
  return parts.join(', ');
}

/**
 * Create a card but don't attach it. Options:
 *   section, row, seat, price, currency, resale, packageTitle, vipIcon,
 *   subtitle (a second line under the ticket type, e.g. "MCD Presale Ticket"),
 *   labelKind (the ticket type as it appears in the aria-label, if it differs from the visible one),
 *   dl (default true: render <dt>/<dd> pairs), ariaLabel (override)
 */
export function makeCard(opts = {}) {
  const { dl = true, vipIcon = false } = opts;
  const price = opts.price ?? 85;
  const currency = opts.currency ?? '€';
  const kind = opts.resale ? 'Verified Resale Ticket' : opts.packageTitle || 'Full Price Ticket';

  const card = document.createElement('div');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', opts.ariaLabel ?? ariaLabelFor(opts));

  if (dl) {
    const list = document.createElement('dl');
    [['Section', opts.section], ['Row', opts.row], ['Seat', opts.seat]].forEach(([label, value]) => {
      if (value == null || value === '') return;
      const item = document.createElement('div'); // the real markup wraps each dt/dd pair in a div
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = String(value);
      item.append(dt, ' ', dd);
      list.append(item);
    });
    card.append(list);
  }

  const info = document.createElement('div');
  info.setAttribute('data-testid', 'ticketTypeInfo');
  const title = document.createElement('span');
  title.textContent = kind;
  const each = document.createElement('span');
  each.textContent = currency + price.toFixed(2) + ' each';
  info.append(title);
  if (opts.subtitle) {
    const sub = document.createElement('span');
    sub.textContent = opts.subtitle;
    info.append(sub);
  }
  info.append(each);
  card.append(info);

  if (vipIcon) {
    const icon = document.createElement('svg');
    icon.setAttribute('class', 'BaseSvg-sc-yh8lnd-0 StarCircledFilledIcon___StyledBaseSvg-sc-qrtrcy-0 dgQliw'); // as on the live site
    card.append(icon);
  }

  return card;
}

export function addCards(...optsList) {
  const cards = optsList.map((o) => makeCard(o));
  document.body.append(...cards);
  return cards;
}

/** A "Loaded X of Y" progress label like Ticketmaster's. */
export function addLoadedLabel(loaded, total) {
  const span = document.createElement('span');
  span.className = 'sc-bb065817-4';
  span.textContent = `Loaded ${loaded} of ${total}`;
  document.body.append(span);
  return span;
}
