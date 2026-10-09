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
 * Is a section code the abbreviation of a block's name? "NTHM3" is "NORTH MIDDLE 3": the code's letters are shared out among
 * the name's words in order, each word giving its first letter and, after it, any more of its letters in order
 * (NORTH gives N-T-H, MIDDLE gives M), and the number at the end is the same. At least two words, so a code is not
 * "found" in any long name. This links a block with no help from the tickets' descriptions, which turned out not to
 * be reliable (the whole middle tier of The O2 Belfast failed to link by them).
 */
export function abbreviates(code, name) {
  const letters = keyOf(code).replace(/\d+$/, '');
  const number = (/(\d+)$/.exec(keyOf(code)) || ['', ''])[1];
  const words = String(name == null ? '' : name).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const nameNumber = words.length && /^\d+$/.test(words[words.length - 1]) ? words.pop() : '';
  if (number !== nameNumber || words.length < 2 || !letters) return false;

  // can `rest` be made from the words from `index` on, each giving its first letter and later ones in order?
  const share = function (rest, index) {
    if (index === words.length) return rest === '';
    const word = words[index];
    if (rest[0] !== word[0]) return false;
    let at = 0; // how far through the word the letters taken so far reach
    for (let k = 1; k <= rest.length; k++) {
      const found = word.indexOf(rest[k - 1], k === 1 ? 0 : at + 1);
      if (found < 0) return false;
      at = found;
      if (share(rest.slice(k), index + 1)) return true;
    }
    return false;
  };
  return share(letters, 0);
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
 *
 * In two steps, so a guess can never take a block from a certainty:
 *   1. a block takes the section it shares its NAME or ID with (an id the best; a tie is no link);
 *   2. a block still left takes, from the sections that found no block in step 1, the one that its description-built name
 *      matches, or whose code abbreviates its name ("NTHM3" of "NORTH MIDDLE 3": that counts the more); a tie is no link.
 * Several blocks may be one section (the ACCESSIBLE ones, by name); a block nothing matches is left out.
 */
export function linkBlocks(blocks, sections) {
  const bySection = sections.map(function (s) { return { name: s.name, keys: sectionKeys(s.name, s.tickets) }; });
  const blockToSection = new Map();
  const sectionToBlocks = new Map();
  const link = function (index, section) {
    blockToSection.set(index, section.name);
    if (!sectionToBlocks.has(section.name)) sectionToBlocks.set(section.name, []);
    sectionToBlocks.get(section.name).push(index);
  };
  /** The one section with the highest score above 0 (null when none, or when two share the highest). */
  const best = function (scored) {
    const top = scored.reduce(function (max, c) { return Math.max(max, c.score); }, 0);
    if (top <= 0) return null;
    const winners = scored.filter(function (c) { return c.score === top; });
    return winners.length === 1 ? winners[0].section : null;
  };
  const weightOf = function (section, mine, atLeast) {
    return section.keys.reduce(function (sum, k) { return mine.has(k.key) && k.weight >= atLeast ? Math.max(sum, k.weight) : sum; }, 0);
  };

  // 1. by name or id
  blocks.forEach(function (block, index) {
    const mine = new Set(blockKeys(block));
    const found = best(bySection.map(function (section) { return { section, score: weightOf(section, mine, 3) }; }));
    if (found) link(index, found);
  });

  // 2. what is left, from the sections that have no block yet
  const free = bySection.filter(function (section) { return !sectionToBlocks.has(section.name); });
  blocks.forEach(function (block, index) {
    if (blockToSection.has(index)) return;
    const mine = new Set(blockKeys(block));
    const found = best(free.map(function (section) {
      return { section, score: weightOf(section, mine, 0) + (abbreviates(section.name, block.name) ? 1.5 : 0) };
    }));
    if (found) link(index, found);
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
