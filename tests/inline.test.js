import { createInline } from '../src/content/inline.js';
import { buildTicketmasterPage } from './helpers/tm-layout.js';

let inline;
let app;
let onAvailability;
let snapshotListener;

function fakeApp() {
  const root = document.createElement('div');
  root.className = 'fake-app';
  snapshotListener = null;
  return {
    root,
    start: vi.fn(),
    stop: vi.fn(),
    configure: vi.fn(),
    subscribe: vi.fn((fn) => {
      snapshotListener = fn;
      return () => { snapshotListener = null; };
    }),
  };
}

function snapshot(status) {
  return { status, qty: 2, tickets: [], vip: null };
}
const LOADING = { loaded: 20, total: 84, isComplete: false };
const DONE = { loaded: 84, total: 84, isComplete: true };

function make() {
  app = fakeApp();
  onAvailability = vi.fn();
  inline = createInline(app, { onAvailability });
  return inline;
}

const settle = (ms = 200) => vi.advanceTimersByTimeAsync(ms);
const host = () => document.getElementById('tmsv-inline-host');
const shadow = () => host().shadowRoot;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  if (inline) inline.destroy();
  inline = null;
});

describe('covering Ticketmaster\'s list', () => {
  it('puts the view inside Ticketmaster\'s pane and starts the app', () => {
    const { main } = buildTicketmasterPage();
    make().start();

    expect(host().parentElement).toBe(main);
    expect(shadow().querySelector('.frame .fake-app')).not.toBeNull();
    expect(app.start).toHaveBeenCalledTimes(1);
  });

  it('configures the app for inline use: compact, no scrolling to clicked tickets, following Ticketmaster\'s sort', () => {
    buildTicketmasterPage();
    make().start();
    expect(app.configure).toHaveBeenCalledWith(expect.objectContaining({ scrollToClicked: false, compact: true, followPageSort: true }));
  });

  it('leaves the way back to the chip (no "Show Ticketmaster\'s list" link) when there is a chip row', () => {
    buildTicketmasterPage();
    make().start();
    expect(app.configure.mock.calls.at(-1)[0].onShowOriginal).toBeNull();
  });

  it('while tickets are loading, covers the list from right below Ticketmaster\'s header (300px into the pane)', () => {
    buildTicketmasterPage();
    make().start();
    expect(host().dataset.mode).toBe('view');
    expect(host().style.top).toBe('300px');

    snapshotListener(snapshot(LOADING));
    expect(host().dataset.mode).toBe('view');
    expect(host().style.top).toBe('300px');
  });

  it('keeps the header where it is while the list is scrolled to load more', () => {
    const { scroller } = buildTicketmasterPage();
    make().start();

    scroller.scrollTop = 4000; // the page reader scrolling to the end of the list
    snapshotListener(snapshot(LOADING));
    host().parentElement.dispatchEvent(new Event('scroll'));

    expect(host().style.top).toBe('300px');
  });

  it('keeps Ticketmaster\'s list laid out but invisible while loading (it has to keep loading)', () => {
    buildTicketmasterPage();
    make().start();
    snapshotListener(snapshot(LOADING));
    const list = document.getElementById('quickpicks-list');
    expect(list.querySelectorAll('[role="button"]')).toHaveLength(3);
    expect(list.parentElement.style.visibility).toBe('hidden');
    expect(list.parentElement.style.display).toBe('');
    expect(list.isConnected).toBe(true);
  });

  it('measures after locking the scroller: its scrollbar going away re-wraps Ticketmaster\'s text', () => {
    const { scroller, wrapper } = buildTicketmasterPage();
    const naturalTop = wrapper.getBoundingClientRect().top;
    // With the scrollbar showing a line wraps and the list starts 16px lower.
    wrapper.getBoundingClientRect = () => {
      const top = (scroller.style.overflowY === 'hidden' ? naturalTop : naturalTop + 16) - scroller.scrollTop;
      return { top, bottom: top + 2000, left: 0, right: 413, width: 413, height: 2000 };
    };
    make().start();
    expect(host().style.top).toBe('300px');
  });
});

