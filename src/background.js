// Service worker. Two small jobs content scripts can't do themselves:
// forward toolbar-icon clicks to the page, and open the options page.
import { MSG } from './lib/protocol.js';

chrome.action.onClicked.addListener(function (tab) {
  if (!tab || tab.id === undefined) return;
  // Not a Ticketmaster tab (no content script to hear it): nothing to toggle.
  chrome.tabs.sendMessage(tab.id, { type: MSG.TOGGLE_VIEW }).catch(function () {});
});

chrome.runtime.onMessage.addListener(function (message) {
  if (message && message.type === MSG.OPEN_OPTIONS) chrome.runtime.openOptionsPage();
});
