// Everything wired together on one jsdom page: settings -> app -> inline / pane.
import { initDisplay } from '../src/content/display.js';
import { MSG } from '../src/lib/protocol.js';
import { saveSettings } from '../src/lib/settings.js';
import { saveVenue } from '../src/lib/venues.js';
import { makeCard } from './helpers/cards.js';
import { buildTicketmasterPage } from './helpers/tm-layout.js';
import { chrome, flush, peekStorage, seedStorage } from './mocks/chrome.js';

let display;

async function start(settings) {
  if (settings) seedStorage(settings);
  display = await initDisplay();
  return display;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  if (display) display.destroy();
  display = null;
});

const settle = (ms = 200) => vi.advanceTimersByTimeAsync(ms);
const inlineHost = () => document.getElementById('tmsv-inline-host');
const paneHost = () => document.getElementById('tmsv-pane-host');
const paneWrap = () => paneHost().shadowRoot.querySelector('.wrap');
const inlineText = () => inlineHost().shadowRoot.querySelector('.sv-content').textContent;
const toolbar = () => chrome.runtime.onMessage.dispatch({ type: MSG.TOGGLE_VIEW }, {});
const chip = () => document.querySelector('#quickpicks [role="toolbar"] [data-tmsv-chip]');

describe('inline mode (the default)', () => {
  it('replaces Ticketmaster\'s list inside its pane, with no floating pane', async () => {
    const { main } = buildTicketmasterPage();
    await start();

    expect(inlineHost().parentElement).toBe(main);
    expect(paneHost()).toBeNull();
    expect(inlineHost().shadowRoot.querySelector('.version').textContent).toBe('v1.0.0');
    expect(inlineText()).toContain('Section BLOCKG');
  });

  it('has no VIP packages banner: from the list API the packages are in the list, and the VIP pill filters them', async () => {
    buildTicketmasterPage();
    await start(); // reading the API is the default
    expect(inlineHost().shadowRoot.querySelector('.vip-row')).toBeNull();
    expect(inlineHost().shadowRoot.querySelector('[data-badge="vip"]').textContent).toContain('VIP Packages');
  });

  it('scrolling the cards, it opens Ticketmaster\'s VIP row itself instead, so there is still no banner', async () => {
    buildTicketmasterPage();
    const vipButton = document.querySelector('[data-testid="quickpicksList"] button');
    const clicked = vi.fn();
    vipButton.addEventListener('click', clicked);
    const label = Array.from(document.querySelectorAll('span, div')).find((e) => !e.children.length && /^Loaded \d+ of \d+$/.test(e.textContent.trim()));
    label.textContent = 'Loaded 84 of 84'; // the list has loaded
    await start({ loadMode: 'scroll' });

    expect(clicked).toHaveBeenCalledTimes(1);
    expect(inlineHost().shadowRoot.querySelector('.vip-row')).toBeNull();
    expect(inlineHost().shadowRoot.querySelector('[data-badge="vip"]').textContent).toContain('VIP Packages');
  });

  it('uses the compact layout, with the way back to Ticketmaster\'s list on its own chip', async () => {
    buildTicketmasterPage();
    await start();
    const root = inlineHost().shadowRoot;
    expect(root.querySelector('.sv').classList.contains('compact')).toBe(true);
    expect(root.querySelector('.original-row').hidden).toBe(true); // the chip does that job
    expect(chip().textContent.trim()).toBe('By Section');
  });

  it('the chip switches between our view and Ticketmaster\'s list', async () => {
    buildTicketmasterPage();
    await start();

    chip().click();
    document.getElementById('tmsv-view-menu-host').shadowRoot.querySelector('[data-value="tickets"]').click();
    expect(inlineHost()).toBeNull();
    expect(chip().textContent.trim()).toBe('Tickets');

    chip().click();
    document.getElementById('tmsv-view-menu-host').shadowRoot.querySelector('[data-value="section"]').click();
    expect(inlineHost()).not.toBeNull();
    expect(chip().textContent.trim()).toBe('By Section');
  });

  it('is toggled by the toolbar icon: Ticketmaster\'s list and back', async () => {
    buildTicketmasterPage();
    await start();

    toolbar();
    expect(inlineHost()).toBeNull();
    expect(chip().textContent.trim()).toBe('Tickets');
    toolbar();
    expect(inlineHost().dataset.mode).toBe('view');
    expect(chip().textContent.trim()).toBe('By Section');
    expect(paneHost()).toBeNull();
  });

  it('hides while a ticket is selected and returns afterwards', async () => {
    buildTicketmasterPage();
    await start();
    const dialog = document.createElement('div');
    dialog.id = 'quickpicks-detail';
    document.getElementById('main-content').append(dialog);
    await settle();
    expect(inlineHost()).toBeNull();

    dialog.remove();
    await settle();
    expect(inlineHost()).not.toBeNull();
  });
});

