import { createPane } from '../src/content/pane.js';
import { normalizeSettings, saveSettings } from '../src/lib/settings.js';
import { flush, peekStorage } from './mocks/chrome.js';

let pane;

function fakeApp() {
  const root = document.createElement('div');
  root.className = 'fake-app';
  return { root, start: vi.fn(), stop: vi.fn(), configure: vi.fn() };
}

function make(settings = {}, app = fakeApp(), options) {
  pane = createPane(app, normalizeSettings(settings), options);
  return { pane, app };
}

afterEach(() => {
  if (pane) pane.destroy();
  pane = null;
});

const host = () => document.getElementById('tmsv-pane-host');
const shadow = () => host().shadowRoot;
const wrap = () => shadow().querySelector('.wrap');
const tab = () => shadow().querySelector('.tab');
const handle = () => shadow().querySelector('.handle');
const width = () => wrap().style.getPropertyValue('--w');

function drag(...xs) {
  const fire = (type, clientX) => handle().dispatchEvent(new MouseEvent(type, { bubbles: true, clientX }));
  fire('pointerdown', xs[0]);
  xs.slice(1).forEach((x) => fire('pointermove', x));
  fire('pointerup', xs[xs.length - 1]);
}

describe('structure', () => {
  it('adds a closed pane with just a tab, and keeps the app stopped', () => {
    const { app } = make();
    expect(wrap().dataset.open).toBe('false');
    expect(wrap().dataset.side).toBe('right');
    expect(tab().textContent).toBe('◄ Section View');
    expect(tab().getAttribute('aria-expanded')).toBe('false');
    expect(app.start).not.toHaveBeenCalled();
    expect(app.stop).toHaveBeenCalled();
  });

  it('mounts the app inside the pane, in a shadow root attached to the page', () => {
    make();
    expect(host().parentElement).toBe(document.documentElement);
    expect(shadow().querySelector('.pane .fake-app')).not.toBeNull();
    expect(shadow().querySelector('style').textContent).toContain('.sv');
  });

  it('never touches the page\'s layout', () => {
    document.body.innerHTML = '<div id="app">page</div>';
    make({ paneOpen: true });
    expect(document.body.getAttribute('style')).toBeNull();
    expect(document.getElementById('app').getAttribute('style')).toBeNull();
  });
});

describe('opening and closing', () => {
  it('opens on tab click: starts the app and remembers it', async () => {
    const { app } = make();

    tab().click();

    expect(wrap().dataset.open).toBe('true');
    expect(tab().textContent).toBe('► Hide');
    expect(tab().getAttribute('aria-expanded')).toBe('true');
    expect(app.start).toHaveBeenCalled();
    await flush();
    expect(peekStorage('paneOpen')).toBe(true);
  });

  it('closes on a second click: stops the app and remembers it', async () => {
    const { app } = make();
    tab().click();
    app.stop.mockClear();

    tab().click();

    expect(wrap().dataset.open).toBe('false');
    expect(app.stop).toHaveBeenCalled();
    await flush();
    expect(peekStorage('paneOpen')).toBe(false);
  });

  it('starts open when saved as open', () => {
    const { app } = make({ paneOpen: true, paneWidth: 500 });
    expect(wrap().dataset.open).toBe('true');
    expect(width()).toBe('500px');
    expect(app.start).toHaveBeenCalled();
  });

  it('toggle() does the same as clicking the tab (used by the toolbar icon)', () => {
    const { pane, app } = make();
    pane.toggle();
    expect(wrap().dataset.open).toBe('true');
    expect(app.start).toHaveBeenCalled();
  });
});

describe('side', () => {
  it('docks on the chosen side and points the tab the right way', () => {
    make({ paneSide: 'left' });
    expect(wrap().dataset.side).toBe('left');
    expect(tab().textContent).toBe('► Section View');
    tab().click();
    expect(tab().textContent).toBe('◄ Hide');
  });

  it('moves when the side setting changes, without restarting the app', () => {
    const { pane, app } = make({ paneOpen: true });
    app.start.mockClear();

    pane.update(normalizeSettings({ paneOpen: true, paneSide: 'left' }));

    expect(wrap().dataset.side).toBe('left');
    expect(tab().textContent).toBe('◄ Hide');
    expect(app.root.isConnected).toBe(true);
  });

  it('keeps its own open state when settings change elsewhere', () => {
    const { pane } = make({ paneOpen: true });
    pane.update(normalizeSettings({ paneOpen: false, paneSide: 'left' }));
    expect(wrap().dataset.open).toBe('true');
  });
});

