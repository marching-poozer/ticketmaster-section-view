// The map adapter, on a jsdom page with an <svg> built like Ticketmaster's (the real block names and ids of The O2 Belfast).
import fs from 'node:fs';
import path from 'node:path';
import { createMapLink, seatsOf } from '../src/content/map.js';
import { picksToTickets } from '../src/lib/quickpicks.js';
import { sectionsOf } from '../src/lib/map-link.js';
import { buildAvailability, parseFacets, parseGeometry } from '../src/lib/map-data.js';

const o2 = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/o2-map-blocks.json'), 'utf8'));
const real = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/quickpicks-resale-standing.json'), 'utf8'));
const realSections = sectionsOf(picksToTickets(real, { currency: '€' })); // NTHU3, STANDING-OVER 14'S ONLY, WESTU1, WESTU7: all four have a block
// ...plus one section with no block on the map: the linking is then INCOMPLETE, so a block linked to no section is left alone
// (it may be that very section, named differently). Most of these tests are about that case; the complete one has its own tests.
const sections = [...realSections, { name: 'UNMAPPED', tickets: [] }];

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
// the blocks we mark as having no tickets (tiers 2 and 3: filtered out, or none at all), and, apart, the map's own unavailable ones we fade to match
// (each block is drawn in a few layers, one path each: the first stands for the block)
const FIRST = '[data-tmsv-layer="0"]';
const dimmed = () => Array.from(overlay().querySelectorAll(`path[data-tmsv-tier="filtered"]${FIRST}, path[data-tmsv-tier="empty"]${FIRST}`)).map((p) => p.getAttribute('d'));
const tier = (name) => Array.from(overlay().querySelectorAll(`path[data-tmsv-tier="${name}"]${FIRST}`)).map((p) => p.getAttribute('d'));
const layersOf = (name, d) => Array.from(overlay().querySelectorAll(`path[data-tmsv-tier="${name}"]`)).filter((p) => p.getAttribute('d') === d).map((p) => ({ layer: p.getAttribute('data-tmsv-layer'), fill: p.getAttribute('fill'), opacity: p.getAttribute('fill-opacity'), style: p.getAttribute('style') }));
const styleOf = (el) => ['fill', 'fill-opacity', 'style', 'data-tmsv-layer'].map((a) => el.getAttribute(a)).join('|');
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

  it('marks blocks as the list is still loading, and in just the same way once it has loaded (it was lighter, and hard to tell apart)', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update({ sections, visible: new Set(['NTHU3']), ready: false }); // still loading
    expect(dimmed().length).toBeGreaterThan(0);
    const styles = () => Object.fromEntries(Array.from(overlay().querySelectorAll('path[data-tmsv-tier]')).map((p) => [p.getAttribute('data-tmsv-tier') + '/' + p.getAttribute('data-tmsv-layer'), styleOf(p)]));
    const during = styles();
    link.update({ sections, visible: new Set(['NTHU3']), ready: true });
    expect(dimmed().length).toBe(3);
    const after = styles();
    expect(Object.keys(after).length).toBeGreaterThan(0);
    Object.keys(after).forEach((t) => expect(after[t]).toBe(during[t])); // a tier looks the same whether the list is loading or loaded
  });

  it('lights blocks up as the tickets for them are found', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    const west = realSections.find((s) => s.name === 'WESTU1');
    const north = realSections.find((s) => s.name === 'NTHU3');
    link.update({ sections: [north], visible: new Set(), ready: false }); // one section known so far, and the filters leave nothing in it
    expect(dimmed()).toContain(dOf('NORTH UPPER 3')); // no matching ticket yet
    link.update({ sections: [north, west], visible: new Set(['NTHU3']), ready: false }); // a matching ticket arrives
    expect(dimmed()).not.toContain(dOf('NORTH UPPER 3')); // it lights up
    expect(dimmed()).toContain(dOf('WEST UPPER 1')); // the other section's tickets do not match
    link.update({ sections: [north, west], visible: new Set(['NTHU3', 'WESTU1']), ready: false });
    expect(dimmed()).not.toContain(dOf('WEST UPPER 1')); // and now it does
  });

  it('says nothing before any ticket is known (an empty list has nothing to show yet)', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update({ sections: [], visible: new Set(), ready: false });
    expect(dimmed()).toEqual([]);
  });

  it('leaves a block no section matches yet alone while loading too: its tickets may simply not have arrived', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update({ sections: [realSections[0]], visible: new Set(['NTHU3']), ready: false });
    expect(dimmed()).not.toContain(dOf('NORTH UPPER 2')); // nothing loaded for it yet: nothing is said
    link.update({ sections: [...realSections, { name: 'UNMAPPED', tickets: [] }], visible: new Set(['NTHU3']), ready: true });
    expect(dimmed()).not.toContain(dOf('NORTH UPPER 2'));
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
    overlays.forEach((o) => expect(o.querySelectorAll('path[data-tmsv-tier="filtered"][data-tmsv-layer="0"], path[data-tmsv-tier="empty"][data-tmsv-layer="0"]')).toHaveLength(3));
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

describe('diagnosing how the map and the list were matched', () => {
  it('says, per block, what became of it', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update({ sections: realSections, visible: new Set(['NTHU3']), ready: true });
    const report = link.diagnose();
    const of = (name) => report.blocks.find((b) => b.name === name);
    expect(report.linkingComplete).toBe(true);
    expect(of('NORTH UPPER 3')).toMatchObject({ id: 's_8', available: true, section: 'NTHU3' });
    expect(of('NORTH UPPER 3').state).toMatch(/^shown/);
    expect(of('WEST UPPER 1')).toMatchObject({ section: 'WESTU1' });
    expect(of('WEST UPPER 1').state).toMatch(/^toned down \(the section has tickets, none left by the filters\)/);
    expect(of('NORTH UPPER 2')).toMatchObject({ section: null });
    expect(of('NORTH UPPER 2').state).toMatch(/^LEFT ALONE \(the map says available, no section of ours: not in the list at all/);
    expect(of('SWEST').state).toMatch(/^unavailable/);
    expect(report.blocks).toHaveLength(o2.blocks.length);
  });

  it('says a block is left alone, and why, when the linking is incomplete', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update({ sections: [...realSections, { name: 'ODDLY_NAMED', tickets: [] }], visible: new Set(['NTHU3']), ready: true });
    const report = link.diagnose();
    expect(report.linkingComplete).toBe(false);
    expect(report.blocks.find((b) => b.name === 'NORTH UPPER 2').state).toMatch(/^LEFT ALONE.*one of our sections has no block/);
  });

  it('says so while the list is not complete', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update({ sections: realSections, visible: new Set(['NTHU3']), ready: false });
    const of = (name) => link.diagnose().blocks.find((b) => b.name === name).state;
    expect(of('NORTH UPPER 3')).toMatch(/^shown/);
    expect(of('WEST UPPER 1')).toMatch(/^toned down .*so far/);
    expect(of('NORTH UPPER 2')).toMatch(/^LEFT ALONE/); // not marked while loading either
  });

  it('says, per section of ours, how many tickets it has and shows, its blocks, and what the API says of it', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    const tickets = picksToTickets(real, { currency: '€' });
    link.update({ sections: realSections, visible: new Set(['NTHU3']), matching: tickets.filter((t) => t.section === 'NTHU3'), ready: true });
    const report = link.diagnose();
    const north = report.sections.find((s) => s.name === 'NTHU3');
    expect(north).toMatchObject({ tickets: 1, shown: 1, blocks: ['NORTH UPPER 3'], description: 'NORTH UPPER TIER', areaName: 'NTHU' });
    const standing = report.sections.find((s) => s.name === "STANDING-OVER 14'S ONLY");
    expect(standing).toMatchObject({ tickets: 1, shown: 0, blocks: ['GROUND FLOOR STANDING'], blockIdOfPicture: 's_112' });
    const west = report.sections.find((s) => s.name === 'WESTU1');
    expect(west.shown).toBe(0);
  });

  it('says what the maps are, and the settings that matter', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.setAutoZoom(false);
    link.update({ sections: realSections, visible: new Set(), ready: true });
    const report = link.diagnose();
    expect(report).toMatchObject({ enabled: true, autoZoom: false, ready: true, zoomedIn: false });
    expect(report.maps).toHaveLength(1);
    expect(report.maps[0]).toMatchObject({ viewBox: '0 0 10240 7680', blocks: o2.blocks.length, seatBlocks: [] }); // (the zoomed-in map names the blocks it has seats for)
  });

  it('says it all in a form that can be written down as text', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update({ sections: realSections, visible: new Set(['NTHU3']), ready: true });
    expect(() => JSON.stringify(link.diagnose())).not.toThrow();
    expect(JSON.stringify(link.diagnose()).length).toBeLessThan(40000);
  });

  it('has nothing to say about a page with no map', () => {
    document.body.innerHTML = '<p>no map</p>';
    link = createMapLink({ log: () => {} });
    expect(link.diagnose()).toMatchObject({ blocks: [], maps: [] });
  });
});

