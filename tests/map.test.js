// The map adapter, on a jsdom page with an <svg> built like Ticketmaster's (the real block names and ids of The O2 Belfast).
import fs from 'node:fs';
import path from 'node:path';
import { createMapLink, seatsOf } from '../src/content/map.js';
import { picksToTickets } from '../src/lib/quickpicks.js';
import { sectionsOf } from '../src/lib/map-link.js';

const o2 = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/o2-map-blocks.json'), 'utf8'));
const real = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/quickpicks-resale-standing.json'), 'utf8'));
const sections = sectionsOf(picksToTickets(real, { currency: '€' })); // NTHU3, STANDING-OVER 14'S ONLY, WESTU1, WESTU7

let link;
let host;

function buildMap() {
  document.body.innerHTML = '<div id="map-host"></div>';
  host = document.getElementById('map-host');
  host.innerHTML =
    '<svg data-component="svg" viewBox="0 0 10240 7680" aria-hidden="true"><g class="seats"></g><g class="polygons">' +
    o2.blocks.map((b, i) => `<path data-component="svg__section" data-section-id="${b.id}" data-section-name="${b.name}" data-active="${b.active}" d="M${i} 0L${i} 10z" class="c${b.active ? 'a' : 'b'}"></path>`).join('') +
    '</g></svg>';
  return host.querySelector('svg');
}

const block = (name, id) => host.querySelector(`path[data-section-name="${name}"]${id ? `[data-section-id="${id}"]` : ''}`);
const overlay = () => host.querySelector('svg > g[data-tmsv-overlay]');
const dimmed = () => Array.from(overlay().querySelectorAll('path[fill-opacity]')).map((p) => p.getAttribute('d'));
const outlined = () => Array.from(overlay().querySelectorAll('path[stroke]')).map((p) => p.getAttribute('d'));
const dOf = (name, id) => block(name, id).getAttribute('d');

/** Everything loaded, and only these sections left by the filters. */
const show = (...names) => link.update({ sections, visible: new Set(names), ready: true });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  if (link) link.destroy();
  link = null;
});

describe('with no map on the page', () => {
  it('does nothing, and picks the map up when it appears', () => {
    document.body.innerHTML = '<p>no map</p>';
    link = createMapLink();
    show('NTHU3');
    expect(document.querySelector('[data-tmsv-overlay]')).toBeNull();

    buildMap();
    vi.advanceTimersByTime(1100);
    expect(overlay()).not.toBeNull();
    expect(dimmed().length).toBeGreaterThan(0);
  });

  it('ignores an svg that is not the map (no blocks in it)', () => {
    document.body.innerHTML = '<svg data-component="svg"><path d="M0 0"/></svg><svg><path data-component="svg__section" data-section-name="X" d="M0 0"/></svg>';
    link = createMapLink();
    show('NTHU3');
    vi.advanceTimersByTime(1100);
    expect(document.querySelector('[data-tmsv-overlay]')).toBeNull();
  });
});

describe('dimming the blocks our filters leave empty', () => {
  it('veils the blocks the map shows as available whose section has no ticket left, and nothing else', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3', 'WESTU1', 'WESTU7'); // the standing section is filtered out
    expect(dimmed()).toEqual([dOf('GROUND FLOOR STANDING', 's_112')]);
  });

  it('leaves the blocks it cannot link alone: not knowing is not "empty"', () => {
    buildMap();
    link = createMapLink();
    show(); // nothing visible at all
    const veiled = dimmed();
    expect(veiled).toContain(dOf('NORTH UPPER 3'));
    expect(veiled).toContain(dOf('GROUND FLOOR STANDING', 's_112'));
    expect(veiled).not.toContain(dOf('NORTH UPPER 2')); // no ticket anywhere in it: no section to link
    expect(veiled).not.toContain(dOf('SWEST'));
    expect(veiled).toHaveLength(4); // only the four sections we have
  });

  it('leaves alone what the map already shows as unavailable', () => {
    buildMap();
    block('WEST UPPER 1').setAttribute('data-active', 'false');
    link = createMapLink();
    show();
    expect(dimmed()).not.toContain(dOf('WEST UPPER 1'));
  });

  it('dims nothing until the whole list has loaded (an empty block then only means "not here yet")', () => {
    buildMap();
    link = createMapLink();
    link.update({ sections, visible: new Set(['NTHU3']), ready: false });
    expect(dimmed()).toEqual([]);
    link.update({ sections, visible: new Set(['NTHU3']), ready: true });
    expect(dimmed().length).toBe(3);
  });

  it('un-dims when the filters change back', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3');
    expect(dimmed()).toHaveLength(3);
    show('NTHU3', 'WESTU1', 'WESTU7', "STANDING-OVER 14'S ONLY");
    expect(dimmed()).toEqual([]);
  });

  it('follows the map\'s own availability as it changes', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3', 'WESTU7', "STANDING-OVER 14'S ONLY"); // WESTU1 filtered out
    expect(dimmed()).toEqual([dOf('WEST UPPER 1')]);
    block('WEST UPPER 1').setAttribute('data-active', 'false'); // the quantity changed: the map greys it itself
    vi.advanceTimersByTime(1100);
    expect(dimmed()).toEqual([]);
  });

  it('takes the veil off when switched off, and puts it back when switched on', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3');
    link.setEnabled(false);
    expect(document.querySelector('[data-tmsv-overlay]')).toBeNull();
    link.setEnabled(true);
    expect(dimmed().length).toBe(3);
  });
});