describe('falling back to the pane', () => {
  it('shows the floating pane when Ticketmaster\'s list is not on the page, after a short wait', async () => {
    document.body.innerHTML = '<div>homepage</div>';
    await start({ paneSide: 'left', paneOpen: true });

    await settle(1000);
    expect(paneHost()).toBeNull();

    await settle(2500);
    expect(paneHost()).not.toBeNull();
    expect(paneWrap().dataset.side).toBe('left');
    expect(paneWrap().dataset.open).toBe('true');
    expect(inlineHost()).toBeNull();
  });

  it('hands over to inline as soon as Ticketmaster\'s list appears, and back again when it goes', async () => {
    document.body.innerHTML = '<div>homepage</div>';
    await start();
    await settle(3000);
    expect(paneHost()).not.toBeNull();

    buildTicketmasterPage();
    await settle(300);
    expect(paneHost()).toBeNull();
    expect(inlineHost()).not.toBeNull();

    document.body.innerHTML = '<div>homepage again</div>';
    await settle(3500);
    expect(inlineHost()).toBeNull();
    expect(paneHost()).not.toBeNull();
  });

  it('never shows both at once', async () => {
    document.body.innerHTML = '<div>homepage</div>';
    await start();
    const both = () => !!inlineHost() && !!paneHost();
    for (let i = 0; i < 12; i++) {
      await settle(500);
      expect(both()).toBe(false);
    }
    buildTicketmasterPage();
    for (let i = 0; i < 6; i++) {
      await settle(100);
      expect(both()).toBe(false);
    }
  });

  it('the toolbar icon opens and closes the pane while it is the one showing', async () => {
    document.body.innerHTML = '<div>homepage</div>';
    await start();
    await settle(3000);
    expect(paneWrap().dataset.open).toBe('false');

    toolbar();
    expect(paneWrap().dataset.open).toBe('true');
    toolbar();
    expect(paneWrap().dataset.open).toBe('false');
  });

  it('moves the same view between the two hosts', async () => {
    document.body.innerHTML = '<div>homepage</div>';
    await start();
    await settle(3000);
    const root = paneHost().shadowRoot.querySelector('.sv');

    buildTicketmasterPage();
    await settle(300);
    expect(inlineHost().shadowRoot.querySelector('.sv')).toBe(root);
  });
});

describe('pane mode', () => {
  it('always uses the floating pane, even where Ticketmaster\'s list is present', async () => {
    buildTicketmasterPage();
    await start({ displayMode: 'pane', paneOpen: true, paneSide: 'left', paneWidth: 500 });

    expect(inlineHost()).toBeNull();
    expect(paneWrap().dataset.open).toBe('true');
    expect(paneWrap().dataset.side).toBe('left');
    expect(paneWrap().style.getPropertyValue('--w')).toBe('500px');
    expect(paneHost().shadowRoot.querySelector('.sv-content').textContent).toContain('Section BLOCKG');
  });

  it('opens on the tab and remembers it', async () => {
    buildTicketmasterPage();
    await start({ displayMode: 'pane' });
    paneHost().shadowRoot.querySelector('.tab').click();
    expect(paneWrap().dataset.open).toBe('true');
    await flush();
    expect(peekStorage('paneOpen')).toBe(true);
  });

  it('the toolbar icon toggles the pane', async () => {
    buildTicketmasterPage();
    await start({ displayMode: 'pane' });
    toolbar();
    expect(paneWrap().dataset.open).toBe('true');
  });

  it('moves to the other side when the setting changes', async () => {
    buildTicketmasterPage();
    await start({ displayMode: 'pane', paneOpen: true });
    await saveSettings({ paneSide: 'left' });
    await flush();
    expect(paneWrap().dataset.side).toBe('left');
    expect(paneWrap().dataset.open).toBe('true');
  });
});

