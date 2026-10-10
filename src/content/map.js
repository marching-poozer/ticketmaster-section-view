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
//   - On a zoomed map, seats that are on sale but whose ticket our filters leave out are greyed too (a seat we know nothing
//     about is left alone). Hovering a seat calls onSeatHover(its ticket | null); clicking one calls onSeatClick(its ticket).
//
// None of it is needed: with no map on the page (or one built differently) this does nothing.
import { LOG_PREFIX } from '../lib/constants.js';
import { blocksToDim, keyOf, linkBlocks, linkingComplete } from '../lib/map-link.js';

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

/** 'section|row|seat': what names a seat the same way on the map and in a ticket (section code, row letter, seat number). */
function seatKey(section, row, seat) {
  return keyOf(section) + '|' + String(row == null ? '' : row).trim().toUpperCase() + '|' + String(seat == null ? '' : seat).trim();
}

/** The seat key of a seat circle on the zoomed map, from the block and row groups it sits in; null if it is in neither. */
function keyOfSeatCircle(circle) {
  const block = circle.closest('g[data-component="svg__block"]');
  const row = circle.closest('g[data-row-name]');
  return block && row ? seatKey(block.getAttribute('data-section-name'), row.getAttribute('data-row-name'), circle.getAttribute('data-seat-name')) : null;
}

/**
 * `options.onHover(name | null)`, `options.onClick(name)`: called with a section's name (as in our list).
 * `options.log(message)` hears what it works out (default: the console). `options.document` is for tests.
 * `options.onSeatHover(ticket | null)`, `options.onSeatClick(ticket)`: the mouse is on a seat of the zoomed map, whose ticket is still in our list.
 * `options.onPresence(bool)` hears when the page gains or loses an interactive map.
 * Returns { update, summary, diagnose, showLabels, present, setAutoZoom, showSection, showTicket, highlight, hover, hoverTicket, setEnabled, destroy }.
 */
