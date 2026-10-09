// The "By Section / Tickets" dropdown: one more chip at the end of Ticketmaster's
// own filter chips ("2 Tickets", "All Prices", "All Ticket Types") that switches
// between our view ("By Section") and Ticketmaster's own list ("Tickets").
//
// The chip is a clone of one of Ticketmaster's chips, so it inherits their exact
// look from the page's own stylesheet. The menu it opens is drawn separately, at
// the top level of the page, so no scrolling or clipping container can cut it off.
import { h } from '../lib/dom.js';

export const VIEW_SECTION = 'section';
export const VIEW_TICKETS = 'tickets';

const LABELS = { [VIEW_SECTION]: 'By Section', [VIEW_TICKETS]: 'Tickets' };
const OPTIONS = [
  { value: VIEW_TICKETS, label: 'Tickets' },
  { value: VIEW_SECTION, label: 'By Section' },
];
const MENU_ID = 'tmsv-view-menu-host';
const FONT = 'Averta, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

const MENU_CSS = `
  :host { all: initial; }
  .menu {
    box-sizing: border-box; min-width: 11em; padding: 6px; background: #fff; color: #121212;
    border: 1px solid #d0d0d0; border-radius: 14px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.2);
    font: 400 var(--fs, 16px)/1.3 ${FONT};
  }
  button {
    all: unset; display: flex; align-items: center; gap: 0.6em; width: 100%; box-sizing: border-box;
    padding: 0.55em 0.8em; border-radius: 10px; cursor: pointer; white-space: nowrap;
  }
  button:hover, button:focus-visible { background: #f2f2f2; }
  button:focus-visible { outline: 2px solid #026cdf; outline-offset: -2px; }
  .check { width: 1em; color: #026cdf; font-weight: 700; }
  button[aria-checked="true"] { font-weight: 700; }
`;