describe('resizing', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true, writable: true });
  });

  it('on the right, width is the distance from the pointer to the right edge', () => {
    make({ paneOpen: true });
    drag(620, 600, 550);
    expect(width()).toBe('450px');
  });

  it('on the left, width is the pointer\'s distance from the left edge', () => {
    make({ paneOpen: true, paneSide: 'left' });
    drag(380, 420, 520);
    expect(width()).toBe('520px');
  });

  it('keeps the edge under the pointer: grabbing the handle off-centre does not make the pane jump', () => {
    make({ paneOpen: true });
    // The edge is at 1000 - 380 = 620; grab 4px to its right, then move 50px left.
    drag(624, 574);
    expect(width()).toBe('430px');

    pane.destroy();
    make({ paneOpen: true, paneSide: 'left' });
    // The edge is at 380; grab 3px to its left, then move 70px right.
    drag(377, 447);
    expect(width()).toBe('450px');
  });

  it('clamps to the allowed range', () => {
    make({ paneOpen: true });
    drag(620, 990);
    expect(width()).toBe('280px');
    drag(720, 10); // the edge is now at 1000 - 280
    expect(width()).toBe('900px');
  });

  it('saves the new width only when the drag ends', async () => {
    make({ paneOpen: true });
    const fire = (type, clientX) => handle().dispatchEvent(new MouseEvent(type, { bubbles: true, clientX }));

    fire('pointerdown', 620);
    fire('pointermove', 500);
    await flush();
    expect(peekStorage('paneWidth')).toBeUndefined();
    expect(wrap().classList.contains('dragging')).toBe(true);

    fire('pointerup', 500);
    await flush();
    expect(peekStorage('paneWidth')).toBe(500);
    expect(wrap().classList.contains('dragging')).toBe(false);
  });

  it('ignores pointer movement when not dragging', () => {
    make({ paneOpen: true });
    handle().dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 300 }));
    expect(width()).toBe('380px');
  });

  it('follows a width change made elsewhere, but not mid-drag', () => {
    const { pane } = make({ paneOpen: true });
    pane.update(normalizeSettings({ paneWidth: 600 }));
    expect(width()).toBe('600px');

    handle().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 400 })); // the edge: 1000 - 600
    handle().dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 450 }));
    pane.update(normalizeSettings({ paneWidth: 700 }));
    expect(width()).toBe('550px');
  });
});

describe('configuring the app for the pane', () => {
  it('asks the app to scroll to clicked tickets, with the full layout and no "show original" link', () => {
    const { app } = make();
    expect(app.configure).toHaveBeenCalledWith({ scrollToClicked: true, compact: false, flow: false, onShowOriginal: null, followPageSort: false, listLoad: null });
  });
});

describe('activate / deactivate (used when inline mode hands over to the pane and back)', () => {
  it('can start dormant: nothing on the page and the app untouched', () => {
    const { app } = make({ paneOpen: true }, fakeApp(), { active: false });
    expect(host()).toBeNull();
    expect(app.start).not.toHaveBeenCalled();
  });

  it('activate puts the pane on the page and starts the app if it was left open', () => {
    const { pane, app } = make({ paneOpen: true }, fakeApp(), { active: false });
    pane.activate();
    expect(wrap().dataset.open).toBe('true');
    expect(app.start).toHaveBeenCalled();
  });

  it('deactivate takes the pane away and stops the app', () => {
    const { pane, app } = make({ paneOpen: true });
    app.stop.mockClear();
    pane.deactivate();
    expect(host()).toBeNull();
    expect(app.stop).toHaveBeenCalled();
  });

  it('a dormant pane ignores toggles and settings updates', () => {
    const { pane, app } = make({}, fakeApp(), { active: false });
    pane.toggle();
    pane.update(normalizeSettings({ paneSide: 'left' }));
    expect(host()).toBeNull();
    expect(app.start).not.toHaveBeenCalled();
  });

  it('activate and deactivate are idempotent', () => {
    const { pane, app } = make({}, fakeApp(), { active: false });
    pane.activate();
    pane.activate();
    expect(document.querySelectorAll('#tmsv-pane-host')).toHaveLength(1);
    pane.deactivate();
    pane.deactivate();
    expect(host()).toBeNull();
    expect(app.stop).toHaveBeenCalled();
  });
});

describe('destroy', () => {
  it('stops the app and removes the pane', () => {
    const { pane, app } = make({ paneOpen: true });
    app.stop.mockClear();
    pane.destroy();
    expect(host()).toBeNull();
    expect(app.stop).toHaveBeenCalled();
  });
});