describe('labelling the blocks', () => {
  /** jsdom has no geometry: give each block a box (as a browser does) from its place in the list. */
  function giveBoxes() {
    document.querySelectorAll('path[data-component="svg__section"]').forEach((p, i) => { p.getBBox = () => ({ x: i * 100, y: 50, width: 80, height: 40 }); });
  }
  const labels = () => Array.from(document.querySelectorAll('svg > g[data-tmsv-overlay] text')).map((t) => [t.textContent, t.getAttribute('fill')]);

  it('writes the section a block is linked to on it, and ? on an available block nothing matches, and - on one the map greys', () => {
    buildMap();
    giveBoxes();
    link = createMapLink({ log: () => {} });
    link.update({ sections: [...realSections, { name: 'UNMAPPED', tickets: [] }], visible: new Set(['NTHU3']), ready: true });
    link.showLabels(5000);
    const text = labels().map((l) => l[0]);
    expect(text).toContain('NTHU3');
    expect(text).toContain('WESTU1');
    expect(text).toContain("STANDING-OVER 14'S ONLY");
    expect(text).toContain('?');
    expect(text).toContain('-');
    expect(labels()).toHaveLength(o2.blocks.length);
  });

  it('colours them: green for a block that still shows tickets, white for a greyed one, red for the unlinked', () => {
    buildMap();
    giveBoxes();
    link = createMapLink({ log: () => {} });
    link.update({ sections: [...realSections, { name: 'UNMAPPED', tickets: [] }], visible: new Set(['NTHU3']), ready: true });
    link.showLabels(5000);
    const colour = (name) => labels().find((l) => l[0] === name)[1];
    expect(colour('NTHU3')).toBe('#00ff66');
    expect(colour('WESTU1')).toBe('#ffffff');
    expect(colour('?')).toBe('#ff2d2d');
  });

  it('takes them away after the time is up', () => {
    buildMap();
    giveBoxes();
    link = createMapLink({ log: () => {} });
    link.update({ sections: realSections, visible: new Set(['NTHU3']), ready: true });
    link.showLabels(2000);
    expect(labels().length).toBeGreaterThan(0);
    vi.advanceTimersByTime(2200);
    expect(labels()).toEqual([]);
  });

  it('never takes the mouse, and is not drawn over the seats of a zoomed map', () => {
    buildMap();
    giveBoxes();
    link = createMapLink({ log: () => {} });
    link.update({ sections: realSections, visible: new Set(['NTHU3']), ready: true });
    link.showLabels(5000);
    document.querySelectorAll('svg > g[data-tmsv-overlay] text').forEach((t) => expect(t.getAttribute('pointer-events')).toBe('none'));

    buildZoomed();
    link.showLabels(5000);
    vi.advanceTimersByTime(1100);
    expect(document.querySelectorAll('#main > g[data-tmsv-overlay] text')).toHaveLength(0);
  });

  it('copes with a browser that cannot say how big a block is (no labels, no error)', () => {
    buildMap(); // jsdom: no getBBox
    link = createMapLink({ log: () => {} });
    link.update({ sections: realSections, visible: new Set(['NTHU3']), ready: true });
    expect(() => link.showLabels(5000)).not.toThrow();
    expect(labels()).toEqual([]);
  });
});

describe('a block with no section of ours', () => {
  const activeBlocks = o2.blocks.filter((b) => b.active).length;

  it('is NEVER dimmed, however complete the linking: Ticketmaster\'s list leaves some tickets out, and the map still shows (and sells) them', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update({ sections: realSections, visible: new Set(['NTHU3']), ready: true }); // every one of the four sections has its block
    expect(link.summary().complete).toBe(true);
    expect(dimmed()).toHaveLength(3); // only the three linked blocks whose tickets are out by the filters
    expect(dimmed()).not.toContain(dOf('NORTH UPPER 2')); // available on the map, no section of ours: left as the map draws it
    expect(dimmed()).not.toContain(dOf('NORTH UPPER 3'));
    expect(overlay().querySelectorAll('path[data-tmsv-tier="filtered"]').length).toBe(3 * 2);
    // ...even with every filter on, so nothing in the list matches
    link.update({ sections: realSections, visible: new Set(), ready: true });
    expect(dimmed()).toHaveLength(4);
    expect(dimmed()).not.toContain(dOf('NORTH UPPER 2'));
  });

  it('is left alone while a section of ours has no block too', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update({ sections: [...realSections, { name: 'ODDLY_NAMED', tickets: [] }], visible: new Set(['NTHU3']), ready: true });
    expect(dimmed()).toHaveLength(3); // only the linked blocks that are out
    expect(dimmed()).not.toContain(dOf('NORTH UPPER 2'));
    expect(link.summary().complete).toBe(false);
  });

  it('is counted as not in the list only when every section has found its block (else it may be one of ours, named differently)', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update({ sections: realSections, visible: new Set(['NTHU3']), ready: true });
    expect(link.summary().veiled).toBe(3);
    expect(link.summary().unlisted).toBe(activeBlocks - 4); // every available block but the four with a section
    expect(link.summary().unlisted).toBe(link.summary().unlinked.length);
    link.update({ sections: [...realSections, { name: 'ODDLY_NAMED', tickets: [] }], visible: new Set(['NTHU3']), ready: true });
    expect(link.summary().unlisted).toBe(0); // not known
    expect(link.summary().unlinked.length).toBeGreaterThan(0);
  });

  it('is marked while the list is still loading and when it has loaded in the same way, so it does not jump as the list completes', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update({ sections: realSections, visible: new Set(['NTHU3']), ready: false });
    const styles = () => Object.fromEntries(Array.from(overlay().querySelectorAll('path[data-tmsv-tier]')).map((p) => [p.getAttribute('data-tmsv-tier') + '/' + p.getAttribute('data-tmsv-layer'), styleOf(p)]));
    const during = styles();
    expect(Object.keys(during).length).toBeGreaterThan(0);
    link.update({ sections: realSections, visible: new Set(['NTHU3']), ready: true });
    const after = styles();
    Object.keys(after).forEach((t) => expect(after[t]).toBe(during[t]));
  });

  it('with no sections at all there is nothing to trust: nothing is greyed', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update({ sections: [], visible: new Set(), ready: true });
    expect(dimmed()).toEqual([]);
  });
});

