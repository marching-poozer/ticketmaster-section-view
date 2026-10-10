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
import { LOG_PREFIX } from '../lib/constants.js';
import { MSG } from '../lib/protocol.js';
import { applySettingsChanges, loadSettings } from '../lib/settings.js';
import { createApp } from './app.js';
import { createInline } from './inline.js';
import { createMapLink } from './map.js';
import { createPane } from './pane.js';

const LABEL_MS = 15000;

/**
 * The "Map report" button: gather how the list and the seat map were matched, copy it as text (and print it in the console),
 * and label every block on the map with what it is linked to for a while, so a screenshot shows what is wrong. Resolves to
 * what the button should say.
 */
async function reportOnMap(app, map) {
  const report = Object.assign(app.diagnose(), { map: map.diagnose() });
  const text = JSON.stringify(report, null, 1);
  console.log(LOG_PREFIX + 'Map report:\n' + text);
  map.showLabels(LABEL_MS);
  try {
    await navigator.clipboard.writeText(text);
    return 'Copied ✓ (and blocks labelled)';
  } catch (err) {
    return 'In the console (and blocks labelled)';
  }
}

/**
 * What is going on with the venue's map, for the line under our counter: that it is updating while tickets load, then what its
 * toned-down blocks mean, and which blocks the list does not have at all (nothing when there is nothing to say). Ticketmaster's
 * list does not return every ticket the map shows, so a block the list lacks is left as the map draws it and the line says so.
 */
function mapNote(summary) {
  if (!summary) return null;
  const plural = function (n) { return n + ' block' + (n === 1 ? '' : 's'); };
  // Still loading: the map is being updated as tickets arrive.
  if (!summary.ready) return 'Seat map: updating as tickets load: ' + summary.matched + ' block' + (summary.matched === 1 ? ' has' : 's have') + ' matching tickets so far.';
  const parts = [];
  if (summary.veiled > 0) parts.push(plural(summary.veiled) + ' dimmed: none of the tickets listed there match the current filters' + (summary.standingOnly ? ' (only Standing tickets are showing, which no block of seats can have)' : '') + '.');
  if (summary.unlisted > 0) parts.push(plural(summary.unlisted) + (summary.unlisted === 1 ? ' is' : ' are') + ' available on the map but not in the list (Ticketmaster\'s list leaves some tickets out), so ' + (summary.unlisted === 1 ? 'it is' : 'they are') + ' left as the map shows ' + (summary.unlisted === 1 ? 'it' : 'them') + '.');
  return parts.length ? 'Seat map: ' + parts.join(' ') : null;
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
      onSeatHover(ticket) { if (app) app.highlightTicket(ticket); },
      onSeatClick(ticket) { if (app) app.openTicket(ticket); },
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
      onMapReport() { return reportOnMap(app, map); },
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