describe('pinning Ticketmaster\'s header', () => {
  it('pins each header block that has a size, leaving empty ones alone', () => {
    const { blocks } = buildTicketmasterPage();
    make().start();

    const [banner, emptyButton, results, delivery] = blocks;
    [banner, results, delivery].forEach((block) => {
      expect(block.style.position).toBe('relative');
      expect(block.style.zIndex).toBe('3');
    });
    expect(emptyButton.style.position).toBe(''); // zero height: nothing to pin
  });

  it('moves the blocks down as the list scrolls, so the header stays where it is on screen', () => {
    const { scroller, blocks } = buildTicketmasterPage();
    make().start();
    expect(blocks[2].style.transform).toBe(''); // at the top: no offset

    scroller.scrollTop = 1200; // the page reader scrolling to load more
    scroller.dispatchEvent(new Event('scroll'));
    blocks.forEach((block, i) => {
      if (i !== 1) expect(block.style.transform).toBe('translateY(1200px)');
    });

    scroller.scrollTop = 5000;
    scroller.dispatchEvent(new Event('scroll'));
    expect(blocks[2].style.transform).toBe('translateY(5000px)');

    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll'));
    expect(blocks[2].style.transform).toBe('');
  });

  it('does not depend on how tall Ticketmaster\'s container is (unlike position: sticky)', () => {
    const { blocks } = buildTicketmasterPage();
    make().start();
    blocks.forEach((block) => expect(block.style.position).not.toBe('sticky'));
  });

  it('gives a transparent block a white background so the list does not show through, but keeps a real one', () => {
    const { blocks } = buildTicketmasterPage();
    blocks[2].style.backgroundColor = 'rgb(240, 240, 240)';
    make().start();

    expect(blocks[3].style.backgroundColor).toBe('rgb(255, 255, 255)'); // the delivery note: a plain div
    expect(blocks[2].style.backgroundColor).toBe('rgb(240, 240, 240)');
  });

  it('puts every style back when the view goes away, and stops following the scroll', () => {
    const { scroller, blocks } = buildTicketmasterPage();
    blocks[0].style.zIndex = '7';
    make().start();
    scroller.scrollTop = 900;
    scroller.dispatchEvent(new Event('scroll'));
    inline.stop();

    blocks.forEach((block) => {
      expect(block.style.position).toBe('');
      expect(block.style.transform).toBe('');
      expect(block.style.willChange).toBe('');
    });
    expect(blocks[0].style.zIndex).toBe('7');
    expect(blocks[3].style.backgroundColor).toBe('');

    scroller.scrollTop = 1500;
    scroller.dispatchEvent(new Event('scroll'));
    expect(blocks[2].style.transform).toBe('');
  });

  it('re-pins when Ticketmaster re-renders its header', async () => {
    buildTicketmasterPage();
    make().start();
    const { blocks } = buildTicketmasterPage();
    await settle();
    expect(blocks[0].style.position).toBe('relative');
  });

  it('does not re-measure mid-load (the pins just hold while the pane is scrolled)', () => {
    const { scroller, blocks } = buildTicketmasterPage();
    make().start();
    scroller.scrollTop = 4000;
    scroller.dispatchEvent(new Event('scroll'));
    snapshotListener(snapshot(LOADING));

    expect(scroller.scrollTop).toBe(4000);
    expect(blocks[2].style.transform).toBe('translateY(4000px)');
    expect(host().style.top).toBe('300px');
  });
});

