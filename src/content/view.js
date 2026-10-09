// The Section View UI: header (counter, status, search, badge filters, sort,
// quantity stepper) and the section/ticket list. It holds no application state
// apart from which sections are expanded — app.js owns the rest and pushes it
// in. `root` is a detached element; whoever hosts the view (the pane) puts it in
// a shadow root together with VIEW_CSS. All text goes in via textContent.
import { MAX_TICKETS, MIN_TICKETS, OTHER_FILTERS, PRICE_FILTERS, QUALITY_FILTERS, SEAT_FILTERS, VIP_SECTION, frontRowsLabel } from '../lib/constants.js';
import { createBadgeEditor } from '../lib/badge-editor.js';
import { describeBadges, groupBadges } from '../lib/badges.js';
import { formatPrice } from '../lib/currency.js';
import { h } from '../lib/dom.js';
import { scrollIntoScroller } from '../lib/scroll.js';
import { describeSeats } from '../lib/seats.js';
import { formatBestTicketLabel } from '../lib/sections.js';
import { headerScale } from '../lib/size.js';
import { formatRowList, parseFrontRows, parseRowList } from '../lib/venues.js';

/**
 * A badge. With `iconOnly` just its emoji (the price badges), the name and what it means on hover.
 */
function badgeNode(b, iconOnly) {
  const node = h('span', {
    class: 'badge' + (iconOnly ? ' icon' : ''),
    title: iconOnly ? b.label + ' — ' + b.title : b.title,
    text: iconOnly && b.icon ? b.icon : b.text,
  });
  if (iconOnly) node.setAttribute('aria-label', b.label + '. ' + b.title);
  node.style.background = b.bg;
  node.style.color = b.color;
  return node;
}

/**
 * One ticket, under its row's heading (see rowGroupNode):
 *   Seats 187-188 (2 seats) Full Price Ticket                              [price badges] €80.75
 *   [quality, attributes, your badges]
 * No seats (standing) leaves just the ticket type; no badges, no second line. The row is still in the card as
 * visually hidden text, for a screen reader that reads the card on its own.
 */
/** `hooks`: { click(ticket), hover(ticket | null) }. */
function ticketRow(ticket, sectionName, hooks) {
  const groups = groupBadges(describeBadges(ticket, sectionName));
  const seats = describeSeats(ticket);
  const seatBadges = groups.seat.length > 0 ? h('span', { class: 'badges' }, groups.seat.map(function (b) { return badgeNode(b, false); })) : null;
  const ticketType = ticket.ticketType ? h('span', { class: 'ticket-type', text: ticket.ticketType }) : null;

  // The badges get a line of their own (under the seats and the price) so a long one doesn't squeeze the seats.
  const seatLine =
    seats || ticketType
      ? h(
          'div',
          { class: 'ticket-line ticket-seat-line' },
          seats ? h('span', { class: 'ticket-seats', text: seats.text }) : null,
          seats && seats.countText ? h('span', { class: 'ticket-seat-count', text: seats.countText }) : null,
          ticketType
        )
      : null;
  const badgeLine = seatBadges ? h('div', { class: 'ticket-line ticket-badge-line' + (seatLine ? '' : ' alone') }, seatBadges) : null;

  return h(
    'div',
    {
      class: 'ticket',
      on: {
        click: function () { hooks.click(ticket); },
        // The mouse on a ticket is the mouse on its seats on the venue's map (when it is zoomed in to them).
        mouseenter: function () { if (hooks.hover) hooks.hover(ticket); },
        mouseleave: function () { if (hooks.hover) hooks.hover(null); },
      },
    },
    h('span', { class: 'ticket-title visually-hidden', text: ticket.rowLabel || ticket.title }),
    h('div', { class: 'ticket-main' }, seatLine, badgeLine),
    h(
      'div',
      { class: 'ticket-side' },
      groups.price.length > 0 ? h('span', { class: 'badges price-badges' }, groups.price.map(function (b) { return badgeNode(b, true); })) : null,
      h('span', {
        class: 'ticket-price',
        text: ticket.price > 0 ? formatPrice(ticket.price, ticket.currency) : 'View Details',
      })
    )
  );
}

