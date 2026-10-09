// Everything that reads from or pokes at Ticketmaster's own page: ticket-count
// status, scrolling to lazy-load more tickets, the quantity stepper, and clicks.
// Selectors here (including the hashed styled-components class names) are the
// fragile part — when Ticketmaster changes its markup, this is the file to fix.
import { LOG_PREFIX, MAX_TICKETS, MIN_TICKETS } from '../lib/constants.js';
import { containsPrice } from '../lib/currency.js';
import { CARD_SELECTOR, VIP_ICON_SELECTOR } from '../lib/tickets.js';

export function getCards() {
  return Array.from(document.querySelectorAll(CARD_SELECTOR));
}

/**
 * Click like a user would: the pointer/mouse sequence, ending in exactly ONE
 * click. Ticketmaster's handlers react to a plain dispatched click, and they
 * *navigate* (each activation pushes a history entry), so anything that
 * activates an element more than once makes you press Back that many times.
 * Never add a second route to a click here (`element.click()` after a
 * dispatched click, calling a React handler directly, clicking a child).
 */
export function clickElement(element) {
  if (!element) {
    console.warn(LOG_PREFIX + 'Attempted to click null/undefined element.');
    return;
  }

  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) {
    try {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    } catch (e) {
      console.error(LOG_PREFIX + 'Event dispatch error:', e);
    }
  });
}

const LOADED_RE = /Loaded\s+(\d+)\s+of\s+(\d+)/i;

// The results header says how many tickets there are ("84 results available",
// "<strong>84</strong>results for:") before the "Loaded X of Y" footer shows up.
function getHeaderTotal() {
  const scope = document.getElementById('quickpicks');
  if (!scope) return 0;
  const sources = Array.from(scope.querySelectorAll('[role="status"], h2'));
  for (let i = 0; i < sources.length; i++) {
    const match = sources[i].textContent.match(/(\d+)\s*results?\b/i);
    if (match) return parseInt(match[1], 10);
  }
  return 0;
}

/**
 * Ticketmaster's "Loaded X of Y" progress (the footer of the list, which only
 * appears once the end has been reached). Until then the total comes from the
 * results header, and the load counts as incomplete unless every result is
 * already on the page.
 */
export function getLoadedStatus() {
  const scope = document.getElementById('quickpicks') || document;
  const loadedElem =
    scope.querySelector('.sc-bb065817-4') ||
    scope.querySelector('[class*="eZZjLL"]') ||
    Array.from(scope.querySelectorAll('span')).find(function (s) {
      return LOADED_RE.test(s.textContent);
    });

  const text = loadedElem ? loadedElem.textContent.trim() : '';
  const match = text.match(LOADED_RE);
  if (match) {
    const loaded = parseInt(match[1], 10);
    const total = parseInt(match[2], 10);
    return { loaded, total, isComplete: loaded >= total };
  }

  const loaded = getCards().length;
  const total = getHeaderTotal();
  return { loaded, total, isComplete: total > 0 && loaded >= total };
}

/**
 * The event's venue, from the link under the event title
 * (`<a href="/3arena-tickets-dublin/venue/197033">3Arena, Dublin</a>`): { id, name },
 * or null. The id is what per-venue settings are saved under.
 */
export function findVenue() {
  const scope = document.getElementById('header') || document;
  const link = scope.querySelector('a[href*="/venue/"]') || document.querySelector('a[href*="/venue/"]');
  const match = link && /\/venue\/(\d+)/.exec(link.getAttribute('href') || '');
  return match ? { id: match[1], name: link.textContent.trim() } : null;
}

/**
 * Ticketmaster's own sort: 'price' (e.g. "Lowest Price") or 'row' ("Best Seats"),
 * or null if it can't be read (no control, or a label we don't know). The sort
 * control is the button with the "exchange arrows" icon in the results header.
 */
export function getPageSort() {
  const root = document.getElementById('quickpicks');
  const icon = root && root.querySelector('[class*="ArrowExchangeIcon"]');
  const button = icon && icon.closest('button');
  return button ? sortModeFromLabel(button.textContent) : null;
}

/** "Lowest Price" -> 'price', "Best Seats" -> 'row', anything else -> null. */
export function sortModeFromLabel(label) {
  const text = String(label || '').trim().toLowerCase();
  if (/price/.test(text)) return 'price';
  if (/seat|best/.test(text)) return 'row';
  return null;
}

/** Font size in px of the text on Ticketmaster's ticket cards (the section/row values), or null. */
export function measureTicketTextPx() {
  const card = document.querySelector(CARD_SELECTOR);
  const el = card && (card.querySelector('dd') || card);
  if (!el) return null;
  const px = parseFloat(window.getComputedStyle(el).fontSize);
  return Number.isFinite(px) && px > 0 ? px : null;
}

/**
 * The blocks above the ticket list inside `#quickpicks` (upsell banner, results
 * header with sort and chips, delivery note): the children before the one that
 * holds the list.
 */
export function findHeaderBlocks(list) {
  const root = document.getElementById('quickpicks');
  if (!root || !list) return [];
  const blocks = [];
  for (const child of Array.from(root.children)) {
    if (child.contains(list)) return blocks;
    blocks.push(child);
  }
  return []; // the list isn't directly below #quickpicks' children: unknown layout
}

/**
 * The "VIP Packages  €197.45–€329.40 each  Show Tickets" summary row at the top
 * of the list. It's a real <button> (not a ticket card) that expands the VIP
 * packages in place. Returns { element, title, range } or null.
 */