export function createMapLink(options) {
  const opts = options || {};
  const doc = opts.document || document;
  const log = opts.log || function (message) { console.log(LOG_PREFIX + message); };

  let enabled = true;
  let autoZoom = true; // open a section on the map by itself when the mouse rests on it (else only on request: showSection / showTicket)
  let present = false; // the page has an interactive map
  let pinned = null; // { section, row, seats }: a ticket "shown on the map", ringed until something else is shown
  let pinnedWasZoomed = false;
  const bindings = []; // one per svg with blocks: { svg, blocks, links, overlay, drawn, listeners }
  let timer = null;
  let sections = []; // [{ name, tickets }]: every section, whatever the filters leave
  let visible = new Set(); // the sections that still show tickets
  let ready = false; // the whole list has loaded (until then, "no tickets here" just means "not loaded yet")
  let allSeats = new Set(); // 'section|row|seat' of every seat any of our tickets covers, whatever the filters
  let shownSeats = new Map(); // ...and of those the filters leave: seat -> its ticket
  let hoveredSeat = null; // the ticket whose seat the mouse is on
  let highlighted = null; // a section outlined on the map
  let hovered = null; // the section whose block the mouse is over
  let seatTarget = null; // { section, row, seats }: the ticket the mouse is on in our list
  let intent = null; // the pending preview / open: a timer id
  let waiting = null; // the interval waiting for a zoomed map to zoom out
  let previewing = null; // { binding, path }: the block we sent a hover to, to take it back
  let openedByUs = null; // the section we opened the map at (until the map is zoomed out again)
  let redraws = [];
  let lastLogged = '';
  let labelsUntil = 0; // until when the blocks are labelled with what they are linked to (a diagnostic)
  let labelTimer = null;
  let matchingCount = new Map(); // section name -> how many of its tickets the filters leave

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

  /** Are seats drawn in this map? (They can be, zoomed or not: the overview of the venue keeps them too.) */
  function hasSeats(binding) {
    return binding.svg.querySelector('g.seats > *') !== null;
  }

  function area(binding) {
    const box = binding.svg.getBoundingClientRect();
    return box.width * box.height;
  }

  /**
   * Is the map zoomed in? Zoomed in, the main map keeps just the one block and a small overview with all the blocks appears
   * beside it: so the biggest map is no longer the one with the most blocks. (Seats being drawn says nothing: the map keeps
   * them in the overview too, which is how this was once got wrong, and the map never opened.) With no overview to
   * compare, a single map with one block and seats is taken to be zoomed in.
   */
  function isZoomed() {
    if (bindings.length === 0) return false;
    const biggest = bindings.reduce(function (best, b) { return area(b) > area(best) ? b : best; });
    const fullest = bindings.reduce(function (best, b) { return b.blocks.length > best.blocks.length ? b : best; });
    if (bindings.length === 1) return biggest.blocks.length <= 1 && hasSeats(biggest);
    return biggest !== fullest && biggest.blocks.length < fullest.blocks.length;
  }

  /** Is this map showing the seats of a zoomed-in map (the seats are the point, not the blocks)? */
  function showsSeats(binding) {
    return hasSeats(binding) && isZoomed() && binding === bindings.reduce(function (best, b) { return area(b) > area(best) ? b : best; });
  }

  // --- drawing -------------------------------------------------------------------

  function shape(binding, index, attributes) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', binding.blocks[index].el.getAttribute('d') || '');
    Object.keys(attributes).forEach(function (k) { path.setAttribute(k, attributes[k]); });
    path.setAttribute('pointer-events', 'none');
    return path;
  }

  /** The seat circles of the tickets the mouse is on, and the one shown on the map, in this map: [{ cx, cy, r }]. */
  function seatsToRing(binding) {
    const found = [];
    [seatTarget, pinned].forEach(function (target) {
      if (!target) return;
      const section = keyOf(target.section);
      const row = String(target.row == null ? '' : target.row).trim().toUpperCase();
      const wanted = new Set(target.seats);
      binding.svg.querySelectorAll(SEAT_BLOCK_SELECTOR).forEach(function (block) {
        if (keyOf(block.getAttribute('data-section-name')) !== section) return;
        block.querySelectorAll('g[data-row-name]').forEach(function (rowEl) {
          if (rowEl.getAttribute('data-row-name').trim().toUpperCase() !== row) return;
          rowEl.querySelectorAll('circle[data-component="svg__seat"]').forEach(function (seat) {
            const ring = { cx: seat.getAttribute('cx'), cy: seat.getAttribute('cy'), r: parseFloat(seat.getAttribute('r')) || 15 };
            if (wanted.has((seat.getAttribute('data-seat-name') || '').trim()) && !found.some(function (f) { return f.cx === ring.cx && f.cy === ring.cy; })) found.push(ring);
          });
        });
      });
    });
    return found;
  }

  /** The seats that are on sale (the map marks them with a type) and have a ticket of ours that the filters leave out: [{ cx, cy, r }]. */
  function seatsToGrey(binding) {
    const grey = [];
    binding.svg.querySelectorAll('g.seats circle[data-component="svg__seat"][type]').forEach(function (seat) {
      const key = keyOfSeatCircle(seat);
      if (key !== null && allSeats.has(key) && !shownSeats.has(key)) {
        grey.push({ cx: seat.getAttribute('cx'), cy: seat.getAttribute('cy'), r: parseFloat(seat.getAttribute('r')) || 15 });
      }
    });
    return grey;
  }

  function draw(binding) {
    const zoomed = showsSeats(binding);
    // Over the seats of a zoomed map the block outlines are not the point: the seats are.
    const dim = enabled && ready && !zoomed ? blocksToDim(current(binding), binding.links, visible, linkingComplete(binding.links, sections)) : [];
    const outline = enabled && !zoomed && highlighted !== null ? binding.links.sectionToBlocks.get(highlighted) || [] : [];
    const rings = enabled && zoomed ? seatsToRing(binding) : [];
    const greySeats = enabled && ready && zoomed ? seatsToGrey(binding) : [];
    const labelled = enabled && !zoomed && Date.now() < labelsUntil;
    const signature = JSON.stringify([dim, outline, binding.blocks.length, rings, greySeats, labelled]);
    if (binding.overlay && binding.overlay.isConnected && signature === binding.drawn) return;
    binding.drawn = signature;

    if (!binding.overlay) {
      binding.overlay = doc.createElementNS(SVG_NS, 'g');
      binding.overlay.setAttribute('data-tmsv-overlay', '');
      binding.overlay.setAttribute('pointer-events', 'none');
    }
    if (binding.overlay.parentNode !== binding.svg || binding.overlay !== binding.svg.lastElementChild) binding.svg.append(binding.overlay); // on top of the map's own
    const seatShapes = greySeats.map(function (seat) {
      const cover = doc.createElementNS(SVG_NS, 'circle');
      cover.setAttribute('cx', seat.cx);
      cover.setAttribute('cy', seat.cy);
      cover.setAttribute('r', String(seat.r));
      cover.setAttribute('fill', '#8c8f99'); // grey like the seats that are not on sale
      cover.setAttribute('fill-opacity', '0.93');
      cover.setAttribute('pointer-events', 'none');
      return cover;
    });
    const shapes = seatShapes.concat(dim.map(function (i) {
      return shape(binding, i, { fill: '#8c8f99', 'fill-opacity': '0.88' }); // grey like the map's own unavailable blocks
    }), outline.map(function (i) {
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
    binding.overlay.replaceChildren.apply(binding.overlay, shapes.concat(labelled ? labelShapes(binding, dim) : []));
  }

  /**
   * A diagnostic: every block labelled with what it is linked to, over the block: the section's name (white on green when it
   * still shows tickets, on dark grey when greyed), "?" in red for a block the map shows as available that no section of ours
   * matches, "-" for one the map itself shows as unavailable. Text needs the block's box, which only a browser can give.
   */
  function labelShapes(binding, dim) {
    const out = [];
    const viewBox = (binding.svg.getAttribute('viewBox') || '0 0 10240 7680').split(/[ ,]+/).map(Number);
    const size = Math.max(40, Math.round((viewBox[2] || 10240) / 95));
    const greyed = new Set(dim);
    binding.blocks.forEach(function (block, index) {
      let box;
      try {
        box = block.el.getBBox();
      } catch (err) {
        return;
      }
      if (!box || !(box.width > 0)) return;
      const section = binding.links.blockToSection.get(index);
      const active = block.el.getAttribute('data-active') !== 'false';
      const label = doc.createElementNS(SVG_NS, 'text');
      label.textContent = section !== undefined ? section : active ? '?' : '-';
      label.setAttribute('x', String(box.x + box.width / 2));
      label.setAttribute('y', String(box.y + box.height / 2 + size / 3));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', String(size));
      label.setAttribute('font-family', 'monospace');
      label.setAttribute('font-weight', '700');
      label.setAttribute('fill', section === undefined ? (active ? '#ff2d2d' : '#555555') : greyed.has(index) ? '#ffffff' : '#00ff66');
      label.setAttribute('stroke', section === undefined && active ? '#ffffff' : '#000000');
      label.setAttribute('stroke-width', String(Math.round(size / 9)));
      label.setAttribute('paint-order', 'stroke');
      label.setAttribute('pointer-events', 'none');
      out.push(label);
    });
    return out;
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
    const complete = linkingComplete(map.links, sections);
    const veiled = ready ? blocksToDim(blocks, map.links, visible, complete).length : 0;
    const unlinked = blocks.filter(function (b, i) { return b.active && !map.links.blockToSection.has(i); }).map(function (b) { return b.name + (b.id ? ' [' + b.id + ']' : ''); });
    const linkedSections = new Set(map.links.blockToSection.values());
    return {
      blocks: blocks.length,
      linked: map.links.blockToSection.size,
      complete, // every section of ours has its block: a block with no section then has no tickets, and is greyed
      veiled,
      unlinked,
      sectionsWithoutBlock: sections.filter(function (s) { return !linkedSections.has(s.name); }).map(function (s) {
        const described = (s.tickets.find(function (t) { return t.description; }) || {}).description; // what the API calls its tier: to see why it did not link
        return s.name + (described ? ' ("' + described + '")' : '');
      }),
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
    /** The ticket of the seat under the mouse, null for a seat with none in our list, undefined if it is not a seat of a zoomed map. */
    const seatTicketAt = function (target) {
      const circle = target && target.closest ? target.closest('circle[data-component="svg__seat"]') : null;
      if (!circle || !showsSeats(binding)) return undefined;
      return shownSeats.get(keyOfSeatCircle(circle)) || null;
    };
    const onOver = function (e) {
      if (e.tmsv) return; // our own, sent to make the map show a block's tooltip
      const ticket = seatTicketAt(e.target);
      if (ticket !== undefined) {
        if (ticket !== hoveredSeat) {
          hoveredSeat = ticket;
          if (opts.onSeatHover) opts.onSeatHover(ticket);
        }
        return;
      }
      const name = sectionAt(binding, e.target);
      if (name === hovered) return;
      hovered = name;
      if (opts.onHover) opts.onHover(name);
    };
    const onOut = function (e) {
      if (e.tmsv) return;
      if (hoveredSeat !== null && seatTicketAt(e.relatedTarget) === undefined) {
        hoveredSeat = null; // off the seat (onto another seat, its own mouseover says so)
        if (opts.onSeatHover) opts.onSeatHover(null);
      }
      if (blockIndexOf(binding, e.relatedTarget) >= 0) return; // straight on to another block: its mouseover says so
      if (hovered === null) return;
      hovered = null;
      if (opts.onHover) opts.onHover(null);
    };
    const onClickBlock = function (e) {
      if (e.tmsv) return;
      const seat = seatTicketAt(e.target);
      if (seat !== undefined) {
        if (seat !== null && opts.onSeatClick) opts.onSeatClick(seat); // the map's own handling of the click goes on
        return;
      }
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

  /**
   * Look at the page again: which maps there are and what blocks they hold. Done once a second, and before anything is done
   * to the map: the map changes as it zooms, and acting on what it was a moment ago (a block that has gone, a zoom that
   * has ended) does nothing at all.
   */
  function refresh() {
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
  }

  function ensure() {
    refresh();
    const zoomed = isZoomed();
    if (!zoomed) openedByUs = null; // zoomed out again: the next open is a fresh one
    if (zoomed) pinnedWasZoomed = true;
    else if (pinnedWasZoomed) { pinned = null; pinnedWasZoomed = false; } // the map was zoomed out (reset): what was shown on it goes
    drawAll();
    if (present !== (bindings.length > 0)) {
      present = bindings.length > 0;
      if (opts.onPresence) opts.onPresence(present);
    }
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
    refresh();
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
    refresh();
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
    refresh();
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
     * after the filters, `matching` = the tickets the filters leave, `ready` = the whole list has loaded.
     */
    update(state) {
      sections = state.sections || [];
      visible = state.visible || new Set();
      ready = state.ready === true;
      // Which seat belongs to which ticket (a ticket covers the seats seatFrom..seatTo of its row), with and without the filters.
      allSeats = new Set();
      sections.forEach(function (s) { s.tickets.forEach(function (t) { if (t.rowName) seatsOf(t).forEach(function (n) { allSeats.add(seatKey(t.section, t.rowName, n)); }); }); });
      shownSeats = new Map();
      matchingCount = new Map();
      (state.matching || []).forEach(function (t) { matchingCount.set(t.section, (matchingCount.get(t.section) || 0) + 1); });
      (state.matching || []).forEach(function (t) { if (t.rowName) seatsOf(t).forEach(function (n) { shownSeats.set(seatKey(t.section, t.rowName, n), t); }); });
      bindings.forEach(relink);
      drawAll();
      report();
    },

    /** What it has linked: see summary() above. */
    summary,

    /**
     * Everything about how the map and the list were matched, as plain data: for a bug report. Per map: its size, how many blocks
     * and seats; per block: its name, id, whether the map shows it as available, the section of ours it is linked to, and what
     * becomes of it (shown / greyed / unlinked / unavailable); per section of ours: its tickets, those the filters leave, the
     * blocks it is linked to and what the API says about it (its tier, the block id its picture names).
     */
    diagnose() {
      refresh();
      const main = overview();
      const complete = main ? linkingComplete(main.links, sections) : false;
      const shownOf = function (name) { return visible.has(name); };
      const blocks = main ? current(main).map(function (b, i) {
        const section = main.links.blockToSection.get(i);
        let state;
        if (!b.active) state = 'unavailable (the map greys it)';
        else if (!ready) state = 'list not complete';
        else if (section === undefined) state = complete ? 'greyed (no section of ours: none has tickets there)' : 'LEFT ALONE (no section of ours, and some section has no block)';
        else state = shownOf(section) ? 'shown (the section has tickets after the filters)' : 'greyed (the section has none after the filters)';
        return { name: b.name, id: b.id, available: b.active, section: section === undefined ? null : section, state };
      }) : [];
      return {
        enabled,
        autoZoom,
        ready,
        zoomedIn: isZoomed(),
        linkingComplete: complete,
        maps: bindings.map(function (b) {
          const box = b.svg.getBoundingClientRect();
          return { size: Math.round(box.width) + 'x' + Math.round(box.height), viewBox: b.svg.getAttribute('viewBox'), blocks: b.blocks.length, seatsDrawn: b.svg.querySelectorAll('g.seats circle').length };
        }),
        seats: { ofOurTickets: allSeats.size, ofTicketsShown: shownSeats.size },
        blocks,
        sections: sections.map(function (s) {
          const linked = main ? (main.links.sectionToBlocks.get(s.name) || []).map(function (i) { return main.blocks[i].name; }) : [];
          const first = s.tickets[0] || {};
          return { name: s.name, tickets: s.tickets.length, shown: matchingCount.get(s.name) || 0, blocks: linked, description: first.description || '', areaName: first.areaName || '', blockIdOfPicture: first.segmentId || '' };
        }),
      };
    },

    /** Label every block of the overview with what it is linked to, for `ms` (see labelShapes). */
    showLabels(ms) {
      labelsUntil = Date.now() + ms;
      drawAll();
      clearTimeout(labelTimer);
      labelTimer = setTimeout(drawAll, ms + 50);
    },

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
        if (open && autoZoom) openBlock(name);
        else startPreview(name);
      }, open && autoZoom ? OPEN_DELAY_MS : PREVIEW_DELAY_MS);
    },

    /** Whether the page has an interactive map right now. */
    present() {
      return bindings.length > 0;
    },

    /** Zoom the map by itself when the mouse rests on an open section (the default), or only on request. */
    setAutoZoom(on) {
      autoZoom = on !== false;
      if (!autoZoom) cancelIntent();
    },

    /** Open the map at a section now (the "Show on map" button of a section). */
    showSection(name) {
      cancelIntent();
      stopPreview();
      pinned = null;
      pinnedWasZoomed = false;
      drawAll();
      openBlock(name);
    },

    /** Open the map at a ticket's section now and ring its seats until something else is shown (the ticket's "Show on map" button). */
    showTicket(ticket) {
      cancelIntent();
      stopPreview();
      pinned = { section: ticket.section, row: ticket.rowName, seats: seatsOf(ticket) };
      pinnedWasZoomed = false;
      openBlock(ticket.section);
      drawAll();
      scheduleRedraws();
    },

    /** The mouse is over a ticket in our list (or has left it, with null): ring its seats on the zoomed map. */
    hoverTicket(ticket) {
      refresh();
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
      clearTimeout(labelTimer);
      redraws.forEach(clearTimeout);
      redraws = [];
      stopPreview();
      clearInterval(timer);
      timer = null;
      bindings.slice().forEach(unbind);
    },
  };
}
