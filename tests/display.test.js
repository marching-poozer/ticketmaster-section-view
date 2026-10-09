// Everything wired together on one jsdom page: settings -> app -> inline / pane.
import { initDisplay } from '../src/content/display.js';
import { MSG } from '../src/lib/protocol.js';
import { saveSettings } from '../src/lib/settings.js';
import { saveVenue } from '../src/lib/venues.js';
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