describe('the greyed blocks, and what the console is told', () => {
  // [r, g, b] of '#rrggbb'
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const neutral = (hex) => Math.max(...rgb(hex)) - Math.min(...rgb(hex)) < 12;
  const brightness = (hex) => rgb(hex).reduce((a, b) => a + b, 0) / 3;
  const first = (name) => overlay().querySelector(`path[data-tmsv-tier="${name}"]`);

  it('has three levels: what has tickets that show is untouched, what the filters hide is softer blue, what has no tickets is a hatched ghost', () => {
    buildMap();
    block('WEST UPPER 1').setAttribute('data-active', 'false'); // the map's own unavailable block
    link = createMapLink({ log: () => {} });
    show('NTHU3');
    const filtered = tier('filtered')[0];
    expect(filtered).toBeDefined();
    // softer blue: the colour half drained and lightened by blends, which leave the white labels (in the picture under the map's shapes) as crisp as they were
    expect(layersOf('filtered', filtered).map((l) => l.style)).toEqual(['mix-blend-mode:saturation', 'mix-blend-mode:screen']);
    expect(layersOf('filtered', filtered).every((l) => neutral(l.fill))).toBe(true);
    // ghost: a pale neutral grey over the map's own unavailable block, hatched
    const inactive = dOf('WEST UPPER 1');
    expect(tier('inactive')).toContain(inactive);
    const ghost = layersOf('inactive', inactive);
    expect(ghost.map((l) => l.layer)).toEqual(['0', 'hatch']);
    expect(neutral(ghost[0].fill)).toBe(true);
    expect(brightness(ghost[0].fill)).toBeGreaterThan(200);
    expect(Number(ghost[0].opacity)).toBeGreaterThan(0.7); // faded labels
    expect(ghost[1].fill).toMatch(/^url\(#tmsv-hatch-\d+\)$/);
    const pattern = overlay().querySelector('defs pattern');
    expect(pattern.getAttribute('id')).toBe(ghost[1].fill.slice(5, -1));
    // cross-hatching: a grid of lines (one running each way across the tile) turned a quarter of the way round
    expect(pattern.getAttribute('patternTransform')).toBe('rotate(45)');
    const lines = Array.from(pattern.querySelectorAll('rect')).map((r) => [Number(r.getAttribute('width')), Number(r.getAttribute('height'))]);
    expect(lines).toHaveLength(2);
    const side = Number(pattern.getAttribute('width'));
    expect(lines.filter(([w, h]) => h === side && w < side / 3)).toHaveLength(1); // across
    expect(lines.filter(([w, h]) => w === side && h < side / 3)).toHaveLength(1); // and down
  });

  it('never tones down or hatches a block the map says is available but no section of ours matches', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update({ sections: realSections, visible: new Set(['NTHU3']), ready: true }); // every section of ours has its block, so NORTH UPPER 2 has nothing of ours
    const unmatched = dOf('NORTH UPPER 2');
    expect(layersOf('filtered', unmatched)).toEqual([]);
    expect(layersOf('inactive', unmatched)).toEqual([]);
    // only the map's own unavailable blocks are hatched
    const hatched = Array.from(overlay().querySelectorAll('path[data-tmsv-layer="hatch"]')).map((p) => p.getAttribute('d'));
    expect(hatched.sort()).toEqual(tier('inactive').sort());
    expect(hatched.length).toBeGreaterThan(0);
  });

  it('hatches everything with no tickets except a block that is the stage', () => {
    buildMap();
    block('WEST UPPER 1').setAttribute('data-active', 'false');
    const stage = block('WEST UPPER 2');
    stage.setAttribute('data-section-name', 'STAGE');
    stage.setAttribute('data-active', 'false');
    link = createMapLink({ log: () => {} });
    show('NTHU3');
    expect(layersOf('inactive', dOf('WEST UPPER 1')).map((l) => l.layer)).toEqual(['0', 'hatch']);
    expect(layersOf('inactive', stage.getAttribute('d')).map((l) => l.layer)).toEqual(['0']); // faded with the rest, never hatched
  });

  it('draws the hatching about the same size on the screen whatever the size of the map', () => {
    buildMap();
    block('WEST UPPER 1').setAttribute('data-active', 'false');
    const svg = host.querySelector('svg');
    const lines = () => Number(overlay().querySelector('defs pattern').getAttribute('width'));
    svg.getBoundingClientRect = () => ({ width: 1000, height: 750, left: 0, top: 0, right: 1000, bottom: 750 });
    link = createMapLink({ log: () => {} });
    show('NTHU3');
    const big = lines();
    svg.getBoundingClientRect = () => ({ width: 250, height: 190, left: 0, top: 0, right: 250, bottom: 190 });
    vi.advanceTimersByTime(1500); // the map is looked at again every second
    expect(lines()).toBeGreaterThan(big * 3); // a quarter the size on the screen: the lines are four times as far apart in the map's own units
  });

  it('always ghosts and cross-hatches the map\'s own unavailable blocks once the list is known, filtered or not (so the levels read the same)', () => {
    buildMap();
    block('WEST UPPER 1').setAttribute('data-active', 'false');
    link = createMapLink({ log: () => {} });
    link.update({ sections: [], visible: new Set(), ready: false }); // nothing known of the list yet: the map is left as it is
    expect(overlay().querySelectorAll('path[data-tmsv-tier]')).toHaveLength(0);
    show(...sections.map((s) => s.name)); // everything shown: nothing is dimmed...
    expect(dimmed()).toEqual([]);
    expect(tier('inactive')).toContain(dOf('WEST UPPER 1')); // ...but the map's own unavailable block is a ghost all the same
    expect(layersOf('inactive', dOf('WEST UPPER 1')).map((l) => l.layer)).toEqual(['0', 'hatch']);
    show('NTHU3');
    expect(layersOf('inactive', dOf('WEST UPPER 1')).map((l) => l.layer)).toEqual(['0', 'hatch']);
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
    expect(summary.sectionsWithoutBlock).toEqual(['UNMAPPED']);
    expect(summary.complete).toBe(false);
  });

  it('says what the API calls the tier of a section with no block, to see why it did not link', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update({
      sections: [{ name: 'ODDBALL1', tickets: [{ section: 'ODDBALL1', originalSection: 'ODDBALL1', description: 'THE ODD TIER' }] }, { name: 'PLAIN', tickets: [{ section: 'PLAIN' }] }],
      visible: new Set(),
      ready: true,
    });
    expect(link.summary().sectionsWithoutBlock).toEqual(['ODDBALL1 ("THE ODD TIER")', 'PLAIN']);
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
    link.update({ sections: [...realSections, { name: 'NOWHERE', tickets: [] }], visible: new Set(['NTHU3']), ready: true });
    expect(log).toHaveBeenCalledTimes(1);
    const text = log.mock.calls[0][0];
    expect(text).toMatch(/^Seat map: 68 blocks, 4 linked to a section of ours, 3 greyed\./);
    expect(text).toMatch(/linked to no section of ours: WEST LOWER 8 \[s_38\]/); // the first few, with their ids
    expect(text).toContain('Sections of ours with no block: NOWHERE.');
    link.update({ sections: [...realSections, { name: 'NOWHERE', tickets: [] }], visible: new Set(['NTHU3']), ready: true });
    expect(log).toHaveBeenCalledTimes(1); // the same again
    link.update({ sections: [...realSections, { name: 'NOWHERE', tickets: [] }], visible: new Set(['NTHU3', 'WESTU1']), ready: true });
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

describe('Auto zoom map off, and the Show on map buttons', () => {
  const eventsOn = (path) => { const got = []; ['mouseover', 'mouseenter', 'click'].forEach((t) => path.addEventListener(t, () => got.push(t))); return got; };

  it('does not zoom by itself when the mouse rests on an open section: it shows the block\'s tooltip, as for a closed one', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.setAutoZoom(false);
    show('NTHU3');
    const events = eventsOn(block('NORTH UPPER 3'));
    link.hover('NTHU3', true);
    vi.advanceTimersByTime(200);
    expect(events).toEqual(['mouseover', 'mouseenter']); // the tooltip's hover, after the short pause
    vi.advanceTimersByTime(2000);
    expect(events).not.toContain('click');
    expect(outlined()).toEqual([dOf('NORTH UPPER 3')]); // and the block is outlined, as ever
  });

  it('zooms by itself again when switched back on', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.setAutoZoom(false);
    link.setAutoZoom(true);
    show('NTHU3');
    const events = eventsOn(block('NORTH UPPER 3'));
    link.hover('NTHU3', true);
    vi.advanceTimersByTime(450);
    expect(events).toEqual(['click']);
  });

  it('forgets a pending zoom when auto zoom is switched off', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    show('NTHU3');
    const events = eventsOn(block('NORTH UPPER 3'));
    link.hover('NTHU3', true);
    link.setAutoZoom(false);
    vi.advanceTimersByTime(1000);
    expect(events).toEqual([]);
  });

  it('showSection opens the map at the section at once, whatever the setting', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.setAutoZoom(false);
    show('NTHU3');
    const events = eventsOn(block('NORTH UPPER 3'));
    link.showSection('NTHU3');
    expect(events).toEqual(['click']); // no pause: it was asked for
  });

  it('showSection on a map that is zoomed in resets it first, then goes to the section', () => {
    buildZoomed();
    zoomOutOnReset();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8', 'NTHM3', 'WESTU1']), ready: true });
    const target = [];
    document.getElementById('main').addEventListener('click', (e) => { if (e.target.getAttribute && e.target.getAttribute('data-section-name') === 'WEST UPPER 1') target.push('clicked'); });
    const reset = [];
    document.getElementById('reset').addEventListener('click', () => reset.push('pressed'));
    link.showSection('WESTU1');
    expect(reset).toEqual(['pressed']);
    vi.advanceTimersByTime(600);
    expect(target).toEqual(['clicked']);
  });

  it('showTicket opens its section and keeps its seats ringed after the mouse has gone', () => {
    buildZoomed();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8']), ready: true });
    link.showTicket(east); // already showing EASTL8 (zoomed in): nothing to open, but ring the seats
    expect(rings()).toEqual([['7807.4', '5568.85'], ['7771.18', '5593.38']]);
    vi.advanceTimersByTime(5000);
    expect(rings()).toHaveLength(2); // stays
    link.hoverTicket(null);
    expect(rings()).toHaveLength(2); // the mouse leaving a ticket does not take the shown ticket away
  });

  it('rings both the shown ticket and the one the mouse is on', () => {
    buildZoomed();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8']), ready: true });
    link.showTicket(east);
    link.hoverTicket({ section: 'EASTL8', rowName: 'K', seatFrom: '141', seatTo: '141' });
    expect(rings()).toHaveLength(3);
    link.hoverTicket(null);
    expect(rings()).toHaveLength(2);
  });

  it('showing another ticket, or a section, replaces what was shown', () => {
    buildZoomed();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8']), ready: true });
    link.showTicket(east);
    link.showTicket({ section: 'EASTL8', rowName: 'K', seatFrom: '142', seatTo: '142' });
    expect(rings()).toEqual([['7808.36', '5652.27']]);
    link.showSection('EASTL8');
    expect(rings()).toEqual([]);
  });

  it('forgets the shown ticket when the map is zoomed out', () => {
    buildZoomed();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8']), ready: true });
    link.showTicket(east);
    expect(rings()).toHaveLength(2);
    vi.advanceTimersByTime(1100); // the map is seen zoomed in, with the ticket shown
    zoomOutOnReset();
    document.getElementById('reset').click(); // the user zooms the map out
    vi.advanceTimersByTime(1100);
    expect(document.querySelectorAll('g[data-tmsv-overlay] circle')).toHaveLength(0);
    // and a ticket shown later is not ringed by the old one's seats
    link.hoverTicket(null);
    expect(document.querySelectorAll('g[data-tmsv-overlay] circle')).toHaveLength(0);
  });
});