describe('once everything has loaded: our view joins the page\'s flow', () => {
  const flowed = () => {
    const page = buildTicketmasterPage();
    make().start();
    snapshotListener(snapshot(DONE));
    return page;
  };

  it('sits in Ticketmaster\'s pane right where its list was, as part of the page, not on top of it', () => {
    const { wrapper, quickpicks } = flowed();
    expect(host().dataset.mode).toBe('flow');
    expect(host().parentElement).toBe(quickpicks);
    expect(host().nextElementSibling).toBe(wrapper);
    expect(host().style.position).toBe('static');
    expect(host().style.top).toBe('');
  });

  it('takes Ticketmaster\'s list out of the layout (its cards stay in the page)', () => {
    const { wrapper } = flowed();
    expect(wrapper.style.display).toBe('none');
    expect(wrapper.style.visibility).toBe('');
    expect(document.querySelectorAll('[data-testid="quickpicksList"] > div[role="button"]')).toHaveLength(3);
  });

  it('releases the header and the scroller, so header and list scroll together', () => {
    const { scroller, blocks } = flowed();
    expect(scroller.style.overflowY).toBe('auto');
    blocks.forEach((block) => {
      expect(block.style.position).toBe('');
      expect(block.style.transform).toBe('');
    });
    scroller.scrollTop = 800;
    scroller.dispatchEvent(new Event('scroll'));
    blocks.forEach((block) => expect(block.style.transform).toBe(''));
  });

  it('asks the app to flow with the page instead of scrolling inside itself', () => {
    flowed();
    expect(app.configure.mock.calls.at(-1)[0]).toMatchObject({ flow: true });
  });

  it('starts at the top', () => {
    const { scroller } = buildTicketmasterPage();
    make().start();
    scroller.scrollTop = 700;
    snapshotListener(snapshot(DONE));
    expect(scroller.scrollTop).toBe(0);
  });

  it('keeps the chip in the header, so Ticketmaster\'s list is still one click away', () => {
    flowed();
    expect(document.querySelector('[data-tmsv-chip]').textContent.trim()).toBe('By Section');
  });

  it('goes back to covering (header held, scroller locked, list laid out again) when the list reloads', () => {
    const { scroller, blocks, wrapper, main } = flowed();
    scroller.scrollTop = 900; // the user had scrolled down

    snapshotListener(snapshot({ loaded: 0, total: 60, isComplete: false }));

    expect(host().dataset.mode).toBe('view');
    expect(host().parentElement).toBe(main);
    expect(host().style.top).toBe('300px');
    expect(wrapper.style.display).toBe('');
    expect(wrapper.style.visibility).toBe('hidden');
    expect(scroller.style.overflowY).toBe('hidden');
    expect(scroller.scrollTop).toBe(0); // the header must be in view to be held there
    expect(blocks[0].style.position).toBe('relative');
    expect(app.configure.mock.calls.at(-1)[0]).toMatchObject({ flow: false });
  });

  it('and joins the flow again when it has loaded', () => {
    const { wrapper, quickpicks } = flowed();
    snapshotListener(snapshot({ loaded: 0, total: 60, isComplete: false }));
    snapshotListener(snapshot({ loaded: 60, total: 60, isComplete: true }));
    expect(host().dataset.mode).toBe('flow');
    expect(host().parentElement).toBe(quickpicks);
    expect(wrapper.style.display).toBe('none');
  });

  it('stays in the flow, untouched, while a ticket is selected (so the scroll position is there on Back)', async () => {
    const { scroller } = flowed();
    scroller.scrollTop = 1234;
    const before = host();

    const dialog = document.createElement('div');
    dialog.id = 'quickpicks-detail';
    document.getElementById('main-content').append(dialog);
    await settle();

    expect(host()).toBe(before);
    expect(host().dataset.mode).toBe('flow');
    expect(scroller.scrollTop).toBe(1234);

    dialog.remove();
    await settle();
    expect(host()).toBe(before);
    expect(scroller.scrollTop).toBe(1234);
  });

  it('gives Ticketmaster\'s list back completely when switched to it', () => {
    const { wrapper, quickpicks } = flowed();
    document.querySelector('[data-tmsv-chip]').click();
    [...document.getElementById('tmsv-view-menu-host').shadowRoot.querySelectorAll('button')][0].click();

    expect(host()).toBeNull();
    expect(wrapper.style.display).toBe('');
    expect(wrapper.style.visibility).toBe('');
    expect(quickpicks.contains(wrapper)).toBe(true);
  });

  it('puts everything back on stop', () => {
    const { scroller, wrapper, blocks } = flowed();
    inline.stop();
    expect(host()).toBeNull();
    expect(wrapper.style.display).toBe('');
    expect(scroller.style.overflowY).toBe('auto');
    blocks.forEach((block) => expect(block.style.position).toBe(''));
  });

  it('is put back in place if Ticketmaster re-renders its pane', async () => {
    flowed();
    const { wrapper, quickpicks } = buildTicketmasterPage(); // a whole new tree; the old host is gone with it
    await settle();
    // not settled any more as far as the new page is concerned? it still is: the same snapshot state stands
    expect(document.querySelectorAll('#tmsv-inline-host')).toHaveLength(1);
    expect(host().parentElement).toBe(quickpicks);
    expect(host().nextElementSibling).toBe(wrapper);
  });
});