export function findVipRow() {
  const list = document.querySelector('[data-testid="quickpicksList"]');
  if (!list) return null;

  const button = Array.from(list.querySelectorAll('button')).find(function (b) {
    return b.querySelector(VIP_ICON_SELECTOR) !== null;
  });
  if (!button) return null;

  const texts = Array.from(button.querySelectorAll('span'))
    .filter(function (s) { return !s.querySelector('span'); })
    .map(function (s) { return s.textContent.trim(); })
    .filter(Boolean);
  const range = texts.find(containsPrice) || '';
  const title = texts.find(function (t) { return t !== range; }) || 'VIP Packages';
  return { element: button, title, range };
}

/** Set on the list's scroller by the inline host while it holds it locked (overflow: hidden), so it is still known as the scroller. */
export const SCROLLER_ATTR = 'data-tmsv-scroller';

function scrollsByItself(el) {
  const overflowY = window.getComputedStyle(el).getPropertyValue('overflow-y');
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay' || el.hasAttribute(SCROLLER_ATTR);
}

/**
 * What to scroll to load more of the list: the list's own scrollers, meaning the ancestors of its cards that
 * scroll by themselves (overflow auto / scroll, or the one the inline host has locked). Never the others: an
 * `overflow: hidden` wrapper with a taller map in it can be scrolled from script, which shoves the whole page up
 * (and the document itself, taller than the window, goes down to its footer): the page went white and redrew
 * on every step of the loop. The document is the scroller only if nothing else is.
 */
export function findScrollContainers() {
  const found = new Set();

  ['#quickpicks-list', '[data-testid="quickpicksList"]'].forEach(function (sel) {
    const el = document.querySelector(sel);
    if (el) found.add(el);
  });

  const firstCard = document.querySelector(CARD_SELECTOR);
  let scrollers = 0;
  if (firstCard) {
    let parent = firstCard.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      if (scrollsByItself(parent)) {
        found.add(parent);
        scrollers++;
      }
      parent = parent.parentElement;
    }
  }

  if (scrollers === 0) found.add(document.scrollingElement || document.documentElement);

  return Array.from(found);
}

/** The page itself (not an element in it) is what scrolls. */
function isDocumentScroller(container) {
  return container === document.scrollingElement || container === document.documentElement || container === document.body;
}

export function scrollToTopAllContainers() {
  console.log(LOG_PREFIX + 'Resetting scroll to top...');

  findScrollContainers().forEach(function (container) {
    container.scrollTop = 0;
    if (isDocumentScroller(container)) window.scrollTo(0, 0);
  });
}

/** One step of the lazy-load scroll: push the list's scroller(s) to the bottom, and nothing else. */
export function scrollToLoadMore() {
  findScrollContainers().forEach(function (container) {
    if (isDocumentScroller(container)) {
      window.scrollTo(0, document.body ? document.body.scrollHeight : 0);
    } else {
      container.scrollTop = container.scrollHeight;
    }

    try {
      container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 2000, view: window }));
    } catch (e) {
      // WheelEvent construction isn't essential to loading more tickets.
    }
  });
}

export function getActiveQuantity() {
  const spinbutton =
    document.querySelector('[role="spinbutton"]') ||
    document.querySelector('[aria-label*="quantity of tickets"]') ||
    document.querySelector('.Stepper__Option-sc-umihb3-1');

  if (spinbutton) {
    const valNow = spinbutton.getAttribute('aria-valuenow');
    if (valNow && !isNaN(parseInt(valNow, 10))) return parseInt(valNow, 10);

    const txtVal = spinbutton.textContent.trim();
    if (txtVal && !isNaN(parseInt(txtVal, 10))) return parseInt(txtVal, 10);
  }

  const buttons = Array.from(document.querySelectorAll('button'));
  for (let i = 0; i < buttons.length; i++) {
    const match = (buttons[i].textContent || '').match(/^(\d+)\s*Ticket/i);
    if (match) return parseInt(match[1], 10);
  }

  return 1;
}

/**
 * Step Ticketmaster's own quantity control up or down, opening its filter
 * dropdown first if needed. `onStepped` runs after the page has had time to
 * react. Returns false (and does nothing) when the step would leave 1–8.
 */
export function stepQuantity(delta, onStepped) {
  const target = getActiveQuantity() + delta;
  if (target < MIN_TICKETS || target > MAX_TICKETS) return false;

  // The "2 Tickets" filter chip. (Other chips, e.g. "All Ticket Types", also
  // mention tickets and are expandable, so look for the count first.)
  const buttons = Array.from(document.querySelectorAll('button'));
  const qtyFilterBtn =
    buttons.find(function (b) { return /^\s*\d+\s*tickets?\b/i.test(b.textContent || ''); }) ||
    buttons.find(function (b) {
      const txt = b.textContent || '';
      return txt.toLowerCase().includes('ticket') && (b.getAttribute('aria-expanded') !== null || /\d+\s*ticket/i.test(txt));
    });

  function runStep() {
    const plusBtn =
      document.querySelector('.Stepper__PlusButton-sc-umihb3-3') ||
      document.querySelector('[data-testid="quantityStepper"] button:last-child') ||
      document.querySelector('button[class*="Stepper__PlusButton"]');

    const minusBtn =
      document.querySelector('.Stepper__MinusButton-sc-umihb3-2') ||
      document.querySelector('[data-testid="quantityStepper"] button:first-child') ||
      document.querySelector('button[class*="Stepper__MinusButton"]');

    const targetBtn = delta > 0 ? plusBtn : minusBtn;
    if (!targetBtn) return;

    clickElement(targetBtn);

    setTimeout(onStepped, 500);
  }

  if (qtyFilterBtn && qtyFilterBtn.getAttribute('aria-expanded') !== 'true') {
    clickElement(qtyFilterBtn);
    setTimeout(runStep, 250);
  } else {
    runStep();
  }
  return true;
}
