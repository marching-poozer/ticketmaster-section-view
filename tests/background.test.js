import { MSG } from '../src/lib/protocol.js';
import { chrome, menuContents, peekStorage, seedStorage } from './mocks/chrome.js';

async function loadBackground() {
  vi.resetModules();
  await import('../src/background.js');
  await settle();
}

/** Let the worker's async handlers (they read storage first) finish. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
const flush = settle;

describe('toolbar icon', () => {
  it('asks that tab to toggle Section View', async () => {
    await loadBackground();
    chrome.action.onClicked.dispatch({ id: 7, url: 'https://www.ticketmaster.ie/event/1' });
    await settle();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: MSG.TOGGLE_VIEW });
  });

  it('shrugs off tabs with no content script to hear it', async () => {
    chrome.tabs.sendMessage.mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'));
    await loadBackground();
    expect(() => chrome.action.onClicked.dispatch({ id: 7 })).not.toThrow();
    await flush();
  });

  it('ignores a click with no tab', async () => {
    await loadBackground();
    chrome.action.onClicked.dispatch(undefined);
    chrome.action.onClicked.dispatch({});
    await settle();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
});

describe('open options', () => {
  it('opens the options page when a content script asks', async () => {
    await loadBackground();
    chrome.runtime.onMessage.dispatch({ type: MSG.OPEN_OPTIONS }, {});
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });

  it('ignores other messages', async () => {
    await loadBackground();
    chrome.runtime.onMessage.dispatch({ type: 'something-else' }, {});
    chrome.runtime.onMessage.dispatch(undefined, {});
    expect(chrome.runtime.openOptionsPage).not.toHaveBeenCalled();
  });
});

describe('the on/off switch in the toolbar icon\'s menu', () => {
  const click = async (checked) => {
    chrome.contextMenus.onClicked.dispatch({ menuItemId: 'tmsv-enabled', checked });
    await settle();
  };

  it('puts a checked "Enable Section View" item on the icon\'s menu when installed', async () => {
    await loadBackground();
    chrome.runtime.onInstalled.dispatch({ reason: 'install' });
    await settle();
    expect(menuContents()['tmsv-enabled']).toMatchObject({ type: 'checkbox', title: 'Enable Section View', checked: true, contexts: ['action'] });
  });

  it('starts the menu afresh each time (an update or reload must not make a duplicate)', async () => {
    await loadBackground();
    chrome.runtime.onInstalled.dispatch({ reason: 'install' });
    chrome.runtime.onInstalled.dispatch({ reason: 'update' });
    await settle();
    expect(Object.keys(menuContents())).toEqual(['tmsv-enabled']);
    expect(chrome.contextMenus.removeAll).toHaveBeenCalledTimes(2);
  });

  it('shows the item unchecked when it was switched off before (a reload of the extension)', async () => {
    seedStorage('enabled', false);
    await loadBackground();
    chrome.runtime.onInstalled.dispatch({ reason: 'update' });
    await settle();
    expect(menuContents()['tmsv-enabled'].checked).toBe(false);
  });

  it('unchecking it switches Section View off, and checking it switches it on', async () => {
    await loadBackground();
    await click(false);
    expect(peekStorage('enabled')).toBe(false);
    await click(true);
    expect(peekStorage('enabled')).toBe(true);
  });

  it('toggles from what is stored if the browser does not say what the item became', async () => {
    await loadBackground();
    await click(undefined);
    expect(peekStorage('enabled')).toBe(false);
    await click(undefined);
    expect(peekStorage('enabled')).toBe(true);
  });

  it('ignores clicks on other menu items', async () => {
    await loadBackground();
    chrome.contextMenus.onClicked.dispatch({ menuItemId: 'something-else', checked: false });
    chrome.contextMenus.onClicked.dispatch(undefined);
    await settle();
    expect(peekStorage('enabled')).toBeUndefined();
  });

  it('says "off" on the icon while it is off, and clears it when it is on', async () => {
    await loadBackground();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    await click(false);
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: 'off' });
    expect(chrome.action.setTitle).toHaveBeenLastCalledWith({ title: 'Section View (off)' });
    await click(true);
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    expect(chrome.action.setTitle).toHaveBeenLastCalledWith({ title: 'Section View' });
  });

  it('follows a switch made elsewhere (the options page): the icon and the checkmark', async () => {
    await loadBackground();
    chrome.runtime.onInstalled.dispatch({ reason: 'install' });
    await settle();
    await chrome.storage.local.set({ enabled: false });
    await settle();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: 'off' });
    expect(menuContents()['tmsv-enabled'].checked).toBe(false);
    await chrome.storage.local.set({ enabled: true });
    await settle();
    expect(menuContents()['tmsv-enabled'].checked).toBe(true);
  });

  it('shows the state when the worker wakes up (the badge does not survive a browser restart)', async () => {
    seedStorage('enabled', false);
    await loadBackground();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: 'off' });
    chrome.action.setBadgeText.mockClear();
    chrome.runtime.onStartup.dispatch();
    await settle();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: 'off' });
  });

  it('ignores storage changes that are not about it', async () => {
    await loadBackground();
    chrome.action.setBadgeText.mockClear();
    await chrome.storage.local.set({ sort: 'price' });
    await settle();
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
  });

  it('clicking the icon while it is off turns it back on, and does not message the tab', async () => {
    seedStorage('enabled', false);
    await loadBackground();
    chrome.action.onClicked.dispatch({ id: 7, url: 'https://www.ticketmaster.ie/event/1' });
    await settle();
    expect(peekStorage('enabled')).toBe(true);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('still works when the icon\'s menu is not available (a browser without it)', async () => {
    const original = chrome.contextMenus.update;
    chrome.contextMenus.update = () => { throw new Error('not available'); };
    await expect(loadBackground()).resolves.not.toThrow();
    chrome.contextMenus.update = original;
  });
});
