// The venue's interactive seat map, linked to our list (see lib/map-link.js for how a block and a section are matched).
//
// Ticketmaster's map is an <svg data-component="svg"> whose blocks are invisible
// <path data-component="svg__section" data-section-id data-section-name data-active> (the venue's picture and labels are
// the svg's CSS background). Zoomed in, the main svg holds the SEATS instead of the blocks:
//   <g class="seats"><g data-component="svg__block" data-section-name="EASTL8"><g data-row-name="J">
//     <circle data-component="svg__seat" data-seat-name="141" cx cy r type="primary"?>
// (a `type` on a seat means a ticket is on sale there) and a small overview map, with all the blocks, appears in a corner.
// So there can be several such svgs, and each is treated alike.
//
// We never change the map's own elements: Ticketmaster's framework owns them, and would undo it. Instead there is one
// <g data-tmsv-overlay> inside each svg, on top, with our own shapes (pointer-events: none, so the map's own hover and click
// go on working). Being in the svg, it follows the map's zoom and pan for free.
//
//   - Blocks that Ticketmaster shows as available but that have no ticket left after OUR filters are greyed (as its own
//     unavailable blocks are), on the overview and the whole map alike, never over the seats of a zoomed map.
//   - Hovering a block calls onHover(section name | null); clicking one calls onClick(section name).
//   - Hovering a section in our list (hover(name, open)) outlines its block(s) and, after a moment's pause:
//       closed section: sends the block the mouse events of a hover, so the map shows its own tooltip (view photo, price);
//       open section:   sends it a click, so the map opens that section. If the map is zoomed already it is reset first
//                       (Ticketmaster's own reset button is pressed), then the block clicked: it goes to the new place.
//   - Hovering a ticket in our list (hoverTicket(ticket)) rings its seats on the zoomed map.
//
// None of it is needed: with no map on the page (or one built differently) this does nothing.
import { LOG_PREFIX } from '../lib/constants.js';
import { blocksToDim, keyOf, linkBlocks } from '../lib/map-link.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BLOCK_SELECTOR = 'path[data-component="svg__section"]';
const SEAT_BLOCK_SELECTOR = 'g.seats g[data-component="svg__block"]';
const POLL_MS = 1000; // the map can be replaced (React) or its blocks' availability change: look again from time to time
const PREVIEW_DELAY_MS = 150; // how long the mouse rests on a closed section before the map shows its tooltip
const OPEN_DELAY_MS = 400; // ...and on an open one before the map opens it: sweeping down the list must not make the map lurch
const RESET_WAIT_MS = 2500; // how long to wait for the map to zoom out after its reset button was pressed
const REDRAW_AFTER_MS = [250, 600, 1200]; // the map zooms with an animation: look for the seats again as it settles
const MAX_LISTED = 12;

const EMPTY_LINKS = { blockToSection: new Map(), sectionToBlocks: new Map() };
// How the map's own reset button names itself, if it does (the zoom controls: reset, +, -).
const RESET_LABEL = /\breset\b|re-?cent(?:er|re)|zoom to fit|fit (?:to )?(?:screen|map|view)|overview|full (?:map|view)|show (?:the )?(?:whole|full|all)/i;
const ZOOM_IN_LABEL = /zoom ?in|^\+$/i;
const ZOOM_OUT_LABEL = /zoom ?out|^[-−–]$/i;

/** The seat numbers a ticket covers: ["141", "142"] for seats 141-142. */
export function seatsOf(ticket) {
  const from = String(ticket.seatFrom == null ? '' : ticket.seatFrom).trim();
  const to = String(ticket.seatTo == null ? '' : ticket.seatTo).trim();
  if (from && to && /^\d+$/.test(from) && /^\d+$/.test(to)) {
    const a = parseInt(from, 10);
    const b = parseInt(to, 10);
    if (b >= a && b - a < 20) return Array.from({ length: b - a + 1 }, function (_, i) { return String(a + i); });
  }
  return Array.from(new Set([from, to].filter(Boolean)));
}

/**
 * `options.onHover(name | null)`, `options.onClick(name)`: called with a section's name (as in our list).
 * `options.log(message)` hears what it works out (default: the console). `options.document` is for tests.
 * Returns { update, summary, highlight, hover, hoverTicket, setEnabled, destroy }.
 */
