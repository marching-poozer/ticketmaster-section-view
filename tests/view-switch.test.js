import { createViewSwitch, VIEW_SECTION, VIEW_TICKETS } from '../src/content/view-switch.js';
import { buildTicketmasterPage } from './helpers/tm-layout.js';

let sw;
let onChange;

function make() {
  onChange = vi.fn();
  sw = createViewSwitch({ onChange });
  return sw;
}

afterEach(() => {
  if (sw) sw.unmount();
  sw = null;
});

const toolbar = () => document.querySelector('[role="toolbar"]');
const chips = () => [...toolbar().querySelectorAll('button')];
const ourChip = () => toolbar().querySelector('[data-tmsv-chip]');
const menuHost = () => document.getElementById('tmsv-view-menu-host');
const menu = () => menuHost().shadowRoot.querySelector('.menu');
const items = () => [...menu().querySelectorAll('button')];
const chipText = () => ourChip().textContent.trim();
const key = (target, k) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, composed: true }));

describe('the chip', () => {
  it('goes at the end of Ticketmaster\'s own chips, labelled with the current view', () => {
    buildTicketmasterPage();
    const before = chips().length;
    make().mount(toolbar(), VIEW_SECTION);

    expect(chips()).toHaveLength(before + 1);
    expect(toolbar().lastElementChild).toBe(ourChip());
    expect(chipText()).toBe('By Section');
  });

  it('is a copy of one of Ticketmaster\'s chips, so it gets the same look from the page\'s own stylesheet', () => {
    buildTicketmasterPage();
    const original = chips()[chips().length - 1];
    make().mount(toolbar(), VIEW_SECTION);

    expect(ourChip().className).toBe(original.className);
    expect(ourChip().querySelector('svg')).not.toBeNull(); // the chevron
  });

  it('does not inherit anything that belongs to the chip it was copied from', () => {
    buildTicketmasterPage();
    chips()[0].setAttribute('aria-controls', '_r_9_');
    chips()[0].id = 'some-id';
    chips().forEach((c) => c.setAttribute('aria-controls', '_r_9_'));
    make().mount(toolbar(), VIEW_SECTION);

    expect(ourChip().hasAttribute('aria-controls')).toBe(false);
    expect(ourChip().hasAttribute('id')).toBe(false);
    expect(ourChip().getAttribute('aria-haspopup')).toBe('menu');
    expect(ourChip().getAttribute('aria-expanded')).toBe('false');
    expect(ourChip().getAttribute('tabindex')).toBe('0');
  });

  it('says "Tickets" when Ticketmaster\'s own list is the one showing', () => {
    buildTicketmasterPage();
    make().mount(toolbar(), VIEW_TICKETS);
    expect(chipText()).toBe('Tickets');
  });

  it('is idempotent: mounting again changes nothing in the page', async () => {
    buildTicketmasterPage();
    make().mount(toolbar(), VIEW_SECTION);
    const records = [];
    const observer = new MutationObserver((r) => records.push(...r));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    sw.mount(toolbar(), VIEW_SECTION);
    sw.mount(toolbar(), VIEW_SECTION);
    await Promise.resolve();

    expect(records).toHaveLength(0);
    expect(toolbar().querySelectorAll('[data-tmsv-chip]')).toHaveLength(1);
  });

  it('follows the view as mount() is called with it', () => {
    buildTicketmasterPage();
    make().mount(toolbar(), VIEW_SECTION);
    sw.mount(toolbar(), VIEW_TICKETS);
    expect(chipText()).toBe('Tickets');
    sw.mount(toolbar(), VIEW_SECTION);
    expect(chipText()).toBe('By Section');
  });

  it('moves to the new toolbar when Ticketmaster re-renders its chips', () => {
    buildTicketmasterPage();
    make().mount(toolbar(), VIEW_SECTION);
    const oldToolbar = toolbar();

    buildTicketmasterPage();
    sw.mount(toolbar(), VIEW_SECTION);

    expect(oldToolbar.querySelector('[data-tmsv-chip]')).toBeNull();
    expect(toolbar().lastElementChild).toBe(ourChip());
    expect(document.querySelectorAll('[data-tmsv-chip]')).toHaveLength(1);
  });

  it('keeps to the end if Ticketmaster adds a chip after it', () => {
    buildTicketmasterPage();
    make().mount(toolbar(), VIEW_SECTION);
    const extra = document.createElement('button');
    toolbar().append(extra);
    sw.mount(toolbar(), VIEW_SECTION);
    expect(toolbar().lastElementChild).toBe(ourChip());
  });

  it('reports that there is nowhere to go when there is no toolbar, and removes itself', () => {
    buildTicketmasterPage();
    make().mount(toolbar(), VIEW_SECTION);
    expect(sw.mount(null, VIEW_SECTION)).toBe(false);
    expect(document.querySelector('[data-tmsv-chip]')).toBeNull();
    expect(sw.isMounted()).toBe(false);
  });

  it('works even if the toolbar has no chip to copy', () => {
    document.body.innerHTML = '<div role="toolbar"></div>';
    make().mount(toolbar(), VIEW_SECTION);
    expect(chipText()).toBe('By Section');
  });

  it('unmount removes the chip and any open menu', () => {
    buildTicketmasterPage();
    make().mount(toolbar(), VIEW_SECTION);
    ourChip().click();
    expect(menuHost()).not.toBeNull();

    sw.unmount();

    expect(ourChip()).toBeNull();
    expect(menuHost()).toBeNull();
    expect(sw.isMounted()).toBe(false);
  });
});

