// Service worker. Small jobs content scripts can't do themselves: forward toolbar-icon
// clicks to the page, open the options page, and keep the on/off switch.
//
// On/off is the `enabled` setting. It is switched from the menu of the toolbar icon (the
// browser's extensions menu, or right-click the icon: a checked "Enable Section View" item), or
// the options page; every page follows the stored value. While it is off the icon says "off",
// and clicking the icon turns Section View back on rather than toggling a view that isn't there.
import { MSG } from './lib/protocol.js';

const MENU_ID = 'tmsv-enabled';
const OFF_BADGE_COLOR = '#6b7280';

async function isEnabled() {
  try {
    const stored = await chrome.storage.local.get('enabled');
    return stored.enabled !== false;
  } catch (err) {
    return true;
  }
}

/** Fire and forget an extension API call that may return a promise (which must not be left to reject). */
function quietly(call) {
  try {
    const result = call();
    if (result && typeof result.catch === 'function') result.catch(function () {});
  } catch (err) { /* the API isn't available in this browser: nothing to show */ }
}

/** Make the icon and its menu say whether Section View is on. */
function showState(enabled) {
  quietly(function () { return chrome.action.setBadgeText({ text: enabled ? '' : 'off' }); });
  quietly(function () { return chrome.action.setBadgeBackgroundColor({ color: OFF_BADGE_COLOR }); });
  quietly(function () { return chrome.action.setTitle({ title: enabled ? 'Section View' : 'Section View (off)' }); });
  // Not there yet while the worker wakes before the menu is created: that is fine, creating it shows the state.
  quietly(function () { return chrome.contextMenus.update(MENU_ID, { checked: enabled }, function () { void chrome.runtime.lastError; }); });
}

function refreshState() {
  isEnabled().then(showState);
}

function createMenu() {
  quietly(function () {
    return chrome.contextMenus.removeAll(function () {
      chrome.contextMenus.create(
        { id: MENU_ID, type: 'checkbox', title: 'Enable Section View', checked: true, contexts: ['action'] },
        function () {
          void chrome.runtime.lastError;
          refreshState();
        },
      );
    });
  });
}

chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(refreshState);
refreshState(); // whenever the worker wakes up: the badge doesn't survive everything

chrome.contextMenus.onClicked.addListener(async function (info) {
  if (!info || info.menuItemId !== MENU_ID) return;
  // A checkbox item says what it has just become.
  const enabled = typeof info.checked === 'boolean' ? info.checked : !(await isEnabled());
  await chrome.storage.local.set({ enabled });
});

// Switched from anywhere (the menu, the options page): the icon follows.
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local' && changes.enabled) showState(changes.enabled.newValue !== false);
});

chrome.action.onClicked.addListener(async function (tab) {
  if (!(await isEnabled())) {
    await chrome.storage.local.set({ enabled: true });
    return;
  }
  if (!tab || tab.id === undefined) return;
  // Not a Ticketmaster tab (no content script to hear it): nothing to toggle.
  chrome.tabs.sendMessage(tab.id, { type: MSG.TOGGLE_VIEW }).catch(function () {});
});

chrome.runtime.onMessage.addListener(function (message) {
  if (message && message.type === MSG.OPEN_OPTIONS) chrome.runtime.openOptionsPage();
});