describe('the overlay', () => {
  it('is one group inside the map\'s svg (so it zooms with it), last, that never takes the mouse', () => {
    const svg = buildMap();
    link = createMapLink();
    show('NTHU3');
    expect(overlay().parentNode).toBe(svg);
    expect(svg.lastElementChild).toBe(overlay());
    expect(overlay().getAttribute('pointer-events')).toBe('none');
    overlay().querySelectorAll('path').forEach((p) => expect(p.getAttribute('pointer-events')).toBe('none'));
    expect(document.querySelectorAll('[data-tmsv-overlay]')).toHaveLength(1);
  });

  it('never changes the map\'s own blocks', () => {
    buildMap();
    const before = host.querySelector('g.polygons').outerHTML;
    link = createMapLink();
    show('NTHU3');
    link.highlight('NTHU3');
    expect(host.querySelector('g.polygons').outerHTML).toBe(before);
  });

  it('is not rebuilt when nothing it shows has changed', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3');
    const first = overlay().firstElementChild;
    show('NTHU3');
    vi.advanceTimersByTime(3500);
    expect(overlay().firstElementChild).toBe(first);
  });

  it('is put back if the page removes it, and moved to the end if the page adds to the svg', () => {
    const svg = buildMap();
    link = createMapLink();
    show('NTHU3');
    overlay().remove();
    vi.advanceTimersByTime(1100);
    expect(overlay()).not.toBeNull();

    const later = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.append(later);
    link.highlight('NTHU3'); // anything that redraws
    vi.advanceTimersByTime(1100);
    expect(svg.lastElementChild).toBe(overlay());
  });

  it('follows the map when the page replaces it', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3');
    const old = overlay();
    buildMap(); // a fresh svg, as after a re-render
    vi.advanceTimersByTime(1100);
    expect(old.isConnected).toBe(false);
    expect(overlay()).not.toBeNull();
    expect(dimmed().length).toBe(3);
  });
});

describe('outlining the block of a section hovered in our list', () => {
  it('outlines the linked block, and only while it is hovered', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3', 'WESTU1', 'WESTU7', "STANDING-OVER 14'S ONLY");
    link.highlight('NTHU3');
    expect(outlined()).toEqual([dOf('NORTH UPPER 3')]);
    link.highlight(null);
    expect(outlined()).toEqual([]);
  });

  it('says what the line is made of: a screen-pixel stroke, so it is as thin when zoomed in', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3');
    link.highlight('NTHU3');
    const line = overlay().querySelector('path[stroke]');
    expect(line.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(line.getAttribute('fill')).toBe('none');
  });

  it('outlines every block of a section that has several', () => {
    buildMap();
    link = createMapLink();
    link.update({ sections: [{ name: 'ACCESSIBLE', tickets: [] }], visible: new Set(['ACCESSIBLE']), ready: true });
    link.highlight('ACCESSIBLE');
    expect(outlined().length).toBeGreaterThan(3);
  });

  it('does nothing for a section no block is linked to', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3');
    link.highlight('NOWHERE');
    expect(outlined()).toEqual([]);
  });
});

