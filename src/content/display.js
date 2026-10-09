// Composition root of the content script: loads settings, builds the app and
// shows it in the configured display mode, and keeps that in step with the
// settings, the page, and the toolbar icon.
//
//   inline mode: the view replaces Ticketmaster's ticket list. If Ticketmaster's
//                pane can't be found (another layout, or a page with no
//                tickets), the floating pane stands in until it appears.
//   pane mode:   the floating pane, always.
//
// All of it can be switched off (the `enabled` setting: the menu of the toolbar icon,
// or the options page). Off, nothing is built and nothing on the page is touched; switching
// off while it is showing takes everything away again and leaves Ticketmaster's list as it was.
import { MSG } from '../lib/protocol.js';
import { applySettingsChanges, loadSettings } from '../lib/settings.js';
import { createApp } from './app.js';
import { createInline } from './inline.js';
import { createPane } from './pane.js';

/** Start Section View on this page. Resolves to a handle with destroy() (used by tests). */
export async function initDisplay() {
  let settings = await loadSettings();
  let live = null; // { app, pane, inline } while Section View is on; null while it is switched off
  let available = null; // is Ticketmaster's pane on the page? (null = not known yet)

  /** Build the app and its two hosts, and make one of them responsible for the view. */
  function build() {
    const app = createApp({ settings, version: chrome.runtime.getManifest().version });
    const pane = createPane(app, settings, { active: false });
    const inline = createInline(app, {
      onAvailability(isAvailable) {
        available = isAvailable;
        reconcile();
      },
    });
    live = { app, pane, inline };
    reconcile();
  }

  /** Take it all off the page again (the hosts undo what they did to Ticketmaster's own list). */
  function teardown() {
    if (!live) return;
    const old = live;
    live = null;
    available = null;
    old.inline.destroy();
    old.pane.destroy();
  }

  function paneIsShowing() {
    return settings.displayMode === 'pane' || available === false;
  }

  /** Make exactly one of the two hosts responsible for the view. The old one goes first. */
  function reconcile() {
    if (!live) return;
    const { pane, inline } = live;
    if (settings.displayMode === 'pane') {
      inline.stop();
      available = null;
      pane.activate();
      return;
    }

    inline.start();
    if (available === false) {
      inline.setEnabled(false);
      pane.activate();
    } else {
      pane.deactivate();
      inline.setEnabled(true);
    }
  }

  function onStorageChanged(changes, area) {
    if (area !== 'local') return;
    const wasOn = settings.enabled;
    const before = settings.displayMode;
    settings = applySettingsChanges(settings, changes);

    if (settings.enabled !== wasOn) {
      if (settings.enabled) build();
      else teardown();
      return;
    }
    if (!live) return; // off: the settings are kept, ready for when it is switched on

    live.pane.update(settings);
    live.app.updateSettings(settings);
    live.app.handleStorageChange(changes);
    if (settings.displayMode !== before) reconcile();
  }

  function onMessage(message) {
    if (!live || !message || message.type !== MSG.TOGGLE_VIEW) return;
    if (paneIsShowing()) live.pane.toggle();
    else live.inline.toggle();
  }

  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.runtime.onMessage.addListener(onMessage);
  if (settings.enabled) build();

  return {
    destroy() {
      chrome.storage.onChanged.removeListener(onStorageChanged);
      chrome.runtime.onMessage.removeListener(onMessage);
      teardown();
    },
  };
}