describe('acting on the map as it is now, not as it was at the last look', () => {
  it('a button pressed straight after the map zoomed in (between two looks) still resets it first', () => {
    buildMap(); // what the adapter has seen: the overview
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8', 'NTHM3', 'WESTU1']), ready: true });
    buildZoomed(); // ...then the map zooms in, and no second has passed
    zoomOutOnReset();
    const reset = [];
    document.getElementById('reset').addEventListener('click', () => reset.push('pressed'));
    const target = [];
    document.getElementById('main').addEventListener('click', (e) => { if (e.target.getAttribute && e.target.getAttribute('data-section-name') === 'WEST UPPER 1') target.push('clicked'); });
    link.showSection('WESTU1');
    expect(reset).toEqual(['pressed']);
    vi.advanceTimersByTime(600);
    expect(target).toEqual(['clicked']);
  });

  it('a hover straight after the map zoomed out is not taken for a zoomed map', () => {
    buildZoomed();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8', 'NTHM3', 'WESTU1']), ready: true });
    buildMap(); // the user zoomed out: the overview is back, and no second has passed
    const seen = [];
    block('WEST UPPER 1').addEventListener('mouseover', () => seen.push('over'));
    link.update({ sections: sections, visible: new Set(['NTHU3']), ready: true });
    link.hover('WESTU1', false);
    vi.advanceTimersByTime(200);
    expect(seen).toEqual(['over']); // the tooltip: only an overview shows one
  });
});

describe('the Map report on a zoomed map', () => {
  it('says which blocks have seats drawn, and how many of them are on sale: to tell whether the map itself knows what is available where', () => {
    buildZoomed();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(['EASTL8']), ready: true });
    const maps = link.diagnose().maps;
    const main = maps.find((m) => m.seatsDrawn > 0);
    expect(main.seatBlocks).toEqual(['EASTL8: 4 on sale of 5', 'NTHM3: 0 on sale of 1']);
  });
});

