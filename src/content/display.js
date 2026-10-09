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
import { createMapLink } from './map.js';
import { createPane } from './pane.js';

/** What the grey blocks on the venue's map mean, for the line under our counter (nothing when none are grey). */
function mapNote(summary) {
  if (!summary || summary.veiled === 0) return null;
  return 'Seat map: ' + summary.veiled + ' block' + (summary.veiled === 1 ? '' : 's') + ' greyed, with no tickets matching your filters.';
}

/** Start Section View on this page. Resolves to a handle with destroy() (used by tests). */
export async function initDisplay() {
  let settings = await loadSettings();
  let live = null; // { app, pane, inline, map } while Section View is on; null while it is switched off
  let available = null; // is Ticketmaster's pane on the page? (null = not known yet)

  /** Build the app and its two hosts, and make one of them responsible for the view. */
  function build() {
    // The venue's seat map, where the page has one: our filters dim its empty blocks, and the map and the list light each other up.
    let app = null; // the map and the app each call the other: the map is made first
    const map = createMapLink({
      onHover(name) { if (app) app.highlightSection(name); },
      onClick(name) { if (app) app.openSection(name); },
      onPresence(present) { if (app) app.setMapAvailable(present); },
    });
    map.setEnabled(settings.mapLink);
    map.setAutoZoom(settings.autoZoomMap);
    app = createApp({
      settings,
      version: chrome.runtime.getManifest().version,
      onSections(state) {
        map.update(state);
        app.setMapNote(mapNote(map.summary()));
      },
      onSectionHover(name, open) { map.hover(name, open); },
      onTicketHover(ticket) { map.hoverTicket(ticket); },
      onShowSection(name) { map.showSection(name); },
      onShowTicket(ticket) { map.showTicket(ticket); },
    });
    app.setMapAvailable(map.present());
    const pane = createPane(app, settings, { active: false });
    const inline = createInline(app, {
      onAvailability(isAvailable) {
        available = isAvailable;
        reconcile();
      },
    });
    live = { app, pane, inline, map };
    reconcile();
  }

  /** Take it all off the page again (the hosts undo what they did to Ticketmaster's own list). */
  function teardown() {
    if (!live) return;
    const old = live;
    live = null;
    available = null;
    old.map.destroy();
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
    const mapBefore = settings.mapLink;
    const zoomBefore = settings.autoZoomMap;
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
    if (settings.mapLink !== mapBefore) live.map.setEnabled(settings.mapLink);
    if (settings.autoZoomMap !== zoomBefore) live.map.setAutoZoom(settings.autoZoomMap);
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