describe('a snapshot that arrives while we are still mounting', () => {
  it('ends up in the right state: loaded when the very first snapshot says so, with nothing left half-covered', () => {
    const { scroller, wrapper, blocks, quickpicks } = buildTicketmasterPage();
    app = fakeApp();
    // starting the app reports the page at once, and it is already fully loaded
    app.start = vi.fn(() => snapshotListener(snapshot(DONE)));
    inline = createInline(app, { onAvailability: vi.fn() });
    inline.start();

    expect(host().dataset.mode).toBe('flow');
    expect(host().parentElement).toBe(quickpicks);
    expect(wrapper.style.display).toBe('none');
    expect(scroller.style.overflowY).toBe('auto');
    blocks.forEach((block) => expect(block.style.position).toBe(''));
    expect(document.querySelectorAll('#tmsv-inline-host')).toHaveLength(1);
  });
});

describe('holding the scroller', () => {
  it('reserves its scrollbar\'s space for as long as we hold it, so the width never changes mid-hand-over', () => {
    const { scroller } = buildTicketmasterPage();
    const set = vi.spyOn(scroller.style, 'setProperty');
    const remove = vi.spyOn(scroller.style, 'removeProperty');

    make().start();
    expect(set).toHaveBeenCalledWith('scrollbar-gutter', 'stable');

    snapshotListener(snapshot(DONE)); // flow: still held, just not locked
    expect(remove).not.toHaveBeenCalledWith('scrollbar-gutter');
    expect(scroller.style.overflowY).toBe('auto');

    snapshotListener(snapshot(LOADING)); // and locked again
    expect(scroller.style.overflowY).toBe('hidden');

    inline.stop();
    expect(remove).toHaveBeenCalledWith('scrollbar-gutter');
  });
});

describe('the scroller', () => {
  it('is reset to the top and locked as soon as the view is shown', () => {
    const { scroller } = buildTicketmasterPage();
    scroller.scrollTop = 500;
    make().start();

    expect(scroller.scrollTop).toBe(0);
    expect(scroller.style.overflowY).toBe('hidden');
  });

  it('is locked while tickets load, free once they have, and locked again if the list reloads', () => {
    const { scroller } = buildTicketmasterPage();
    make().start();
    snapshotListener(snapshot(LOADING));
    expect(scroller.style.overflowY).toBe('hidden');

    snapshotListener(snapshot(DONE));
    expect(scroller.style.overflowY).toBe('auto');

    snapshotListener(snapshot({ loaded: 0, total: 60, isComplete: false }));
    expect(scroller.style.overflowY).toBe('hidden');
  });

  it('gets its original overflow back when the view goes away', () => {
    const { scroller } = buildTicketmasterPage();
    make().start();
    inline.stop();
    expect(scroller.style.overflowY).toBe('auto');
  });
});

describe('when the header cannot be pinned (an unfamiliar layout)', () => {
  it('covers the whole pane while loading, since there is no header to keep in place', () => {
    buildTicketmasterPage({ headerGeometry: false });
    make().start();
    snapshotListener(snapshot(LOADING));
    expect(host().dataset.mode).toBe('view');
    expect(host().style.top).toBe('0px');
    snapshotListener(snapshot({ loaded: 0, total: 60, isComplete: false }));
    expect(host().style.top).toBe('0px');
  });

  it('moves into the page\'s flow once loaded, as it does anywhere (the flow needs no header measurements)', () => {
    buildTicketmasterPage({ headerGeometry: false });
    make().start();
    snapshotListener(snapshot(DONE));
    expect(host().dataset.mode).toBe('flow');
  });

  it('treats an empty result as loaded, so the chips stay reachable', () => {
    buildTicketmasterPage({ headerGeometry: false });
    make().start();
    snapshotListener(snapshot({ loaded: 0, total: 0, isComplete: false }));
    expect(host().dataset.mode).toBe('flow');
  });
});