describe('when the filters leave nothing of ours but the map shows blocks the list lacks', () => {
  const tickets = picksToTickets(real, { currency: '€' });
  const nothing = (extra = {}) => ({ sections: realSections, visible: new Set(), matching: [], ready: true, ...extra });
  const candidates = () => Array.from(overlay().querySelectorAll('path[data-tmsv-candidate]')).map((p) => p.getAttribute('d'));

  it('outlines those blocks (dashed), so there is something to point at: the rest are dimmed and these are not', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update(nothing());
    expect(link.summary().complete).toBe(true);
    expect(candidates().length).toBe(link.summary().unlisted);
    expect(candidates().length).toBeGreaterThan(0);
    expect(candidates()).toContain(dOf('NORTH UPPER 2')); // available on the map, not in the list
    expect(dimmed()).not.toContain(dOf('NORTH UPPER 2'));
    expect(candidates()).not.toContain(dOf('NORTH UPPER 3')); // in the list (and dimmed)
    expect(candidates()).not.toContain(dOf('SWEST')); // the map greys that one itself
    expect(overlay().querySelector('path[data-tmsv-candidate]').getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('does not while something of ours matches (the matched blocks are the point then)', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update(nothing({ visible: new Set(['NTHU3']), matching: tickets.filter((t) => t.section === 'NTHU3') }));
    expect(candidates()).toEqual([]);
  });

  it('does not while some section of ours has no block (a block with no section may be that very section)', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update(nothing({ sections: [...realSections, { name: 'ODDLY_NAMED', tickets: [] }] }));
    expect(candidates()).toEqual([]);
    expect(link.summary().unlisted).toBe(0);
  });

  it('does not with nothing known of the list, nor when the map link is off', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update({ sections: [], visible: new Set(), matching: [], ready: false });
    expect(candidates()).toEqual([]);
    link.update(nothing());
    expect(candidates().length).toBeGreaterThan(0);
    link.setEnabled(false);
    expect(document.querySelectorAll('path[data-tmsv-candidate]')).toHaveLength(0);
  });

  it('leaves out of them a block of seats when only Standing shows (that one is dimmed: nothing at a seat can match)', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update(nothing({ standingOnly: true }));
    expect(candidates()).not.toContain(dOf('NORTH UPPER 2'));
    expect(dimmed()).toContain(dOf('NORTH UPPER 2'));
  });

  it('says in the summary how many of the blocks the list lacks could be a place to stand', () => {
    buildMap();
    host.querySelector('svg g.polygons').insertAdjacentHTML('beforeend', '<path data-component="svg__section" data-section-id="s_900" data-section-name="THE PIT" data-active="true" d="M900 0L900 10z"></path>');
    link = createMapLink({ log: () => {} });
    link.update(nothing());
    const summary = link.summary();
    expect(summary.unlistedMayBeStanding).toBe(1); // THE PIT; the numbered blocks are seats
    expect(summary.unlisted).toBeGreaterThan(1);
  });
});

