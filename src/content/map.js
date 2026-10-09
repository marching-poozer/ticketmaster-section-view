// The venue's interactive seat map, linked to our list (see lib/map-link.js for how a block and a section are matched).
//
// Ticketmaster's map is an <svg data-component="svg"> whose blocks are invisible
// <path data-component="svg__section" data-section-id data-section-name data-active> (the venue's picture and labels are
// the svg's CSS background). Opened at a block it shows the seats, with a small overview map beside it that has the
// blocks too: so there can be several such svgs, and each is treated alike.
//
// We never change the map's own paths: Ticketmaster's framework owns them, and would undo it. Instead there is one
// <g data-tmsv-overlay> inside each svg, on top, with our own paths: copies of blocks' outlines (pointer-events: none, so
// the map's own hover and click go on working). Being in the svg, it follows the map's zoom and pan for free.
//
//   - Blocks that Ticketmaster shows as available but that have no ticket left after OUR filters are veiled in white.
//   - Hovering a block calls onHover(section name | null); clicking one calls onClick(section name).
//   - Hovering a section in our list (hover(name, open)) outlines its block(s) and, after a moment's pause:
//       closed section: sends the block the mouse events of a hover, so the map shows its own tooltip (view photo, price);
//       open section:   sends it a click, so the map opens that section (its seats).
//
// None of it is needed: with no map on the page (or one built differently) this does nothing.
import { blocksToDim, linkBlocks } from '../lib/map-link.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BLOCK_SELECTOR = 'path[data-component="svg__section"]';
const POLL_MS = 1000; // the map can be replaced (React) or its blocks' availability change: look again from time to time
const PREVIEW_DELAY_MS = 150; // how long the mouse rests on a closed section before the map shows its tooltip
const OPEN_DELAY_MS = 400; // ...and on an open one before the map opens it: sweeping down the list must not make the map lurch

const EMPTY_LINKS = { blockToSection: new Map(), sectionToBlocks: new Map() };

/**
 * `options.onHover(name | null)`, `options.onClick(name)`: called with a section's name (as in our list).
 * `options.document` is for tests. Returns { update, highlight, hover, setEnabled, destroy }.
 */
export function createMapLink(options) {
  const opts = options || {};
  const doc = opts.document || document;

  let enabled = true;
  const bindings = []; // one per svg with blocks: { svg, blocks, links, overlay, drawn, listeners }
  let timer = null;
  let sections = []; // [{ name, tickets }]: every section, whatever the filters leave
  let visible = new Set(); // the sections that still show tickets
  let ready = false; // the whole list has loaded (until then, "no tickets here" just means "not loaded yet")
  let highlighted = null; // a section outlined on the map
  let hovered = null; // the section whose block the mouse is over
  let intent = null; // the pending preview / open: a timer id
  let previewing = null; // { binding, path }: the block we sent a hover to, to take it back

  // --- finding the map(s) ---------------------------------------------------------

  function findSvgs() {
    return Array.from(doc.querySelectorAll('svg[data-component="svg"]')).filter(function (svg) { return svg.querySelector(BLOCK_SELECTOR); });
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

  // --- drawing -------------------------------------------------------------------

  function shape(binding, index, attributes) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', binding.blocks[index].el.getAttribute('d') || '');
    Object.keys(attributes).forEach(function (k) { path.setAttribute(k, attributes[k]); });
    path.setAttribute('pointer-events', 'none');
    return path;
  }

  function draw(binding) {
    const dim = enabled && ready ? blocksToDim(current(binding), binding.links, visible) : [];
    const outline = enabled && highlighted !== null ? binding.links.sectionToBlocks.get(highlighted) || [] : [];
    const signature = JSON.stringify([dim, outline, binding.blocks.length]);
    if (binding.overlay && binding.overlay.isConnected && signature === binding.drawn) return;
    binding.drawn = signature;

    if (!binding.overlay) {
      binding.overlay = doc.createElementNS(SVG_NS, 'g');
      binding.overlay.setAttribute('data-tmsv-overlay', '');
      binding.overlay.setAttribute('pointer-events', 'none');
    }
    if (binding.overlay.parentNode !== binding.svg || binding.overlay !== binding.svg.lastElementChild) binding.svg.append(binding.overlay); // on top of the map's own
    binding.overlay.replaceChildren.apply(binding.overlay, dim.map(function (i) {
      return shape(binding, i, { fill: '#ffffff', 'fill-opacity': '0.72' });
    }).concat(outline.map(function (i) {
      return shape(binding, i, { fill: 'none', stroke: '#ffb300', 'stroke-width': '4', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' });
    })));
  }

  function drawAll() {
    bindings.forEach(draw);
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
      if (b.svg.querySelectorAll(BLOCK_SELECTOR).length !== b.blocks.length) {
        readBlocks(b);
        relink(b);
      }
    });
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
      const box = binding.svg.getBoundingClientRect();
      const area = box.width * box.height;
      if (area > bestArea) {
        best = { binding, path: binding.blocks[indices[0]].el };
        bestArea = area;
      }
    });
    return best;
  }

  /** An event as a mouse makes it, at the middle of `path`. Marked as ours, so our own listeners let it be. */
  function send(path, type, related) {
    const box = path.getBoundingClientRect();
    const enterLeave = /enter$|leave$/.test(type);
    const init = {
      bubbles: !enterLeave, cancelable: true, composed: true,
      clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, relatedTarget: related || null,
    };
    const Pointer = typeof PointerEvent === 'function' ? PointerEvent : null;
    const event = /^pointer/.test(type) && Pointer ? new Pointer(type, init) : new MouseEvent(type, init);
    event.tmsv = true;
    path.dispatchEvent(event);
  }

  function startPreview(name) {
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

  function openBlock(name) {
    const target = targetFor(name);
    if (!target) return;
    stopPreview();
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) { send(target.path, type, null); });
  }

  function cancelIntent() {
    clearTimeout(intent);
    intent = null;
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
        if (open) openBlock(name);
        else startPreview(name);
      }, open ? OPEN_DELAY_MS : PREVIEW_DELAY_MS);
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
      stopPreview();
      clearInterval(timer);
      timer = null;
      bindings.slice().forEach(unbind);
    },
  };
}