describe('"Your Selection"', () => {
  function openDetail() {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.id = 'quickpicks-detail';
    document.getElementById('main-content').append(dialog);
    return dialog;
  }

  it('gets out of the way while a ticket is selected, and comes back on Back', async () => {
    buildTicketmasterPage();
    make().start();
    expect(host()).not.toBeNull();

    const dialog = openDetail();
    await settle();
    expect(host()).toBeNull();
    expect(app.stop).toHaveBeenCalled();

    dialog.remove();
    app.start.mockClear();
    await settle();
    expect(host()).not.toBeNull();
    expect(app.start).toHaveBeenCalled();
  });

  it('does not count the selection view as Ticketmaster\'s pane having gone missing', async () => {
    buildTicketmasterPage();
    make().start();
    openDetail();
    document.getElementById('quickpicks').remove(); // even if the list itself were unmounted
    await settle(5000);
    expect(onAvailability).not.toHaveBeenCalledWith(false);
  });
});

describe('the "By Section / Tickets" chip', () => {
  const chip = () => document.querySelector('#quickpicks [role="toolbar"] [data-tmsv-chip]');
  const menuItems = () => [...document.getElementById('tmsv-view-menu-host').shadowRoot.querySelectorAll('button')];

  it('is added to Ticketmaster\'s filter chips while our view is showing', () => {
    buildTicketmasterPage();
    make().start();
    expect(chip().textContent.trim()).toBe('By Section');
    expect(chip().parentElement.lastElementChild).toBe(chip());
  });

  it('choosing "Tickets" gives Ticketmaster\'s list back: unpinned, unlocked, visible, our view gone', () => {
    const { scroller, blocks, wrapper } = buildTicketmasterPage();
    make().start();
    expect(scroller.style.overflowY).toBe('hidden');
    expect(wrapper.style.visibility).toBe('hidden');
    expect(blocks[0].style.position).toBe('relative');

    chip().click();
    menuItems()[0].click();

    expect(chip().textContent.trim()).toBe('Tickets');
    expect(host()).toBeNull();
    expect(app.stop).toHaveBeenCalled();
    expect(scroller.style.overflowY).toBe('auto');
    expect(wrapper.style.visibility).toBe('');
    expect(blocks[0].style.position).toBe('');
  });

  it('keeps the chip while Ticketmaster\'s list shows, so the user can come back', () => {
    buildTicketmasterPage();
    make().start();
    inline.toggle();
    expect(chip()).not.toBeNull();
    expect(chip().textContent.trim()).toBe('Tickets');
    expect(host()).toBeNull(); // no tab needed: the chip is the way back
  });

  it('choosing "By Section" brings our view back', () => {
    buildTicketmasterPage();
    make().start();
    inline.toggle();
    app.start.mockClear();

    chip().click();
    menuItems()[1].click();

    expect(chip().textContent.trim()).toBe('By Section');
    expect(host()).not.toBeNull();
    expect(host().dataset.mode).toBe('view');
    expect(app.start).toHaveBeenCalled();
  });

  it('the toolbar icon toggles it too, and the chip follows', () => {
    buildTicketmasterPage();
    make().start();
    inline.toggle();
    expect(chip().textContent.trim()).toBe('Tickets');
    inline.toggle();
    expect(chip().textContent.trim()).toBe('By Section');
  });

  it('is measured into the header: the chip is in place before the header is pinned', () => {
    const { quickpicks } = buildTicketmasterPage();
    make().start();
    expect(quickpicks.querySelector('[data-tmsv-chip]')).not.toBeNull();
    expect(host().style.top).toBe('300px');
  });

  it('is put back if Ticketmaster re-renders its chips', async () => {
    buildTicketmasterPage();
    make().start();
    buildTicketmasterPage();
    await settle();
    expect(chip()).not.toBeNull();
    expect(document.querySelectorAll('[data-tmsv-chip]')).toHaveLength(1);
  });

  it('goes away with the view: on stop, while a ticket is selected, and when disabled', async () => {
    buildTicketmasterPage();
    make().start();
    inline.setEnabled(false);
    expect(chip()).toBeNull();
    inline.setEnabled(true);
    expect(chip()).not.toBeNull();

    const dialog = document.createElement('div');
    dialog.id = 'quickpicks-detail';
    document.getElementById('main-content').append(dialog);
    await settle();
    expect(chip()).toBeNull();

    dialog.remove();
    await settle();
    expect(chip()).not.toBeNull();

    inline.stop();
    expect(chip()).toBeNull();
  });
});