describe('with the map\'s own seat data', () => {
  // Real excerpts of The O2 Belfast's seat map data (tests/fixtures): NORTH LOWER 1 (s_5, rows C F G J), EAST LOWER 8 (s_22), NORTH MIDDLE 3 (s_79,
  // groups of 3 in rows M and N), NORTH MIDDLE 4 (s_78), WEST UPPER 1 (s_49: one resale seat), the standing floor (s_112), NORTH MIDDLE 5 (s_77: nothing).
  const fixture = (name) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures', name), 'utf8'));
  const geometry = parseGeometry(fixture('o2-map-geometry.json'));
  const availability = buildAvailability(geometry, parseFacets(fixture('o2-map-facets.json')));
  const off = { seat: 'all', quality: 'any', price: 'any', show: [], hide: [], search: '', firstRows: [1], frontRows: 5, quantity: 2 };
  // The list has NTHU3, the standing floor, WESTU1 and WESTU7; with NTHL1 added it has a section for NORTH LOWER 1 too.
  const nthl1 = { name: 'NTHL1', tickets: [{ section: 'NTHL1', originalSection: 'NTHL1', description: 'NORTH LOWER TIER' }] };
  const state = (extra = {}, filters = {}) => ({ sections: [...realSections, nthl1], visible: new Set(), matching: [], ready: true, filters: { ...off, ...filters }, ...extra });
  const candidates = () => Array.from(overlay().querySelectorAll('path[data-tmsv-candidate]')).map((p) => p.getAttribute('d'));
  const start = () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.setMapData({ geometry, availability });
  };

  it('leaves the map as it is while nothing is filtered, as ever', () => {
    start();
    link.update(state({ visible: new Set(['NTHL1', 'NTHU3', "STANDING-OVER 14'S ONLY", 'WESTU1', 'WESTU7']) }));
    expect(dimmed()).toEqual([]);
    expect(candidates()).toEqual([]);
  });

  it('judges every block by its own seats once something is filtered: a block with no seat on sale that passes is dimmed, listed or not', () => {
    start();
    link.update(state({}, { seat: 'frontrows', frontRows: 5 })); // rows A-E of a tier: only NORTH LOWER 1 (row C) has any on sale
    expect(dimmed()).toContain(dOf('EAST LOWER 8')); // not in the list; its seats are in rows G-K
    expect(dimmed()).toContain(dOf('NORTH MIDDLE 3', 's_79')); // not in the list: groups of 3 in rows M and N
    expect(dimmed()).toContain(dOf('NORTH MIDDLE 4'));
    expect(dimmed()).toContain(dOf('WEST UPPER 1')); // in the list, as a resale seat in row U
    expect(dimmed()).toContain(dOf('GROUND FLOOR STANDING', 's_112')); // standing has no row
  });

  it('NEVER dims a block whose seats on sale pass, even though the list has no ticket to show there: it spares and outlines it', () => {
    start();
    link.update(state({}, { seat: 'frontrows', frontRows: 5 }));
    expect(dimmed()).not.toContain(dOf('NORTH LOWER 1')); // the list has tickets there, none in the front rows: the map has row C
    expect(candidates()).toEqual([dOf('NORTH LOWER 1')]);
  });

  it('does not outline a block the list shows tickets for', () => {
    start();
    link.update(state({ visible: new Set(['NTHL1']) }, { seat: 'frontrows', frontRows: 5 }));
    expect(candidates()).toEqual([]);
    expect(dimmed()).not.toContain(dOf('NORTH LOWER 1'));
  });

  it('respects the quantity: a block whose seats are in groups of 3 has nothing for 4, so it is dimmed', () => {
    start();
    link.update(state({}, { search: 'nthm', quantity: 2 }));
    expect(dimmed()).not.toContain(dOf('NORTH MIDDLE 3', 's_79')); // pairs fit in a group of 3
    link.update(state({}, { search: 'nthm', quantity: 3 }));
    expect(dimmed()).not.toContain(dOf('NORTH MIDDLE 3', 's_79'));
    expect(dimmed()).toContain(dOf('NORTH MIDDLE 4')); // two seats
    link.update(state({}, { search: 'nthm', quantity: 4 }));
    expect(dimmed()).toContain(dOf('NORTH MIDDLE 3', 's_79'));
  });

  it('follows the venue\'s tiers, as the list does: row M is the first row of the middle tier when it starts there', () => {
    start();
    link.update(state({}, { seat: 'firstrow', firstRows: ['A', 'M', 'S'] }));
    expect(dimmed()).not.toContain(dOf('NORTH MIDDLE 3', 's_79'));
    expect(dimmed()).toContain(dOf('NORTH LOWER 1')); // row C is the 3rd of the lower tier
    expect(candidates()).toEqual([dOf('NORTH MIDDLE 3', 's_79')]);
  });

  it('shows only resale: the block with a resale seat for one (not for two together), and the floor\'s resale tickets', () => {
    start();
    link.update(state({}, { show: ['resale'], quantity: 1 }));
    expect(dimmed()).not.toContain(dOf('WEST UPPER 1'));
    expect(dimmed()).not.toContain(dOf('GROUND FLOOR STANDING', 's_112'));
    expect(dimmed()).toContain(dOf('NORTH LOWER 1'));
    link.update(state({}, { show: ['resale'], quantity: 2 }));
    expect(dimmed()).toContain(dOf('WEST UPPER 1'));
  });

  it('spares a block when it cannot judge a filter that is on (it never says "none" because of what it cannot see), but still dims what fails the rest', () => {
    start();
    link.update(state({}, { quality: 'top10', seat: 'frontrows', frontRows: 5 }));
    expect(dimmed()).not.toContain(dOf('NORTH LOWER 1'));
    expect(dimmed()).toContain(dOf('EAST LOWER 8'));
    expect(link.summary().exact).toBe(false);
  });

  it('tells the summary what it found', () => {
    start();
    link.update(state({}, { seat: 'frontrows', frontRows: 5 }));
    expect(link.summary()).toMatchObject({ hasData: true, exact: true, filtered: true, mapOnlyBlocks: 1, mapOnlySeats: 3 });
    expect(link.summary().veiled).toBeGreaterThan(3);
    link.update(state({ visible: new Set(['NTHU3']) }, {}));
    expect(link.summary()).toMatchObject({ hasData: true, filtered: false, mapOnlyBlocks: 0 });
  });

  it('counts the blocks the list has nothing for from the geometry, whether or not every section has its block', () => {
    start();
    link.update(state({ visible: new Set(['NTHL1', 'NTHU3', "STANDING-OVER 14'S ONLY", 'WESTU1', 'WESTU7']), sections: [...realSections, nthl1, { name: 'ODDLY_NAMED', tickets: [] }] }, {}));
    expect(link.summary().complete).toBe(false);
    expect(link.summary().unlisted).toBe(3); // EAST LOWER 8, NORTH MIDDLE 3 and NORTH MIDDLE 4: seats on sale, nothing in the list
  });

  it('says whether a pill would find anything on the map, with everything else as it is', () => {
    start();
    link.update(state({}, { quantity: 1 }));
    expect(link.canMatch('other', 'resale')).toBe(true);
    expect(link.canMatch('other', 'standing')).toBe(true);
    expect(link.canMatch('seat', 'firstrow')).toBe(false); // no row A on sale in these blocks
    expect(link.canMatch('seat', 'frontrows')).toBe(true);
    expect(link.canMatch('quality', 'top10')).toBe(true); // cannot judge: maybe
    link.update(state({}, { quantity: 1, show: ['standing'] }));
    expect(link.canMatch('other', 'resale')).toBe(true); // resale standing
    expect(link.canMatch('seat', 'frontrows')).toBe(false); // standing has no row
  });

  it('has no opinion without its data', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update(state({}, { seat: 'frontrows' }));
    expect(link.canMatch('seat', 'frontrows')).toBeUndefined();
    expect(link.summary().hasData).toBe(false);
  });

  it('says in the Map report what it knows of each block', () => {
    start();
    link.update(state({}, { seat: 'frontrows', frontRows: 5 }));
    const blocks = Object.fromEntries(link.diagnose().blocks.map((b) => [b.id, b]));
    expect(blocks.s_79).toMatchObject({ map: { seatsOnSale: 10, passing: 0 } });
    expect(blocks.s_79.state).toMatch(/^toned down \(no seat on sale there passes the filters\)/);
    expect(blocks.s_5).toMatchObject({ map: { seatsOnSale: 10, passing: 2 } }); // two pairs from the three seats of row C
    expect(blocks.s_5.state).toMatch(/^shown \(the map has seats on sale that pass the filters; the list has none to show\)/);
    expect(blocks.s_112.map).toMatchObject({ standingOnSale: 822 });
    expect(link.diagnose().mapData.availability.seatsOnSale).toBe(50);
  });

  describe('on the zoomed map', () => {
    // NORTH MIDDLE 3 as the real map draws it when zoomed: the seats of rows M and N, those on sale marked with a type.
    const seat = (n, x, y, sale) => `<circle data-component="svg__seat" ${sale ? 'type="primary"' : ''} data-seat-name="${n}" cx="${x}" cy="${y}" r="17"></circle>`;
    const rowM = [38, 39, 40, 41, 42, 43, 44, 45, 46, 47].map((n) => seat(n, n * 10, 100, [38, 39, 40, 43, 44, 45, 47].includes(n))).join('');
    const rowN = [39, 40, 41, 42].map((n) => seat(n, n * 10, 200, [39, 40, 41].includes(n))).join('');
    const buildSeats = () => {
      document.body.innerHTML = '<svg id="main" data-component="svg" viewBox="0 0 10240 7680"><g class="seats"><g data-component="svg__block" data-section-name="NTHM3" data-section-id="s_79"><g data-row-name="M">' + rowM + '</g><g data-row-name="N">' + rowN + '</g></g></g><g class="polygons"><path data-component="svg__section" data-section-id="s_79" data-section-name="NORTH MIDDLE 3" data-active="true" d="M1 1L2 2z"></path></g></svg>' +
        '<svg id="mini" data-component="svg" viewBox="0 0 10240 7680"><g class="seats"></g><g class="polygons">' + o2.blocks.map((b, i) => `<path data-component="svg__section" data-section-id="${b.id}" data-section-name="${b.name}" data-active="${b.active}" d="M${i} 0L${i} 10z"></path>`).join('') + '</g></svg>';
      document.getElementById('main').getBoundingClientRect = () => ({ left: 0, top: 0, width: 10234, height: 9593 });
      document.getElementById('mini').getBoundingClientRect = () => ({ left: 0, top: 0, width: 209, height: 196 });
      link = createMapLink({ log: () => {} });
      link.setMapData({ geometry, availability });
    };
    const greyed = () => Array.from(document.querySelectorAll('#main > g[data-tmsv-overlay] circle[fill="#8c8f99"]')).map((c) => c.getAttribute('cx') + ',' + c.getAttribute('cy'));
    const at = (n, row) => `${n * 10},${row === 'M' ? 100 : 200}`;

    it('greys nothing while nothing is filtered', () => {
      buildSeats();
      link.update(state({}, {}));
      expect(greyed()).toEqual([]);
    });

    it('greys the seats on sale that are in no group of the quantity that passes: the lone seat, and a row that is not the first', () => {
      buildSeats();
      link.update(state({}, { seat: 'firstrow', firstRows: ['A', 'M', 'S'] })); // row M is first; pairs in 38-40 and 43-45
      expect(greyed().sort()).toEqual([at(47, 'M'), at(39, 'N'), at(40, 'N'), at(41, 'N')].sort()); // seat 47 on its own; row N is the 2nd row
    });

    it('leaves a seat the list has no ticket for blue when it passes: the list is the one that leaves seats out', () => {
      buildSeats();
      link.update(state({}, { seat: 'firstrow', firstRows: ['A', 'M', 'S'] })); // the list has nothing for NTHM3 at all
      expect(greyed()).not.toContain(at(38, 'M'));
      expect(greyed()).not.toContain(at(44, 'M'));
    });

    it('greys by the quantity: for 3 only the whole groups of 3 stay blue', () => {
      buildSeats();
      link.update(state({}, { seat: 'frontrows', firstRows: ['A', 'M', 'S'], frontRows: 5, quantity: 3 }));
      expect(greyed()).toEqual([at(47, 'M')]); // M38-40, M43-45 and N39-41 are groups of 3
    });

    it('greys every seat on sale when only Standing shows (no group of seats passes)', () => {
      buildSeats();
      link.update(state({ standingOnly: true }, { show: ['standing'] }));
      expect(greyed()).toHaveLength(10); // all ten seats on sale; the seats not on sale are left as the map draws them
    });
  });
});