describe('the mouse on the map', () => {
  const over = (el, related = null) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: related }));
  const out = (el, related = null) => el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: related }));

  it('says which section a hovered block belongs to, and when the mouse leaves it', () => {
    buildMap();
    const onHover = vi.fn();
    link = createMapLink({ onHover });
    show('NTHU3');
    over(block('NORTH UPPER 3'));
    expect(onHover).toHaveBeenLastCalledWith('NTHU3');
    out(block('NORTH UPPER 3'), host);
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(onHover).toHaveBeenCalledTimes(2);
  });

  it('does not repeat itself, and goes straight from one block to the next', () => {
    buildMap();
    const onHover = vi.fn();
    link = createMapLink({ onHover });
    show('NTHU3');
    over(block('NORTH UPPER 3'));
    over(block('NORTH UPPER 3'));
    out(block('NORTH UPPER 3'), block('WEST UPPER 1')); // into a block: its own mouseover will say
    over(block('WEST UPPER 1'));
    expect(onHover.mock.calls.map((c) => c[0])).toEqual(['NTHU3', 'WESTU1']);
  });

  it('says nothing special for a block that is no section of ours (it ends the last hover)', () => {
    buildMap();
    const onHover = vi.fn();
    link = createMapLink({ onHover });
    show('NTHU3');
    over(block('NORTH UPPER 3'));
    over(block('SWEST'));
    expect(onHover.mock.calls.map((c) => c[0])).toEqual(['NTHU3', null]);
  });

  it('says which section a clicked block is, and ignores one that is none of ours', () => {
    buildMap();
    const onClick = vi.fn();
    link = createMapLink({ onClick });
    show('NTHU3');
    block('NORTH UPPER 3').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    block('SWEST').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick.mock.calls).toEqual([['NTHU3']]);
  });

  it('never stops the map\'s own handling of the click', () => {
    const svg = buildMap();
    const theirs = vi.fn();
    svg.addEventListener('click', theirs);
    link = createMapLink({ onClick: vi.fn() });
    show('NTHU3');
    block('NORTH UPPER 3').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(theirs).toHaveBeenCalledTimes(1);
  });
});