export function createMapLink(options) {
  const opts = options || {};
  const doc = opts.document || document;
  const log = opts.log || function (message) { console.log(LOG_PREFIX + message); };

  let enabled = true;
  const bindings = []; // one per svg with blocks: { svg, blocks, links, overlay, drawn, listeners }
  let timer = null;
  let sections = []; // [{ name, tickets }]: every section, whatever the filters leave
  let visible = new Set(); // the sections that still show tickets
  let ready = false; // the whole list has loaded (until then, "no tickets here" just means "not loaded yet")
  let highlighted = null; // a section outlined on the map
  let hovered = null; // the section whose block the mouse is over
  let seatTarget = null; // { section, row, seats }: the ticket the mouse is on in our list
  let intent = null; // the pending preview / open: a timer id
  let waiting = null; // the interval waiting for a zoomed map to zoom out
  let previewing = null; // { binding, path }: the block we sent a hover to, to take it back
  let openedByUs = null; // the section we opened the map at (until the map is zoomed out again)
  let redraws = [];
  let lastLogged = '';

  // --- finding the map(s) ---------------------------------------------------------

  function findSvgs() {
    return Array.from(doc.querySelectorAll('svg[data-component="svg"]')).filter(function (svg) { return svg.querySelector(BLOCK_SELECTOR) || svg.querySelector(SEAT_BLOCK_SELECTOR); });
  }

  function readBlocks(binding) {
    binding.blocks = Array.from(binding.svg.querySelectorAll(BLOCK_SELECTOR)).map(function (el) {
      return { el, id: el.getAttribute('data-section-id') || '', name: el.getAttribute('data-section-name') || '' };
    });
  }

  function relink(binding) {
    binding.links = binding.blocks.length ? linkBlocks(binding.blocks, sections) : EMPTY_LINKS;
  }

  /** The blocks with their availability as the map shows it right now. */
  function current(binding) {
    return binding.blocks.map(function (b) { return { id: b.id, name: b.name, active: b.el.getAttribute('data-active') !== 'false' }; });
  }

  function blockIndexOf(binding, target) {
    const el = target && target.closest ? target.closest(BLOCK_SELECTOR) : null;
    return el ? binding.blocks.findIndex(function (b) { return b.el === el; }) : -1;
  }

  /** Is this map showing seats (zoomed in), rather than blocks? */
  function hasSeats(binding) {
    return binding.svg.querySelector('g.seats > *') !== null;
  }

  function isZoomed() {
    return bindings.some(hasSeats);
  }

  function area(binding) {
    const box = binding.svg.getBoundingClientRect();
    return box.width * box.height;
  }

  // --- drawing -------------------------------------------------------------------

  function shape(binding, index, attributes) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', binding.blocks[index].el.getAttribute('d') || '');
    Object.keys(attributes).forEach(function (k) { path.setAttribute(k, attributes[k]); });
    path.setAttribute('pointer-events', 'none');
    return path;
  }

  /** The seat circles of the ticket the mouse is on, in this map: [{ cx, cy, r }]. */
  function seatsToRing(binding) {
    if (!seatTarget) return [];
    const section = keyOf(seatTarget.section);
    const row = String(seatTarget.row == null ? '' : seatTarget.row).trim().toUpperCase();
    const wanted = new Set(seatTarget.seats);
    const found = [];
    binding.svg.querySelectorAll(SEAT_BLOCK_SELECTOR).forEach(function (block) {
      if (keyOf(block.getAttribute('data-section-name')) !== section) return;
      block.querySelectorAll('g[data-row-name]').forEach(function (rowEl) {
        if (rowEl.getAttribute('data-row-name').trim().toUpperCase() !== row) return;
        rowEl.querySelectorAll('circle[data-component="svg__seat"]').forEach(function (seat) {
          if (wanted.has((seat.getAttribute('data-seat-name') || '').trim())) {
            found.push({ cx: seat.getAttribute('cx'), cy: seat.getAttribute('cy'), r: parseFloat(seat.getAttribute('r')) || 15 });
          }
        });
      });
    });
    return found;
  }

  function draw(binding) {
    const zoomed = hasSeats(binding);
    // Over the seats of a zoomed map the block outlines are not the point: the seats are.
    const dim = enabled && ready && !zoomed ? blocksToDim(current(binding), binding.links, visible) : [];
    const outline = enabled && !zoomed && highlighted !== null ? binding.links.sectionToBlocks.get(highlighted) || [] : [];
    const rings = enabled && zoomed ? seatsToRing(binding) : [];
    const signature = JSON.stringify([dim, outline, binding.blocks.length, rings]);
    if (binding.overlay && binding.overlay.isConnected && signature === binding.drawn) return;
    binding.drawn = signature;

    if (!binding.overlay) {
      binding.overlay = doc.createElementNS(SVG_NS, 'g');
      binding.overlay.setAttribute('data-tmsv-overlay', '');
      binding.overlay.setAttribute('pointer-events', 'none');
    }
    if (binding.overlay.parentNode !== binding.svg || binding.overlay !== binding.svg.lastElementChild) binding.svg.append(binding.overlay); // on top of the map's own
    const shapes = dim.map(function (i) {
      return shape(binding, i, { fill: '#8c8f99', 'fill-opacity': '0.88' }); // grey like the map's own unavailable blocks
    }).concat(outline.map(function (i) {
      return shape(binding, i, { fill: 'none', stroke: '#ffb300', 'stroke-width': '4', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' });
    }), rings.map(function (seat) {
      const ring = doc.createElementNS(SVG_NS, 'circle');
      ring.setAttribute('cx', seat.cx);
      ring.setAttribute('cy', seat.cy);
      ring.setAttribute('r', String(seat.r * 1.9));
      ring.setAttribute('fill', '#ffb300');
      ring.setAttribute('fill-opacity', '0.35');
      ring.setAttribute('stroke', '#ffb300');
      ring.setAttribute('stroke-width', '4');
      ring.setAttribute('vector-effect', 'non-scaling-stroke');
      ring.setAttribute('pointer-events', 'none');
      return ring;
    }));
    binding.overlay.replaceChildren.apply(binding.overlay, shapes);
  }

  function drawAll() {
    bindings.forEach(draw);
  }

  /** The map zooms with an animation, and draws its seats as it goes: look again as it settles. */
  function scheduleRedraws() {
    redraws.forEach(clearTimeout);
    redraws = REDRAW_AFTER_MS.map(function (ms) { return setTimeout(drawAll, ms); });
  }

  // --- what we work out, for the console and the note in our header ---------------

  /** The overview: the map with the most blocks. */
  function overview() {
    return bindings.reduce(function (best, b) { return !best || b.blocks.length > best.blocks.length ? b : best; }, null);
  }

  /**
   * { blocks, linked, veiled, unlinked: [names of blocks the map shows as available that no section of ours matches],
   *   sectionsWithoutBlock: [names] } for the overview map; null when the page has none.
   */
  function summary() {
    const map = overview();
    if (!map || !map.blocks.length) return null;
    const blocks = current(map);
    const veiled = ready ? blocksToDim(blocks, map.links, visible).length : 0;
    const unlinked = blocks.filter(function (b, i) { return b.active && !map.links.blockToSection.has(i); }).map(function (b) { return b.name + (b.id ? ' [' + b.id + ']' : ''); });
    const linkedSections = new Set(map.links.blockToSection.values());
    return {
      blocks: blocks.length,
      linked: map.links.blockToSection.size,
      veiled,
      unlinked,
      sectionsWithoutBlock: sections.filter(function (s) { return !linkedSections.has(s.name); }).map(function (s) { return s.name; }),
    };
  }

  /** Say what was linked, once for each different outcome: if a block is not as it should be, this says why. */
  function report() {
    const s = summary();
    if (!s || !ready) return;
    const list = function (items) { return items.length ? items.slice(0, MAX_LISTED).join(', ') + (items.length > MAX_LISTED ? ' (+' + (items.length - MAX_LISTED) + ' more)' : '') : 'none'; };
    const text = 'Seat map: ' + s.blocks + ' blocks, ' + s.linked + ' linked to a section of ours, ' + s.veiled + ' greyed. ' +
      'Available on the map but linked to no section of ours: ' + list(s.unlinked) + '. Sections of ours with no block: ' + list(s.sectionsWithoutBlock) + '.';
    if (text === lastLogged) return;
    lastLogged = text;
    log(text);
  }

  // --- the map's own events ------------------------------------------------------

  function sectionAt(binding, target) {
    const index = blockIndexOf(binding, target);
    return index < 0 ? null : binding.links.blockToSection.get(index) || null;
  }

  function addListeners(binding) {
    const onOver = function (e) {
      if (e.tmsv) return; // our own, sent to make the map show a block's tooltip
      const name = sectionAt(binding, e.target);
      if (name === hovered) return;
      hovered = name;
      if (opts.onHover) opts.onHover(name);
    };
    const onOut = function (e) {
      if (e.tmsv) return;
      if (blockIndexOf(binding, e.relatedTarget) >= 0) return; // straight on to another block: its mouseover says so
      if (hovered === null) return;
      hovered = null;
      if (opts.onHover) opts.onHover(null);
    };
    const onClickBlock = function (e) {
      if (e.tmsv) return;
      const name = sectionAt(binding, e.target);
      if (name !== null && opts.onClick) opts.onClick(name);
    };
    binding.listeners = { mouseover: onOver, mouseout: onOut, click: onClickBlock };
    Object.keys(binding.listeners).forEach(function (type) { binding.svg.addEventListener(type, binding.listeners[type], true); });
  }

  function unbind(binding) {
    Object.keys(binding.listeners).forEach(function (type) { binding.svg.removeEventListener(type, binding.listeners[type], true); });
    if (binding.overlay) binding.overlay.remove();
    if (previewing && previewing.binding === binding) previewing = null;
    bindings.splice(bindings.indexOf(binding), 1);
  }

  function bind(svg) {
    const binding = { svg, blocks: [], links: EMPTY_LINKS, overlay: null, drawn: '', listeners: null };
    readBlocks(binding);
    relink(binding);
    addListeners(binding);
    bindings.push(binding);
  }

  function ensure() {
    const found = enabled ? findSvgs() : [];
    bindings.slice().forEach(function (b) { if (found.indexOf(b.svg) < 0) unbind(b); });
    found.forEach(function (svg) { if (!bindings.some(function (b) { return b.svg === svg; })) bind(svg); });
    bindings.forEach(function (b) {
      // The map re-renders its blocks (zooming in and out): read them again when they are not the ones we have.
      if (b.svg.querySelectorAll(BLOCK_SELECTOR).length !== b.blocks.length || b.blocks.some(function (x) { return !x.el.isConnected; })) {
        readBlocks(b);
        relink(b);
      }
    });
    if (!isZoomed()) openedByUs = null; // zoomed out again: the next open is a fresh one
    drawAll();
  }

  function startPolling() {
    if (!timer) timer = setInterval(ensure, POLL_MS);
  }

  // --- acting on the map: what a mouse would do ------------------------------------

  /** The block of a section to act on: in the biggest map that has one (the main map, not the overview). */
  function targetFor(name) {
    let best = null;
    let bestArea = -1;
    bindings.forEach(function (binding) {
      const indices = binding.links.sectionToBlocks.get(name);
      if (!indices || !indices.length) return;
      const size = area(binding);
      if (size > bestArea) {
        best = { binding, path: binding.blocks[indices[0]].el };
        bestArea = size;
      }
    });
    return best;
  }

  /** An event as a mouse makes it, at the middle of `el`. Marked as ours, so our own listeners let it be. */
  function send(el, type, related) {
    const box = el.getBoundingClientRect();
    const enterLeave = /enter$|leave$/.test(type);
    const init = {
      bubbles: !enterLeave, cancelable: true, composed: true,
      clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, relatedTarget: related || null,
    };
    const Pointer = typeof PointerEvent === 'function' ? PointerEvent : null;
    const event = /^pointer/.test(type) && Pointer ? new Pointer(type, init) : new MouseEvent(type, init);
    event.tmsv = true;
    el.dispatchEvent(event);
  }

  function press(el) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) { send(el, type, null); });
  }

  function startPreview(name) {
    if (isZoomed()) return; // a block's tooltip belongs to the overview; the zoomed map shows seats
    const target = targetFor(name);
    if (!target) return;
    stopPreview();
    ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'].forEach(function (type) { send(target.path, type, null); });
    previewing = target;
  }

  function stopPreview() {
    if (!previewing) return;
    const { binding, path } = previewing;
    previewing = null;
    ['pointerout', 'pointerleave', 'mouseout', 'mouseleave'].forEach(function (type) { send(path, type, binding.svg); });
  }

  function clickBlock(name) {
    const target = targetFor(name);
    if (!target) return;
    stopPreview();
    press(target.path);
    openedByUs = name;
    scheduleRedraws();
  }

  /** The map's own "reset" control: by what it is called, else the one beside its zoom in and out buttons. */
  function findResetControl() {
    const main = bindings.reduce(function (best, b) { return !best || area(b) > area(best) ? b : best; }, null);
    if (!main) return null;
    const labelOf = function (b) { return (b.getAttribute('aria-label') || b.getAttribute('title') || b.getAttribute('data-testid') || b.textContent || '').trim(); };
    let scope = main.svg.parentElement;
    for (let i = 0; i < 6 && scope; i++, scope = scope.parentElement) {
      const buttons = Array.from(scope.querySelectorAll('button'));
      const named = buttons.find(function (b) { return RESET_LABEL.test(labelOf(b)); });
      if (named) return named;
      const zoomIn = buttons.find(function (b) { return ZOOM_IN_LABEL.test(labelOf(b)); });
      if (zoomIn) {
        const others = Array.from(zoomIn.parentElement.querySelectorAll('button')).filter(function (b) { return b !== zoomIn && !ZOOM_OUT_LABEL.test(labelOf(b)); });
        if (others.length) return others[0];
      }
    }
    return null;
  }

  function describeControls() {
    const main = bindings.reduce(function (best, b) { return !best || area(b) > area(best) ? b : best; }, null);
    const scope = main && main.svg.parentElement && main.svg.parentElement.parentElement;
    return scope ? Array.from(scope.querySelectorAll('button')).slice(0, 8).map(function (b) { return JSON.stringify((b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim().slice(0, 40)); }).join(', ') : '';
  }

  function cancelWaiting() {
    clearInterval(waiting);
    waiting = null;
  }

  /** Open the map at a section. If it is zoomed in already, zoom it out first, then go to the new place. */
  function openBlock(name) {
    if (!isZoomed()) {
      clickBlock(name);
      return;
    }
    if (openedByUs === name) return; // the map is showing it already
    const reset = findResetControl();
    if (!reset) {
      log('The seat map is zoomed in and no reset button was found among: ' + (describeControls() || 'no buttons near it') + '. Trying the overview map instead.');
      clickBlock(name);
      return;
    }
    log('The seat map is zoomed in: pressing its reset button, then opening ' + name + '.');
    press(reset);
    openedByUs = null;
    const started = Date.now();
    cancelWaiting();
    waiting = setInterval(function () {
      ensure(); // the map has re-drawn: find its blocks again
      if (!isZoomed() && targetFor(name)) {
        cancelWaiting();
        clickBlock(name);
      } else if (Date.now() - started > RESET_WAIT_MS) {
        cancelWaiting();
        log('The seat map did not zoom out after its reset button was pressed (' + describeControls() + ').');
      }
    }, 100);
  }

  function cancelIntent() {
    clearTimeout(intent);
    intent = null;
    cancelWaiting();
  }

  startPolling();
  ensure();

  return {
    /**
     * Tell it about our list: `sections` = [{ name, tickets }] (all), `visible` = Set of the names that still show tickets
     * after the filters, `ready` = the whole list has loaded.
     */
    update(state) {
      sections = state.sections || [];
      visible = state.visible || new Set();
      ready = state.ready === true;
      bindings.forEach(relink);
      drawAll();
      report();
    },

    /** What it has linked: see summary() above. */
    summary,

    /** Outline the block(s) of a section (or none, with null). */
    highlight(name) {
      highlighted = name || null;
      drawAll();
    },

    /**
     * The mouse is over a section in our list (`name`), which is open or not; or has left it (null). Outlines its block, and
     * after a pause makes the map show that block's tooltip (a closed section) or open it (an open one).
     */
    hover(name, open) {
      cancelIntent();
      highlighted = name || null;
      drawAll();
      if (!enabled) return;
      if (name === null || name === undefined) {
        stopPreview();
        return;
      }
      intent = setTimeout(function () {
        intent = null;
        if (open) openBlock(name);
        else startPreview(name);
      }, open ? OPEN_DELAY_MS : PREVIEW_DELAY_MS);
    },

    /** The mouse is over a ticket in our list (or has left it, with null): ring its seats on the zoomed map. */
    hoverTicket(ticket) {
      seatTarget = ticket ? { section: ticket.section, row: ticket.rowName, seats: seatsOf(ticket) } : null;
      drawAll();
      if (seatTarget) scheduleRedraws();
    },

    setEnabled(next) {
      enabled = next !== false;
      if (enabled) startPolling();
      else {
        cancelIntent();
        stopPreview();
      }
      ensure();
    },

    destroy() {
      cancelIntent();
      redraws.forEach(clearTimeout);
      redraws = [];
      stopPreview();
      clearInterval(timer);
      timer = null;
      bindings.slice().forEach(unbind);
    },
  };
}