describe('without a chip row to put the chip in (an unfamiliar layout)', () => {
  function withoutToolbar() {
    const page = buildTicketmasterPage();
    page.quickpicks.querySelector('[role="toolbar"]').remove();
    return page;
  }

  it('the view offers a "Show Ticketmaster\'s list" link instead', () => {
    withoutToolbar();
    make().start();
    expect(typeof app.configure.mock.calls.at(-1)[0].onShowOriginal).toBe('function');
  });

  it('the link hands back to Ticketmaster\'s list, leaving a small tab to return', () => {
    withoutToolbar();
    make().start();
    app.configure.mock.calls.at(-1)[0].onShowOriginal();

    expect(host().dataset.mode).toBe('tab');
    expect(app.stop).toHaveBeenCalled();
    expect(shadow().querySelector('.restore')).not.toBeNull();
  });

  it('the tab (or toggle again) brings the view back', () => {
    withoutToolbar();
    make().start();
    inline.toggle();
    app.start.mockClear();

    shadow().querySelector('.restore').click();

    expect(host().dataset.mode).toBe('view');
    expect(app.start).toHaveBeenCalled();
  });

  it('restores Ticketmaster\'s list completely while it is showing', () => {
    const { scroller, blocks, wrapper } = withoutToolbar();
    make().start();
    inline.toggle();
    expect(scroller.style.overflowY).toBe('auto');
    expect(wrapper.style.visibility).toBe('');
    expect(blocks[0].style.position).toBe('');
  });
});

describe('availability (is Ticketmaster\'s pane there?)', () => {
  it('reports true as soon as the pane is found', () => {
    buildTicketmasterPage();
    make().start();
    expect(onAvailability).toHaveBeenCalledWith(true);
    expect(onAvailability).toHaveBeenCalledTimes(1);
  });

  it('reports false only after the pane has been missing for a while', async () => {
    document.body.innerHTML = '<div>homepage</div>';
    make().start();
    await settle(2000);
    expect(onAvailability).not.toHaveBeenCalled();
    await settle(1000);
    expect(onAvailability).toHaveBeenCalledWith(false);
    expect(onAvailability).toHaveBeenCalledTimes(1);
  });

  it('does not report false if the pane shows up during the grace period', async () => {
    document.body.innerHTML = '<div>loading…</div>';
    make().start();
    await settle(1000);
    buildTicketmasterPage();
    await settle(5000);
    expect(onAvailability).toHaveBeenCalledWith(true);
    expect(onAvailability).not.toHaveBeenCalledWith(false);
  });

  it('reports true again when the pane appears later (e.g. navigating to an event)', async () => {
    document.body.innerHTML = '<div>homepage</div>';
    make().start();
    await settle(3000);
    expect(onAvailability).toHaveBeenLastCalledWith(false);

    buildTicketmasterPage();
    await settle(200);
    expect(onAvailability).toHaveBeenLastCalledWith(true);
    expect(host()).not.toBeNull();
  });

  it('reports false after the pane disappears for good', async () => {
    buildTicketmasterPage();
    make().start();
    document.body.innerHTML = '<div>homepage</div>';
    await settle(3500);
    expect(onAvailability).toHaveBeenLastCalledWith(false);
    expect(host()).toBeNull();
  });
});

