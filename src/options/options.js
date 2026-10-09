// The options page: where Section View is shown (in place of Ticketmaster's
// list, or in a floating pane), the text size, how tickets are loaded, how many rows count as the front,
// the custom badges, each saved venue's row settings and badges, and the floating
// pane's side and width. Changes are saved as they're made, except the badge
// editors, which have a Save button (their patterns are checked first).
import { createBadgeEditor } from '../lib/badge-editor.js';
import { h } from '../lib/dom.js';
import { DEFAULT_PANE_WIDTH, MAX_FRONT_ROWS, applySettingsChanges, loadSettings, saveSettings } from '../lib/settings.js';
import {
  VENUE_KEY_PREFIX,
  deleteVenue,
  formatRowList,
  listVenues,
  parseFrontRows,
  parseRowList,
  saveVenue,
} from '../lib/venues.js';

/** Wire up options.html. Resolves to a handle with destroy() (used by tests). */
export async function init() {
  let settings = await loadSettings();

  const enabledBox = document.getElementById('enabled');
  const widthLabel = document.getElementById('width-label');
  const resetWidth = document.getElementById('reset-width');
  const sideRadios = Array.from(document.querySelectorAll('input[name="paneSide"]'));
  const modeRadios = Array.from(document.querySelectorAll('input[name="displayMode"]'));
  const sizeRadios = Array.from(document.querySelectorAll('input[name="uiSize"]'));
  const loadRadios = Array.from(document.querySelectorAll('input[name="loadMode"]'));

  const frontRowsInput = document.getElementById('front-rows');
  const frontRowsMessage = document.getElementById('front-rows-message');
  const venueList = document.getElementById('venue-list');
  const venuesEmpty = document.getElementById('venues-empty');

  /** One saved venue: its name, where its tiers start, how many rows are "front", and Save / Remove. */
  function venueRow(venue) {
    const tiers = h('input', { type: 'text', 'aria-label': 'Tiers start at row', autocomplete: 'off', placeholder: '1' });
    tiers.value = formatRowList(venue.firstRows);
    const front = h('input', { type: 'text', class: 'narrow', 'aria-label': 'Front rows', inputmode: 'numeric', autocomplete: 'off', placeholder: String(settings.frontRows) });
    front.value = venue.frontRows === null ? '' : String(venue.frontRows);
    const badges = createBadgeEditor();
    badges.setBadges(venue.badges);
    const message = h('span', { class: 'inline-message', role: 'status' });
    badges.root.addEventListener('input', function () { message.textContent = ''; });

    function save() {
      const firstRows = parseRowList(tiers.value);
      if (firstRows === null) {
        message.textContent = 'Enter row numbers or letters (not a mix) separated by commas, e.g. 21, 33 or A, K.';
        return;
      }
      const frontRowsValue = parseFrontRows(front.value);
      if (frontRowsValue === undefined) {
        message.textContent = 'Front rows must be a whole number from 1 to ' + MAX_FRONT_ROWS + ', or blank.';
        return;
      }
      const badgeResult = badges.read();
      if (!badgeResult.ok) {
        message.textContent = 'Fix the badges marked above.';
        return;
      }
      message.textContent = '';
      saveVenue(venue.id, { name: venue.name, firstRows, frontRows: frontRowsValue, badges: badgeResult.badges });
    }

    return h(
      'div',
      { class: 'venue-row', 'data-venue': venue.id },
      h('div', { class: 'venue-title' }, h('strong', { text: venue.name || 'Venue ' + venue.id }), h('span', { class: 'venue-id', text: 'venue ' + venue.id })),
      h(
        'div',
        { class: 'venue-fields' },
        h('label', {}, 'Tiers start at row', tiers),
        h('label', {}, 'Front rows', front)
      ),
      h('div', { class: 'venue-badges' }, h('span', { class: 'venue-badges-title', text: 'Badges for this venue' }), badges.root),
      h(
        'div',
        { class: 'venue-actions' },
        h('button', { type: 'button', class: 'venue-save', text: 'Save', on: { click: save } }),
        h('button', { type: 'button', class: 'venue-remove danger', text: 'Remove', on: { click: function () { deleteVenue(venue.id); } } }),
        message
      )
    );
  }

  // --- custom badges that apply at every venue ---
  const globalBadges = createBadgeEditor();
  document.getElementById('global-badges').append(globalBadges.root);
  const saveBadgesButton = document.getElementById('save-badges');
  const badgesMessage = document.getElementById('badges-message');
  const badgesSaved = document.getElementById('badges-saved');
  let shownBadges = JSON.stringify(settings.customBadges);
  globalBadges.setBadges(settings.customBadges);

  function onSaveBadges() {
    const result = globalBadges.read();
    badgesSaved.textContent = '';
    if (!result.ok) {
      badgesMessage.textContent = 'Fix the badges marked above.';
      return;
    }
    badgesMessage.textContent = '';
    shownBadges = JSON.stringify(result.badges);
    globalBadges.setBadges(result.badges);
    change({ customBadges: result.badges });
    badgesSaved.textContent = 'Saved';
  }
  saveBadgesButton.addEventListener('click', onSaveBadges);
  globalBadges.root.addEventListener('input', function () {
    badgesMessage.textContent = '';
    badgesSaved.textContent = '';
  });

  let renderToken = 0;
  async function renderVenues() {
    const token = ++renderToken;
    const venues = await listVenues();
    if (token !== renderToken) return; // a newer render is on its way
    venueList.replaceChildren.apply(venueList, venues.map(venueRow));
    venuesEmpty.hidden = venues.length > 0;
  }

  function render() {
    enabledBox.checked = settings.enabled;
    frontRowsInput.value = String(settings.frontRows);
    modeRadios.forEach(function (r) { r.checked = r.value === settings.displayMode; });
    sizeRadios.forEach(function (r) { r.checked = r.value === settings.uiSize; });
    loadRadios.forEach(function (r) { r.checked = r.value === settings.loadMode; });
    sideRadios.forEach(function (r) { r.checked = r.value === settings.paneSide; });
    widthLabel.textContent = settings.paneWidth + ' px';
    resetWidth.textContent = 'Reset to ' + DEFAULT_PANE_WIDTH + ' px';
    resetWidth.disabled = settings.paneWidth === DEFAULT_PANE_WIDTH;
  }

  function change(patch) {
    settings = Object.assign({}, settings, patch);
    render();
    return saveSettings(patch);
  }

  function onEnabledChange(e) {
    change({ enabled: e.target.checked });
  }
  enabledBox.addEventListener('change', onEnabledChange);
  function onSideChange(e) {
    if (e.target.checked) change({ paneSide: e.target.value });
  }
  function onModeChange(e) {
    if (e.target.checked) change({ displayMode: e.target.value });
  }
  function onSizeChange(e) {
    if (e.target.checked) change({ uiSize: e.target.value });
  }
  function onLoadChange(e) {
    if (e.target.checked) change({ loadMode: e.target.value });
  }
  function onReset() {
    change({ paneWidth: DEFAULT_PANE_WIDTH });
  }
  sideRadios.forEach(function (r) { r.addEventListener('change', onSideChange); });
  modeRadios.forEach(function (r) { r.addEventListener('change', onModeChange); });
  sizeRadios.forEach(function (r) { r.addEventListener('change', onSizeChange); });
  loadRadios.forEach(function (r) { r.addEventListener('change', onLoadChange); });
  resetWidth.addEventListener('click', onReset);

  function onFrontRowsChange() {
    const value = parseFrontRows(frontRowsInput.value);
    if (typeof value !== 'number') {
      frontRowsMessage.textContent = 'Enter a whole number from 1 to ' + MAX_FRONT_ROWS + '.';
      frontRowsInput.value = String(settings.frontRows);
      return;
    }
    frontRowsMessage.textContent = '';
    change({ frontRows: value });
  }
  frontRowsInput.addEventListener('change', onFrontRowsChange);

  // Stay in step with changes made elsewhere (e.g. dragging the pane's edge).
  function onStorageChanged(changes, area) {
    if (area !== 'local') return;
    settings = applySettingsChanges(settings, changes);
    render();
    // Another tab or page changed the global badges: show them, unless that's what we just saved.
    if (changes.customBadges && JSON.stringify(settings.customBadges) !== shownBadges) {
      shownBadges = JSON.stringify(settings.customBadges);
      globalBadges.setBadges(settings.customBadges);
    }
    if (Object.keys(changes).some(function (k) { return k.startsWith(VENUE_KEY_PREFIX); })) renderVenues();
  }
  chrome.storage.onChanged.addListener(onStorageChanged);

  render();
  await renderVenues();

  return {
    destroy() {
      enabledBox.removeEventListener('change', onEnabledChange);
      sideRadios.forEach(function (r) { r.removeEventListener('change', onSideChange); });
      modeRadios.forEach(function (r) { r.removeEventListener('change', onModeChange); });
      sizeRadios.forEach(function (r) { r.removeEventListener('change', onSizeChange); });
      loadRadios.forEach(function (r) { r.removeEventListener('change', onLoadChange); });
      resetWidth.removeEventListener('click', onReset);
      saveBadgesButton.removeEventListener('click', onSaveBadges);
      frontRowsInput.removeEventListener('change', onFrontRowsChange);
      chrome.storage.onChanged.removeListener(onStorageChanged);
    },
  };
}
