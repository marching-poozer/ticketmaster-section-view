// Composition root of the content script: loads settings, builds the app and
// shows it in the configured display mode, and keeps that in step with the
// settings, the page, and the toolbar icon.
//
//   inline mode: the view replaces Ticketmaster's ticket list. If Ticketmaster's
//                pane can't be found (another layout, or a page with no
//                tickets), the floating pane stands in until it appears.
//   pane mode:   the floating pane, always.
import { MSG } from '../lib/protocol.js';
import { applySettingsChanges, loadSettings } from '../lib/settings.js';
import { createApp } from './app.js';
import { createInline } from './inline.js';
import { createPane } from './pane.js';

/** Start Section View on this page. Resolves to a handle with destroy() (used by tests). */
export async function initDisplay() {
  let settings = await loadSettings();
  let available = null; // is Ticketmaster's pane on the page? (null = not known yet)

  const app = createApp({ settings, version: chrome.runtime.getManifest().version });
  const pane = createPane(app, settings, { active: false });
  const inline = createInline(app, {
    onAvailability(isAvailable) {
      available = isAvailable;
      reconcile();
    },
  });

  function paneIsShowing() {
    return settings.displayMode === 'pane' || available === false;
  }

  /** Make exactly one of the two hosts responsible for the view. The old one goes first. */
  function reconcile() {
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
    const before = settings.displayMode;
    settings = applySettingsChanges(settings, changes);
    pane.update(settings);
    app.updateSettings(settings);
    app.handleStorageChange(changes);
    if (settings.displayMode !== before) reconcile();
  }

  function onMessage(message) {
    if (!message || message.type !== MSG.TOGGLE_VIEW) return;
    if (paneIsShowing()) pane.toggle();
    else inline.toggle();
  }

  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.runtime.onMessage.addListener(onMessage);
  reconcile();

  return {
    destroy() {
      chrome.storage.onChanged.removeListener(onStorageChanged);
      chrome.runtime.onMessage.removeListener(onMessage);
      inline.destroy();
      pane.destroy();
    },
  };
}