describe('being told not to show (the pane is covering)', () => {
  it('setEnabled(false) removes the view and stops the app; setEnabled(true) brings it back', () => {
    buildTicketmasterPage();
    make().start();

    inline.setEnabled(false);
    expect(host()).toBeNull();
    expect(app.stop).toHaveBeenCalled();

    app.start.mockClear();
    inline.setEnabled(true);
    expect(host()).not.toBeNull();
    expect(app.start).toHaveBeenCalled();
  });

  it('a disabled inline never starts the app, even as the page changes', async () => {
    make().setEnabled(false);
    inline.start();
    buildTicketmasterPage();
    await settle(500);
    expect(app.start).not.toHaveBeenCalled();
    expect(host()).toBeNull();
  });
});

describe('reacting quickly', () => {
  it('covers the list as soon as it appears, without waiting for the page to settle', async () => {
    document.body.innerHTML = '<div id="app">loading…</div>';
    make().start();
    expect(host()).toBeNull();

    buildTicketmasterPage();
    await vi.advanceTimersByTimeAsync(0); // just the observer's microtask: no timer delay

    expect(host()).not.toBeNull();
  });

  it('then checks once more after the dust settles', async () => {
    buildTicketmasterPage();
    make().start();
    document.body.append(document.createElement('div'));
    document.body.append(document.createElement('div'));
    await settle(500);
    expect(app.start).toHaveBeenCalledTimes(1);
  });
});

describe('tracking Ticketmaster re-rendering', () => {
  it('puts the view back if Ticketmaster re-creates its pane', async () => {
    buildTicketmasterPage();
    make().start();
    expect(host()).not.toBeNull();

    buildTicketmasterPage(); // React replaced the whole tree
    await settle();

    expect(host()).not.toBeNull();
    expect(host().parentElement).toBe(document.getElementById('main-content'));
  });

  it('does not restart the app when nothing has changed', async () => {
    buildTicketmasterPage();
    make().start();
    document.body.append(document.createElement('div'));
    await settle(1000);
    expect(app.start).toHaveBeenCalledTimes(1);
  });
});

describe('start / stop', () => {
  it('start is idempotent and stop returns to a clean slate', () => {
    buildTicketmasterPage();
    make().start();
    inline.start();
    expect(document.querySelectorAll('#tmsv-inline-host')).toHaveLength(1);
    inline.stop();
    inline.stop();
    expect(host()).toBeNull();
    expect(snapshotListener).toBeNull();
  });
});

describe('making the page\'s list loadable while a ticket\'s card is brought in', () => {
  const hooks = () => app.configure.mock.calls.at(-1)[0].listLoad;
  const flowed = () => {
    const page = buildTicketmasterPage();
    make().start();
    snapshotListener(snapshot(DONE));
    return page;
  };

  it('offers hooks to the app', () => {
    buildTicketmasterPage();
    make().start();
    expect(hooks()).toEqual(expect.objectContaining({ before: expect.any(Function), after: expect.any(Function) }));
  });

  it('goes back to the covering state while loading (the list laid out, invisible), then returns to the flow', async () => {
    const { wrapper } = flowed();
    expect(host().dataset.mode).toBe('flow');
    expect(wrapper.style.display).toBe('none');

    const before = hooks().before();
    await settle();
    await before;
    expect(host().dataset.mode).toBe('view');
    expect(wrapper.style.display).toBe('');
    expect(wrapper.style.visibility).toBe('hidden');

    await hooks().after();
    expect(host().dataset.mode).toBe('flow');
    expect(wrapper.style.display).toBe('none');
    expect(wrapper.style.visibility).toBe('');
  });

  it('puts the scroll position back afterwards', async () => {
    const { scroller } = flowed();
    scroller.scrollTop = 640;

    const before = hooks().before();
    await settle();
    await before;
    await hooks().after();

    expect(scroller.scrollTop).toBe(640);
  });

  it('is harmless if the view was not in the flow (still loading)', async () => {
    buildTicketmasterPage();
    make().start();
    snapshotListener(snapshot(LOADING));
    const before = hooks().before();
    await settle();
    await before;
    await hooks().after();
    expect(host().dataset.mode).toBe('view');
  });
});