describe('switching display mode in the settings', () => {
  it('inline -> pane -> inline', async () => {
    buildTicketmasterPage();
    await start();
    expect(inlineHost()).not.toBeNull();

    await saveSettings({ displayMode: 'pane' });
    await flush();
    expect(inlineHost()).toBeNull();
    expect(paneHost()).not.toBeNull();

    await saveSettings({ displayMode: 'inline' });
    await flush();
    await settle(300);
    expect(paneHost()).toBeNull();
    expect(inlineHost()).not.toBeNull();
  });

  it('ignores unrelated settings changes', async () => {
    buildTicketmasterPage();
    await start();
    const before = inlineHost();
    await saveSettings({ sort: 'price', paneWidth: 600 });
    await flush();
    expect(inlineHost()).toBe(before);
  });
});

describe('switched off (the toolbar icon\'s menu, or the options page)', () => {
  const tmList = () => document.getElementById('quickpicks-list').parentElement;
  const nothingOfOurs = () => {
    expect(inlineHost()).toBeNull();
    expect(paneHost()).toBeNull();
    expect(chip()).toBeNull();
    expect(getComputedStyle(tmList()).display).not.toBe('none');
  };

  it('starts with nothing on the page and Ticketmaster\'s own list untouched', async () => {
    buildTicketmasterPage();
    await start({ enabled: false });
    await settle(500);
    nothingOfOurs();
  });

  it('starts with nothing on the page in pane mode too', async () => {
    buildTicketmasterPage();
    await start({ enabled: false, displayMode: 'pane', paneOpen: true });
    await settle(500);
    nothingOfOurs();
  });

  it('ignores the toolbar icon while it is off', async () => {
    buildTicketmasterPage();
    await start({ enabled: false });
    expect(() => toolbar()).not.toThrow();
    await settle(300);
    nothingOfOurs();
  });

  it('appears when switched on, without reloading the page', async () => {
    buildTicketmasterPage();
    await start({ enabled: false });
    await saveSettings({ enabled: true });
    await flush();
    await settle(300);
    expect(inlineHost()).not.toBeNull();
    expect(inlineText()).toContain('Section BLOCKG');
    expect(chip()).not.toBeNull();
  });

  it('goes away when switched off, and gives Ticketmaster\'s list back as it was', async () => {
    buildTicketmasterPage();
    await start();
    await settle(300);
    expect(inlineHost()).not.toBeNull();

    await saveSettings({ enabled: false });
    await flush();
    await settle(300);
    nothingOfOurs();
  });

  it('takes the floating pane away too (as the fallback, and in pane mode)', async () => {
    document.body.innerHTML = '<p>no Ticketmaster list here</p>';
    await start();
    await settle(3500); // long enough for the pane to stand in
    expect(paneHost()).not.toBeNull();
    await saveSettings({ enabled: false });
    await flush();
    expect(paneHost()).toBeNull();

    buildTicketmasterPage();
    await saveSettings({ displayMode: 'pane', enabled: true });
    await flush();
    expect(paneHost()).not.toBeNull();
    await saveSettings({ enabled: false });
    await flush();
    expect(paneHost()).toBeNull();
  });

  it('comes back, switched on again, with the settings changed in the meantime', async () => {
    buildTicketmasterPage();
    await start();
    await saveSettings({ enabled: false });
    await flush();
    await saveSettings({ uiSize: 'compact', displayMode: 'pane', paneSide: 'left' });
    await flush();
    nothingOfOurs();

    await saveSettings({ enabled: true });
    await flush();
    expect(inlineHost()).toBeNull(); // pane mode now
    expect(paneWrap().dataset.side).toBe('left');
  });

  it('can be switched off and on again many times without leaving anything behind', async () => {
    buildTicketmasterPage();
    await start();
    for (let i = 0; i < 4; i++) {
      await saveSettings({ enabled: false });
      await flush();
      await settle(100);
      nothingOfOurs();
      await saveSettings({ enabled: true });
      await flush();
      await settle(300);
      expect(document.querySelectorAll('#tmsv-inline-host')).toHaveLength(1);
      expect(document.querySelectorAll('[data-tmsv-chip]')).toHaveLength(1);
    }
  });

  it('the toolbar icon works again once it is switched back on', async () => {
    buildTicketmasterPage();
    await start();
    await saveSettings({ enabled: false });
    await flush();
    await saveSettings({ enabled: true });
    await flush();
    await settle(300);
    toolbar();
    expect(inlineHost()).toBeNull(); // over to Ticketmaster's list
    expect(chip().textContent.trim()).toBe('Tickets');
    toolbar();
    expect(inlineHost().dataset.mode).toBe('view');
  });
});

