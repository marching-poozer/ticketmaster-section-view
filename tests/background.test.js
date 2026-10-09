import { MSG } from '../src/lib/protocol.js';
import { chrome, flush } from './mocks/chrome.js';

async function loadBackground() {
  vi.resetModules();
  await import('../src/background.js');
}

describe('toolbar icon', () => {
  it('asks that tab to toggle Section View', async () => {
    await loadBackground();
    chrome.action.onClicked.dispatch({ id: 7, url: 'https://www.ticketmaster.ie/event/1' });
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