describe('hovering a section in our list: what the map is made to do', () => {
  const TYPES = ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove', 'pointerout', 'pointerleave', 'mouseout', 'mouseleave', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

  /** Every event of any of those kinds that reaches `path`, in order. */
  function record(path) {
    const events = [];
    TYPES.forEach((type) => path.addEventListener(type, (e) => events.push({ type: e.type, bubbles: e.bubbles, x: e.clientX, y: e.clientY, ours: e.tmsv === true })));
    return events;
  }

  it('shows a closed section\'s block the way a mouse resting on it would, after a short pause', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3');
    const path = block('NORTH UPPER 3');
    path.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 50 });
    const events = record(path);

    link.hover('NTHU3', false);
    expect(events).toEqual([]); // not at once: the mouse may only be passing
    vi.advanceTimersByTime(160);
    expect(events.map((e) => e.type)).toEqual(['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']);
    expect(events.every((e) => e.x === 60 && e.y === 45)).toBe(true); // the middle of the block: where the tooltip goes
    expect(events.find((e) => e.type === 'mouseover').bubbles).toBe(true); // the framework hears hovers at the root
    expect(events.find((e) => e.type === 'mouseenter').bubbles).toBe(false); // as enter events do
  });

  it('takes the hover back when the mouse leaves the section', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3');
    const path = block('NORTH UPPER 3');
    link.hover('NTHU3', false);
    vi.advanceTimersByTime(160);
    const events = record(path);
    link.hover(null, false);
    expect(events.map((e) => e.type)).toEqual(['pointerout', 'pointerleave', 'mouseout', 'mouseleave']);
    link.hover(null, false);
    expect(events).toHaveLength(4); // once
  });

  it('does nothing if the mouse has moved on before the pause is over', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3');
    const events = record(block('NORTH UPPER 3'));
    link.hover('NTHU3', false);
    vi.advanceTimersByTime(100);
    link.hover(null, false);
    vi.advanceTimersByTime(1000);
    expect(events).toEqual([]);
  });

  it('opens an open section\'s block with a click, after a longer pause, exactly once', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3');
    const events = record(block('NORTH UPPER 3'));
    link.hover('NTHU3', true);
    vi.advanceTimersByTime(300);
    expect(events).toEqual([]); // sweeping down the list must not make the map lurch
    vi.advanceTimersByTime(150);
    expect(events.map((e) => e.type)).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    expect(events.filter((e) => e.type === 'click')).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(events).toHaveLength(5);
  });

  it('takes a hover back before opening, so the map is not left showing a tooltip', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3');
    const path = block('NORTH UPPER 3');
    link.hover('NTHU3', false);
    vi.advanceTimersByTime(160);
    const events = record(path);
    link.hover('NTHU3', true);
    vi.advanceTimersByTime(450);
    expect(events.map((e) => e.type)).toEqual(['pointerout', 'pointerleave', 'mouseout', 'mouseleave', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
  });

  it('marks what it sends as its own, and does not hear itself (no hover or click feeding back into the list)', () => {
    buildMap();
    const onHover = vi.fn();
    const onClick = vi.fn();
    link = createMapLink({ onHover, onClick });
    show('NTHU3');
    const events = record(block('NORTH UPPER 3'));
    link.hover('NTHU3', false);
    vi.advanceTimersByTime(160);
    link.hover('NTHU3', true);
    vi.advanceTimersByTime(450);
    expect(events.length).toBeGreaterThan(5);
    expect(events.every((e) => e.ours)).toBe(true);
    expect(onHover).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('outlines the block at once, whatever the pause', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3', 'WESTU1', 'WESTU7', "STANDING-OVER 14'S ONLY");
    link.hover('NTHU3', false);
    expect(outlined()).toEqual([dOf('NORTH UPPER 3')]);
    link.hover(null, false);
    expect(outlined()).toEqual([]);
  });

  it('acts on the main map, not the overview of it (they both have the block)', () => {
    buildMap();
    // a second, small svg with the same blocks: the overview in the corner of the opened map
    const mini = document.createElement('div');
    mini.innerHTML = host.querySelector('svg').outerHTML;
    document.body.append(mini);
    const [main, overview] = document.querySelectorAll('svg[data-component="svg"]');
    main.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 700 });
    overview.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 70 });
    link = createMapLink();
    show('NTHU3');
    const inMain = record(main.querySelector('path[data-section-name="NORTH UPPER 3"]'));
    const inOverview = record(overview.querySelector('path[data-section-name="NORTH UPPER 3"]'));
    link.hover('NTHU3', true);
    vi.advanceTimersByTime(450);
    expect(inMain.filter((e) => e.type === 'click')).toHaveLength(1);
    expect(inOverview).toEqual([]);
  });

  it('falls back to the overview when the main map has no such block (an opened map shows seats, not blocks)', () => {
    buildMap();
    const mini = document.createElement('div');
    mini.innerHTML = host.querySelector('svg').outerHTML;
    document.body.append(mini);
    const [main, overview] = document.querySelectorAll('svg[data-component="svg"]');
    main.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 700 });
    overview.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 70 });
    main.querySelector('path[data-section-name="NORTH UPPER 3"]').remove();
    link = createMapLink();
    show('NTHU3');
    const inOverview = record(overview.querySelector('path[data-section-name="NORTH UPPER 3"]'));
    link.hover('NTHU3', true);
    vi.advanceTimersByTime(450);
    expect(inOverview.filter((e) => e.type === 'click')).toHaveLength(1);
  });

  it('veils the empty blocks on every map it finds, the overview too', () => {
    buildMap();
    const mini = document.createElement('div');
    mini.innerHTML = host.querySelector('svg').outerHTML;
    document.body.append(mini);
    link = createMapLink();
    show('NTHU3');
    const overlays = document.querySelectorAll('svg > g[data-tmsv-overlay]');
    expect(overlays).toHaveLength(2);
    overlays.forEach((o) => expect(o.querySelectorAll('path[fill-opacity]')).toHaveLength(3));
  });

  it('does nothing for a section no block is linked to, and nothing when switched off', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3');
    const events = record(block('NORTH UPPER 3'));
    expect(() => { link.hover('NOWHERE', true); vi.advanceTimersByTime(500); }).not.toThrow();
    link.setEnabled(false);
    link.hover('NTHU3', true);
    vi.advanceTimersByTime(500);
    expect(events).toEqual([]);
  });

  it('forgets a pending hover when destroyed', () => {
    buildMap();
    link = createMapLink();
    show('NTHU3');
    const events = record(block('NORTH UPPER 3'));
    link.hover('NTHU3', true);
    link.destroy();
    vi.advanceTimersByTime(1000);
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// What the real map does when zoomed in (probed on The O2 Belfast): the main svg holds the SEATS, in g.seats > g.svg__block
// (named by section CODE) > g[data-row-name] > circle[data-seat-name], and a small overview svg holds all the blocks.
// ---------------------------------------------------------------------------------------------------------------------

/** A zoomed-in map: seats of EASTL8 (rows J and K) and NTHM3 (row P), an overview with every block, and the zoom buttons. */
function buildZoomed({ withReset = true, resetLabel = 'Reset zoom' } = {}) {
  const seat = (id, n, cx, cy, type) => `<circle data-component="svg__seat" id="${id}" ${type ? `type="${type}"` : ''} data-seat-name="${n}" cx="${cx}" cy="${cy}" r="17.5"></circle>`;
  document.body.innerHTML =
    '<div id="map-wrap">' +
    '<div class="controls">' +
    (withReset ? `<button id="reset" aria-label="${resetLabel}"></button>` : '') +
    '<button id="zin" aria-label="Zoom in">+</button><button id="zout" aria-label="Zoom out">-</button></div>' +
    '<div class="viewport"><svg id="main" data-component="svg" viewBox="0 0 10240 7680"><g class="seats">' +
    '<g data-component="svg__block" data-section-name="EASTL8" data-section-id="s_22" class="section"><g data-row-name="J">' +
    seat('a1', 141, 7807.4, 5568.85, 'primary') + seat('a2', 142, 7771.18, 5593.38, 'primary') + seat('a3', 143, 7734.27, 5616.27) +
    '</g><g data-row-name="K">' + seat('b1', 141, 7843.65, 5628.51, 'primary') + seat('b2', 142, 7808.36, 5652.27, 'primary') + '</g></g>' +
    '<g data-component="svg__block" data-section-name="NTHM3" data-section-id="s_79" class="section"><g data-row-name="P">' + seat('c1', 36, 4970.45, 1487.06) + '</g></g>' +
    '</g><g class="polygons"><path data-component="svg__section" data-section-id="s_22" data-section-name="EAST LOWER 8" data-active="true" d="M1 1L2 2z"></path></g></svg></div>' +
    '<svg id="mini" data-component="svg" viewBox="0 0 10240 7680"><g class="seats"></g><g class="polygons">' +
    o2.blocks.map((b, i) => `<path data-component="svg__section" data-section-id="${b.id}" data-section-name="${b.name}" data-active="${b.active}" d="M${i} 0L${i} 10z"></path>`).join('') +
    '</g></svg></div>';
  const main = document.getElementById('main');
  const mini = document.getElementById('mini');
  main.getBoundingClientRect = () => ({ left: 0, top: 0, width: 10234, height: 9593 });
  mini.getBoundingClientRect = () => ({ left: 0, top: 0, width: 209, height: 196 });
  return { main, mini };
}

/** What Ticketmaster does on its reset button: empty the seats and put the blocks back (as the overview). */
function zoomOutOnReset() {
  document.getElementById('reset').addEventListener('click', () => {
    const main = document.getElementById('main');
    main.querySelector('g.seats').replaceChildren();
    main.querySelector('g.polygons').innerHTML = o2.blocks.map((b, i) => `<path data-component="svg__section" data-section-id="${b.id}" data-section-name="${b.name}" data-active="${b.active}" d="M${i} 0L${i} 10z"></path>`).join('');
  });
}

const east = { section: 'EASTL8', rowName: 'J', seatFrom: '141', seatTo: '142' };
const eastSections = [
  { name: 'EASTL8', tickets: [{ section: 'EASTL8', originalSection: 'EASTL8', description: 'EAST LOWER TIER' }] },
  { name: 'NTHM3', tickets: [{ section: 'NTHM3', originalSection: 'NTHM3', description: 'NORTH MIDDLE TIER' }] },
  { name: 'WESTU1', tickets: [{ section: 'WESTU1', originalSection: 'WESTU1', description: 'WEST UPPER TIER' }] },
];
const rings = () => Array.from(document.querySelectorAll('#main > g[data-tmsv-overlay] circle')).map((c) => [c.getAttribute('cx'), c.getAttribute('cy')]);

describe('the seat numbers of a ticket', () => {
  it('are the range it covers', () => {
    expect(seatsOf({ seatFrom: '141', seatTo: '142' })).toEqual(['141', '142']);
    expect(seatsOf({ seatFrom: '7', seatTo: '7' })).toEqual(['7']);
    expect(seatsOf({ seatFrom: '10', seatTo: '13' })).toEqual(['10', '11', '12', '13']);
  });

  it('are just the two ends when they are not numbers, or a silly range', () => {
    expect(seatsOf({ seatFrom: 'A1', seatTo: 'A4' })).toEqual(['A1', 'A4']);
    expect(seatsOf({ seatFrom: '1', seatTo: '500' })).toEqual(['1', '500']);
    expect(seatsOf({ seatFrom: '9', seatTo: '3' })).toEqual(['9', '3']);
  });

  it('are none for a ticket with no seats (standing)', () => {
    expect(seatsOf({})).toEqual([]);
    expect(seatsOf({ seatFrom: null, seatTo: null })).toEqual([]);
  });
});

describe('the greyed blocks, and what the console is told', () => {
  it('are grey like the map\'s own unavailable blocks (they were a washed-out blue that looked like a different state)', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    show('NTHU3');
    const veil = overlay().querySelector('path[fill-opacity]');
    expect(veil.getAttribute('fill')).toBe('#8c8f99');
    expect(Number(veil.getAttribute('fill-opacity'))).toBeGreaterThan(0.8);
  });

  it('summarises how the map and the list were linked', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    show('NTHU3');
    const summary = link.summary();
    expect(summary.blocks).toBe(o2.blocks.length);
    expect(summary.linked).toBe(4); // the four sections of ours
    expect(summary.veiled).toBe(3);
    expect(summary.unlinked).toContain('NORTH UPPER 2 [s_9]'); // available on the map, no section of ours
    expect(summary.unlinked).not.toContain('SWEST [s_111]'); // the map shows it unavailable: nothing to explain
    expect(summary.sectionsWithoutBlock).toEqual([]);
  });

  it('has no summary without a map', () => {
    document.body.innerHTML = '<p>no map</p>';
    link = createMapLink({ log: () => {} });
    expect(link.summary()).toBeNull();
  });

  it('says in the console which blocks it could not link, and which sections have no block, once for each outcome', () => {
    buildMap();
    const log = vi.fn();
    link = createMapLink({ log });
    link.update({ sections: [...sections, { name: 'NOWHERE', tickets: [] }], visible: new Set(['NTHU3']), ready: true });
    expect(log).toHaveBeenCalledTimes(1);
    const text = log.mock.calls[0][0];
    expect(text).toMatch(/^Seat map: 68 blocks, 4 linked to a section of ours, 3 greyed\./);
    expect(text).toMatch(/linked to no section of ours: WEST LOWER 8 \[s_38\]/); // the first few, with their ids
    expect(text).toContain('Sections of ours with no block: NOWHERE.');
    link.update({ sections: [...sections, { name: 'NOWHERE', tickets: [] }], visible: new Set(['NTHU3']), ready: true });
    expect(log).toHaveBeenCalledTimes(1); // the same again
    link.update({ sections: [...sections, { name: 'NOWHERE', tickets: [] }], visible: new Set(['NTHU3', 'WESTU1']), ready: true });
    expect(log).toHaveBeenCalledTimes(2); // 2 greyed now
  });

  it('says nothing until the whole list has loaded (it would only list what is not here yet)', () => {
    buildMap();
    const log = vi.fn();
    link = createMapLink({ log });
    link.update({ sections, visible: new Set(['NTHU3']), ready: false });
    expect(log).not.toHaveBeenCalled();
  });

  it('keeps the lists short', () => {
    buildMap();
    const log = vi.fn();
    link = createMapLink({ log });
    link.update({ sections: [], visible: new Set(), ready: true });
    expect(log.mock.calls[0][0]).toMatch(/\(\+\d+ more\)/);
  });
});

