// Section View's brain: owns the user's sort/filter/search state, listens to the
// page reader, and renders the view. The view's `root` is mounted by a host
// (the pane); the host calls start() when the view becomes visible and stop()
// when it's hidden, so the page is only watched and auto-scrolled while Section
// View is actually showing.
import { compileBadges } from '../lib/custom-badges.js';
import { attributesOf } from '../lib/quickpicks.js';
import { MSG } from '../lib/protocol.js';
import { sectionsOf } from '../lib/map-link.js';
import { buildSectionGroups } from '../lib/sections.js';
import { saveSettings } from '../lib/settings.js';
import { uiScale } from '../lib/size.js';
import { deleteVenue, loadVenue, normalizeVenue, saveVenue, venueKey } from '../lib/venues.js';
import { createPageReader } from './page-reader.js';
import { createView } from './view.js';

/** `readerDeps` is for tests (see createPageReader). */
/**
 * `onSections({ sections, visible, ready })` hears about the sections after every render, for the venue's seat map (see map.js);
 * `onSectionHover(name | null, open)` hears when the mouse goes onto a section in the list (`open`: it is open) or off it;
 * `onMapReport()` -> a short message: the "Map report" button was pressed (see display.js);
 * `onTicketHover(ticket | null)` likewise for a ticket; `onShowSection(name)` / `onShowTicket(ticket)`: its "Show on map" button was pressed.
 */