/** `onChange(value)` is called with VIEW_SECTION or VIEW_TICKETS when the user picks the other one. */
export function createViewSwitch({ onChange }) {
  let chip = null;
  let menu = null; // { host, items, cleanup }
  let current = VIEW_SECTION;

  function updateLabel() {
    if (!chip) return;
    const text = LABELS[current] + ' ';
    const span = chip.querySelector('span');
    if (span) {
      if (span.textContent !== text) span.textContent = text;
    } else if (chip.firstChild === null || chip.firstChild.nodeType !== 3 || chip.firstChild.textContent !== text) {
      chip.prepend(document.createTextNode(text));
    }
  }

  function build(toolbar) {
    // Clone the last of Ticketmaster's chips for its styling; this is a copy of
    // the markup only, so none of its behaviour comes along.
    const template = Array.from(toolbar.querySelectorAll('button')).filter(function (b) { return !b.hasAttribute('data-tmsv-chip'); }).pop();
    const el = template ? template.cloneNode(true) : h('button', { type: 'button' }, h('span'));
    ['id', 'aria-controls', 'aria-labelledby', 'aria-describedby'].forEach(function (a) { el.removeAttribute(a); });
    el.setAttribute('data-tmsv-chip', '1');
    el.setAttribute('type', 'button');
    el.setAttribute('aria-haspopup', 'menu');
    el.setAttribute('aria-expanded', 'false');
    el.setAttribute('tabindex', '0');
    el.addEventListener('click', onChipClick);
    el.addEventListener('keydown', onChipKeydown);
    return el;
  }

  // --- the menu -------------------------------------------------------------------

  function close(refocus) {
    if (!menu) return;
    const { host, cleanup } = menu;
    menu = null;
    cleanup();
    host.remove();
    if (chip) {
      chip.setAttribute('aria-expanded', 'false');
      if (refocus) chip.focus();
    }
  }

  function choose(value) {
    close(true);
    if (value === current) return;
    current = value;
    updateLabel();
    onChange(value);
  }

  function moveFocus(items, from, step) {
    const next = (from + step + items.length) % items.length;
    items[next].focus();
  }

  function onMenuKeydown(e) {
    const items = menu.items;
    const at = items.indexOf(e.target.closest('button'));
    if (e.key === 'ArrowDown') moveFocus(items, at, 1);
    else if (e.key === 'ArrowUp') moveFocus(items, at, -1);
    else if (e.key === 'Home') items[0].focus();
    else if (e.key === 'End') items[items.length - 1].focus();
    else if (e.key === 'Escape') close(true);
    else if (e.key === 'Tab') close(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function open() {
    if (menu || !chip) return;

    const items = OPTIONS.map(function (option) {
      const selected = option.value === current;
      return h(
        'button',
        {
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': String(selected),
          'data-value': option.value,
          on: { click: function () { choose(option.value); } },
        },
        h('span', { class: 'check', text: selected ? '✓' : '' }),
        h('span', { text: option.label })
      );
    });
    const list = h('div', { class: 'menu', role: 'menu', 'aria-label': 'List view', on: { keydown: onMenuKeydown } }, items);

    const host = h('div', { id: MENU_ID });
    host.attachShadow({ mode: 'open' }).append(h('style', { text: MENU_CSS }), list);
    list.style.setProperty('--fs', window.getComputedStyle(chip).fontSize || '16px');

    const rect = chip.getBoundingClientRect();
    host.style.cssText = 'position:fixed;z-index:2147483647;top:' + Math.round(rect.bottom + 6) + 'px;left:' + Math.round(rect.left) + 'px;';
    document.body.append(host);

    // Keep it on screen.
    const width = list.getBoundingClientRect().width;
    if (width && rect.left + width > window.innerWidth - 8) host.style.left = Math.max(8, Math.round(window.innerWidth - width - 8)) + 'px';

    function onOutside(e) {
      const path = e.composedPath ? e.composedPath() : [];
      if (path.includes(chip) || path.includes(host)) return;
      close(false);
    }
    function onDismiss() { close(false); }
    // Scroll events come from everywhere, including Ticketmaster's own list being
    // scrolled by the page reader behind the scenes. Only a scroll that actually
    // moved the chip (so the menu is no longer under it) should close the menu.
    function onScroll() {
      const now = chip.getBoundingClientRect();
      if (Math.abs(now.top - rect.top) > 1 || Math.abs(now.left - rect.left) > 1) close(false);
    }
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('scroll', onScroll, true);

    menu = {
      host,
      items,
      cleanup() {
        document.removeEventListener('pointerdown', onOutside, true);
        window.removeEventListener('resize', onDismiss);
        window.removeEventListener('scroll', onScroll, true);
      },
    };
    chip.setAttribute('aria-expanded', 'true');
    (items.find(function (i) { return i.getAttribute('data-value') === current; }) || items[0]).focus();
  }

  // --- the chip ---------------------------------------------------------------------

  function onChipClick(e) {
    // The chip lives inside Ticketmaster's toolbar; its handlers are none of its business.
    e.stopPropagation();
    e.preventDefault();
    if (menu) close(true);
    else open();
  }

  function onChipKeydown(e) {
    e.stopPropagation(); // Ticketmaster's toolbar has its own arrow-key handling
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      open();
    } else if (e.key === 'Escape' && menu) {
      e.preventDefault();
      close(true);
    }
  }

  return {
    /**
     * Put the chip at the end of `toolbar` (Ticketmaster's row of filter chips),
     * showing `view`. Safe to call repeatedly. Returns false (and removes any
     * chip) when there is no toolbar to put it in.
     */
    mount(toolbar, view) {
      current = view;
      if (!toolbar) {
        this.unmount();
        return false;
      }
      if (!chip) chip = build(toolbar);
      // Only touch the DOM when something is actually out of place.
      if (chip.parentElement !== toolbar || toolbar.lastElementChild !== chip) toolbar.append(chip);
      updateLabel();
      return true;
    },

    unmount() {
      close(false);
      if (chip) chip.remove();
      chip = null;
    },

    isMounted() {
      return !!chip && chip.isConnected;
    },
  };
}