describe('when only Standing tickets are showing', () => {
  // The map has blocks of seats (numbered), the floor (a standing block) and ones we can't tell about. Nothing at a seat can match.
  const tickets = picksToTickets(real, { currency: '€' });
  const standingState = (extra = {}) => ({ sections: realSections, visible: new Set(["STANDING-OVER 14'S ONLY"]), matching: tickets.filter((t) => t.section === "STANDING-OVER 14'S ONLY"), standingOnly: true, ready: true, ...extra });

  it('dims a block we can tell is a block of seats even though the list has no ticket for it (a standing ticket is never for a seat)', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update(standingState());
    expect(link.summary().complete).toBe(true);
    expect(dimmed()).toContain(dOf('NORTH UPPER 2')); // numbered, not in the list, available on the map: seats
    expect(dimmed()).toContain(dOf('NORTH UPPER 3')); // linked, its tickets are out anyway
    expect(dimmed()).not.toContain(dOf('GROUND FLOOR STANDING', 's_112')); // the standing block shows
  });

  it('leaves a block it cannot tell is seats alone: not knowing is not "no standing here"', () => {
    buildMap();
    host.querySelector('svg g.polygons').insertAdjacentHTML('beforeend', '<path data-component="svg__section" data-section-id="s_900" data-section-name="THE PIT" data-active="true" d="M900 0L900 10z"></path><path data-component="svg__section" data-section-id="s_901" data-section-name="ARENA" data-active="true" d="M901 0L901 10z"></path>');
    link = createMapLink({ log: () => {} });
    link.update(standingState());
    expect(dimmed()).not.toContain('M900 0L900 10z'); // says pit
    expect(dimmed()).not.toContain('M901 0L901 10z'); // no number, no way to tell
  });

  it('does not do any of it unless only Standing tickets are showing', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update(standingState({ standingOnly: false }));
    expect(dimmed()).not.toContain(dOf('NORTH UPPER 2')); // the list lacks it: left as the map draws it
  });

  it('says so in the summary: the blocks dimmed for it are not counted as ones the list lacks', () => {
    buildMap();
    link = createMapLink({ log: () => {} });
    link.update(standingState({ standingOnly: false }));
    const lacked = link.summary().unlisted;
    expect(lacked).toBeGreaterThan(0);
    link.update(standingState());
    expect(link.summary()).toMatchObject({ standingOnly: true });
    expect(link.summary().unlisted).toBeLessThan(lacked);
    expect(link.summary().veiled).toBeGreaterThan(3);
    expect(link.diagnose().blocks.find((b) => b.name === 'NORTH UPPER 2').state).toMatch(/^toned down \(only Standing tickets are showing, and this is a block of seats/);
  });

  it('greys EVERY seat on sale on the zoomed map, listed or not (none is a standing ticket)', () => {
    buildZoomed();
    link = createMapLink({ log: () => {} });
    link.update({ sections: eastSections, visible: new Set(), matching: [], standingOnly: true, ready: true });
    const greyed = Array.from(document.querySelectorAll('#main > g[data-tmsv-overlay] circle[fill="#8c8f99"]')).map((c) => [c.getAttribute('cx'), c.getAttribute('cy')]);
    expect(greyed).toHaveLength(4); // the four seats of EASTL8 that are on sale; the two not on sale are left as the map draws them
    link.update({ sections: eastSections, visible: new Set(), matching: [], standingOnly: false, ready: true });
    expect(document.querySelectorAll('#main > g[data-tmsv-overlay] circle[fill="#8c8f99"]')).toHaveLength(0); // no ticket of ours covers them: not known
  });
});