describe('the venue\'s seat map on the page', () => {
  const SVG = 'http://www.w3.org/2000/svg';
  /** Ticketmaster's pane (sections BLOCKG and BLOCKA) and a map with a block for each, one for a section we don't have, and one greyed. */
  function pageWithMap() {
    buildTicketmasterPage();
    document.querySelector('[data-testid="quickpicksList"]').append(makeCard({ section: 'BLOCKA', row: 3, price: 130 })); // the pane has BLOCKG; this is a second section
    const label = Array.from(document.querySelectorAll('span, div')).find((e) => !e.children.length && /^Loaded \d+ of \d+$/.test(e.textContent.trim()));
    label.textContent = 'Loaded 84 of 84'; // the whole list has loaded: only then is "no tickets left" worth showing
    document.body.insertAdjacentHTML('beforeend',
      '<svg data-component="svg" viewBox="0 0 1000 800"><g class="polygons">' +
      '<path data-component="svg__section" data-section-id="s_1" data-section-name="BLOCKG" data-active="true" d="M0 0L10 0L10 10z"></path>' +
      '<path data-component="svg__section" data-section-id="s_2" data-section-name="BLOCKA" data-active="true" d="M20 0L30 0L30 10z"></path>' +
      '<path data-component="svg__section" data-section-id="s_3" data-section-name="BLOCKZ" data-active="true" d="M40 0L50 0L50 10z"></path>' +
      '<path data-component="svg__section" data-section-id="s_4" data-section-name="BLOCKY" data-active="false" d="M60 0L70 0L70 10z"></path>' +
      '</g></svg>');
    return document.querySelector('svg[data-component="svg"]');
  }
  const block = (name) => document.querySelector(`path[data-component="svg__section"][data-section-name="${name}"]`);
  const overlay = () => document.querySelector('svg > g[data-tmsv-overlay]');
  const veiled = () => Array.from(overlay().querySelectorAll('path[fill-opacity]')).map((p) => p.getAttribute('d'));
  const listSection = (name) => inlineHost().shadowRoot.querySelector(`.section[data-section="${name}"]`);
  const search = (text) => {
    const input = inlineHost().shadowRoot.querySelector('.search');
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('veils the blocks our filters leave empty, and the blocks with no tickets at all, and nothing else', async () => {
    pageWithMap();
    await start({ loadMode: 'scroll' });
    await settle(1200);
    // every section of ours has its block, so the linking is complete: BLOCKZ, which the map shows as available but no section
    // of ours is called after, has no tickets in the list and is greyed from the start. BLOCKY is greyed by the map itself.
    expect(veiled()).toEqual([block('BLOCKZ').getAttribute('d')]);

    search('BLOCKA'); // only BLOCKA is left in our list
    await settle(1200);
    expect(veiled().sort()).toEqual([block('BLOCKG').getAttribute('d'), block('BLOCKZ').getAttribute('d')].sort());
    search('');
    await settle(1200);
    expect(veiled()).toEqual([block('BLOCKZ').getAttribute('d')]);
  });

  it('says in our header what the grey blocks mean, while there are any', async () => {
    pageWithMap();
    await start({ loadMode: 'scroll' });
    await settle(1200);
    const note = () => inlineHost().shadowRoot.querySelector('.map-note');
    expect(note().textContent).toBe('Seat map: 1 block greyed: no tickets there with the current filters.'); // BLOCKZ: no tickets at all

    search('BLOCKA');
    await settle(1200);
    expect(note().hidden).toBe(false);
    expect(note().textContent).toBe('Seat map: 2 blocks greyed: no tickets there with the current filters.');
    search('');
    await settle(1200);
    expect(note().textContent).toBe('Seat map: 1 block greyed: no tickets there with the current filters.');
  });

  it('outlines the block of a closed section the mouse is on in the list, and sends the map the hover for its tooltip', async () => {
    pageWithMap();
    await start({ loadMode: 'scroll' });
    await settle(1200);
    const seen = [];
    ['mouseover', 'mouseenter', 'click'].forEach((t) => block('BLOCKA').addEventListener(t, (e) => seen.push(t + (e.tmsv ? '*' : ''))));
    listSection('BLOCKA').dispatchEvent(new MouseEvent('mouseenter'));
    expect(Array.from(overlay().querySelectorAll('path[stroke]')).map((p) => p.getAttribute('d'))).toEqual([block('BLOCKA').getAttribute('d')]);
    await settle(200);
    expect(seen).toEqual(['mouseover*', 'mouseenter*']);
    listSection('BLOCKA').dispatchEvent(new MouseEvent('mouseleave'));
    expect(overlay().querySelectorAll('path[stroke]')).toHaveLength(0);
  });

  it('opens the block when the mouse rests on an open section', async () => {
    pageWithMap();
    await start({ loadMode: 'scroll' });
    await settle(1200);
    const clicks = [];
    block('BLOCKA').addEventListener('click', (e) => clicks.push(e.tmsv === true));
    listSection('BLOCKA').open = true;
    listSection('BLOCKA').dispatchEvent(new MouseEvent('mouseenter'));
    await settle(200);
    expect(clicks).toEqual([]);
    await settle(400);
    expect(clicks).toEqual([true]);
  });

  it('lights up the section in the list when the mouse is on its block, and opens it when the block is clicked', async () => {
    pageWithMap();
    await start({ loadMode: 'scroll' });
    await settle(1200);
    block('BLOCKA').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(listSection('BLOCKA').classList.contains('map-hover')).toBe(true);
    block('BLOCKA').dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    expect(listSection('BLOCKA').classList.contains('map-hover')).toBe(false);

    expect(listSection('BLOCKA').open).toBe(false);
    block('BLOCKA').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(listSection('BLOCKA').open).toBe(true);
  });

  it('can be switched off in the settings, which takes its veil off at once', async () => {
    pageWithMap();
    await start({ loadMode: 'scroll' });
    await settle(1200);
    search('BLOCKA');
    await settle(1200);
    expect(veiled()).toHaveLength(2);
    await saveSettings({ mapLink: false });
    await flush();
    expect(document.querySelector('[data-tmsv-overlay]')).toBeNull();
    await saveSettings({ mapLink: true });
    await flush();
    await settle(1200);
    expect(veiled()).toHaveLength(2);
  });

  it('takes its overlay off the map when Section View is switched off or destroyed', async () => {
    pageWithMap();
    await start({ loadMode: 'scroll' });
    await settle(1200);
    search('BLOCKA');
    await settle(1200);
    expect(overlay()).not.toBeNull();
    await saveSettings({ enabled: false });
    await flush();
    expect(document.querySelector('[data-tmsv-overlay]')).toBeNull();
    await saveSettings({ enabled: true });
    await flush();
    await settle(1200);
    expect(overlay()).not.toBeNull();
    display.destroy();
    expect(document.querySelector('[data-tmsv-overlay]')).toBeNull();
  });

  describe('the Map report button', () => {
    const shadow = () => inlineHost().shadowRoot;
    const button = () => shadow().querySelector('.map-report');
    const labels = () => Array.from(document.querySelectorAll('svg > g[data-tmsv-overlay] text')).map((t) => t.textContent);
    let written;

    beforeEach(() => {
      written = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async (t) => { written.push(t); }) } });
      vi.spyOn(console, 'log').mockImplementation(() => {});
      // jsdom has no geometry: give the blocks a box, as a browser does
      Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value: function () { return { x: 1, y: 1, width: 10, height: 10 }; } });
    });

    afterEach(() => {
      delete SVGElement.prototype.getBBox;
      delete navigator.clipboard;
    });

    it('copies a report of how the list and the map were matched, and says so', async () => {
      pageWithMap();
      await start({ loadMode: 'scroll' });
      await settle(1200);
      search('BLOCKA');
      await settle(1200);
      button().click();
      await settle(50);
      expect(written).toHaveLength(1);
      const report = JSON.parse(written[0]);
      expect(report.filters.search).toBe('blocka'); // as the app keeps it
      expect(report.tickets).toMatchObject({ shown: 1 });
      expect(report.map.linkingComplete).toBe(true);
      expect(report.map.blocks.find((b) => b.name === 'BLOCKG')).toMatchObject({ section: 'BLOCKG' });
      expect(report.map.blocks.find((b) => b.name === 'BLOCKG').state).toMatch(/^greyed/);
      expect(report.map.sections.map((s) => s.name).sort()).toEqual(['BLOCKA', 'BLOCKG']);
      expect(button().textContent).toMatch(/^Copied/);
    });

    it('also prints it in the console, for a browser that will not let it be copied', async () => {
      pageWithMap();
      await start({ loadMode: 'scroll' });
      await settle(1200);
      navigator.clipboard.writeText = vi.fn(async () => { throw new Error('denied'); });
      button().click();
      await settle(50);
      expect(console.log.mock.calls.some((c) => /Map report:/.test(String(c[0])))).toBe(true);
      expect(button().textContent).toMatch(/^In the console/);
    });

    it('labels the blocks on the map for a while, then takes the labels away', async () => {
      pageWithMap();
      await start({ loadMode: 'scroll' });
      await settle(1200);
      expect(labels()).toEqual([]);
      button().click();
      await settle(50);
      expect(labels()).toContain('BLOCKG');
      expect(labels()).toContain('?'); // BLOCKZ: available on the map, no section of ours
      expect(labels()).toContain('-'); // BLOCKY: the map greys it itself
      await settle(15500);
      expect(labels()).toEqual([]);
    });
  });

  describe('Auto zoom map, and the Show on map buttons', () => {
    const shadow = () => inlineHost().shadowRoot;
    const autoZoom = () => shadow().querySelector('.auto-zoom');
    const box = () => shadow().querySelector('.auto-zoom-box');
    const toggle = (checked) => { box().checked = checked; box().dispatchEvent(new Event('change', { bubbles: true })); };

    it('is offered in the header on a page with a map, and not on one without', async () => {
      buildTicketmasterPage();
      await start({ loadMode: 'scroll' });
      await settle(1200);
      expect(autoZoom().hidden).toBe(true);
      display.destroy();
      display = null;

      pageWithMap();
      await start({ loadMode: 'scroll' });
      await settle(1200);
      expect(autoZoom().hidden).toBe(false);
      expect(box().checked).toBe(true);
      expect(shadow().querySelector('.sv').classList.contains('map-buttons')).toBe(false); // zooming by itself: no buttons
    });

    it('turns up when the map does, and goes when it does', async () => {
      buildTicketmasterPage();
      await start({ loadMode: 'scroll' });
      await settle(1200);
      expect(autoZoom().hidden).toBe(true);
      document.body.insertAdjacentHTML('beforeend', '<svg data-component="svg" id="late"><path data-component="svg__section" data-section-id="s_1" data-section-name="BLOCKG" data-active="true" d="M0 0L9 0L9 9z"></path></svg>');
      await settle(1200);
      expect(autoZoom().hidden).toBe(false);
      document.getElementById('late').remove();
      await settle(1200);
      expect(autoZoom().hidden).toBe(true);
    });

    it('switching it off is saved, brings the buttons, and stops the map zooming by itself', async () => {
      pageWithMap();
      await start({ loadMode: 'scroll' });
      await settle(1200);
      const clicks = [];
      block('BLOCKA').addEventListener('click', (e) => clicks.push(e.tmsv === true));
      toggle(false);
      await flush();
      expect(peekStorage('autoZoomMap')).toBe(false);
      expect(shadow().querySelector('.sv').classList.contains('map-buttons')).toBe(true);

      listSection('BLOCKA').open = true;
      listSection('BLOCKA').dispatchEvent(new MouseEvent('mouseenter'));
      await settle(1000);
      expect(clicks).toEqual([]); // rests on an open section: the map stays put
    });

    it('starts with it off when the settings say so', async () => {
      pageWithMap();
      await start({ loadMode: 'scroll', autoZoomMap: false });
      await settle(1200);
      expect(box().checked).toBe(false);
      expect(shadow().querySelector('.sv').classList.contains('map-buttons')).toBe(true);
    });

    it('a section\'s Show on map button opens the map at it, once, with no pause', async () => {
      pageWithMap();
      await start({ loadMode: 'scroll', autoZoomMap: false });
      await settle(1200);
      const clicks = [];
      block('BLOCKA').addEventListener('click', (e) => clicks.push(e.tmsv === true));
      listSection('BLOCKA').querySelector('summary .show-on-map').click();
      expect(clicks).toEqual([true]);
      expect(listSection('BLOCKA').open).toBe(false); // the button did not open the section in the list
    });

    it('a ticket\'s Show on map button opens the map at its section, and does not select the ticket on Ticketmaster\'s page', async () => {
      pageWithMap();
      await start({ loadMode: 'scroll', autoZoomMap: false });
      await settle(1200);
      const selected = vi.fn();
      document.querySelectorAll('[data-testid="quickpicksList"] > div[role="button"]').forEach((c) => c.addEventListener('click', selected));
      const clicks = [];
      block('BLOCKA').addEventListener('click', () => clicks.push('block'));
      listSection('BLOCKA').open = true;
      listSection('BLOCKA').querySelector('.ticket .show-on-map').click();
      expect(clicks).toEqual(['block']);
      await settle(500);
      expect(selected).not.toHaveBeenCalled();
    });

    it('hovering still outlines the block, with auto zoom off', async () => {
      pageWithMap();
      await start({ loadMode: 'scroll', autoZoomMap: false });
      await settle(1200);
      listSection('BLOCKA').dispatchEvent(new MouseEvent('mouseenter'));
      expect(Array.from(overlay().querySelectorAll('path[stroke]')).map((p) => p.getAttribute('d'))).toEqual([block('BLOCKA').getAttribute('d')]);
    });
  });

  it('is left out when the page has no such map: nothing breaks', async () => {
    buildTicketmasterPage();
    await start({ loadMode: 'scroll' });
    await settle(1200);
    listSection('BLOCKG').dispatchEvent(new MouseEvent('mouseenter'));
    await settle(600);
    expect(document.querySelector('[data-tmsv-overlay]')).toBeNull();
  });
});