/**
 * A row of a section: its heading (the row, where it is in its tier, how many tickets if more than one) and the
 * tickets in it.
 */
function rowGroupNode(rowGroup, sectionName, hooks) {
  const badges = describeBadges(rowGroup.topTicket, sectionName).filter(function (b) { return b.group === 'row'; });
  return h(
    'div',
    { class: 'row-group' },
    h(
      'div',
      { class: 'row-head' },
      h('span', { class: 'row-title', text: rowGroup.label }),
      // A VIP package is grouped under "VIP PACKAGES", so say which section it is in.
      rowGroup.section ? h('span', { class: 'ticket-section', text: 'Sec ' + rowGroup.section }) : null,
      // Where the row is in its tier, when no badge says (a first or front row has one)...
      rowGroup.place
        ? h('span', {
            class: 'row-place',
            text: '(' + rowGroup.place + ')',
            title: rowGroup.label + ' is the ' + rowGroup.place + ' row of its tier (which starts at Row ' + (rowGroup.topTicket.tierStartName || rowGroup.topTicket.tierStart) + ')',
          })
        : null,
      // ...and how many tickets, when there is more than one.
      rowGroup.tickets.length > 1 ? h('span', { class: 'count', title: rowGroup.tickets.length + ' tickets in this row', text: '(' + rowGroup.tickets.length + ')' }) : null,
      badges.length > 0 ? h('span', { class: 'badges' }, badges.map(function (b) { return badgeNode(b, false); })) : null
    ),
    h(
      'div',
      { class: 'row-tickets' },
      rowGroup.tickets.map(function (t) { return ticketRow(t, sectionName, hooks); })
    )
  );
}

/** `mouse.section`: the section the mouse is on in this list (null when none). */
function sectionNode(group, sort, expanded, hooks, onSectionHover, mouse) {
  const details = h(
    'details',
    {
      class: 'section',
      'data-section': group.name,
      on: {
        // The list is rebuilt on every update; remember what the user had open.
        toggle: function () {
          if (details.open) expanded.add(group.name);
          else expanded.delete(group.name);
          // Opened while the mouse is on it: the map should now open it too.
          if (details.open && mouse.section === group.name && onSectionHover) onSectionHover(group.name, true);
        },
        // The mouse on a section (its header, or its tickets when open) is the mouse on its block on the venue's map.
        mouseenter: function () {
          mouse.section = group.name;
          if (onSectionHover) onSectionHover(group.name, details.open);
        },
        mouseleave: function () {
          if (mouse.section === group.name) mouse.section = null;
          if (onSectionHover) onSectionHover(null, false);
        },
      },
    },
    h(
      'summary',
{},
      h(
        'span',
        { class: 'section-name' },
        h(
          'span',
          {},
          group.name === VIP_SECTION ? group.name : 'Section ' + group.name,
          h('span', { class: 'count', text: '(' + group.tickets.length + ')' })
        )
      ),
      h('span', { class: 'best', text: formatBestTicketLabel(group.topTicket, sort) })
    ),
    h(
      'div',
      { class: 'tickets' },
      group.rows.map(function (r) { return rowGroupNode(r, group.name, hooks); })
    )
  );
  details.open = expanded.has(group.name);
  return details;
}

/**
 * `handlers`: onSearch(text), onSeatSelect(key), onQualitySelect(key), onPriceSelect(key), onBadgeCycle(key), onSort('row'|'price'),
 * onQuantityStep(delta), onShowOriginal(), onOpenSettings(),
 * onSaveVenue({ firstRows, frontRows, badges }), onResetVenue().
 */