describe('seats on the zoomed map and the tickets of our list', () => {
  // The zoomed map of buildZoomed(): EASTL8 row J seats 141 142 (on sale), 143 (not); row K 141 142 (on sale); NTHM3 row P seat 36 (not).
  const ticketJ = { id: 'tj', section: 'EASTL8', originalSection: 'EASTL8', rowName: 'J', seatFrom: '141', seatTo: '142', type: 'standard' };
  const ticketK = { id: 'tk', section: 'EASTL8', originalSection: 'EASTL8', rowName: 'K', seatFrom: '141', seatTo: '142', type: 'standard' };
  const allTickets = [ticketJ, ticketK];
  const stateFor = (matching, ready = true) => ({ sections: [{ name: 'EASTL8', tickets: allTickets }], visible: new Set(matching.length ? ['EASTL8'] : []), matching, ready });
  const seat = (id) => document.getElementById(id);
  const greyed = () => Array.from(document.querySelectorAll('#main > g[data-tmsv-overlay] circle[fill="#8c8f99"]')).map((c) => [c.getAttribute('cx'), c.getAttribute('cy')]);
  const mouse = (el, type, related = null) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: related }));

  describe('greyed when the filters leave them out', () => {
    it('greys the on-sale seats whose ticket is filtered out, and only those', () => {
      buildZoomed();
      link = createMapLink({ log: () => {} });
      link.update(stateFor([ticketJ])); // row K's ticket is filtered out
      expect(greyed()).toEqual([['7843.65', '5628.51'], ['7808.36', '5652.27']]);
    });

    it('leaves alone seats not on sale, and on-sale seats we know nothing of (not knowing is not "filtered out")', () => {
      buildZoomed();
      document.querySelector('#main g[data-row-name="J"]').insertAdjacentHTML('beforeend', '<circle data-component="svg__seat" id="stranger" type="primary" data-seat-name="199" cx="1" cy="2" r="17.5"></circle>');
      link = createMapLink({ log: () => {} });
      link.update(stateFor([ticketJ]));
      expect(greyed()).not.toContainEqual(['1', '2']); // on sale, no ticket of ours covers it
      expect(greyed()).not.toContainEqual(['7734.27', '5616.27']); // seat 143: not on sale (no type), and no ticket
      expect(greyed()).toHaveLength(2);
    });

    it('greys nothing when the filters leave every ticket', () => {
      buildZoomed();
      link = createMapLink({ log: () => {} });
      link.update(stateFor(allTickets));
      expect(greyed()).toEqual([]);
    });

    it('greys the seat of a ticket that has loaded and is filtered out at once, while the rest loads', () => {
      buildZoomed();
      link = createMapLink({ log: () => {} });
      link.update(stateFor([ticketJ], false)); // still loading: row K has loaded, and is filtered out
      expect(greyed()).toHaveLength(2);
      link.update(stateFor([ticketJ], true));
      expect(greyed()).toHaveLength(2);
    });

    it('leaves alone the seats whose tickets have not loaded yet', () => {
      buildZoomed();
      link = createMapLink({ log: () => {} });
      // only row J has loaded so far: row K's seats are on sale on the map, but we know nothing of them yet
      link.update({ sections: [{ name: 'EASTL8', tickets: [ticketJ] }], visible: new Set(['EASTL8']), matching: [ticketJ], ready: false });
      expect(greyed()).toEqual([]);
      link.update({ sections: [{ name: 'EASTL8', tickets: [ticketJ, ticketK] }], visible: new Set(['EASTL8']), matching: [ticketJ], ready: false }); // row K arrives, filtered out
      expect(greyed()).toHaveLength(2);
    });

    it('follows the filters as they change', () => {
      buildZoomed();
      link = createMapLink({ log: () => {} });
      link.update(stateFor([ticketJ]));
      expect(greyed()).toHaveLength(2);
      link.update(stateFor([ticketK])); // now row J is the one left out
      expect(greyed()).toEqual([['7807.4', '5568.85'], ['7771.18', '5593.38']]);
      link.update(stateFor(allTickets));
      expect(greyed()).toEqual([]);
    });

    it('covers the seat exactly and never takes the mouse from it', () => {
      buildZoomed();
      link = createMapLink({ log: () => {} });
      link.update(stateFor([ticketJ]));
      const cover = document.querySelector('#main > g[data-tmsv-overlay] circle[fill="#8c8f99"]');
      expect(cover.getAttribute('r')).toBe('17.5');
      expect(cover.getAttribute('pointer-events')).toBe('none');
    });

    it('does not do it on an overview, whatever seats it holds', () => {
      const svg = buildMap();
      svg.querySelector('g.seats').innerHTML = '<g data-component="svg__block" data-section-name="EASTL8"><g data-row-name="K"><circle data-component="svg__seat" type="primary" data-seat-name="141" cx="9" cy="9" r="17.5"></circle></g></g>';
      link = createMapLink({ log: () => {} });
      link.update(stateFor([ticketJ]));
      expect(document.querySelectorAll('circle[fill="#8c8f99"]')).toHaveLength(0);
    });

    it('does nothing for tickets without seats (standing), or with no row', () => {
      buildZoomed();
      link = createMapLink({ log: () => {} });
      const standing = { id: 'st', section: 'STAND', rowName: null, seatFrom: null, seatTo: null };
      link.update({ sections: [{ name: 'STAND', tickets: [standing] }], visible: new Set(), matching: [], ready: true });
      expect(greyed()).toEqual([]);
    });
  });

  describe('the mouse on a seat', () => {
    it('says which ticket it is, and when the mouse goes off it', () => {
      buildZoomed();
      const onSeatHover = vi.fn();
      link = createMapLink({ log: () => {}, onSeatHover });
      link.update(stateFor(allTickets));
      mouse(seat('a1'), 'mouseover');
      expect(onSeatHover).toHaveBeenLastCalledWith(ticketJ);
      mouse(seat('a1'), 'mouseout', document.body);
      expect(onSeatHover).toHaveBeenLastCalledWith(null);
      expect(onSeatHover).toHaveBeenCalledTimes(2);
    });

    it('says it once for a ticket of two seats, whichever of them the mouse is on, and again for another ticket', () => {
      buildZoomed();
      const onSeatHover = vi.fn();
      link = createMapLink({ log: () => {}, onSeatHover });
      link.update(stateFor(allTickets));
      mouse(seat('a1'), 'mouseover');
      mouse(seat('a1'), 'mouseout', seat('a2')); // straight on to its other seat
      mouse(seat('a2'), 'mouseover');
      expect(onSeatHover.mock.calls.map((c) => c[0])).toEqual([ticketJ]);
      mouse(seat('a2'), 'mouseout', seat('b1'));
      mouse(seat('b1'), 'mouseover');
      expect(onSeatHover.mock.calls.map((c) => c[0])).toEqual([ticketJ, ticketK]);
    });

    it('says nothing for a seat whose ticket the filters leave out, or that we know nothing of', () => {
      buildZoomed();
      const onSeatHover = vi.fn();
      link = createMapLink({ log: () => {}, onSeatHover });
      link.update(stateFor([ticketJ]));
      mouse(seat('b1'), 'mouseover'); // row K: filtered out
      mouse(seat('a3'), 'mouseover'); // 143: no ticket
      expect(onSeatHover).not.toHaveBeenCalled();
    });

    it('does not take a seat of the overview for one of the zoomed map', () => {
      const svg = buildMap();
      svg.querySelector('g.seats').innerHTML = '<g data-component="svg__block" data-section-name="EASTL8"><g data-row-name="J"><circle id="tiny" data-component="svg__seat" type="primary" data-seat-name="141" cx="9" cy="9" r="17.5"></circle></g></g>';
      const onSeatHover = vi.fn();
      link = createMapLink({ log: () => {}, onSeatHover });
      link.update(stateFor(allTickets));
      mouse(document.getElementById('tiny'), 'mouseover');
      expect(onSeatHover).not.toHaveBeenCalled();
    });

    it('says which ticket a clicked seat is, and leaves the map\'s own handling of the click alone', () => {
      const { main } = buildZoomed();
      const theirs = vi.fn();
      main.addEventListener('click', theirs);
      const onSeatClick = vi.fn();
      link = createMapLink({ log: () => {}, onSeatClick });
      link.update(stateFor([ticketJ]));
      mouse(seat('a1'), 'click');
      expect(onSeatClick).toHaveBeenCalledWith(ticketJ);
      expect(theirs).toHaveBeenCalledTimes(1);
      mouse(seat('b1'), 'click'); // filtered out
      expect(onSeatClick).toHaveBeenCalledTimes(1);
    });

    it('does not hear itself: what we send the map is ours', () => {
      buildZoomed();
      const onSeatHover = vi.fn();
      const onSeatClick = vi.fn();
      link = createMapLink({ log: () => {}, onSeatHover, onSeatClick });
      link.update(stateFor(allTickets));
      ['mouseover', 'click'].forEach((type) => { const e = new MouseEvent(type, { bubbles: true }); e.tmsv = true; seat('a1').dispatchEvent(e); });
      expect(onSeatHover).not.toHaveBeenCalled();
      expect(onSeatClick).not.toHaveBeenCalled();
    });

    it('works with no handlers (a host with no list)', () => {
      buildZoomed();
      link = createMapLink({ log: () => {} });
      link.update(stateFor(allTickets));
      expect(() => { mouse(seat('a1'), 'mouseover'); mouse(seat('a1'), 'mouseout', document.body); mouse(seat('a1'), 'click'); }).not.toThrow();
    });
  });
});

describe('knowing whether the page has an interactive map', () => {
  it('says so, and tells when that changes', () => {
    document.body.innerHTML = '<p>no map yet</p>';
    const onPresence = vi.fn();
    link = createMapLink({ onPresence, log: () => {} });
    expect(link.present()).toBe(false);
    expect(onPresence).not.toHaveBeenCalled();
    buildMap();
    vi.advanceTimersByTime(1100);
    expect(link.present()).toBe(true);
    expect(onPresence).toHaveBeenLastCalledWith(true);
    document.body.innerHTML = '<p>gone</p>';
    vi.advanceTimersByTime(1100);
    expect(link.present()).toBe(false);
    expect(onPresence).toHaveBeenLastCalledWith(false);
    expect(onPresence).toHaveBeenCalledTimes(2);
  });

  it('says so at once when the map is there to begin with', () => {
    buildMap();
    const onPresence = vi.fn();
    link = createMapLink({ onPresence, log: () => {} });
    expect(onPresence).toHaveBeenCalledWith(true);
  });

  it('says there is none when switched off', () => {
    buildMap();
    const onPresence = vi.fn();
    link = createMapLink({ onPresence, log: () => {} });
    link.setEnabled(false);
    expect(link.present()).toBe(false);
    expect(onPresence).toHaveBeenLastCalledWith(false);
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