describe('a map that is zoomed in', () => {
  it('shows seats in the main map and the blocks in the overview: both are looked after', () => {
    buildZoomed();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8', 'NTHM3', 'WESTU1']), ready: true });
    expect(document.querySelectorAll('svg > g[data-tmsv-overlay]')).toHaveLength(2);
  });

  it('does not veil over the seats (the seats are the point), but still on the overview', () => {
    buildZoomed();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8']), ready: true }); // NTHM3 and WESTU1 are filtered out
    expect(document.querySelectorAll('#main > g[data-tmsv-overlay] path')).toHaveLength(0);
    expect(document.querySelectorAll('#mini > g[data-tmsv-overlay] path[fill-opacity]').length).toBeGreaterThan(0);
  });

  it('rings the seats of the ticket the mouse is on in our list', () => {
    buildZoomed();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8']), ready: true });
    link.hoverTicket(east); // EASTL8 row J seats 141-142
    expect(rings()).toEqual([['7807.4', '5568.85'], ['7771.18', '5593.38']]);
    const ring = document.querySelector('#main > g[data-tmsv-overlay] circle');
    expect(ring.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(ring.getAttribute('pointer-events')).toBe('none');
    expect(Number(ring.getAttribute('r'))).toBeGreaterThan(17.5); // round the seat, not on it
    link.hoverTicket(null);
    expect(rings()).toEqual([]);
  });

  it('rings the right row of the right section, and no other seat that has the same number', () => {
    buildZoomed();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8']), ready: true });
    link.hoverTicket({ section: 'EASTL8', rowName: 'K', seatFrom: '141', seatTo: '141' });
    expect(rings()).toEqual([['7843.65', '5628.51']]); // row K, not row J's 141
    link.hoverTicket({ section: 'NTHM3', rowName: 'p', seatFrom: '36', seatTo: '36' }); // the row's case does not matter
    expect(rings()).toEqual([['4970.45', '1487.06']]);
    link.hoverTicket({ section: 'EASTL8', rowName: 'Z', seatFrom: '141', seatTo: '141' });
    expect(rings()).toEqual([]);
    link.hoverTicket({ section: 'WESTU1', rowName: 'J', seatFrom: '141', seatTo: '141' });
    expect(rings()).toEqual([]);
  });

  it('rings nothing for a standing ticket, and when the map is not zoomed in (no seats drawn)', () => {
    buildZoomed();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8']), ready: true });
    link.hoverTicket({ section: "STANDING-OVER 14'S ONLY", rowName: null, seatFrom: null, seatTo: null });
    expect(rings()).toEqual([]);

    buildMap();
    vi.advanceTimersByTime(1100);
    link.hoverTicket(east);
    expect(document.querySelectorAll('g[data-tmsv-overlay] circle')).toHaveLength(0);
  });

  it('rings the seats once the map has drawn them (it zooms with an animation)', () => {
    buildZoomed();
    const seats = document.querySelector('#main g.seats');
    const held = Array.from(seats.children);
    seats.replaceChildren(); // not drawn yet
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8']), ready: true });
    link.hoverTicket(east);
    expect(rings()).toEqual([]);
    seats.replaceChildren(...held); // the zoom has finished
    vi.advanceTimersByTime(300);
    expect(rings()).toHaveLength(2);
  });

  it('does not show a block\'s tooltip while zoomed in (that is for the overview)', () => {
    buildZoomed();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8']), ready: true });
    const seen = [];
    document.querySelectorAll('path[data-section-name="EAST LOWER 8"]').forEach((p) => p.addEventListener('mouseover', () => seen.push('over')));
    link.hover('EASTL8', false);
    vi.advanceTimersByTime(300);
    expect(seen).toEqual([]);
  });
});

describe('an overview map that has seats drawn in it (the real one keeps them: the map is not zoomed)', () => {
  /** The overview: one svg with every block, and seats in g.seats as well (as on The O2 Belfast's page: a ring on one showed as a dot at NL2). */
  function buildOverviewWithSeats() {
    const svg = buildMap();
    svg.querySelector('g.seats').innerHTML =
      '<g data-component="svg__block" data-section-name="NTHU3" data-section-id="s_8" class="section"><g data-row-name="U">' +
      '<circle data-component="svg__seat" id="x1" data-seat-name="40" cx="4970.45" cy="1487.06" r="14.875"></circle></g></g>';
    return svg;
  }
  const ticket = { section: 'NTHU3', rowName: 'U', seatFrom: '40', seatTo: '40' };

  it('is not zoomed in: opening a section clicks its block at once, with no reset', () => {
    const svg = buildOverviewWithSeats();
    const reset = document.createElement('button');
    reset.setAttribute('aria-label', 'Reset zoom');
    svg.parentNode.append(reset);
    const pressed = vi.fn();
    reset.addEventListener('click', pressed);
    link = createMapLink({ log: () => {} });
    show('NTHU3');
    const clicks = [];
    block('NORTH UPPER 3').addEventListener('click', (e) => clicks.push(e.tmsv === true));
    link.hover('NTHU3', true);
    vi.advanceTimersByTime(450);
    expect(clicks).toEqual([true]);
    expect(pressed).not.toHaveBeenCalled();
  });

  it('draws no ring on it: the seats are too small to see, and the block is the answer', () => {
    buildOverviewWithSeats();
    link = createMapLink({ log: () => {} });
    show('NTHU3');
    link.hoverTicket(ticket);
    expect(document.querySelectorAll('g[data-tmsv-overlay] circle')).toHaveLength(0);
  });

  it('still outlines blocks and greys the empty ones', () => {
    buildOverviewWithSeats();
    link = createMapLink({ log: () => {} });
    show('NTHU3');
    expect(dimmed().length).toBe(3);
    link.highlight('NTHU3');
    expect(outlined()).toEqual([dOf('NORTH UPPER 3')]);
  });

  it('shows a closed section\'s tooltip, as ever', () => {
    buildOverviewWithSeats();
    link = createMapLink({ log: () => {} });
    show('NTHU3');
    const seen = [];
    block('NORTH UPPER 3').addEventListener('mouseover', () => seen.push('over'));
    link.hover('NTHU3', false);
    vi.advanceTimersByTime(200);
    expect(seen).toEqual(['over']);
  });
});

describe('knowing whether the map is zoomed in', () => {
  it('a single map with one block and seats is zoomed in (the overview has not appeared yet)', () => {
    const { mini } = buildZoomed();
    mini.remove();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8']), ready: true });
    link.hoverTicket(east);
    expect(rings()).toHaveLength(2); // seats are shown: it is zoomed
  });

  it('the main map with all its blocks is not zoomed in however many seats it holds', () => {
    const { main, mini } = buildZoomed();
    mini.remove();
    main.querySelector('g.polygons').innerHTML = o2.blocks.map((b, i) => `<path data-component="svg__section" data-section-id="${b.id}" data-section-name="${b.name}" data-active="${b.active}" d="M${i} 0L${i} 10z"></path>`).join('');
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8']), ready: true });
    link.hoverTicket(east);
    expect(rings()).toEqual([]);
  });
});

describe('opening a section when the map is zoomed in already', () => {
  const clicks = (id) => { const got = []; document.getElementById(id).addEventListener('click', (e) => got.push(e.tmsv === true)); return got; };

  it('zooms out first (Ticketmaster\'s own reset button), then goes to the new place', () => {
    buildZoomed();
    zoomOutOnReset();
    const log = vi.fn();
    link = createMapLink({ log });
    link.update({ sections: eastSections, visible: new Set(['EASTL8', 'NTHM3', 'WESTU1']), ready: true });
    const reset = clicks('reset');
    const target = [];
    // the block the map will have in its main svg once it is the overview again
    document.getElementById('main').addEventListener('click', (e) => { if (e.target.getAttribute && e.target.getAttribute('data-section-name') === 'WEST UPPER 1') target.push('clicked'); });

    link.hover('WESTU1', true);
    vi.advanceTimersByTime(450);
    expect(reset).toEqual([true]); // pressed, once
    expect(log.mock.calls.some((c) => /zoomed in: pressing its reset button, then opening WESTU1/.test(c[0]))).toBe(true);
    expect(target).toEqual([]); // not before the map has zoomed out
    vi.advanceTimersByTime(250);
    expect(document.querySelector('#main g.seats').children.length).toBe(0); // the map zoomed out (our press of its button did that)
    vi.advanceTimersByTime(300);
    expect(target).toEqual(['clicked']); // ...and only then the block
  });

  it('does not zoom out when it is not zoomed in: it just clicks the block', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    show('NTHU3');
    const events = [];
    block('NORTH UPPER 3').addEventListener('click', () => events.push('click'));
    link.hover('NTHU3', true);
    vi.advanceTimersByTime(450);
    expect(events).toEqual(['click']);
  });

  it('does nothing when the map is showing that section already (we opened it)', () => {
    buildZoomed();
    zoomOutOnReset();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8', 'NTHM3', 'WESTU1']), ready: true });
    // we open WESTU1 (zoomed in elsewhere): reset, then click; the map zooms in at it again
    link.hover('WESTU1', true);
    vi.advanceTimersByTime(900);
    document.querySelector('#main g.seats').append(document.createElementNS('http://www.w3.org/2000/svg', 'g')); // zoomed in again
    const reset = clicks('reset');
    link.hover(null, false);
    link.hover('WESTU1', true);
    vi.advanceTimersByTime(900);
    expect(reset).toEqual([]); // it is showing WESTU1: leave it alone
  });

  it('finds the reset button among the zoom controls even if it is not called "reset"', () => {
    buildZoomed({ resetLabel: 'Fit' });
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8', 'NTHM3', 'WESTU1']), ready: true });
    const reset = clicks('reset');
    link.hover('WESTU1', true);
    vi.advanceTimersByTime(450);
    expect(reset).toEqual([true]); // the button beside zoom in and zoom out
  });

  it('uses the overview map when it can find no reset button, and says which buttons there were', () => {
    buildZoomed({ withReset: false });
    const log = vi.fn();
    link = createMapLink({ log });
    link.update({ sections: eastSections, visible: new Set(['EASTL8', 'NTHM3', 'WESTU1']), ready: true });
    const inOverview = [];
    document.querySelector('#mini path[data-section-name="WEST UPPER 1"]').addEventListener('click', () => inOverview.push('click'));
    link.hover('WESTU1', true);
    vi.advanceTimersByTime(450);
    expect(inOverview).toEqual(['click']);
    expect(log.mock.calls.some((c) => /no reset button was found among: "Zoom in", "Zoom out"/.test(c[0]))).toBe(true);
  });

  it('gives up, saying so, if the map does not zoom out', () => {
    buildZoomed(); // no zoomOutOnReset: the button does nothing
    const log = vi.fn();
    link = createMapLink({ log });
    link.update({ sections: eastSections, visible: new Set(['EASTL8', 'NTHM3', 'WESTU1']), ready: true });
    const inMain = [];
    document.getElementById('main').addEventListener('click', () => inMain.push('click'));
    link.hover('WESTU1', true);
    vi.advanceTimersByTime(450 + 3000);
    expect(log.mock.calls.some((c) => /did not zoom out/.test(c[0]))).toBe(true);
    expect(inMain).toEqual([]); // no block was clicked
  });

  it('drops the plan if the mouse leaves before the map has zoomed out', () => {
    buildZoomed();
    zoomOutOnReset();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8', 'NTHM3', 'WESTU1']), ready: true });
    const target = [];
    document.getElementById('main').addEventListener('click', (e) => { if (e.target.getAttribute && e.target.getAttribute('data-section-name') === 'WEST UPPER 1') target.push('clicked'); });
    link.hover('WESTU1', true);
    vi.advanceTimersByTime(450); // reset pressed
    link.hover(null, false);
    vi.advanceTimersByTime(2000);
    expect(target).toEqual([]);
  });
});

describe('destroy', () => {
  it('takes the overlay and the listeners away and stops looking', () => {
    buildMap();
    const onHover = vi.fn();
    link = createMapLink({ onHover });
    show('NTHU3');
    link.destroy();
    expect(document.querySelector('[data-tmsv-overlay]')).toBeNull();
    block('NORTH UPPER 3').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(onHover).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(document.querySelector('[data-tmsv-overlay]')).toBeNull();
  });
});