describe('the menu', () => {
  function open() {
    buildTicketmasterPage();
    make().mount(toolbar(), VIEW_SECTION);
    ourChip().click();
  }

  it('opens on click with the two views, the current one checked', () => {
    open();
    expect(items().map((i) => i.textContent.replace('✓', '').trim())).toEqual(['Tickets', 'By Section']);
    expect(items().map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    expect(items()[1].textContent).toContain('✓');
    expect(ourChip().getAttribute('aria-expanded')).toBe('true');
  });

  it('is drawn at the top of the page, not inside Ticketmaster\'s toolbar (so nothing can clip it)', () => {
    open();
    expect(menuHost().parentElement).toBe(document.body);
    expect(menuHost().style.position).toBe('fixed');
    expect(toolbar().contains(menuHost())).toBe(false);
  });

  it('opens just under the chip', () => {
    buildTicketmasterPage();
    make().mount(toolbar(), VIEW_SECTION);
    ourChip().getBoundingClientRect = () => ({ top: 300, bottom: 336, left: 380, right: 480, width: 100, height: 36 });
    ourChip().click();
    expect(menuHost().style.top).toBe('342px');
    expect(menuHost().style.left).toBe('380px');
  });

  it('puts the keyboard focus on the current view', () => {
    open();
    expect(menuHost().shadowRoot.activeElement).toBe(items()[1]);
  });

  it('choosing the other view closes the menu, relabels the chip and reports it', () => {
    open();
    items()[0].click();

    expect(menuHost()).toBeNull();
    expect(chipText()).toBe('Tickets');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(VIEW_TICKETS);
    expect(ourChip().getAttribute('aria-expanded')).toBe('false');
  });

  it('choosing the current view just closes it', () => {
    open();
    items()[1].click();
    expect(menuHost()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clicking the chip again closes it', () => {
    open();
    ourChip().click();
    expect(menuHost()).toBeNull();
  });

  it('closes when you click elsewhere, but not when you click in the menu or on the chip', () => {
    open();
    menuHost().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    items()[0].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    ourChip().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    expect(menuHost()).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(menuHost()).toBeNull();
  });

  it('closes when the window is resized', () => {
    open();
    window.dispatchEvent(new Event('resize'));
    expect(menuHost()).toBeNull();
  });

  it('stays open through scrolling that does not move the chip (Ticketmaster\'s list being scrolled behind the scenes)', () => {
    buildTicketmasterPage();
    make().mount(toolbar(), VIEW_SECTION);
    ourChip().getBoundingClientRect = () => ({ top: 329, bottom: 359, left: 825, right: 933, width: 108, height: 30 });
    ourChip().click();

    document.querySelector('#quickpicks').dispatchEvent(new Event('scroll', { bubbles: false })); // captured by window
    window.dispatchEvent(new Event('scroll'));
    expect(menuHost()).not.toBeNull();
  });

  it('closes when the chip moved: the page scrolled it away', () => {
    buildTicketmasterPage();
    make().mount(toolbar(), VIEW_SECTION);
    let top = 329;
    ourChip().getBoundingClientRect = () => ({ top, bottom: top + 30, left: 825, right: 933, width: 108, height: 30 });
    ourChip().click();

    top = 129; // scrolled up by 200px
    window.dispatchEvent(new Event('scroll'));
    expect(menuHost()).toBeNull();
  });

  it('is only ever open once', () => {
    open();
    ourChip().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.querySelectorAll('#tmsv-view-menu-host')).toHaveLength(1);
  });
});

describe('keyboard', () => {
  function setup() {
    buildTicketmasterPage();
    make().mount(toolbar(), VIEW_SECTION);
  }

  it('ArrowDown on the chip opens the menu', () => {
    setup();
    key(ourChip(), 'ArrowDown');
    expect(menuHost()).not.toBeNull();
  });

  it('arrow keys move through the items and wrap round', () => {
    setup();
    ourChip().click();
    const active = () => menuHost().shadowRoot.activeElement;
    expect(active()).toBe(items()[1]);

    key(active(), 'ArrowDown');
    expect(active()).toBe(items()[0]);
    key(active(), 'ArrowUp');
    expect(active()).toBe(items()[1]);
    key(active(), 'Home');
    expect(active()).toBe(items()[0]);
    key(active(), 'End');
    expect(active()).toBe(items()[1]);
  });

  it('Escape closes the menu and puts the focus back on the chip', () => {
    setup();
    document.body.focus();
    ourChip().click();
    key(items()[0], 'Escape');

    expect(menuHost()).toBeNull();
    expect(document.activeElement).toBe(ourChip());
  });

  it('Tab closes the menu', () => {
    setup();
    ourChip().click();
    key(items()[0], 'Tab');
    expect(menuHost()).toBeNull();
  });

  it('keys on the chip do not reach Ticketmaster\'s toolbar handlers', () => {
    setup();
    const seen = vi.fn();
    toolbar().addEventListener('keydown', seen);
    ['ArrowRight', 'ArrowLeft', 'Home', 'Enter', 'x'].forEach((k) => key(ourChip(), k));
    expect(seen).not.toHaveBeenCalled();
  });

  it('clicks on the chip do not reach Ticketmaster\'s toolbar handlers either', () => {
    setup();
    const seen = vi.fn();
    toolbar().addEventListener('click', seen);
    ourChip().click();
    expect(seen).not.toHaveBeenCalled();
  });
});
