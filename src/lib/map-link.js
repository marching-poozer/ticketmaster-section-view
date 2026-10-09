// Linking the blocks on a venue's seat map to the sections in our list.
//
// Ticketmaster's interactive map is one <svg> whose blocks are invisible paths:
//   <path data-component="svg__section" data-section-id="s_38" data-section-name="WEST LOWER 8" data-active="true" d="...">
// while the list API calls the same block "WESTL8" (and gives its description, "WEST LOWER TIER"). So a block
// and a section are linked by what they have in common, whichever way the venue names things:
//   - the same name, spelled alike or not ("WESTT7" is "WESTT7"; spaces and punctuation don't count);
//   - the description plus the section's number ("WEST LOWER TIER" + "WESTL8" -> "WEST LOWER 8");
//   - the block's id, which a standing pick's snapshot picture gives ("segmentIds=s_112" is block "s_112").
// Pure: no page, no map. content/map.js does the drawing.

/** A name for comparing: upper case letters and digits only ("West Lower 8" and "WESTLOWER8" are one). */
export function keyOf(value) {
  return String(value == null ? '' : value).toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

/** The keys a block on the map answers to: its name and its id. */
export function blockKeys(block) {
  return [keyOf(block.name), keyOf(block.id)].filter(Boolean);
}

/** The digits a section name ends with ("WESTL8" -> "8"; "STANDING" -> ""). */
function trailingNumber(name) {
  const match = /(\d+)\s*$/.exec(String(name == null ? '' : name));
  return match ? match[1] : '';
}

/**
 * What a section can be called on the map, from its tickets: its own name, the id of the block its standing
 * picture names, and the description with the section's number ("WEST LOWER" + "8"). Each key says how strong it is:
 * { key, weight }: an id match is certain, a name is nearly, a description-built name is good.
 */
export function sectionKeys(name, tickets) {
  const keys = new Map();
  const add = function (key, weight) {
    if (key && (!keys.has(key) || keys.get(key) < weight)) keys.set(key, weight);
  };
  add(keyOf(name), 3);
  const number = trailingNumber(name);
  (tickets || []).forEach(function (t) {
    add(keyOf(t.originalSection), 3);
    add(keyOf(t.segmentId), 4);
    const description = String(t.description || '').replace(/\btier\b/i, '').trim();
    if (description) {
      add(keyOf(description + ' ' + (trailingNumber(t.originalSection || t.section) || number)), 2);
      if (!number) add(keyOf(description), 1);
    }
  });
  return Array.from(keys, function (entry) { return { key: entry[0], weight: entry[1] }; });
}

/**
 * Link blocks to sections. `blocks`: [{ id, name }]. `sections`: [{ name, tickets }] (every section, whatever the filters
 * leave in it). Returns { blockToSection: Map(block index -> section name), sectionToBlocks: Map(section name -> [block index]) }.
 * A block takes the section that matches it best; a block nothing matches is left out; several blocks may be one section.
 */
export function linkBlocks(blocks, sections) {
  const bySection = sections.map(function (s) { return { name: s.name, keys: sectionKeys(s.name, s.tickets) }; });
  const blockToSection = new Map();
  const sectionToBlocks = new Map();
  blocks.forEach(function (block, index) {
    const mine = new Set(blockKeys(block));
    let best = null;
    let bestScore = 0;
    bySection.forEach(function (section) {
      const score = section.keys.reduce(function (sum, k) { return mine.has(k.key) ? Math.max(sum, k.weight) : sum; }, 0);
      if (score > bestScore) {
        best = section;
        bestScore = score;
      }
    });
    if (best) {
      blockToSection.set(index, best.name);
      if (!sectionToBlocks.has(best.name)) sectionToBlocks.set(best.name, []);
      sectionToBlocks.get(best.name).push(index);
    }
  });
  return { blockToSection, sectionToBlocks };
}

/** The sections of a list of tickets, in order of first appearance: [{ name, tickets }]. VIP packages are not on the map. */
export function sectionsOf(tickets) {
  const order = [];
  const byName = new Map();
  tickets.forEach(function (t) {
    if (t.type === 'vip') return;
    if (!byName.has(t.section)) {
      byName.set(t.section, { name: t.section, tickets: [] });
      order.push(t.section);
    }
    byName.get(t.section).tickets.push(t);
  });
  return order.map(function (name) { return byName.get(name); });
}

/**
 * Which blocks to dim: those the map says are available (`active`) whose section has no ticket left after the filters.
 * Blocks with no section (the map and the list name things differently) are never dimmed: not knowing is not "empty".
 * `visible`: the names of the sections that still show tickets.
 */
export function blocksToDim(blocks, links, visible) {
  const dim = [];
  blocks.forEach(function (block, index) {
    const section = links.blockToSection.get(index);
    if (section !== undefined && block.active !== false && !visible.has(section)) dim.push(index);
  });
  return dim;
}