describe('startup', () => {
  it('copes with garbage in storage by using the defaults (inline)', async () => {
    buildTicketmasterPage();
    await start({ displayMode: 'sidepanel', paneSide: 'up', paneWidth: 'x' });
    expect(inlineHost()).not.toBeNull();
  });

  it('starts with the saved sort', async () => {
    buildTicketmasterPage();
    await start({ sort: 'price' });
    expect(inlineHost().shadowRoot.querySelector('[data-sort="price"]').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('venue settings', () => {
  const withVenue = () => {
    buildTicketmasterPage();
    document.body.insertAdjacentHTML('afterbegin', '<div id="header"><a href="/3arena-tickets-dublin/venue/197033">3Arena, Dublin</a></div>');
    // the real fixture's three cards are Row 26, 27, 28 of BLOCKG
  };
  const badgeTexts = () => [...inlineHost().shadowRoot.querySelectorAll('.badge')].map((b) => b.textContent);

  it('applies a venue\'s saved tiers when the page loads', async () => {
    withVenue();
    await saveVenue('197033', { name: '3Arena, Dublin', firstRows: [26], frontRows: 2 });
    await start();
    await flush();
    expect(badgeTexts()).toContain('🥇 1st Row'); // Row 26 starts the tier
    expect(badgeTexts()).toContain('⭐ 2nd Row'); // Row 27
  });

  it('follows edits made from another tab or the options page', async () => {
    withVenue();
    await start();
    expect(badgeTexts().filter((t) => /1st Row/.test(t))).toEqual([]);

    await saveVenue('197033', { firstRows: [26] });
    await flush();

    expect(badgeTexts()).toContain('🥇 1st Row');
  });

  it('follows the global front-rows default', async () => {
    withVenue();
    await saveVenue('197033', { firstRows: [26] });
    await start();
    await flush();
    expect(badgeTexts().filter((t) => /Row$/.test(t) && !/Options|1st/.test(t))).toEqual(['⭐ 2nd Row', '⭐ 3rd Row']); // default 5

    await saveSettings({ frontRows: 2 });
    await flush();
    expect(badgeTexts().filter((t) => /Row$/.test(t) && !/Options|1st/.test(t))).toEqual(['⭐ 2nd Row']);
  });
});

describe('destroy', () => {
  it('removes whatever is showing and stops listening', async () => {
    buildTicketmasterPage();
    await start();
    display.destroy();
    expect(inlineHost()).toBeNull();
    expect(paneHost()).toBeNull();
    expect(chrome.storage.onChanged.size).toBe(0);
    expect(chrome.runtime.onMessage.size).toBe(0);
  });
});