export function createView(handlers, version) {
  const counter = h('div', { class: 'counter', text: 'Total Loaded: 0' });
  const mapNote = h('div', { class: 'map-note', hidden: true });
  const status = h('span', { class: 'status', text: 'Checking...' });

  const search = h('input', {
    type: 'text',
    class: 'search',
    placeholder: 'Filter blocks (e.g. BLOCKA, STANDING)...',
    autocomplete: 'off',
    on: { input: function (e) { handlers.onSearch(e.target.value); } },
  });

  // --- filter pills: Seats and Price are one choice each, Other toggles ---------
  let counts = null; // what each pill would show, from the app (see buildSectionGroups)

  // "🚶 Aisle" -> "Aisle"
  const LEADING_ICON = /^\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s+/u;

  /**
   * A pill reads its label and, once the app has counted, how many tickets it would show. A pill that is
   * hiding its tickets swaps its icon for 🚫 (and is struck through, see the styles).
   */
  function renderPill(pill, count) {
    const label = pill.getAttribute('data-label');
    const shown = pill.getAttribute('data-state') === 'hide' ? '🚫 ' + label.replace(LEADING_ICON, '') : label;
    pill.textContent = typeof count === 'number' ? shown + ' (' + count + ')' : shown;
    pill.classList.toggle('zero', count === 0);
  }

  /**
   * A group of pills of which exactly one is chosen: one pill split into segments ("Standing | 1st Row | All"),
   * behaving as radio buttons (one tab stop, arrow keys move the choice).
   */
  function choiceGroup(title, attribute, filters, onChoose) {
    const pills = filters.map(function (f) {
      const pill = h('button', { type: 'button', class: 'pill', role: 'radio', 'aria-checked': 'false', tabindex: '-1', 'data-label': f.label, text: f.label });
      pill.setAttribute('data-' + attribute, f.key);
      return pill;
    });
    pills[0].setAttribute('tabindex', '0'); // until something is chosen: the first is "no filter"
    const bar = h(
      'div',
      {
        class: 'pills segmented',
        role: 'radiogroup',
        'aria-label': title,
        on: {
          click: function (e) {
            const pill = e.target.closest('[data-' + attribute + ']');
            if (pill) onChoose(pill.getAttribute('data-' + attribute));
          },
          keydown: function (e) {
            const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            const current = e.target.closest('[data-' + attribute + ']');
            if (!step || !current) return;
            e.preventDefault();
            const next = pills[(pills.indexOf(current) + step + pills.length) % pills.length];
            onChoose(next.getAttribute('data-' + attribute));
            next.focus();
          },
        },
      },
      pills
    );
    return { node: h('div', { class: 'pill-group', 'data-group': attribute }, h('span', { class: 'pill-label', text: title }), bar), pills };
  }

  function choose(group, attribute, key) {
    group.pills.forEach(function (pill) {
      const chosen = pill.getAttribute('data-' + attribute) === key;
      pill.setAttribute('aria-checked', String(chosen));
      pill.setAttribute('tabindex', chosen ? '0' : '-1');
    });
  }

  function countChoices(group, attribute, byKey) {
    group.pills.forEach(function (pill) { renderPill(pill, byKey ? byKey[pill.getAttribute('data-' + attribute)] : undefined); });
  }

  const seatGroup = choiceGroup('Seats', 'seat', SEAT_FILTERS, function (key) { handlers.onSeatSelect(key); });
  const qualityGroup = choiceGroup('Quality', 'quality', QUALITY_FILTERS, function (key) { handlers.onQualitySelect(key); });
  qualityGroup.node.hidden = true; // only once there are quality scores to filter on (they come from the list API)
  const priceGroup = choiceGroup('Price', 'price', PRICE_FILTERS, function (key) { handlers.onPriceSelect(key); });

  function otherPill(key, label, extraClass, title) {
    return h('button', {
      type: 'button',
      class: 'pill' + (extraClass ? ' ' + extraClass : ''),
      'data-badge': key,
      'data-label': label,
      'data-title': title,
      'data-state': 'off',
      'aria-pressed': 'false',
      text: label,
      title,
    });
  }

  // What the next click does, for the tooltip of a pill in each state.
  const NEXT_CLICK = {
    off: 'Click to show only these tickets',
    show: 'Showing only these tickets. Click to hide them instead',
    hide: 'Hiding these tickets. Click to stop',
  };
  const pillBar = h(
    'div',
    {
      class: 'pills',
      on: {
        click: function (e) {
          const pill = e.target.closest('[data-badge]');
          if (pill) handlers.onBadgeCycle(pill.getAttribute('data-badge'));
        },
      },
    },
    OTHER_FILTERS.map(function (f) { return otherPill(f.key, f.label); })
  );
  const filters = h(
    'div',
    { class: 'filters' },
    seatGroup.node,
    qualityGroup.node,
    priceGroup.node,
    h('div', { class: 'pill-group', 'data-group': 'other' }, h('span', { class: 'pill-label', text: 'Other' }), pillBar)
  );
  // Attributes from the list API and the user's own badges (global + this venue's) get pills after the built-in ones.
  let customSignature = '';
  let activeFilters = new Set(); // "Other" pills showing only their tickets
  let hiddenFilters = new Set(); // ...and hiding them

  /** Each pill is off, showing only its tickets (white), or hiding them (red, struck through). */
  function syncPills() {
    pillBar.querySelectorAll('[data-badge]').forEach(function (pill) {
      const key = pill.getAttribute('data-badge');
      const state = hiddenFilters.has(key) ? 'hide' : activeFilters.has(key) ? 'show' : 'off';
      pill.setAttribute('data-state', state);
      pill.setAttribute('aria-pressed', String(state === 'show'));
      const name = pill.getAttribute('data-label').replace(LEADING_ICON, '');
      if (state === 'off') pill.removeAttribute('aria-label');
      else pill.setAttribute('aria-label', name + (state === 'hide' ? ': hidden' : ': showing only these'));
      pill.title = [pill.getAttribute('data-title'), NEXT_CLICK[state]].filter(Boolean).join('\n');
      renderPill(pill, counts && counts.other ? counts.other[key] : undefined);
    });
  }

  const sortButtons = [['row', 'Best Seats'], ['price', 'Price']].map(function ([key, label]) {
    return h('button', { type: 'button', class: 'chip', 'data-sort': key, 'aria-pressed': 'false', text: label });
  });
  const sortBar = h(
    'div',
    {
      class: 'control-row',
      on: {
        click: function (e) {
          const btn = e.target.closest('[data-sort]');
          if (btn) handlers.onSort(btn.getAttribute('data-sort'));
        },
      },
    },
    h('span', { class: 'control-label', text: 'Sort:' }),
    sortButtons
  );

  const minus = h('button', { type: 'button', 'aria-label': 'Fewer tickets', text: '-', on: { click: function () { handlers.onQuantityStep(-1); } } });
  const plus = h('button', { type: 'button', 'aria-label': 'More tickets', text: '+', on: { click: function () { handlers.onQuantityStep(1); } } });
  const qty = h('span', { class: 'qty-value', text: '1' });

  // Hidden in compact mode: Ticketmaster's own "N Tickets" chip is on screen then.
  const qtyRow = h(
    'div',
    { class: 'control-row qty-row' },
    h('span', { class: 'control-label', text: 'Ticket Qty:' }),
    h('div', { class: 'stepper' }, minus, qty, plus)
  );

  const content = h('div', { class: 'sv-content' });

  // Only drawn when the view replaces Ticketmaster's list (see setOriginalLink).
  const originalRow = h(
    'div',
    { class: 'control-row original-row', hidden: true },
    h('button', { type: 'button', class: 'link-btn', text: 'Show Ticketmaster\'s list', on: { click: function () { handlers.onShowOriginal(); } } })
  );
  originalRow.hidden = true;

  const controlBox = h('div', { class: 'control-box' }, sortBar, qtyRow, originalRow);

  /** The box has a background of its own, so hide it when every row inside is hidden. */
  function syncControlBox() {
    const qtyShown = !root.classList.contains('compact');
    controlBox.hidden = sortBar.hidden && !qtyShown && originalRow.hidden;
  }

  // --- venue settings: where this venue's rows start, and what counts as the front ---
  let venueDefaultFront = 5;
  const venueName = h('div', { class: 'venue-name' });
  const tiersInput = h('input', {
    type: 'text', class: 'venue-input', autocomplete: 'off', placeholder: '1',
    'aria-label': 'Tiers start at row',
  });
  const frontInput = h('input', {
    type: 'text', class: 'venue-input', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Front rows',
  });
  const venueMessage = h('div', { class: 'venue-message', role: 'status' });
  const badgeEditor = createBadgeEditor();
  badgeEditor.root.addEventListener('input', function () { venueMessage.textContent = ''; });
  const venueField = function (label, input, hint) {
    return h('label', { class: 'venue-field' }, h('span', { class: 'venue-label', text: label }), input, h('small', { class: 'venue-hint', text: hint }));
  };
  const venuePanel = h(
    'div',
    { class: 'venue-panel', hidden: true, on: { keydown: function (e) { if (e.key === 'Escape') closeVenuePanel(); else if (e.key === 'Enter' && e.target.tagName === 'INPUT') saveVenue(); } } },
    venueName,
    venueField('Tiers start at row', tiersInput, 'The row each tier or level starts at, e.g. 21, 33, or letters if the rows are lettered, e.g. A, K. Leave as 1 if rows start at the beginning.'),
    venueField('Front rows', frontInput, 'How many rows from the front of each tier count as the first rows: the "First N Rows" filter and the ⭐ badges.'),
    h(
      'div',
      { class: 'venue-field' },
      h('span', { class: 'venue-label', text: 'Badges for this venue' }),
      badgeEditor.root,
      h('small', { class: 'venue-hint', text: 'Tag tickets whose text matches a pattern (a regular expression, ignoring case), e.g. aisle. Pattern help, and badges for every venue, are in Settings (⚙).' })
    ),
    venueMessage,
    h(
      'div',
      { class: 'control-row' },
      h('button', { type: 'button', class: 'chip venue-save', text: 'Save', on: { click: function () { saveVenue(); } } }),
      h('button', { type: 'button', class: 'chip venue-reset', text: 'Reset to defaults', on: { click: function () { closeVenuePanel(); handlers.onResetVenue(); } } })
    )
  );
  const venueButton = h('button', {
    type: 'button',
    class: 'icon-btn venue-btn',
    title: 'Venue settings',
    'aria-label': 'Venue settings',
    'aria-expanded': 'false',
    text: '📍',
    hidden: true,
    on: { click: function () { if (venuePanel.hidden) openVenuePanel(); else closeVenuePanel(); } },
  });
  venueButton.hidden = true;
  venuePanel.hidden = true;

  function openVenuePanel() {
    venuePanel.hidden = false;
    venueMessage.textContent = '';
    venueButton.setAttribute('aria-expanded', 'true');
    tiersInput.focus();
  }

  function closeVenuePanel() {
    venuePanel.hidden = true;
    venueButton.setAttribute('aria-expanded', 'false');
  }

  function saveVenue() {
    const firstRows = parseRowList(tiersInput.value);
    if (firstRows === null) {
      venueMessage.textContent = 'Tiers: enter row numbers or letters (not a mix) separated by commas, e.g. 21, 33 or A, K.';
      return;
    }
    const frontRows = parseFrontRows(frontInput.value);
    if (frontRows === undefined) {
      venueMessage.textContent = 'Front rows: enter a whole number from 1 to 50, or leave blank for the default (' + venueDefaultFront + ').';
      return;
    }
    const badges = badgeEditor.read();
    if (!badges.ok) {
      venueMessage.textContent = 'Badges: fix the entries marked above.';
      return;
    }
    closeVenuePanel();
    handlers.onSaveVenue({ firstRows, frontRows, badges: badges.badges });
  }

  const root = h(
    'div',
    { class: 'sv' },
    h(
      'div',
      { class: 'sv-header' },
      h(
        'div',
        { class: 'title-row' },
        h(
          'div',
          {},
          h('div', { class: 'title' }, h('span', { class: 'title-text', text: 'Section View' }), h('span', { class: 'version', text: 'v' + version })),
          counter,
          mapNote
        ),
        h(
          'div',
          { class: 'title-actions' },
          status,
          venueButton,
          h('button', {
            type: 'button',
            class: 'icon-btn gear-btn',
            title: 'Settings',
            'aria-label': 'Settings',
            text: '⚙',
            on: { click: function () { handlers.onOpenSettings(); } },
          })
        )
      ),
      venuePanel,
      h(
        'div',
        { class: 'controls' },
        search,
        filters,
        controlBox
      )
    ),
    content
  );

  // Names of sections the user has expanded; survives list re-renders.
  const expanded = new Set();
  let highlightedSection = null; // the section the mouse is over on the map
  const mouse = { section: null }; // the section the mouse is on in this list
  const onTicketHover = function (ticket) { if (handlers.onTicketHover) handlers.onTicketHover(ticket); };
  const onSectionHover = function (name, open) { if (handlers.onSectionHover) handlers.onSectionHover(name, open === true); };
  const sectionElement = function (name) {
    return Array.from(content.querySelectorAll('.section')).find(function (el) { return el.getAttribute('data-section') === name; }) || null;
  };
  const applySectionHighlight = function () {
    content.querySelectorAll('.section.map-hover').forEach(function (el) { el.classList.remove('map-hover'); });
    const el = highlightedSection === null ? null : sectionElement(highlightedSection);
    if (el) el.classList.add('map-hover');
  };

  return {
    root,

    setSearch(text) {
      search.value = text;
    },

    setSort(sort) {
      sortButtons.forEach(function (btn) {
        btn.setAttribute('aria-pressed', String(btn.getAttribute('data-sort') === sort));
      });
    },

    /** The "Other" pills that show only their tickets (`active`), and the ones that hide them (`hidden`). */
    setBadgeFilters(active, hidden) {
      activeFilters = active;
      hiddenFilters = hidden || new Set();
      syncPills();
    },

    /**
     * How many rows the front-rows choice covers (the venue's setting, or the default): its label says so, "⭐ First 3
     * Rows", and its tooltip says where that is set.
     */
    setFrontRows(n) {
      const pill = seatGroup.pills.find(function (p) { return p.getAttribute('data-seat') === 'frontrows'; });
      pill.setAttribute('data-label', frontRowsLabel(n));
      pill.title = 'The first ' + n + (n === 1 ? ' row' : ' rows') + ' of each tier. Change how many with the 📍 button (this venue) or in Settings (the default).';
      renderPill(pill, counts && counts.seat ? counts.seat.frontrows : undefined);
    },

    /** The chosen seat filter ('firstrow' | 'frontrows' | 'all'). */
    setSeat(key) {
      choose(seatGroup, 'seat', key);
    },

    /** The chosen quality filter ('top10' | 'top25' | 'top50' | 'any'). */
    setQuality(key) {
      choose(qualityGroup, 'quality', key);
    },

    /** The chosen price filter ('cheapest' | 'sectionlow' | 'any'). */
    setPrice(key) {
      choose(priceGroup, 'price', key);
    },

    /**
     * How many tickets each pill would show: { seat: { [key]: n }, quality: { [key]: n } or null, price: { [key]: n },
     * other: { [key]: n } } (see buildSectionGroups). A pill with none is dimmed. Without counts the pills show just
     * their labels. The Quality pill is only there when `quality` is given: no ticket has a score otherwise.
     */
    setCounts(next) {
      counts = next || null;
      qualityGroup.node.hidden = !(counts && counts.quality);
      countChoices(seatGroup, 'seat', counts && counts.seat);
      countChoices(qualityGroup, 'quality', counts && counts.quality);
      countChoices(priceGroup, 'price', counts && counts.price);
      syncPills();
    },

    /** The tickets on the page, as [text on Ticketmaster, title here]: the venue panel's badge patterns say how many of them they match. */
    setSampleTexts(texts) {
      badgeEditor.setSamples(texts);
    },

    /** Filter pills after the built-in ones, for attributes and the user's own badges: [{ key, text, title? }]. */
    setCustomBadges(badges) {
      const signature = badges.map(function (b) { return b.key + '|' + b.text + '|' + (b.title || ''); }).join('\n');
      if (signature === customSignature) return;
      customSignature = signature;
      pillBar.querySelectorAll('.pill.custom').forEach(function (pill) { pill.remove(); });
      pillBar.append(...badges.map(function (b) { return otherPill(b.key, b.text, 'custom', b.title); }));
      syncPills();
    },

    /**
     * `source` says where the tickets came from: 'api' (Ticketmaster's list, read directly) or 'scroll' (the
     * page's list, scrolled); `fallback` is why it isn't 'api' when it was meant to be.
     */
    /**
     * `how` is how the tickets are being loaded: 'api' (read from Ticketmaster's list request) or 'scroll' (the page's
     * list scrolled). It is on the chip, "✓ All 311 Loaded (API)", so it is always clear which. `fallback` is why it is
     * scrolling when the API was meant to be used.
     */
    renderStatus(loadStatus, how, fallback) {
      const mode = how === 'api' ? ' (API)' : how === 'scroll' ? ' (Scroll)' : '';
      if (how === 'api') status.title = loadStatus.isComplete ? 'Read directly from Ticketmaster\'s ticket list' : 'Reading Ticketmaster\'s ticket list directly';
      else status.title = 'Loaded by scrolling Ticketmaster\'s ticket list' + (fallback ? ' (not read directly: ' + fallback + ')' : '');
      if (!loadStatus.isComplete) {
        status.dataset.state = 'loading';
        status.textContent = '⏳ Loading ' + loadStatus.loaded + (loadStatus.total ? '/' + loadStatus.total : '') + mode;
      } else {
        status.dataset.state = 'done';
        status.textContent = '✓ All ' + loadStatus.total + ' Loaded' + mode;
      }
    },

    /** A line under the counter about the venue's seat map (what its grey blocks mean), or none with null. */
    setMapNote(text) {
      mapNote.hidden = !text;
      mapNote.textContent = text || '';
    },

    renderQuantity(value) {
      qty.textContent = String(value);
      minus.disabled = value <= MIN_TICKETS;
      plus.disabled = value >= MAX_TICKETS;
    },

    /** `hidden` is how many of the tickets the filters are leaving out of the list. */
    renderCounter(ticketCount, value, hidden) {
      counter.textContent =
        'Total Loaded: ' + ticketCount + ' option' + (ticketCount === 1 ? '' : 's') + ' (' + value + ' per offer)' +
        (hidden > 0 ? ' · ' + hidden + ' hidden by filters' : '');
    },

    /**
     * Show the venue the page is for (or hide the venue controls when there is none),
     * with its saved settings. `defaultFront` is the front-rows count used when the
     * venue doesn't set its own.
     */
    setVenue(venue, config, defaultFront) {
      venueDefaultFront = defaultFront;
      venueButton.hidden = !venue;
      if (!venue) {
        closeVenuePanel();
        return;
      }
      venueButton.title = 'Venue settings: ' + (venue.name || 'this venue');
      venueName.textContent = venue.name || 'This venue';
      tiersInput.value = formatRowList(config.firstRows);
      frontInput.value = config.frontRows === null ? '' : String(config.frontRows);
      frontInput.placeholder = String(defaultFront);
      badgeEditor.setBadges(config.badges);
    },

    /** Text size: `scale` is the list text scale (see lib/size.js); the header's controls follow part of the way. */
    setScale(scale) {
      root.style.setProperty('--sv-scale', String(scale));
      root.style.setProperty('--sv-header-scale', String(headerScale(scale)));
    },

    /** Show or hide our own Best Seats / Price chips (hidden when following Ticketmaster's sort). */
    setSortVisible(visible) {
      sortBar.hidden = !visible;
      syncControlBox();
    },

    /** Compact layout for when Ticketmaster's own filter chips are on screen above the view. */
    setCompact(compact) {
      root.classList.toggle('compact', !!compact);
      syncControlBox();
    },

    /** Part of the page's own scroll (true) or scrolling inside itself (false). */
    setFlow(flow) {
      root.classList.toggle('flow', !!flow);
    },

    /** Offer a "Show Ticketmaster's list" link (inline mode only). */
    setOriginalLink(show) {
      originalRow.hidden = !show;
      syncControlBox();
    },

    renderMessage(text) {
      content.replaceChildren(h('div', { class: 'message', text }));
    },

    renderGroups(groups, sort, onTicketClick) {
      content.replaceChildren(
        ...groups.map(function (g) { return sectionNode(g, sort, expanded, { click: onTicketClick, hover: onTicketHover }, onSectionHover, mouse); })
      );
      applySectionHighlight();
    },

    /** Mark a section (or none, with null) as the one the mouse is over on the venue's map. */
    highlightSection(name) {
      highlightedSection = name || null;
      applySectionHighlight();
    },

    /** Open a section and bring it into view (scrolling its scroller, never the page). Returns whether it is in the list. */
    openSection(name) {
      const el = sectionElement(name);
      if (!el) return false;
      el.open = true;
      expanded.add(name);
      scrollIntoScroller(el);
      return true;
    },
  };
}