export function createApp({ settings, version, readerDeps, onSections, onSectionHover, onTicketHover, onShowSection, onShowTicket, onMapReport }) {
  // Behaviour that depends on where the view is hosted; see configure().
  const options = { scrollToClicked: true, onShowOriginal: null, followPageSort: false };
  let uiSize = settings.uiSize;
  let appliedScale = null;
  let defaultFrontRows = settings.frontRows;
  let globalBadges = settings.customBadges || []; // custom badges for every venue; the venue's own are in venueConfig
  let customBadges = []; // both, compiled; see syncBadges()
  let attributePills = []; // attributes Ticketmaster lists on the tickets (aisle, ...), as filter pills
  let venue = null; // { id, name } of the page's venue
  let venueConfig = normalizeVenue(null); // its saved settings (where rows start, how many are "front")
  let venueEdits = 0; // counts saves and resets, so a slow load can't overwrite them
  const listeners = new Set();
  const state = {
    sort: settings.sort,
    seat: settings.seatFilter || 'all', // 'firstrow' | 'frontrows' | 'all'
    quality: settings.qualityFilter || 'any', // 'top10' | 'top25' | 'top50' | 'any'
    price: settings.priceFilter || 'any', // 'cheapest' | 'sectionlow' | 'any'
    badgeFilters: new Set(settings.badgeFilters), // the "other" pills that show only their tickets: resale, attributes, the user's own badges
    hideFilters: new Set(settings.hideFilters || []), // ...and the ones that hide them
    search: '',
  };
  let snapshot = null;
  let shownCount = 0; // how many tickets the filters left at the last render

  const reader = createPageReader({
    loadMode: settings.loadMode,
    deps: readerDeps,
    onSnapshot(next) {
      snapshot = next;
      render();
      notify();
    },
  });

  const view = createView(
    {
      onSearch(text) {
        state.search = text.toLowerCase().trim();
        render();
      },
      onSeatSelect(key) {
        state.seat = key;
        view.setSeat(key);
        saveFilters();
        render();
      },
      onQualitySelect(key) {
        state.quality = key;
        view.setQuality(key);
        saveFilters();
        render();
      },
      onPriceSelect(key) {
        state.price = key;
        view.setPrice(key);
        saveFilters();
        render();
      },
      // An "other" pill goes round: off, show only its tickets, hide them, off.
      onBadgeCycle(key) {
        if (state.badgeFilters.has(key)) {
          state.badgeFilters.delete(key);
          state.hideFilters.add(key);
        } else if (state.hideFilters.has(key)) {
          state.hideFilters.delete(key);
        } else {
          state.badgeFilters.add(key);
        }
        view.setBadgeFilters(state.badgeFilters, state.hideFilters);
        saveFilters();
        render();
      },
      onSort(sort) {
        state.sort = sort;
        view.setSort(sort);
        saveSettings({ sort });
        render();
      },
      onQuantityStep(delta) {
        reader.stepQuantity(delta);
      },
      onSectionHover(name, open) {
        if (onSectionHover) onSectionHover(name, open);
      },
      onTicketHover(ticket) {
        if (onTicketHover) onTicketHover(ticket);
      },
      onShowSection(name) {
        if (onShowSection) onShowSection(name);
      },
      onShowTicket(ticket) {
        if (onShowTicket) onShowTicket(ticket);
      },
      onMapReport() {
        return onMapReport ? onMapReport() : '';
      },
      onAutoZoomChange(on) {
        saveSettings({ autoZoomMap: on });
      },
      onSaveVenue({ firstRows, frontRows, badges }) {
        if (!venue) return;
        venueEdits++;
        venueConfig = normalizeVenue({ name: venue.name, firstRows, frontRows, badges });
        showVenue();
        render();
        saveVenue(venue.id, {
          name: venue.name,
          firstRows: venueConfig.firstRows,
          frontRows: venueConfig.frontRows,
          badges: venueConfig.badges,
        });
      },
      onResetVenue() {
        if (!venue) return;
        venueEdits++;
        venueConfig = normalizeVenue(null);
        showVenue();
        render();
        deleteVenue(venue.id);
      },
      onShowOriginal() {
        if (options.onShowOriginal) options.onShowOriginal();
      },
      onOpenSettings() {
        // Content scripts can't open the options page themselves.
        try {
          const sent = chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS });
          if (sent && sent.catch) sent.catch(function () {});
        } catch (err) { /* extension context invalidated */ }
      },
    },
    version
  );
  view.setSort(state.sort);
  view.setAutoZoom(settings.autoZoomMap);
  view.setBadgeFilters(state.badgeFilters, state.hideFilters);
  view.setSeat(state.seat);
  view.setFrontRows(rowConfig().frontRows);
  view.setQuality(state.quality);
  view.setPrice(state.price);
  view.renderMessage('Waiting for tickets to render...');
  syncBadges();

  /** All three together, so the one that was derived from an older version's single list can't be lost. */
  function saveFilters() {
    saveSettings({
      seatFilter: state.seat,
      qualityFilter: state.quality,
      priceFilter: state.price,
      badgeFilters: Array.from(state.badgeFilters),
      hideFilters: Array.from(state.hideFilters),
    });
  }

  // --- the venue --------------------------------------------------------------

  function showVenue() {
    view.setVenue(venue, venueConfig, defaultFrontRows);
    syncBadges();
  }

  /** The custom badges in force: the global ones, then this venue's. Gives the view its filter pills. */
  function syncBadges() {
    customBadges = compileBadges(globalBadges, venueConfig.badges);
    view.setCustomBadges(attributePills.concat(customBadges));
  }

  /** Follow the venue the page says this event is at, loading its saved settings. */
  function syncVenue(next) {
    const same = venue && next ? venue.id === next.id : !venue && !next;
    if (same) {
      if (next && venue.name !== next.name) {
        venue = next;
        showVenue();
      }
      return;
    }

    venue = next;
    venueConfig = normalizeVenue(null);
    showVenue();
    if (!next) return;
    const editsAtStart = venueEdits;
    loadVenue(next.id).then(function (config) {
      if (!venue || venue.id !== next.id) return; // the page moved on meanwhile
      if (venueEdits !== editsAtStart) return; // saved or reset from the panel meanwhile: that is newer
      venueConfig = config;
      showVenue();
      render();
    });
  }

  /** Where rows start and how many count as the front, for the badges. */
  function rowConfig() {
    return { firstRows: venueConfig.firstRows, frontRows: venueConfig.frontRows || defaultFrontRows };
  }

  /** Size the text for the setting and what Ticketmaster's own cards measure. */
  function applyScale() {
    const scale = uiScale(uiSize, snapshot ? snapshot.textPx : null);
    if (scale === appliedScale) return;
    appliedScale = scale;
    view.setScale(scale);
  }
  applyScale();

  /** In inline mode Ticketmaster's own sort control is on screen; follow it instead of offering a second one. */
  function applySort() {
    const following = options.followPageSort && snapshot && snapshot.pageSort;
    if (following && state.sort !== snapshot.pageSort) {
      state.sort = snapshot.pageSort;
      view.setSort(state.sort);
    }
    view.setSortVisible(!following);
  }

  function render() {
    if (!snapshot) return;

    applyScale();
    applySort();
    syncVenue(snapshot.venue);
    view.setFrontRows(rowConfig().frontRows);

    attributePills = attributesOf(snapshot.tickets).map(function (a) {
      return {
        key: a.key,
        text: a.text,
        title: 'Attribute from Ticketmaster: ' + a.names.map(function (n) { return '"' + n + '"'; }).join(', ') + ' — on ' + a.count + (a.count === 1 ? ' ticket' : ' tickets'),
      };
    });
    syncBadges();
    view.setSampleTexts(snapshot.tickets.map(function (t) { return [t.text, t.title]; }));
    // By how it is being loaded, not where the tickets on show came from: while the API is read the page's cards are shown.
    view.renderStatus(snapshot.status, snapshot.viaApi ? 'api' : 'scroll', snapshot.fallback);
    view.renderQuantity(snapshot.qty);
    view.renderCounter(snapshot.tickets.length, snapshot.qty);

    if (snapshot.tickets.length === 0) {
      view.renderMessage('Waiting for tickets to render...');
      return;
    }

    // buildSectionGroups annotates tickets in place; keep the snapshot pristine.
    const result = buildSectionGroups(snapshot.tickets.map(function (t) { return Object.assign({}, t); }), Object.assign({ rowConfig: rowConfig(), customBadges }, state));
    view.setCounts(result.counts);
    if (onSections) {
      onSections({
        sections: sectionsOf(snapshot.tickets),
        visible: new Set(result.groups.map(function (g) { return g.name; })),
        matching: result.groups.reduce(function (all, g) { return all.concat(g.tickets); }, []), // the tickets the filters leave
        ready: snapshot.status.isComplete === true,
      });
    }
    const shown = result.groups.reduce(function (n, g) { return n + g.tickets.length; }, 0);
    shownCount = shown;
    view.renderCounter(snapshot.tickets.length, snapshot.qty, snapshot.tickets.length - shown);
    if (result.empty === 'no-sections') view.renderMessage('No matching blocks found.');
    else if (result.empty === 'no-matches') view.renderMessage('No tickets match the selected filters.');
    else view.renderGroups(result.groups, state.sort, function (ticket) { reader.clickTicket(ticket, { scroll: options.scrollToClicked }); });
  }

  function notify() {
    if (snapshot) listeners.forEach(function (fn) { fn(snapshot); });
  }

  return {
    root: view.root,

    /** The venue's map: the mouse is over (or has left) a block of this section. */
    highlightSection(name) {
      view.highlightSection(name);
    },

    /** What a bug report about the list needs to know: the filters, the counts, where the tickets came from. */
    diagnose() {
      return {
        version,
        page: typeof location !== 'undefined' ? location.pathname : '',
        venue,
        source: snapshot ? (snapshot.viaApi ? 'api' : 'scroll') : null,
        filters: {
          seat: state.seat,
          quality: state.quality,
          price: state.price,
          showOnly: Array.from(state.badgeFilters),
          hide: Array.from(state.hideFilters),
          search: state.search,
        },
        tickets: {
          all: snapshot ? snapshot.tickets.length : 0,
          shown: shownCount,
          loaded: snapshot ? snapshot.status : null,
          quantity: snapshot ? snapshot.qty : null,
        },
      };
    },

    /** Whether the page has an interactive seat map (the header then offers "Auto zoom map"). */
    setMapAvailable(present) {
      view.setMapAvailable(present);
    },

    /** A line about the venue's seat map under the counter (or none, with null). */
    setMapNote(text) {
      view.setMapNote(text);
    },

    /** The venue's map: the mouse is on a seat of this ticket (or has left it, with null). */
    highlightTicket(ticket) {
      view.highlightTicket(ticket ? ticket.id : null);
    },

    /** The venue's map: a seat of this ticket was clicked: open its section in the list and bring it into view. */
    openTicket(ticket) {
      return view.openTicket(ticket ? ticket.id : null);
    },

    /** The venue's map: a block of this section was clicked: open it in the list. */
    openSection(name) {
      return view.openSection(name);
    },

    /**
     * Host-specific behaviour. `scrollToClicked`: scroll Ticketmaster's list to a
     * ticket you pick (pointless when the list is covered). `compact` + `onShowOriginal`:
     * inline layout with a "Show Ticketmaster's list" link. `flow`: the view grows to its
     * content and the page scrolls it, instead of scrolling inside itself.
     */
    configure(next) {
      if ('listLoad' in next) reader.setLoadHooks(next.listLoad);
      if ('scrollToClicked' in next) options.scrollToClicked = next.scrollToClicked;
      if ('onShowOriginal' in next) options.onShowOriginal = next.onShowOriginal;
      if ('compact' in next) view.setCompact(next.compact);
      if ('flow' in next) view.setFlow(next.flow);
      if ('followPageSort' in next) options.followPageSort = next.followPageSort;
      applySort();
      view.setOriginalLink(typeof options.onShowOriginal === 'function');
    },

    /** Text size setting changed ('compact' | 'match' | 'comfort'). */
    setUiSize(next) {
      uiSize = next;
      applyScale();
    },

    /** The global settings changed: text size, how many rows count as the front by default, the global badges. */
    updateSettings(next) {
      this.setUiSize(next.uiSize);
      if (typeof next.autoZoomMap === 'boolean') view.setAutoZoom(next.autoZoomMap);
      if (next.loadMode) reader.setLoadMode(next.loadMode);
      const badgesChanged = JSON.stringify(next.customBadges || []) !== JSON.stringify(globalBadges);
      if (next.frontRows !== defaultFrontRows || badgesChanged) {
        defaultFrontRows = next.frontRows;
        globalBadges = next.customBadges || [];
        showVenue();
        render();
      }
    },

    /** A storage change: pick up edits to this venue's settings made elsewhere (another tab, the options page). */
    handleStorageChange(changes) {
      if (!venue || !changes[venueKey(venue.id)]) return;
      venueConfig = normalizeVenue(changes[venueKey(venue.id)].newValue);
      showVenue();
      render();
    },

    /** Called with each new page snapshot. Returns an unsubscribe function. */
    subscribe(fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },

    start() {
      reader.start();
    },
    stop() {
      reader.stop();
    },
  };
}
